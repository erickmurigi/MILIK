import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { FaPrint, FaRedoAlt, FaSearch } from "react-icons/fa";
import { carWashApi, formatMoney, getActiveBranchId } from "../../services/carWashApi";
import { selectCurrentCompany } from "../../redux/selectors";
import CarWashShell from "./CarWashShell";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const localISO = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const monthStart = () => { const n = new Date(); return localISO(new Date(n.getFullYear(), n.getMonth(), 1)); };
const todayISO   = () => localISO(new Date());

const pct      = (val, total) => (total > 0 ? `${((val / total) * 100).toFixed(1)}%` : "0%");
const pctWidth = (val, total) => (total > 0 ? Math.max((val / total) * 100, 0) : 0);

const CarWashExpensesReport = () => {
  const isConsolidated = !getActiveBranchId();
  const currentCompany = useSelector(selectCurrentCompany);

  const [from,    setFrom]    = useState(monthStart());
  const [to,      setTo]      = useState(todayISO());
  const [applied, setApplied] = useState({ from: monthStart(), to: todayISO() });
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await carWashApi.getExpensesReport({ startDate: applied.from, endDate: applied.to });
      setData(res?.data || res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => { load(); }, [load]);

  const applyFilters = (e) => { e.preventDefault(); setApplied({ from, to }); };

  const handlePrint = useCallback(() => {
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const win = window.open('', '_blank', 'width=900,height=800');
    if (!win) return;
    const fmtV = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    const tot = Number(data?.total || 0);
    const pctStr = (v) => (tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : '0%');
    win.document.write(`<!DOCTYPE html><html><head><title>Car Wash Expenses Report</title><style>
      @page{size:A4 portrait;margin:14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:8px 10px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:14px;font-weight:900;color:#0B3B2E;margin-top:3px}
      h3{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;font-weight:900;margin:12px 0 5px}
      table{width:100%;border-collapse:collapse;font-size:9px;margin-bottom:10px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 8px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:4px 8px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 8px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Car Wash Expenses Report</div><div class="sub">Period: ${applied.from} to ${applied.to}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Total Paid Expenses</div><div class="cv">${fmtV(data?.total)}</div></div>
      <div class="card"><div class="cl">Expense Count</div><div class="cv">${data?.count || 0}</div></div>
    </div>
    ${(data?.byCategory || []).length > 0 ? `<h3>By Category</h3><table><thead><tr><th>Category</th><th class="r">Amount</th><th class="r">Count</th><th class="r">Share</th></tr></thead><tbody>${(data.byCategory || []).map((row) => `<tr><td>${row.category}</td><td class="r">${fmtV(row.amount)}</td><td class="r">${row.count}</td><td class="r">${pctStr(row.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><td><strong>Total</strong></td><td class="r"><strong>${fmtV(tot)}</strong></td><td class="r"><strong>${data?.count || 0}</strong></td><td class="r">100%</td></tr></tfoot></table>` : ''}
    ${(data?.byMethod || []).length > 0 ? `<h3>By Payment Method</h3><table><thead><tr><th>Method</th><th class="r">Amount</th><th class="r">Count</th></tr></thead><tbody>${(data.byMethod || []).map((row) => `<tr><td>${row.method}</td><td class="r">${fmtV(row.amount)}</td><td class="r">${row.count}</td></tr>`).join('')}</tbody></table>` : ''}
    ${isConsolidated && (data?.byBranch || []).length > 0 ? `<h3>By Branch</h3><table><thead><tr><th>Branch</th><th class="r">Amount</th><th class="r">Count</th></tr></thead><tbody>${(data.byBranch || []).map((row) => `<tr><td>${row.branch}</td><td class="r">${fmtV(row.amount)}</td><td class="r">${row.count}</td></tr>`).join('')}</tbody></table>` : ''}
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [currentCompany, data, applied, isConsolidated]);

  const fmtPeriod = (iso) =>
    new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <CarWashShell
      title="Expenses Report"
      action={
        <>
          <button type="button" onClick={load}
            className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={handlePrint}
            className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaPrint /> Print
          </button>
        </>
      }
    >
      {/* Filter bar */}
      <form onSubmit={applyFilters}
        className="mb-2 flex-shrink-0 flex flex-wrap items-center gap-2 border border-slate-200 bg-white p-2 shadow-sm">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">From</span>
        <input type="date"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">To</span>
        <input type="date"
          className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
          value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="submit"
          className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch /> Run Report
        </button>
      </form>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {loading && !data && (
          <div className="py-12 text-center text-xs font-semibold text-slate-500">Loading report…</div>
        )}

        {data && (
          <>
            {/* Summary cards */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Total Paid Expenses</p>
                <p className="mt-1 text-3xl font-black text-[#0B3B2E]">{formatMoney(data.total || 0)}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {data.count || 0} expense{(data.count || 0) !== 1 ? "s" : ""} · paid status only
                </p>
              </div>
              <div className="border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Period</p>
                <p className="mt-1 text-base font-bold text-slate-800">
                  {fmtPeriod(applied.from)} — {fmtPeriod(applied.to)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Avg per expense:{" "}
                  {(data.count || 0) > 0 ? formatMoney(Math.round((data.total || 0) / data.count)) : "—"}
                </p>
              </div>
            </div>

            {/* By Category */}
            {data.byCategory?.length > 0 && (
              <div className="border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
                  <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">By Category</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Count</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Share</th>
                        <th className="w-40 px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.byCategory.map((row, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-semibold text-slate-800">{row.category}</td>
                          <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">
                            {formatMoney(row.amount)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-500">
                            {pct(row.amount, data.total)}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="h-2 w-full bg-slate-100">
                              <div className="h-2 bg-[#C8511A]" style={{ width: `${pctWidth(row.amount, data.total)}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td className="px-2 py-1.5 font-extrabold uppercase text-slate-700">Total</td>
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-slate-900">
                          {formatMoney(data.total)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-slate-700">
                          {data.count}
                        </td>
                        <td className="px-2 py-1.5 text-right font-extrabold text-slate-700">100%</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* By Method + By Branch */}
            <div className="grid gap-3 md:grid-cols-2">
              {data.byMethod?.length > 0 && (
                <div className="border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
                    <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">By Payment Method</h2>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byMethod.map((row, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-bold uppercase text-slate-800">{row.method}</td>
                          <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">
                            {formatMoney(row.amount)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {isConsolidated && data.byBranch?.length > 0 && (
                <div className="border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
                    <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">By Branch</h2>
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Branch</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byBranch.map((row, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-semibold text-slate-800">{row.branchName}</td>
                          <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">
                            {formatMoney(row.amount)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Monthly Trend */}
            {data.byMonth?.length > 0 && (
              <div className="border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
                  <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">Monthly Trend</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-xs">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Month</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Count</th>
                        <th className="w-48 px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const maxAmt = Math.max(...data.byMonth.map((m) => m.amount), 1);
                        return data.byMonth.map((row, i) => (
                          <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1.5 font-semibold text-slate-800">
                              {MONTH_NAMES[(row.month || 1) - 1]} {row.year}
                            </td>
                            <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">
                              {formatMoney(row.amount)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                            <td className="px-2 py-1.5">
                              <div className="h-2 w-full bg-slate-100">
                                <div className="h-2 bg-[#0B3B2E]" style={{ width: `${(row.amount / maxAmt) * 100}%` }} />
                              </div>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!data.total && !loading && (
              <div className="py-12 text-center text-xs font-semibold text-slate-500">
                No paid expenses found for the selected period.
              </div>
            )}
          </>
        )}
      </div>
    </CarWashShell>
  );
};

export default CarWashExpensesReport;
