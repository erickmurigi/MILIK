import React, { useMemo } from "react";
import { fmtKES } from "../../services/propertySaleApi";
import { fmtPct } from "./SaleProjectShared";

const monthLabel = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleString("en-KE", { month: "short" });
};

const Stat = ({ label, value, hint }) => (
  <div className="border border-slate-200 bg-white px-3 py-2">
    <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</div>
    <div className="mt-0.5 text-sm font-black tabular-nums text-slate-900">{value}</div>
    {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
  </div>
);

// 12-month booked vs closed bars (plain CSS, no chart library), realisation / days-to-sell and the per-agent table
const SaleProjectPerformance = React.memo(function SaleProjectPerformance({ performance, terms }) {
  const months = useMemo(() => {
    const rows = performance?.monthly ?? [];
    const max = Math.max(1, ...rows.map((m) => Math.max(m.booked, m.closed)));
    return rows.map((m) => ({ ...m, label: monthLabel(m.month), bookedH: (m.booked / max) * 100, closedH: (m.closed / max) * 100 }));
  }, [performance?.monthly]);

  if (!performance) return null;
  const scoped = performance.scoped;
  const hasActivity = months.some((m) => m.booked || m.closed);
  const dealsLower = terms.saleDeals.toLowerCase();

  return (
    <div className="space-y-2 p-2">
      {scoped && (
        <div className="border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700">
          Your figures — only your own {dealsLower} and payments are counted here.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Price realisation" value={fmtPct(performance.priceRealisation)} hint="Agreed price vs asking price" />
        <Stat label="Avg days to sell" value={performance.avgDaysToSell == null ? "—" : `${performance.avgDaysToSell} days`} hint="Listed to closed" />
        <Stat label={`Closed ${dealsLower}`} value={performance.closedDeals} hint={fmtKES(performance.closedValue)} />
        <Stat label="Collected" value={fmtKES(performance.collected)} hint={`of ${fmtKES(performance.booked)} booked`} />
      </div>

      <div className="border border-slate-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Last 12 months</div>
          <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 bg-[#7FA596]" /> Booked</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 bg-[#0B3B2E]" /> Closed</span>
          </div>
        </div>
        {hasActivity ? (
          <div className="grid grid-cols-12 gap-1">
            {months.map((m) => (
              <div key={m.month} className="flex flex-col items-center" title={`${m.month}: ${m.booked} booked (${fmtKES(m.bookedValue)}), ${m.closed} closed (${fmtKES(m.closedValue)})`}>
                <div className="flex h-32 w-full items-end justify-center gap-0.5 border-b border-slate-200">
                  <div className="flex h-full w-2.5 flex-col justify-end sm:w-4">
                    {m.booked > 0 && <span className="mb-0.5 text-center text-[9px] font-bold text-slate-500">{m.booked}</span>}
                    <div className="bg-[#7FA596]" style={{ height: `${m.bookedH}%` }} />
                  </div>
                  <div className="flex h-full w-2.5 flex-col justify-end sm:w-4">
                    {m.closed > 0 && <span className="mb-0.5 text-center text-[9px] font-bold text-[#0B3B2E]">{m.closed}</span>}
                    <div className="bg-[#0B3B2E]" style={{ height: `${m.closedH}%` }} />
                  </div>
                </div>
                <div className="mt-1 text-[9px] font-semibold uppercase text-slate-400">{m.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs font-semibold text-slate-400">No {dealsLower} in the last 12 months.</div>
        )}
      </div>

      <div className="border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
          By {terms.saleAgent.toLowerCase()}{scoped ? " (your figures)" : ""}
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-[#0B3B2E] text-white">
              <th className="px-3 py-1.5 text-left text-[10px] font-black uppercase tracking-widest">{terms.saleAgent}</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-black uppercase tracking-widest">{terms.saleDeals}</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-black uppercase tracking-widest">Closed</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-black uppercase tracking-widest">Value</th>
            </tr>
          </thead>
          <tbody>
            {(performance.byAgent ?? []).length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-xs font-semibold text-slate-400">No {dealsLower} yet.</td></tr>
            ) : performance.byAgent.map((a) => (
              <tr key={a.agent?._id} className="border-b border-gray-100 hover:bg-[#EBF5EF]">
                <td className="px-3 py-1.5 font-semibold text-slate-800">
                  {a.agent?.fullName}{a.agent?.agentNumber && <span className="ml-1.5 font-mono text-[10px] font-bold text-slate-400">{a.agent.agentNumber}</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{a.deals}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{a.closed}</td>
                <td className="px-3 py-1.5 text-right font-bold tabular-nums">{fmtKES(a.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default SaleProjectPerformance;
