import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaSyncAlt } from "react-icons/fa";
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import ListToolbar from "../../components/common/ListToolbar";
import MilikTable from "../../components/common/MilikTable";
import { useTabState } from "../../hooks/useTabState";
import { getTagSummaryReport } from "../../redux/apiCalls";
import { selectCurrentCompany } from "../../redux/selectors";
import { hasCompanyModule } from "../../utils/companyModules";

// Income and expenses per tag put on journal lines (cost centre for everyone; project, unit, deal, agent, property where
// the company has them). Only tagged lines count, so a tag with nothing posted to it simply does not appear.
const fmt = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

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
        <ListToolbar>
          <h1 className="mr-3 shrink-0 text-xs font-black text-slate-900">Profit by tag</h1>
          <AppSelect value={by} onChange={(v) => setBy(v || "costCentre")} options={groupOptions} compact className="shrink-0" />
          <ListToolbar.Input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="shrink-0 text-[9px] text-slate-400">to</span>
          <ListToolbar.Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          <ListToolbar.Button variant="outline" onClick={load} disabled={loading}>
            <FaSyncAlt size={7} className={loading ? "animate-spin" : ""} /> Refresh
          </ListToolbar.Button>
        </ListToolbar>

        <div className="min-h-0 flex-1 overflow-hidden p-3 flex flex-col">
          <div className="min-h-0 flex-1 border border-slate-200 bg-white shadow-sm flex flex-col overflow-hidden">
            <MilikTable
              minWidth="560px"
              columns={[
                { label },
                { label: "Income (KES)", align: "right" },
                { label: "Expenses (KES)", align: "right" },
                { label: "Net (KES)", align: "right" },
              ]}
              rows={rows}
              rowKey="key"
              loading={loading && !report}
              empty={`Nothing is tagged with a ${label.toLowerCase()} in this period. Tag journal lines (the tag button on each line) to see income and costs per ${label.toLowerCase()} here.`}
              renderRow={(r) => (
                <>
                  <td className="px-3 py-1.5 font-semibold text-slate-800">{r.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.income)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.expenses)}</td>
                  <td className={`px-3 py-1.5 text-right font-bold tabular-nums ${net(r.net)}`}>{fmt(r.net)}</td>
                </>
              )}
              renderFooter={() => (
                <>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.income)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(totals.expenses)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${net(totals.net)}`}>{fmt(totals.net)}</td>
                </>
              )}
            />
          </div>
          <p className="mt-2 flex-none text-[11px] text-slate-500">
            Counts only income and expense accounts on lines carrying this tag. Reversed journals net out; untagged postings are not shown.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ProfitByTagReport;
