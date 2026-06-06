import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaRedoAlt, FaSearch } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const statuses     = ["earned", "payable", "paid", "cancelled"];
const statusLabels = { earned: "Earned", payable: "Payable", paid: "Paid", cancelled: "Cancelled" };
const PAGE_SIZE    = 30;

const getMonthBounds = () => {
  const now   = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
};

const statusBadge = (s) => {
  if (s === "paid")      return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (s === "payable")   return "border-blue-200   bg-blue-50   text-blue-700";
  if (s === "cancelled") return "border-red-200    bg-red-50    text-red-700";
  return "border-orange-200 bg-orange-50 text-orange-700";
};

const emptyFilters = () => {
  const { from, to } = getMonthBounds();
  return { status: "payable", staff: "", dateFrom: from, dateTo: to };
};

const inp = "h-7 border border-slate-300 bg-white px-2 text-xs text-slate-800 focus:border-[#0B3B2E] focus:outline-none";

const CarWashCommissions = () => {
  const navigate = useNavigate();
  const [commissions, setCommissions] = useState([]);
  const [staff, setStaff]             = useState([]);
  const [summary, setSummary]         = useState({ total: { amount: 0, count: 0 } });
  const [filters, setFilters]         = useState(emptyFilters);
  const [applied, setApplied]         = useState(emptyFilters);
  const [page, setPage]               = useState(1);
  const [pagination, setPagination]   = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading]         = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [commPayload, staffPayload] = await Promise.all([
        carWashApi.listCommissions({
          status:   applied.status   || undefined,
          staff:    applied.staff    || undefined,
          dateFrom: applied.dateFrom || undefined,
          dateTo:   applied.dateTo   || undefined,
          page,
          limit: PAGE_SIZE,
        }),
        staff.length ? Promise.resolve(null) : carWashApi.listStaff({ active: true }),
      ]);
      const rows = normalizeListPayload(commPayload, "commissions");
      setCommissions(rows);
      setPagination(commPayload?.pagination || { page, limit: PAGE_SIZE, total: rows.length, pages: 1 });
      setSummary(commPayload?.summary || { total: { amount: 0, count: rows.length } });
      if (staffPayload) setStaff(normalizeListPayload(staffPayload, "staff"));
    } catch {
      toast.error("Failed to load commissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [applied, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const resetFilters = () => { const d = emptyFilters(); setFilters(d); setPage(1); setApplied(d); };

  const pageTotal = useMemo(() => commissions.reduce((s, r) => s + Number(r.commissionAmount || 0), 0), [commissions]);

  return (
    <CarWashShell
      title="Staff Commissions"
      action={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={load}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => navigate("/carwash/commissions/payouts")}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            Payouts →
          </button>
        </div>
      }
    >
      {/* Filter bar */}
      <form onSubmit={applyFilters} className="mt-1 flex flex-wrap items-end gap-1.5 border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Status</label>
          <select className={`${inp} min-w-[110px]`} value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Staff</label>
          <select className={`${inp} min-w-[130px]`} value={filters.staff} onChange={(e) => setFilters((p) => ({ ...p, staff: e.target.value }))}>
            <option value="">All staff</option>
            {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">From</label>
          <input type="date" className={inp} value={filters.dateFrom} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className="text-[9px] font-bold uppercase tracking-wide text-slate-400">To</label>
          <input type="date" className={inp} value={filters.dateTo} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value }))} />
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
        {/* Meta bar — status counts inline like Jobs */}
        <div className="flex-shrink-0 flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          <span>Showing <strong className="text-[#0B3B2E]">{commissions.length}</strong>/{pagination.total}</span>
          <span>Page <strong className="text-[#0B3B2E]">{pagination.page}</strong>/{pagination.pages}</span>
          <span>Page Total <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
          {statuses.map((s) => summary?.[s]?.count > 0 && (
            <span key={s} className={`border px-1.5 py-0 text-[9px] font-bold uppercase ${statusBadge(s)}`}>
              {statusLabels[s]} {summary[s].count}
              {summary[s].amount > 0 && ` · ${formatMoney(summary[s].amount)}`}
            </span>
          ))}
          {loading && <span className="text-slate-400">Loading…</span>}
        </div>

        <div className="flex-1 min-h-0 overflow-x-auto">
          <table className="w-full min-w-[800px] text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Staff</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Job</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Service</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">Base Price</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">Rate</th>
                <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide text-slate-500">Commission</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide text-slate-500">Earned On</th>
              </tr>
            </thead>
            <tbody>
              {commissions.length ? commissions.map((row) => (
                <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-extrabold text-slate-900">{row.staff?.name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[#0B3B2E]">{row.jobNumber || row.job?.jobNumber || "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{row.serviceName || row.service?.name || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.baseAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                    {row.commissionType === "percentage" ? `${row.commissionRate}%` : formatMoney(row.commissionRate)}
                  </td>
                  <td className="px-3 py-2 text-right font-extrabold tabular-nums text-slate-900">{formatMoney(row.commissionAmount)}</td>
                  <td className="px-3 py-2">
                    <span className={`border px-2 py-0.5 text-[9px] font-bold uppercase ${statusBadge(row.status)}`}>
                      {statusLabels[row.status] || row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {row.earnedAt ? new Date(row.earnedAt).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-xs font-semibold text-slate-400">
                    No commissions found for the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — matches Jobs exactly */}
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
    </CarWashShell>
  );
};

export default CarWashCommissions;
