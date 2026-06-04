import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaCalendarCheck, FaPiggyBank, FaRedoAlt, FaSearch, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

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

const CarWashStaffSavings = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const [records, setRecords]   = useState([]);
  const [staff, setStaff]       = useState([]);
  const [cashbooks, setCashbooks] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [filters, setFilters]   = useState({ staff: "", type: "" });
  const [applied, setApplied]   = useState({ staff: "", type: "" });
  const [processing, setProcessing] = useState(false);
  const [page, setPage]         = useState(1);
  const [total, setTotal]       = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [disburseStaff, setDisburseStaff] = useState(null); // { _id, name, balance }
  const [disburseForm, setDisburseForm]   = useState({ amount: "", cashbookAccount: "", notes: "" });
  const [disbursing, setDisbursing]       = useState(false);
  const PAGE = 50;

  const load = async () => {
    setLoading(true);
    try {
      const [recPayload, staffPayload, cbPayload] = await Promise.all([
        carWashApi.listSavings({ staff: applied.staff || undefined, type: applied.type || undefined, page, limit: PAGE }),
        carWashApi.listStaff({ active: true }),
        currentCompany?._id
          ? carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" })
          : Promise.resolve([]),
      ]);
      setRecords(normalizeListPayload(recPayload, "records"));
      setTotal(recPayload?.total || 0);
      setStaff(normalizeListPayload(staffPayload, "staff"));
      setCashbooks(Array.isArray(cbPayload) ? cbPayload : []);
    } catch {
      toast.error("Failed to load savings records");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [applied, page, currentCompany?._id]);

  const processToday = async () => {
    setProcessing(true);
    try {
      const result = await carWashApi.processDailySavings();
      toast.success(`Daily savings: ${result?.posted ?? 0} posted, ${result?.skipped ?? 0} already done`);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to process daily savings");
    } finally {
      setProcessing(false);
    }
  };

  // Aggregate balance per staff from loaded records (approximate — wallet endpoint gives precise)
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
    // Fetch precise balance from wallet endpoint
    try {
      const wallet = await carWashApi.getStaffWallet(staffMember._id);
      const balance = wallet?.savings?.balance ?? 0;
      setDisburseStaff({ ...staffMember, balance });
      setDisburseForm({ amount: String(balance), cashbookAccount: cashbooks[0]?._id || "", notes: "" });
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
        staff: disburseStaff._id,
        amount: Number(disburseForm.amount),
        cashbookAccount: disburseForm.cashbookAccount,
        notes: disburseForm.notes,
      });
      setShowModal(false);
      await load();
      toast.success(`Savings payout recorded for ${disburseStaff.name}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Payout failed");
    } finally {
      setDisbursing(false);
    }
  };

  const typeTag = (type) => type === "disbursement"
    ? <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Paid Out</span>
    : <span className="border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">Daily</span>;

  return (
    <CarWashShell
      title="Staff Savings"
      action={
        <>
          <button onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            onClick={processToday}
            disabled={processing}
            className="inline-flex h-8 items-center gap-1.5 bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-60"
            title="Post today's Ksh 100 savings for all active staff"
          >
            <FaCalendarCheck size={10} />
            {processing ? "Processing…" : "Process Today"}
          </button>
        </>
      }
    >
      {/* Balance summary per staff */}
      {balanceByStaff.size > 0 && (
        <div className="mb-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[...balanceByStaff.entries()].map(([id, data]) => {
            const balance = Math.max(0, data.accrued - data.disbursed);
            const staffMember = staff.find((s) => s._id === id);
            return (
              <div key={id} className="flex items-center justify-between gap-3 border border-slate-200 bg-white px-3 py-2 shadow-sm text-xs">
                <div>
                  <p className="font-extrabold text-slate-900">{data.name}</p>
                  <p className="text-slate-500">Total saved: {formatMoney(data.daily)}</p>
                  <p className={`font-bold ${balance > 0 ? "text-amber-700" : "text-slate-400"}`}>Balance: {formatMoney(balance)}</p>
                </div>
                {balance > 0 && staffMember && (
                  <button
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

      {/* Filters */}
      <form
        onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); }}
        className="mb-2 flex flex-wrap gap-2 border border-slate-200 bg-white p-2 shadow-sm"
      >
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:outline-none" value={filters.staff} onChange={(e) => setFilters((p) => ({ ...p, staff: e.target.value }))}>
          <option value="">All staff</option>
          {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:outline-none" value={filters.type} onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}>
          <option value="">All types</option>
          <option value="daily">Daily Standing Order</option>
          <option value="disbursement">Disbursements (paid out)</option>
        </select>
        <button type="submit" className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch /> Search</button>
        <button type="button" onClick={() => { setFilters({ staff: "", type: "" }); setPage(1); setApplied({ staff: "", type: "" }); }} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt /> Reset</button>
      </form>

      <div className="min-h-[calc(100vh-22rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{records.length}</strong> / {total}</span>
        </div>
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Type</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Savings Date / Ref</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Notes</th>
            </tr>
          </thead>
          <tbody>
            {records.length ? records.map((rec) => (
              <tr key={rec._id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-600">{fmtDate(rec.date)}</td>
                <td className="px-3 py-2 font-extrabold text-slate-900">{rec.staff?.name || "—"}</td>
                <td className="px-3 py-2">{typeTag(rec.type)}</td>
                <td className="px-3 py-2 text-slate-700">
                  {rec.type === "daily"
                    ? (rec.savingsDate ? fmtDate(rec.savingsDate) : "—")
                    : rec.savingsPayoutNumber || "—"}
                </td>
                <td className={`px-3 py-2 text-right font-extrabold ${rec.type === "disbursement" ? "text-emerald-700" : "text-amber-700"}`}>
                  {rec.type === "disbursement" ? "−" : "+"}{formatMoney(rec.amount)}
                </td>
                <td className="px-3 py-2 text-slate-500">{rec.notes || "—"}</td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="px-3 py-12 text-center text-xs font-semibold text-slate-500">No savings records found.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600">
          <span>Rows per page: {PAGE}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45">Previous</button>
            <span>Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={records.length < PAGE} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45">Next</button>
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
              <label className={labelClass}>Amount (Ksh) *</label>
              <input type="number" min="1" max={disburseStaff.balance} step="1" required className={inputClass} value={disburseForm.amount} onChange={(e) => setDisburseForm((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Cashbook *</label>
              <select required className={inputClass} value={disburseForm.cashbookAccount} onChange={(e) => setDisburseForm((p) => ({ ...p, cashbookAccount: e.target.value }))}>
                <option value="">Select cashbook</option>
                {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} {cb.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input className={inputClass} placeholder="Annual savings payout…" value={disburseForm.notes} onChange={(e) => setDisburseForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashStaffSavings;
