import React, { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaChartBar, FaSyncAlt } from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { selectCurrentCompany } from "../../redux/selectors";
import { getFinancialRatios } from "../../redux/apiCalls";

const GRN = "#0B3B2E";

const fmtNum = (n) =>
  n === null || n === undefined
    ? "N/A"
    : Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtKES = (n) => `KES ${fmtNum(n)}`;

const HEALTH_COLOR = {
  good: { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
  warn: { bar: "bg-amber-500",   text: "text-amber-700",   bg: "bg-amber-50"   },
  bad:  { bar: "bg-red-500",     text: "text-red-700",     bg: "bg-red-50"     },
};

const RatioCard = ({ label, value, suffix = "", note, health }) => {
  const c = HEALTH_COLOR[health] || { bar: "bg-slate-300", text: "text-slate-700", bg: "bg-slate-50" };
  const display = value === null || value === undefined ? "N/A" : `${fmtNum(value)}${suffix}`;
  return (
    <div className="flex flex-col border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className={`h-0.5 w-full ${c.bar}`} />
      <div className="flex flex-1 flex-col gap-1 px-4 py-3">
        <div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</div>
        <div className={`text-2xl font-black tracking-tight ${c.text}`}>{display}</div>
        {note && <div className="text-[9px] text-slate-400 leading-snug">{note}</div>}
      </div>
    </div>
  );
};

const DataRow = ({ label, value, bold, accent }) => (
  <div className={`flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0 ${bold ? "font-black" : ""}`}>
    <span className={`text-[11px] ${bold ? "text-slate-800" : "text-slate-500"}`}>{label}</span>
    <span className={`text-[11px] font-bold ${accent ? accent : bold ? "text-slate-900" : "text-slate-700"}`}>{fmtKES(value)}</span>
  </div>
);

const TableCard = ({ title, children }) => (
  <div className="border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-100 px-4 py-2" style={{ borderLeftWidth: 3, borderLeftColor: GRN }}>
      <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-600">{title}</div>
    </div>
    <div className="px-4 py-2">{children}</div>
  </div>
);

export default function FinancialRatiosDashboard() {
  const company = useSelector(selectCurrentCompany);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    if (!company?._id) return;
    setLoading(true);
    try {
      const res = await getFinancialRatios({ business: company._id });
      setData(res);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load financial ratios");
    } finally {
      setLoading(false);
    }
  }, [company?._id]);

  useEffect(() => { load(); }, [load]);

  const { ratios = {}, components = {} } = data || {};

  const currentRatioHealth =
    ratios.currentRatio == null ? null :
    ratios.currentRatio >= 2    ? "good" :
    ratios.currentRatio >= 1    ? "warn" : "bad";

  const debtEquityHealth =
    ratios.debtToEquity == null ? null :
    ratios.debtToEquity <= 1    ? "good" :
    ratios.debtToEquity <= 2    ? "warn" : "bad";

  const roaHealth =
    ratios.returnOnAssets == null ? null :
    ratios.returnOnAssets > 5     ? "good" :
    ratios.returnOnAssets > 0     ? "warn" : "bad";

  const grossHealth =
    ratios.grossMargin == null ? null :
    ratios.grossMargin > 30    ? "good" :
    ratios.grossMargin > 0     ? "warn" : "bad";

  const netHealth =
    ratios.netMargin == null ? null :
    ratios.netMargin > 10    ? "good" :
    ratios.netMargin > 0     ? "warn" : "bad";

  const totalAssets = (components.currentAssets || 0) + (components.nonCurrentAssets || 0);

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-slate-100">
        {/* Sticky toolbar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
          <FaChartBar size={12} style={{ color: GRN }} />
          <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: GRN }}>
            Financial Ratios
          </span>
          <span className="text-[10px] text-slate-400">— Computed from current GL balances</span>
          <div className="ml-auto">
            <button
              onClick={load}
              disabled={loading}
              className="flex h-7 items-center gap-1.5 border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <FaSyncAlt size={9} className={loading ? "animate-spin" : ""} />
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {loading && !data && (
            <div className="py-20 text-center text-[11px] text-slate-400">Loading ratios…</div>
          )}

          {!loading && !data && (
            <div className="border border-dashed border-slate-300 py-20 text-center">
              <FaChartBar size={28} className="mx-auto mb-3 text-slate-300" />
              <p className="text-[11px] text-slate-400">No GL data found — ensure ledger entries exist.</p>
            </div>
          )}

          {data && (
            <>
              {/* Ratio cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <RatioCard label="Current Ratio"    value={ratios.currentRatio}    health={currentRatioHealth} note="≥2 is healthy" />
                <RatioCard label="Debt-to-Equity"   value={ratios.debtToEquity}    health={debtEquityHealth}   note="≤1 is conservative" />
                <RatioCard label="Return on Assets" value={ratios.returnOnAssets}  health={roaHealth}          note="% — higher is better" suffix="%" />
                <RatioCard label="Gross Margin"     value={ratios.grossMargin}     health={grossHealth}        note="% — >30% is strong"  suffix="%" />
                <RatioCard label="Net Profit Margin" value={ratios.netMargin}      health={netHealth}          note="% — >10% is solid"   suffix="%" />
              </div>

              {/* Component tables */}
              <div className="grid gap-4 lg:grid-cols-3">
                <TableCard title="Assets">
                  <DataRow label="Current Assets"      value={components.currentAssets} />
                  <DataRow label="Non-current Assets"  value={components.nonCurrentAssets} />
                  <DataRow label="Total Assets"        value={totalAssets} bold accent="text-emerald-700" />
                </TableCard>

                <TableCard title="Liabilities & Equity">
                  <DataRow label="Current Liabilities"     value={components.currentLiabilities} />
                  <DataRow label="Non-current Liabilities" value={components.nonCurrentLiabilities} />
                  <DataRow label="Total Equity"            value={components.totalEquity} bold />
                </TableCard>

                <TableCard title="Income Statement">
                  <DataRow label="Total Revenue"   value={components.totalRevenue} />
                  <DataRow label="Total Income"    value={components.totalIncome} />
                  <DataRow label="Gross Profit"    value={components.grossProfit} />
                  <DataRow label="Total Expenses"  value={components.totalExpenses} />
                  <DataRow
                    label="Net Income"
                    value={components.netIncome}
                    bold
                    accent={(components.netIncome || 0) >= 0 ? "text-emerald-700" : "text-red-700"}
                  />
                </TableCard>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
