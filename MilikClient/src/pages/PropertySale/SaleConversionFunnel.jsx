import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import PropertySaleShell from "./PropertySaleShell";
import SaleFilterBar from "./SaleFilterBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

const LEAD_STATUSES = [
  { key: "new",           color: "bg-blue-400" },
  { key: "contacted",     color: "bg-sky-400" },
  { key: "qualified",     color: "bg-violet-400" },
  { key: "site_visited",  color: "bg-indigo-400" },
  { key: "proposal_sent", color: "bg-amber-400" },
  { key: "negotiating",   color: "bg-orange-400" },
  { key: "converted",     color: "bg-emerald-500" },
  { key: "lost",          color: "bg-rose-400" },
];

const OFFER_STATUSES = [
  { key: "pending",     color: "bg-amber-400" },
  { key: "negotiating", color: "bg-orange-400" },
  { key: "accepted",    color: "bg-emerald-500" },
  { key: "rejected",    color: "bg-rose-400" },
  { key: "expired",     color: "bg-slate-400" },
  { key: "withdrawn",   color: "bg-slate-300" },
];

function FunnelStep({ label, count, rate, rateLabel, color }) {
  const width = Math.max(12, rate);
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-right text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex-1">
        <div className="relative h-8 bg-slate-100">
          <div
            className={`${color} absolute left-0 top-0 h-full flex items-center px-3`}
            style={{ width: `${width}%` }}
          >
            <span className="text-xs font-black text-white whitespace-nowrap">{count.toLocaleString()}</span>
          </div>
        </div>
      </div>
      <div className="w-24 shrink-0 text-[10px] text-slate-400">{rateLabel}</div>
    </div>
  );
}

function RateCard({ label, value, note }) {
  return (
    <div className="border border-slate-200 bg-white px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums text-[#0B3B2E]">{value}%</div>
      {note && <div className="mt-0.5 text-[10px] text-slate-400">{note}</div>}
    </div>
  );
}

export default function SaleConversionFunnel() {
  const biz = useSelector((s) => s.company?.currentCompany?._id);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["sale-funnel", biz],
    queryFn:  () => saleApi.getConversionFunnel({ business: biz }),
    enabled:  !!biz,
    staleTime: 60_000,
  });

  const leads  = data?.leads  ?? {};
  const offers = data?.offers ?? {};
  const deals  = data?.deals  ?? {};
  const rates  = data?.rates  ?? {};

  const maxCount = Math.max(leads.total || 0, offers.total || 0, deals.total || 0, 1);

  return (
    <PropertySaleShell>
      <SaleFilterBar
        leading={
          <span className="shrink-0 font-mono text-[10px] font-black text-slate-500">
            {leads.total ?? 0}L → {offers.total ?? 0}O → {deals.total ?? 0}D
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
        <div className="py-12 text-center text-xs text-slate-400">Loading funnel…</div>
      ) : (
        <div className="space-y-6 px-1 pb-4">
          {/* KPI cards */}
          <div className="grid grid-cols-3 gap-2">
            <RateCard label="Leads → Offers" value={rates.leadsToOffers ?? 0} note={`${offers.total} of ${leads.total} leads`} />
            <RateCard label="Offers → Deals" value={rates.offersToDeals ?? 0} note={`${deals.total} of ${offers.total} offers`} />
            <RateCard label="Deals Closed" value={rates.dealsToClose ?? 0} note={`${deals.closed} of ${deals.total} deals`} />
          </div>

          {/* Funnel bars */}
          <div className="border border-slate-200 bg-white px-4 py-4 space-y-1.5">
            <div className="mb-3 text-[10px] font-black uppercase tracking-wide text-slate-500">Pipeline Funnel</div>
            <FunnelStep
              label="Leads"
              count={leads.total || 0}
              rate={100}
              color="bg-[#0B3B2E]"
              rateLabel="Starting point"
            />
            <FunnelStep
              label="Offers"
              count={offers.total || 0}
              rate={maxCount > 0 ? Math.round(((offers.total || 0) / maxCount) * 100) : 0}
              color="bg-violet-500"
              rateLabel={`${rates.leadsToOffers ?? 0}% conversion`}
            />
            <FunnelStep
              label="Deals"
              count={deals.total || 0}
              rate={maxCount > 0 ? Math.round(((deals.total || 0) / maxCount) * 100) : 0}
              color="bg-emerald-500"
              rateLabel={`${rates.offersToDeals ?? 0}% conversion`}
            />
            <FunnelStep
              label="Closed"
              count={deals.closed || 0}
              rate={maxCount > 0 ? Math.round(((deals.closed || 0) / maxCount) * 100) : 0}
              color="bg-emerald-700"
              rateLabel={`${rates.dealsToClose ?? 0}% of deals`}
            />
          </div>

          {/* Value summary */}
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-slate-200 bg-white px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Active Deal Value</div>
              <div className="mt-1 text-lg font-black tabular-nums text-[#0B3B2E]">{fmtKES(deals.activeValue ?? 0)}</div>
              <div className="mt-0.5 text-[10px] text-slate-400">{deals.active} active deal{deals.active !== 1 ? "s" : ""}</div>
            </div>
            <div className="border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-emerald-600">Closed Deal Value</div>
              <div className="mt-1 text-lg font-black tabular-nums text-emerald-700">{fmtKES(deals.closedValue ?? 0)}</div>
              <div className="mt-0.5 text-[10px] text-emerald-600">{deals.closed} closed deal{deals.closed !== 1 ? "s" : ""}</div>
            </div>
          </div>

          {/* Breakdown tables */}
          <div className="grid grid-cols-2 gap-3">
            {/* Leads by status */}
            <div className="border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Leads by Status</div>
              <table className="w-full text-xs">
                <tbody>
                  {LEAD_STATUSES.map(({ key, color }) => (
                    <tr key={key} className="border-b border-slate-50">
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block h-2 w-2 shrink-0 ${color}`} />
                          <span className="text-slate-700">{cap(key)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{(leads[key === "site_visited" ? "siteVisited" : key] ?? leads[key] ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Offers by status */}
            <div className="border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500">Offers by Status</div>
              <table className="w-full text-xs">
                <tbody>
                  {OFFER_STATUSES.map(({ key, color }) => (
                    <tr key={key} className="border-b border-slate-50">
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-block h-2 w-2 shrink-0 ${color}`} />
                          <span className="text-slate-700">{cap(key)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">{(offers[key] ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </PropertySaleShell>
  );
}
