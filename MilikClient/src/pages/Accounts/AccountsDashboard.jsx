import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import {
  FaArrowDown, FaArrowUp, FaBalanceScale, FaBook, FaCalendarAlt, FaChartLine, FaChartPie, FaCheckCircle,
  FaCoins, FaCreditCard, FaFileInvoice, FaFileInvoiceDollar, FaLayerGroup, FaReceipt, FaShieldAlt,
  FaSyncAlt, FaTruck, FaUniversity, FaUsers, FaWallet,
} from "react-icons/fa";
import { selectCurrentCompany } from "../../redux/selectors";
import ModuleShell from "../../components/Layout/ModuleShell";
import DashboardCard, { DashboardStatCard, DashboardLinkButton, DashboardQuickAccess } from "../../components/Dashboard/DashboardCard";
import { formatMoney } from "../../utils/money";
import { getAccountsDashboard } from "../../redux/apiCalls";

const GRN = "#0B3B2E";
const ORG = "#FF8C00";
const ROSE = "#E11D48";

const QUICK_GROUPS = [
  {
    title: "General Ledger",
    links: [
      { label: "Chart of Accounts", to: "/accounts/chart-of-accounts", Icon: FaLayerGroup },
      { label: "Journal Entries", to: "/accounts/journals", Icon: FaBook },
      { label: "Bank Reconciliation", to: "/accounts/bank-reconciliation", Icon: FaUniversity },
      { label: "GL Integrity", to: "/accounts/gl-integrity", Icon: FaShieldAlt },
    ],
  },
  {
    title: "Payables & Expenses",
    links: [
      { label: "Payment Vouchers", to: "/accounts/payment-vouchers", Icon: FaCreditCard },
      { label: "Petty Cash Ledger", to: "/accounts/petty-cash", Icon: FaCoins },
      { label: "Petty Cash Accounts", to: "/accounts/petty-cash/accounts", Icon: FaWallet },
      { label: "Expense Requisitions", to: "/accounts/expenses", Icon: FaFileInvoice },
      { label: "Service Providers", to: "/accounts/service-providers", Icon: FaUsers },
      { label: "Accounting Periods", to: "/accounts/accounting-periods", Icon: FaCalendarAlt },
    ],
  },
  {
    title: "Reports & Assets",
    links: [
      { label: "Trial Balance", to: "/accounts/trial-balance", Icon: FaBalanceScale },
      { label: "Income Statement", to: "/accounts/income-statement", Icon: FaChartLine },
      { label: "Balance Sheet", to: "/accounts/balance-sheet", Icon: FaFileInvoiceDollar },
      { label: "Cash Flow", to: "/accounts/cash-flow", Icon: FaReceipt },
      { label: "Tax Reports", to: "/accounts/tax-reports", Icon: FaFileInvoice },
      { label: "Financial Ratios", to: "/accounts/financial-ratios", Icon: FaChartPie },
      { label: "Budget Plans", to: "/accounts/budget", Icon: FaChartPie },
      { label: "Budget vs Actual", to: "/accounts/budget/analysis", Icon: FaChartLine },
      { label: "Fixed Assets", to: "/accounts/fixed-assets", Icon: FaTruck },
      { label: "Depreciation", to: "/accounts/fixed-assets/depreciation", Icon: FaArrowDown },
    ],
  },
];

const shortKES = (v) => {
  const n = Math.abs(Number(v || 0));
  const sign = Number(v) < 0 ? "-" : "";
  if (n >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${sign}${(n / 1_000).toFixed(0)}K`;
  return `${sign}${n.toFixed(0)}`;
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const money = (v) => formatMoney(v, 0);
const signedMoney = (v) => (Number(v) < 0 ? `-${money(Math.abs(v))}` : money(v));
const activityUrl = (accountId) => `/accounts/chart-of-accounts/${accountId}/activity`;

const STATUS_BADGE = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  posted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  reversed: "border-amber-200 bg-amber-50 text-amber-700",
};
const Badge = ({ status }) => (
  <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_BADGE[status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>{status}</span>
);

const TooltipBox = ({ label, rows }) => (
  <div className="border border-slate-200 bg-white px-3 py-2 shadow-lg">
    <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">{label}</div>
    {rows.map(({ name, value, color }) => (
      <div key={name} className="flex items-center gap-2 text-[10px]">
        <div className="h-2 w-2 shrink-0" style={{ backgroundColor: color }} />
        <span className="text-slate-500">{name}:</span>
        <span className="font-bold text-slate-900">{signedMoney(value)}</span>
      </div>
    ))}
  </div>
);

const CashTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return <TooltipBox label={label} rows={[
    { name: "Cash in", value: m.cashIn, color: GRN },
    { name: "Cash out", value: m.cashOut, color: ORG },
    { name: "Net movement", value: m.cashIn - m.cashOut, color: "#94a3b8" },
  ]} />;
};

const ProfitTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return <TooltipBox label={label} rows={[
    { name: "Income", value: m.income, color: GRN },
    { name: "Expenses", value: m.expenses, color: ORG },
    { name: m.net >= 0 ? "Net profit" : "Net loss", value: m.net, color: m.net >= 0 ? GRN : ROSE },
  ]} />;
};

// What needs doing, worst first. Every item says exactly what is wrong and opens the page that fixes it.
const buildAttention = (d) => {
  const items = [];
  for (const a of d.cash?.overdrawn || []) {
    const acc = d.cash.accounts.find((x) => x.code === a.code);
    items.push({ tone: "bad", text: `${a.name} (${a.code}) is overdrawn: ${signedMoney(a.balance)}`, hint: "A cash account can't hold less than nothing. Check its ledger for a payment posted to the wrong account.", to: acc ? activityUrl(acc._id) : "/accounts/chart-of-accounts" });
  }
  const health = d.glHealth;
  if (!health) items.push({ tone: "warn", text: "The GL health check has never been run", to: "/accounts/gl-integrity" });
  else if (health.overallStatus !== "clean") {
    items.push({ tone: health.overallStatus === "critical" ? "bad" : "warn", text: `GL health check found ${health.issueCount} issue${health.issueCount === 1 ? "" : "s"} (${fmtDate(health.runAt)})`, to: "/accounts/gl-integrity" });
  }
  if (!d.period) items.push({ tone: "warn", text: "No accounting period covers today", hint: "Postings dated today aren't checked against a period.", to: "/accounts/accounting-periods" });
  else if (d.period.status !== "open") items.push({ tone: "warn", text: `Today's period (${d.period.name}) is ${d.period.status}`, hint: "Postings dated today will be refused.", to: "/accounts/accounting-periods" });
  if (d.vouchers?.overdue?.count) items.push({ tone: "bad", text: `${d.vouchers.overdue.count} approved voucher${d.vouchers.overdue.count === 1 ? "" : "s"} past due: ${money(d.vouchers.overdue.amount)}`, to: "/accounts/payment-vouchers" });
  if (d.vouchers?.approved?.count) items.push({ tone: "info", text: `${d.vouchers.approved.count} approved voucher${d.vouchers.approved.count === 1 ? "" : "s"} waiting to be paid: ${money(d.vouchers.approved.amount)}`, to: "/accounts/payment-vouchers" });
  if (d.vouchers?.draft?.count) items.push({ tone: "info", text: `${d.vouchers.draft.count} draft voucher${d.vouchers.draft.count === 1 ? "" : "s"} waiting for approval: ${money(d.vouchers.draft.amount)}`, to: "/accounts/payment-vouchers" });
  if (d.journals?.draft) {
    const pending = d.journals.pendingApproval ? `, ${d.journals.pendingApproval} awaiting approval` : "";
    items.push({ tone: "info", text: `${d.journals.draft} draft journal${d.journals.draft === 1 ? "" : "s"} not posted${pending}`, to: "/accounts/journals" });
  }
  return items;
};

const TONE = {
  bad: { dot: "bg-rose-600", text: "text-rose-800", bg: "hover:bg-rose-50" },
  warn: { dot: "bg-amber-500", text: "text-amber-800", bg: "hover:bg-amber-50" },
  info: { dot: "bg-slate-400", text: "text-slate-700", bg: "hover:bg-slate-50" },
};

const TH = "px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white";
const Empty = ({ loading, children }) => (
  <tr><td colSpan={5} className="px-3 py-8 text-center text-xs font-semibold text-slate-400">{loading ? "Loading…" : children}</td></tr>
);

const AccountsDashboard = () => {
  const navigate = useNavigate();
  const biz = useSelector(selectCurrentCompany)?._id || "";

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["acc-dashboard", biz],
    enabled: Boolean(biz),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: getAccountsDashboard,
  });

  const d = data || {};
  const loading = !data;
  const months = d.months || [];
  const tm = d.thisMonth || {};
  const monthName = tm.startDate ? new Date(tm.startDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "this month";
  const cash = d.cash || { accounts: [], total: 0, overdrawn: [] };
  const unpaid = d.vouchers?.unpaid || { count: 0, amount: 0 };
  const overdue = d.vouchers?.overdue || { count: 0, amount: 0 };
  const attention = useMemo(() => (data ? buildAttention(data) : []), [data]);
  const show = (v) => (loading ? "…" : v);

  return (
    <ModuleShell>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">

        {isError && (
          <div className="flex items-center justify-between gap-3 border border-rose-200 bg-rose-50 px-4 py-2 text-[11px] font-bold text-rose-800">
            Couldn't load the dashboard figures{data ? "; showing the last figures loaded" : ""}.
            <button type="button" onClick={() => refetch()} className="border border-rose-300 bg-white px-3 py-1 text-[11px] font-bold hover:bg-rose-50">Retry</button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
          <DashboardStatCard compact label="Cash & Bank · now" value={show(signedMoney(cash.total))} icon={FaUniversity}
            tone={cash.overdrawn.length ? "red" : "green"}
            sub={loading ? "" : cash.overdrawn.length ? `${cash.overdrawn.length} account${cash.overdrawn.length === 1 ? "" : "s"} overdrawn` : `${cash.accounts.length} cash & bank accounts`}
            onClick={() => navigate("/accounts/cash-flow")} />
          <DashboardStatCard compact label={`Cash In · ${monthName}`} value={show(money(tm.cashIn))} icon={FaArrowDown} tone="green"
            sub="Received into cash & bank" onClick={() => navigate("/accounts/cash-flow")} />
          <DashboardStatCard compact label={`Cash Out · ${monthName}`} value={show(money(tm.cashOut))} icon={FaArrowUp} tone="orange"
            sub="Paid out of cash & bank" onClick={() => navigate("/accounts/cash-flow")} />
          <DashboardStatCard compact label={`${Number(tm.net) < 0 ? "Net Loss" : "Net Profit"} · ${monthName}`} value={show(money(Math.abs(tm.net || 0)))} icon={FaChartLine}
            tone={Number(tm.net) < 0 ? "red" : "green"}
            sub={loading ? "" : `Income ${money(tm.income)} · Expenses ${money(tm.expenses)}`}
            onClick={() => navigate("/accounts/income-statement")} />
          <DashboardStatCard compact label="Unpaid Vouchers" value={show(money(unpaid.amount))} icon={FaCreditCard}
            tone={overdue.count ? "red" : unpaid.count ? "orange" : "slate"}
            sub={loading ? "" : unpaid.count ? `${unpaid.count} voucher${unpaid.count === 1 ? "" : "s"}${overdue.count ? ` · ${overdue.count} past due` : ""}` : "Nothing waiting to be paid"}
            onClick={() => navigate("/accounts/payment-vouchers")} />
        </div>

        <div className="grid grid-cols-1 items-start gap-1.5 xl:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
              <DashboardCard title="Cash In / Cash Out" right={<span className="text-[10px] font-bold text-slate-400">last 6 months · as Cash Flow report</span>}>
                <div className="px-2 py-3">
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={months} barCategoryGap="30%" barGap={3}>
                      <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={shortKES} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={38} />
                      <Tooltip content={<CashTooltip />} cursor={{ fill: "#f8fafc" }} />
                      <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: "9px", paddingTop: "8px" }} />
                      <Bar dataKey="cashIn" name="Cash In" fill={GRN} radius={0} isAnimationActive={false} />
                      <Bar dataKey="cashOut" name="Cash Out" fill={ORG} radius={0} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashboardCard>

              <DashboardCard title="Net Profit / Loss" right={<span className="text-[10px] font-bold text-slate-400">last 6 months · as Income Statement</span>}>
                <div className="px-2 py-3">
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={months} barCategoryGap="40%">
                      <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={shortKES} tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={38} />
                      <ReferenceLine y={0} stroke="#cbd5e1" />
                      <Tooltip content={<ProfitTooltip />} cursor={{ fill: "#f8fafc" }} />
                      <Bar dataKey="net" name="Net" radius={0} isAnimationActive={false}>
                        {months.map((m) => <Cell key={m.key} fill={m.net >= 0 ? GRN : ROSE} />)}
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
                      <th className={`${TH} text-left`}>Due / Paid</th>
                      <th className={`${TH} text-left`}>Status</th>
                      <th className={`${TH} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.recent?.vouchers || []).length ? d.recent.vouchers.map((v) => {
                      const late = v.status === "approved" && v.dueDate && new Date(v.dueDate) < new Date(new Date().toDateString());
                      return (
                        <tr key={v._id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate("/accounts/payment-vouchers")}>
                          <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{v.voucherNo}</td>
                          <td className="max-w-[220px] truncate px-3 py-2 font-semibold text-slate-800" title={v.payee}>{v.payee || "—"}</td>
                          <td className={`px-3 py-2 ${late ? "font-bold text-rose-700" : "text-slate-500"}`}>
                            {v.status === "paid" ? `Paid ${fmtDate(v.paidDate)}` : `Due ${fmtDate(v.dueDate)}${late ? " · past due" : ""}`}
                          </td>
                          <td className="px-3 py-2"><Badge status={v.status} /></td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{money(v.amount)}</td>
                        </tr>
                      );
                    }) : <Empty loading={loading}>No payment vouchers yet.</Empty>}
                  </tbody>
                </table>
              </div>
            </DashboardCard>

            <DashboardCard title="Recent Journal Entries" right={<DashboardLinkButton onClick={() => navigate("/accounts/journals")} />}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead>
                    <tr className="bg-[#0B3B2E]">
                      <th className={`${TH} text-left`}>Journal No.</th>
                      <th className={`${TH} text-left`}>Date</th>
                      <th className={`${TH} text-left`}>Narration</th>
                      <th className={`${TH} text-left`}>Status</th>
                      <th className={`${TH} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.recent?.journals || []).length ? d.recent.journals.map((j) => (
                      <tr key={j._id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => navigate("/accounts/journals")}>
                        <td className="px-3 py-2 font-mono font-bold text-[#0B3B2E]">{j.journalNo}</td>
                        <td className="px-3 py-2 text-slate-500">{fmtDate(j.date)}</td>
                        <td className="max-w-[260px] truncate px-3 py-2 font-semibold text-slate-800" title={j.narration}>{j.narration || "—"}</td>
                        <td className="px-3 py-2"><Badge status={j.status} /></td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">{money(j.amount)}</td>
                      </tr>
                    )) : <Empty loading={loading}>No journal entries yet.</Empty>}
                  </tbody>
                </table>
              </div>
            </DashboardCard>
          </div>

          <div className="flex flex-col gap-1.5">
            <DashboardCard
              title="Needs Attention"
              right={
                <button type="button" onClick={() => refetch()} disabled={isFetching} title="Refresh figures" className="text-[#0B3B2E] hover:text-[#FF8C00] disabled:opacity-40">
                  <FaSyncAlt size={10} className={isFetching ? "animate-spin" : ""} />
                </button>
              }
            >
              {loading ? (
                <div className="px-3 py-6 text-center text-xs font-semibold text-slate-400">Loading…</div>
              ) : attention.length ? (
                <div className="divide-y divide-slate-100">
                  {attention.map((a) => (
                    <button key={a.text} type="button" onClick={() => navigate(a.to)} className={`flex w-full items-start gap-2 px-3 py-1.5 text-left ${TONE[a.tone].bg}`} title={a.hint || ""}>
                      <span className={`mt-1 h-2 w-2 shrink-0 ${TONE[a.tone].dot}`} />
                      <span className="min-w-0">
                        <span className={`block text-[11px] font-bold ${TONE[a.tone].text}`}>{a.text}</span>
                        {a.hint && <span className="block text-[10px] text-slate-500">{a.hint}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-3 text-[11px] font-bold text-emerald-700">
                  <FaCheckCircle className="shrink-0" /> All clear: nothing waiting, GL check clean.
                </div>
              )}
              {!loading && d.glHealth?.overallStatus === "clean" && attention.length > 0 && (
                <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-500">GL health check clean · {fmtDate(d.glHealth.runAt)}</div>
              )}
            </DashboardCard>

            <DashboardCard title="Cash & Bank Balances" right={<DashboardLinkButton onClick={() => navigate("/accounts/cash-flow")}>Cash Flow →</DashboardLinkButton>}>
              {loading ? (
                <div className="px-3 py-6 text-center text-xs font-semibold text-slate-400">Loading…</div>
              ) : cash.accounts.length ? (
                <div className="divide-y divide-slate-100">
                  {cash.accounts.map((a) => (
                    <button key={a._id} type="button" onClick={() => navigate(activityUrl(a._id))} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[#F1F6F3]">
                      <span className="min-w-0 truncate text-xs font-bold text-slate-700" title={`${a.code} ${a.name}`}>
                        <span className="mr-1 font-mono text-[10px] font-normal text-slate-400">{a.code}</span>{a.name}
                      </span>
                      <span className={`shrink-0 text-xs font-extrabold tabular-nums ${a.balance < 0 ? "text-rose-700" : "text-slate-900"}`}>{signedMoney(a.balance)}</span>
                    </button>
                  ))}
                  <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Total</span>
                    <span className={`text-xs font-black tabular-nums ${cash.total < 0 ? "text-rose-700" : "text-[#0B3B2E]"}`}>{signedMoney(cash.total)}</span>
                  </div>
                </div>
              ) : (
                <div className="px-3 py-4 text-[11px] text-slate-500">No cash or bank accounts in the chart of accounts yet.</div>
              )}
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
