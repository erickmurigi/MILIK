import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { saleApi } from "../../services/propertySaleApi";

const fmtKES  = (n) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2 }).format(Number(n) || 0);
const fmtDate = (v) => v ? new Date(v).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" }) : "—";
const fmtLabel = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const PRINT_STYLES = `
  @page { size: A4; margin: 20mm 18mm; }
  @media print {
    html, body { height: auto !important; overflow: visible !important; }
    body > * { visibility: hidden !important; }
    #sale-print-root, #sale-print-root * { visibility: visible !important; }
    #sale-print-toolbar { display: none !important; }
    #sale-print-root { position: fixed !important; inset: 0 !important; background: white !important; }
  }
`;

const SaleDealSummary = () => {
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
      setPayments((pmtsData?.data ?? []).filter((p) => p.status === "paid"));
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load deal");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
  if (error)   return <div className="flex h-screen items-center justify-center text-sm text-rose-600">{error}</div>;
  if (!deal)   return null;

  const co      = company || {};
  const coName  = co.companyName || co.name || "MILIK";
  const buyer   = deal.buyer   || {};
  const listing = deal.listing || {};
  const agent   = deal.agent   || null;

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance   = Number(deal.agreedPrice || 0) - totalPaid;

  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <div id="sale-print-toolbar" className="mx-auto mb-4 flex max-w-[780px] items-center justify-between gap-3 print:hidden">
        <button onClick={() => navigate(-1)} className="border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">← Back</button>
        <button onClick={() => window.print()} className="bg-[#0B3B2E] px-5 py-1.5 text-xs font-black text-white hover:bg-[#07271e]">Print / Save PDF</button>
      </div>

      <div id="sale-print-root" className="mx-auto max-w-[780px] bg-white shadow-lg print:shadow-none">
        <div className="p-10">
          {/* Watermark-style top band */}
          <div className="mb-8 border-b-4 border-[#0B3B2E] pb-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-5">
                {co.logo
                  ? <img src={co.logo} alt="logo" className="h-20 w-20 object-contain border border-slate-200" />
                  : <div className="flex h-20 w-20 items-center justify-center bg-[#0B3B2E] text-3xl font-black text-white">{coName[0]}</div>
                }
                <div>
                  <div className="text-xl font-black text-[#0B3B2E]">{coName}</div>
                  <div className="text-[11px] text-slate-500">Property Sales Division</div>
                  {[co.phone || co.phoneNumber, co.email || co.companyEmail].filter(Boolean).map((v, i) => (
                    <div key={i} className="text-[11px] text-slate-500">{v}</div>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sale Agreement</div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Summary</div>
                <div className="mt-2 font-mono text-2xl font-black text-[#0B3B2E]">{deal.dealNumber}</div>
              </div>
            </div>
          </div>

          {/* Document title block */}
          <div className="mb-8 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Property Sale Agreement Cover Sheet</div>
            <div className="mt-2 text-2xl font-black text-slate-900">{listing.title || listing.listingNumber || "Property"}</div>
            {(listing.location || listing.town) && (
              <div className="mt-1 text-sm text-slate-500">{[listing.location, listing.town].filter(Boolean).join(", ")}{listing.propertyType ? ` · ${fmtLabel(listing.propertyType)}` : ""}</div>
            )}
            {listing.listingNumber && <div className="mt-0.5 font-mono text-[11px] text-slate-400">{listing.listingNumber}</div>}
          </div>

          {/* Parties */}
          <div className="mb-8">
            <div className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Parties to the Agreement</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="border-l-4 border-[#0B3B2E] bg-[#F1F6F3] px-4 py-4">
                <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[#0B3B2E]">Vendor / Seller</div>
                <div className="text-sm font-black text-slate-900">{coName}</div>
                {co.address && <div className="text-[11px] text-slate-600 mt-0.5">{co.address}</div>}
                {(co.phone || co.phoneNumber) && <div className="text-[11px] text-slate-600">{co.phone || co.phoneNumber}</div>}
              </div>
              <div className="border-l-4 border-slate-400 bg-slate-50 px-4 py-4">
                <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-500">Purchaser / Buyer</div>
                <div className="text-sm font-black text-slate-900">{buyer.fullName || "—"}</div>
                {buyer.idNumber && <div className="text-[11px] text-slate-600 mt-0.5">ID/Passport: {buyer.idNumber}</div>}
                {buyer.phone   && <div className="text-[11px] text-slate-600">{buyer.phone}</div>}
                {buyer.email   && <div className="text-[11px] text-slate-600">{buyer.email}</div>}
                {buyer.address && <div className="text-[11px] text-slate-600">{buyer.address}</div>}
              </div>
            </div>
          </div>

          {/* Property details */}
          <div className="mb-8">
            <div className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Property Details</div>
            <div className="grid grid-cols-3 gap-0 border border-slate-200">
              {[
                ["Listing No.", listing.listingNumber || "—"],
                ["Property Type", fmtLabel(listing.propertyType || "—")],
                ["Location", [listing.location, listing.town].filter(Boolean).join(", ") || "—"],
                ["Title", listing.title || "—"],
                ["Asking Price", fmtKES(listing.askingPrice)],
                ["Agreed Price", fmtKES(deal.agreedPrice)],
              ].map(([label, val], i) => (
                <div key={label} className={`border-b border-r border-slate-200 px-4 py-3 ${i % 3 === 2 ? "border-r-0" : ""} ${i >= 3 ? "border-b-0" : ""}`}>
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-800">{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Financial summary */}
          <div className="mb-8">
            <div className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Financial Summary</div>
            <div className="border border-slate-200">
              <div className="grid grid-cols-3 border-b border-slate-200 bg-[#F1F6F3]">
                {[
                  ["Agreed Purchase Price", fmtKES(deal.agreedPrice), false],
                  ["Amount Paid to Date",   fmtKES(totalPaid),        false],
                  ["Outstanding Balance",   fmtKES(balance),          balance > 0],
                ].map(([label, val, warn]) => (
                  <div key={label} className="border-r border-slate-200 last:border-r-0 px-4 py-4 text-center">
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                    <div className={`mt-1.5 font-mono text-base font-black tabular-nums ${warn ? "text-rose-700" : "text-[#0B3B2E]"}`}>{val}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 text-xs text-slate-500">
                {[
                  ["Deal Date",             fmtDate(deal.dealDate)],
                  ["Expected Closing Date", fmtDate(deal.expectedClosingDate)],
                  ["Payments Made",         `${payments.length} payment${payments.length !== 1 ? "s" : ""}`],
                ].map(([label, val]) => (
                  <div key={label} className="border-r border-slate-200 last:border-r-0 px-4 py-2">
                    <span className="font-bold text-slate-400">{label}: </span>{val}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Agent */}
          {agent && (
            <div className="mb-8 border border-slate-200 px-4 py-3 text-xs">
              <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Facilitating Agent</div>
              <div className="font-semibold text-slate-800">{agent.fullName} ({agent.agentNumber}){agent.phone ? ` · ${agent.phone}` : ""}</div>
            </div>
          )}

          {/* Notes */}
          {deal.notes && (
            <div className="mb-8 border border-slate-200 px-4 py-3">
              <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Special Conditions / Notes</div>
              <div className="text-xs leading-relaxed text-slate-700">{deal.notes}</div>
            </div>
          )}

          {/* Signature blocks */}
          <div className="mb-8">
            <div className="mb-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Signatures</div>
            <div className="grid grid-cols-2 gap-8">
              {["Vendor Signature", "Purchaser Signature"].map((label) => (
                <div key={label}>
                  <div className="mb-10 text-[10px] text-slate-400">{label}:</div>
                  <div className="border-t border-slate-400 pt-2">
                    <div className="text-[10px] text-slate-500">Name: ________________________</div>
                    <div className="mt-2 text-[10px] text-slate-500">Date: ________________________</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-200 pt-4 text-center text-[10px] text-slate-400">
            This is a summary cover sheet issued by <strong>{coName}</strong>. Deal ref: {deal.dealNumber}. Printed: {fmtDate(new Date())}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaleDealSummary;
