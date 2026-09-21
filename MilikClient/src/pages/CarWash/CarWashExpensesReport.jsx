import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { FaPrint, FaRedoAlt, FaSearch } from "react-icons/fa";
import { carWashApi, formatMoney, getActiveBranchId } from "../../services/carWashApi";
import { selectCurrentCompany } from "../../redux/selectors";
import CarWashShell from "./CarWashShell";
import { fmtDate, todayISO } from "../../utils/dates";
import { printTabularList } from "../../utils/printList";
import { toast } from "react-toastify";

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const localISO = (d) => {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const monthStart = () => { const n = new Date(); return localISO(new Date(n.getFullYear(), n.getMonth(), 1)); };

const pct      = (val, total) => (total > 0 ? `${((val / total) * 100).toFixed(1)}%` : "0%");
const pctWidth = (val, total) => (total > 0 ? Math.max((val / total) * 100, 0) : 0);

const SectionHead = ({ children }) => (
  <div className="border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
    <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{children}</h2>
  </div>
);

const CarWashExpensesReport = () => {
  const isConsolidated = !getActiveBranchId();
  const currentCompany = useSelector(selectCurrentCompany);

  const [from,    setFrom]    = useTabState("/carwash/reports/expenses:from", () => monthStart());
  const [to,      setTo]      = useTabState("/carwash/reports/expenses:to", () => todayISO());
  const [applied, setApplied] = useTabState("/carwash/reports/expenses:applied", () => ({ from: monthStart(), to: todayISO() }));
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

  const dailyAvg = useMemo(() => {
    if (!data?.total || !data?.count) return null;
    const days = Math.max(
      Math.round((new Date(applied.to) - new Date(applied.from)) / 86400000) + 1,
      1
    );
    return Math.round(data.total / days);
  }, [data, applied]);

  const handlePrint = useCallback(() => {
    const fmtV = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    const tot = Number(data?.total || 0);
    const pctStr = (v) => (tot > 0 ? `${((v / tot) * 100).toFixed(1)}%` : "0%");
    const amountCol = { label: "Amount", align: "right", value: (r) => fmtV(r.amount) };
    const countCol = { label: "Count", align: "right", value: (r) => r.count };
    const section = (heading, list, first, extra = {}) => (list || []).length > 0
      ? [{ heading, columns: [first, amountCol, countCol], rows: list, half: true, ...extra }]
      : [];
    const printed = printTabularList({
      title: "Car Wash Expenses Report",
      subtitle: `Period: ${applied.from} to ${applied.to}`,
      company: currentCompany,
      orientation: "portrait",
      summaryItems: [["Total paid", fmtV(data?.total)], ["Expense count", String(data?.count || 0)], ["Pending obligations", fmtV(data?.pending?.total)]],
      columns: [],
      sections: [
        ...((data?.byCategory || []).length > 0
          ? [{
              heading: "By category",
              columns: [
                { label: "Category", value: (r) => r.category },
                amountCol,
                countCol,
                { label: "Share", align: "right", value: (r) => pctStr(r.amount) },
              ],
              rows: data.byCategory,
              totalsRow: ["Total", fmtV(tot), String(data?.count || 0), "100%"],
            }]
          : []),
        ...section("By payment method", data?.byMethod, { label: "Method", value: (r) => r.method }),
        ...section("Top payees", data?.byPayee, { label: "Payee", value: (r) => r.payee }),
        ...(isConsolidated ? section("By branch", data?.byBranch, { label: "Branch", value: (r) => r.branchName }, { half: false }) : []),
        ...((data?.topExpenses || []).length > 0
          ? [{
              heading: "Top individual expenses",
              columns: [
                { label: "Ref", value: (e) => e.expenseNumber },
                { label: "Date", value: (e) => fmtDate(e.expenseDate) },
                { label: "Category", value: (e) => e.category },
                { label: "Payee", value: (e) => e.payee || "—" },
                { label: "Amount", align: "right", value: (e) => fmtV(e.amount) },
              ],
              rows: data.topExpenses,
            }]
          : []),
        ...section("Monthly trend", data?.byMonth, { label: "Month", value: (r) => `${MONTH_NAMES[(r.month || 1) - 1]} ${r.year}` }, { half: false }),
      ],
    });
    if (!printed) toast.error("Pop-up blocked — allow pop-ups for this site to print");
  }, [currentCompany, data, applied, isConsolidated]);

  const fmtPeriod = (iso) => new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });

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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Total Paid</p>
                <p className="mt-1 text-3xl font-black text-[#0B3B2E]">{formatMoney(data.total || 0)}</p>
                <p className="mt-0.5 text-xs text-slate-500">{data.count || 0} paid expense{(data.count || 0) !== 1 ? "s" : ""}</p>
              </div>
              <div className="border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Daily Average</p>
                <p className="mt-1 text-3xl font-black text-slate-700">{dailyAvg != null ? formatMoney(dailyAvg) : "—"}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {fmtPeriod(applied.from)} — {fmtPeriod(applied.to)}
                </p>
              </div>
              <div className="border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Avg Per Expense</p>
                <p className="mt-1 text-3xl font-black text-slate-700">
                  {(data.count || 0) > 0 ? formatMoney(Math.round((data.total || 0) / data.count)) : "—"}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">per transaction</p>
              </div>
              {(data.pending?.total > 0) && (
                <div className="border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-amber-600">Pending Obligations</p>
                  <p className="mt-1 text-3xl font-black text-amber-700">{formatMoney(data.pending.total)}</p>
                  <p className="mt-0.5 text-xs text-amber-600">
                    {data.pending.count} unpaid · draft + approved
                  </p>
                </div>
              )}
            </div>

            {/* By Category */}
            {data.byCategory?.length > 0 && (
              <div className="border border-slate-200 bg-white shadow-sm">
                <SectionHead>By Category</SectionHead>
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
                          <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">{formatMoney(row.amount)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-500">{pct(row.amount, data.total)}</td>
                          <td className="px-2 py-1.5">
                            <div className="h-2 w-full bg-slate-100">
                              <div className="h-2 bg-[#C8511A]" style={{ width: `${pctWidth(row.amount, data.total)}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td className="px-2 py-1.5 font-extrabold uppercase text-slate-700">Total</td>
                        <td className="px-2 py-1.5 text-right font-black tabular-nums text-slate-900">{formatMoney(data.total)}</td>
                        <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-slate-700">{data.count}</td>
                        <td className="px-2 py-1.5 text-right font-extrabold text-slate-700">100%</td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* By Method + By Payee */}
            <div className="grid gap-3 md:grid-cols-2">
              {data.byMethod?.length > 0 && (
                <div className="border border-slate-200 bg-white shadow-sm">
                  <SectionHead>By Payment Method</SectionHead>
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
                          <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">{formatMoney(row.amount)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.byPayee?.length > 0 && (
                <div className="border border-slate-200 bg-white shadow-sm">
                  <SectionHead>Top Payees</SectionHead>
                  <table className="w-full text-xs">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payee</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byPayee.map((row, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-semibold text-slate-800">{row.payee}</td>
                          <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">{formatMoney(row.amount)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* By Branch (consolidated only) */}
            {isConsolidated && data.byBranch?.length > 0 && (
              <div className="border border-slate-200 bg-white shadow-sm">
                <SectionHead>By Branch</SectionHead>
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
                        <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">{formatMoney(row.amount)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Top Individual Expenses */}
            {data.topExpenses?.length > 0 && (
              <div className="border border-slate-200 bg-white shadow-sm">
                <SectionHead>Top Individual Expenses</SectionHead>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-xs">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Ref</th>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Date</th>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Category</th>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Payee / Description</th>
                        <th className="px-2 py-1.5 text-right font-bold uppercase tracking-wide">Amount</th>
                        <th className="px-2 py-1.5 text-left font-bold uppercase tracking-wide">Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topExpenses.map((e, i) => (
                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-2 py-1.5 font-mono text-[10px] text-slate-500">{e.expenseNumber}</td>
                          <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{fmtDate(e.expenseDate)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{e.category}</td>
                          <td className="px-2 py-1.5 text-slate-700">{e.payee || e.description || "—"}</td>
                          <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-[#C8511A]">{formatMoney(e.amount)}</td>
                          <td className="px-2 py-1.5 uppercase text-slate-500">{e.method}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Monthly Trend */}
            {data.byMonth?.length > 0 && (
              <div className="border border-slate-200 bg-white shadow-sm">
                <SectionHead>Monthly Trend</SectionHead>
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
