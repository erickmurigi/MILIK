import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FaBuilding, FaChartLine, FaCheck, FaClipboard, FaClock,
  FaFileAlt, FaHandshake, FaMoneyBillWave, FaPlus,
  FaRedoAlt, FaTag, FaTimesCircle, FaUserFriends, FaUsers, FaUserTie,
} from "react-icons/fa";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import PropertySaleShell from "./PropertySaleShell";

const ACC = "#0B3B2E";

const StatCard = ({ label, value, sub, icon: Icon, tone = "green" }) => {
  const bg = {
    green:  "bg-[#0B3B2E] border-[#0B3B2E]",
    orange: "bg-[#C8511A] border-[#C8511A]",
    slate:  "bg-slate-700 border-slate-700",
    red:    "bg-rose-700 border-rose-700",
    blue:   "bg-blue-700 border-blue-700",
  }[tone] || "bg-[#0B3B2E] border-[#0B3B2E]";
  return (
    <div className={`relative overflow-hidden border ${bg} px-4 py-3 shadow-sm`}>
      {Icon && <Icon className="absolute right-3 top-2.5 h-10 w-10 text-white/10" />}
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/60">{label}</p>
      <p className="mt-1.5 text-2xl font-black leading-none text-white">{value}</p>
      {sub && <p className="mt-1 text-[10px] text-white/50">{sub}</p>}
    </div>
  );
};

const Card = ({ title, right, children, className = "" }) => (
  <div className={`border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">{title}</h2>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
    {children}
  </div>
);

const dealStatusBadge = (status) => ({
  active:    "border-blue-200 bg-blue-50 text-blue-700",
  closed:    "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
}[status] || "border-slate-200 bg-slate-50 text-slate-500");

const pipelineStages = [
  { key: "available",      label: "Available",      icon: FaBuilding,    ring: "border-emerald-400", num: "text-emerald-700", bg: "bg-emerald-50",  hover: "hover:bg-emerald-50",  link: "/sale/listings?status=available"      },
  { key: "reserved",       label: "Reserved",       icon: FaClock,       ring: "border-amber-400",   num: "text-amber-600",   bg: "bg-amber-50",    hover: "hover:bg-amber-50",    link: "/sale/listings?status=reserved"       },
  { key: "underContract",  label: "Under Contract", icon: FaTag,         ring: "border-blue-400",    num: "text-blue-600",    bg: "bg-blue-50",     hover: "hover:bg-blue-50",     link: "/sale/deals?status=active"            },
  { key: "closedDeals",    label: "Deals Closed",   icon: FaHandshake,   ring: "border-indigo-400",  num: "text-indigo-600",  bg: "bg-indigo-50",   hover: "hover:bg-indigo-50",   link: "/sale/deals?status=closed"            },
  { key: "sold",           label: "Sold",           icon: FaCheck,       ring: "border-slate-400",   num: "text-slate-600",   bg: "bg-slate-100",   hover: "hover:bg-slate-100",   link: "/sale/listings?status=sold"           },
];

const QUICK_LINKS = [
  { label: "Sale Listings",  to: "/sale/listings",       Icon: FaBuilding    },
  { label: "Buyers",         to: "/sale/buyers",         Icon: FaUsers       },
  { label: "Agents",         to: "/sale/agents",         Icon: FaUserTie     },
  { label: "Offers",         to: "/sale/offers",         Icon: FaTag         },
  { label: "Deals",          to: "/sale/deals",          Icon: FaHandshake   },
  { label: "Payments",       to: "/sale/payments",       Icon: FaMoneyBillWave },
  { label: "Commissions",    to: "/sale/commissions",    Icon: FaChartLine   },
  { label: "Reports",        to: "/sale/reports",        Icon: FaFileAlt     },
  { label: "Leads Pipeline", to: "/sale/crm/leads",      Icon: FaUserFriends },
  { label: "Activity Log",   to: "/sale/crm/activities", Icon: FaClipboard   },
];

const PropertySaleDashboard = () => {
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const { data, isFetching: loading } = useQuery({
    queryKey: ["sale-dashboard"],
    queryFn:  () => saleApi.getDashboardStats(),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const s    = data || {};
  const leads = s.leads || {};

  // Pipeline counts
  const pipelineCounts = useMemo(() => ({
    available:     s.listings?.available     ?? 0,
    reserved:      s.listings?.reserved      ?? 0,
    underContract: s.deals?.active           ?? 0,
    closedDeals:   s.deals?.closed           ?? 0,
    sold:          s.listings?.sold          ?? 0,
  }), [s]);

  const recentListings = s.recentListings || [];

  const recentDeals = useMemo(
    () => (s.recentDeals || []).map((deal) => ({
      ...deal,
      pct: deal.agreedPrice > 0 ? Math.min(100, Math.round(((deal.totalPaid || 0) / deal.agreedPrice) * 100)) : 0,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.recentDeals]
  );

  const totalCollected   = s.payments?.totalCollected ?? 0;
  const commissionsDue   = (s.commissions?.pending ?? 0) + (s.commissions?.approved ?? 0);
  const activeDealsValue = s.deals?.activeValue ?? 0;
  const closedValue      = s.deals?.closedValue ?? 0;

  return (
    <PropertySaleShell
      title="Dashboard"
      action={
        <>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["sale-dashboard"] })}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => navigate("/sale/listings")}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
          >
            <FaPlus size={9} /> New Listing
          </button>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">

        {/* ── KPI stat cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Available Listings" value={loading ? "…" : (s.listings?.available ?? 0)} icon={FaBuilding}      tone="green"  sub="Ready to sell" />
          <StatCard label="Active Deals"       value={loading ? "…" : (s.deals?.active ?? 0)}       icon={FaHandshake}     tone="orange" sub={loading ? "" : fmtKES(activeDealsValue)} />
          <StatCard label="Total Collected"    value={loading ? "…" : fmtKES(totalCollected)}        icon={FaMoneyBillWave} tone="green"  sub={`${s.payments?.count ?? 0} payments`} />
          <StatCard label="Commissions Due"    value={loading ? "…" : fmtKES(commissionsDue)}        icon={FaChartLine}     tone="orange" sub="Pending payout" />
          <StatCard label="Active Leads"       value={loading ? "…" : (leads.active ?? 0)}            icon={FaUserFriends}   tone="green"  sub={`${leads.total ?? 0} total`} />
        </div>

        {/* ── Pipeline strip ─────────────────────────────────────────────── */}
        <Card title="Sales Pipeline" right={
          <span className="text-[10px] font-bold text-slate-400">
            {closedValue > 0 ? `${fmtKES(closedValue)} closed` : "No closed deals yet"}
          </span>
        }>
          <div className="grid grid-cols-5 divide-x divide-slate-100">
            {pipelineStages.map(({ key, label, icon: Icon, ring, num, bg, hover, link }) => (
              <button
                key={key}
                type="button"
                onClick={() => navigate(link)}
                className={`group flex flex-col items-center justify-between gap-1 px-2 py-3 transition ${hover} sm:flex-row sm:gap-2 sm:px-3`}
              >
                <div className="flex flex-col items-center gap-1 sm:flex-row sm:gap-2">
                  <span className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 ${ring} ${bg}`}>
                    <Icon className={`h-3 w-3 ${num}`} />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                </div>
                <span className={`text-xl font-black leading-none tabular-nums ${num}`}>
                  {loading ? "…" : pipelineCounts[key]}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* ── Main two-column area ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 items-start gap-1.5 xl:grid-cols-[1fr_280px]">

          {/* Left: Recent Deals */}
          <div className="flex flex-col gap-1.5">
            <Card
              title="Recent Deals"
              right={
                <button
                  type="button"
                  onClick={() => navigate("/sale/deals")}
                  className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]"
                >
                  View All →
                </button>
              }
            >
              {/* Mobile cards */}
              <div className="divide-y divide-slate-100 xl:hidden">
                {recentDeals.length ? recentDeals.slice(0, 8).map((deal) => {
                  const { pct } = deal;
                  return (
                    <div key={deal._id} className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-slate-50 cursor-pointer" onClick={() => navigate("/sale/deals")}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-mono font-bold text-[#0B3B2E]">{deal.dealNumber}</span>
                          <span className="font-extrabold text-slate-800 truncate">{deal.listing?.title || deal.listing?.listingNumber || "—"}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">{deal.buyer?.fullName || "—"}</div>
                      </div>
                      <div className="flex flex-shrink-0 flex-col items-end gap-1">
                        <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${dealStatusBadge(deal.status)}`}>
                          {deal.status}
                        </span>
                        <span className="text-xs font-extrabold text-slate-900">{fmtKES(deal.agreedPrice)}</span>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="px-3 py-8 text-center text-xs font-semibold text-slate-400">No deals yet.</p>
                )}
              </div>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E]">
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Deal No.</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Property</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Buyer</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Agent</th>
                      <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Status</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Agreed Price</th>
                      <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Collected %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDeals.length ? recentDeals.map((deal) => {
                      const { pct } = deal;
                      return (
                        <tr
                          key={deal._id}
                          className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                          onClick={() => navigate("/sale/deals")}
                        >
                          <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{deal.dealNumber}</td>
                          <td className="max-w-[160px] truncate px-3 py-2 font-semibold text-slate-800">
                            {deal.listing?.title || deal.listing?.listingNumber || "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{deal.buyer?.fullName || "—"}</td>
                          <td className="px-3 py-2 text-slate-600">{deal.agent?.fullName || "—"}</td>
                          <td className="px-3 py-2">
                            <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${dealStatusBadge(deal.status)}`}>
                              {deal.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">{fmtKES(deal.agreedPrice)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] font-bold text-slate-500">{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-xs font-semibold text-slate-400">
                          No deals recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Recent Listings */}
            {recentListings.length > 0 && (
              <Card
                title="New Listings"
                right={
                  <button
                    type="button"
                    onClick={() => navigate("/sale/listings")}
                    className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]"
                  >
                    View All →
                  </button>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-xs">
                    <thead>
                      <tr className="bg-slate-800">
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">No.</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Title</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Type</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Agent</th>
                        <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-widest text-white">Asking Price</th>
                        <th className="px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentListings.slice(0, 6).map((listing) => (
                        <tr
                          key={listing._id}
                          className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                          onClick={() => navigate("/sale/listings")}
                        >
                          <td className="px-3 py-2 font-mono font-bold text-slate-600">{listing.listingNumber}</td>
                          <td className="max-w-[180px] truncate px-3 py-2 font-semibold text-slate-800">{listing.title}</td>
                          <td className="px-3 py-2 capitalize text-slate-500">{listing.propertyType}</td>
                          <td className="px-3 py-2 text-slate-600">{listing.assignedAgent?.fullName || <span className="italic text-slate-400">Unassigned</span>}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">{fmtKES(listing.askingPrice)}</td>
                          <td className="px-3 py-2">
                            <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                              listing.status === "available"      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : listing.status === "reserved"    ? "border-amber-200 bg-amber-50 text-amber-700"
                              : listing.status === "under_contract" ? "border-blue-200 bg-blue-50 text-blue-700"
                              : listing.status === "sold"        ? "border-slate-600 bg-slate-800 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-500"
                            }`}>
                              {(listing.status || "").replace(/_/g, " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>

          {/* Right sidebar */}
          <div className="flex flex-col gap-1.5">

            {/* Portfolio Summary */}
            <Card title="Portfolio Summary">
              <div className="divide-y divide-slate-100">
                {[
                  { label: "Total Listings",      value: s.listings?.total ?? 0,                     note: "all statuses" },
                  { label: "Available",            value: s.listings?.available ?? 0,                 note: "ready to sell",      bold: true },
                  { label: "Under Negotiation",    value: (s.listings?.reserved ?? 0) + (s.deals?.active ?? 0), note: "offers + active deals", warn: true },
                  { label: "Closed Deals Value",   value: fmtKES(closedValue),                        note: "total revenue closed", money: true },
                  { label: "Outstanding Balance",  value: fmtKES((activeDealsValue || 0) - (totalCollected || 0)), note: "still to collect",    warn: activeDealsValue > totalCollected },
                ].map(({ label, value, note, bold, warn, money }) => (
                  <div key={label} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div>
                      <p className="text-xs font-bold text-slate-700">{label}</p>
                      <p className="text-[10px] text-slate-400">{note}</p>
                    </div>
                    <span className={`text-right font-extrabold tabular-nums ${
                      bold ? "text-emerald-700 text-base"
                      : warn ? "text-orange-600 text-base"
                      : money ? "text-sm text-[#0B3B2E]"
                      : "text-slate-900 text-base"
                    }`}>
                      {loading ? "…" : value}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Leads Funnel */}
            <Card title="CRM Leads Funnel" right={
              <button
                type="button"
                onClick={() => navigate("/sale/crm/leads")}
                className="text-[10px] font-extrabold uppercase tracking-wide text-[#0B3B2E] hover:text-[#FF8C00]"
              >
                View All →
              </button>
            }>
              <div className="divide-y divide-slate-100">
                {[
                  { label: "New",           count: leads.new           ?? 0 },
                  { label: "Contacted",     count: leads.contacted     ?? 0 },
                  { label: "Qualified",     count: leads.qualified     ?? 0 },
                  { label: "Site Visited",  count: leads.siteVisited   ?? 0 },
                  { label: "Negotiating",   count: leads.negotiating   ?? 0 },
                  { label: "Converted",     count: leads.converted     ?? 0, bold: true },
                ].map(({ label, count, bold }) => (
                  <div key={label} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <p className={`text-xs ${bold ? "font-extrabold text-emerald-700" : "font-semibold text-slate-700"}`}>{label}</p>
                    <span className={`tabular-nums font-extrabold ${bold ? "text-emerald-700" : count > 0 ? "text-slate-900" : "text-slate-300"}`}>
                      {loading ? "…" : count}
                    </span>
                  </div>
                ))}
                {leads.overdue > 0 && (
                  <div className="flex items-center justify-between gap-2 bg-rose-50 px-3 py-1.5">
                    <p className="text-xs font-extrabold text-rose-600">Overdue Follow-ups</p>
                    <span className="font-extrabold tabular-nums text-rose-600">{leads.overdue}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Quick Access */}
            <Card title="Quick Access">
              <div className="grid grid-cols-2 gap-px bg-slate-100">
                {QUICK_LINKS.map(({ label, to, Icon }) => (
                  <button
                    key={to}
                    type="button"
                    onClick={() => navigate(to)}
                    className="flex items-center gap-2 bg-white px-3 py-2.5 text-left hover:bg-[#F1F6F3]"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-[#0B3B2E]/10 text-xs text-[#0B3B2E]">
                      <Icon />
                    </span>
                    <span className="text-xs font-bold leading-tight text-slate-800">{label}</span>
                  </button>
                ))}
              </div>
            </Card>

          </div>
        </div>
      </div>
    </PropertySaleShell>
  );
};

export default PropertySaleDashboard;
