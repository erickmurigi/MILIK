import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import { FaMoneyBillWave, FaPiggyBank, FaRedoAlt, FaSearch, FaTimes, FaUndo, FaBan } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const fmtSvc  = (svc, fallback = "—") => svc ? (svc.category ? `${svc.category} — ${svc.name}` : svc.name) : fallback;
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const ic         = "h-7 border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const methods    = ["cash", "mpesa", "bank", "card", "other"];
const PAGE_SIZE  = 30;

const getMonthBounds = () => {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
};

const emptyFilters = () => {
  const { from, to } = getMonthBounds();
  return { staff: "", dateFrom: from, dateTo: to };
};

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
  const [payableComms, setPayableComms] = useState([]);
  const [loading, setLoading]           = useState(false);
  const [page, setPage]                 = useState(1);
  const [pagination, setPagination]     = useState({ page: 1, total: 0, pages: 1 });
  const [filters, setFilters]           = useState(emptyFilters);
  const [applied, setApplied]           = useState(emptyFilters);
  const [showModal, setShowModal]       = useState(false);
  const [refError, setRefError]         = useState(false);
  const [pendingSavings, setPendingSavings]       = useState(0);
  const [pendingDamages, setPendingDamages]       = useState(0);
  const [pendingDamagesList, setPendingDamagesList] = useState([]);
  const [reverseTarget, setReverseTarget]   = useState(null);
  const [reversalNotes, setReversalNotes]   = useState("");
  const [isReversing, setIsReversing]       = useState(false);
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

  const { data: staffRaw } = useQuery({
    queryKey: ["cw-staff-ref"],
    queryFn: () => carWashApi.listStaff({ active: true }),
    staleTime: 5 * 60_000,
    select: (data) => normalizeListPayload(data, "staff"),
  });
  const staff = staffRaw ?? [];

  const { data: cashbooksRaw } = useQuery({
    queryKey: ["cw-payout-cashbooks", currentCompany?._id],
    queryFn: () => carWashApi.listChartOfAccounts({ business: currentCompany._id, type: "asset", moduleScope: "carwash", search: "Cashbooks" }),
    enabled: !!currentCompany?._id,
    staleTime: 5 * 60_000,
    select: (data) => Array.isArray(data) ? data : [],
  });
  const cashbooks = cashbooksRaw ?? [];

  const loadPayouts = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await carWashApi.listCommissionPayouts({
        staff:    applied.staff    || undefined,
        dateFrom: applied.dateFrom || undefined,
        dateTo:   applied.dateTo   || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setPayouts(normalizeListPayload(payload, "payouts"));
      setPagination(payload?.pagination || { page, total: payload?.payouts?.length || 0, pages: 1 });
    } catch {
      toast.error("Failed to load payouts");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { loadPayouts(); }, [loadPayouts]);

  useEffect(() => {
    if (!cashbooks.length || form.cashbookAccount) return;
    setForm((p) => ({ ...p, cashbookAccount: preferredCashbook(cashbooks, p.method) }));
  }, [cashbooks]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const resetFilters = () => { const d = emptyFilters(); setFilters(d); setPage(1); setApplied(d); };

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
    setPendingSavings(0);
    setPendingDamages(0);
    setPendingDamagesList([]);
    setForm({
      staff: firstStaff,
      commissionIds: rows.filter((c) => String(c.staff?._id || c.staff) === String(firstStaff)).map((c) => c._id),
      method: "cash",
      cashbookAccount: preferredCashbook(cashbooks, "cash"),
      payoutDate: todayISO(),
      reference: "",
      notes: "",
    });
    setShowModal(true);
    if (firstStaff) fetchStaffDeductions(firstStaff);
  };

  const fetchStaffDeductions = async (staffId) => {
    setPendingSavings(0);
    setPendingDamages(0);
    setPendingDamagesList([]);
    if (!staffId) return;
    try {
      const [wallet, dmgRes] = await Promise.all([
        carWashApi.getStaffWallet(staffId),
        carWashApi.listDamages({ staff: staffId, status: "pending", limit: 50 }),
      ]);
      setPendingSavings(Number(wallet?.savings?.pending || 0));
      const dmgList = normalizeListPayload(dmgRes, "damages");
      setPendingDamagesList(dmgList);
      setPendingDamages(dmgList.reduce((s, d) => s + Number(d.amount || 0), 0));
    } catch (err) {
      console.error("[Payout] wallet/damages fetch failed:", err?.message);
    }
  };

  const setPayoutStaff = (staffId) => {
    const rows = payableComms.filter((c) => String(c.staff?._id || c.staff) === String(staffId));
    setForm((p) => ({ ...p, staff: staffId, commissionIds: rows.map((c) => c._id) }));
    fetchStaffDeductions(staffId);
  };

  const toggleComm = (id) => setForm((p) => ({
    ...p,
    commissionIds: p.commissionIds.includes(id) ? p.commissionIds.filter((x) => x !== id) : [...p.commissionIds, id],
  }));

  const savePayout = async (e) => {
    e.preventDefault();
    if (form.method === "mpesa" && !form.reference?.trim()) {
      setRefError(true);
      return;
    }
    try {
      await carWashApi.createCommissionPayout(form);
      setShowModal(false);
      loadPayouts();
      toast.success("Commission payout recorded");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to record payout");
    }
  };

  const openReverseModal = (row) => { setReverseTarget(row); setReversalNotes(""); };
  const closeReverseModal = () => { setReverseTarget(null); setReversalNotes(""); };

  const confirmReverse = async () => {
    if (!reverseTarget) return;
    setIsReversing(true);
    try {
      await carWashApi.reverseCommissionPayout(reverseTarget._id, reversalNotes);
      toast.success(`Payout ${reverseTarget.payoutNumber} reversed`);
      closeReverseModal();
      loadPayouts();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Reversal failed");
    } finally {
      setIsReversing(false);
    }
  };

  const savingsDeduction = Math.min(pendingSavings, selectedTotal);
  const damagesDeduction = Math.min(pendingDamages, Math.max(0, selectedTotal - savingsDeduction));
  const netCash          = Math.max(0, selectedTotal - savingsDeduction - damagesDeduction);

  const pageTotal = useMemo(() => payouts.reduce((s, p) => s + Number(p.amount || 0), 0), [payouts]);

  return (
    <CarWashShell
      title="Commission Payouts"
      action={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={loadPayouts}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {canPay && (
            <button
              type="button"
              onClick={openPayout}
              className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#0A3127]"
            >
              <FaMoneyBillWave size={9} /> New Payout
            </button>
          )}
        </div>
      }
    >
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
          <span>Showing <strong className="text-[#0B3B2E]">{payouts.length}</strong>/{pagination.total}</span>
          <span>Page <strong className="text-[#0B3B2E]">{pagination.page}</strong>/{pagination.pages}</span>
          <span>Page Total <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
          {loading && <span className="text-slate-400">Loading…</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Payout No.</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Staff</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Method</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Cashbook</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">Commission</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">Savings Held</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">Net Cash</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Date</th>
                {canPay && <th className="px-3 py-1.5 text-center font-bold uppercase tracking-wide text-slate-500">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {payouts.length ? payouts.map((row) => {
                const reversed = Boolean(row.isReversed);
                return (
                  <tr key={row._id} className={`border-b border-slate-100 ${reversed ? "bg-rose-50/40" : "hover:bg-slate-50"}`}>
                    <td className="px-3 py-2">
                      <span className={`font-extrabold font-mono text-[11px] ${reversed ? "text-rose-400 line-through" : "text-[#0B3B2E]"}`}>{row.payoutNumber}</span>
                      {reversed && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-rose-600">
                          <FaBan size={7} /> Reversed
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2 font-extrabold ${reversed ? "text-slate-400" : "text-slate-900"}`}>{row.staff?.name || "—"}</td>
                    <td className={`px-3 py-2 uppercase ${reversed ? "text-slate-400" : "text-slate-600"}`}>{row.method}</td>
                    <td className={`px-3 py-2 ${reversed ? "text-slate-400" : "text-slate-500"}`}>{row.cashbookAccount?.code} {row.cashbookAccount?.name}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${reversed ? "text-slate-400 line-through" : ""}`}>{formatMoney(row.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.savingsHeld > 0
                        ? <span className={`inline-flex items-center gap-1 ${reversed ? "text-slate-400 line-through" : "text-amber-700"}`}><FaPiggyBank size={9} />{formatMoney(row.savingsHeld)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-extrabold ${reversed ? "text-slate-400 line-through" : "text-emerald-700"}`}>
                      {formatMoney(row.netCash ?? row.amount)}
                    </td>
                    <td className={`px-3 py-2 ${reversed ? "text-slate-400" : "text-slate-500"}`}>
                      {row.payoutDate ? new Date(row.payoutDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </td>
                    {canPay && (
                      <td className="px-3 py-2 text-center">
                        {!reversed ? (
                          <button
                            type="button"
                            onClick={() => openReverseModal(row)}
                            title="Reverse this payout"
                            className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-100 hover:border-rose-300"
                          >
                            <FaUndo size={8} /> Reverse
                          </button>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={canPay ? 9 : 8} className="px-3 py-12 text-center text-xs font-semibold text-slate-400">
                    No commission payouts found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex-shrink-0 flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span className="font-semibold normal-case text-slate-500">Per page: {PAGE_SIZE}</span>
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

      {reverseTarget && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-rose-200 bg-rose-700 px-4 py-3 text-white">
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wide">Reverse Commission Payout</h2>
                <p className="mt-0.5 text-xs font-semibold text-rose-100">{reverseTarget.payoutNumber} · {reverseTarget.staff?.name}</p>
              </div>
              <button type="button" onClick={closeReverseModal} className="p-1 text-white/80 hover:bg-white/10"><FaTimes /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                <p className="font-bold">This action will:</p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5 font-semibold">
                  <li>Reverse all ledger entries for this payout</li>
                  <li>Restore the included commissions to <em>Payable</em></li>
                  {reverseTarget.savingsHeld > 0 && <li>Release {formatMoney(reverseTarget.savingsHeld)} savings hold back to pending</li>}
                </ul>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">Commission</span><span className="font-bold">{formatMoney(reverseTarget.amount)}</span></div>
                <div className="flex justify-between mt-1"><span className="text-slate-500">Date</span><span className="font-bold">{new Date(reverseTarget.payoutDate).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Reason / Notes (optional)</label>
                <input
                  className="h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-rose-400 focus:outline-none"
                  placeholder="Enter reason for reversal…"
                  value={reversalNotes}
                  onChange={(e) => setReversalNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button type="button" onClick={closeReverseModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">Cancel</button>
              <button
                type="button"
                onClick={confirmReverse}
                disabled={isReversing}
                className="inline-flex items-center gap-1.5 bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <FaUndo size={9} /> {isReversing ? "Reversing…" : "Confirm Reversal"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <Modal
          title="Pay Staff Commission"
          subtitle="Select the staff member and commissions to pay out."
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button type="button" onClick={() => setShowModal(false)} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">Cancel</button>
              {canPay && (
                <button type="submit" form="cw-payout-form" disabled={!selectedTotal} className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  <FaMoneyBillWave /> Pay {formatMoney(netCash || selectedTotal)} to Staff
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
              <select className={inputClass} value={form.method} onChange={(e) => { setForm((p) => ({ ...p, method: e.target.value, cashbookAccount: preferredCashbook(cashbooks, e.target.value) })); setRefError(false); }}>
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
              <label className={labelClass}>
                Reference{form.method === "mpesa" && <span className="ml-0.5 text-red-500">*</span>}
              </label>
              <input
                className={`${inputClass} ${refError && form.method === "mpesa" && !form.reference?.trim() ? "border-red-400 focus:border-red-400" : ""}`}
                value={form.reference}
                onChange={(e) => { setForm((p) => ({ ...p, reference: e.target.value })); if (e.target.value.trim()) setRefError(false); }}
                placeholder={form.method === "mpesa" ? "M-Pesa transaction code (required)" : "Optional"}
              />
              {refError && form.method === "mpesa" && !form.reference?.trim() && (
                <p className="mt-0.5 text-[10px] font-bold text-red-500">M-Pesa transaction code is required</p>
              )}
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input className={inputClass} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Optional" />
            </div>

            {/* Payout breakdown */}
            {selectedTotal > 0 && (
              <div className="sm:col-span-2 overflow-hidden rounded border border-slate-200 text-xs">
                <div className="bg-[#EDF5F1] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]">
                  Payout Breakdown
                </div>
                <div className="divide-y divide-slate-100 bg-white">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="text-slate-500">Commission total</span>
                    <span className="font-bold tabular-nums text-slate-800">{formatMoney(selectedTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="flex items-center gap-1.5 text-amber-700">
                      <FaPiggyBank size={9} />
                      Savings deduction
                      {savingsDeduction < pendingSavings && pendingSavings > 0 && (
                        <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[9px] font-bold">capped</span>
                      )}
                    </span>
                    <span className={`font-bold tabular-nums ${savingsDeduction > 0 ? "text-amber-700" : "text-slate-300"}`}>
                      {savingsDeduction > 0 ? `− ${formatMoney(savingsDeduction)}` : "—"}
                    </span>
                  </div>
                  <div className="border-t border-red-100 bg-red-50/40">
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="flex items-center gap-1.5 font-semibold text-red-700">
                        <FaBan size={9} />
                        Damages deduction
                        {damagesDeduction < pendingDamages && pendingDamages > 0 && (
                          <span className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[9px] font-bold">capped</span>
                        )}
                      </span>
                      <span className={`font-bold tabular-nums ${damagesDeduction > 0 ? "text-red-700" : "text-slate-300"}`}>
                        {damagesDeduction > 0 ? `− ${formatMoney(damagesDeduction)}` : "—"}
                      </span>
                    </div>
                    {pendingDamagesList.length > 0 && (
                      <div className="mx-3 mb-2 divide-y divide-red-100 rounded border border-red-200 bg-white text-[11px]">
                        {pendingDamagesList.map((d) => (
                          <div key={d._id} className="flex items-start justify-between gap-2 px-2.5 py-1.5">
                            <div className="min-w-0">
                              <span className="font-bold text-slate-800">{d.description || "—"}</span>
                              {d.job?.jobNumber && (
                                <span className="ml-1.5 font-mono text-[10px] text-slate-400">· {d.job.jobNumber}</span>
                              )}
                              <div className="text-[10px] text-slate-400">{fmtDate(d.damageDate || d.createdAt)}</div>
                            </div>
                            <span className="flex-shrink-0 font-extrabold text-red-600">− {formatMoney(d.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between bg-slate-50 px-3 py-2.5">
                    <span className="font-extrabold text-slate-800">Net cash to staff</span>
                    <span className="text-base font-black tabular-nums text-emerald-700">{formatMoney(netCash)}</span>
                  </div>
                </div>
                {pendingSavings === 0 && pendingDamages === 0 && (
                  <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] italic text-slate-400">
                    No pending savings or damage deductions for this staff member.
                  </p>
                )}
              </div>
            )}

            <div className="sm:col-span-2">
              <label className={labelClass}>Payable Commissions</label>
              <div className="max-h-56 overflow-auto rounded border border-slate-200">
                {selectedStaffPayable.length ? selectedStaffPayable.map((c) => (
                  <label key={c._id} className="flex cursor-pointer items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs hover:bg-slate-50">
                    <span className="flex min-w-0 items-center gap-2">
                      <input type="checkbox" checked={commIdSet.has(c._id)} onChange={() => toggleComm(c._id)} className="flex-shrink-0 accent-[#0B3B2E]" />
                      <span className="min-w-0">
                        <span className="font-mono font-bold text-[#0B3B2E]">{c.job?.jobNumber || c.jobNumber || "—"}</span>
                        <span className="text-slate-400"> · </span>
                        <span className="text-slate-700">{fmtSvc(c.service, c.serviceName || "—")}</span>
                        {(c.job?.plateNumber || c.job?.customerName) && (
                          <span className="ml-1 text-slate-400">· {c.job?.plateNumber || c.job?.customerName}</span>
                        )}
                      </span>
                    </span>
                    <span className="flex-shrink-0 font-extrabold text-slate-900">{formatMoney(c.commissionAmount)}</span>
                  </label>
                )) : (
                  <p className="px-3 py-8 text-center text-xs font-semibold text-slate-400">No payable commissions for this staff member.</p>
                )}
              </div>
              {selectedTotal > 0 && (
                <div className="mt-1.5 flex items-center justify-between rounded border border-[#B7C9C0] bg-[#EDF5F1] px-3 py-1.5 text-xs">
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
