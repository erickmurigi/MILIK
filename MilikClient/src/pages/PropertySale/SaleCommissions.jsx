import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaCheck, FaMoneyBillWave, FaPrint, FaRedoAlt, FaSearch, FaUndo } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import { FilterDateRange } from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi, todayISO } from "../../services/propertySaleApi";
import { useConfirm } from "../../context/ConfirmContext";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import Modal from "../../components/common/Modal";
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
const EMPTY_PAYOUT   = { payoutMethod: "bank_transfer", payoutReference: "", payoutDate: todayISO(), cashbook: "" };
const PAGE_SIZE      = 50;

const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const SaleCommissions = () => {
  const confirm        = useConfirm();
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz            = currentCompany?._id;

  const [statusFilter, setStatusFilter] = useTabState("/sale/commissions:statusFilter", "");
  const [search,       setSearch]       = useTabState("/sale/commissions:search", "");
  const [agentFilt,    setAgentFilt]    = useTabState("/sale/commissions:agentFilt", "");
  const [dealFilt,     setDealFilt]     = useTabState("/sale/commissions:dealFilt", "");
  const [dateFrom,     setDateFrom]     = useTabState("/sale/commissions:dateFrom", "");
  const [dateTo,       setDateTo]       = useTabState("/sale/commissions:dateTo", "");
  const [page,         setPage]         = useTabState("/sale/commissions:page", 1);
  const [pageSize,     setPageSize]     = useTabState("/sale/commissions:pageSize", PAGE_SIZE);
  const [showPayout,   setShowPayout]   = useState(null);
  const [payoutForm,   setPayoutForm]   = useState(EMPTY_PAYOUT);
  const [saving,       setSaving]       = useState(false);
  const [actionKey,    setActionKey]    = useState("");

  const { data: agentsData } = useQuery({
    queryKey: ["sale-agents-ref", biz],
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
  const cashbookOptions = cashbookAccounts.map((a) => ({ value: a._id, label: `${a.code ? `${a.code} — ` : ""}${a.name}` }));

  const { data: dealsData } = useQuery({
    queryKey: ["sale-deals-ref", biz],
    queryFn:  () => saleApi.listDeals({ business: biz, limit: 200 }),
    enabled:  !!biz,
    staleTime: 5 * 60_000,
  });
  const agentsRef = agentsData?.data ?? [];
  const dealsRef  = dealsData?.data  ?? [];

  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-commissions", biz, statusFilter, search, agentFilt, dealFilt, dateFrom, dateTo, page, pageSize],
    queryFn:  () => saleApi.listCommissions({
      business: biz, limit: pageSize, page,
      ...(statusFilter && { status:  statusFilter }),
      ...(search       && { search }),
      ...(agentFilt    && { agentId: agentFilt }),
      ...(dealFilt     && { dealId:  dealFilt }),
      ...(dateFrom     && { dateFrom }),
      ...(dateTo       && { dateTo }),
    }),
    enabled:  !!biz,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const commissions = data?.data   ?? [];
  const total       = data?.total  ?? 0;
  const commStats   = data?.stats  ?? null;
  const totalPages  = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sale-commissions", biz] });

  const handleApprove = async (commission) => {
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
  };

  const handlePayout = async () => {
    if (!payoutForm.payoutMethod || !payoutForm.payoutDate) { toast.warn("Payout method and date are required"); return; }
    setSaving(true);
    try {
      const { cashbook, ...rest } = payoutForm;
      await saleApi.updateCommissionStatus(showPayout._id, { status: "paid", ...rest, ...(cashbook && { cashbook }), business: biz });
      toast.success("Commission marked as paid");
      const paid = { ...showPayout, status: "paid", ...payoutForm };
      setShowPayout(null);
      setPayoutForm(EMPTY_PAYOUT);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] });
      window.open(`/sale/commissions/${paid._id}/statement`, "_blank");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payout");
    } finally { setSaving(false); }
  };

  const handleReverse = async (commission) => {
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
  };

  const resetFilters = () => { setSearch(""); setStatusFilter(""); setAgentFilt(""); setDealFilt(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const activeFilterCount = [search, statusFilter, agentFilt, dealFilt, dateFrom, dateTo].filter(Boolean).length;

  return (
    <PropertySaleShell>
      <div className="flex h-full flex-col gap-1.5">

        {/* Single unified bar: stats + filters + refresh */}
        <div
          className="flex shrink-0 items-center gap-2 overflow-x-auto border border-slate-200 bg-white px-3 py-1.5"
          style={{ borderLeft: "3px solid #0B3B2E" }}
        >
          {/* Stats */}
          {[
            { key: "pending",   label: "Pending",   tone: "text-amber-700"   },
            { key: "approved",  label: "Approved",  tone: "text-blue-700"    },
            { key: "paid",      label: "Paid",      tone: "text-emerald-700" },
            { key: "cancelled", label: "Cancelled", tone: "text-slate-500"   },
          ].map(({ key, label, tone }, i) => (
            <React.Fragment key={key}>
              {i > 0 && <span className="shrink-0 text-slate-200 select-none">|</span>}
              <div className="flex shrink-0 items-baseline gap-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                <span className={`font-mono text-xs font-black tabular-nums ${tone}`}>{fmtKES(commStats?.[key]?.amount ?? 0)}</span>
                <span className="text-[10px] text-slate-400">({commStats?.[key]?.count ?? 0})</span>
              </div>
            </React.Fragment>
          ))}

          {/* Divider */}
          <span className="shrink-0 text-slate-200 select-none mx-1">·</span>

          {/* Search */}
          <div className="relative shrink-0" style={{ width: 160 }}>
            <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Agent, deal, comm. no."
              className="h-7 w-full border border-slate-200 bg-white pl-7 pr-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none"
            />
          </div>

          {/* Dropdowns */}
          <AppSelect
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v ?? ""); setPage(1); }}
            options={["pending","approved","paid","cancelled","reversed"].map((s) => ({ value: s, label: fmtLabel(s) }))}
            placeholder="All Statuses" clearable size="sm"
          />
          <AppSelect
            value={agentFilt}
            onChange={(v) => { setAgentFilt(v ?? ""); setPage(1); }}
            options={agentsRef.map((a) => ({ value: a._id, label: `${a.fullName}${a.agentNumber ? ` (${a.agentNumber})` : ""}` }))}
            placeholder="All Agents" clearable size="sm" searchable
          />
          <AppSelect
            value={dealFilt}
            onChange={(v) => { setDealFilt(v ?? ""); setPage(1); }}
            options={dealsRef.map((d) => ({ value: d._id, label: `${d.dealNumber}${d.listing?.title ? ` — ${d.listing.title}` : ""}` }))}
            placeholder="All Deals" clearable size="sm" searchable
          />

          {/* Date range */}
          <FilterDateRange
            from={dateFrom} to={dateTo}
            onFromChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            onToChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />

          {/* Reset */}
          <button
            type="button"
            onClick={resetFilters}
            className={`shrink-0 inline-flex h-7 items-center gap-1 border px-2.5 text-xs font-bold transition-colors ${
              activeFilterCount > 0
                ? "border-[#0B3B2E] bg-[#0B3B2E] text-white hover:bg-[#07271e]"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            <FaRedoAlt size={9} /> Reset
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-[14px] items-center justify-center rounded-full bg-white/25 px-1 text-[9px] font-black">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Refresh */}
          <button
            type="button"
            onClick={invalidate}
            className="shrink-0 inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {/* Table */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
          <MilikTable
            columns={[
              { label: "Comm. No." },
              { label: "Agent" },
              { label: "Deal" },
              { label: "Property" },
              { label: "Rate" },
              { label: "Gross Amt", align: "right" },
              { label: "WHT", align: "right" },
              { label: "Net Amt", align: "right" },
              { label: "Payout Date" },
              { label: "Status" },
            ]}
            rows={commissions}
            loading={loading}
            empty="No commissions found."
            minWidth={760}
            renderRow={(c) => (
              <>
                <td className="px-3 py-1.5 font-mono font-black text-[#027333] border-r border-gray-100">{c.commissionNumber}</td>
                <td className="px-3 py-1.5 font-bold text-slate-800 border-r border-gray-100">
                  {c.agent?.fullName || "—"}
                  {c.splits?.length > 0 && (
                    <span className="ml-1 border border-violet-200 bg-violet-50 px-1 py-0 text-[8px] font-black text-violet-600">+{c.splits.length} split</span>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono font-black text-slate-700 border-r border-gray-100">{c.deal?.dealNumber || "—"}</td>
                <td className="max-w-[140px] truncate px-3 py-1.5 text-slate-500 border-r border-gray-100">{c.deal?.listing?.title || c.deal?.listing?.listingNumber || "—"}</td>
                <td className="px-3 py-1.5 font-black text-[#027333] border-r border-gray-100">
                  {c.commissionRate}{c.commissionType === "percentage" ? "%" : " KES"}
                </td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-slate-900">{fmtKES(c.commissionAmount)}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono tabular-nums text-rose-600 text-[10px]">
                  {c.whtAmount > 0 ? <>-{fmtKES(c.whtAmount)}<br /><span className="text-[9px] text-slate-400">{c.whtRate}% WHT</span></> : "—"}
                </td>
                <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono font-black tabular-nums text-emerald-700">{fmtKES(c.netAmount ?? c.commissionAmount)}</td>
                <td className="px-3 py-1.5 border-r border-gray-100 font-mono tabular-nums text-slate-500">{c.payoutDate ? fmtDate(c.payoutDate) : "—"}</td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block border px-1.5 py-0.5 text-[9px] font-black uppercase ${STATUS_BADGE[c.status] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                    {c.status}
                  </span>
                </td>
              </>
            )}
            renderActions={(c) => (
              <div className="inline-flex items-center gap-1">
                {c.status === "pending" && (
                  <button type="button" onClick={() => handleApprove(c)} disabled={!!actionKey} className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-40">
                    <FaCheck className="mr-0.5 inline text-[8px]" /> Approve
                  </button>
                )}
                {c.status === "approved" && (
                  <button type="button" onClick={() => { setShowPayout(c); setPayoutForm(EMPTY_PAYOUT); }} className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">
                    <FaMoneyBillWave className="mr-0.5 inline text-[8px]" /> Pay
                  </button>
                )}
                {c.status === "paid" && c.payoutReference && (
                  <span className="font-mono text-[10px] text-slate-400">{c.payoutReference}</span>
                )}
                {c.status === "paid" && (
                  <button type="button" onClick={() => handleReverse(c)} disabled={actionKey === `${c._id}:reverse`} className="border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-40" title="Reverse payout GL entry">
                    <FaUndo className="text-[8px]" />
                  </button>
                )}
                <button type="button" onClick={() => window.open(`/sale/commissions/${c._id}/statement`, "_blank")} title="Print Commission Statement" className="border border-[#B7C9C0] bg-white px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                  <FaPrint className="text-[8px]" />
                </button>
              </div>
            )}
          />

          <PaginationBar
            page={page}
            pages={totalPages}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            loading={isFetching}
          />
        </div>
      </div>

      {/* Payout Modal */}
      {showPayout && (
        <Modal
          title={`Payout — ${showPayout.commissionNumber}`}
          onClose={() => setShowPayout(null)}
          footer={
            <>
              <button type="button" onClick={() => setShowPayout(null)} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handlePayout} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#07271e] disabled:opacity-60">
                {saving ? "Saving…" : "Confirm Payout"}
              </button>
            </>
          }
        >
          <div className="mb-3 border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">Commission Amount</div>
            <div className="text-xl font-black text-emerald-800">{fmtKES(showPayout.commissionAmount)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <AppSelect
                label="Payout Method *"
                value={payoutForm.payoutMethod}
                onChange={(v) => setPayoutForm((f) => ({ ...f, payoutMethod: v ?? "" }))}
                options={PAYOUT_METHODS.map((m) => ({ value: m, label: fmtLabel(m) }))}
                size="md"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Payout Date *</label>
              <input
                type="date"
                value={payoutForm.payoutDate}
                onChange={(e) => setPayoutForm((f) => ({ ...f, payoutDate: e.target.value }))}
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs focus:border-[#0B3B2E] focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <AppSelect
                label="Bank / Cashbook Account (GL Credit)"
                value={payoutForm.cashbook}
                onChange={(v) => setPayoutForm((f) => ({ ...f, cashbook: v ?? "" }))}
                options={cashbookOptions}
                placeholder="— Fallback account if blank —"
                clearable
                searchable
                size="md"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">Reference / Transaction ID</label>
              <input
                type="text"
                value={payoutForm.payoutReference}
                onChange={(e) => setPayoutForm((f) => ({ ...f, payoutReference: e.target.value }))}
                placeholder="e.g. M-Pesa ref, EFT reference…"
                className="h-8 w-full border border-slate-200 bg-white px-2 text-xs font-mono focus:border-[#0B3B2E] focus:outline-none"
              />
            </div>
          </div>
        </Modal>
      )}
    </PropertySaleShell>
  );
};

export default SaleCommissions;
