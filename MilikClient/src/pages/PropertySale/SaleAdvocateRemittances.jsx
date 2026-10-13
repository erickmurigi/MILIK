import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaPlus, FaRedoAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import PaginationBar from "../../components/PaginationBar";
import { saleApi, fmtKES, todayISO } from "../../services/propertySaleApi";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";
import MilikTable from "../../components/common/MilikTable";
import { inputClass, labelClass } from "../../utils/formStyles";
import { useTerms } from "../../hooks/useTerm";

const PAGE_SIZE = 50;

const blankForm = { amount: "", date: todayISO(), cashbook: "", reference: "", notes: "" };

const remittanceColumns = [
  { label: "Remittance No." }, { label: "Date" }, { label: "Amount", align: "right" },
  { label: "Cashbook" }, { label: "Reference" },
];

const renderRemittanceRow = (row) => (
  <>
    <td className="px-3 py-1.5 border-r border-gray-100 font-mono font-black text-[#0B3B2E]">{row.remittanceNumber}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.date ? new Date(row.date).toLocaleDateString() : "—"}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-black text-slate-700 tabular-nums">{fmtKES(row.amount)}</td>
    <td className="px-3 py-1.5 border-r border-gray-100 text-slate-600">{row.cashbook?.name || "—"}</td>
    <td className="px-3 py-1.5 text-slate-600">{row.reference || "—"}</td>
  </>
);

// This page is deliberately simpler than the Owner Statement workspace: no draft/approve lifecycle —
// just an outstanding-balance readout and a running list of remittances recorded against it.
const SaleAdvocateRemittances = () => {
  const T              = useTerms("saleAdvocate", "saleAdvocates");
  const queryClient    = useQueryClient();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;

  const [advocateId, setAdvocateId] = useTabState("/sale/advocate-remittances:advocate", "");
  const [page,     setPage]     = useTabState("/sale/advocate-remittances:page", 1);
  const [pageSize] = useState(PAGE_SIZE);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);

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

  const { data: cashbookAccounts } = useQuery({
    queryKey: ["sale-cashbook-accounts", biz],
    queryFn:  () => saleApi.listCashbookAccounts({ business: biz }),
    enabled:  !!biz,
    staleTime: 60_000,
  });
  const cashbookOptions = useMemo(() => (cashbookAccounts ?? []).map((a) => ({ value: a._id, label: a.name })), [cashbookAccounts]);

  const { data: balance, isFetching: loadingBalance } = useQuery({
    queryKey: ["sale-advocate-trust-balance", biz, advocateId],
    queryFn:  () => saleApi.getAdvocateTrustBalance(advocateId),
    enabled:  !!biz && !!advocateId,
    staleTime: 10_000,
  });

  const { data: remittancesData, isLoading: loading, isFetching } = useQuery({
    queryKey: ["sale-advocate-remittances", biz, advocateId, page, pageSize],
    queryFn:  () => saleApi.listAdvocateRemittances({ business: biz, advocate: advocateId, page, limit: pageSize }),
    enabled:  !!biz && !!advocateId,
    staleTime: 15_000,
  });
  const remittances = remittancesData?.data ?? [];
  const total        = remittancesData?.total ?? 0;
  const totalPages   = Math.max(1, Math.ceil(total / pageSize));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["sale-advocate-trust-balance", biz, advocateId] });
    queryClient.invalidateQueries({ queryKey: ["sale-advocate-remittances", biz, advocateId] });
  };

  const handleSubmit = async () => {
    if (!advocateId) return toast.warning(`Choose a ${T.saleAdvocate.toLowerCase()} first`);
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.warning("Enter an amount greater than 0");
    setSaving(true);
    try {
      await saleApi.createAdvocateRemittance({
        business: biz, advocate: advocateId, amount,
        date: form.date, cashbook: form.cashbook || undefined,
        reference: form.reference, notes: form.notes,
      });
      invalidate();
      setForm(blankForm);
      toast.success("Remittance recorded");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record remittance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={<span className="shrink-0 font-mono text-[10px] font-black text-slate-500">Trust Remittances</span>}
        trailing={
          <button type="button" onClick={invalidate} className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt size={8} className={isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        <AppSelect
          value={advocateId}
          onChange={(v) => { setAdvocateId(v ?? ""); setPage(1); }}
          options={advocateOptions}
          placeholder={`Choose a ${T.saleAdvocate.toLowerCase()}…`}
          clearable
          size="sm"
        />
      </SaleFilterBar>

      {!advocateId ? (
        <div className="flex flex-1 items-center justify-center border border-slate-200 bg-white text-sm text-slate-400">
          Choose a {T.saleAdvocate.toLowerCase()} to see their trust balance and remittances.
        </div>
      ) : (
        <>
          {/* Trust balance readout */}
          <div className="grid grid-cols-3 gap-3 border border-slate-200 bg-white p-3 shadow-sm">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Collected (Trust)</div>
              <div className="font-mono text-lg font-black text-slate-800">{loadingBalance ? "…" : fmtKES(balance?.collected ?? 0)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Remitted</div>
              <div className="font-mono text-lg font-black text-slate-800">{loadingBalance ? "…" : fmtKES(balance?.remitted ?? 0)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Outstanding</div>
              <div className="font-mono text-lg font-black text-[#0B3B2E]">{loadingBalance ? "…" : fmtKES(balance?.outstanding ?? 0)}</div>
            </div>
          </div>

          {/* Record a remittance */}
          <div className="grid gap-3 border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-5">
            <div>
              <label className={labelClass}>Amount</label>
              <input type="number" min="0" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} className={inputClass} />
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
              <input value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} className={inputClass} />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={handleSubmit} disabled={saving} className="inline-flex h-8 w-full items-center justify-center gap-1 bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                <FaPlus size={8} /> {saving ? "Saving…" : "Record Remittance"}
              </button>
            </div>
          </div>

          {/* Past remittances */}
          <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white shadow-sm">
            <MilikTable
              columns={remittanceColumns}
              rows={remittances}
              rowKey="_id"
              loading={loading}
              empty="No remittances recorded yet."
              minWidth={640}
              renderRow={renderRemittanceRow}
            />
            <PaginationBar page={page} pages={totalPages} pageSize={pageSize} onPageChange={setPage} loading={isFetching} />
          </div>
        </>
      )}
    </PropertySaleShell>
  );
};

export default SaleAdvocateRemittances;
