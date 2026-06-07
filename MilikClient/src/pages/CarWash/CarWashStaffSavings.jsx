import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import {
  FaCalendarCheck,
  FaChevronDown,
  FaChevronUp,
  FaPiggyBank,
  FaRedoAlt,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

// Backend returns: { staffId, staffName, daily, disbursed, balance }
const ic  = "h-7 border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const icc = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const lc  = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const localISO = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const monthStart = () => { const n = new Date(); return localISO(new Date(n.getFullYear(), n.getMonth(), 1)); };
const todayISO  = () => localISO(new Date());

const typePill = (type) =>
  type === "disbursement"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";

const DETAIL_LIMIT = 30;

const CarWashStaffSavings = () => {
  const currentCompany = useSelector(selectCurrentCompany);

  // ── Balances ────────────────────────────────────────────────────────────────
  const [balances,        setBalances]        = useState([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [savingsEnabled,  setSavingsEnabled]  = useState(true);

  // ── Detail panel — selectedStaff shape: { staffId, staffName, balance } ────
  const [selectedStaff,  setSelectedStaff]  = useState(null);
  const [records,        setRecords]        = useState([]);
  const [recordsTotal,   setRecordsTotal]   = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [detailFrom,     setDetailFrom]     = useState(monthStart());
  const [detailTo,       setDetailTo]       = useState(todayISO());
  const [detailPage,     setDetailPage]     = useState(1);
  const detailRef  = useRef(null);
  const prevStaffId = useRef(null);

  // ── Disbursement modal ──────────────────────────────────────────────────────
  const [cashbooks,     setCashbooks]     = useState([]);
  const [showDisburse,  setShowDisburse]  = useState(false);
  const [disburseStaff, setDisburseStaff] = useState(null);
  const [dForm,         setDForm]         = useState({ amount: "", cashbookAccount: "", notes: "" });
  const [disbursing,    setDisbursing]    = useState(false);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [resetting,  setResetting]  = useState(false);

  // ── Data loaders ────────────────────────────────────────────────────────────
  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const [balRes, settingsRes, cbRes] = await Promise.allSettled([
        carWashApi.listSavingsBalances(),
        carWashApi.getCarWashSettings(),
        currentCompany?._id
          ? carWashApi.listChartOfAccounts({ type: "asset", moduleScope: "carwash" })
          : Promise.resolve([]),
      ]);
      if (balRes.status === "fulfilled")      setBalances(balRes.value?.balances || []);
      if (settingsRes.status === "fulfilled") setSavingsEnabled(settingsRes.value?.savingsEnabled !== false);
      if (cbRes.status === "fulfilled") {
        const list = Array.isArray(cbRes.value) ? cbRes.value : normalizeListPayload(cbRes.value, "accounts");
        setCashbooks(list);
      }
    } finally {
      setBalancesLoading(false);
    }
  }, [currentCompany?._id]);

  const loadRecords = useCallback(async (staffId, from, to, page) => {
    setRecordsLoading(true);
    try {
      const res = await carWashApi.listSavings({ staff: staffId, dateFrom: from, dateTo: to, page, limit: DETAIL_LIMIT });
      setRecords(normalizeListPayload(res, "records"));
      setRecordsTotal(res?.pagination?.total ?? 0);
    } catch {
      setRecords([]);
      setRecordsTotal(0);
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  useEffect(() => {
    if (!selectedStaff) return;
    loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
  }, [selectedStaff, detailFrom, detailTo, detailPage, loadRecords]);

  // Scroll detail panel into view on first open
  useEffect(() => {
    if (selectedStaff && selectedStaff.staffId !== prevStaffId.current) {
      setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
    prevStaffId.current = selectedStaff?.staffId ?? null;
  }, [selectedStaff]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleToggleStaff = (b) => {
    if (selectedStaff?.staffId === b.staffId) {
      setSelectedStaff(null);
    } else {
      setSelectedStaff(b);
      setDetailPage(1);
    }
  };

  const handleDetailDateChange = (field, val) => {
    if (field === "from") setDetailFrom(val); else setDetailTo(val);
    setDetailPage(1);
  };

  const processToday = async () => {
    setProcessing(true);
    try {
      const r = await carWashApi.processDailySavings();
      toast.success(`Daily savings: ${r?.posted ?? 0} posted, ${r?.skipped ?? 0} already done`);
      loadBalances();
      if (selectedStaff) loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to process daily savings");
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Delete ALL savings records for this business? This cannot be undone.")) return;
    setResetting(true);
    try {
      const r = await carWashApi.resetSavings();
      toast.success(`Deleted ${r?.deleted ?? 0} savings records`);
      setBalances([]);
      setSelectedStaff(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const openDisburse = (b) => {
    const preferred = cashbooks.find((cb) =>
      /cash|hand|safe/.test(`${cb?.name || ""} ${cb?.code || ""}`.toLowerCase())
    )?._id ?? cashbooks[0]?._id ?? "";
    setDisburseStaff(b);
    setDForm({ amount: String(b.balance), cashbookAccount: preferred, notes: "" });
    setShowDisburse(true);
  };

  const saveDisbursement = async (e) => {
    e.preventDefault();
    if (!disburseStaff || !dForm.amount || !dForm.cashbookAccount) return;
    setDisbursing(true);
    try {
      await carWashApi.createSavingsPayout({
        staff:           disburseStaff.staffId,   // backend reads req.body.staff
        cashbookAccount: dForm.cashbookAccount,
        amount:          Number(dForm.amount),
        notes:           dForm.notes,
      });
      toast.success(`Savings disbursed to ${disburseStaff.staffName}`);
      setShowDisburse(false);
      loadBalances();
      if (selectedStaff?.staffId === disburseStaff.staffId) {
        loadRecords(selectedStaff.staffId, detailFrom, detailTo, detailPage);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Disbursement failed");
    } finally {
      setDisbursing(false);
    }
  };

  const totalPages = Math.max(Math.ceil(recordsTotal / DETAIL_LIMIT), 1);

  return (
    <CarWashShell
      title="Staff Savings"
      action={
        <>
          <button
            type="button"
            onClick={loadBalances}
            className="inline-flex h-7 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} /> Refresh
          </button>
          {savingsEnabled && (
            <button
              type="button"
              onClick={processToday}
              disabled={processing}
              className="inline-flex h-7 items-center gap-1.5 bg-[#C8511A] px-3 text-xs font-bold text-white hover:bg-[#b04616] disabled:opacity-50"
            >
              <FaCalendarCheck size={9} /> {processing ? "Processing…" : "Process Today"}
            </button>
          )}
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* ── Staff Balances Table ──────────────────────────────────────────── */}
        <div className="border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
            <h2 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">
              <FaPiggyBank size={11} /> Staff Savings Balances
            </h2>
            <span className="text-[10px] text-slate-400">{balances.length} staff</span>
          </div>

          {!savingsEnabled && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700">
              Savings are disabled. Enable them in Car Wash Settings to resume daily deductions.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Total Saved</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Disbursed</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Balance</th>
                  <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {balancesLoading ? (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">Loading…</td></tr>
                ) : balances.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
                      No savings data yet. Click <strong>Process Today</strong> to begin.
                    </td>
                  </tr>
                ) : balances.map((b) => {
                  const isOpen = selectedStaff?.staffId === b.staffId;
                  return (
                    <tr
                      key={b.staffId}
                      className={`border-b border-slate-200 transition-colors ${isOpen ? "bg-[#EDF5F1]" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-2 py-1 font-extrabold text-slate-900">{b.staffName}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-[#C8511A]">
                        {formatMoney(b.daily)}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-emerald-600">
                        {formatMoney(b.disbursed)}
                      </td>
                      <td className="px-2 py-1 text-right font-extrabold tabular-nums text-slate-900">
                        {formatMoney(b.balance)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {b.balance > 0 && (
                            <button
                              type="button"
                              onClick={() => openDisburse(b)}
                              className="border border-[#C8511A] px-2 py-0.5 text-[11px] font-bold text-[#C8511A] transition-colors hover:bg-[#C8511A] hover:text-white"
                            >
                              Pay Out
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleToggleStaff(b)}
                            className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-bold transition-colors ${
                              isOpen
                                ? "border-[#0B3B2E] bg-[#0B3B2E] text-white"
                                : "border-slate-300 text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                            }`}
                          >
                            {isOpen ? <FaChevronUp size={8} /> : <FaChevronDown size={8} />}
                            {isOpen ? "Hide" : "Details"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50 px-4 py-1.5">
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-50"
            >
              <FaTrash size={8} />
              {resetting ? "Resetting…" : "Reset all savings data"}
            </button>
          </div>
        </div>

        {/* ── Detail Panel ─────────────────────────────────────────────────── */}
        {selectedStaff && (
          <div ref={detailRef} className="mt-3 border border-slate-200 bg-white shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 bg-[#0B3B2E] px-3 py-2.5">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Savings History</p>
                <p className="text-sm font-extrabold text-white">{selectedStaff.staffName}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Balance</p>
                  <p className="text-base font-black text-white">{formatMoney(selectedStaff.balance)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStaff(null)}
                  className="p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <FaTimes size={12} />
                </button>
              </div>
            </div>

            {/* Date filter bar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">From</span>
              <input
                type="date"
                className={ic}
                value={detailFrom}
                onChange={(e) => handleDetailDateChange("from", e.target.value)}
              />
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">To</span>
              <input
                type="date"
                className={ic}
                value={detailTo}
                onChange={(e) => handleDetailDateChange("to", e.target.value)}
              />
              <span className="ml-1 text-[10px] text-slate-400">
                {recordsTotal} record{recordsTotal !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Records table */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-xs">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Savings Date</th>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
                    <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Reference / Notes</th>
                    <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Recorded On</th>
                  </tr>
                </thead>
                <tbody>
                  {recordsLoading ? (
                    <tr><td colSpan={5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">Loading…</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No records in this date range.</td></tr>
                  ) : records.map((r) => (
                    <tr key={r._id} className="border-b border-slate-200 hover:bg-slate-50">
                      <td className="px-2 py-1 font-semibold text-slate-800">
                        {r.savingsDate ? fmtDate(r.savingsDate) : "—"}
                      </td>
                      <td className="px-2 py-1">
                        <span className={`border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider ${typePill(r.type)}`}>
                          {r.type}
                        </span>
                      </td>
                      <td className={`px-2 py-1 text-right font-extrabold tabular-nums ${r.type === "disbursement" ? "text-emerald-600" : "text-[#C8511A]"}`}>
                        {r.type === "disbursement" ? "−" : "+"}{formatMoney(r.amount)}
                      </td>
                      <td className="max-w-xs truncate px-2 py-1 text-slate-600">
                        {r.savingsPayoutNumber || r.notes || "—"}
                      </td>
                      <td className="px-2 py-1 text-slate-400">{fmtDate(r.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2">
                <span className="text-[10px] text-slate-500">Page {detailPage} of {totalPages}</span>
                <div className="flex gap-1">
                  <button
                    disabled={detailPage <= 1}
                    onClick={() => setDetailPage((p) => p - 1)}
                    className="h-6 border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ← Prev
                  </button>
                  <button
                    disabled={detailPage >= totalPages}
                    onClick={() => setDetailPage((p) => p + 1)}
                    className="h-6 border border-slate-200 px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Pay Out Modal ─────────────────────────────────────────────────────── */}
      {showDisburse && disburseStaff && (
        <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/40 px-4 py-8 backdrop-blur-[2px] sm:items-center">
          <form
            onSubmit={saveDisbursement}
            className="w-full max-w-md border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-3 text-white">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/60">Pay Out Savings</p>
                <h2 className="text-sm font-extrabold">{disburseStaff.staffName}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowDisburse(false)}
                className="p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <FaTimes size={13} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-2.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#0B3B2E]/60">Available Balance</p>
                <p className="mt-0.5 text-2xl font-black text-[#0B3B2E]">{formatMoney(disburseStaff.balance)}</p>
              </div>

              <div>
                <label className={lc}>Amount to Disburse (KES) *</label>
                <input
                  type="number" min={1} max={disburseStaff.balance} step="any" required
                  className={icc}
                  value={dForm.amount}
                  onChange={(e) => setDForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>

              <div>
                <label className={lc}>Cashbook / Account *</label>
                <select
                  required className={icc}
                  value={dForm.cashbookAccount}
                  onChange={(e) => setDForm((p) => ({ ...p, cashbookAccount: e.target.value }))}
                >
                  <option value="">Select cashbook…</option>
                  {cashbooks.map((cb) => (
                    <option key={cb._id} value={cb._id}>
                      {cb.name}{cb.code ? ` — ${cb.code}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={lc}>Notes (optional)</label>
                <input
                  type="text" className={icc}
                  placeholder="e.g. Annual savings payout June 2026"
                  value={dForm.notes}
                  onChange={(e) => setDForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowDisburse(false)}
                className="h-8 border border-slate-300 px-4 text-xs font-bold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit" disabled={disbursing}
                className="h-8 bg-[#0B3B2E] px-5 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
              >
                {disbursing ? "Processing…" : `Disburse ${dForm.amount ? formatMoney(Number(dForm.amount)) : ""}`}
              </button>
            </div>
          </form>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashStaffSavings;
