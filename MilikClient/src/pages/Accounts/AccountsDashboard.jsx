import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentCompany } from "../../redux/selectors";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts";
import {
  FaBook, FaCreditCard, FaLayerGroup,
  FaFileInvoice, FaCog, FaUniversity, FaCoins, FaFileContract,
  FaPlusCircle, FaSpinner, FaExclamationTriangle, FaCheckCircle, FaCircle,
  FaCalendarAlt, FaArchive, FaShieldAlt, FaChartPie,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getJournalEntries, getChartOfAccounts, getIncomeMonthlySummary, getCashMonthlySummary, getAccountingPeriods } from "../../redux/apiCalls";

// ─── Constants ────────────────────────────────────────────────────────────────
const GRN  = "#0B3B2E";
const ORG  = "#FF8C00";
const ROSE = "#E11D48";

const SECTIONS = [
  {
    id: "gl", label: "General Ledger", accent: GRN,
    items: [
      { label: "Chart of Accounts",   icon: FaLayerGroup, route: "/accounts/chart-of-accounts",  desc: "Account structure & GL hierarchy" },
      { label: "Journal Entries",     icon: FaBook,       route: "/accounts/journals",            desc: "Manual & auto-generated postings" },
      { label: "Bank Reconciliation", icon: FaUniversity, route: "/accounts/bank-reconciliation", desc: "Match books against bank statements" },
    ],
  },
  {
    id: "payables", label: "Payables & Expenses", accent: "#92400E",
    items: [
      { label: "Creditors Ledger",     icon: FaFileContract, route: "/accounts/creditor-ledger",    desc: "Per-vendor invoices & balances" },
      { label: "Payment Vouchers",     icon: FaCreditCard,   route: "/accounts/payment-vouchers",   desc: "Outgoing payment documentation" },
      { label: "Petty Cash",           icon: FaCoins,        route: "/accounts/petty-cash",         desc: "Cash disbursements & float" },
      { label: "Expense Requisitions", icon: FaFileInvoice,  route: "/accounts/expenses",           desc: "Requests & approvals" },
      { label: "Service Providers",    icon: FaCog,          route: "/accounts/service-providers",  desc: "Vendor & supplier register" },
    ],
  },
  {
    id: "period", label: "Period Management", accent: "#6D28D9",
    items: [
      { label: "Accounting Periods", icon: FaCalendarAlt, route: "/accounts/accounting-periods", desc: "Open, close & lock fiscal periods" },
      { label: "Year-End Close",     icon: FaArchive,     route: "/accounts/year-end-close",     desc: "Close P&L to retained earnings" },
      { label: "GL Integrity",       icon: FaShieldAlt,   route: "/accounts/gl-integrity",       desc: "Detect unbalanced & orphaned entries" },
      { label: "Financial Ratios",   icon: FaChartPie,    route: "/accounts/financial-ratios",   desc: "Current ratio, ROA, margins & more" },
    ],
  },
];

const QUICK_ACTIONS = [
  { label: "New Journal Entry", route: "/accounts/journals",            icon: FaBook },
  { label: "Payment Voucher",   route: "/accounts/payment-vouchers",    icon: FaCreditCard },
  { label: "Expense Request",   route: "/accounts/expenses",            icon: FaFileInvoice },
  { label: "Petty Cash Entry",  route: "/accounts/petty-cash",          icon: FaCoins },
  { label: "Manage Periods",    route: "/accounts/accounting-periods",  icon: FaCalendarAlt },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtMonth  = () => new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
const shortKES  = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
};
const fullKES = (v) => `KES ${Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 0 })}`;


// ─── Custom tooltip ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-[10px]">
          <div className="h-2 w-2 shrink-0" style={{ backgroundColor: p.fill || p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-bold text-slate-900">{fullKES(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

const NetTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value ?? 0;
  return (
    <div className="border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">{label}</div>
      <div className="flex items-center gap-2 text-[10px]">
        <div className="h-2 w-2 shrink-0" style={{ backgroundColor: val >= 0 ? GRN : ROSE }} />
        <span className="text-slate-500">{val >= 0 ? "Net Profit" : "Net Loss"}:</span>
        <span className="font-bold" style={{ color: val >= 0 ? GRN : ROSE }}>{fullKES(Math.abs(val))}</span>
      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────
const SidebarStatRow = ({ label, value, loading, alert }) => (
  <div className={`flex items-center justify-between px-2 py-1.5 ${alert && value > 0 ? "bg-amber-500/20" : "bg-white/5"}`}>
    <div className="flex items-center gap-2">
      {alert && value > 0
        ? <FaExclamationTriangle size={8} className="shrink-0 text-amber-400" />
        : <FaCheckCircle size={8} className="shrink-0 text-emerald-400/60" />}
      <span className="text-[10px] font-semibold text-white/55">{label}</span>
    </div>
    <span className={`text-[11px] font-black ${alert && value > 0 ? "text-amber-300" : "text-white"}`}>
      {loading ? <FaSpinner size={9} className="animate-spin text-white/30" /> : (value ?? "—")}
    </span>
  </div>
);

const ModuleTile = ({ label, icon: Icon, route, desc, accent, navigate }) => (
  <button
    onClick={() => navigate(route)}
    className="group flex flex-col bg-white transition-all hover:shadow-md"
    style={{ borderTop: `3px solid ${accent}` }}
  >
    <div className="flex flex-1 flex-col gap-2 border border-t-0 border-slate-200 px-3 py-3 group-hover:border-slate-300 group-hover:bg-slate-50/60">
      <span style={{ color: accent }}><Icon size={13} /></span>
      <div>
        <div className="text-[11px] font-extrabold leading-tight text-slate-800">{label}</div>
        <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{desc}</div>
      </div>
    </div>
  </button>
);

const SectionBlock = ({ section, navigate }) => {
  const n = section.items.length;
  const cols = n <= 3 ? "grid-cols-3" : n === 4 ? "grid-cols-4" : "grid-cols-5";
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <FaCircle size={5} style={{ color: section.accent }} className="shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: section.accent }}>{section.label}</span>
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[9px] font-semibold text-slate-400">{section.items.length}</span>
      </div>
      <div className={`grid gap-2 ${cols}`}>
        {section.items.map((item) => (
          <ModuleTile key={item.route} {...item} accent={section.accent} navigate={navigate} />
        ))}
      </div>
    </div>
  );
};

const ChartCard = ({ title, subtitle, children, loading }) => (
  <div className="flex flex-col border border-slate-200 bg-white">
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5" style={{ borderLeftWidth: "3px", borderLeftColor: GRN }}>
      <div>
        <div className="text-[11px] font-extrabold text-slate-800">{title}</div>
        <div className="text-[10px] text-slate-400">{subtitle}</div>
      </div>
      {loading && <FaSpinner size={11} className="animate-spin text-slate-300" />}
    </div>
    <div className="flex-1 px-2 py-3">
      {children}
    </div>
  </div>
);

// ─── Main ─────────────────────────────────────────────────────────────────────
const AccountsDashboard = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);

  const [stats, setStats]               = useState({ accounts: null, draftJournals: null, postedJournals: null });
  const [statsLoading, setStatsLoading] = useState(true);
  const [cashData, setCashData]         = useState([]);
  const [monthlyData, setMonthlyData]   = useState([]);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const fetchedRef = useRef(false);

  const businessId = useMemo(() => currentCompany?._id || "", [currentCompany?._id]);
  const companyName = String(currentCompany?.companyName || currentCompany?.name || "").trim();

  useEffect(() => {
    if (!businessId || fetchedRef.current) return;
    fetchedRef.current = true;

    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const endDate   = now.toISOString().split("T")[0];

    // KPI stats + current period — all in parallel
    Promise.all([
      getChartOfAccounts({ business: businessId }),
      getJournalEntries({ business: businessId, company: businessId, status: "draft",  startDate, endDate }),
      getJournalEntries({ business: businessId, company: businessId, status: "posted", startDate, endDate }),
      getAccountingPeriods({ business: businessId }).catch(() => []),
    ])
      .then(([coa, dr, po, periods]) => {
        setStats({
          accounts:      Array.isArray(coa) ? coa.length : 0,
          draftJournals: dr.total ?? dr.data?.length  ?? 0,
          postedJournals:po.total ?? po.data?.length  ?? 0,
        });
        // Find the period that contains today
        const today = new Date();
        const active = Array.isArray(periods)
          ? periods.find((p) => new Date(p.startDate) <= today && new Date(p.endDate) >= today)
          : null;
        setCurrentPeriod(active || null);
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false));

    // Chart data — cash summary + income monthly totals, both as single batch calls
    Promise.all([
      getCashMonthlySummary({ business: businessId, months: 6 })
        .then((d) => d?.data ?? [])
        .catch(() => []),
      getIncomeMonthlySummary({ business: businessId, months: 6 })
        .catch(() => []),
    ])
      .then(([cash, income]) => { setCashData(cash); setMonthlyData(Array.isArray(income) ? income : []); })
      .finally(() => setChartsLoading(false));
  }, [businessId]);

  return (
    <DashboardLayout>
      <div className="flex h-full overflow-hidden bg-slate-100">

        {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
        <aside className="flex w-[200px] shrink-0 flex-col overflow-y-auto bg-[#0B3B2E]">
          {/* Identity */}
          <div className="border-b border-white/10 px-4 pt-5 pb-4">
            <div className="mb-3 flex h-9 w-9 items-center justify-center bg-white/10">
              <FaBook className="text-white/50" size={13} />
            </div>
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#7FB89A]">Financial Accounts</div>
            <div className="mt-0.5 text-[13px] font-black leading-snug text-white">{companyName || "Accounting"}</div>
            <div className="mt-2 inline-block border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-bold text-white/55">
              {fmtMonth()}
            </div>
          </div>

          {/* Status */}
          <div className="border-b border-white/10 px-3 py-3">
            <div className="mb-2 px-2 text-[9px] font-black uppercase tracking-[0.15em] text-white/25">Status</div>
            <div className="space-y-1">
              <SidebarStatRow label="GL Accounts"    value={stats.accounts}       loading={statsLoading} />
              <SidebarStatRow label="Draft Journals" value={stats.draftJournals}  loading={statsLoading} alert />
              <SidebarStatRow label="Posted (Month)" value={stats.postedJournals} loading={statsLoading} />
            </div>
          </div>

          {/* Quick actions */}
          <div className="border-b border-white/10 px-3 py-3">
            <div className="mb-2 px-2 text-[9px] font-black uppercase tracking-[0.15em] text-white/25">Quick Actions</div>
            <div className="space-y-0.5">
              {QUICK_ACTIONS.map(({ label, route, icon: Icon }) => (
                <button key={route} onClick={() => navigate(route)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] font-semibold text-white/55 transition hover:bg-white/10 hover:text-white">
                  <Icon size={9} className="shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* More modules */}
          <div className="flex-1 px-3 py-3">
            <div className="mb-2 px-2 text-[9px] font-black uppercase tracking-[0.15em] text-white/25">More Modules</div>
            <div className="space-y-0.5">
              {[
                { label: "Fixed Assets",       route: "/accounts/fixed-assets" },
                { label: "Depreciation",       route: "/accounts/fixed-assets/depreciation" },
                { label: "Budget Plans",       route: "/accounts/budget" },
                { label: "Budget vs Actual",   route: "/accounts/budget/analysis" },
                { label: "Trial Balance",      route: "/accounts/trial-balance" },
                { label: "Income Statement",   route: "/accounts/income-statement" },
                { label: "Balance Sheet",      route: "/accounts/balance-sheet" },
                { label: "Cash Flow",          route: "/accounts/cash-flow" },
                { label: "Financial Ratios",   route: "/accounts/financial-ratios" },
                { label: "Tax Reports",        route: "/accounts/tax-reports" },
                { label: "GL Integrity",       route: "/accounts/gl-integrity" },
                { label: "Year-End Close",     route: "/accounts/year-end-close" },
              ].map(({ label, route }) => (
                <button key={route} onClick={() => navigate(route)}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-[10px] text-white/40 transition hover:bg-white/10 hover:text-white/75">
                  <span className="h-1 w-1 shrink-0 bg-white/20" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── MAIN ────────────────────────────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Top bar */}
          <div className="shrink-0 flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-2.5">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-[#0B3B2E]">
              Accounting Dashboard
            </span>

            {/* Active period pill */}
            {!statsLoading && (
              currentPeriod ? (
                <button
                  onClick={() => navigate("/accounts/accounting-periods")}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold transition
                    ${currentPeriod.status === "open"
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : currentPeriod.status === "closed"
                        ? "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                        : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}
                >
                  <FaCalendarAlt size={8} />
                  {currentPeriod.name} · {currentPeriod.status.toUpperCase()}
                </button>
              ) : (
                <button
                  onClick={() => navigate("/accounts/accounting-periods")}
                  className="inline-flex items-center gap-1.5 border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-bold text-slate-400 hover:bg-slate-100 transition"
                >
                  <FaCalendarAlt size={8} /> No active period
                </button>
              )
            )}

            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => navigate("/accounts/journals")}
                className="inline-flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-600 transition hover:bg-slate-50">
                <FaPlusCircle size={9} /> Journal
              </button>
              <button onClick={() => navigate("/accounts/payment-vouchers")}
                className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-[#E67E00]">
                <FaPlusCircle size={9} /> Voucher
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {/* Module sections */}
            {SECTIONS.map((section) => (
              <SectionBlock key={section.id} section={section} navigate={navigate} />
            ))}

            {/* Charts */}
            <div className="grid grid-cols-2 gap-4">

              {/* Chart 1: Cash In / Cash Out */}
              <ChartCard
                title="Cash In / Cash Out"
                subtitle="Cashbook movements — last 6 months"
                loading={chartsLoading}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={cashData} barCategoryGap="30%" barGap={3}>
                    <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={shortKES} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={38} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f8fafc" }} />
                    <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: "9px", paddingTop: "8px" }} />
                    <Bar dataKey="cashIn"  name="Cash In"  fill={GRN} radius={0} />
                    <Bar dataKey="cashOut" name="Cash Out" fill={ORG} radius={0} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Chart 2: Net Profit / Loss */}
              <ChartCard
                title="Net Profit / Loss"
                subtitle="Monthly bottom line — last 6 months"
                loading={chartsLoading}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyData} barCategoryGap="40%">
                    <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => (v >= 0 ? shortKES(v) : `-${shortKES(Math.abs(v))}`)} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={38} />
                    <Tooltip content={<NetTooltip />} cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="net" name="Net" radius={0}>
                      {monthlyData.map((entry, i) => (
                        <Cell key={i} fill={entry.net >= 0 ? GRN : ROSE} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AccountsDashboard;
