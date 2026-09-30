import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";
import { fmtDate } from "../../utils/dates";
import { printDocument } from "../../utils/printKit";
import { toast } from "react-toastify";
import { POPUP_BLOCKED, money } from "./salePrint";

const fmtKES  = (n) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2 }).format(Number(n) || 0);
const fmtLabel = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const kes = (n) => `KES ${money(n)}`;

const printReceipt = (company, payment, T, win = null) => {
  const deal = payment.deal || {};
  const buyer = deal.buyer || {};
  const listing = deal.listing || {};
  // Payment statuses: "pending" | "paid" | "cancelled" (voided). Only "paid" is a valid receipt.
  const isVoid = payment.status === "cancelled";
  const isPending = payment.status === "pending";
  const propertyName = listing.title || listing.listingNumber || "Property";
  const printed = printDocument({
    win,
    company,
    docType: "Payment Receipt",
    docNumber: payment.paymentNumber || "",
    status: isVoid ? { label: "Void", tone: "danger" } : isPending ? { label: "Pending", tone: "warning" } : { label: "Paid", tone: "success" },
    watermark: isVoid ? "VOID" : isPending ? "NOT PAID" : "PAID",
    meta: [["Date", fmtDate(payment.paymentDate)]],
    parties: [
      { heading: "Received from", name: buyer.fullName || "—", lines: [buyer.buyerNumber ? `Ref: ${buyer.buyerNumber}` : "", buyer.phone, buyer.email] },
      { heading: `Property / ${T.saleDeal}`, name: propertyName, lines: [listing.listingNumber && listing.title ? listing.listingNumber : "", deal.dealNumber ? `${T.saleDeal}: ${deal.dealNumber}` : "", listing.location ? `${listing.location}${listing.town ? `, ${listing.town}` : ""}` : ""] },
    ],
    table: {
      columns: [
        { label: "Description", value: () => `Payment for ${propertyName}`, sub: (p) => p.notes || "" },
        { label: "Type", value: (p) => fmtLabel(p.paymentType) },
        { label: "Method", value: (p) => fmtLabel(p.paymentMethod), sub: (p) => (p.reference ? `Ref: ${p.reference}` : "") },
        { label: "Amount (KES)", align: "right", value: (p) => money(p.amount) },
      ],
      rows: [payment],
    },
    totals: [
      ...(deal.agreedPrice ? [{ label: "Agreed sale price", value: kes(deal.agreedPrice) }] : []),
      { label: isVoid ? "Total received — VOIDED (Nil)" : isPending ? "Total — not yet received" : "Total received", value: kes(payment.amount), hero: true },
    ],
    amountWords: isVoid || isPending ? null : { amount: payment.amount, currency: "KES" },
    notes: isVoid || isPending
      ? [{ heading: "Not a valid receipt", text: isVoid ? "This payment has been cancelled. This receipt is not valid." : "Payment not yet confirmed. This is not a valid receipt." }]
      : [],
    signatures: [{ label: "Authorised signature", name: company?.companyName || company?.name || "" }, { label: "Received from (buyer)", name: "" }],
    stamp: true,
  });
  if (!printed) toast.error(POPUP_BLOCKED);
};

// Print a payment's receipt straight from a list, without opening this page
export const printPaymentReceiptById = async (id, { company, T, win }) => printReceipt(company, await saleApi.getPayment(id), T, win);

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

const SalePaymentReceipt = () => {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const company    = useSelector((s) => s.company?.currentCompany);
  const T = useTerms("saleDeal");
  const [payment, setPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
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
    try { setPayment(await saleApi.getPayment(id)); }
    catch (err) { setError(err?.response?.data?.message || err?.message || "Failed to load payment"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading receipt…</div>;
  if (error)   return <div className="flex h-screen items-center justify-center text-sm text-rose-600">{error}</div>;
  if (!payment) return null;

  const co      = company || {};
  const coName  = co.companyName || co.name || "MILIK";
  const deal    = payment.deal || {};
  const buyer   = deal.buyer  || {};
  const listing = deal.listing || {};
  // Payment statuses: "pending" | "paid" | "cancelled" (voided). Only "paid" is a valid receipt.
  const isVoid    = payment.status === "cancelled";
  const isPending = payment.status === "pending";
  const invalidMark = isVoid ? "VOID" : isPending ? "NOT PAID" : "";
  const strike = isVoid ? "line-through decoration-2" : "";

  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      {/* Toolbar */}
      <div id="sale-print-toolbar" className="mx-auto mb-4 flex max-w-[780px] items-center justify-between gap-3 print:hidden">
        <button onClick={() => navigate(-1)} className="border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">← Back</button>
        <button onClick={() => printReceipt(company, payment, T)} className="bg-[#0B3B2E] px-5 py-1.5 text-xs font-black text-white hover:bg-[#0A3127]">Print / Save PDF</button>
      </div>

      {/* A4 Document */}
      <div id="sale-print-root" className="relative mx-auto max-w-[780px] bg-white shadow-lg print:shadow-none">
        {invalidMark && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
            <div
              className="border-[8px] border-double border-rose-700 px-8 py-2 text-[96px] font-black uppercase leading-none tracking-widest text-rose-700/25"
              style={{ transform: "rotate(-30deg)" }}
            >
              {invalidMark}
            </div>
          </div>
        )}
        <div className="p-10">
          {invalidMark && (
            <div className="mb-5 border-4 border-double border-rose-700 bg-rose-50 px-4 py-2 text-center text-sm font-black uppercase tracking-widest text-rose-700">
              {isVoid ? "*** VOID — THIS PAYMENT HAS BEEN CANCELLED. THIS RECEIPT IS NOT VALID ***" : "*** PENDING — PAYMENT NOT YET CONFIRMED. THIS IS NOT A VALID RECEIPT ***"}
            </div>
          )}
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
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Payment Receipt</div>
              <div className="mt-1 font-mono text-xl font-black text-[#0B3B2E]">{payment.paymentNumber}</div>
              <div className="mt-1 text-[11px] text-slate-500">{fmtDate(payment.paymentDate)}</div>
              <div className={`mt-2 inline-block border px-2 py-0.5 text-[10px] font-black uppercase ${payment.status === "paid" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-700"}`}>
                {payment.status}
              </div>
            </div>
          </div>

          {/* Received From */}
          <div className="mb-6 grid grid-cols-2 gap-6">
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Received From</div>
              <div className="text-sm font-black text-slate-900">{buyer.fullName || "—"}</div>
              {buyer.buyerNumber && <div className="text-[11px] text-slate-500">Ref: {buyer.buyerNumber}</div>}
              {buyer.phone  && <div className="text-[11px] text-slate-500">{buyer.phone}</div>}
              {buyer.email  && <div className="text-[11px] text-slate-500">{buyer.email}</div>}
            </div>
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Property / {T.saleDeal}</div>
              <div className="text-xs font-bold text-slate-800">{listing.title || listing.listingNumber || "—"}</div>
              {listing.listingNumber && listing.title && <div className="text-[11px] text-slate-500">{listing.listingNumber}</div>}
              {deal.dealNumber && <div className="text-[11px] text-slate-500">{T.saleDeal}: {deal.dealNumber}</div>}
              {listing.location && <div className="text-[11px] text-slate-500">{listing.location}{listing.town ? `, ${listing.town}` : ""}</div>}
            </div>
          </div>

          {/* Payment Details */}
          <table className="w-full border-collapse text-xs mb-6">
            <thead>
              <tr className="bg-[#0B3B2E] text-white">
                <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Description</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Type</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest">Method</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-widest">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="px-4 py-3 text-slate-800">
                  Payment for {listing.title || listing.listingNumber || "Property"}
                  {payment.notes && <div className="text-[10px] text-slate-400 mt-0.5">{payment.notes}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{fmtLabel(payment.paymentType)}</td>
                <td className="px-4 py-3 text-slate-600">
                  {fmtLabel(payment.paymentMethod)}
                  {payment.reference && <div className="text-[10px] text-slate-400 mt-0.5">Ref: {payment.reference}</div>}
                </td>
                <td className={`px-4 py-3 text-right font-black text-slate-900 font-mono tabular-nums ${strike}`}>{fmtKES(payment.amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-slate-50">
                <td colSpan={3} className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-500">{isVoid ? "Total Received — VOIDED (Nil)" : isPending ? "Total — Not Yet Received" : "Total Received"}</td>
                <td className={`px-4 py-3 text-right font-mono text-base font-black text-[#0B3B2E] tabular-nums ${strike}`}>{fmtKES(payment.amount)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Deal Balance Summary */}
          {deal.agreedPrice && (
            <div className="mb-6 flex items-center gap-4 border border-[#B7C9C0] bg-[#F1F6F3] p-4">
              <div className="flex-1">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Agreed Sale Price</div>
                <div className="font-mono text-sm font-black text-slate-800 tabular-nums">{fmtKES(deal.agreedPrice)}</div>
              </div>
              <div className="h-8 w-px bg-[#B7C9C0]" />
              <div className="flex-1">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">This Payment{isVoid ? " (Voided)" : isPending ? " (Pending)" : ""}</div>
                <div className={`font-mono text-sm font-black text-emerald-700 tabular-nums ${strike}`}>{fmtKES(payment.amount)}</div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-slate-200 pt-5 mt-8">
            <div className="flex items-end justify-between gap-6">
              <div className="text-[10px] text-slate-400 leading-relaxed">
                This receipt was issued by <strong>{coName}</strong>.<br />
                Printed: {fmtDate(new Date())}
              </div>
              <div className="text-right">
                <div className="mb-6 text-[10px] text-slate-400">Authorised Signature</div>
                <div className="border-t border-slate-400 pt-1 text-[10px] text-slate-500 w-40">
                  {coName}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalePaymentReceipt;
