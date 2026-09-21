import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { FaPrint, FaRedoAlt, FaSearch } from "react-icons/fa";
import { carWashApi, formatMoney, getActiveBranchId, todayISO } from "../../services/carWashApi";
import { selectCurrentCompany } from "../../redux/selectors";
import CarWashShell from "./CarWashShell";
import AppSelect from "../../components/common/AppSelect";
import { printTabularList } from "../../utils/printList";
import { toast } from "react-toastify";

const startOfMonthISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

const CarWashServiceReport = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const [from, setFrom] = useTabState("/carwash/reports/services:from", () => startOfMonthISO());
  const [to, setTo] = useTabState("/carwash/reports/services:to", () => todayISO());
  const [search, setSearch] = useTabState("/carwash/reports/services:search", "");
  const [category, setCategory] = useTabState("/carwash/reports/services:category", "");
  const [applied, setApplied] = useTabState("/carwash/reports/services:applied", () => ({ from: startOfMonthISO(), to: todayISO(), category: "" }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const activeBranchId = useMemo(() => getActiveBranchId(), []);

  const { data: categoriesRaw } = useQuery({
    queryKey: ["cw-service-categories-ref"],
    queryFn: () => carWashApi.listServiceCategories(),
    staleTime: 5 * 60_000,
    select: (result) => Array.isArray(result) ? result : Array.isArray(result?.categories) ? result.categories : [],
  });
  const categories = categoriesRaw ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { from: applied.from, to: applied.to };
      if (applied.category) params.category = applied.category;
      const result = await carWashApi.getServiceReport(params);
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

  const categoryOptions = useMemo(() => categories.map((cat) => ({ value: cat, label: cat })), [categories]);

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (!search.trim()) return all;
    const term = search.trim().toLowerCase();
    return all.filter((row) => String(row.service || "").toLowerCase().includes(term));
  }, [data, search]);

  const totalJobs = Number(data?.totalJobs || 0);
  const totalRevenue = Number(data?.totalRevenue || 0);
  const serviceCount = Number(data?.serviceCount || 0);
  const avgJobValue = totalJobs ? totalRevenue / totalJobs : 0;
  const period = data?.period;

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          jobs: acc.jobs + Number(row.jobs || 0),
          paidJobs: acc.paidJobs + Number(row.paidJobs || 0),
          revenue: acc.revenue + Number(row.revenue || 0),
          cash: acc.cash + Number(row.cash || 0),
          mpesa: acc.mpesa + Number(row.mpesa || 0),
          totalPrice: acc.totalPrice + Number(row.totalPrice || 0),
        }),
        { jobs: 0, paidJobs: 0, revenue: 0, cash: 0, mpesa: 0, totalPrice: 0 }
      ),
    [rows]
  );

  const handlePrint = useCallback(() => {
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    const printed = printTabularList({
      title: "Service Performance Report",
      subtitle: `Period: ${applied.from} to ${applied.to}${applied.category ? ` · Category: ${applied.category}` : ""}`,
      company: currentCompany,
      summaryItems: [["Service types", String(serviceCount)], ["Total jobs", String(totalJobs)], ["Total revenue", fmt(totalRevenue)], ["Avg / job", fmt(avgJobValue)]],
      columns: [
        { label: "#", value: (row, i) => i + 1 },
        { label: "Service", bold: true, value: (row) => row.service || row.serviceType || "—" },
        { label: "Jobs", align: "right", value: (row) => row.jobs },
        { label: "Paid", align: "right", value: (row) => row.paidJobs },
        { label: "Revenue", align: "right", bold: true, value: (row) => fmt(row.revenue) },
        { label: "Cash", align: "right", value: (row) => fmt(row.cash) },
        { label: "M-Pesa", align: "right", value: (row) => fmt(row.mpesa) },
        { label: "Avg Price", align: "right", value: (row) => fmt(row.totalPrice && row.jobs ? row.totalPrice / row.jobs : row.revenue / Math.max(row.jobs || 1, 1)) },
        { label: "% Rev", align: "right", value: (row) => (totalRevenue > 0 ? `${((Number(row.revenue || 0) / totalRevenue) * 100).toFixed(1)}%` : "0%") },
      ],
      rows,
      totalsRow: ["", "TOTALS", String(totals.jobs), String(totals.paidJobs), fmt(totals.revenue), fmt(totals.cash), fmt(totals.mpesa), "", "100%"],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [currentCompany, rows, totals, totalJobs, totalRevenue, serviceCount, avgJobValue, applied]);

  const submit = (event) => {
    event.preventDefault();
    setApplied({ from, to, category });
  };

  return (
    <CarWashShell
      title="Service Income Report"
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={handlePrint} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaPrint />
            Print
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="mb-2 grid gap-2 border border-slate-200 bg-white p-2 shadow-sm grid-cols-1 sm:grid-cols-2 lg:grid-cols-[160px_160px_180px_1fr_auto_auto]">
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
        <AppSelect
          size="sm"
          clearable
          searchable
          placeholder="All categories"
          value={category}
          onChange={(v) => setCategory(v ?? "")}
          options={categoryOptions}
        />
        <input
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          placeholder="Filter by service name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch />
          Search
        </button>
        <button
          type="button"
          onClick={() => { setFrom(startOfMonthISO()); setTo(todayISO()); setSearch(""); setCategory(""); setApplied({ from: startOfMonthISO(), to: todayISO(), category: "" }); }}
          className="inline-flex h-8 items-center justify-center gap-1.5 bg-[#0B3B2E] px-4 text-xs font-bold text-white hover:bg-[#0A3127]"
        >
          <FaRedoAlt />
          Reset
        </button>
      </form>

      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 border border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
        <span>Period: <strong className="text-slate-900">{period ? `${period.from} → ${period.to}` : "—"}</strong></span>
        {!activeBranchId && <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold normal-case text-slate-500 tracking-normal">All Branches</span>}
        <span>Services: <strong className="text-[#0B3B2E]">{serviceCount}</strong></span>
        <span>Total Jobs: <strong className="text-[#0B3B2E]">{totalJobs}</strong></span>
        <span>Total Revenue: <strong className="text-[#0B3B2E]">{formatMoney(totalRevenue)}</strong></span>
        <span>Avg Job Value: <strong className="text-[#0B3B2E]">{formatMoney(avgJobValue)}</strong></span>
        {applied.category && <span>Category: <strong className="text-[#FF8C00]">{applied.category}</strong></span>}
        {search && <span>Filtered: <strong className="text-[#FF8C00]">{rows.length}</strong></span>}
      </div>

      <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1000px] text-xs">
          <thead className="bg-[#0B3B2E] text-white">
            <tr>
              <th className="w-8 px-2 py-1.5 text-center font-bold uppercase tracking-wide">#</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Service</th>
              <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Jobs</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Paid</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Revenue</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Cash</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">M-Pesa</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Avg / Job</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">% Rev</th>
              <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">% Jobs</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={row.service} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1.5 text-center font-bold text-slate-500">{index + 1}</td>
                  <td className="px-2 py-1.5 font-extrabold text-slate-900">{row.service}</td>
                  <td className="px-2 py-1.5 text-slate-600">{row.category || <span className="text-slate-400">—</span>}</td>
                  <td className="px-2 py-1.5 text-right font-extrabold text-slate-900">{row.jobs}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">{row.paidJobs}</td>
                  <td className="px-2 py-1.5 text-right font-extrabold text-slate-900">{formatMoney(row.revenue)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-700">{formatMoney(row.cash)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-700">{formatMoney(row.mpesa)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-700">{formatMoney(row.avgRevenue)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[#0B3B2E]" style={{ width: `${Math.min(row.revenueShare, 100)}%` }} />
                      </div>
                      <span className="font-bold text-[#0B3B2E]">{pct(row.revenueShare)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-bold text-slate-600">{pct(row.jobShare)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-xs font-semibold text-slate-500">
                  {loading ? "Loading…" : "No service data found for this period."}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-[#0B3B2E] bg-[#EDF5F1]">
              <tr>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">
                  Total ({rows.length} service{rows.length !== 1 ? "s" : ""})
                </td>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{totals.jobs}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-emerald-700">{totals.paidJobs}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{formatMoney(totals.revenue)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{formatMoney(totals.cash)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-extrabold text-slate-900">{formatMoney(totals.mpesa)}</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-semibold text-slate-700">
                  {formatMoney(totals.jobs ? totals.revenue / totals.jobs : 0)}
                </td>
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-[#0B3B2E]">100%</td>
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-slate-600">100%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </CarWashShell>
  );
};

export default CarWashServiceReport;
