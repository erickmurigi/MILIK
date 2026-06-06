import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaCalendarCheck, FaPiggyBank, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const ic  = "h-7 w-full border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const icc = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const lc  = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const getMonthBounds = () => {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
};

const emptyFilters = () => {
  const { from, to } = getMonthBounds();
  return { staff: "", type: "", dateFrom: from, dateTo: to };
};

const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const PAGE = 50;

const CarWashStaffSavings = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const [records, setRecords]   = useState([]);
  const [staff, setStaff]       = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [filters, setFilters]   = useState(emptyFilters);
  const [applied, setApplied]   = useState(emptyFilters);
  const [processing, setProcessing] = useState(false);
  const [page, setPage]         = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [showModal, setShowModal] = useState(false);
  const [disburseStaff, setDisburseStaff] = useState(null);
  const [disburseForm, setDisburseForm]   = useState({ amount: "", cashbookAccount: "", notes: "" });
  const [disbursing, setDisbursing]       = useState(false);

  // Staff and cashbooks are static — load once
  const loadStatic = useCallback(async () => {
    if (staff.length && cashbooks.length) return;
    try {
      const [staffPayload, cbPayload] = await Promise.all([
        carWashApi.listStaff({ active: true }),
        currentCompany?._id
          ? carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" })
          : Promise.resolve([]),
      ]);
      setStaff(normalizeListPayload(staffPayload, "staff"));
      setCashbooks(Array.isArray(cbPayload) ? cbPayload : []);
    } catch { /* non-critical */ }
  }, [currentCompany?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listSavings({
        staff:    applied.staff    || undefined,
        type:     applied.type     || undefined,
        dateFrom: applied.dateFrom || undefined,
        dateTo:   applied.dateTo   || undefined,
        page,
        limit: PAGE,
      });
      setRecords(normalizeListPayload(payload, "records"));
      setPagination(payload?.pagination || { page, total: payload?.total || 0, pages: 1 });
    } catch {
      toast.error("Failed to load savings records");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { loadStatic(); }, [loadStatic]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const processToday = async () => {
    setProcessing(true);
    try {
      const result = await carWashApi.processDailySavings();
      toast.success(`Daily savings: ${result?.posted ?? 0} posted, ${result?.skipped ?? 0} already done`);
      loadRecords();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to process daily savings");
    } finally {
      setProcessing(false);
    }
  };

  // Balance summary from current page (approximate — wallet gives precise)
  const balanceByStaff = useMemo(() => {
    const map = new Map();
    for (const rec of records) {
      const id = String(rec.staff?._id || rec.staff || "");
      if (!id) continue;
      const cur = map.get(id) || { name: rec.staff?.name || "Staff", daily: 0, disbursed: 0 };
      if (rec.type === "daily")        cur.daily     += Number(rec.amount || 0);
      if (rec.type === "disbursement") cur.disbursed += Number(rec.amount || 0);
      map.set(id, cur);
    }
    return map;
  }, [records]);

  const openDisburse = async (staffMember) => {
    try {
      const wallet  = await carWashApi.getStaffWallet(staffMember._id);
      const balance = wallet?.savings?.balance ?? 0;
      const preferred = cashbooks.find((cb) => /cash|hand|safe/.test(`${cb?.name || ""} ${cb?.code || ""}`.toLowerCase()))?._id || cashbooks[0]?._id || "";
      setDisburseStaff({ ...staffMember, balance });
      setDisburseForm({ amount: String(balance), cashbookAccount: preferred, notes: "" });
      setShowModal(true);
    } catch {
      toast.error("Failed to load savings balance");
    }
  };

  const saveDisbursement = async (e) => {
    e.preventDefault();
    setDisbursing(true);
    try {
      await carWashApi.createSavingsPayout({
        staff:            disburseStaff._id,
        amount:           Number(disburseForm.amount),
        cashbookAccount:  disburseForm.cashbookAccount,
        notes:            disburseForm.notes,
      });
      setShowModal(false);
      loadRecords();
      toast.success(`Savings payout recorded for ${disburseStaff.name}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Payout failed");
    } finally {
      setDisbursing(false);
    }
  };

  const typeTag = (type) => type === "disbursement"
    ? <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Paid Out</span>
    : <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-700">Daily</span>;

  const applyFilters  = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const resetFilters  = () => { const d = emptyFilters(); setFilters(d); setPage(1); setApplied(d); };

  return (
    <CarWashShell
      title="Staff Savings"
      action={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={loadRecords}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={processToday}
            disabled={processing}
            className="inline-flex h-7 items-center gap-1 bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"
            title="Post today's standing order savings for all active staff"
          >
            <FaCalendarCheck size={9} />
            {processing ? "Processing…" : "Process Today"}
          </button>
        </div>
      }
    >
      {/* Balance cards — approximate from current page */}
      {balanceByStaff.size > 0 && (
        <div className="mt-0.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {[...balanceByStaff.entries()].map(([id, data]) => {
            const balance     = Math.max(0, data.daily - data.disbursed); // FIX: was data.accrued
            const staffMember = staff.find((s) => s._id === id);
            return (
              <div key={id} className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2 shadow-sm text-xs">
                <div>
                  <p className="font-extrabold text-slate-900">{data.name}</p>
                  <p className="text-slate-500">Saved: {formatMoney(data.daily)}</p>
                  <p className={`font-bold ${balance > 0 ? "text-amber-700" : "text-slate-400"}`}>
                    Balance: {formatMoney(balance)}
                  </p>
                </div>
                {balance > 0 && staffMember && (
                  <button
                    type="button"
                    onClick={() => openDisburse(staffMember)}
                    className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
                  >
                    <FaPiggyBank size={8} /> Pay Out
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter bar */}
      <form onSubmit={applyFilters} className="mt-1 flex flex-wrap items-end gap-1.5 border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Staff</label>
          <select className={`${ic} min-w-[130px]`} value={filters.staff} onChange={(e) => setFilters((p) => ({ ...p, staff: e.target.value }))}>
            <option value="">All staff</option>
            {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Type</label>
          <select className={`${ic} min-w-[140px]`} value={filters.type} onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}>
            <option value="">All types</option>
            <option value="daily">Daily Standing Order</option>
            <option value="disbursement">Disbursements</option>
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">From</label>
          <input type="date" className={ic} value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">To</label>
          <input type="date" className={ic} value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
        </div>
        <button type="submit" className="inline-flex h-7 items-center gap-1.5 bg-[#FF8C00] px-3 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch size={9} /> Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt size={9} /> Reset
        </button>
      </form>

      {/* Table */}
      <div className="mt-1 flex flex-1 min-h-0 flex-col border border-slate-200 bg-white shadow-sm">
        <div className="flex-shrink-0 flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          <span>Showing <strong className="text-[#0B3B2E]">{records.length}</strong>/{pagination.total}</span>
          <span>Page <strong className="text-[#0B3B2E]">{pagination.page}</strong>/{pagination.pages}</span>
          {loading && <span className="text-slate-400">Loading…</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Date</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Staff</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Type</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Savings Date / Ref</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">Amount</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Notes</th>
              </tr>
            </thead>
            <tbody>
              {records.length ? records.map((rec) => (
                <tr key={rec._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">{fmtDate(rec.date)}</td>
                  <td className="px-3 py-2 font-extrabold text-slate-900">{rec.staff?.name || "—"}</td>
                  <td className="px-3 py-2">{typeTag(rec.type)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {rec.type === "daily" ? fmtDate(rec.savingsDate) : (rec.savingsPayoutNumber || "—")}
                  </td>
                  <td className={`px-3 py-2 text-right font-extrabold tabular-nums ${rec.type === "disbursement" ? "text-emerald-700" : "text-amber-700"}`}>
                    {rec.type === "disbursement" ? "−" : "+"}{formatMoney(rec.amount)}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{rec.notes || "—"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-3 py-12 text-center text-xs font-semibold text-slate-400">
                    No savings records found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — matches Jobs pattern */}
        <div className="flex-shrink-0 flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span className="font-semibold normal-case text-slate-500">Per page: {PAGE}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1 || loading}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(p + 1, pagination.pages))}
              disabled={page >= pagination.pages || loading}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {showModal && disburseStaff && (
        <Modal
          title={`Savings Payout — ${disburseStaff.name}`}
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">Cancel</button>
              <button type="submit" form="savings-disburse-form" disabled={disbursing} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                <FaPiggyBank size={10} /> {disbursing ? "Processing…" : "Confirm Payout"}
              </button>
            </>
          }
        >
          <form id="savings-disburse-form" onSubmit={saveDisbursement} className="space-y-3">
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Available balance: <strong>{formatMoney(disburseStaff.balance)}</strong>
            </div>
            <div>
              <label className={lc}>Amount (Ksh) *</label>
              <input type="number" min="1" max={disburseStaff.balance} step="1" required className={icc} value={disburseForm.amount} onChange={(e) => setDisburseForm((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <label className={lc}>Cashbook *</label>
              <select required className={icc} value={disburseForm.cashbookAccount} onChange={(e) => setDisburseForm((p) => ({ ...p, cashbookAccount: e.target.value }))}>
                <option value="">Select cashbook</option>
                {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} {cb.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lc}>Notes</label>
              <input className={icc} placeholder="Annual savings payout…" value={disburseForm.notes} onChange={(e) => setDisburseForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashStaffSavings;
