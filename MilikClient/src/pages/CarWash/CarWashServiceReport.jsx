import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { FaPrint, FaRedoAlt, FaSearch } from "react-icons/fa";
import { carWashApi, formatMoney, getActiveBranchId, todayISO } from "../../services/carWashApi";
import { selectCurrentCompany } from "../../redux/selectors";
import CarWashShell from "./CarWashShell";

const startOfMonthISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

const CarWashServiceReport = () => {
  const currentCompany = useSelector(selectCurrentCompany);
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [applied, setApplied] = useState({ from: startOfMonthISO(), to: todayISO(), category: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    carWashApi.listServiceCategories()
      .then((result) => setCategories(Array.isArray(result) ? result : Array.isArray(result?.categories) ? result.categories : []))
      .catch(() => setCategories([]));
  }, []);

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
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) return;
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    win.document.write(`<!DOCTYPE html><html><head><title>Car Wash Service Report</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:12px;font-weight:900;color:#0f172a;margin-top:3px}
      table{width:100%;border-collapse:collapse;font-size:8.5px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 6px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Service Performance Report</div><div class="sub">Period: ${applied.from} to ${applied.to}${applied.category ? ` · Category: ${applied.category}` : ''}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div><div>Services: ${serviceCount}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Service Types</div><div class="cv">${serviceCount}</div></div>
      <div class="card"><div class="cl">Total Jobs</div><div class="cv">${totalJobs}</div></div>
      <div class="card"><div class="cl">Total Revenue</div><div class="cv" style="color:#0B3B2E">${fmt(totalRevenue)}</div></div>
      <div class="card"><div class="cl">Avg / Job</div><div class="cv">${fmt(avgJobValue)}</div></div>
    </div>
    <table><thead><tr><th>#</th><th>Service</th><th class="r">Jobs</th><th class="r">Paid</th><th class="r">Revenue</th><th class="r">Cash</th><th class="r">M-Pesa</th><th class="r">Avg Price</th><th class="r">% Rev</th></tr></thead>
    <tbody>${rows.map((row, i) => `<tr><td>${i + 1}</td><td><strong>${row.service || row.serviceType || '—'}</strong></td><td class="r">${row.jobs}</td><td class="r">${row.paidJobs}</td><td class="r">${fmt(row.revenue)}</td><td class="r">${fmt(row.cash)}</td><td class="r">${fmt(row.mpesa)}</td><td class="r">${fmt(row.totalPrice && row.jobs ? row.totalPrice / row.jobs : row.revenue / Math.max(row.jobs || 1, 1))}</td><td class="r">${totalRevenue > 0 ? `${((Number(row.revenue || 0) / totalRevenue) * 100).toFixed(1)}%` : '0%'}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="2"><strong>TOTALS</strong></td><td class="r">${totals.jobs}</td><td class="r">${totals.paidJobs}</td><td class="r"><strong>${fmt(totals.revenue)}</strong></td><td class="r">${fmt(totals.cash)}</td><td class="r">${fmt(totals.mpesa)}</td><td class="r"></td><td class="r">100%</td></tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
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
        <select
          className="h-8 border border-[#B7C9C0] bg-[#F1F6F3] px-2 text-xs font-bold text-[#0B3B2E] focus:border-[#0B3B2E] focus:outline-none"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
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
        {!getActiveBranchId() && <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold normal-case text-slate-500 tracking-normal">All Branches</span>}
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
