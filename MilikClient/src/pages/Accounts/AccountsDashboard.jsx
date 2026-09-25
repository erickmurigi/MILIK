import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts";
import {
  FaArchive, FaArrowDown, FaArrowUp, FaBalanceScale, FaBook, FaCalendarAlt, FaChartLine, FaChartPie,
  FaCoins, FaCreditCard, FaExclamationTriangle, FaFileContract, FaFileInvoice, FaFileInvoiceDollar, FaHourglassHalf,
  FaLayerGroup, FaPlus, FaRedoAlt, FaReceipt, FaShieldAlt, FaTruck, FaUniversity, FaUsers,
} from "react-icons/fa";
import { selectCurrentCompany } from "../../redux/selectors";
import ModuleShell from "../../components/Layout/ModuleShell";
import DashboardCard, {
  DashboardStatCard, DashboardLinkButton, DashboardQuickAccess, DashboardSummaryRows,
} from "../../components/Dashboard/DashboardCard";
import { formatMoney } from "../../utils/money";
import {
  getJournalEntries, getChartOfAccounts, getIncomeMonthlySummary, getCashMonthlySummary, getAccountingPeriods, getPaymentVouchers,
} from "../../redux/apiCalls";

const GRN  = "#0B3B2E";
const ORG  = "#FF8C00";
const ROSE = "#E11D48";

// ─── Where everything lives ───────────────────────────────────────────────────
const QUICK_GROUPS = [
  {
    title: "General Ledger",
    links: [
      { label: "Chart of Accounts",   to: "/accounts/chart-of-accounts",  Icon: FaLayerGroup },
      { label: "Journal Entries",     to: "/accounts/journals",           Icon: FaBook },
      { label: "Bank Reconciliation", to: "/accounts/bank-reconciliation", Icon: FaUniversity },
    ],
  },
  {
    title: "Payables & Expenses",
    links: [
      { label: "Creditors Ledger",     to: "/accounts/creditor-ledger",   Icon: FaFileContract },
      { label: "Payment Vouchers",     to: "/accounts/payment-vouchers",  Icon: FaCreditCard },
      { label: "Petty Cash",           to: "/accounts/petty-cash",        Icon: FaCoins },
      { label: "Expense Requisitions", to: "/accounts/expenses",          Icon: FaFileInvoice },
      { label: "Service Providers",    to: "/accounts/service-providers", Icon: FaUsers },
    ],
  },
  {
    title: "Period Management",
    links: [
      { label: "Accounting Periods", to: "/accounts/accounting-periods", Icon: FaCalendarAlt },
      { label: "Year-End Close",     to: "/accounts/year-end-close",     Icon: FaArchive },
      { label: "GL Integrity",       to: "/accounts/gl-integrity",       Icon: FaShieldAlt },
      { label: "Financial Ratios",   to: "/accounts/financial-ratios",   Icon: FaChartPie },
    ],
  },
  {
    title: "Reports & Assets",
    links: [
      { label: "Trial Balance",    to: "/accounts/trial-balance",           Icon: FaBalanceScale },
      { label: "Income Statement", to: "/accounts/income-statement",        Icon: FaChartLine },
      { label: "Balance Sheet",    to: "/accounts/balance-sheet",           Icon: FaFileInvoiceDollar },
      { label: "Cash Flow",        to: "/accounts/cash-flow",               Icon: FaReceipt },
      { label: "Tax Reports",      to: "/accounts/tax-reports",             Icon: FaFileInvoice },
      { label: "Budget Plans",     to: "/accounts/budget",                  Icon: FaChartPie },
      { label: "Budget vs Actual", to: "/accounts/budget/analysis",         Icon: FaChartLine },
      { label: "Fixed Assets",     to: "/accounts/fixed-assets",            Icon: FaTruck },
      { label: "Depreciation",     to: "/accounts/fixed-assets/depreciation", Icon: FaArrowDown },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const shortKES = (v) => {
  const n = Math.abs(Number(v || 0));
  const sign = Number(v) < 0 ? "-" : "";
  if (n >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${sign}${(n / 1_000).toFixed(0)}K`;
  return `${sign}${n.toFixed(0)}`;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const lastOf = (rows) => (Array.isArray(rows) && rows.length ? rows[rows.length - 1] : {});

const statusBadge = (status) => ({
  draft:    "border-slate-200 bg-slate-50 text-slate-600",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  paid:     "border-emerald-200 bg-emerald-50 text-emerald-700",
  posted:   "border-emerald-200 bg-emerald-50 text-emerald-700",
  reversed: "border-amber-200 bg-amber-50 text-amber-700",
}[status] || "border-slate-200 bg-slate-50 text-slate-500");

const payeeOf = (v) =>
  v?.serviceProvider?.name || v?.payeeName || v?.landlord?.landlordName || v?.landlord?.name || v?.narration || "—";

// ─── Chart tooltips ───────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-[10px]">
          <div className="h-2 w-2 shrink-0" style={{ backgroundColor: p.fill || p.color }} />
          <span className="text-slate-500">{p.name}:</span>
          <span className="font-bold text-slate-900">{formatMoney(p.value, 0)}</span>
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
        <span className="font-bold" style={{ color: val >= 0 ? GRN : ROSE }}>{formatMoney(Math.abs(val), 0)}</span>
      </div>
    </div>
  );
};

const TH = "px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white";

// ─── Page ─────────────────────────────────────────────────────────────────────
const AccountsDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const biz = useSelector(selectCurrentCompany)?._id || "";

  const { data: stats, isFetching: statsLoading } = useQuery({
    queryKey: ["acc-dashboard-stats", biz],
    enabled: Boolean(biz),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
      const endDate = now.toISOString().split("T")[0];
      const journals = (status) => getJournalEntries({ business: biz, company: biz, status, startDate, endDate, limit: 1 });
      const vouchers = (status) => getPaymentVouchers({ business: biz, company: biz, status, limit: 1 }).catch(() => ({ total: 0 }));
      const [coa, draftJournals, postedJournals, periods, draftVouchers, approvedVouchers] = await Promise.all([
        getChartOfAccounts({ business: biz }),
        journals("draft"),
        journals("posted"),
        getAccountingPeriods({ business: biz }).catch(() => []),
        vouchers("draft"),
        vouchers("approved"),
      ]);
      const today = new Date();
      return {
        accounts: Array.isArray(coa) ? coa.filter((a) => a?.isActive !== false).length : 0,
        draftJournals: draftJournals.total ?? 0,
        postedJournals: postedJournals.total ?? 0,
        draftVouchers: draftVouchers.total ?? 0,
        approvedVouchers: approvedVouchers.total ?? 0,
        period: Array.isArray(periods) ? periods.find((p) => new Date(p.startDate) <= today && new Date(p.endDate) >= today) || null : null,
      };
    },
  });

  const { data: charts, isFetching: chartsLoading } = useQuery({
    queryKey: ["acc-dashboard-charts", biz],
    enabled: Boolean(biz),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const [cash, income] = await Promise.all([
        getCashMonthlySummary({ business: biz, months: 6 }).then((d) => d?.data ?? []).catch(() => []),
        getIncomeMonthlySummary({ business: biz, months: 6 }).catch(() => []),
      ]);
      return { cash, income: Array.isArray(income) ? income : [] };
    },
  });

  const { data: recent, isFetching: recentLoading } = useQuery({
    queryKey: ["acc-dashboard-recent", biz],
    enabled: Boolean(biz),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const [vouchers, journals] = await Promise.all([
        getPaymentVouchers({ business: biz, company: biz, limit: 6 }).catch(() => ({ data: [] })),
        getJournalEntries({ business: biz, company: biz, limit: 6 }).catch(() => ({ data: [] })),
      ]);
      return { vouchers: vouchers.data ?? [], journals: journals.data ?? [] };
    },
  });

  const s = stats || {};
  const cashData = charts?.cash ?? [];
  const netData = charts?.income ?? [];
  const thisMonthCash = lastOf(cashData);
  const thisMonthNet = Number(lastOf(netData).net || 0);
  const pendingVouchers = (s.draftVouchers ?? 0) + (s.approvedVouchers ?? 0);
  const loading = statsLoading && !stats;
  const period = s.period;

  const refresh = () => ["acc-dashboard-stats", "acc-dashboard-charts", "acc-dashboard-recent"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const periodTone = useMemo(() => {
    if (!period) return "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100";
    return period.status === "open"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      : period.status === "closed"
        ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100";
  }, [period]);

  return (
    <ModuleShell
      moduleLabel="MILIK Accounting"
      title="Dashboard"
      action={
        <>
          <button
            type="button"
            onClick={() => navigate("/accounts/accounting-periods")}
            className={`inline-flex h-7 items-center gap-1.5 border px-2.5 text-[10px] font-bold transition ${periodTone}`}
          >
            <FaCalendarAlt size={9} />
            {loading ? "…" : period ? `${period.name} · ${String(period.status).toUpperCase()}` : "No active period"}
          </button>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} className={statsLoading || chartsLoading || recentLoading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => navigate("/accounts/journals")}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaPlus size={9} /> Journal
          </button>
          <button
            type="button"
            onClick={() => navigate("/accounts/payment-vouchers/new")}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
          >
            <FaPlus size={9} /> Voucher
          </button>
        </>
      }
    >
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">

        {/* ── Needs attention ─────────────────────────────────────────────── */}
        {!loading && !period && (
          <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3">
            <FaExclamationTriangle className="mt-0.5 flex-shrink-0 text-amber-600" size={14} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black text-amber-800">No accounting period covers today</div>
              <div className="mt-0.5 text-[11px] text-amber-700">Postings dated today are not held to a fiscal period until one is set up.</div>
            </div>
            <button type="button" onClick={() => navigate("/accounts/accounting-periods")} className="flex-shrink-0 border border-amber-300 bg-white px-3 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-50">
              Manage Periods
            </button>
          </div>
        )}

        {/* ── KPI stat cards ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
          <DashboardStatCard label="Cash In · this month"  value={chartsLoading && !charts ? "…" : formatMoney(thisMonthCash.cashIn, 0)}  icon={FaArrowDown} tone="green"  sub="Cashbook receipts" />
          <DashboardStatCard label="Cash Out · this month" value={chartsLoading && !charts ? "…" : formatMoney(thisMonthCash.cashOut, 0)} icon={FaArrowUp}   tone="orange" sub="Cashbook payments" />
          <DashboardStatCard label={thisMonthNet >= 0 ? "Net Profit · this month" : "Net Loss · this month"} value={chartsLoading && !charts ? "…" : formatMoney(Math.abs(thisMonthNet), 0)} icon={FaChartLine} tone={thisMonthNet >= 0 ? "green" : "red"} sub="Income less expenses" />
          <DashboardStatCard label="Vouchers Pending" value={loading ? "…" : pendingVouchers} icon={FaCreditCard} tone="orange" sub={loading ? "" : `${s.draftVouchers ?? 0} draft · ${s.approvedVouchers ?? 0} approved`} onClick={() => navigate("/accounts/payment-vouchers")} />
          <DashboardStatCard label="Draft Journals" value={loading ? "…" : (s.draftJournals ?? 0)} icon={FaHourglassHalf} tone="green" sub={loading ? "" : `${s.postedJournals ?? 0} posted this month`} onClick={() => navigate("/accounts/journals")} />
        </div>

        {/* ── Main two-column area ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 items-start gap-1.5 xl:grid-cols-[1fr_280px]">

          {/* Left */}
          <div className="flex flex-col gap-1.5">

            <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
              <DashboardCard title="Cash In / Cash Out" right={<span className="text-[10px] font-bold text-slate-400">last 6 months</span>}>
                <div className="px-2 py-3">
                  <ResponsiveContainer width="100%" height={210}>
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
                </div>
              </DashboardCard>

              <DashboardCard title="Net Profit / Loss" right={<span className="text-[10px] font-bold text-slate-400">last 6 months</span>}>
                <div className="px-2 py-3">
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={netData} barCategoryGap="40%">
                      <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={shortKES} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={38} />
                      <Tooltip content={<NetTooltip />} cursor={{ fill: "#f8fafc" }} />
                      <Bar dataKey="net" name="Net" radius={0}>
                        {netData.map((entry) => <Cell key={entry.month} fill={entry.net >= 0 ? GRN : ROSE} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashboardCard>
            </div>

            <DashboardCard title="Recent Payment Vouchers" right={<DashboardLinkButton onClick={() => navigate("/accounts/payment-vouchers")} />}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E]">
                      <th className={`${TH} text-left`}>Voucher No.</th>
                      <th className={`${TH} text-left`}>Payee</th>
                      <th className={`${TH} text-left`}>Due</th>
                      <th className={`${TH} text-left`}>Status</th>
                      <th className={`${TH} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recent?.vouchers ?? []).length ? recent.vouchers.map((v) => (
                      <tr key={v._id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate("/accounts/payment-vouchers")}>
                        <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{v.voucherNo}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 font-semibold text-slate-800">{payeeOf(v)}</td>
                        <td className="px-3 py-2 text-slate-500">{fmtDate(v.dueDate)}</td>
                        <td className="px-3 py-2"><span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${statusBadge(v.status)}`}>{v.status}</span></td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(v.amount, 0)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-xs font-semibold text-slate-400">{recentLoading && !recent ? "Loading…" : "No payment vouchers yet."}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </DashboardCard>

            <DashboardCard title="Recent Journal Entries" right={<DashboardLinkButton onClick={() => navigate("/accounts/journals")} />}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead>
                    <tr className="bg-slate-800">
                      <th className={`${TH} text-left`}>Journal No.</th>
                      <th className={`${TH} text-left`}>Date</th>
                      <th className={`${TH} text-left`}>Narration</th>
                      <th className={`${TH} text-left`}>Status</th>
                      <th className={`${TH} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recent?.journals ?? []).length ? recent.journals.map((j) => (
                      <tr key={j._id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate("/accounts/journals")}>
                        <td className="px-3 py-2 font-mono font-bold text-slate-600">{j.journalNo}</td>
                        <td className="px-3 py-2 text-slate-500">{fmtDate(j.date)}</td>
                        <td className="max-w-[260px] truncate px-3 py-2 font-semibold text-slate-800">{j.narration || j.reference || "—"}</td>
                        <td className="px-3 py-2"><span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${statusBadge(j.status)}`}>{j.status}</span></td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">{formatMoney(j.amount, 0)}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5} className="px-3 py-8 text-center text-xs font-semibold text-slate-400">{recentLoading && !recent ? "Loading…" : "No journal entries yet."}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </DashboardCard>
          </div>

          {/* Right */}
          <div className="flex flex-col gap-1.5">
            <DashboardCard title="Ledger Summary">
              <DashboardSummaryRows
                loading={loading}
                rows={[
                  { label: "GL Accounts", note: "active in the chart", value: s.accounts ?? 0 },
                  { label: "Draft Journals", note: "this month", value: s.draftJournals ?? 0, tone: (s.draftJournals ?? 0) > 0 ? "warn" : undefined },
                  { label: "Posted Journals", note: "this month", value: s.postedJournals ?? 0, tone: "good" },
                  { label: "Vouchers Awaiting Payment", note: "draft + approved", value: pendingVouchers, tone: pendingVouchers > 0 ? "warn" : undefined },
                ]}
              />
            </DashboardCard>

            {QUICK_GROUPS.map(({ title, links }) => (
              <DashboardCard key={title} title={title}>
                <DashboardQuickAccess links={links} onNavigate={navigate} />
              </DashboardCard>
            ))}
          </div>
        </div>
      </div>
    </ModuleShell>
  );
};

export default AccountsDashboard;
