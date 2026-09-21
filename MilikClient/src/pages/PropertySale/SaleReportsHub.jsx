import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "react-toastify";
import {
  FaArrowRight, FaCoins, FaFileExcel, FaChartLine, FaUserTie, FaCity, FaPhoneAlt, FaWhatsapp, FaSyncAlt, FaRegClock,
} from "react-icons/fa";
import PropertySaleShell from "./PropertySaleShell";
import AppSelect from "../../components/common/AppSelect";
import PaginationBar from "../../components/PaginationBar";
import { fmtKES, saleApi } from "../../services/propertySaleApi";
import { useTerms } from "../../hooks/useTerm";

// Report Center: every Property Sales report in one page, grouped by the question it answers. A live "pulse" strip sits
// on top; the money-owed and register reports open inside the page, the older ones open as their own pages.
const GREEN = "#0B3B2E";
const n2 = (v) => Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (v) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inputCls = "h-7 rounded border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#0B3B2E]";

const AGING = [
  { key: "notDue", label: "Not yet due", bar: "bg-emerald-500", text: "text-emerald-700" },
  { key: "d1_30", label: "1–30 days late", bar: "bg-amber-400", text: "text-amber-700" },
  { key: "d31_60", label: "31–60 days", bar: "bg-orange-500", text: "text-orange-700" },
  { key: "d61_90", label: "61–90 days", bar: "bg-rose-500", text: "text-rose-700" },
  { key: "d90plus", label: "Over 90 days", bar: "bg-red-800", text: "text-red-800" },
  { key: "unscheduled", label: "No due date", bar: "bg-slate-400", text: "text-slate-600" },
];
const BUCKET_BADGE = { d1_30: "bg-amber-100 text-amber-800", d31_60: "bg-orange-100 text-orange-800", d61_90: "bg-rose-100 text-rose-800", d90plus: "bg-red-100 text-red-900" };

const toWhatsApp = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 9) return "";
  if (digits.startsWith("254")) return digits;
  return `254${digits.replace(/^0/, "")}`;
};

// ── a small shared table: columns give the cell, and the raw value used for the Excel export ───────────────────────
const Grid = ({ columns, rows, loading, empty }) => (
  <div className="min-h-0 flex-1 overflow-auto">
    <table className="w-full min-w-[900px] border-collapse text-[11px]">
      <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={`whitespace-nowrap px-2.5 py-1.5 font-bold ${c.right ? "text-right" : "text-left"}`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading && !rows.length ? (
          <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">Loading…</td></tr>
        ) : !rows.length ? (
          <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">{empty}</td></tr>
        ) : rows.map((r, i) => (
          <tr key={r._id || i} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50/60" : "bg-white"} hover:bg-emerald-50/40`}>
            {columns.map((c) => (
              <td key={c.key} className={`px-2.5 py-1.5 ${c.right ? "text-right tabular-nums" : ""} ${c.cls || "text-slate-700"}`}>{c.render ? c.render(r) : r[c.key]}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const exportExcel = async (columns, rows, name) => {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    columns.map((c) => c.label),
    ...rows.map((r) => columns.map((c) => (c.xl ? c.xl(r) : c.render ? undefined : r[c.key]) ?? "")),
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Report");
  XLSX.writeFile(book, `${name}-${ymd(new Date())}.xlsx`);
};

// ── report views ───────────────────────────────────────────────────────────────────────────────────────────────────
const usePaged = (id, params, fetcher) => {
  const [pageSize, setPageSize] = useState(50);
  // the page number belongs to one set of filters: changing any filter starts again from page 1
  const key = JSON.stringify(params);
  const [pageState, setPageState] = useState({ key, page: 1 });
  const page = pageState.key === key ? pageState.page : 1;
  const setPage = (n) => setPageState({ key, page: n });
  const query = useQuery({
    queryKey: ["sale-report", id, params, page, pageSize],
    queryFn: () => fetcher({ ...params, page, limit: pageSize }),
    staleTime: 30_000,
  });
  return { query, page, setPage, pageSize, setPageSize, all: () => fetcher({ ...params, page: 1, limit: 5000 }) };
};

const ReportFrame = ({ toolbar, summary, columns, exportColumns, paged, exportName, empty, label }) => {
  const [exporting, setExporting] = useState(false);
  const { query, page, setPage, pageSize, setPageSize } = paged;
  const rows = query.data?.data || [];
  const runExport = async () => {
    setExporting(true);
    try {
      const all = await paged.all();
      await exportExcel(exportColumns || columns, all.data || [], exportName);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not export the report");
    } finally { setExporting(false); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => query.refetch()} disabled={query.isFetching} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <FaSyncAlt size={10} className={query.isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          <button type="button" onClick={runExport} disabled={exporting || !rows.length} className="inline-flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-2.5 text-xs font-semibold text-white hover:bg-[#0A3127] disabled:opacity-50">
            <FaFileExcel size={11} /> {exporting ? "Preparing…" : "Excel"}
          </button>
        </div>
      </div>
      {summary}
      <Grid columns={columns} rows={rows} loading={query.isLoading} empty={empty} />
      <PaginationBar page={page} pages={query.data?.pages || 1} total={query.data?.total ?? 0} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} loading={query.isFetching} label={label} />
    </div>
  );
};

const AgingBar = ({ totals }) => {
  const total = AGING.reduce((s, a) => s + Number(totals?.[a.key] || 0), 0);
  return (
    <div className="flex-none border-b border-slate-200 bg-white px-3 py-2.5">
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {total > 0 && AGING.map((a) => {
          const v = Number(totals?.[a.key] || 0);
          return v > 0 ? <div key={a.key} className={a.bar} style={{ width: `${(v / total) * 100}%` }} title={`${a.label}: ${fmtKES(v)}`} /> : null;
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {AGING.map((a) => (
          <div key={a.key} className="flex items-center gap-1.5 text-[11px]">
            <span className={`h-2 w-2 rounded-full ${a.bar}`} />
            <span className="text-slate-500">{a.label}</span>
            <span className={`font-bold tabular-nums ${a.text}`}>{n2(totals?.[a.key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ReceivablesView = ({ filters, T }) => {
  const [overdueOnly, setOverdueOnly] = useState(false);
  const params = { projectId: filters.projectId, agentId: filters.agentId, asOf: filters.asOf, overdueOnly: overdueOnly ? "1" : undefined };
  const paged = usePaged("receivables", params, saleApi.getReceivables);
  const columns = [
    { key: "dealNumber", label: T.saleDeal, cls: "font-bold text-slate-900 whitespace-nowrap" },
    { key: "buyerName", label: T.saleBuyer, render: (r) => <div><div className="font-semibold text-slate-800">{r.buyerName}</div><div className="text-[10px] text-slate-400">{r.buyerPhone}</div></div>, xl: (r) => r.buyerName },
    { key: "unit", label: `${T.saleListing} · ${T.saleProject}`, render: (r) => <div><div>{r.unit}</div><div className="text-[10px] text-slate-400">{r.project}</div></div>, xl: (r) => `${r.unit} ${r.project}`.trim() },
    { key: "agentName", label: T.saleAgent },
    { key: "agreedPrice", label: "Agreed", right: true, render: (r) => n2(r.agreedPrice), xl: (r) => r.agreedPrice },
    { key: "paid", label: "Paid", right: true, render: (r) => n2(r.paid), xl: (r) => r.paid },
    { key: "balance", label: "Balance", right: true, cls: "font-bold text-slate-900", render: (r) => n2(r.balance), xl: (r) => r.balance },
    ...AGING.map((a) => ({ key: a.key, label: a.label, right: true, cls: a.text, render: (r) => (r[a.key] ? n2(r[a.key]) : "·"), xl: (r) => r[a.key] })),
    { key: "daysLate", label: "Oldest late", right: true, render: (r) => (r.daysLate ? `${r.daysLate} d` : "—"), xl: (r) => r.daysLate },
  ];
  return (
    <ReportFrame
      paged={paged}
      columns={columns}
      exportName="receivables-aging"
      label="deals"
      empty="Nobody owes anything for this selection."
      summary={<AgingBar totals={paged.query.data?.totals} />}
      toolbar={
        <>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
          </label>
          <span className="text-[11px] text-slate-400">As of {dt(filters.asOf || new Date())} · closed deals with a balance are included, cancelled ones are not</span>
        </>
      }
    />
  );
};

const OverdueView = ({ filters, T }) => {
  const [minDays, setMinDays] = useState(0);
  const params = { projectId: filters.projectId, agentId: filters.agentId, asOf: filters.asOf, minDays: minDays || undefined };
  const paged = usePaged("overdue", params, saleApi.getOverdueInstallments);
  const totals = paged.query.data?.totals;
  const columns = [
    { key: "buyerName", label: T.saleBuyer, render: (r) => <div><div className="font-semibold text-slate-800">{r.buyerName}</div><div className="text-[10px] text-slate-400">{r.buyerPhone}</div></div>, xl: (r) => r.buyerName },
    { key: "buyerPhone", label: "Phone", render: () => null, xl: (r) => r.buyerPhone },
    { key: "dealNumber", label: T.saleDeal, cls: "font-bold text-slate-900 whitespace-nowrap" },
    { key: "unit", label: `${T.saleListing} · ${T.saleProject}`, render: (r) => <div><div>{r.unit}</div><div className="text-[10px] text-slate-400">{r.project}</div></div>, xl: (r) => `${r.unit} ${r.project}`.trim() },
    { key: "installmentNumber", label: "Instalment", render: (r) => `#${r.installmentNumber}${r.description ? ` · ${r.description}` : ""}`, xl: (r) => r.installmentNumber },
    { key: "dueDate", label: "Was due", render: (r) => dt(r.dueDate), xl: (r) => dt(r.dueDate), cls: "whitespace-nowrap" },
    { key: "daysLate", label: "Days late", right: true, render: (r) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${BUCKET_BADGE[r.bucket] || ""}`}>{r.daysLate} d</span>, xl: (r) => r.daysLate },
    { key: "amount", label: "Amount", right: true, cls: "font-bold text-slate-900", render: (r) => n2(r.amount), xl: (r) => r.amount },
    { key: "agentName", label: T.saleAgent },
    {
      key: "follow", label: "Follow up",
      render: (r) => {
        const wa = toWhatsApp(r.buyerPhone);
        const text = `Dear ${r.buyerName}, a friendly reminder that instalment ${r.installmentNumber} of ${fmtKES(r.amount)} for ${r.unit || "your purchase"} was due on ${dt(r.dueDate)}. Kindly settle it at your earliest convenience. Thank you.`;
        return (
          <div className="flex gap-1.5">
            {r.buyerPhone && <a href={`tel:${r.buyerPhone}`} title="Call" className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"><FaPhoneAlt size={10} /></a>}
            {wa && <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" title="WhatsApp reminder" className="rounded border border-emerald-200 p-1.5 text-emerald-600 hover:bg-emerald-50"><FaWhatsapp size={11} /></a>}
          </div>
        );
      },
      xl: () => "",
    },
  ];
  // the phone column is only for the export; the screen shows it under the buyer name
  const screenColumns = columns.filter((c) => c.key !== "buyerPhone");
  const exportColumns = columns.filter((c) => c.key !== "follow");
  return (
    <ReportFrame
      paged={paged}
      columns={screenColumns}
      exportName="overdue-instalments"
      label="instalments"
      empty="No instalment is overdue for this selection."
      summary={
        <div className="flex flex-none flex-wrap items-center gap-x-6 gap-y-1 border-b border-slate-200 bg-white px-3 py-2 text-xs">
          <span><b className="tabular-nums text-red-700">{n2(totals?.amount)}</b> <span className="text-slate-500">overdue across</span> <b>{totals?.count ?? 0}</b> <span className="text-slate-500">instalments</span></span>
          {["d1_30", "d31_60", "d61_90", "d90plus"].map((k) => (
            <span key={k} className="text-slate-500">{AGING.find((a) => a.key === k).label}: <b className="tabular-nums text-slate-800">{n2(totals?.buckets?.[k]?.amount)}</b></span>
          ))}
        </div>
      }
      toolbar={
        <div className="flex items-center gap-1">
          {[[0, "All"], [30, "30+ days"], [60, "60+ days"], [90, "90+ days"]].map(([d, label]) => (
            <button key={d} type="button" onClick={() => setMinDays(d)} className={`h-7 rounded-full border px-3 text-[11px] font-bold ${minDays === d ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{label}</button>
          ))}
        </div>
      }
      exportColumns={exportColumns}
    />
  );
};

const RegisterView = ({ filters, T }) => {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  const params = { projectId: filters.projectId, agentId: filters.agentId, dateFrom: filters.dateFrom, dateTo: filters.dateTo, status: status || undefined, search: debounced || undefined };
  const paged = usePaged("register", params, saleApi.getSalesRegister);
  const totals = paged.query.data?.totals;
  const columns = [
    { key: "dealDate", label: "Date", render: (r) => dt(r.dealDate), xl: (r) => dt(r.dealDate), cls: "whitespace-nowrap" },
    { key: "dealNumber", label: T.saleDeal, cls: "font-bold text-slate-900 whitespace-nowrap" },
    { key: "buyerName", label: T.saleBuyer },
    { key: "unit", label: T.saleListing },
    { key: "project", label: T.saleProject },
    { key: "agentName", label: T.saleAgent },
    { key: "askingPrice", label: "Asking", right: true, render: (r) => (r.askingPrice == null ? "—" : n2(r.askingPrice)), xl: (r) => r.askingPrice },
    { key: "discount", label: "Discount", right: true, render: (r) => (r.discount ? n2(r.discount) : "·"), xl: (r) => r.discount },
    { key: "agreedPrice", label: "Agreed", right: true, cls: "font-bold text-slate-900", render: (r) => n2(r.agreedPrice), xl: (r) => r.agreedPrice },
    { key: "paid", label: "Paid", right: true, render: (r) => n2(r.paid), xl: (r) => r.paid },
    { key: "balance", label: "Balance", right: true, render: (r) => n2(r.balance), xl: (r) => r.balance },
    {
      key: "status", label: "Status",
      render: (r) => <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "cancelled" ? "bg-slate-200 text-slate-600" : r.status === "closed" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}`}>{r.status}</span>,
      xl: (r) => r.status,
    },
    { key: "titleTransferDate", label: "Title transferred", render: (r) => dt(r.titleTransferDate), xl: (r) => (r.titleTransferDate ? dt(r.titleTransferDate) : "") },
  ];
  return (
    <ReportFrame
      paged={paged}
      columns={columns}
      exportName="sales-register"
      label="deals"
      empty="No deals match this selection."
      summary={
        <div className="flex flex-none flex-wrap items-center gap-x-6 gap-y-1 border-b border-slate-200 bg-white px-3 py-2 text-xs">
          <span><b>{totals?.deals ?? 0}</b> <span className="text-slate-500">deals{totals?.cancelled ? ` (${totals.cancelled} cancelled)` : ""}</span></span>
          <span className="text-slate-500">Agreed <b className="tabular-nums text-slate-900">{n2(totals?.agreed)}</b></span>
          <span className="text-slate-500">Paid <b className="tabular-nums text-emerald-700">{n2(totals?.paid)}</b></span>
          <span className="text-slate-500">Balance <b className="tabular-nums text-red-700">{n2(totals?.balance)}</b></span>
        </div>
      }
      toolbar={
        <>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${T.saleDeal.toLowerCase()}, ${T.saleBuyer.toLowerCase()}, ${T.saleListing.toLowerCase()}…`} className={`${inputCls} w-64`} />
          <AppSelect value={status} onChange={(v) => setStatus(v || "")} size="sm" clearable placeholder="All statuses"
            options={[{ value: "active", label: "Active" }, { value: "closed", label: "Closed" }, { value: "cancelled", label: "Cancelled" }]} />
        </>
      }
    />
  );
};

// ── catalogue ──────────────────────────────────────────────────────────────────────────────────────────────────────
const buildGroups = (T) => [
  {
    id: "collections", title: "Money owed", icon: FaCoins, blurb: "Who owes what, and who to call today",
    items: [
      { id: "receivables", label: "Receivables aging", desc: `What ${T.saleBuyer.toLowerCase()}s still owe, aged by how late`, view: ReceivablesView, filters: ["asOf"] },
      { id: "overdue", label: "Overdue instalments", desc: "The follow-up list, oldest first, with call and WhatsApp", view: OverdueView, filters: ["asOf"] },
      { id: "cash-flow", label: "Cash flow forecast", desc: "Instalments due in the next 30, 60 and 90 days", to: "/sale/reports/cash-flow" },
    ],
  },
  {
    id: "sales", title: "Sales & pipeline", icon: FaChartLine, blurb: "What was sold and how it came about",
    items: [
      { id: "register", label: "Sales register", desc: `Every ${T.saleDeal.toLowerCase()} with discount, paid and balance`, view: RegisterView, filters: ["dates"] },
      { id: "monthly", label: "Monthly sales", desc: "Sales and collections per month, with drill-down", to: "/sale/reports/sales" },
      { id: "funnel", label: "Conversion funnel", desc: "Leads to viewings to offers to deals", to: "/sale/reports/funnel" },
    ],
  },
  {
    id: "agents", title: `${T.saleAgent}s & commission`, icon: FaUserTie, blurb: "Who sells, and what they are owed",
    items: [
      { id: "agent-performance", label: `${T.saleAgent} performance`, desc: "Deals, value and conversion per person", to: "/sale/agents/performance" },
      { id: "commissions", label: "Commissions", desc: "Earned, payable and paid, with statements", to: "/sale/commissions" },
    ],
  },
  {
    id: "stock", title: "Projects & stock", icon: FaCity, blurb: "What is left to sell",
    items: [
      { id: "projects", label: `${T.saleProject}s`, desc: "Units sold, reserved and left per project", to: "/sale/projects" },
      { id: "planned-stock", label: "Aging stock", desc: "Units unsold for 30, 60, 90+ days", planned: true },
      { id: "planned-title", label: "Title & transfer tracker", desc: "Fully paid but not yet transferred", planned: true },
      { id: "planned-pl", label: `${T.saleProject} profit & loss`, desc: "Sales against tagged costs", planned: true },
    ],
  },
];

const PulseTile = ({ label, value, sub, tone = "text-slate-900", onClick }) => (
  <button type="button" onClick={onClick} disabled={!onClick} className="min-w-0 border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition enabled:hover:border-[#0B3B2E] disabled:cursor-default">
    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
    <div className={`mt-0.5 truncate text-lg font-black tabular-nums ${tone}`}>{value}</div>
    <div className="truncate text-[10px] text-slate-500">{sub}</div>
  </button>
);

export default function SaleReportsHub() {
  const T = useTerms("saleDeal", "saleBuyer", "saleListing", "saleAgent", "saleProject");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const groups = useMemo(() => buildGroups(T), [T]);
  const items = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g }))), [groups]);
  const active = items.find((i) => i.id === params.get("r") && i.view) || items.find((i) => i.id === "receivables");
  const select = (item) => (item.to ? navigate(item.to) : item.view ? setParams({ r: item.id }, { replace: true }) : null);

  const [filters, setFilters] = useState({ projectId: "", agentId: "", asOf: "", dateFrom: ymd(new Date(new Date().getFullYear(), 0, 1)), dateTo: ymd(new Date()) });
  const setF = (k) => (v) => setFilters((f) => ({ ...f, [k]: v || "" }));

  const [projects, agents, pulse, cash] = [
    useQuery({ queryKey: ["sale-rep-projects"], queryFn: () => saleApi.listProjects({ limit: 200 }), staleTime: 300_000 }),
    useQuery({ queryKey: ["sale-rep-agents"], queryFn: () => saleApi.listAgents({ limit: 200 }), staleTime: 300_000 }),
    useQuery({ queryKey: ["sale-rep-pulse"], queryFn: () => saleApi.getReceivables({ limit: 1 }), staleTime: 60_000 }),
    useQuery({ queryKey: ["sale-rep-cash"], queryFn: () => saleApi.getCashFlowForecast({}), staleTime: 60_000 }),
  ];
  const totals = pulse.data?.totals;
  const overduePct = totals?.balance > 0 ? Math.round((totals.overdue / totals.balance) * 100) : 0;
  const View = active.view;

  return (
    <PropertySaleShell title="Reports" subtitle="Everything owed, sold and left to sell">
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {/* pulse */}
        <div className="grid flex-none grid-cols-2 gap-1.5 lg:grid-cols-4">
          <PulseTile label="Owed by buyers" value={fmtKES(totals?.balance)} sub={`${totals?.deals ?? 0} ${T.saleDeal.toLowerCase()}s with a balance`} onClick={() => setParams({ r: "receivables" }, { replace: true })} />
          <PulseTile label="Overdue now" tone="text-red-700" value={fmtKES(totals?.overdue)} sub={`${overduePct}% of what is owed`} onClick={() => setParams({ r: "overdue" }, { replace: true })} />
          <PulseTile label="Due in 30 days" tone="text-emerald-700" value={fmtKES(cash.data?.next30?.amount)} sub={`${cash.data?.next30?.count ?? 0} instalments`} onClick={() => navigate("/sale/reports/cash-flow")} />
          <PulseTile label="No due date" tone="text-amber-700" value={fmtKES(totals?.unscheduled)} sub="owed but not on any instalment plan" onClick={() => setParams({ r: "receivables" }, { replace: true })} />
        </div>

        <div className="flex min-h-0 flex-1 gap-1.5">
          {/* catalogue */}
          <nav className="hidden w-64 flex-none overflow-y-auto border border-slate-200 bg-white md:block">
            {groups.map((g) => (
              <div key={g.id} className="border-b border-slate-100 py-2">
                <div className="flex items-center gap-2 px-3 pb-1">
                  <g.icon size={12} style={{ color: GREEN }} />
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.1em]" style={{ color: GREEN }}>{g.title}</div>
                    <div className="text-[10px] text-slate-400">{g.blurb}</div>
                  </div>
                </div>
                {g.items.map((item) => {
                  const on = active.id === item.id;
                  return (
                    <button key={item.id} type="button" disabled={item.planned} onClick={() => select(item)}
                      className={`flex w-full items-start gap-2 border-l-[3px] px-3 py-1.5 text-left transition ${on ? "border-[#0B3B2E] bg-emerald-50" : "border-transparent hover:bg-slate-50"} ${item.planned ? "cursor-default opacity-60" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className={`text-xs ${on ? "font-black text-[#0B3B2E]" : "font-semibold text-slate-800"}`}>{item.label}</div>
                        <div className="text-[10px] leading-snug text-slate-500">{item.desc}</div>
                      </div>
                      {item.to && <FaArrowRight size={9} className="mt-1 flex-none text-slate-300" />}
                      {item.planned && <span className="mt-0.5 flex-none rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500"><FaRegClock className="mr-0.5 inline" size={8} />Soon</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* workspace */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden border border-slate-200 bg-white">
            <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <div className="mr-2">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{active.group.title}</div>
                <h2 className="text-sm font-black text-slate-900">{active.label}</h2>
              </div>
              <div className="md:hidden">
                <AppSelect value={active.id} onChange={(v) => { const it = items.find((i) => i.id === v); if (it) select(it); }} size="sm"
                  options={items.filter((i) => !i.planned).map((i) => ({ value: i.id, label: i.label }))} />
              </div>
              <AppSelect value={filters.projectId} onChange={setF("projectId")} size="sm" searchable clearable placeholder={`All ${T.saleProject.toLowerCase()}s`}
                options={(projects.data?.data || []).map((p) => ({ value: p._id, label: [p.projectNumber, p.name].filter(Boolean).join(" · ") }))} />
              <AppSelect value={filters.agentId} onChange={setF("agentId")} size="sm" searchable clearable placeholder={`All ${T.saleAgent.toLowerCase()}s`}
                options={(agents.data?.data || []).map((a) => ({ value: a._id, label: a.fullName }))} />
              {active.filters?.includes("asOf") && (
                <label className="flex items-center gap-1.5 text-xs text-slate-500">As of <input type="date" value={filters.asOf} max={ymd(new Date())} onChange={(e) => setF("asOf")(e.target.value)} className={inputCls} /></label>
              )}
              {active.filters?.includes("dates") && (
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <input type="date" value={filters.dateFrom} max={filters.dateTo} onChange={(e) => setF("dateFrom")(e.target.value)} className={inputCls} /> to
                  <input type="date" value={filters.dateTo} min={filters.dateFrom} onChange={(e) => setF("dateTo")(e.target.value)} className={inputCls} />
                </span>
              )}
            </div>
            <View key={active.id} filters={filters} T={T} />
          </section>
        </div>
      </div>
    </PropertySaleShell>
  );
}
