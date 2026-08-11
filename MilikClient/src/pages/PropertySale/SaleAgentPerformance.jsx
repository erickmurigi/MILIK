import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { fmtDate } from "../../utils/dates";

const fmtLabel = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const commBadge = (s) => ({
  pending:   "border-amber-200 bg-amber-50 text-amber-700",
  approved:  "border-blue-200 bg-blue-50 text-blue-700",
  paid:      "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
  reversed:  "border-rose-200 bg-rose-50 text-rose-700",
}[s] || "border-slate-200 bg-slate-50 text-slate-500");

const dealBadge = (s) => ({
  active:    "border-[#B7C9C0] bg-[#F1F6F3] text-[#0B3B2E]",
  closed:    "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-slate-200 bg-slate-50 text-slate-500",
}[s] || "border-slate-200 bg-slate-50 text-slate-500");

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

const SaleAgentPerformance = () => {
  const { id }   = useParams();
  const navigate = useNavigate();
  const company  = useSelector((s) => s.company?.currentCompany);
  const biz      = company?._id;

  const [agent,       setAgent]       = useState(null);
  const [deals,       setDeals]       = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
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
      const [a, dealsData, commsData] = await Promise.all([
        saleApi.getAgent(id),
        saleApi.listDeals({ agentId: id, limit: 200 }),
        saleApi.listCommissions({ agentId: id, limit: 200 }),
      ]);
      setAgent(a);
      setDeals(dealsData?.data ?? []);
      setCommissions(commsData?.data ?? []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to load agent");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-slate-500">Loading performance data…</div>;
  if (error)   return <div className="flex h-screen items-center justify-center text-sm text-rose-600">{error}</div>;
  if (!agent)  return null;

  const co     = company || {};
  const coName = co.companyName || co.name || "MILIK";

  const totalCommEarned  = commissions.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.commissionAmount || 0), 0);
  const totalCommPending = commissions.filter((c) => ["pending", "approved"].includes(c.status)).reduce((s, c) => s + Number(c.commissionAmount || 0), 0);
  const totalDealsValue  = deals.reduce((s, d) => s + Number(d.agreedPrice || 0), 0);
  const closedDeals      = deals.filter((d) => d.status === "closed");
  const activeDeals      = deals.filter((d) => d.status === "active");

  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <div id="sale-print-toolbar" className="mx-auto mb-4 flex max-w-[860px] items-center justify-between gap-3 print:hidden">
        <button onClick={() => navigate("/sale/agents")} className="border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">← Back to Agents</button>
        <button onClick={() => window.print()} className="bg-[#0B3B2E] px-5 py-1.5 text-xs font-black text-white hover:bg-[#07271e]">Print / Save PDF</button>
      </div>

      <div id="sale-print-root" className="mx-auto max-w-[860px] bg-white shadow-lg print:shadow-none">
        <div className="p-8">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 border-b-[3px] border-[#0B3B2E] pb-5 mb-6">
            <div className="flex items-center gap-4">
              {co.logo
                ? <img src={co.logo} alt="logo" className="h-14 w-14 object-contain border border-slate-200" />
                : <div className="flex h-14 w-14 items-center justify-center bg-[#0B3B2E] text-xl font-black text-white">{coName[0]}</div>
              }
              <div>
                <div className="text-base font-black text-[#0B3B2E]">{coName}</div>
                {[co.phone || co.phoneNumber, co.email || co.companyEmail].filter(Boolean).map((v, i) => (
                  <div key={i} className="text-[11px] text-slate-500">{v}</div>
                ))}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Agent Performance</div>
              <div className="mt-1 font-mono text-lg font-black text-[#0B3B2E]">{agent.agentNumber}</div>
              <div className="mt-1 text-[11px] text-slate-500">Printed: {fmtDate(new Date())}</div>
              <div className={`mt-1.5 inline-block border px-2 py-0.5 text-[9px] font-black uppercase ${agent.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{agent.status}</div>
            </div>
          </div>

          {/* Agent Profile */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Agent Details</div>
              <div className="text-base font-black text-slate-900">{agent.fullName}</div>
              {agent.phone && <div className="text-[11px] text-slate-500 mt-0.5">{agent.phone}</div>}
              {agent.email && <div className="text-[11px] text-slate-500">{agent.email}</div>}
              {agent.idNumber && <div className="text-[11px] text-slate-500">ID: {agent.idNumber}</div>}
              {agent.address && <div className="text-[11px] text-slate-500">{agent.address}</div>}
            </div>
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Commission Rate</div>
              <div className="text-lg font-black text-[#0B3B2E]">
                {agent.commissionType === "percentage" ? `${agent.commissionRate}%` : fmtKES(agent.commissionRate)}
              </div>
              <div className="text-[11px] text-slate-500 capitalize">{fmtLabel(agent.commissionType)} commission</div>
              {agent.notes && <div className="mt-2 text-[11px] text-slate-500 leading-relaxed">{agent.notes}</div>}
            </div>
          </div>

          {/* Performance KPIs */}
          <div className="mb-6 grid grid-cols-4 gap-0 border border-slate-200">
            {[
              ["Total Deals",     deals.length,                false],
              ["Closed Deals",    closedDeals.length,          false],
              ["Active Deals",    activeDeals.length,          false],
              ["Total Value",     fmtKES(totalDealsValue),     false],
              ["Commissions Paid",fmtKES(totalCommEarned),     false],
              ["Comm. Pending",   fmtKES(totalCommPending),    totalCommPending > 0],
              ["Deals — Active",  fmtKES(activeDeals.reduce((s,d) => s + Number(d.agreedPrice||0), 0)), false],
              ["Close Rate",      deals.length > 0 ? `${Math.round((closedDeals.length / deals.length) * 100)}%` : "—", false],
            ].map(([label, val, warn], i) => (
              <div key={label} className={`border-b border-r border-slate-200 last:border-r-0 px-4 py-3 ${i >= 4 ? "border-b-0" : ""}`}>
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</div>
                <div className={`mt-0.5 font-mono font-black tabular-nums text-sm ${warn ? "text-amber-700" : "text-slate-900"}`}>{val}</div>
              </div>
            ))}
          </div>

          {/* Deals */}
          <div className="mb-6">
            <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Deals ({deals.length})</div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#0B3B2E] text-white">
                  {["Deal No.", "Property", "Buyer", "Agreed Price", "Paid", "Balance", "Date", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-400">No deals found.</td></tr>
                ) : deals.map((d, i) => (
                  <tr key={d._id} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50" : ""}`}>
                    <td className="px-3 py-2 font-mono font-black text-[#0B3B2E]">{d.dealNumber}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[120px] truncate">{d.listing?.title || d.listing?.listingNumber || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{d.buyer?.fullName || "—"}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-800">{fmtKES(d.agreedPrice)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-emerald-700">{fmtKES(d.totalPaid)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-600">{fmtKES(d.balance)}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(d.dealDate)}</td>
                    <td className="px-3 py-2"><span className={`border px-1.5 py-0.5 text-[8px] font-black uppercase ${dealBadge(d.status)}`}>{d.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Commissions */}
          <div className="mb-6">
            <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Commissions ({commissions.length})</div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#0B3B2E] text-white">
                  {["Comm. No.", "Deal", "Sale Amount", "Rate", "Commission", "Status", "Payout Date"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {commissions.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">No commissions found.</td></tr>
                ) : commissions.map((c, i) => (
                  <tr key={c._id} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50" : ""}`}>
                    <td className="px-3 py-2 font-mono font-black text-[#0B3B2E]">{c.commissionNumber}</td>
                    <td className="px-3 py-2 text-slate-600">{c.deal?.dealNumber || "—"}</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-700">{fmtKES(c.saleAmount)}</td>
                    <td className="px-3 py-2 text-slate-600">{c.commissionType === "percentage" ? `${c.commissionRate}%` : fmtKES(c.commissionRate)}</td>
                    <td className="px-3 py-2 font-mono font-black tabular-nums text-[#0B3B2E]">{fmtKES(c.commissionAmount)}</td>
                    <td className="px-3 py-2"><span className={`border px-1.5 py-0.5 text-[8px] font-black uppercase ${commBadge(c.status)}`}>{c.status}</span></td>
                    <td className="px-3 py-2 text-slate-500">{fmtDate(c.payoutDate)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50">
                  <td colSpan={4} className="px-3 py-2.5 text-right text-[9px] font-black uppercase tracking-wide text-slate-500">Total Paid</td>
                  <td className="px-3 py-2.5 font-mono font-black tabular-nums text-emerald-700">{fmtKES(totalCommEarned)}</td>
                  <td colSpan={2} />
                </tr>
                {totalCommPending > 0 && (
                  <tr className="bg-amber-50">
                    <td colSpan={4} className="px-3 py-2.5 text-right text-[9px] font-black uppercase tracking-wide text-amber-600">Pending / Approved</td>
                    <td className="px-3 py-2.5 font-mono font-black tabular-nums text-amber-700">{fmtKES(totalCommPending)}</td>
                    <td colSpan={2} />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-200 pt-4 text-center text-[10px] text-slate-400">
            Agent performance report for {agent.fullName} ({agent.agentNumber}) · Issued by {coName} · Printed: {fmtDate(new Date())}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaleAgentPerformance;
