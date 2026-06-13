import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCheckCircle, FaExclamationTriangle, FaMobileAlt, FaRedoAlt,
  FaSearch, FaTimesCircle, FaCopy, FaLink, FaTimes, FaCarAlt,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";
import useCarWashPermission from "../../hooks/useCarWashPermission";

const PAGE_SIZE = 50;

const STATUS_META = {
  matched:   { label: "Matched",   bg: "bg-emerald-50",  border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500", icon: FaCheckCircle },
  unmatched: { label: "Unmatched", bg: "bg-amber-50",    border: "border-amber-200",   text: "text-amber-700",  dot: "bg-amber-400",  icon: FaExclamationTriangle },
  duplicate: { label: "Duplicate", bg: "bg-blue-50",     border: "border-blue-200",    text: "text-blue-700",   dot: "bg-blue-400",   icon: FaCopy },
  rejected:  { label: "Rejected",  bg: "bg-red-50",      border: "border-red-200",     text: "text-red-700",    dot: "bg-red-400",    icon: FaTimesCircle },
  error:     { label: "Error",     bg: "bg-slate-50",    border: "border-slate-200",   text: "text-slate-500",  dot: "bg-slate-400",  icon: FaExclamationTriangle },
};

const StatusBadge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.error;
  return (
    <span className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[10px] font-bold uppercase ${m.bg} ${m.border} ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
};

const fmtDate = (v) =>
  v ? new Date(v).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// ─── Assign Modal ─────────────────────────────────────────────────────────────
function AssignModal({ notif, onClose, onAssigned }) {
  const [search, setSearch] = useState(notif?.plate || "");
  const [jobs, setJobs] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (notif?.plate) doSearch(notif.plate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = async (q = search) => {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    setSelected(null);
    try {
      const res = await carWashApi.listJobs({ search: term, limit: 20 });
      setJobs(normalizeListPayload(res, "jobs"));
    } catch {
      toast.error("Job search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await carWashApi.reassignMpesaNotification(notif._id, selected._id);
      const updated = res?.notification || res?.data?.notification;
      toast.success(`Assigned to job ${selected.jobNumber} — Ksh ${formatMoney(notif.amount)} recorded`);
      onAssigned(updated || { ...notif, status: "matched", matchedJob: selected });
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to assign notification");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-white shadow-xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0B3B2E] px-4 py-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-white">Assign to Job</p>
            <p className="text-[11px] text-emerald-200">
              Ksh {formatMoney(notif.amount)} · ref: <span className="font-mono">{notif.billRefNumber || "—"}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><FaTimes size={14} /></button>
        </div>

        {/* Wrong ref info */}
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800">
          <FaExclamationTriangle className="inline mr-1.5 text-amber-500" size={11} />
          Customer typed <strong className="font-mono">&ldquo;{notif.billRefNumber}&rdquo;</strong> as account reference — search below to find the correct job.
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              className="h-9 flex-1 border border-slate-300 px-3 text-xs font-semibold uppercase placeholder:normal-case focus:border-[#0B3B2E] focus:outline-none"
              placeholder="Plate, job #, or customer name"
              value={search}
              onChange={e => setSearch(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && doSearch()}
            />
            <button
              type="button"
              onClick={() => doSearch()}
              disabled={searching}
              className="inline-flex h-9 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00] disabled:opacity-50"
            >
              <FaSearch size={10} /> Search
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-64 overflow-y-auto border-t border-slate-100">
          {searching && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Searching…</p>
          )}
          {!searching && jobs.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">No jobs found. Try searching by plate or job number.</p>
          )}
          {!searching && jobs.map((j) => {
            const isSelected = selected?._id === j._id;
            const isPaid = j.paymentStatus === "paid";
            return (
              <button
                key={j._id}
                type="button"
                disabled={isPaid}
                onClick={() => setSelected(j)}
                className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors ${
                  isSelected ? "bg-emerald-50 border-l-2 border-l-emerald-500" : "hover:bg-slate-50"
                } ${isPaid ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <FaCarAlt size={13} className={isSelected ? "text-emerald-600" : "text-slate-400"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-slate-900 tracking-wider text-xs">{j.plateNumber}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{j.jobNumber}</span>
                    <StatusBadge status={j.paymentStatus === "paid" ? "matched" : j.paymentStatus === "partial" ? "unmatched" : "unmatched"} />
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {j.customerName || "—"} · Ksh {formatMoney(j.price)} · {fmtDate(j.createdAt)}
                  </div>
                </div>
                {isPaid && <span className="text-[9px] font-bold uppercase text-slate-400">Fully Paid</span>}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          {selected ? (
            <div className="text-[11px] text-slate-600">
              Assigning <strong>Ksh {formatMoney(Math.min(notif.amount, selected.price))}</strong> to{" "}
              <strong className="text-[#0B3B2E]">{selected.plateNumber} · {selected.jobNumber}</strong>
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">Select a job above</span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="inline-flex h-8 items-center px-3 text-xs font-bold text-slate-600 hover:text-slate-900">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!selected || saving}
              className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
            >
              <FaLink size={10} /> {saving ? "Assigning…" : "Confirm Assignment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CarWashMpesaNotifications() {
  const canRecord = useCarWashPermission("carwash-payments", "record");

  const [notifications, setNotifications] = useState([]);
  const [summary, setSummary] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);

  const [filters, setFilters] = useState({ status: "", plate: "", dateFrom: todayISO(), dateTo: todayISO() });
  const [applied, setApplied] = useState({ status: "", plate: "", dateFrom: todayISO(), dateTo: todayISO() });
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await carWashApi.listMpesaNotifications({
        status: applied.status || undefined,
        plate: applied.plate || undefined,
        dateFrom: applied.dateFrom || undefined,
        dateTo: applied.dateTo || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setNotifications(res?.notifications || res?.data?.notifications || []);
      setPagination(res?.pagination || res?.data?.pagination || { page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
      setSummary(res?.summary || res?.data?.summary || []);
    } catch {
      toast.error("Failed to load M-Pesa notifications");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { load(); }, [load]);

  const apply = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const reset = () => {
    const d = { status: "", plate: "", dateFrom: todayISO(), dateTo: todayISO() };
    setFilters(d); setApplied(d); setPage(1);
  };

  const handleAssigned = (updated) => {
    setNotifications((prev) =>
      prev.map((n) => (n._id === updated._id ? { ...n, ...updated } : n))
    );
    setSummary([]); // force reload on next render to refresh counts
    load();
  };

  const summaryMap = Object.fromEntries(summary.map(s => [s._id, s]));
  const totalMatched   = summaryMap.matched?.count   || 0;
  const totalUnmatched = summaryMap.unmatched?.count || 0;
  const totalDuplicate = summaryMap.duplicate?.count || 0;
  const totalAmount    = summaryMap.matched?.totalAmount || 0;

  return (
    <CarWashShell
      title="M-Pesa Notifications"
      action={
        <button onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
          <FaRedoAlt className={loading ? "animate-spin" : ""} size={11} /> Refresh
        </button>
      }
    >
      {assignTarget && (
        <AssignModal
          notif={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={handleAssigned}
        />
      )}

      {/* Summary strip */}
      <div className="mb-2 flex flex-wrap gap-2">
        {[
          { label: "Matched",   value: totalMatched,    sub: `Ksh ${formatMoney(totalAmount)}`, dot: "bg-emerald-500", text: "text-emerald-700", border: "border-emerald-200 bg-emerald-50" },
          { label: "Unmatched", value: totalUnmatched,  sub: "needs assignment",                dot: "bg-amber-400",   text: "text-amber-700",  border: "border-amber-200 bg-amber-50"   },
          { label: "Duplicate", value: totalDuplicate,  sub: "already processed",               dot: "bg-blue-400",    text: "text-blue-700",   border: "border-blue-200 bg-blue-50"     },
          { label: "Total",     value: pagination.total, sub: "in filter",                      dot: "bg-slate-400",   text: "text-slate-700",  border: "border-slate-200 bg-white"      },
        ].map(({ label, value, sub, dot, text, border }) => (
          <div key={label} className={`inline-flex items-center gap-2.5 border px-3 py-1.5 ${border}`}>
            <span className={`h-2 w-2 rounded-full ${dot}`} />
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
            <span className={`text-sm font-black ${text}`}>{value}</span>
            <span className="text-[10px] text-slate-400">{sub}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <form onSubmit={apply} className="mb-2 flex flex-wrap items-center gap-2 border border-slate-200 bg-white p-2 shadow-sm">
        <select
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.status}
          onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none uppercase placeholder:normal-case"
          placeholder="Plate (e.g. KBY 578D)"
          value={filters.plate}
          onChange={e => setFilters(p => ({ ...p, plate: e.target.value.toUpperCase() }))}
        />
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} title="From" />
        <span className="text-xs text-slate-400 font-bold">→</span>
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} title="To" />
        <button type="submit" className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch size={10} /> Search
        </button>
        <button type="button" onClick={reset} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt size={10} /> Reset
        </button>
        <span className="ml-auto text-[11px] font-semibold text-slate-500">
          {pagination.total} notification{pagination.total !== 1 ? "s" : ""}
        </span>
      </form>

      {/* Table */}
      <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing <strong className="text-[#0B3B2E]">{notifications.length}</strong> / {pagination.total}</span>
          <span>Page <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
        </div>

        <table className="w-full min-w-[1000px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Time</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Plate (reference)</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Sender Name</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Phone</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Transaction Code</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Matched Job</th>
              <th className="px-2 py-1.5 text-center font-bold uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && notifications.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-xs font-semibold text-slate-400">
                  No notifications found for the selected filters.
                </td>
              </tr>
            )}
            {notifications.map((n) => {
              const canAssign = canRecord && (n.status === "unmatched" || n.status === "error");
              return (
                <React.Fragment key={n._id}>
                  <tr className={`border-b border-slate-100 hover:bg-slate-50 ${STATUS_META[n.status]?.bg || ""}`}>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(n.createdAt)}</td>
                    <td className="px-3 py-2"><StatusBadge status={n.status} /></td>
                    <td className="px-3 py-2">
                      <div className="font-extrabold text-slate-900 tracking-wider">{n.plate || "—"}</div>
                      {n.billRefNumber && n.billRefNumber !== n.plate && (
                        <div className="text-[10px] text-slate-400">raw: {n.billRefNumber}</div>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right font-extrabold ${n.status === "matched" ? "text-emerald-700" : "text-slate-700"}`}>
                      {n.amount > 0 ? formatMoney(n.amount) : "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-700">
                      {n.senderName || <span className="text-slate-400 italic font-normal">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {n.msisdn ? (
                        <span className="inline-flex items-center gap-1 font-mono">
                          <FaMobileAlt size={9} className="text-slate-400" />
                          {n.msisdn.slice(0, 4)}{"***"}{n.msisdn.slice(-3)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">{n.transactionCode || "—"}</td>
                    <td className="px-3 py-2">
                      {n.matchedJob ? (
                        <div>
                          <p className="font-bold text-[#0B3B2E]">{n.matchedJob.jobNumber}</p>
                          <p className="text-[10px] text-slate-500">{n.matchedJob.customerName || n.matchedJob.plateNumber}</p>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">{n.resultDesc || "—"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {canAssign && (
                          <button
                            type="button"
                            onClick={() => setAssignTarget(n)}
                            className="inline-flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
                            title="Assign to correct job"
                          >
                            <FaLink size={9} /> Assign
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === n._id ? null : n._id)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-700 px-1"
                          title="View raw payload"
                        >
                          {expanded === n._id ? "▲" : "▼"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === n._id && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Raw Safaricom Payload</span>
                          {n.notes && (
                            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5">
                              {n.notes}
                            </span>
                          )}
                        </div>
                        <pre className="max-h-48 overflow-auto rounded border border-slate-200 bg-white p-3 text-[10px] font-mono text-slate-700">
                          {JSON.stringify(n.rawPayload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600">
          <span>{PAGE_SIZE} per page</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => p - 1)}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45"
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button
              disabled={page >= pagination.pages || loading}
              onClick={() => setPage(p => p + 1)}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </CarWashShell>
  );
}
