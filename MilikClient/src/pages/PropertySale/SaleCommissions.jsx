import React, { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaChevronDown, FaCheck, FaFilter, FaMoneyBillWave, FaPrint, FaReceipt, FaRedoAlt, FaTimes, FaUndo } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar, { FilterSearch, FilterDateRange } from "./SaleFilterBar";
import ListToolbar from "../../components/common/ListToolbar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import useDebounce from "../../hooks/useDebounce";
import { useTabState } from "../../hooks/useTabState";
import { useTerms } from "../../hooks/useTerm";
import AmountInput from "./AmountInput";
import SalePrintButton from "./SalePrintButton";
import { exportAfterFetch, fetchAllPages, money, printAfterFetch, printSaleDocument } from "./salePrint";
import { printCommissionStatementById } from "./SaleCommissionStatement";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
import SaleExportButton from "./SaleExportButton";
import { fmtDate } from "../../utils/dates";
import MilikTable from "../../components/common/MilikTable";

const STATUS_BADGE = {
  pending:   "border-amber-200 bg-amber-50 text-amber-700",
  approved:  "border-blue-200 bg-blue-50 text-blue-700",
  paid:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-600",
  reversed:  "border-slate-200 bg-slate-50 text-slate-500",
};

const PAYOUT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const PAGE_SIZE      = 50;
const REFERENCE_REQUIRED_METHODS = ["mpesa", "bank_transfer", "cheque"];
const Required = () => <span className="ml-0.5 font-black text-red-600">*</span>;
const labelClass = "mb-1 block text-xs font-bold text-slate-900";
const inputClass = "h-7 w-full border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20";
const PAYOUT_SOURCE_OPTIONS = [
  { value: "company_cashbook", label: "Company Cashbook" },
  { value: "advocate_trust",   label: "Advocate (Trust Account)" },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Mirrors the backend's own "target minus already-withheld" math (commissionsController.js) so the
// preview the user sees before confirming is exactly what will be posted — not an approximation.
const previewPayoutSplit = (commission, amount) => {
  const total       = Number(commission.commissionAmount || 0);
  const totalWht    = Number(commission.whtAmount || 0);
  const alreadyPaid = Number(commission.paidOutAmount || 0);
  const alreadyWithheld = (commission.payouts || []).reduce((s, p) => s + Number(p.whtAmount || 0), 0);
  const amt = Math.max(0, Number(amount) || 0);
  const newCumulative = round2(alreadyPaid + amt);
  const targetWht = total > 0 ? round2(totalWht * (newCumulative / total)) : 0;
  const wht = round2(Math.max(0, targetWht - alreadyWithheld));
  return { wht, net: round2(amt - wht) };
};

// null for a legacy/one-shot commission (releaseSchedule empty) — tiers accrue automatically as the
// buyer pays, independent of Approve/Pay, so a staged commission needs its own progress readout instead
// of a bare status pill that looks identical to a simple one.
const tierProgress = (c) => {
  if (!c.releaseSchedule?.length) return null;
  const totalTiers = c.releaseSchedule.length;
  const releasedCount = c.tierReleases?.length || 0;
  const commissionAmount = Number(c.commissionAmount || 0);
  const releasedAmount = Number(c.releasedAmount || 0);
  const pct = commissionAmount > 0 ? Math.round((releasedAmount / commissionAmount) * 100) : 0;
  const fullyReleased = commissionAmount > 0 && releasedAmount >= commissionAmount - 0.01;
  return { totalTiers, releasedCount, pct, fullyReleased };
};

const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const commissionCols = (T) => [
  { label: "Comm. No.", width: "9%" },
  { label: T.saleAgent, width: "11%" },
  { label: T.saleDeal, width: "8%" },
  { label: "Property", width: "12%" },
  { label: "Rate", width: "6%" },
  { label: "Gross Amt",   align: "right", width: "10%" },
  { label: "WHT",         align: "right", width: "12%" },
  { label: "Net Amt",     align: "right", width: "11%" },
  { label: "Status", width: "16%" },
];

const COMMISSION_STATUS_OPTIONS = ["pending", "approved", "paid", "cancelled", "reversed"]
  .map((s) => ({ value: s, label: fmtLabel(s) }));

const PAYOUT_METHOD_OPTIONS = PAYOUT_METHODS.map((m) => ({ value: m, label: fmtLabel(m) }));

// Module scope so MilikTable's React.memo isn't defeated by a fresh function identity each parent render.
const renderCommissionRow = (c) => (
  <>
    <td className="px-3 py-1.5 font-mono font-black text-[#0B3B2E] border-r border-gray-100">{c.commissionNumber}</td>
    <td className="px-3 py-1.5 font-bold text-slate-800 border-r border-gray-100">
      {c.agent?.fullName || "—"}
      {c.splits?.length > 0 && (
        <span className="ml-1 border border-violet-200 bg-violet-50 px-1 py-0 text-[8px] font-black text-violet-600">+{c.splits.length} split</span>
      )}
    </td>
    <td className="px-3 py-1.5 font-mono font-black text-slate-700 border-r border-gray-100">{c.deal?.dealNumber || "—"}</td>
    <td className="max-w-[140px] truncate px-3 py-1.5 text-slate-500 border-r border-gray-100">{c.listing?.title || c.listing?.listingNumber || "—"}</td>
    <td className="px-3 py-1.5 font-black text-[#0B3B2E] border-r border-gray-100">
      {c.commissionRate}{c.commissionType === "percentage" ? "%" : " KES"}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-slate-900">{fmtKES(c.commissionAmount)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono tabular-nums text-rose-600 text-[10px]">
      {c.whtAmount > 0 ? <>-{fmtKES(c.whtAmount)} <span className="text-slate-400">({c.whtRate}%)</span></> : "—"}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-emerald-700">{fmtKES(c.netAmount ?? c.commissionAmount)}</td>
    <td className="px-3 py-1.5">
      <div className="inline-flex flex-nowrap items-center gap-1">
        <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-black uppercase ${STATUS_BADGE[c.status] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
          {c.status}
        </span>
        {(() => {
          const tp = tierProgress(c);
          if (!tp) return null;
          return (
            <span className="inline-block border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-500">
              {tp.releasedCount}/{tp.totalTiers} tiers · {tp.pct}%
            </span>
          );
        })()}
        {c.status === "approved" && Number(c.paidOutAmount || 0) > 0 && (
          <span className="inline-block whitespace-nowrap border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700">
            {fmtKES(c.paidOutAmount)} paid
          </span>
        )}
      </div>
    </td>
  </>
);

// Module scope, same reason as renderCommissionRow — a stable identity for MilikTable's memo.
const renderCommissionExpanded = (c) => {
  if (!c.releaseSchedule?.length) {
    return <div className="text-[10px] text-slate-400">Single release — this commission has no staged tiers.</div>;
  }
  return (
    <table className="w-full max-w-xl text-[10px]">
      <thead>
        <tr className="text-left text-slate-400">
          <th className="pb-1 pr-4 font-black uppercase">Threshold</th>
          <th className="pb-1 pr-4 font-black uppercase">Release %</th>
          <th className="pb-1 pr-4 text-right font-black uppercase">Amount</th>
          <th className="pb-1 pr-4 font-black uppercase">Status</th>
          <th className="pb-1 font-black uppercase">Released</th>
        </tr>
      </thead>
      <tbody>
        {c.releaseSchedule.map((tier, i) => {
          const released = (c.tierReleases || []).find((tr) => tr.thresholdPct === tier.thresholdPct);
          return (
            <tr key={i} className="border-t border-slate-200">
              <td className="py-1 pr-4 font-bold text-slate-700">{tier.thresholdPct}% paid</td>
              <td className="py-1 pr-4 text-slate-600">{tier.releasePct}%</td>
              <td className="py-1 pr-4 text-right font-mono font-bold text-slate-700">{released ? fmtKES(released.amount) : "—"}</td>
              <td className="py-1 pr-4">
                {/* "Tier" on purpose, not "Status" — this isn't the commission's own pending/approved/paid
                    lifecycle, just whether the buyer has paid enough to cross this one threshold yet. Using
                    the word "pending" here too would read as if the whole commission were unapproved. */}
                {released ? (
                  <span className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">RELEASED</span>
                ) : (
                  <span className="border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-black text-slate-400">UPCOMING</span>
                )}
              </td>
              <td className="py-1 text-slate-500">{released?.accruedAt ? fmtDate(released.accruedAt) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

// Payout modal — owns its form state so typing no longer re-renders the page or its table. Supports
// partial payouts: "Amount to Pay" defaults to the full remaining balance (today's exact one-shot
// behavior if left untouched) but can be reduced to disburse the commission across several real-world
// cash movements — each one its own WHT-withheld tranche, tracked on commission.payouts.
function PayoutModal({ commission, cashbookOptions, saving, onClose, onSubmit }) {
  const remaining = round2(Number(commission.commissionAmount || 0) - Number(commission.paidOutAmount || 0));
  const [payoutForm, setPayoutForm] = useState({
    amount: String(remaining),
    payoutMethod: "bank_transfer", payoutReference: "", payoutDate: todayISO(),
    cashbook: "", source: "company_cashbook",
  });
  const split = previewPayoutSplit(commission, payoutForm.amount);
  const isPartial = round2(Number(payoutForm.amount) || 0) < remaining - 0.01;

  return (
    <Modal
      title={`Payout — ${commission.commissionNumber}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(payoutForm)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : isPartial ? "Confirm Partial Payout" : "Confirm Payout"}
          </button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-px border border-slate-200 bg-slate-200 text-center">
        <div className="bg-slate-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Commission (Gross)</div>
          <div className="text-sm font-black text-slate-800">{fmtKES(commission.commissionAmount)}</div>
        </div>
        <div className="bg-slate-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Already Paid</div>
          <div className="text-sm font-black text-slate-800">{fmtKES(commission.paidOutAmount || 0)}</div>
        </div>
        <div className="col-span-2 bg-emerald-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-emerald-600">Remaining Balance</div>
          <div className="text-xl font-black text-emerald-800">{fmtKES(remaining)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <label className={labelClass}>Amount to Pay Now<Required /></label>
          <AmountInput
            value={payoutForm.amount}
            onChange={(v) => setPayoutForm((f) => ({ ...f, amount: v }))}
            className={inputClass}
          />
          {isPartial && (
            <p className="mt-1 text-[10px] font-semibold text-amber-600">
              Partial payout — {fmtKES(round2(remaining - (Number(payoutForm.amount) || 0)))} will remain owed after this.
            </p>
          )}
        </div>

        {/* WHT breakdown for this specific payout — not the whole commission */}
        <div className="grid grid-cols-2 gap-px border border-slate-200 bg-slate-200 text-center text-[10px]">
          <div className="bg-white px-2 py-1.5">
            <div className="font-black uppercase tracking-wider text-slate-400">WHT Withheld ({commission.whtRate}%)</div>
            <div className="font-mono font-black text-rose-600">-{fmtKES(split.wht)}</div>
          </div>
          <div className="bg-white px-2 py-1.5">
            <div className="font-black uppercase tracking-wider text-slate-400">Net to Disburse</div>
            <div className="font-mono font-black text-emerald-700">{fmtKES(split.net)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <AppSelect
              label="Payout Method" required
              value={payoutForm.payoutMethod}
              onChange={(v) => setPayoutForm((f) => ({ ...f, payoutMethod: v ?? "" }))}
              options={PAYOUT_METHOD_OPTIONS}
              size="sm"
            />
          </div>
          <div>
            <label className={labelClass}>Payout Date<Required /></label>
            <input
              type="date"
              value={payoutForm.payoutDate}
              onChange={(e) => setPayoutForm((f) => ({ ...f, payoutDate: e.target.value }))}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <AppSelect
            label="Paid By"
            value={payoutForm.source}
            onChange={(v) => setPayoutForm((f) => ({ ...f, source: v ?? "company_cashbook" }))}
            options={PAYOUT_SOURCE_OPTIONS}
            size="sm"
          />
          {payoutForm.source === "advocate_trust" && (
            <p className="mt-1 text-[10px] text-slate-500">
              The advocate who collected this deal's trust funds will be resolved automatically, along with their WHT-handling preference. No company cashbook moves.
            </p>
          )}
        </div>
        {payoutForm.source !== "advocate_trust" && (
          <div>
            <AppSelect
              label="Bank / Cashbook Account (GL Credit)"
              value={payoutForm.cashbook}
              onChange={(v) => setPayoutForm((f) => ({ ...f, cashbook: v ?? "" }))}
              options={cashbookOptions}
              placeholder="— Fallback account if blank —"
              clearable
              searchable
              size="sm"
            />
          </div>
        )}
        <div>
          <label className={labelClass}>
            Reference / Transaction ID{REFERENCE_REQUIRED_METHODS.includes(payoutForm.payoutMethod) && <Required />}
          </label>
          <input
            type="text"
            value={payoutForm.payoutReference}
            onChange={(e) => setPayoutForm((f) => ({ ...f, payoutReference: e.target.value }))}
            placeholder="e.g. M-Pesa ref, EFT reference…"
            className={`${inputClass} font-mono ${REFERENCE_REQUIRED_METHODS.includes(payoutForm.payoutMethod) ? "border-amber-300 bg-amber-50 focus:border-amber-500" : ""}`}
          />
          {REFERENCE_REQUIRED_METHODS.includes(payoutForm.payoutMethod) && (
            <div className="mt-1 text-[10px] font-semibold text-amber-600">Required for {fmtLabel(payoutForm.payoutMethod)} — must be unique</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

const SaleCommissions = () => {
  const T = useTerms("saleAgent", "saleAgents", "saleDeal", "saleDeals");
  const commissionColumns = useMemo(() => commissionCols(T), [T]);
  const confirm        = useConfirm();
  const navigate        = useNavigate();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [statusFilter, setStatusFilter] = useTabState("/sale/commissions:statusFilter", "");
  const [search,       setSearch]       = useTabState("/sale/commissions:search", "");
  const debouncedSearch = useDebounce(search, 400);
  const [agentFilt,    setAgentFilt]    = useTabState("/sale/commissions:agentFilt", "");
  const [dealFilt,     setDealFilt]     = useTabState("/sale/commissions:dealFilt", "");
  const [dateFrom,     setDateFrom]     = useTabState("/sale/commissions:dateFrom", "");
  const [dateTo,       setDateTo]       = useTabState("/sale/commissions:dateTo", "");
  const [page,         setPage]         = useTabState("/sale/commissions:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/commissions:pageSize", PAGE_SIZE);
  const [showPayout,   setShowPayout]   = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [actionKey,    setActionKey]    = useState("");
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const statusBtnRef = useRef(null);

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz, "all"],
    queryFn:  () => saleApi.listAgents({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const { data: cashbookAccounts = [] } = useQuery({
    queryKey: ["sale-cashbook-accounts", biz],
    queryFn:  () => saleApi.listCashbookAccounts({ business: biz }),
    enabled:  !!biz,
    staleTime: 10 * 60_000,
  });
  const cashbookOptions = useMemo(() => cashbookAccounts.map((a) => ({ value: a._id, label: `${a.code ? `${a.code} — ` : ""}${a.name}` })), [cashbookAccounts]);

  const { data: dealsData } = useQuery({
    queryKey: ["sale-deals-ref", biz],
    queryFn:  () => saleApi.listDeals({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const agentsRef = useMemo(() => agentsData?.data ?? [], [agentsData]);
  const dealsRef  = useMemo(() => dealsData?.data  ?? [], [dealsData]);

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-commissions", biz, statusFilter, debouncedSearch, agentFilt, dealFilt, dateFrom, dateTo, page, pageSize],
    queryFn:  () => saleApi.listCommissions({
      business: biz, limit: pageSize, page,
      ...(statusFilter && { status:  statusFilter }),
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(agentFilt    && { agentId: agentFilt }),
      ...(dealFilt     && { dealId:  dealFilt }),
      ...(dateFrom     && { dateFrom }),
      ...(dateTo       && { dateTo }),
    }),
    enabled:  !!biz,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === biz ? prev : undefined),
    staleTime: 30_000,
  });

  const commissions = useMemo(() => data?.data ?? [], [data]);
  const total       = data?.total  ?? 0;
  const commStats   = data?.stats  ?? null;
  const totalPages  = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: ["sale-commissions", biz] }), [queryClient, biz]);

  const handleApprove = useCallback(async (commission) => {
    if (!await confirm({ title: "Approve Commission", message: `Approve ${commission.commissionNumber} for ${fmtKES(commission.commissionAmount)}?`, confirmText: "Approve" })) return;
    setActionKey(`${commission._id}:approve`);
    try {
      await saleApi.updateCommissionStatus(commission._id, { status: "approved", business: biz });
      toast.success("Commission approved");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to approve");
    } finally { setActionKey(""); }
  }, [confirm, biz, invalidate, queryClient]);

  const handlePayout = async (payoutForm) => {
    if (!payoutForm.payoutMethod || !payoutForm.payoutDate) { toast.warn("Payout method and date are required"); return; }
    const amount = Number(payoutForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.warn("Enter an amount greater than 0"); return; }
    if (REFERENCE_REQUIRED_METHODS.includes(payoutForm.payoutMethod) && !payoutForm.payoutReference.trim()) {
      toast.warn(`A reference number is required for ${fmtLabel(payoutForm.payoutMethod)} payouts`);
      return;
    }
    setSaving(true);
    try {
      const { cashbook, ...rest } = payoutForm;
      const updated = await saleApi.updateCommissionStatus(showPayout._id, { status: "paid", amount, ...rest, ...(cashbook && { cashbook }), business: biz });
      const fullyPaid = updated?.status === "paid";
      toast.success(fullyPaid ? "Commission marked as paid" : "Partial payout recorded");
      setShowPayout(null);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
      if (fullyPaid) window.open(`/sale/commissions/${showPayout._id}/statement`, "_blank");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payout");
    } finally { setSaving(false); }
  };

  const handleReverse = useCallback(async (commission) => {
    if (!await confirm({
      title: "Reverse Commission Payout",
      message: `Reverse the payout of ${commission.commissionNumber} (${fmtKES(commission.commissionAmount)})? This will reverse the GL entry.`,
      confirmText: "Reverse",
      isDangerous: true,
    })) return;
    setActionKey(`${commission._id}:reverse`);
    try {
      await saleApi.updateCommissionStatus(commission._id, { status: "reversed", business: biz });
      toast.success("Commission payout reversed");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to reverse payout");
    } finally { setActionKey(""); }
  }, [confirm, biz, invalidate, queryClient]);

  // Allowed from pending, approved, or reversed (never from paid — a disbursed commission can only be
  // reversed, not cancelled outright). Cancelling an approved or reversed commission also reverses its
  // accrual GL so nothing stays on the books (commissionsController.js).
  const handleCancel = useCallback(async (commission) => {
    const hasAccrual = commission.status === "approved" || commission.status === "reversed";
    if (!await confirm({
      title: "Cancel Commission",
      message: `Cancel ${commission.commissionNumber} (${fmtKES(commission.commissionAmount)})?${hasAccrual ? " This will reverse its accrued GL entries." : ""} This cannot be undone.`,
      confirmText: "Cancel Commission",
      isDangerous: true,
    })) return;
    setActionKey(`${commission._id}:cancel`);
    try {
      await saleApi.updateCommissionStatus(commission._id, { status: "cancelled", business: biz });
      toast.success("Commission cancelled");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to cancel");
    } finally { setActionKey(""); }
  }, [confirm, biz, invalidate, queryClient]);

  const company = useSelector((s) => s.company?.currentCompany);
  const [printing, setPrinting] = useState(false);
  const printReport = async () => {
    setPrinting(true);
    const filters = {
      business: biz,
      ...(statusFilter && { status: statusFilter }),
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(agentFilt && { agentId: agentFilt }),
      ...(dealFilt && { dealId: dealFilt }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    };
    const described = [
      statusFilter && `Status: ${fmtLabel(statusFilter)}`,
      agentFilt && agentFilterOptions.find((o) => o.value === agentFilt)?.label,
      dealFilt && dealFilterOptions.find((o) => o.value === dealFilt)?.label,
      (dateFrom || dateTo) && `${dateFrom ? fmtDate(dateFrom) : "…"} – ${dateTo ? fmtDate(dateTo) : "…"}`,
      debouncedSearch && `Search: ${debouncedSearch}`,
    ].filter(Boolean);
    await printAfterFetch(() => fetchAllPages(saleApi.listCommissions, filters), ({ rows, last }) => {
      const sum = (key) => rows.reduce((s, c) => s + Number(c[key] || 0), 0);
      const stats = last?.stats || commStats;
      return {
        title: "Commissions",
        subtitle: described.join(" · ") || "All commissions",
        company,
        summaryItems: ["pending", "approved", "paid", "cancelled"].map((k) => [fmtLabel(k), `${money(stats?.[k]?.amount)} (${stats?.[k]?.count ?? 0})`]),
        columns: [
          { label: "Comm. No.", value: (c) => c.commissionNumber },
          { label: T.saleAgent, value: (c) => `${c.agent?.fullName || "—"}${c.splits?.length ? ` (+${c.splits.length} split)` : ""}` },
          { label: T.saleDeal, value: (c) => c.deal?.dealNumber || "—" },
          { label: "Property", value: (c) => c.listing?.title || c.listing?.listingNumber || "—" },
          { label: "Rate", value: (c) => `${c.commissionRate}${c.commissionType === "percentage" ? "%" : " KES"}` },
          { label: "Gross (KES)", align: "right", value: (c) => money(c.commissionAmount) },
          { label: "WHT (KES)", align: "right", value: (c) => (c.whtAmount > 0 ? money(c.whtAmount) : "—") },
          { label: "Net (KES)", align: "right", value: (c) => money(c.netAmount ?? c.commissionAmount) },
          { label: "Status", value: (c) => c.status },
        ],
        rows,
        totalsRow: ["TOTAL", `${rows.length} commissions`, "", "", "", money(sum("commissionAmount")), money(sum("whtAmount")), money(rows.reduce((s, c) => s + Number(c.netAmount ?? c.commissionAmount ?? 0), 0)), ""],
      };
    });
    setPrinting(false);
  };

  const [exporting, setExporting] = useState(false);
  const exportReport = async () => {
    setExporting(true);
    const filters = {
      business: biz,
      ...(statusFilter && { status: statusFilter }),
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(agentFilt && { agentId: agentFilt }),
      ...(dealFilt && { dealId: dealFilt }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo && { dateTo }),
    };
    await exportAfterFetch(() => fetchAllPages(saleApi.listCommissions, filters), ({ rows }) => ({
      filename: "commissions",
      columns: [
        { label: "Comm. No.", value: (c) => c.commissionNumber },
        { label: T.saleAgent, value: (c) => `${c.agent?.fullName || "—"}${c.splits?.length ? ` (+${c.splits.length} split)` : ""}` },
        { label: T.saleDeal, value: (c) => c.deal?.dealNumber || "—" },
        { label: "Property", value: (c) => c.listing?.title || c.listing?.listingNumber || "—" },
        { label: "Rate", value: (c) => `${c.commissionRate}${c.commissionType === "percentage" ? "%" : " KES"}` },
        { label: "Gross (KES)", value: (c) => money(c.commissionAmount) },
        { label: "WHT (KES)", value: (c) => (c.whtAmount > 0 ? money(c.whtAmount) : "—") },
        { label: "Net (KES)", value: (c) => money(c.netAmount ?? c.commissionAmount) },
        { label: "Status", value: (c) => c.status },
      ],
      rows,
    }));
    setExporting(false);
  };

  const resetFilters = () => { setSearch(""); setStatusFilter(""); setAgentFilt(""); setDealFilt(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const activeFilterCount = [search, statusFilter, agentFilt, dealFilt, dateFrom, dateTo].filter(Boolean).length;

  const agentFilterOptions = useMemo(() => agentsRef.map((a) => ({ value: a._id, label: `${a.fullName}${a.agentNumber ? ` (${a.agentNumber})` : ""}` })), [agentsRef]);
  const dealFilterOptions  = useMemo(() => dealsRef.map((d) => ({ value: d._id, label: `${d.dealNumber}${d.listing?.title ? ` — ${d.listing.title}` : ""}` })), [dealsRef]);
  const handlePrintStatement = useCallback((e) => {
    const id = e.currentTarget.dataset.id;
    printSaleDocument((win) => printCommissionStatementById(id, { company: currentCompany, T, win }));
  }, [currentCompany, T]);

  const renderCommissionActions = useCallback((c) => {
    const tp = tierProgress(c);
    // A staged commission accrues its own GL entries tier-by-tier, automatically, as the buyer pays —
    // Approve has no accrual effect on one (see commissionsController.js) and stays disabled until every
    // tier has actually released, so finance never signs off on something still partly in flight.
    const approveBlocked = tp && !tp.fullyReleased;
    return (
    <div className="inline-flex items-center gap-1">
      {c.status === "pending" && (
        approveBlocked ? (
          <span
            title={`Accrues automatically as the buyer pays — ${tp.releasedCount}/${tp.totalTiers} tiers released so far (${tp.pct}%). Approve unlocks once fully released.`}
            className="cursor-help whitespace-nowrap border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-400"
          >
            Accruing {tp.pct}%
          </span>
        ) : (
          <button type="button" onClick={() => handleApprove(c)} disabled={!!actionKey} title="Approve" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-40">
            <FaCheck className="text-[8px]" />
          </button>
        )
      )}
      {c.status === "approved" && (
        <button type="button" onClick={() => setShowPayout(c)} title="Pay" className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700 hover:bg-emerald-100">
          <FaMoneyBillWave className="text-[8px]" />
        </button>
      )}
      {c.status === "paid" && (
        <button type="button" onClick={() => handleReverse(c)} disabled={actionKey === `${c._id}:reverse`} className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-600 hover:bg-rose-100 disabled:opacity-40" title="Reverse payout GL entry">
          <FaUndo className="text-[8px]" />
        </button>
      )}
      {["pending", "approved", "reversed"].includes(c.status) && (
        <button type="button" onClick={() => handleCancel(c)} disabled={actionKey === `${c._id}:cancel`} title="Cancel commission" className="border border-red-200 bg-white px-2 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-40">
          <FaTimes className="text-[8px]" />
        </button>
      )}
      <button type="button" data-id={c._id} onClick={handlePrintStatement} title="Print Commission Statement" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[#0B3B2E] hover:bg-[#F1F6F3]">
        <FaPrint className="text-[8px]" />
      </button>
    </div>
    );
  }, [handleApprove, handleReverse, handleCancel, handlePrintStatement, actionKey]);

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">

        {/* Filter bar */}
        <SaleFilterBar
          onReset={resetFilters}
          activeCount={activeFilterCount}
          trailing={
            <>
              <ListToolbar.Button variant="outline" onClick={() => navigate("/sale/commission-payouts")} title="See every actual payout event — method, reference, via-trust — for this and every other commission">
                <FaReceipt size={9} /> Payouts
              </ListToolbar.Button>
              <SalePrintButton onClick={printReport} busy={printing} disabled={loading || total === 0} />
              <SaleExportButton onClick={exportReport} busy={exporting} disabled={loading || total === 0} />
              <ListToolbar.Button variant="outline" onClick={invalidate}>
                <FaRedoAlt size={7} className={isFetching ? "animate-spin" : ""} /> Refresh
              </ListToolbar.Button>
            </>
          }
        >
          <FilterSearch
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={`${T.saleAgent}, ${T.saleDeal.toLowerCase()}, comm. no.`}
          />
          <div className="relative">
            <ListToolbar.Button
              ref={statusBtnRef}
              icon={FaFilter}
              variant={statusFilter ? "dark" : "outline"}
              onClick={() => setShowStatusMenu((o) => !o)}
            >
              {statusFilter ? `${fmtLabel(statusFilter)}: ${commStats?.[statusFilter]?.count ?? 0}` : "All Statuses"}
              <FaChevronDown size={7} />
            </ListToolbar.Button>
            <ListToolbar.Menu open={showStatusMenu} onClose={() => setShowStatusMenu(false)} anchorRef={statusBtnRef} width="w-56">
              <ListToolbar.MenuItem onClick={() => { setStatusFilter(""); setPage(1); setShowStatusMenu(false); }} className={!statusFilter ? "bg-[#F1F6F3] font-bold text-[#0B3B2E]" : ""}>
                All Statuses
              </ListToolbar.MenuItem>
              {COMMISSION_STATUS_OPTIONS.map(({ value: s, label }) => {
                const stat = commStats?.[s];
                const active = statusFilter === s;
                return (
                  <ListToolbar.MenuItem
                    key={s}
                    onClick={() => { setStatusFilter(s); setPage(1); setShowStatusMenu(false); }}
                    className={`justify-between ${active ? "bg-[#F1F6F3] font-bold text-[#0B3B2E]" : ""}`}
                  >
                    <span>{label}</span>
                    <span className="font-mono text-slate-400">{stat ? `${fmtKES(stat.amount)} (${stat.count})` : "—"}</span>
                  </ListToolbar.MenuItem>
                );
              })}
            </ListToolbar.Menu>
          </div>
          <AppSelect
            value={agentFilt}
            onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }}
            options={agentFilterOptions}
            placeholder={`All ${T.saleAgents}`} clearable compact searchable
          />
          <AppSelect
            value={dealFilt}
            onChange={(v) => { setDealFilt(v ?? ""); setPage(1); }}
            options={dealFilterOptions}
            placeholder={`All ${T.saleDeals}`} clearable compact searchable
          />
          <FilterDateRange
            from={dateFrom} to={dateTo}
            onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
        </SaleFilterBar>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <MilikTable
            columns={commissionColumns}
            rows={commissions}
            loading={loading}
            empty="No commissions found."
            minWidth={860}
            renderRow={renderCommissionRow}
            renderActions={renderCommissionActions}
            renderExpanded={renderCommissionExpanded}
          />

          <PaginationBar
            page={page}
            pages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            loading={isFetching}
            label="commissions"
          />
        </div>
      </div>

      {/* Payout Modal */}
      {showPayout && (
        <PayoutModal commission={showPayout} cashbookOptions={cashbookOptions} saving={saving} onClose={() => setShowPayout(null)} onSubmit={handlePayout} />
      )}
    </PropertySaleShell>
  );
};

export default SaleCommissions;
