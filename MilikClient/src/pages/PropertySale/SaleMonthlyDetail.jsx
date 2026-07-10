import React, { useCallback, useEffect, useState } from "react";
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
  <span className={`inline-flex border px-1.5 py-0.5 text-[9px] font-bold uppercase ${cls || "bg-slate-100 text-slate-600 border-slate-200"}`}>
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

  const printReport = useCallback(() => {
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) return;
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : '—');
    win.document.write(`<!DOCTYPE html><html><head><title>${monthName} ${year} Report</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:12px;font-weight:900;color:#0f172a;margin-top:3px}
      h3{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;font-weight:900;margin:12px 0 5px;border-top:1px solid #dbe2ea;padding-top:8px}
      table{width:100%;border-collapse:collapse;font-size:8.5px;margin-bottom:8px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">${monthName} ${year} — Monthly Detail</div><div class="sub">Property Sales Report</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Payments</div><div class="cv">${payments.length}</div></div>
      <div class="card"><div class="cl">Revenue</div><div class="cv" style="color:#0B3B2E">${fmt(summary.totalRevenue)}</div></div>
      <div class="card"><div class="cl">Deals</div><div class="cv">${deals.length}</div></div>
      <div class="card"><div class="cl">Commissions</div><div class="cv" style="color:#FF8C00">${fmt(summary.totalCommission)}</div></div>
    </div>
    ${payments.length > 0 ? `<h3>Payments (${payments.length})</h3><table><thead><tr><th>Payment #</th><th>Deal</th><th>Type</th><th>Method</th><th class="r">Amount</th><th>Date</th><th>Status</th></tr></thead><tbody>${payments.map((p) => `<tr><td>${p.paymentNumber || '—'}</td><td>${p.deal?.dealNumber || p.deal || '—'}</td><td>${fmtLabel(p.paymentType || p.type)}</td><td>${fmtLabel(p.method || p.paymentMethod)}</td><td class="r"><strong>${fmt(p.amount)}</strong></td><td>${fmtDate(p.paymentDate || p.date)}</td><td>${fmtLabel(p.status)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${deals.length > 0 ? `<h3>Deals (${deals.length})</h3><table><thead><tr><th>Deal #</th><th>Property</th><th>Buyer</th><th>Agent</th><th class="r">Value</th><th>Date</th><th>Status</th></tr></thead><tbody>${deals.map((d) => `<tr><td>${d.dealNumber || '—'}</td><td>${d.listing?.title || d.listing?.property?.propertyName || '—'}</td><td>${d.buyer?.fullName || '—'}</td><td>${d.agent?.fullName || '—'}</td><td class="r">${fmt(d.agreedPrice || d.dealValue)}</td><td>${fmtDate(d.closedAt || d.createdAt)}</td><td>${fmtLabel(d.status)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${commissions.length > 0 ? `<h3>Commissions (${commissions.length})</h3><table><thead><tr><th>Deal</th><th>Agent</th><th class="r">Commission</th><th>Date</th><th>Status</th></tr></thead><tbody>${commissions.map((c) => `<tr><td>${c.deal?.dealNumber || '—'}</td><td>${c.agent?.fullName || '—'}</td><td class="r">${fmt(c.amount || c.commissionAmount)}</td><td>${fmtDate(c.createdAt)}</td><td>${fmtLabel(c.status)}</td></tr>`).join('')}</tbody></table>` : ''}
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [currentCompany, monthName, year, payments, deals, commissions, summary]);

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
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Deal</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Buyer</th>
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
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Deal No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Buyer</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Agent</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Agreed Price</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Deal Date</th>
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
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Offer No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Buyer</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Agent</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Offer Amount</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Counter Offer</th>
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
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Listing No.</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Title</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Asking Price</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Agent</th>
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
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{l.assignedAgent?.fullName || <span className="italic text-slate-300">—</span>}</td>
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
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Agent</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Deal</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
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
