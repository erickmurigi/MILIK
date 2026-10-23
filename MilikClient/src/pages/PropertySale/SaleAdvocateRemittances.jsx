import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaMoneyCheckAlt, FaRedoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import Modal from "../../components/common/Modal";
import { saleApi, fmtKES, todayISO } from "../../services/propertySaleApi";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import { inputClass, labelClass } from "../../utils/formStyles";
import { useTerms } from "../../hooks/useTerm";

const PAGE_SIZE = 50;

const outstandingColumns = [
  { label: "Owner" }, { label: "Voucher" }, { label: "Due" }, { label: "Amount", align: "right" },
  { label: "Outstanding", align: "right" },
];

const renderOutstandingRow = (row) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-700">
      {row.owner?.fullName || "—"}
      {row.projectName ? <span className="ml-1 text-[10px] text-slate-400">· {row.projectName}</span> : null}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">
      <span className="font-mono text-xs">{row.voucherNo || "—"}</span>
      {row.narration ? <span className="ml-1 text-[11px] text-slate-400">{row.narration}</span> : (row.payeeName ? <span className="ml-1 text-[11px] text-slate-400">Paid to {row.payeeName}</span> : null)}
    </td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.dueDate ? new Date(row.dueDate).toLocaleDateString() : "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-mono text-slate-500">{fmtKES(row.amount)}</td>
    <td className="px-3 py-1.5 text-right font-mono font-black text-[#0B3B2E]">{fmtKES(row.outstanding)}</td>
  </>
);

const rechargeRemittanceColumns = [
  { label: "Remittance No." }, { label: "Date" }, { label: "Owner" }, { label: "Amount", align: "right" }, { label: "Cashbook" }, { label: "Reference" },
];

const renderRechargeRemittanceRow = (row) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{row.remittanceNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.date ? new Date(row.date).toLocaleDateString() : "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.owner?.fullName || "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black text-slate-700 tabular-nums">{fmtKES(row.amount)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.cashbook?.name || "—"}</td>
    <td className="px-3 py-1.5 text-slate-600">{row.reference || "—"}</td>
  </>
);

const blankRechargeForm = { amount: "", date: todayISO(), cashbook: "", reference: "", notes: "" };

// One voucher at a time, kept deliberately simple — the backend endpoint itself supports settling
// several vouchers in one remittance (allocations is an array), but a single-voucher "Remit" action per
// row is the clearer, lower-risk starting UX; nothing here blocks adding a multi-select later.
function RemitVoucherModal({ voucher, cashbookOptions, saving, onClose, onSubmit }) {
  const [form, setForm] = useState({ ...blankRechargeForm, amount: String(voucher.outstanding) });
  return (
    <Modal
      title={`Remit — ${voucher.voucherNo || "Recoverable Expense"}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onSubmit(form)} disabled={saving} className="bg-[#0B3B2E] px-4 py-1.5 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
            {saving ? "Saving…" : "Confirm Remittance"}
          </button>
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-px border border-slate-200 bg-slate-200 text-center">
        <div className="bg-slate-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Owner</div>
          <div className="text-sm font-black text-slate-800">{voucher.owner?.fullName || "—"}</div>
        </div>
        <div className="bg-emerald-50 px-3 py-2">
          <div className="text-[9px] font-black uppercase tracking-wider text-emerald-600">Outstanding</div>
          <div className="text-sm font-black text-emerald-800">{fmtKES(voucher.outstanding)}</div>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelClass}>Amount to Remit Now</label>
          <input type="number" min="0" max={voucher.outstanding} value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Date</label>
          <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className={inputClass} />
        </div>
        <div>
          <AppSelect label="Received Into" value={form.cashbook} onChange={(v) => setForm((p) => ({ ...p, cashbook: v ?? "" }))} options={cashbookOptions} placeholder="Cashbook…" size="md" clearable />
        </div>
        <div>
          <label className={labelClass}>Reference</label>
          <input value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} className={inputClass} placeholder="e.g. M-Pesa ref, EFT reference…" />
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <input value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} className={inputClass} />
        </div>
      </div>
    </Modal>
  );
}

// What this advocate still owes Pink House for costs paid on an owner's behalf (a "sale_owner_expense"
// PaymentVoucher) — and a running history of what's already been remitted to recover it. Owner/broker/
// agency-commission payouts straight from trust are handled on their own pages (Owner Statements, Broker
// Commissions, Agency Commissions) — this page is single-purpose, not a general advocate-trust ledger.
const SaleAdvocateRemittances = () => {
  const T              = useTerms("saleAdvocate", "saleAdvocates");
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;

  const [advocateId, setAdvocateId] = useTabState("/sale/advocate-remittances:advocate", "");
  const [pageSize] = useState(PAGE_SIZE);
  const [rechargePage, setRechargePage] = useTabState("/sale/advocate-remittances:rechargePage", 1);
  const [remitTarget, setRemitTarget] = useState(null);
  const [remitSaving, setRemitSaving] = useState(false);

  const { data: advocatesData } = useQuery({
    queryKey: ["sale-advocates-ref", biz],
    queryFn:  () => saleApi.listAdvocates({ business: biz, status: "active", limit: 500 }),
    enabled:  !!biz,
    staleTime: 60_000,
  });
  const advocateOptions = useMemo(
    () => (advocatesData?.data ?? []).map((a) => ({ value: a._id, label: a.firm ? `${a.fullName} (${a.firm})` : a.fullName })),
    [advocatesData]
  );
  // An advocate-scoped login only ever gets back their own single record (listAdvocates scopes it
  // server-side) — there's nothing to "choose", so auto-select it and show their firm as a plain label
  // instead of a dropdown they'd otherwise have to click every visit just to see their own remittances.
  useEffect(() => {
    if (advocateOptions.length === 1 && !advocateId) setAdvocateId(advocateOptions[0].value);
  }, [advocateOptions, advocateId, setAdvocateId]);

  const { data: cashbookAccounts } = useQuery({
    queryKey: ["sale-cashbook-accounts", biz],
    queryFn:  () => saleApi.listCashbookAccounts({ business: biz }),
    enabled:  !!biz,
    staleTime: 60_000,
  });
  const cashbookOptions = useMemo(() => (cashbookAccounts ?? []).map((a) => ({ value: a._id, label: a.name })), [cashbookAccounts]);

  const { data: outstandingData, isLoading: loadingOutstanding, isFetching: fetchingOutstanding } = useQuery({
    queryKey: ["sale-outstanding-recharges", biz, advocateId],
    queryFn:  () => saleApi.listOutstandingRecharges({ business: biz, advocate: advocateId }),
    enabled:  !!biz && !!advocateId,
    staleTime: 15_000,
  });
  const outstandingRecharges = outstandingData?.data ?? [];

  const { data: rechargeRemittancesData, isLoading: loadingRechargeList, isFetching: fetchingRechargeList } = useQuery({
    queryKey: ["sale-recharge-remittances", biz, advocateId, rechargePage, pageSize],
    queryFn:  () => saleApi.listRechargeRemittances({ business: biz, advocate: advocateId, page: rechargePage, limit: pageSize }),
    enabled:  !!biz && !!advocateId,
    staleTime: 15_000,
  });
  const rechargeRemittances = rechargeRemittancesData?.data ?? [];
  const rechargeTotal       = rechargeRemittancesData?.total ?? 0;
  const rechargeTotalPages  = Math.max(1, Math.ceil(rechargeTotal / pageSize));

  const invalidateRecharge = () => {
    queryClient.invalidateQueries({ queryKey: ["sale-outstanding-recharges", biz, advocateId] });
    queryClient.invalidateQueries({ queryKey: ["sale-recharge-remittances", biz, advocateId] });
  };

  const handleRemit = async (remitForm) => {
    const amount = Number(remitForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.warning("Enter an amount greater than 0");
    setRemitSaving(true);
    try {
      await saleApi.createRechargeRemittance({
        business: biz, advocate: advocateId, owner: remitTarget.owner?._id,
        allocations: [{ voucher: remitTarget.voucherId, amount }],
        date: remitForm.date, cashbook: remitForm.cashbook || undefined,
        reference: remitForm.reference, notes: remitForm.notes,
      });
      invalidateRecharge();
      setRemitTarget(null);
      toast.success("Recharge remittance recorded");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record recharge remittance");
    } finally {
      setRemitSaving(false);
    }
  };

  return (
    <PropertySaleShell>
      <SaleFilterBar
        trailing={
          <button type="button" onClick={invalidateRecharge} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt size={8} className={(fetchingOutstanding || fetchingRechargeList) ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        {advocateOptions.length === 1 ? (
          <span className="inline-flex h-7 items-center border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700">
            {advocateOptions[0].label}
          </span>
        ) : (
          <AppSelect
            value={advocateId}
            onChange={(v) => { setAdvocateId(v ?? ""); setRechargePage(1); }}
            options={advocateOptions}
            placeholder={`Choose a ${T.saleAdvocate.toLowerCase()}…`}
            clearable
            size="sm"
          />
        )}
      </SaleFilterBar>

      {!advocateId ? (
        <div className="flex flex-1 items-center justify-center border border-slate-200 bg-white text-sm text-slate-400">
          Choose a {T.saleAdvocate.toLowerCase()} to see their rechargeable expenses.
        </div>
      ) : (
        <>
          {/* Outstanding recoverable-expense vouchers — what this advocate still owes Pink House */}
          <div className="flex min-h-0 flex-[2] flex-col border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">
              Outstanding — not yet recovered
            </div>
            <MilikTable
              columns={outstandingColumns}
              rows={outstandingRecharges}
              rowKey="voucherId"
              loading={loadingOutstanding}
              empty="Nothing outstanding — every recoverable expense has been remitted."
              minWidth={640}
              renderRow={renderOutstandingRow}
              renderActions={(row) => (
                <button type="button" onClick={() => setRemitTarget(row)} title="Remit this recharge" className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">
                  <FaMoneyCheckAlt size={9} /> Remit
                </button>
              )}
            />
          </div>

          {/* Past recharge remittances */}
          <div className="flex min-h-0 flex-[3] flex-col border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400">
              Recharge Remittances
            </div>
            <MilikTable
              columns={rechargeRemittanceColumns}
              rows={rechargeRemittances}
              rowKey="_id"
              loading={loadingRechargeList}
              empty="No recharge remittances recorded yet."
              minWidth={640}
              renderRow={renderRechargeRemittanceRow}
            />
            <PaginationBar page={rechargePage} pages={rechargeTotalPages} pageSize={pageSize} onPageChange={setRechargePage} loading={fetchingRechargeList} />
          </div>
        </>
      )}

      {remitTarget && (
        <RemitVoucherModal
          voucher={remitTarget}
          cashbookOptions={cashbookOptions}
          saving={remitSaving}
          onClose={() => setRemitTarget(null)}
          onSubmit={handleRemit}
        />
      )}
    </PropertySaleShell>
  );
};

export default SaleAdvocateRemittances;
