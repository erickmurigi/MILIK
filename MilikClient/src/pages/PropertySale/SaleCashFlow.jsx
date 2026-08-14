import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { FaExclamationTriangle } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";

const fmt = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const BUCKET_META = [
  { key: "overdue",  label: "Overdue",      color: "rose",    bar: "bg-rose-500" },
  { key: "next30",   label: "Next 30 days", color: "amber",   bar: "bg-amber-500" },
  { key: "next60",   label: "31–60 days",   color: "blue",    bar: "bg-blue-500" },
  { key: "next90",   label: "61–90 days",   color: "violet",  bar: "bg-violet-500" },
  { key: "beyond90", label: "90+ days",     color: "slate",   bar: "bg-slate-400" },
];

const colorMap = {
  rose:   { border: "border-rose-200",   bg: "bg-rose-50",   text: "text-rose-700",   head: "bg-rose-100" },
  amber:  { border: "border-amber-200",  bg: "bg-amber-50",  text: "text-amber-700",  head: "bg-amber-100" },
  blue:   { border: "border-blue-200",   bg: "bg-blue-50",   text: "text-blue-700",   head: "bg-blue-100" },
  violet: { border: "border-violet-200", bg: "bg-violet-50", text: "text-violet-700", head: "bg-violet-100" },
  slate:  { border: "border-slate-200",  bg: "bg-slate-50",  text: "text-slate-600",  head: "bg-slate-100" },
};

export default function SaleCashFlow() {
  const biz = useSelector((s) => s.company?.currentCompany?._id);
  const [expanded, setExpanded] = useState("overdue");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-cash-flow", biz],
    queryFn:  () => saleApi.getCashFlowForecast({ business: biz }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  const total = data?.totalPipeline ?? 0;

  const pct = (amount) => total > 0 ? Math.round((amount / total) * 100) : 0;

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={
          <span className="shrink-0 font-mono text-[10px] font-black text-slate-500">
            Pipeline: {fmtKES(total)}
          </span>
        }
        trailing={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 border border-[#B7C9C0] bg-white px-3 py-1.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:opacity-50"
          >
            {isFetching ? "…" : "Refresh"}
          </button>
        }
      />

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-400">Loading cash flow…</div>
      ) : (
        <div className="space-y-2 px-1 pb-4">
          {/* Summary bar chart */}
          <div className="mb-4 flex h-3 w-full overflow-hidden rounded-none gap-px">
            {BUCKET_META.map(({ key, bar }) => {
              const w = pct(data?.[key]?.amount ?? 0);
              return w > 0 ? (
                <div key={key} className={`${bar} shrink-0`} style={{ width: `${w}%` }} title={`${key}: ${w}%`} />
              ) : null;
            })}
          </div>

          {BUCKET_META.map(({ key, label, color }) => {
            const bucket = data?.[key] ?? { count: 0, amount: 0, items: [] };
            const c = colorMap[color];
            const isOpen = expanded === key;
            return (
              <div key={key} className={`border ${c.border} bg-white`}>
                <button
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left ${isOpen ? c.head : "hover:bg-slate-50"}`}
                  onClick={() => setExpanded(isOpen ? null : key)}
                >
                  <div className="flex items-center gap-2">
                    {key === "overdue" && bucket.count > 0 && <FaExclamationTriangle size={11} className="text-rose-500" />}
                    <span className={`text-xs font-black uppercase tracking-wide ${c.text}`}>{label}</span>
                    <span className="text-[10px] font-mono text-slate-400">{bucket.count} item{bucket.count !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-black tabular-nums ${c.text}`}>{fmtKES(bucket.amount)}</span>
                    <span className="text-[10px] text-slate-400">{isOpen ? "▲" : "▼"}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="overflow-x-auto border-t border-slate-100">
                    {bucket.items.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-slate-400">No items in this bucket.</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                            <th className="px-3 py-2 text-left">Due Date</th>
                            <th className="px-3 py-2 text-left">Deal</th>
                            <th className="px-3 py-2 text-left">Buyer</th>
                            <th className="px-3 py-2 text-left">Listing</th>
                            <th className="px-3 py-2 text-right">Expected (KES)</th>
                            <th className="px-3 py-2 text-left">Label</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bucket.items.map((item) => (
                            <tr key={item._id} className="border-b border-slate-50 hover:bg-slate-50">
                              <td className="whitespace-nowrap px-3 py-2 font-mono">{fmt(item.dueDate)}</td>
                              <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-slate-500">{item.deal?.dealNumber ?? "—"}</td>
                              <td className="px-3 py-2 max-w-[140px] truncate">{item.deal?.buyer?.fullName ?? "—"}</td>
                              <td className="px-3 py-2 max-w-[160px] truncate">{item.deal?.listing?.title ?? "—"}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmtKES(item.expectedAmount)}</td>
                              <td className="px-3 py-2 text-slate-500">{item.label ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PropertySaleShell>
  );
}
