import React, { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import { saleApi, fmtKES } from "../../services/propertySaleApi";
import { fmtDate } from "../../utils/dates";
import { useTerms } from "../../hooks/useTerm";
import { toast } from "react-toastify";
import { printTabularList } from "../../utils/printKit";
import { POPUP_BLOCKED, money, shortDate } from "./salePrint";

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

const kes = (n) => `KES ${money(n)}`;

const printPerformance = (company, { agent, deals, commissions, totalCommEarned, totalCommPending, totalDealsValue, closedDeals, activeDeals, truncated }, T) => {
  const printed = printTabularList({
    title: `${T.saleAgent} Performance`,
    subtitle: `${agent.fullName}${agent.agentNumber ? ` (${agent.agentNumber})` : ""}${agent.status ? ` · ${fmtLabel(agent.status)}` : ""}`,
    company,
    summaryItems: [
      [`Total ${T.saleDeals}`, String(deals.length)],
      [`Closed ${T.saleDeals}`, String(closedDeals.length)],
      [`Active ${T.saleDeals}`, String(activeDeals.length)],
      ["Total value", kes(totalDealsValue)],
      ["Commissions paid", kes(totalCommEarned)],
      ["Comm. pending", kes(totalCommPending)],
      ["Close rate", deals.length > 0 ? `${Math.round((closedDeals.length / deals.length) * 100)}%` : "—"],
      ["Commission rate", agent.commissionType === "percentage" ? `${agent.commissionRate}%` : kes(agent.commissionRate)],
    ],
    columns: [],
    sections: [
      {
        heading: `${T.saleDeals} (${deals.length})`,
        columns: [
          { label: `${T.saleDeal} No.`, value: (d) => d.dealNumber },
          { label: "Property", value: (d) => d.listing?.title || d.listing?.listingNumber || "—" },
          { label: T.saleBuyer, value: (d) => d.buyer?.fullName || "—" },
          { label: "Agreed price", align: "right", value: (d) => money(d.agreedPrice) },
          { label: "Paid", align: "right", value: (d) => money(d.totalPaid), tone: () => "pos" },
          { label: "Balance", align: "right", value: (d) => money(d.balance) },
          { label: "Date", value: (d) => shortDate(d.dealDate) },
          { label: "Status", value: (d) => fmtLabel(d.status) },
        ],
        rows: deals,
        totalsRow: false,
      },
      {
        heading: `Commissions (${commissions.length})`,
        columns: [
          { label: "Comm. No.", value: (c) => c.commissionNumber },
          { label: T.saleDeal, value: (c) => c.deal?.dealNumber || "—" },
          { label: "Sale amount", align: "right", value: (c) => money(c.saleAmount) },
          { label: "Rate", value: (c) => (c.commissionType === "percentage" ? `${c.commissionRate}%` : kes(c.commissionRate)) },
          { label: "Commission", align: "right", value: (c) => money(c.commissionAmount), bold: true },
          { label: "Status", value: (c) => fmtLabel(c.status) },
          { label: "Payout date", value: (c) => shortDate(c.payoutDate) },
        ],
        rows: commissions,
        totalsRow: ["Total paid", "", "", "", money(totalCommEarned), totalCommPending > 0 ? `Pending ${money(totalCommPending)}` : "", ""],
      },
    ],
    notes: truncated ? ["Data truncated: too many records to load in full. Figures in this report may be under-reported."] : [],
  });
  if (!printed) toast.error(POPUP_BLOCKED);
};

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

// Server caps `limit` at 200 and paginates newest-first, so a single request
// silently under-reports once an agent has >200 records. Fetch every page.
const PAGE_LIMIT = 200;
const MAX_PAGES  = 50;
const fetchAllPages = async (listFn, params = {}) => {
  const first = await listFn({ ...params, page: 1, limit: PAGE_LIMIT });
  const pages = Math.max(Number(first?.pages) || 1, 1);
  const last  = Math.min(pages, MAX_PAGES);
  if (pages > MAX_PAGES) console.warn(`fetchAllPages: ${pages} pages exceeds safety cap of ${MAX_PAGES}; results truncated`);
  const rest = last > 1
    ? await Promise.all(Array.from({ length: last - 1 }, (_, i) => listFn({ ...params, page: i + 2, limit: PAGE_LIMIT })))
    : [];
  const byId = new Map();
  [first, ...rest].forEach((p) => (p?.data ?? []).forEach((r) => byId.set(r._id, r)));
  const data  = [...byId.values()];
  const total = Number(first?.total) || data.length;
  return { data, total, truncated: data.length < total };
};

const EMPTY = [];

const SaleAgentPerformance = () => {
  const T        = useTerms("saleAgent", "saleAgents", "saleDeal", "saleDeals", "saleBuyer");
  const { id }   = useParams();
  const navigate = useNavigate();
  const company  = useSelector((s) => s.company?.currentCompany);

  const biz      = company?._id;
  const styleRef = useRef(null);

  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = PRINT_STYLES;
    document.head.appendChild(el);
    styleRef.current = el;
    return () => el.remove();
  }, []);

  const { data: perf, isPending: loading, error: loadError } = useQuery({
    queryKey: ["sale-agent-performance", biz, id],
    queryFn: async () => {
      const [a, dealsData, commsData] = await Promise.all([
        saleApi.getAgent(id),
        fetchAllPages(saleApi.listDeals, { agentId: id }),
        fetchAllPages(saleApi.listCommissions, { agentId: id }),
      ]);
      return {
        agent:       a,
        deals:       dealsData.data,
        commissions: commsData.data,
        truncated:   !!(dealsData.truncated || commsData.truncated),
      };
    },
    enabled:  !!biz && !!id,
    staleTime: 60_000,
  });

  const agent       = perf?.agent ?? null;
  const deals       = perf?.deals ?? EMPTY;
  const commissions = perf?.commissions ?? EMPTY;
  const truncated   = !!perf?.truncated;
  const error       = loadError ? (loadError?.response?.data?.message || loadError?.message || `Failed to load ${T.saleAgent.toLowerCase()}`) : null;

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
        <button onClick={() => navigate("/sale/agents")} className="border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">← Back to {T.saleAgents}</button>
        <button onClick={() => printPerformance(company, { agent, deals, commissions, totalCommEarned, totalCommPending, totalDealsValue, closedDeals, activeDeals, truncated }, T)} className="bg-[#0B3B2E] px-5 py-1.5 text-xs font-black text-white hover:bg-[#0A3127]">Print / Save PDF</button>
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
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">{T.saleAgent} Performance</div>
              <div className="mt-1 font-mono text-lg font-black text-[#0B3B2E]">{agent.agentNumber}</div>
              <div className="mt-1 text-[11px] text-slate-500">Printed: {fmtDate(new Date())}</div>
              <div className={`mt-1.5 inline-block border px-2 py-0.5 text-[9px] font-black uppercase ${agent.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{agent.status}</div>
            </div>
          </div>

          {/* Agent Profile */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div className="border border-slate-200 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">{T.saleAgent} Details</div>
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

          {truncated && (
            <div className="mb-4 border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800">
              Data truncated: too many records to load in full. Figures in this report may be under-reported.
            </div>
          )}

          {/* Performance KPIs */}
          <div className="mb-6 grid grid-cols-4 gap-0 border border-slate-200">
            {[
              [`Total ${T.saleDeals}`,     deals.length,                false],
              [`Closed ${T.saleDeals}`,    closedDeals.length,          false],
              [`Active ${T.saleDeals}`,    activeDeals.length,          false],
              ["Total Value",     fmtKES(totalDealsValue),     false],
              ["Commissions Paid",fmtKES(totalCommEarned),     false],
              ["Comm. Pending",   fmtKES(totalCommPending),    totalCommPending > 0],
              [`${T.saleDeals} — Active`,  fmtKES(activeDeals.reduce((s,d) => s + Number(d.agreedPrice||0), 0)), false],
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
            <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">{T.saleDeals} ({deals.length})</div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-[#0B3B2E] text-white">
                  {[`${T.saleDeal} No.`, "Property", T.saleBuyer, "Agreed Price", "Paid", "Balance", "Date", "Status"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[9px] font-black uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-400">No {T.saleDeals.toLowerCase()} found.</td></tr>
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
                  {["Comm. No.", T.saleDeal, "Sale Amount", "Rate", "Commission", "Status", "Payout Date"].map((h) => (
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
            {T.saleAgent} performance report for {agent.fullName} ({agent.agentNumber}) · Issued by {coName} · Printed: {fmtDate(new Date())}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaleAgentPerformance;
