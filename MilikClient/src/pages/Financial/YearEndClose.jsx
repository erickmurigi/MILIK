import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaArchive, FaCheckCircle, FaExclamationTriangle, FaLock } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import { selectCurrentCompany } from "../../redux/selectors";
import { getAccountingPeriods, performYearEndClose } from "../../redux/apiCalls";
import { useConfirm } from "../../context/ConfirmContext";

const GRN          = "#0B3B2E";
const CURRENT_YEAR = new Date().getFullYear();

export default function YearEndClose() {
  const company     = useSelector(selectCurrentCompany);
  const { confirm } = useConfirm();

  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [form, setForm]       = useState({ fiscalYear: String(CURRENT_YEAR - 1), periodId: "", narration: "" });

  const loadPeriods = useCallback(async () => {
    if (!company?._id) return;
    try {
      const data = await getAccountingPeriods({ business: company._id });
      setPeriods((Array.isArray(data) ? data : []).filter((p) => p.status === "closed" && !p.yearEndClosed));
    } catch { /* non-critical */ }
  }, [company?._id]);

  useEffect(() => { loadPeriods(); }, [loadPeriods]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const ok = await confirm({
      title:       "Run Year-End Close",
      message:     `This will close all income and expense accounts for FY ${form.fiscalYear} to Retained Earnings and permanently lock the selected period. This cannot be undone. Proceed?`,
      confirmText: "Yes, Run Close",
      isDangerous: true,
    });
    if (!ok) return;

    setLoading(true);
    setResult(null);
    try {
      const data = await performYearEndClose({
        business:   company._id,
        fiscalYear: form.fiscalYear,
        periodId:   form.periodId   || undefined,
        narration:  form.narration  || undefined,
      });
      setResult({ success: true, ...data });
      toast.success(data.message || "Year-end close completed");
      loadPeriods();
    } catch (err) {
      const msg = err?.response?.data?.message || "Year-end close failed";
      setResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
          <FaArchive size={11} style={{ color: GRN }} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
            Year-End Close
          </span>
          <span className="text-[10px] text-slate-400">— Close income &amp; expenses to Retained Earnings</span>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 max-w-2xl">

          {/* Warning */}
          <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3">
            <FaExclamationTriangle className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <div className="text-[11px] font-black text-amber-800">This action is irreversible.</div>
              <p className="mt-1 text-[10px] text-amber-700 leading-relaxed">
                Before running: ensure the trial balance is balanced, all journals are posted, and bank reconciliation is complete.
                The period will be permanently locked — no further entries can be posted to it.
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">Close Parameters</span>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Fiscal Year *</label>
                <AppSelect
                  value={form.fiscalYear}
                  onChange={(v) => setForm((p) => ({ ...p, fiscalYear: v ?? String(CURRENT_YEAR - 1) }))}
                  options={Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i).map((yr) => ({ value: String(yr), label: String(yr) }))}
                  size="md"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  Accounting Period <span className="normal-case font-normal text-slate-400">(optional)</span>
                </label>
                <AppSelect
                  value={form.periodId}
                  onChange={(v) => setForm((p) => ({ ...p, periodId: v ?? "" }))}
                  options={periods.map((p) => ({ value: p._id, label: p.name }))}
                  placeholder="— Select a closed period to lock —"
                  clearable
                  size="md"
                />
                <p className="mt-1 text-[9px] text-slate-400">
                  Only closed periods not yet year-end closed are listed. Selecting one will lock it permanently.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  Narration <span className="normal-case font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.narration}
                  onChange={(e) => setForm((p) => ({ ...p, narration: e.target.value }))}
                  placeholder={`Year-end close ${form.fiscalYear}: net income → Retained Earnings`}
                  className="h-8 w-full border border-slate-200 px-2.5 text-[11px] focus:border-[#0B3B2E] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex h-8 w-full items-center justify-center gap-2 text-[11px] font-bold text-white disabled:opacity-60"
                style={{ backgroundColor: GRN }}
              >
                <FaArchive size={10} />
                {loading ? "Processing…" : `Run Year-End Close · FY ${form.fiscalYear}`}
              </button>
            </form>
          </div>

          {/* Result */}
          {result && (
            <div className={`flex items-start gap-3 border px-4 py-4 ${result.success ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
              {result.success
                ? <FaCheckCircle className="mt-0.5 shrink-0 text-xl text-emerald-600" />
                : <FaExclamationTriangle className="mt-0.5 shrink-0 text-xl text-red-600" />}
              <div className="flex-1">
                <div className={`text-[11px] font-black ${result.success ? "text-emerald-800" : "text-red-800"}`}>
                  {result.success ? "Year-End Close Completed" : "Close Failed"}
                </div>
                <p className="mt-1 text-[10px] text-slate-600">{result.message}</p>
                {result.success && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="border border-emerald-200 bg-white px-3 py-2">
                      <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Net Income / (Loss)</div>
                      <div className="mt-1 font-mono text-[12px] font-black text-slate-800">
                        KES {Number(result.netIncome || 0).toLocaleString("en-KE", { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="border border-emerald-200 bg-white px-3 py-2 flex items-center gap-2">
                      <FaLock className={result.periodLocked ? "text-red-500" : "text-slate-300"} size={12} />
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Period</div>
                        <div className="mt-0.5 text-[10px] font-semibold text-slate-700">
                          {result.periodLocked ? "Locked permanently" : "No period linked"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
