import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { saleApi } from "../../services/propertySaleApi";
import { fmtDate } from "../../utils/dates";

const fmtKES  = (n) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2 }).format(Number(n) || 0);
const fmtLabel = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const PRINT_STYLES = `
  @page { size: A4; margin: 18mm 16mm; }
  @media print {
    html, body { height: auto !important; overflow: visible !important; }
    body > * { visibility: hidden !important; }
    #sale-print-root, #sale-print-root * { visibility: visible !important; }
    #sale-print-toolbar { display: none !important; }
    #sale-print-root { position: fixed !important; inset: 0 !important; background: white !important; }
  }
`;

const SaleDealStatement = () => {
  const { id }   = useParams();
  const navigate = useNavigate();
  const company  = useSelector((s) => s.company?.currentCompany);
  const [deal,     setDeal]     = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const styleRef = useRef(null);

  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = PRINT_STYLES;
    document.head.appendChild(el);
    styleRef.current = el;
    return () => el.remove();
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [d, pmtsData] = await Promise.all([
        saleApi.getDeal(id),
        saleApi.listPayments({ deal: id, limit: 200 }),
      ]);
      setDeal(d);
      setPayments(pmtsData?.data ?? []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load deal");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading statement…</div>;
  if (error)   return <div className="flex h-screen items-center justify-center text-sm text-rose-600">{error}</div>;
  if (!deal)   return null;

  const co       = company || {};
  const coName   = co.companyName || co.name || "MILIK";
  const buyer    = deal.buyer   || {};
  const listing  = deal.listing || {};
  const agent    = deal.agent   || null;

  const paidPayments  = payments.filter((p) => p.status === "paid");
  const totalPaid     = paidPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance       = Number(deal.agreedPrice || 0) - totalPaid;

  let running = 0;

  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <div id="sale-print-toolbar" className="mx-auto mb-4 flex max-w-[780px] items-center justify-between gap-3 print:hidden">
        <button onClick={() => navigate(-1)} className="border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">← Back</button>
        <button onClick={() => window.print()} className="bg-[#0B3B2E] px-5 py-1.5 text-xs font-black text-white hover:bg-[#07271e]">Print / Save PDF</button>
      </div>

      <div id="sale-print-root" className="mx-auto max-w-[780px] bg-white shadow-lg print:shadow-none">
        <div className="p-10">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 border-b-[3px] border-[#0B3B2E] pb-5 mb-6">
            <div className="flex items-center gap-4">
              {co.logo
                ? <img src={co.logo} alt="logo" className="h-16 w-16 object-contain border border-slate-200" />
                : <div className="flex h-16 w-16 items-center justify-center bg-[#0B3B2E] text-2xl font-black text-white">{coName[0]}</div>
              }
              <div>
                <div className="text-lg font-black text-[#0B3B2E]">{coName}</div>
                {[co.phone || co.phoneNumber, co.email || co.companyEmail, co.address].filter(Boolean).map((v, i) => (
                  <div key={i} className="text-[11px] text-slate-500">{v}</div>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Deal Statement</div>
              <div className="mt-1 font-mono text-xl font-black text-[#0B3B2E]">{deal.dealNumber}</div>
              <div className="mt-1 text-[11px] text-slate-500">Printed: {fmtDate(new Date())}</div>
              <div className={`mt-2 inline-block border px-2 py-0.5 text-[10px] font-black uppercase ${
                deal.status === "closed" ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : deal.status === "cancelled" ? "border-slate-300 bg-slate-50 text-slate-500"
                : "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]"
              }`}>{deal.status}</div>
            </div>
          </div>

          {/* Parties */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Buyer</div>
              <div className="text-sm font-black text-slate-900">{buyer.fullName || "—"}</div>
              {buyer.buyerNumber && <div className="text-[11px] text-slate-500">ID: {buyer.buyerNumber}</div>}
              {buyer.phone && <div className="text-[11px] text-slate-500">{buyer.phone}</div>}
              {buyer.email && <div className="text-[11px] text-slate-500">{buyer.email}</div>}
            </div>
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Property</div>
              <div className="text-xs font-bold text-slate-800">{listing.title || "—"}</div>
              {listing.listingNumber && <div className="text-[11px] text-slate-500">{listing.listingNumber}</div>}
              {(listing.location || listing.town) && <div className="text-[11px] text-slate-500">{[listing.location, listing.town].filter(Boolean).join(", ")}</div>}
              {listing.propertyType && <div className="text-[11px] text-slate-500 capitalize">{listing.propertyType}</div>}
            </div>
          </div>

          {/* Deal Summary row */}
          <div className="mb-6 grid grid-cols-4 gap-0 border border-slate-200">
            {[
              ["Agreed Price",    fmtKES(deal.agreedPrice)],
              ["Total Paid",      fmtKES(totalPaid)],
              ["Balance",         fmtKES(balance)],
              ["Agent",           agent ? agent.fullName : "No Agent"],
            ].map(([label, val]) => (
              <div key={label} className="border-r border-slate-200 last:border-r-0 px-4 py-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                <div className={`mt-0.5 text-sm font-black tabular-nums ${label === "Balance" && balance > 0 ? "text-rose-700" : label === "Balance" ? "text-emerald-700" : "text-slate-900"}`}>{val}</div>
              </div>
            ))}
          </div>

          {/* Deal dates */}
          <div className="mb-6 grid grid-cols-3 gap-4 text-xs">
            {[
              ["Deal Date",     deal.dealDate],
              ["Expected Close", deal.expectedClosingDate],
              ["Actual Close",  deal.actualClosingDate],
            ].map(([label, date]) => (
              <div key={label} className="border border-slate-200 px-3 py-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                <div className="mt-0.5 font-semibold text-slate-700">{fmtDate(date)}</div>
              </div>
            ))}
          </div>

          {/* Payment Schedule / History */}
          <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Payment History</div>
          <table className="w-full border-collapse text-xs mb-6">
            <thead>
              <tr className="bg-[#0B3B2E] text-white">
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">No.</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Date</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Type</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Method</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Ref</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Status</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Amount</th>
                <th className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-5 text-center text-slate-400">No payments recorded.</td></tr>
              ) : payments.map((p, i) => {
                if (p.status === "paid") running += Number(p.amount || 0);
                return (
                  <tr key={p._id} className={`border-b border-slate-100 ${i % 2 === 0 ? "" : "bg-slate-50"}`}>
                    <td className="px-3 py-2 font-mono font-black text-[#0B3B2E]">{p.paymentNumber}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(p.paymentDate)}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtLabel(p.paymentType)}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtLabel(p.paymentMethod)}</td>
                    <td className="px-3 py-2 text-slate-400 text-[10px]">{p.reference || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`border px-1 py-0.5 text-[9px] font-black uppercase ${p.status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{p.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-slate-800">{fmtKES(p.amount)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500">{p.status === "paid" ? fmtKES(running) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-black">
                <td colSpan={6} className="px-3 py-3 text-right text-[10px] uppercase tracking-widest text-slate-500">Total Paid</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700">{fmtKES(totalPaid)}</td>
                <td />
              </tr>
              <tr className={`font-black ${balance > 0 ? "bg-rose-50" : "bg-emerald-50"}`}>
                <td colSpan={6} className="px-3 py-3 text-right text-[10px] uppercase tracking-widest text-slate-500">Outstanding Balance</td>
                <td className={`px-3 py-3 text-right font-mono text-base tabular-nums ${balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtKES(balance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          {/* Notes */}
          {deal.notes && (
            <div className="mb-6 border border-slate-200 px-4 py-3">
              <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Deal Notes</div>
              <div className="text-xs leading-relaxed text-slate-600">{deal.notes}</div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-slate-200 pt-5 mt-6">
            <div className="flex items-end justify-between gap-6">
              <div className="text-[10px] text-slate-400 leading-relaxed">
                This statement was issued by <strong>{coName}</strong>.<br />
                Printed: {fmtDate(new Date())}
              </div>
              <div className="text-right">
                <div className="mb-6 text-[10px] text-slate-400">Authorised Signature</div>
                <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500 w-40">{coName}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaleDealStatement;
