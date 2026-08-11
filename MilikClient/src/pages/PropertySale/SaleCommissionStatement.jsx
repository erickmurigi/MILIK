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

const statusStyle = (s) => ({
  pending:   "border-amber-200 bg-amber-50 text-amber-700",
  approved:  "border-blue-200 bg-blue-50 text-blue-700",
  paid:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
  reversed:  "border-rose-200 bg-rose-50 text-rose-700",
}[s] || "border-slate-200 bg-slate-50 text-slate-500");

const SaleCommissionStatement = () => {
  const { id }   = useParams();
  const navigate = useNavigate();
  const company  = useSelector((s) => s.company?.currentCompany);
  const [comm,    setComm]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
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
    try { setComm(await saleApi.getCommission(id)); }
    catch (err) { setError(err?.response?.data?.message || err?.message || "Failed to load commission"); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading statement…</div>;
  if (error)   return <div className="flex h-screen items-center justify-center text-sm text-rose-600">{error}</div>;
  if (!comm)   return null;

  const co      = company || {};
  const coName  = co.companyName || co.name || "MILIK";
  const agent   = comm.agent   || {};
  const deal    = comm.deal    || {};
  const listing = comm.listing || {};
  const buyer   = comm.buyer   || {};

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
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Commission Statement</div>
              <div className="mt-1 font-mono text-xl font-black text-[#0B3B2E]">{comm.commissionNumber}</div>
              <div className="mt-1 text-[11px] text-slate-500">Printed: {fmtDate(new Date())}</div>
              <div className={`mt-2 inline-block border px-2 py-0.5 text-[10px] font-black uppercase ${statusStyle(comm.status)}`}>{comm.status}</div>
            </div>
          </div>

          {/* Agent info */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Agent</div>
              <div className="text-sm font-black text-slate-900">{agent.fullName || "—"}</div>
              {agent.agentNumber && <div className="text-[11px] text-slate-500">ID: {agent.agentNumber}</div>}
              {agent.phone && <div className="text-[11px] text-slate-500">{agent.phone}</div>}
            </div>
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Property / Deal</div>
              <div className="text-xs font-bold text-slate-800">{typeof listing === "object" ? listing.title || listing.listingNumber : listing || "—"}</div>
              {deal.dealNumber && <div className="text-[11px] text-slate-500">Deal: {deal.dealNumber}</div>}
              {buyer.fullName  && <div className="text-[11px] text-slate-500">Buyer: {buyer.fullName}</div>}
            </div>
          </div>

          {/* Commission breakdown */}
          <div className="mb-6 border border-slate-200">
            <div className="border-b border-slate-200 bg-[#F1F6F3] px-5 py-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#0B3B2E]">Commission Calculation</div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-slate-200">
              {[
                ["Sale Amount",       fmtKES(comm.saleAmount)],
                ["Commission Type",   fmtLabel(comm.commissionType)],
                ["Rate / Basis",      comm.commissionType === "percentage" ? `${comm.commissionRate}%` : fmtKES(comm.commissionRate)],
                ["Commission Amount", fmtKES(comm.commissionAmount)],
              ].map(([label, val], i) => (
                <div key={label} className={`px-5 py-4 ${i < 2 ? "" : "border-t border-slate-200"}`}>
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                  <div className={`mt-1 font-mono font-black tabular-nums ${label === "Commission Amount" ? "text-lg text-[#0B3B2E]" : "text-sm text-slate-800"}`}>{val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Payout info */}
          {comm.status === "paid" && (
            <div className="mb-6 border border-emerald-200 bg-emerald-50 px-5 py-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-emerald-600">Payout Details</div>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-[9px] text-emerald-600 uppercase font-black">Payout Date</div>
                  <div className="font-semibold text-slate-800">{fmtDate(comm.payoutDate)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-emerald-600 uppercase font-black">Payout Method</div>
                  <div className="font-semibold text-slate-800">{fmtLabel(comm.payoutMethod)}</div>
                </div>
                {comm.payoutReference && (
                  <div>
                    <div className="text-[9px] text-emerald-600 uppercase font-black">Reference</div>
                    <div className="font-semibold text-slate-800">{comm.payoutReference}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {comm.notes && (
            <div className="mb-6 border border-slate-200 px-4 py-3">
              <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Notes</div>
              <div className="text-xs leading-relaxed text-slate-600">{comm.notes}</div>
            </div>
          )}

          {/* Summary box */}
          <div className="mb-6 border-2 border-[#0B3B2E] p-5 text-center">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Commission {comm.status === "paid" ? "Paid" : "Due"}</div>
            <div className="mt-2 font-mono text-3xl font-black text-[#0B3B2E] tabular-nums">{fmtKES(comm.commissionAmount)}</div>
            <div className="mt-1 text-[11px] text-slate-500">for deal {deal.dealNumber || "—"} · {agent.fullName || "—"}</div>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-200 pt-5">
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

export default SaleCommissionStatement;
