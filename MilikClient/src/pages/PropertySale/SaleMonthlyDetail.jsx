import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPrint } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, saleApi } from "../../services/propertySaleApi";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const fmtLabel = (s) => (s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const METHOD_BADGE = {
  cash: "bg-orange-100 text-orange-700 border-orange-200",
  mpesa: "bg-emerald-100 text-emerald-700 border-emerald-200",
  bank_transfer: "bg-blue-100 text-blue-700 border-blue-200",
  cheque: "bg-violet-100 text-violet-700 border-violet-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

const TYPE_BADGE = {
  deposit: "bg-amber-100 text-amber-700 border-amber-200",
  installment: "bg-blue-100 text-blue-700 border-blue-200",
  final_payment: "bg-emerald-100 text-emerald-700 border-emerald-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_BADGE = {
  available: "bg-emerald-100 text-emerald-700 border-emerald-200",
  sold: "bg-slate-800 text-white border-slate-700",
  reserved: "bg-amber-100 text-amber-700 border-amber-200",
  under_contract: "bg-blue-100 text-blue-700 border-blue-200",
  active: "bg-blue-100 text-blue-700 border-blue-200",
  closed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-100 text-rose-700 border-rose-200",
  accepted: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-100 text-rose-700 border-rose-200",
  negotiating: "bg-violet-100 text-violet-700 border-violet-200",
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  paid: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const Badge = ({ text, cls }) => (
  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black ${cls || "bg-slate-100 text-slate-600 border-slate-200"}`}>
    {text}
  </span>
);

const EmptyRow = ({ cols, label }) => (
  <tr><td colSpan={cols} className="px-4 py-10 text-center text-slate-400">{label}</td></tr>
);

const SaleMonthlyDetail = () => {
  const { year, month } = useParams();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("payments");

  const monthName = MONTH_NAMES[Number(month) - 1] || "—";

  useEffect(() => {
    if (!biz || !year || !month) return;
    setLoading(true);
    saleApi.getMonthlyDetail({ business: biz, year, month })
      .then(setData)
      .catch(() => toast.error("Failed to load monthly detail"))
      .finally(() => setLoading(false));
  }, [biz, year, month]);

  const payments = data?.payments || [];
  const deals = data?.deals || [];
  const offers = data?.offers || [];
  const listings = data?.listings || [];
  const commissions = data?.commissions || [];
  const summary = data?.summary || {};

  const TABS = [
    { key: "payments", label: "Payments", count: payments.length },
    { key: "deals", label: "Deals", count: deals.length },
    { key: "offers", label: "Offers", count: offers.length },
    { key: "listings", label: "Listings", count: listings.length },
    { key: "commissions", label: "Commissions", count: commissions.length },
  ];

  const printReport = () => {
    window.print();
  };

  return (
    <PropertySaleShell
      title={`${monthName} ${year} — Monthly Detail`}
      subtitle={loading ? "Loading..." : `${summary.payments ?? 0} payment(s) · ${summary.deals ?? 0} deal(s) · ${fmtKES(summary.totalRevenue || 0)} revenue`}
      action={
        <button
          onClick={printReport}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <FaPrint /> Print
        </button>
      }
    >
      <div className="flex h-full flex-col gap-2">

        {/* KPI Strip */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {[
            { label: "Listings", value: loading ? "—" : (summary.listings ?? 0), cls: "bg-slate-900 text-white" },
            { label: "Offers", value: loading ? "—" : (summary.offers ?? 0), cls: "bg-amber-50 border border-amber-200 text-amber-900" },
            { label: "Deals", value: loading ? "—" : (summary.deals ?? 0), cls: "bg-blue-50 border border-blue-200 text-blue-900" },
            { label: "Deals Closed", value: loading ? "—" : (summary.dealsClosed ?? 0), cls: "bg-emerald-50 border border-emerald-200 text-emerald-900" },
            { label: "Total Revenue", value: loading ? "—" : fmtKES(summary.totalRevenue || 0), cls: "bg-[#027333] text-white" },
            { label: "Commissions", value: loading ? "—" : fmtKES(summary.totalCommissions || 0), cls: "bg-violet-50 border border-violet-200 text-violet-900" },
          ].map((c) => (
            <div key={c.label} className={`rounded-lg px-3 py-2 ${c.cls}`}>
              <div className="text-[10px] font-black uppercase tracking-wider opacity-70">{c.label}</div>
              <div className="mt-0.5 text-sm font-black truncate">{c.value}</div>
            </div>
          ))}
        </div>

        {/* Tab Bar */}
        <div className="flex gap-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-black transition border-b-2 ${
                activeTab === t.key
                  ? "border-[#027333] text-[#027333] bg-emerald-50/50"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              {t.label}
              {!loading && (
                <span className={`rounded-full px-1.5 py-0 text-[9px] font-black ${
                  activeTab === t.key ? "bg-[#027333] text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">

            {/* PAYMENTS TAB */}
            {activeTab === "payments" && (
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Receipt No.</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Deal</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Property</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Buyer</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Type</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Method</th>
                    <th className="px-3 py-2.5 text-right font-black tracking-wide">Amount</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Date</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Loading payments...</td></tr>
                  ) : payments.length === 0 ? (
                    <EmptyRow cols={9} label={`No payments recorded in ${monthName} ${year}`} />
                  ) : payments.map((p, i) => (
                    <tr key={p._id} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-3 py-2 font-black text-slate-900">{p.paymentNumber}</td>
                      <td className="px-3 py-2 font-bold text-slate-700">{p.deal?.dealNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{p.deal?.listing?.title || p.deal?.listing?.listingNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{p.deal?.buyer?.fullName || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge text={fmtLabel(p.paymentType)} cls={TYPE_BADGE[p.paymentType]} />
                      </td>
                      <td className="px-3 py-2">
                        <Badge text={fmtLabel(p.paymentMethod)} cls={METHOD_BADGE[p.paymentMethod]} />
                      </td>
                      <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(p.amount)}</td>
                      <td className="px-3 py-2 text-slate-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-KE") : "—"}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{p.reference || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                {payments.length > 0 && (
                  <tfoot className="bg-slate-800 text-white">
                    <tr>
                      <td colSpan={6} className="px-3 py-2.5 font-black tracking-wide">TOTAL COLLECTED — {monthName.toUpperCase()} {year}</td>
                      <td className="px-3 py-2.5 text-right font-black">{fmtKES(summary.totalRevenue || 0)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}

            {/* DEALS TAB */}
            {activeTab === "deals" && (
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Deal No.</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Property</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Buyer</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent</th>
                    <th className="px-3 py-2.5 text-right font-black tracking-wide">Agreed Price</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Deal Date</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading deals...</td></tr>
                  ) : deals.length === 0 ? (
                    <EmptyRow cols={7} label={`No deals in ${monthName} ${year}`} />
                  ) : deals.map((d, i) => (
                    <tr key={d._id} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-3 py-2 font-black text-slate-900">{d.dealNumber}</td>
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-700">{d.listing?.title || "—"}</div>
                        <div className="text-[10px] capitalize text-slate-400">{d.listing?.propertyType || ""}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{d.buyer?.fullName || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{d.agent?.fullName || <span className="italic text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(d.agreedPrice)}</td>
                      <td className="px-3 py-2">
                        <Badge text={d.status} cls={STATUS_BADGE[d.status]} />
                      </td>
                      <td className="px-3 py-2 text-slate-500">{d.dealDate ? new Date(d.dealDate).toLocaleDateString("en-KE") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* OFFERS TAB */}
            {activeTab === "offers" && (
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Offer No.</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Property</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Buyer</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent</th>
                    <th className="px-3 py-2.5 text-right font-black tracking-wide">Offer Amount</th>
                    <th className="px-3 py-2.5 text-right font-black tracking-wide">Counter Offer</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading offers...</td></tr>
                  ) : offers.length === 0 ? (
                    <EmptyRow cols={8} label={`No offers in ${monthName} ${year}`} />
                  ) : offers.map((o, i) => (
                    <tr key={o._id} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-3 py-2 font-black text-slate-900">{o.offerNumber}</td>
                      <td className="px-3 py-2 text-slate-700">{o.listing?.title || o.listing?.listingNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{o.buyer?.fullName || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{o.agent?.fullName || <span className="italic text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(o.offerAmount)}</td>
                      <td className="px-3 py-2 text-right font-bold text-violet-700">{o.counterOfferAmount ? fmtKES(o.counterOfferAmount) : "—"}</td>
                      <td className="px-3 py-2">
                        <Badge text={o.status === "negotiating" && o.counterOfferAmount ? "Counter Active" : o.status} cls={STATUS_BADGE[o.status]} />
                      </td>
                      <td className="px-3 py-2 text-slate-500">{o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-KE") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* LISTINGS TAB */}
            {activeTab === "listings" && (
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Listing No.</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Title</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Type</th>
                    <th className="px-3 py-2.5 text-right font-black tracking-wide">Asking Price</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Listed On</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading listings...</td></tr>
                  ) : listings.length === 0 ? (
                    <EmptyRow cols={7} label={`No listings created in ${monthName} ${year}`} />
                  ) : listings.map((l, i) => (
                    <tr key={l._id} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-3 py-2 font-black text-slate-900">{l.listingNumber}</td>
                      <td className="px-3 py-2 font-bold text-slate-700">{l.title || "—"}</td>
                      <td className="px-3 py-2 capitalize text-slate-500">{l.propertyType || "—"}</td>
                      <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(l.askingPrice)}</td>
                      <td className="px-3 py-2">
                        <Badge text={l.status} cls={STATUS_BADGE[l.status]} />
                      </td>
                      <td className="px-3 py-2 text-slate-500">{l.assignedAgent?.fullName || <span className="italic text-slate-300">—</span>}</td>
                      <td className="px-3 py-2 text-slate-500">{l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-KE") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* COMMISSIONS TAB */}
            {activeTab === "commissions" && (
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 z-10 bg-[#027333] text-white">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Comm. No.</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Agent</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Deal</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Property</th>
                    <th className="px-3 py-2.5 text-right font-black tracking-wide">Rate</th>
                    <th className="px-3 py-2.5 text-right font-black tracking-wide">Amount</th>
                    <th className="px-3 py-2.5 text-left font-black tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading commissions...</td></tr>
                  ) : commissions.length === 0 ? (
                    <EmptyRow cols={7} label={`No commissions in ${monthName} ${year}`} />
                  ) : commissions.map((c, i) => (
                    <tr key={c._id} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-3 py-2 font-black text-slate-900">{c.commissionNumber}</td>
                      <td className="px-3 py-2 text-slate-700">{c.agent?.fullName || "—"}</td>
                      <td className="px-3 py-2 font-bold text-slate-700">{c.deal?.dealNumber || "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{c.deal?.listing?.title || "—"}</td>
                      <td className="px-3 py-2 text-right font-bold text-[#027333]">
                        {c.commissionRate}{c.commissionType === "percentage" ? "%" : " KES"}
                      </td>
                      <td className="px-3 py-2 text-right font-black text-slate-900">{fmtKES(c.commissionAmount)}</td>
                      <td className="px-3 py-2">
                        <Badge text={c.status} cls={STATUS_BADGE[c.status]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {commissions.length > 0 && (
                  <tfoot className="bg-slate-800 text-white">
                    <tr>
                      <td colSpan={5} className="px-3 py-2.5 font-black tracking-wide">TOTAL COMMISSIONS — {monthName.toUpperCase()} {year}</td>
                      <td className="px-3 py-2.5 text-right font-black">{fmtKES(summary.totalCommissions || 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}

          </div>
        </div>
      </div>
    </PropertySaleShell>
  );
};

export default SaleMonthlyDetail;
