import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaCalendarAlt, FaLock, FaPlus, FaSyncAlt, FaTimes, FaUnlock } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { selectCurrentCompany } from "../../redux/selectors";
import {
  closeAccountingPeriod,
  createAccountingPeriod,
  getAccountingPeriods,
  lockAccountingPeriod,
  reopenAccountingPeriod,
} from "../../redux/apiCalls";
import { useConfirm } from "../../context/ConfirmContext";

const GRN = "#0B3B2E";

const fmt = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS = {
  open:   { label: "Open",   cls: "border-emerald-200 bg-emerald-50 text-emerald-700",  bar: "bg-emerald-500" },
  closed: { label: "Closed", cls: "border-amber-200 bg-amber-50 text-amber-700",        bar: "bg-amber-500"   },
  locked: { label: "Locked", cls: "border-red-200 bg-red-50 text-red-700",              bar: "bg-red-500"     },
};

const EMPTY_FORM = { name: "", startDate: "", endDate: "", notes: "" };

export default function AccountingPeriods() {
  const company     = useSelector(selectCurrentCompany);
  const { confirm } = useConfirm();

  const [periods,  setPeriods]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [actionId, setActionId] = useState(null);

  const load = useCallback(async () => {
    if (!company?._id) return;
    setLoading(true);
    try {
      const data = await getAccountingPeriods({ business: company._id });
      setPeriods(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load periods");
    } finally {
      setLoading(false);
    }
  }, [company?._id]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name || !form.startDate || !form.endDate) return;
    setSaving(true);
    try {
      await createAccountingPeriod({ ...form, business: company._id });
      toast.success("Period created");
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to create period");
    } finally {
      setSaving(false);
    }
  };

  const doAction = async (id, label, fn) => {
    const ok = await confirm({
      title: label,
      message: `Are you sure you want to ${label.toLowerCase()} this period?`,
    });
    if (!ok) return;
    setActionId(id);
    try {
      await fn(id);
      toast.success(`${label} successful`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.message || `Failed to ${label.toLowerCase()}`);
    } finally {
      setActionId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">

        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
          <FaCalendarAlt size={11} style={{ color: GRN }} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
            Accounting Periods
          </span>
          <span className="text-[10px] text-slate-400">— Control when ledger entries can be posted</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={load}
              className="flex h-7 items-center gap-1.5 border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
            >
              <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }}
              className="flex h-7 items-center gap-1.5 px-3 text-[11px] font-bold text-white"
              style={{ backgroundColor: GRN }}
            >
              <FaPlus size={9} /> New Period
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* Create form */}
          {showForm && (
            <div className="border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
                <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-700">Create Accounting Period</span>
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                  <FaTimes size={11} />
                </button>
              </div>
              <form onSubmit={handleCreate} className="grid gap-3 p-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Period Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. FY 2025 Q1"
                    className="h-8 w-full border border-slate-200 px-2.5 text-[11px] focus:border-[#0B3B2E] focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Start Date *</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                    className="h-8 w-full border border-slate-200 px-2.5 text-[11px] focus:border-[#0B3B2E] focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">End Date *</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                    className="h-8 w-full border border-slate-200 px-2.5 text-[11px] focus:border-[#0B3B2E] focus:outline-none"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Notes</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    placeholder="Optional notes"
                    className="h-8 w-full border border-slate-200 px-2.5 text-[11px] focus:border-[#0B3B2E] focus:outline-none"
                  />
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex h-7 items-center gap-1.5 px-4 text-[11px] font-bold text-white disabled:opacity-60"
                    style={{ backgroundColor: GRN }}
                  >
                    {saving ? "Creating…" : "Create Period"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex h-7 items-center gap-1.5 border border-slate-200 px-4 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Periods list */}
          {loading && periods.length === 0 ? (
            <div className="py-16 text-center text-[11px] text-slate-400">Loading periods…</div>
          ) : periods.length === 0 ? (
            <div className="border border-dashed border-slate-300 py-16 text-center">
              <FaCalendarAlt size={28} className="mx-auto mb-3 text-slate-300" />
              <p className="text-[11px] text-slate-400">No accounting periods yet — create one to get started.</p>
            </div>
          ) : (
            periods.map((p) => {
              const s = STATUS[p.status] || STATUS.open;
              return (
                <div key={p._id} className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                  <div className={`h-0.5 w-full ${s.bar}`} />
                  <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    {/* Left: name & meta */}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-black text-slate-800">{p.name}</span>
                        <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[9px] font-bold ${s.cls}`}>
                          {p.status === "locked" && <FaLock size={7} />}
                          {s.label}
                        </span>
                        {p.yearEndClosed && (
                          <span className="border border-purple-200 bg-purple-50 px-2 py-0.5 text-[9px] font-bold text-purple-700">
                            Year-end closed
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">
                        {fmt(p.startDate)} — {fmt(p.endDate)}
                        {p.notes && <span className="ml-2 text-slate-400">· {p.notes}</span>}
                      </div>
                      {p.closedBy?.name && (
                        <div className="mt-0.5 text-[9px] text-slate-400">
                          Closed by {p.closedBy.name} · {fmt(p.closedAt)}
                        </div>
                      )}
                      {p.lockedBy?.name && (
                        <div className="mt-0.5 text-[9px] text-slate-400">
                          Locked by {p.lockedBy.name} · {fmt(p.lockedAt)}
                        </div>
                      )}
                    </div>

                    {/* Right: actions */}
                    <div className="flex shrink-0 items-center gap-2">
                      {p.status === "open" && (
                        <button
                          disabled={actionId === p._id}
                          onClick={() => doAction(p._id, "Close", closeAccountingPeriod)}
                          className="flex h-7 items-center gap-1.5 border border-amber-300 bg-amber-50 px-3 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                        >
                          <FaLock size={8} /> Close
                        </button>
                      )}
                      {p.status === "closed" && (
                        <>
                          <button
                            disabled={actionId === p._id}
                            onClick={() => doAction(p._id, "Reopen", reopenAccountingPeriod)}
                            className="flex h-7 items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <FaUnlock size={8} /> Reopen
                          </button>
                          <button
                            disabled={actionId === p._id}
                            onClick={() => doAction(p._id, "Lock permanently", lockAccountingPeriod)}
                            className="flex h-7 items-center gap-1.5 border border-red-300 bg-red-50 px-3 text-[10px] font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            <FaLock size={8} /> Lock
                          </button>
                        </>
                      )}
                      {p.status === "locked" && (
                        <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                          <FaLock size={8} /> Permanently locked
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
