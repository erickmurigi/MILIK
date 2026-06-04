import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaRedoAlt, FaSearch } from "react-icons/fa";
import { toast } from "react-toastify";
import { carWashApi, formatMoney, normalizeListPayload } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const statuses    = ["earned", "payable", "paid", "cancelled"];
const statusLabels = { earned: "Earned", payable: "Payable", paid: "Paid", cancelled: "Cancelled" };
const PAGE_SIZE   = 30;

const statusClass = (s) => {
  if (s === "paid")      return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (s === "payable")   return "border-blue-200   bg-blue-50   text-blue-700";
  if (s === "cancelled") return "border-red-200    bg-red-50    text-red-700";
  return "border-orange-200 bg-orange-50 text-orange-700";
};

const CarWashCommissions = () => {
  const navigate = useNavigate();
  const [commissions, setCommissions] = useState([]);
  const [staff, setStaff]             = useState([]);
  const [summary, setSummary]         = useState({ total: { amount: 0, count: 0 } });
  const [filters, setFilters]         = useState({ status: "payable", staff: "", date: "" });
  const [applied, setApplied]         = useState({ status: "payable", staff: "", date: "" });
  const [page, setPage]               = useState(1);
  const [pagination, setPagination]   = useState({ page: 1, limit: PAGE_SIZE, total: 0, pages: 1 });
  const [loading, setLoading]         = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [commPayload, staffPayload] = await Promise.all([
        carWashApi.listCommissions({ status: applied.status || undefined, staff: applied.staff || undefined, date: applied.date || undefined, page, limit: PAGE_SIZE }),
        carWashApi.listStaff({ active: true }),
      ]);
      const rows = normalizeListPayload(commPayload, "commissions");
      setCommissions(rows);
      setPagination(commPayload?.pagination || { page, limit: PAGE_SIZE, total: rows.length, pages: 1 });
      setSummary(commPayload?.summary || { total: { amount: 0, count: rows.length } });
      setStaff(normalizeListPayload(staffPayload, "staff"));
    } catch {
      toast.error("Failed to load commissions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [applied, page]);

  const applyFilters = (e) => { e.preventDefault(); setPage(1); setApplied({ ...filters }); };
  const resetFilters = () => { setFilters({ status: "payable", staff: "", date: "" }); setPage(1); setApplied({ status: "payable", staff: "", date: "" }); };

  const pageTotal = useMemo(() => commissions.reduce((s, r) => s + Number(r.commissionAmount || 0), 0), [commissions]);

  return (
    <CarWashShell
      title="Staff Commissions"
      action={
        <>
          <button onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={() => navigate("/carwash/commissions/payouts")} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            Payouts →
          </button>
        </>
      }
    >
      {/* Summary chips */}
      <div className="mb-2 flex flex-wrap gap-2">
        {["earned", "payable", "paid", "cancelled"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setFilters((p) => ({ ...p, status: s })); setPage(1); setApplied((p) => ({ ...p, status: s })); }}
            className={`border px-3 py-1.5 text-[11px] font-bold uppercase cursor-pointer transition-colors ${applied.status === s ? statusClass(s) : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            {statusLabels[s]} {summary?.[s]?.count != null ? `(${summary[s].count})` : ""}
            {summary?.[s]?.amount > 0 ? ` · ${formatMoney(summary[s].amount)}` : ""}
          </button>
        ))}
      </div>

      <form onSubmit={applyFilters} className="mb-2 flex flex-wrap gap-2 border border-slate-200 bg-white p-2 shadow-sm">
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:outline-none" value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
          <option value="">All status</option>
          {statuses.map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}
        </select>
        <select className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:outline-none" value={filters.staff} onChange={(e) => setFilters((p) => ({ ...p, staff: e.target.value }))}>
          <option value="">All staff</option>
          {staff.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        <input type="date" className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none" value={filters.date} onChange={(e) => setFilters((p) => ({ ...p, date: e.target.value }))} />
        <button type="submit" className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]"><FaSearch /> Search</button>
        <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"><FaRedoAlt /> Reset</button>
      </form>

      <div className="min-h-[calc(100vh-18rem)] overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Showing: <strong className="text-[#0B3B2E]">{commissions.length}</strong> / {pagination.total}</span>
          <span>Page: <strong className="text-[#0B3B2E]">{pagination.page}</strong> / {pagination.pages}</span>
          <span>Page Total: <strong className="text-[#0B3B2E]">{formatMoney(pageTotal)}</strong></span>
        </div>
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Job</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Base Price</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Rate</th>
              <th className="px-3 py-1.5 text-right font-bold uppercase tracking-wide">Commission</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Status</th>
              <th className="px-3 py-1.5 text-left font-bold uppercase tracking-wide">Earned On</th>
            </tr>
          </thead>
          <tbody>
            {commissions.length ? commissions.map((row) => (
              <tr key={row._id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="px-3 py-2 font-extrabold text-slate-900">{row.staff?.name || "—"}</td>
                <td className="px-3 py-2 text-slate-700">{row.jobNumber || row.job?.jobNumber || "—"}</td>
                <td className="px-3 py-2 text-slate-700">{row.serviceName || row.service?.name || "—"}</td>
                <td className="px-3 py-2 text-right">{formatMoney(row.baseAmount)}</td>
                <td className="px-3 py-2 text-right">{row.commissionType === "percentage" ? `${row.commissionRate}%` : formatMoney(row.commissionRate)}</td>
                <td className="px-3 py-2 text-right font-extrabold text-slate-900">{formatMoney(row.commissionAmount)}</td>
                <td className="px-3 py-2">
                  <span className={`border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClass(row.status)}`}>{statusLabels[row.status] || row.status}</span>
                </td>
                <td className="px-3 py-2 text-slate-600">{row.earnedAt ? new Date(row.earnedAt).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
              </tr>
            )) : (
              <tr><td colSpan={8} className="px-3 py-12 text-center text-xs font-semibold text-slate-500">No commissions found for the selected filters.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex min-h-9 items-center justify-between border-t border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600">
          <span>Rows per page: {PAGE_SIZE}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page <= 1 || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45">Previous</button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(p + 1, pagination.pages))} disabled={page >= pagination.pages || loading} className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-45">Next</button>
          </div>
        </div>
      </div>
    </CarWashShell>
  );
};

export default CarWashCommissions;
