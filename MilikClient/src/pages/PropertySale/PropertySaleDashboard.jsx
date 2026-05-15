import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaChartLine, FaFileAlt,
  FaHandshake, FaMoneyBillWave, FaTag, FaUserTie, FaUsers,
} from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { saleApi, fmtKES } from "../../services/propertySaleApi";

const DEAL_STATUS_CLS = {
  active: "bg-blue-100 text-blue-700 border-blue-200",
  closed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-100 text-rose-700 border-rose-200",
};

const LISTING_STATUS_CLS = {
  available: "bg-emerald-100 text-emerald-700 border-emerald-200",
  reserved: "bg-amber-100 text-amber-700 border-amber-200",
  under_contract: "bg-blue-100 text-blue-700 border-blue-200",
  sold: "bg-slate-800 text-white border-slate-700",
  withdrawn: "bg-rose-100 text-rose-700 border-rose-200",
};

const LINKS = [
  { label: "Sale Listings", to: "/sale/listings", Icon: FaBuilding },
  { label: "Buyers", to: "/sale/buyers", Icon: FaUsers },
  { label: "Agents", to: "/sale/agents", Icon: FaUserTie },
  { label: "Offers", to: "/sale/offers", Icon: FaTag },
  { label: "Deals", to: "/sale/deals", Icon: FaHandshake },
  { label: "Payments", to: "/sale/payments", Icon: FaMoneyBillWave },
  { label: "Commissions", to: "/sale/commissions", Icon: FaChartLine },
  { label: "Reports", to: "/sale/reports", Icon: FaFileAlt },
];

const PropertySaleDashboard = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentCompany?._id) return;
    setLoading(true);
    saleApi
      .getDashboardStats({ business: currentCompany._id })
      .then(setStats)
      .catch(() => toast.error("Failed to load dashboard stats"))
      .finally(() => setLoading(false));
  }, [currentCompany?._id]);

  const s = stats || {};

  const kpi = [
    { label: "Available Listings", value: loading ? "—" : (s.listings?.available ?? 0), sub: "Ready to sell", cls: "bg-[#027333] text-white" },
    { label: "Active Deals", value: loading ? "—" : (s.deals?.active ?? 0), sub: loading ? "" : fmtKES(s.deals?.activeValue ?? 0), cls: "bg-blue-600 text-white" },
    { label: "Total Collected", value: loading ? "—" : fmtKES(s.payments?.totalCollected ?? 0), sub: `${s.payments?.count ?? 0} payment(s)`, cls: "bg-slate-900 text-white" },
    { label: "Commissions Due", value: loading ? "—" : fmtKES((s.commissions?.pending ?? 0) + (s.commissions?.approved ?? 0)), sub: "Pending payout", cls: "bg-rose-600 text-white" },
  ];

  const pipeline = [
    { label: "Available", count: loading ? "—" : (s.listings?.available ?? 0), sub: "Listings ready", cls: "bg-[#027333] text-white" },
    { label: "Reserved", count: loading ? "—" : (s.listings?.reserved ?? 0), sub: "Offers placed", cls: "bg-amber-500 text-white" },
    { label: "Under Contract", count: loading ? "—" : (s.deals?.active ?? 0), sub: loading ? "" : fmtKES(s.deals?.activeValue ?? 0), cls: "bg-blue-600 text-white" },
    { label: "Closed", count: loading ? "—" : (s.deals?.closed ?? 0), sub: loading ? "" : fmtKES(s.deals?.closedValue ?? 0), cls: "bg-slate-800 text-white" },
  ];

  const recentDeals = s.recentDeals || [];
  const recentListings = s.recentListings || [];

  return (
    <PropertySaleShell title="Dashboard">
      <div className="flex flex-col gap-2">

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {kpi.map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black">{c.value}</div>
              {c.sub && <div className="mt-0.5 text-[10px] font-semibold opacity-60">{c.sub}</div>}
            </div>
          ))}
        </div>

        {/* Deal Pipeline Funnel */}
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          <div className="mb-2 text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Deal Pipeline</div>
          <div className="flex items-stretch gap-1.5">
            {pipeline.map((stage, i) => (
              <React.Fragment key={stage.label}>
                <div className={`flex flex-1 flex-col rounded-lg px-3 py-2 ${stage.cls}`}>
                  <div className="text-[9px] font-black uppercase tracking-wider opacity-75">{stage.label}</div>
                  <div className="mt-0.5 text-xl font-black leading-none">{stage.count}</div>
                  {stage.sub && (
                    <div className="mt-0.5 truncate text-[9px] font-semibold opacity-60">{stage.sub}</div>
                  )}
                </div>
                {i < pipeline.length - 1 && (
                  <div className="flex shrink-0 items-center">
                    <FaArrowRight className="text-[10px] text-slate-300" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Two-column: Quick Nav + Recent Deals */}
        <div className="grid gap-2 lg:grid-cols-5">

          {/* Quick Nav */}
          <div className="lg:col-span-2">
            <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-slate-400">Quick Access</div>
            <div className="grid grid-cols-2 gap-1.5">
              {LINKS.map(({ label, to, Icon }) => (
                <button
                  key={to}
                  onClick={() => navigate(to)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-[#027333] hover:shadow-md"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#027333]/10 text-xs text-[#027333]">
                    <Icon />
                  </span>
                  <span className="text-xs font-bold leading-tight text-slate-800">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recent Deals */}
          <div className="lg:col-span-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between bg-[#027333] px-3 py-2.5 text-white">
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">Recent Deals</span>
              <button
                onClick={() => navigate("/sale/deals")}
                className="text-[9px] font-bold opacity-70 hover:opacity-100"
              >View all →</button>
            </div>
            {loading ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400">Loading...</div>
            ) : recentDeals.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-slate-400">
                No deals yet.{" "}
                <button onClick={() => navigate("/sale/deals")} className="font-bold text-[#027333] underline">Create your first deal →</button>
              </div>
            ) : (
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Deal No.</th>
                    <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Property</th>
                    <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Buyer</th>
                    <th className="px-3 py-2 text-right text-[10px] font-black text-slate-500">Agreed Price</th>
                    <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDeals.map((deal) => {
                    const pct = deal.agreedPrice > 0
                      ? Math.min(100, Math.round(((deal.totalPaid || 0) / deal.agreedPrice) * 100))
                      : 0;
                    return (
                      <tr
                        key={deal._id}
                        onClick={() => navigate("/sale/deals")}
                        className="cursor-pointer border-t border-slate-100 transition hover:bg-emerald-50/40"
                      >
                        <td className="px-3 py-2 font-black text-slate-900">{deal.dealNumber}</td>
                        <td className="max-w-[110px] truncate px-3 py-2 text-slate-700">
                          {deal.listing?.title || deal.listing?.listingNumber || "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{deal.buyer?.fullName || "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="font-black text-slate-900">{fmtKES(deal.agreedPrice)}</div>
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black ${DEAL_STATUS_CLS[deal.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                            {deal.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recent Listings */}
        {!loading && recentListings.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between bg-slate-800 px-3 py-2.5 text-white">
              <span className="text-[9px] font-black uppercase tracking-[0.2em]">New Listings</span>
              <button
                onClick={() => navigate("/sale/listings")}
                className="text-[9px] font-bold opacity-70 hover:opacity-100"
              >View all →</button>
            </div>
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Listing No.</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Title</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Type</th>
                  <th className="px-3 py-2 text-right text-[10px] font-black text-slate-500">Asking Price</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Agent</th>
                  <th className="px-3 py-2 text-left text-[10px] font-black text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentListings.map((listing) => (
                  <tr
                    key={listing._id}
                    onClick={() => navigate("/sale/listings")}
                    className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50"
                  >
                    <td className="px-3 py-2 font-black text-slate-900">{listing.listingNumber}</td>
                    <td className="px-3 py-2 text-slate-700">{listing.title}</td>
                    <td className="px-3 py-2 capitalize text-slate-500">{listing.propertyType}</td>
                    <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(listing.askingPrice)}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {listing.assignedAgent?.fullName || <span className="italic text-slate-400">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black ${LISTING_STATUS_CLS[listing.status] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {(listing.status || "").replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Secondary stats row */}
        {!loading && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Properties Sold", value: s.listings?.sold ?? 0, cls: "bg-slate-800 text-white" },
              { label: "Reserved", value: s.listings?.reserved ?? 0, cls: "bg-amber-50 border border-amber-200 text-amber-900" },
              { label: "Under Contract", value: s.listings?.underContract ?? 0, cls: "bg-blue-50 border border-blue-200 text-blue-900" },
              { label: "Deals Closed", value: s.deals?.closed ?? 0, cls: "bg-emerald-50 border border-emerald-200 text-emerald-900" },
            ].map((c) => (
              <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
                <div className="text-[9px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
                <div className="mt-0.5 text-sm font-black">{c.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PropertySaleShell>
  );
};

export default PropertySaleDashboard;
