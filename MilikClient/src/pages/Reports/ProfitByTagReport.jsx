import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaSyncAlt } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { useTabState } from "../../hooks/useTabState";
import { getTagSummaryReport } from "../../redux/apiCalls";
import { selectCurrentCompany } from "../../redux/selectors";
import { hasCompanyModule } from "../../utils/companyModules";

// Income and expenses per tag put on journal lines (cost centre for everyone; project, unit, deal, agent, property where
// the company has them). Only tagged lines count, so a tag with nothing posted to it simply does not appear.
const fmt = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inputCls = "h-7 rounded border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#0B3B2E]";

const ProfitByTagReport = () => {
  const company = useSelector(selectCurrentCompany);
  const hasSales = hasCompanyModule(company, "propertySale");
  const hasPM = hasCompanyModule(company, "propertyManagement");
  const groupOptions = useMemo(() => [
    { value: "costCentre", label: "Cost centre" },
    ...(hasSales ? [
      { value: "project", label: "Project" }, { value: "listing", label: "Unit / listing" },
      { value: "deal", label: "Deal" }, { value: "agent", label: "Agent" },
    ] : []),
    ...(hasPM ? [{ value: "property", label: "Property" }] : []),
  ], [hasSales, hasPM]);

  const [by, setBy] = useTabState("/accounts/profit-by-tag:by", "costCentre");
  const [startDate, setStartDate] = useTabState("/accounts/profit-by-tag:start", () => ymd(new Date(new Date().getFullYear(), 0, 1)));
  const [endDate, setEndDate] = useTabState("/accounts/profit-by-tag:end", () => ymd(new Date()));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!company?._id) return;
    setLoading(true);
    try {
      setReport(await getTagSummaryReport({ business: company._id, by, startDate, endDate }));
    } catch (error) {
      toast.error(error?.response?.data?.message || "Failed to load the report");
    } finally {
      setLoading(false);
    }
  }, [company?._id, by, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const label = groupOptions.find((o) => o.value === by)?.label || "Tag";
  const rows = report?.rows || [];
  const totals = report?.totals || { income: 0, expenses: 0, net: 0 };
  const net = (v) => (v < 0 ? "text-red-600" : "text-emerald-700");

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <h1 className="mr-3 text-sm font-black text-slate-900">Profit by tag</h1>
          <AppSelect value={by} onChange={(v) => setBy(v || "costCentre")} options={groupOptions} size="sm" />
          <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
          <button type="button" onClick={load} disabled={loading} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <FaSyncAlt size={10} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="overflow-x-auto border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">{label}</th>
                  <th className="px-3 py-2 text-right font-bold">Income (KES)</th>
                  <th className="px-3 py-2 text-right font-bold">Expenses (KES)</th>
                  <th className="px-3 py-2 text-right font-bold">Net (KES)</th>
                </tr>
              </thead>
              <tbody>
                {loading && !report ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                    Nothing is tagged with a {label.toLowerCase()} in this period. Tag journal lines (the tag button on each line) to see income and costs per {label.toLowerCase()} here.
                  </td></tr>
                ) : rows.map((r, i) => (
                  <tr key={r.key} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>
                    <td className="px-3 py-1.5 font-semibold text-slate-800">{r.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.income)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.expenses)}</td>
                    <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${net(r.net)}`}>{fmt(r.net)}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-100 font-black">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.income)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.expenses)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${net(totals.net)}`}>{fmt(totals.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Counts only income and expense accounts on lines carrying this tag. Reversed journals net out; untagged postings are not shown.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ProfitByTagReport;
