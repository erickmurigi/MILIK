import React, { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { useTabState } from "../../hooks/useTabState";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { FaPrint } from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import { fmtKES, SALE_MONTHS, saleApi } from "../../services/propertySaleApi";
import { fmtDate } from "../../utils/dates";
import { listingAgentName } from "../../utils/saleAgent";
import { useTerms } from "../../hooks/useTerm";
import { printTabularList } from "../../utils/printKit";
import { POPUP_BLOCKED, money } from "./salePrint";
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
  <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${cls || "bg-slate-100 text-slate-600 border-slate-200"}`}>
    {text}
  </span>
);

const EmptyRow = ({ cols, label }) => (
  <tr><td colSpan={cols} className="px-4 py-10 text-center text-slate-400">{label}</td></tr>
);

const SaleMonthlyDetail = () => {
  const T = useTerms("saleModule", "saleListing", "saleListings", "saleBuyer", "saleAgent", "saleOffer", "saleOffers", "saleDeal", "saleDeals");
  const { year, month } = useParams();
  const location = useLocation();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const biz = currentCompany?._id;

  const [activeTab, setActiveTab] = useTabState(`${location.pathname}:activeTab`, "payments");

  const monthName = SALE_MONTHS[Number(month) - 1] || "—";

  const { data, isPending: loading, error } = useQuery({
    queryKey: ["sale-report-monthly", biz, year, month],
    queryFn:  () => saleApi.getMonthlyDetail({ business: biz, year, month }),
    enabled:  !!biz && !!year && !!month,
    staleTime: 60_000,
  });

  useEffect(() => { if (error) toast.error("Failed to load monthly detail"); }, [error]);

  const payments = data?.payments || [];
  const deals = data?.deals || [];
  const offers = data?.offers || [];
  const listings = data?.listings || [];
  const commissions = data?.commissions || [];
  const summary = data?.summary || {};

  const TABS = [
    { key: "payments", label: "Payments", count: payments.length },
    { key: "deals", label: T.saleDeals, count: deals.length },
    { key: "offers", label: T.saleOffers, count: offers.length },
    { key: "listings", label: T.saleListings, count: listings.length },
    { key: "commissions", label: "Commissions", count: commissions.length },
  ];

  const printReport = useCallback(() => {
    const fmt = (v) => `KES ${money(v)}`;
    const printed = printTabularList({
      title: `${monthName} ${year} — Monthly Detail`,
      subtitle: `${T.saleModule} Report`,
      company: currentCompany,
      summaryItems: [["Payments", String(payments.length)], ["Revenue", fmt(summary.totalRevenue)], [T.saleDeals, String(deals.length)], ["Commissions", fmt(summary.totalCommissions)]],
      columns: [],
      sections: [
        ...(payments.length > 0 ? [{
          heading: `Payments (${payments.length})`,
          columns: [
            { label: "Payment #", value: (p) => p.paymentNumber || "—" },
            { label: T.saleDeal, value: (p) => p.deal?.dealNumber || (typeof p.deal === "string" ? p.deal : "") || "—" },
            { label: "Type", value: (p) => fmtLabel(p.paymentType || p.type) },
            { label: "Method", value: (p) => fmtLabel(p.method || p.paymentMethod) },
            { label: "Amount", align: "right", value: (p) => money(p.amount), bold: true },
            { label: "Date", value: (p) => fmtDate(p.paymentDate || p.date) },
            { label: "Status", value: (p) => fmtLabel(p.status) },
          ],
          rows: payments,
        }] : []),
        ...(deals.length > 0 ? [{
          heading: `${T.saleDeals} (${deals.length})`,
          columns: [
            { label: `${T.saleDeal} #`, value: (d) => d.dealNumber || "—" },
            { label: T.saleListing, value: (d) => d.listing?.title || d.listing?.property?.propertyName || "—" },
            { label: T.saleBuyer, value: (d) => d.buyer?.fullName || "—" },
            { label: T.saleAgent, value: (d) => d.agent?.fullName || "—" },
            { label: "Value", align: "right", value: (d) => money(d.agreedPrice || d.dealValue) },
            { label: "Date", value: (d) => fmtDate(d.closedAt || d.createdAt) },
            { label: "Status", value: (d) => fmtLabel(d.status) },
          ],
          rows: deals,
        }] : []),
        ...(commissions.length > 0 ? [{
          heading: `Commissions (${commissions.length})`,
          columns: [
            { label: T.saleDeal, value: (c) => c.deal?.dealNumber || "—" },
            { label: T.saleAgent, value: (c) => c.agent?.fullName || "—" },
            { label: "Commission", align: "right", value: (c) => money(c.amount || c.commissionAmount) },
            { label: "Date", value: (c) => fmtDate(c.createdAt) },
            { label: "Status", value: (c) => fmtLabel(c.status) },
          ],
          rows: commissions,
        }] : []),
      ],
    });
    if (!printed) toast.error(POPUP_BLOCKED);
  }, [currentCompany, monthName, year, payments, deals, commissions, summary, T]);

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

        {/* Tab Bar */}
        <div className="flex gap-0 border border-slate-200 bg-white shadow-sm overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-black transition border-b-2 ${
                activeTab === t.key
                  ? "border-[#0B3B2E] text-[#0B3B2E] bg-[#EDF5F1]"
                  : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              {t.label}
              {!loading && (
                <span className={`px-1.5 py-0 text-[9px] font-black ${
                  activeTab === t.key ? "bg-[#0B3B2E] text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
          <div className="min-h-0 flex-1 overflow-auto">

            {/* PAYMENTS TAB */}
            {activeTab === "payments" && (
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Receipt No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleDeal}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleListing}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleBuyer}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Method</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Loading payments...</td></tr>
                  ) : payments.length === 0 ? (
                    <EmptyRow cols={9} label={`No payments recorded in ${monthName} ${year}`} />
                  ) : payments.map((p, i) => (
                    <tr key={p._id} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                      <td className="px-3 py-1 border-r border-gray-100 font-black text-slate-900">{p.paymentNumber}</td>
                      <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-700">{p.deal?.dealNumber || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{p.deal?.listing?.title || p.deal?.listing?.listingNumber || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{p.deal?.buyer?.fullName || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <Badge text={fmtLabel(p.paymentType)} cls={TYPE_BADGE[p.paymentType]} />
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <Badge text={fmtLabel(p.paymentMethod)} cls={METHOD_BADGE[p.paymentMethod]} />
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{fmtKES(p.amount)}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString("en-KE") : "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 font-mono text-[10px] text-slate-400">{p.reference || "—"}</td>
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
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleDeal} No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleListing}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleBuyer}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleAgent}</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Agreed Price</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleDeal} Date</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading deals...</td></tr>
                  ) : deals.length === 0 ? (
                    <EmptyRow cols={7} label={`No deals in ${monthName} ${year}`} />
                  ) : deals.map((d, i) => (
                    <tr key={d._id} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                      <td className="px-3 py-1 border-r border-gray-100 font-black text-slate-900">{d.dealNumber}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <div className="font-bold text-slate-700">{d.listing?.title || "—"}</div>
                        <div className="text-[10px] capitalize text-slate-400">{d.listing?.propertyType || ""}</div>
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{d.buyer?.fullName || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{d.agent?.fullName || <span className="italic text-slate-300">—</span>}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{fmtKES(d.agreedPrice)}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <Badge text={d.status} cls={STATUS_BADGE[d.status]} />
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{d.dealDate ? new Date(d.dealDate).toLocaleDateString("en-KE") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* OFFERS TAB */}
            {activeTab === "offers" && (
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleOffer} No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleListing}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleBuyer}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleAgent}</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">{T.saleOffer} Amount</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Counter {T.saleOffer}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading offers...</td></tr>
                  ) : offers.length === 0 ? (
                    <EmptyRow cols={8} label={`No offers in ${monthName} ${year}`} />
                  ) : offers.map((o, i) => (
                    <tr key={o._id} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                      <td className="px-3 py-1 border-r border-gray-100 font-black text-slate-900">{o.offerNumber}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{o.listing?.title || o.listing?.listingNumber || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-600">{o.buyer?.fullName || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{o.agent?.fullName || <span className="italic text-slate-300">—</span>}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{fmtKES(o.offerAmount)}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-violet-700">{o.counterOfferAmount ? fmtKES(o.counterOfferAmount) : "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <Badge text={o.status === "negotiating" && o.counterOfferAmount ? "Counter Active" : o.status} cls={STATUS_BADGE[o.status]} />
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-KE") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* LISTINGS TAB */}
            {activeTab === "listings" && (
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleListing} No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Title</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Asking Price</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleAgent}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Listed On</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading listings...</td></tr>
                  ) : listings.length === 0 ? (
                    <EmptyRow cols={7} label={`No listings created in ${monthName} ${year}`} />
                  ) : listings.map((l, i) => (
                    <tr key={l._id} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                      <td className="px-3 py-1 border-r border-gray-100 font-black text-slate-900">{l.listingNumber}</td>
                      <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-700">{l.title || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 capitalize text-slate-500">{l.propertyType || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{fmtKES(l.askingPrice)}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <Badge text={l.status} cls={STATUS_BADGE[l.status]} />
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{listingAgentName(l) || <span className="italic text-slate-300">—</span>}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-KE") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* COMMISSIONS TAB */}
            {activeTab === "commissions" && (
              <table className="min-w-full text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Comm. No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleAgent}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleDeal}</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">{T.saleListing}</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Rate</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading commissions...</td></tr>
                  ) : commissions.length === 0 ? (
                    <EmptyRow cols={7} label={`No commissions in ${monthName} ${year}`} />
                  ) : commissions.map((c, i) => (
                    <tr key={c._id} className={`border-b border-gray-100 ${i % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                      <td className="px-3 py-1 border-r border-gray-100 font-black text-slate-900">{c.commissionNumber}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-700">{c.agent?.fullName || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-700">{c.deal?.dealNumber || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{c.deal?.listing?.title || "—"}</td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-[#0B3B2E]">
                        {c.commissionRate}{c.commissionType === "percentage" ? "%" : " KES"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-black text-slate-900">{fmtKES(c.commissionAmount)}</td>
                      <td className="px-3 py-1 border-r border-gray-100">
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
