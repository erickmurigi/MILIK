import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FaPrint, FaRedoAlt, FaSearch } from "react-icons/fa";
import { carWashApi, formatMoney, getActiveBranchId, todayISO } from "../../services/carWashApi";
import CarWashShell from "./CarWashShell";

const startOfMonthISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

const CarWashStaffReport = () => {
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState({ from: startOfMonthISO(), to: todayISO() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await carWashApi.getStaffReport({ from: applied.from, to: applied.to });
      setData(result || null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (!search.trim()) return all;
    const term = search.trim().toLowerCase();
    return all.filter((row) => String(row.staff || "").toLowerCase().includes(term));
  }, [data, search]);

  const totalJobs = Number(data?.totalJobs || 0);
  const totalRevenue = Number(data?.totalRevenue || 0);
  const totalCommission = Number(data?.totalCommission || 0);
  const staffCount = Number(data?.staffCount || 0);
  const period = data?.period;

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          jobs: acc.jobs + Number(row.jobs || 0),
          paidJobs: acc.paidJobs + Number(row.paidJobs || 0),
          revenue: acc.revenue + Number(row.revenue || 0),
          commission: acc.commission + Number(row.commission || 0),
          netRevenue: acc.netRevenue + Number(row.netRevenue || 0),
          cash: acc.cash + Number(row.cash || 0),
          mpesa: acc.mpesa + Number(row.mpesa || 0),
        }),
        { jobs: 0, paidJobs: 0, revenue: 0, commission: 0, netRevenue: 0, cash: 0, mpesa: 0 }
      ),
    [rows]
  );

  const submit = (event) => {
    event.preventDefault();
    setApplied({ from, to });
  };

  const reset = () => {
    const f = startOfMonthISO();
    const t = todayISO();
    setFrom(f);
    setTo(t);
    setSearch("");
    setApplied({ from: f, to: t });
  };

  return (
    <CarWashShell
      title="Staff Performance Report"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaPrint />
            Print
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 lg:grid-cols-[180px_180px_1fr_auto_auto]">
        <input
          type="date"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Filter by staff name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch />
          Search
        </button>
        <button type="button" onClick={reset} className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]">
          <FaRedoAlt />
          Reset
        </button>
      </form>

      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 border border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        <span>Period: <strong className="text-slate-900">{period ? `${period.from} → ${period.to}` : "—"}</strong></span>
        {!getActiveBranchId() && <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold normal-case text-slate-500 tracking-normal">All Branches</span>}
        <span>Staff: <strong className="text-[#0B3B2E]">{staffCount}</strong></span>
        <span>Total Jobs: <strong className="text-[#0B3B2E]">{totalJobs}</strong></span>
        <span>Total Revenue: <strong className="text-[#0B3B2E]">{formatMoney(totalRevenue)}</strong></span>
        <span>Total Commission: <strong className="text-[#FF8C00]">{formatMoney(totalCommission)}</strong></span>
        <span>Net: <strong className={totalRevenue - totalCommission >= 0 ? "text-[#0B3B2E]" : "text-red-700"}>{formatMoney(totalRevenue - totalCommission)}</strong></span>
        {search && <span>Filtered: <strong className="text-[#FF8C00]">{rows.length}</strong></span>}
      </div>

      <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1020px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-center font-bold uppercase tracking-wide">#</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Staff</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Jobs</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Paid</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Revenue</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Commission</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Net</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Cash</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">M-Pesa</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Avg / Job</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">% Rev</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={row.staff} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1.5 text-center font-bold text-slate-500">{index + 1}</td>
                  <td className="px-2 py-1.5 font-extrabold text-slate-900">{row.staff}</td>
                  <td className="px-2 py-1.5 text-right font-extrabold text-slate-900">{row.jobs}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{row.paidJobs}</td>
                  <td className="px-2 py-1.5 text-right font-extrabold text-slate-900">{formatMoney(row.revenue)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-[#FF8C00]">{formatMoney(row.commission)}</td>
                  <td className={`px-2 py-1.5 text-right font-extrabold ${row.netRevenue >= 0 ? "text-[#0B3B2E]" : "text-red-700"}`}>
                    {formatMoney(row.netRevenue)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-700">{formatMoney(row.cash)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-700">{formatMoney(row.mpesa)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-700">{formatMoney(row.avgPrice)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[#0B3B2E]" style={{ width: `${Math.min(row.revenueShare, 100)}%` }} />
                      </div>
                      <span className="font-bold text-[#0B3B2E]">{pct(row.revenueShare)}</span>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
                  {loading ? "Loading…" : "No staff activity found for this period."}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-[#0B3B2E] bg-[#EDF5F1]">
              <tr>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">
                  Total ({rows.length} staff member{rows.length !== 1 ? "s" : ""})
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{totals.jobs}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-emerald-700">{totals.paidJobs}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{formatMoney(totals.revenue)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-[#FF8C00]">{formatMoney(totals.commission)}</td>
                <td className={`px-2 py-1.5 text-right text-[11px] font-extrabold ${totals.netRevenue >= 0 ? "text-[#0B3B2E]" : "text-red-700"}`}>
                  {formatMoney(totals.netRevenue)}
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{formatMoney(totals.cash)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{formatMoney(totals.mpesa)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-slate-700">
                  {formatMoney(totals.jobs ? totals.revenue / totals.jobs : 0)}
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-[#0B3B2E]">100%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </CarWashShell>
  );
};

export default CarWashStaffReport;
