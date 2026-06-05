import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaMoneyBillWave, FaPiggyBank, FaRedoAlt, FaTimes } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const methods    = ["cash", "mpesa", "bank", "card", "other"];

const preferredCashbook = (cashbooks = [], method = "cash") => {
  const h = (cb) => `${cb?.name || ""} ${cb?.code || ""}`.toLowerCase();
  if (method === "mpesa") return cashbooks.find((cb) => /m-?pesa|mpesa/.test(h(cb)))?._id || "";
  if (method === "cash")  return cashbooks.find((cb) => /cash|hand|safe/.test(h(cb)))?._id || "";
  if (method === "bank" || method === "card") return cashbooks.find((cb) => /bank/.test(h(cb)))?._id || "";
  return cashbooks[0]?._id || "";
};

const Modal = ({ title, subtitle, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-3xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs font-semibold text-emerald-50">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>}
    </div>
  </div>
);

const CarWashCommissionPayouts = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const [payouts, setPayouts]           = useState([]);
  const [staff, setStaff]               = useState([]);
  const [cashbooks, setCashbooks]       = useState([]);
  const [payableComms, setPayableComms] = useState([]);
  const [loading, setLoading]           = useState(false);
  const [showModal, setShowModal]       = useState(false);
  const [pendingSavings, setPendingSavings] = useState(0); // savings to be held from this payout
  const [form, setForm] = useState({ staff: "", commissionIds: [], method: "cash", cashbookAccount: "", payoutDate: todayISO(), reference: "", notes: "" });
  const canPay = useCarWashPermission("carwash-commissions", "pay");

  const selectedStaffPayable = useMemo(
    () => payableComms.filter((c) => !form.staff || String(c.staff?._id || c.staff) === String(form.staff)),
    [payableComms, form.staff]
  );
  const commIdSet = useMemo(() => new Set(form.commissionIds), [form.commissionIds]);
  const selectedTotal = useMemo(
    () => selectedStaffPayable.reduce((s, c) => commIdSet.has(c._id) ? s + Number(c.commissionAmount || 0) : s, 0),
    [commIdSet, selectedStaffPayable]
  );

  const load = async () => {
    setLoading(true);
    try {
      const [payoutPayload, staffPayload, cbPayload] = await Promise.all([
        carWashApi.listCommissionPayouts({ limit: 100 }),
        carWashApi.listStaff({ active: true }),
        currentCompany?._id
          ? carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" })
          : Promise.resolve([]),
      ]);
      setPayouts(normalizeListPayload(payoutPayload, "payouts"));
      setStaff(normalizeListPayload(staffPayload, "staff"));
      setCashbooks(Array.isArray(cbPayload) ? cbPayload : []);
    } catch {
      toast.error("Failed to load payouts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [currentCompany?._id]);

  useEffect(() => {
    if (!cashbooks.length || form.cashbookAccount) return;
    setForm((p) => ({ ...p, cashbookAccount: preferredCashbook(cashbooks, p.method) }));
  }, [cashbooks]);

  const openPayout = async () => {
    let rows = [];
    try {
      const payload = await carWashApi.listCommissions({ status: "payable", limit: 200 });
      rows = normalizeListPayload(payload, "commissions");
    } catch {
      toast.error("Failed to load payable commissions");
      return;
    }
    const firstStaff = rows[0]?.staff?._id || "";
    setPayableComms(rows);
    setForm({
      staff: firstStaff,
      commissionIds: rows.filter((c) => String(c.staff?._id || c.staff) === String(firstStaff)).map((c) => c._id),
      method: "cash",
      cashbookAccount: preferredCashbook(cashbooks, "cash"),
      payoutDate: todayISO(),
      reference: "",
      notes: "",
    });
    setPendingSavings(0);
    if (firstStaff) {
      carWashApi.getStaffWallet(firstStaff)
        .then((w) => setPendingSavings(Number(w?.savings?.pendingToHold || 0)))
        .catch(() => {});
    }
    setShowModal(true);
  };

  const setPayoutStaff = async (staffId) => {
    const rows = payableComms.filter((c) => String(c.staff?._id || c.staff) === String(staffId));
    setForm((p) => ({ ...p, staff: staffId, commissionIds: rows.map((c) => c._id) }));
    setPendingSavings(0);
    if (!staffId) return;
    try {
      const wallet = await carWashApi.getStaffWallet(staffId);
      setPendingSavings(Number(wallet?.savings?.pendingToHold || 0));
    } catch { /* best-effort */ }
  };

  const toggleComm = (id) => setForm((p) => ({
    ...p,
    commissionIds: p.commissionIds.includes(id) ? p.commissionIds.filter((x) => x !== id) : [...p.commissionIds, id],
  }));

  const savePayout = async (e) => {
    e.preventDefault();
    try {
      await carWashApi.createCommissionPayout(form);
      setShowModal(false);
      await load();
      toast.success("Commission payout recorded");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payout");
    }
  };

  const totalPaid = useMemo(() => payouts.reduce((s, p) => s + Number(p.amount || 0), 0), [payouts]);

  return (
    <CarWashShell
      title="Commission Payouts"
      action={
        <>
          <button onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {canPay && (
            <button onClick={openPayout} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]">
              <FaMoneyBillWave /> New Payout
            </button>
          )}
        </>
      }
    >
      {/* Summary strip */}
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "Total Payouts", value: payouts.length, color: "slate" },
          { label: "Total Paid Out", value: formatMoney(totalPaid), color: "green" },
        ].map(({ label, value, color }) => (
          <div key={label} className={`border px-4 py-3 bg-white shadow-sm text-xs ${color === "green" ? "border-emerald-200" : "border-slate-200"}`}>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
            <p className={`mt-0.5 text-base font-black ${color === "green" ? "text-emerald-700" : "text-slate-800"}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="min-h-[calc(100vh-18rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Payout No.</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Cashbook</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Commission</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Savings Held</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Net Cash</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
            </tr>
          </thead>
          <tbody>
            {payouts.length ? payouts.map((row) => (
              <tr key={row._id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2 font-extrabold text-slate-900">{row.payoutNumber}</td>
                <td className="px-3 py-2">{row.staff?.name || "—"}</td>
                <td className="px-3 py-2 uppercase">{row.method}</td>
                <td className="px-3 py-2 text-slate-600">{row.cashbookAccount?.code} {row.cashbookAccount?.name}</td>
                <td className="px-3 py-2 text-right font-bold">{formatMoney(row.amount)}</td>
                <td className="px-3 py-2 text-right text-amber-700">
                  {row.savingsHeld > 0 ? <span className="inline-flex items-center gap-1"><FaPiggyBank size={9} />{formatMoney(row.savingsHeld)}</span> : "—"}
                </td>
                <td className="px-3 py-2 text-right font-extrabold text-emerald-700">
                  {formatMoney(row.netCash ?? row.amount)}
                </td>
                <td className="px-3 py-2 text-slate-600">{row.payoutDate ? new Date(row.payoutDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-xs font-semibold text-slate-500">No commission payouts recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <Modal
          title="Pay Staff Commission"
          subtitle="Select the staff member and the commissions to pay out."
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">Cancel</button>
              {canPay && (
                <button type="submit" form="cw-payout-form" disabled={!selectedTotal} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  <FaMoneyBillWave /> Pay {formatMoney(selectedTotal)}
                </button>
              )}
            </>
          }
        >
          <form id="cw-payout-form" onSubmit={savePayout} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Staff *</label>
              <select className={inputClass} value={form.staff} onChange={(e) => setPayoutStaff(e.target.value)} required>
                <option value="">Select staff</option>
                {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Method</label>
              <select className={inputClass} value={form.method} onChange={(e) => setForm((p) => ({ ...p, method: e.target.value, cashbookAccount: preferredCashbook(cashbooks, e.target.value) }))}>
                {methods.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Cashbook *</label>
              <select className={inputClass} value={form.cashbookAccount} onChange={(e) => setForm((p) => ({ ...p, cashbookAccount: e.target.value }))} required>
                <option value="">Select cashbook</option>
                {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} {cb.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Payout Date</label>
              <input type="date" className={inputClass} value={form.payoutDate} onChange={(e) => setForm((p) => ({ ...p, payoutDate: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Reference</label>
              <input className={inputClass} value={form.reference} onChange={(e) => setForm((p) => ({ ...p, reference: e.target.value }))} placeholder="Optional" />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input className={inputClass} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
            </div>
            {/* Savings deduction preview */}
            {selectedTotal > 0 && (
              <div className="sm:col-span-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-1">
                <p className="font-black uppercase tracking-wide text-amber-800">Payout Breakdown</p>
                <div className="flex justify-between">
                  <span className="text-slate-600">Commission total</span>
                  <span className="font-bold">{formatMoney(selectedTotal)}</span>
                </div>
                {pendingSavings > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Savings held ({Math.min(pendingSavings, selectedTotal) === pendingSavings ? "full" : "capped"} deduction)</span>
                    <span className="font-bold">− {formatMoney(Math.min(pendingSavings, selectedTotal))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-amber-200 pt-1">
                  <span className="font-extrabold text-slate-800">Net cash to staff</span>
                  <span className="font-extrabold text-emerald-700">
                    {formatMoney(Math.max(0, selectedTotal - Math.min(pendingSavings, selectedTotal)))}
                  </span>
                </div>
                {pendingSavings === 0 && (
                  <p className="text-[10px] text-slate-400 italic">No pending savings deductions for this staff member.</p>
                )}
              </div>
            )}

            <div className="sm:col-span-2">
              <label className={labelClass}>Payable Commissions</label>
              <div className="max-h-56 overflow-auto rounded border border-slate-200">
                {selectedStaffPayable.length ? selectedStaffPayable.map((c) => (
                  <label key={c._id} className="flex cursor-pointer items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs hover:bg-slate-50">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={commIdSet.has(c._id)} onChange={() => toggleComm(c._id)} className="accent-[#0B3B2E]" />
                      <span>{c.jobNumber || "—"} · {c.serviceName || "—"}</span>
                    </span>
                    <span className="font-extrabold text-slate-900">{formatMoney(c.commissionAmount)}</span>
                  </label>
                )) : (
                  <p className="px-3 py-8 text-center text-xs font-semibold text-slate-500">No payable commissions for this staff member.</p>
                )}
              </div>
              {selectedTotal > 0 && (
                <div className="mt-2 flex items-center justify-between rounded border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-2 text-xs">
                  <span className="font-bold text-slate-600">Selected total</span>
                  <span className="font-black text-[#0B3B2E]">{formatMoney(selectedTotal)}</span>
                </div>
              )}
            </div>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashCommissionPayouts;
