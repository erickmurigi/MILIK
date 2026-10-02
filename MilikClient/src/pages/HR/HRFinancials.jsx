import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaCalendarAlt,
  FaChartLine,
  FaExternalLinkAlt,
  FaRedoAlt,
  FaSearch,
  FaTimes,
} from "react-icons/fa";
import { toast } from "react-toastify";
import AppSelect from "../../components/common/AppSelect";
import ListToolbar from "../../components/common/ListToolbar";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikTable from "../../components/common/MilikTable";
import { getChartOfAccounts, getJournalEntries } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { GL_ACCESS_MODULES, hasCompanyModule } from "../../utils/companyModules";
import useDebounce from "../../hooks/useDebounce";
import { fmtDate, todayISO } from '../../utils/dates';

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const firstOfMonthISO = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split("T")[0];
};

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_BADGE = {
  draft:    "bg-slate-100 text-slate-600 border-slate-200",
  posted:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};

const JOURNAL_TYPE_LABELS = {
  payroll_posting:   "Payroll Posting",
  statutory_payment: "Statutory Payment",
  general_manual_journal: "Manual Journal",
  company_journal:   "Company Journal",
};

const TABS = [
  { id: "journals", label: "Payroll Journals" },
  { id: "accounts", label: "GL Accounts" },
];

const ACCOUNT_TYPE_COLORS = {
  asset:     "bg-blue-50 text-blue-700",
  liability: "bg-rose-50 text-rose-700",
  equity:    "bg-violet-50 text-violet-700",
  revenue:   "bg-emerald-50 text-emerald-700",
  expense:   "bg-amber-50 text-amber-700",
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function HRFinancials() {
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser    = useSelector((s) => s.auth?.currentUser || s.auth?.user);

  const canViewAccounts = useMemo(
    () => hasCompanyPermission(currentUser || {}, currentCompany, "chartOfAccounts", "view", GL_ACCESS_MODULES),
    [currentUser, currentCompany]
  );
  const hasFullAccounts = useMemo(() => hasCompanyModule(currentCompany, "accounts"), [currentCompany]);

  // ── State ──────────────────────────────────────────────────────────────────
  const [tab, setTab]           = useTabState("/hr/financials:tab", "journals");
  const [journals, setJournals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [journalsLoading, setJournalsLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [acctLoaded, setAcctLoaded]           = useState(false);

  const [search, setSearch]           = useTabState("/hr/financials:search", "");
  const [statusFilter, setStatusFilter] = useTabState("/hr/financials:statusFilter", "");
  const [startDate, setStartDate]     = useTabState("/hr/financials:startDate", () => firstOfMonthISO());
  const [endDate, setEndDate]         = useTabState("/hr/financials:endDate", () => todayISO());

  const debouncedSearch = useDebounce(search, 350);

  // ── Data loaders ───────────────────────────────────────────────────────────
  const loadJournals = useCallback(async () => {
    if (!currentCompany?._id) return;
    setJournalsLoading(true);
    try {
      const { data: rows } = await getJournalEntries({
        business:     currentCompany._id,
        sourceModule: "hr",
        status:       statusFilter || undefined,
        startDate:    startDate || undefined,
        endDate:      endDate   || undefined,
        search:       debouncedSearch || undefined,
      });
      setJournals(Array.isArray(rows) ? rows : []);
    } catch {
      toast.error("Failed to load HR payroll journals");
    } finally {
      setJournalsLoading(false);
    }
  }, [currentCompany?._id, statusFilter, startDate, endDate, debouncedSearch]);

  const loadAccounts = useCallback(async () => {
    if (!currentCompany?._id || !canViewAccounts || acctLoaded) return;
    setAccountsLoading(true);
    try {
      const rows = await getChartOfAccounts({
        business: currentCompany._id,
      });
      setAccounts(Array.isArray(rows) ? rows : []);
      setAcctLoaded(true);
    } catch {
      toast.error("Failed to load HR chart of accounts");
    } finally {
      setAccountsLoading(false);
    }
  }, [currentCompany?._id, canViewAccounts, acctLoaded]);

  useEffect(() => { loadJournals(); }, [loadJournals]);
  useEffect(() => {
    if (tab === "accounts") loadAccounts();
  }, [tab, loadAccounts]);

  // ── Derived KPIs ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const posted  = journals.filter((j) => j.status === "posted");
    const payroll = posted.filter((j) => j.journalType === "payroll_posting");

    const grossPosted = payroll
      .filter((j) => {
        const acctName = String(j.debitAccount?.name || "").toLowerCase();
        return acctName.includes("salary") || acctName.includes("wage") || acctName.includes("salaries");
      })
      .reduce((sum, j) => sum + Number(j.amount || 0), 0);

    const totalPosted = posted.reduce((sum, j) => sum + Number(j.amount || 0), 0);

    const uniqueGroups = new Set(
      posted
        .map((j) => String(j.journalGroupId || ""))
        .filter(Boolean)
    );

    return {
      total:       journals.length,
      postedCount: posted.length,
      grossPosted,
      totalPosted,
      batches:     uniqueGroups.size,
    };
  }, [journals]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    loadJournals();
    setAcctLoaded(false);
  }, [loadJournals]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* ── Toolbar ───────────────────────────────────────────────────────── */}
        <ListToolbar>
          <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">HR Financials</span>
          <ListToolbar.Divider />
          <FaCalendarAlt size={8} className="shrink-0 text-slate-400" />
          <ListToolbar.Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <span className="shrink-0 text-[9px] text-slate-400">—</span>
          <ListToolbar.Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={handleRefresh}>Refresh</ListToolbar.Button>
          {hasFullAccounts && (
            <ListToolbar.Button icon={FaExternalLinkAlt} onClick={() => navigate("/financial/journals")}>
              Full Accounts
            </ListToolbar.Button>
          )}
        </ListToolbar>

        {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
        <div className="grid shrink-0 grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-white sm:grid-cols-4">
          {[
            { label: "Total Entries", value: kpis.total.toLocaleString(), sub: `${kpis.postedCount} posted` },
            { label: "Gross Payroll Posted", value: `KES ${fmt(kpis.grossPosted)}`, sub: "salary expense entries" },
            { label: "Total Amount Posted", value: `KES ${fmt(kpis.totalPosted)}`, sub: "all posted journal legs" },
            { label: "Payroll Batches", value: kpis.batches.toLocaleString(), sub: "unique journal groups" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="flex flex-col items-start px-4 py-2.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
              <span className="mt-0.5 font-mono text-sm font-black leading-tight text-slate-800">{value}</span>
              <span className="text-[9px] text-slate-400">{sub}</span>
            </div>
          ))}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5 sm:px-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`h-[20px] shrink-0 px-1.5 text-[9px] font-bold uppercase tracking-widest transition-colors ${
                tab === t.id
                  ? "bg-[#0B3B2E] text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ───────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">

          {/* ─── Journals Tab ─────────────────────────────────────────────── */}
          {tab === "journals" && (
            <>
              {/* Filter bar */}
              <ListToolbar>
                <div className="relative shrink-0">
                  <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
                  <ListToolbar.Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search journal #, narration…"
                    width="w-52"
                    className="pl-5 pr-6"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <FaTimes size={8} />
                    </button>
                  )}
                </div>
                <AppSelect
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v ?? "")}
                  options={[
                    { value: "draft", label: "Draft" },
                    { value: "posted", label: "Posted" },
                    { value: "reversed", label: "Reversed" },
                  ]}
                  placeholder="All Status"
                  clearable
                  compact
                />
                {(search || statusFilter) && (
                  <ListToolbar.Button variant="outline" onClick={() => { setSearch(""); setStatusFilter(""); }}>
                    Clear filters
                  </ListToolbar.Button>
                )}
                <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[9px] font-semibold text-slate-400">
                  {journals.length.toLocaleString()} {journals.length === 1 ? "entry" : "entries"}
                </span>
              </ListToolbar>

              {/* Table */}
              <div className="min-h-0 flex-1 overflow-hidden flex flex-col">
                <MilikTable
                  minWidth="750px"
                  columns={[
                    { label: "Journal #" },
                    { label: "Date" },
                    { label: "Type" },
                    { label: "Debit Account" },
                    { label: "Credit Account" },
                    { label: "Amount (KES)", align: "right" },
                    { label: "Status" },
                  ]}
                  rows={journals}
                  rowKey="_id"
                  loading={journalsLoading}
                  empty="No HR journals found for the selected period. Payroll journals are automatically posted when a payroll period is approved."
                  renderRow={(j) => (
                    <>
                      <td className="px-3 py-1 border-r border-gray-100 font-mono font-bold text-slate-700">
                        {j.journalNo || "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 whitespace-nowrap text-slate-600">
                        {fmtDate(j.date)}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100">
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {JOURNAL_TYPE_LABELS[j.journalType] || j.journalType || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[200px]">
                        {j.debitAccount
                          ? `${j.debitAccount.code} – ${j.debitAccount.name}`
                          : "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[200px]">
                        {j.creditAccount
                          ? `${j.creditAccount.code} – ${j.creditAccount.name}`
                          : "—"}
                      </td>
                      <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                        {fmt(j.amount)}
                      </td>
                      <td className="px-3 py-1">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black capitalize ${
                            STATUS_BADGE[j.status] || "bg-slate-100 text-slate-500 border-slate-200"
                          }`}
                        >
                          {j.status || "—"}
                        </span>
                      </td>
                    </>
                  )}
                />
              </div>
            </>
          )}

          {/* ─── Accounts Tab ─────────────────────────────────────────────── */}
          {tab === "accounts" && (
            <div className="min-h-0 flex-1 overflow-hidden flex flex-col p-2">
              {!canViewAccounts ? (
                <div className="flex h-40 items-center justify-center rounded-lg border border-slate-200 bg-white">
                  <p className="text-xs text-slate-400">
                    You do not have permission to view the chart of accounts.
                  </p>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-hidden flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
                  <MilikTable
                    minWidth="580px"
                    columns={[
                      { label: "Code" },
                      { label: "Account Name" },
                      { label: "Type" },
                      { label: "Sub-Group" },
                      { label: "Balance (KES)", align: "right" },
                    ]}
                    rows={accounts}
                    rowKey="_id"
                    loading={accountsLoading}
                    empty="No accounts found. Chart of accounts is provisioned automatically the first time it is initialised for this company."
                    renderActions={(a) => (
                      <button
                        onClick={() => navigate(`/hr/chart-of-accounts/${a._id}/activity`)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                      >
                        <FaChartLine size={8} /> Ledger
                      </button>
                    )}
                    renderRow={(a) => (
                      <>
                        <td className="px-3 py-1 border-r border-gray-100 font-mono font-bold text-slate-700">
                          {a.code}
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{a.name}</td>
                        <td className="px-3 py-1 border-r border-gray-100">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${
                              ACCOUNT_TYPE_COLORS[a.type] || "bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                          >
                            {a.type}
                          </span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{a.subGroup || a.group || "—"}</td>
                        <td
                          className={`px-3 py-1 border-r border-gray-100 text-right font-mono font-black ${
                            Number(a.balance || 0) < 0 ? "text-rose-600" : "text-slate-900"
                          }`}
                        >
                          {fmt(a.balance)}
                        </td>
                      </>
                    )}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
