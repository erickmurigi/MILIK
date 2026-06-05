import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaChevronDown, FaChevronRight, FaEdit, FaPiggyBank, FaPlus,
  FaRedoAlt, FaSearch, FaTimes, FaWallet,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const GRN = "#0B3B2E";
const emptyForm = { name: "", phone: "", role: "", active: true };
const inputClass = "h-9 w-full border border-slate-300 px-2 text-sm text-slate-800 focus:border-[#0B3B2E] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-extrabold uppercase tracking-wide text-slate-500";
const PAGE_SIZE = 30;
const fmt = formatMoney;
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ─── Shared Modal ─────────────────────────────────────────────────────────────
const Modal = ({ title, children, footer, onClose }) => (
  <div className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
    <div className="w-full max-w-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">{title}</h2>
        <button type="button" onClick={onClose} className="p-1 text-white/80 hover:bg-white/10 hover:text-white"><FaTimes /></button>
      </div>
      <div className="p-4">{children}</div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">{footer}</div>
    </div>
  </div>
);

// ─── Stat tile ────────────────────────────────────────────────────────────────
const StatTile = ({ label, value, sub, color = "slate" }) => {
  const colors = {
    slate:   "border-slate-200  bg-slate-50   text-slate-700",
    green:   "border-emerald-200 bg-emerald-50 text-emerald-700",
    orange:  "border-orange-200 bg-orange-50  text-orange-700",
    blue:    "border-blue-200   bg-blue-50    text-blue-700",
    red:     "border-red-200    bg-red-50     text-red-600",
    amber:   "border-amber-200  bg-amber-50   text-amber-700",
  };
  return (
    <div className={`rounded border px-3 py-2 ${colors[color] || colors.slate}`}>
      <p className="text-[9px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-0.5 text-sm font-black tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] opacity-60">{sub}</p>}
    </div>
  );
};

// ─── Savings Payout Modal ─────────────────────────────────────────────────────
const SavingsPayoutModal = ({ staff, balance, cashbooks, onClose, onSuccess }) => {
  const [amount, setAmount]   = useState(String(balance));
  const [cashbook, setCashbook] = useState(cashbooks[0]?._id || "");
  const [notes, setNotes]     = useState("");
  const [saving, setSaving]   = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await carWashApi.createSavingsPayout({
        staff:           staff._id,
        amount:          Number(amount),
        cashbookAccount: cashbook,
        notes,
      });
      toast.success(`Savings payout recorded for ${staff.name}`);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Savings payout failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Savings Payout — ${staff.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
          <button type="submit" form="savings-payout-form" disabled={saving} className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50">
            {saving ? "Processing…" : "Confirm Payout"}
          </button>
        </>
      }
    >
      <form id="savings-payout-form" onSubmit={submit} className="space-y-4">
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Available savings balance: <strong>{fmt(balance)}</strong>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Amount (Ksh) *</label>
            <input
              type="number" min="1" max={balance} step="1" required
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Cashbook Account *</label>
            <select required className={inputClass} value={cashbook} onChange={(e) => setCashbook(e.target.value)}>
              <option value="">— Select —</option>
              {cashbooks.map((cb) => <option key={cb._id} value={cb._id}>{cb.code} – {cb.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Annual savings payout…" />
        </div>
      </form>
    </Modal>
  );
};

// ─── Wallet drawer ────────────────────────────────────────────────────────────
const WalletDrawer = ({ row, cashbooks, onPayoutSuccess }) => {
  const [wallet, setWallet]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayout, setShowPayout] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await carWashApi.getStaffWallet(row._id);
      setWallet(data);
    } catch {
      toast.error("Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, [row._id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <tr className="border-b border-slate-200 bg-[#F8FBF9]">
      <td colSpan={6} className="px-10 py-4 text-center text-xs text-slate-400">Loading wallet…</td>
    </tr>
  );

  const c   = wallet?.commissions || {};
  const sav = wallet?.savings     || {};
  const recentSavings = wallet?.recentSavings || [];

  const typeTag = (type) => type === "disbursement"
    ? <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Paid Out</span>
    : <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">Saved</span>;

  return (
    <>
      <tr className="border-b border-slate-100 bg-[#F8FBF9]">
        <td colSpan={6} className="px-6 py-4">
          <div className="space-y-4">

            {/* Commission summary */}
            <div>
              <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <FaWallet size={9} /> Commission Account
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Earned"   value={fmt(c.earned?.amount   || 0)} sub={`${c.earned?.count   || 0} jobs`} color="orange" />
                <StatTile label="Payable"  value={fmt(c.payable?.amount  || 0)} sub={`${c.payable?.count  || 0} jobs`} color="blue" />
                <StatTile label="Paid Out" value={fmt(c.paid?.amount     || 0)} sub={`${c.paid?.count     || 0} payouts`} color="green" />
                <StatTile label="Total Earned" value={fmt(c.total?.amount || 0)} sub={`${c.total?.count   || 0} total`} color="slate" />
              </div>
            </div>

            {/* Savings summary */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <FaPiggyBank size={9} /> Savings Account
                </p>
                {sav.balance > 0 && (
                  <button
                    onClick={() => setShowPayout(true)}
                    className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
                  >
                    <FaPiggyBank size={8} /> Disburse Savings
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Total Saved"      value={fmt(sav.totalDaily     || sav.totalAccrued || 0)} sub="daily standing order" color="amber" />
                <StatTile label="Pending Deduction" value={fmt(sav.pendingToHold || 0)} sub="next payout" color="orange" />
                <StatTile label="Disbursed"        value={fmt(sav.totalDisbursed || 0)} color="green" />
                <StatTile label="Balance" value={fmt(sav.balance || 0)} sub="available" color={sav.balance > 0 ? "blue" : "slate"} />
              </div>
            </div>

            {/* Recent savings transactions */}
            {recentSavings.length > 0 && (
              <div>
                <p className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">Recent Savings Transactions</p>
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-200 bg-white">
                  {recentSavings.map((rec) => (
                    <div key={rec._id} className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                      <div className="flex items-center gap-2">
                        {typeTag(rec.type)}
                        <span className="text-slate-600">
                          {rec.job ? `Job #${rec.jobNumber || rec.job?.jobNumber || ""}` : rec.savingsPayoutNumber || "—"}
                        </span>
                        {rec.job?.plateNumber && <span className="font-mono text-slate-400">{rec.job.plateNumber}</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-400">{fmtDate(rec.date)}</span>
                        <span className={`font-black tabular-nums ${rec.type === "disbursement" ? "text-emerald-700" : "text-amber-700"}`}>
                          {rec.type === "disbursement" ? "−" : "+"}{fmt(rec.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </td>
      </tr>

      {showPayout && (
        <SavingsPayoutModal
          staff={row}
          balance={sav.balance || 0}
          cashbooks={cashbooks}
          onClose={() => setShowPayout(false)}
          onSuccess={() => { load(); onPayoutSuccess(); }}
        />
      )}
    </>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
const CarWashStaff = () => {
  const [rows, setRows]         = useState([]);
  const [form, setForm]         = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [filters, setFilters]   = useState({ search: "", status: "" });
  const [appliedFilters, setAppliedFilters] = useState({ search: "", status: "" });
  const [expandedIds, setExpandedIds] = useState([]);
  const [page, setPage]         = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [cashbooks, setCashbooks] = useState([]);
  const canManage = useCarWashPermission("carwash-staff", "manage");

  const rowStats = useMemo(() => {
    let active = 0, inactive = 0;
    rows.forEach((r) => { if (r.active !== false) active++; else inactive++; });
    return { active, inactive };
  }, [rows]);

  const load = async () => {
    setLoading(true);
    try {
      const [payload, cbRes] = await Promise.all([
        carWashApi.listStaff({ limit: PAGE_SIZE, page, search: appliedFilters.search || undefined, active: appliedFilters.status === "active" ? true : appliedFilters.status === "inactive" ? false : undefined }),
        carWashApi.listCashbooks(),
      ]);
      setRows(normalizeListPayload(payload, "staff"));
      setPagination(payload?.pagination || { page, limit: PAGE_SIZE, total: 0, pages: 1 });
      setCashbooks(normalizeListPayload(cbRes, "accounts"));
      setExpandedIds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load().catch(() => toast.error("Failed to load staff")); }, [appliedFilters, page]);

  const closeModal = () => { setShowModal(false); setEditingId(""); setForm(emptyForm); };
  const openCreate = () => { setEditingId(""); setForm(emptyForm); setShowModal(true); };
  const openEdit   = (row) => { setEditingId(row._id); setForm({ name: row.name || "", phone: row.phone || "", role: row.role || "", active: row.active !== false }); setShowModal(true); };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) await carWashApi.updateStaff(editingId, form);
      else await carWashApi.createStaff(form);
      closeModal();
      await load();
      toast.success("Staff saved");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Unable to save staff");
    }
  };

  const applyFilters = (e) => { e.preventDefault(); setPage(1); setAppliedFilters({ ...filters }); };
  const resetFilters = () => { setFilters({ search: "", status: "" }); setPage(1); setAppliedFilters({ search: "", status: "" }); };
  const toggleExpanded = (id) => setExpandedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <CarWashShell
      title="Staff Register"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {canManage && (
            <button type="button" onClick={openCreate} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white shadow-sm hover:bg-[#0A3127]">
              <FaPlus /> New Staff
            </button>
          )}
        </>
      }
    >
      <form onSubmit={applyFilters} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 md:grid-cols-[1fr_220px_auto_auto]">
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Search name / phone / role"
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
        />
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status}
          onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
        >
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch /> Search
        </button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt /> Reset
        </button>
      </form>

      <div className="min-h-[calc(100vh-14rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap min-h-8 items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{rows.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Active: <strong className="text-[#0B3B2E]">{rowStats.active}</strong></span>
          <span>Inactive: <strong className="text-[#FF8C00]">{rowStats.inactive}</strong></span>
        </div>
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-left" />
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Name</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Phone</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Role</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => {
              const expanded = expandedIds.includes(row._id);
              return (
                <React.Fragment key={row._id}>
                  <tr className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row._id)}
                        className="text-[#0B3B2E] hover:text-[#FF8C00]"
                        title={expanded ? "Hide wallet" : "View wallet"}
                      >
                        {expanded ? <FaChevronDown /> : <FaChevronRight />}
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <span className="font-extrabold text-slate-900">{row.name}</span>
                    </td>
                    <td className="px-2 py-1 text-slate-700">{row.phone || "—"}</td>
                    <td className="px-2 py-1 text-slate-700">{row.role || "—"}</td>
                    <td className="px-2 py-1">
                      <span className={`inline-flex border px-2 py-0.5 text-[11px] font-bold uppercase ${row.active === false ? "border-orange-200 bg-orange-50 text-orange-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                        {row.active === false ? "Inactive" : "Active"}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right">
                      {canManage && (
                        <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-1 border border-[#B7C9C0] bg-white px-2 py-0.5 text-[11px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
                          <FaEdit /> Edit
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <WalletDrawer
                      key={`wallet-${row._id}`}
                      row={row}
                      cashbooks={cashbooks}
                      onPayoutSuccess={load}
                    />
                  )}
                </React.Fragment>
              );
            }) : (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">No Car Wash staff found.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Rows per page: {PAGE_SIZE}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1 || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Previous</button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(p + 1, pagination.pages))} disabled={page >= pagination.pages || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45">Next</button>
          </div>
        </div>
      </div>

      {showModal && (
        <Modal
          title={editingId ? "Edit Staff" : "New Staff"}
          onClose={closeModal}
          footer={
            <>
              <button type="button" onClick={closeModal} className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
              {canManage && <button type="submit" form="carwash-staff-form" className="bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]">Save Staff</button>}
            </>
          }
        >
          <form id="carwash-staff-form" onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelClass}>Name *</label>
              <input className={inputClass} value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required autoFocus />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input className={inputClass} value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
            </div>
            <div>
              <label className={labelClass}>Role</label>
              <input className={inputClass} value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
              Active
            </label>
          </form>
        </Modal>
      )}
    </CarWashShell>
  );
};

export default CarWashStaff;
