import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaBook,
  FaCalendarAlt,
  FaChartLine,
  FaExternalLinkAlt,
  FaFileInvoiceDollar,
  FaLayerGroup,
  FaMoneyBillWave,
  FaRedoAlt,
  FaSearch,
  FaTimes,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getChartOfAccounts, getJournalEntries } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { GL_ACCESS_MODULES, hasCompanyModule } from "../../utils/companyModules";
import useDebounce from "../../hooks/useDebounce";

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

const todayISO = () => new Date().toISOString().split("T")[0];
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

// ─── Sub-components ───────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, sub, accent }) => (
  <div className="flex items-center gap-3 bg-white px-4 py-3">
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accent || "bg-slate-100"}`}>
      <Icon className="text-sm text-white" />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm font-black leading-tight text-slate-900">{value ?? "—"}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  </div>
);

const EmptyState = ({ icon: Icon, message }) => (
  <div className="flex h-52 flex-col items-center justify-center gap-3 text-slate-400">
    <Icon size={28} className="opacity-40" />
    <p className="max-w-xs text-center text-xs leading-5">{message}</p>
  </div>
);

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
  const [tab, setTab]           = useState("journals");
  const [journals, setJournals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [journalsLoading, setJournalsLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [acctLoaded, setAcctLoaded]           = useState(false);

  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate]     = useState(firstOfMonthISO());
  const [endDate, setEndDate]         = useState(todayISO());

  const debouncedSearch = useDebounce(search, 350);

  // ── Data loaders ───────────────────────────────────────────────────────────
  const loadJournals = useCallback(async () => {
    if (!currentCompany?._id) return;
    setJournalsLoading(true);
    try {
      const { data: rows } = await getJournalEntries({
        business:     currentCompany._id,
        sourceModule: "hr",
        status:       statusFilter !== "all" ? statusFilter : undefined,
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

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3 sm:px-5 py-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                Human Resource
              </div>
              <h1 className="text-sm font-black leading-tight text-slate-900">Financials</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Date Range */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                <FaCalendarAlt size={10} className="shrink-0 text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0"
                />
                <span className="text-slate-300">—</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0"
                />
              </div>

              <button
                onClick={handleRefresh}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <FaRedoAlt size={10} /> Refresh
              </button>

              {hasFullAccounts && (
                <button
                  onClick={() => navigate("/financial/journals")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#092f24] transition-colors"
                >
                  <FaExternalLinkAlt size={9} /> Full Accounts
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── KPI Strip ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 grid grid-cols-1 gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={FaBook}
            label="Total Entries"
            value={kpis.total.toLocaleString()}
            sub={`${kpis.postedCount} posted`}
            accent="bg-slate-500"
          />
          <KpiCard
            icon={FaFileInvoiceDollar}
            label="Gross Payroll Posted"
            value={`KES ${fmt(kpis.grossPosted)}`}
            sub="salary expense entries"
            accent="bg-emerald-600"
          />
          <KpiCard
            icon={FaMoneyBillWave}
            label="Total Amount Posted"
            value={`KES ${fmt(kpis.totalPosted)}`}
            sub="all posted journal legs"
            accent="bg-[#0B3B2E]"
          />
          <KpiCard
            icon={FaLayerGroup}
            label="Payroll Batches"
            value={kpis.batches.toLocaleString()}
            sub="unique journal groups"
            accent="bg-amber-500"
          />
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex gap-0 border-b border-slate-200 bg-white px-3 sm:px-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                tab === t.id
                  ? "border-emerald-700 text-emerald-700"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ───────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto">

          {/* ─── Journals Tab ─────────────────────────────────────────────── */}
          {tab === "journals" && (
            <>
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-3 sm:px-5 py-2.5">
                <div className="relative min-w-0 flex-1 max-w-xs sm:min-w-[180px]">
                  <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search journal #, narration…"
                    className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-8 text-xs text-slate-700 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <FaTimes size={10} />
                    </button>
                  )}
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="all">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="reversed">Reversed</option>
                </select>
                {(search || statusFilter !== "all") && (
                  <button
                    onClick={() => { setSearch(""); setStatusFilter("all"); }}
                    className="text-[10px] font-bold text-slate-500 hover:text-rose-600 transition-colors"
                  >
                    Clear filters
                  </button>
                )}
                <span className="ml-auto text-[10px] font-bold text-slate-400">
                  {journals.length.toLocaleString()} {journals.length === 1 ? "entry" : "entries"}
                </span>
              </div>

              {/* Table */}
              {journalsLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
                </div>
              ) : journals.length === 0 ? (
                <EmptyState
                  icon={FaBook}
                  message="No HR journals found for the selected period. Payroll journals are automatically posted when a payroll period is approved."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[750px] border-collapse text-xs">
                    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">
                      <tr>
                        {[
                          "Journal #",
                          "Date",
                          "Type",
                          "Debit Account",
                          "Credit Account",
                          "Amount (KES)",
                          "Status",
                        ].map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {journals.map((j) => (
                        <tr key={j._id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-[11px] font-bold text-slate-700">
                            {j.journalNo || "—"}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                            {fmtDate(j.date)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                              {JOURNAL_TYPE_LABELS[j.journalType] || j.journalType || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-700 max-w-[200px]">
                            {j.debitAccount
                              ? `${j.debitAccount.code} – ${j.debitAccount.name}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-slate-700 max-w-[200px]">
                            {j.creditAccount
                              ? `${j.creditAccount.code} – ${j.creditAccount.name}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-black text-slate-900 whitespace-nowrap">
                            {fmt(j.amount)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black capitalize ${
                                STATUS_BADGE[j.status] || "bg-slate-100 text-slate-500 border-slate-200"
                              }`}
                            >
                              {j.status || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ─── Accounts Tab ─────────────────────────────────────────────── */}
          {tab === "accounts" && (
            <div className="p-4">
              {!canViewAccounts ? (
                <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-white">
                  <p className="text-xs text-slate-400">
                    You do not have permission to view the chart of accounts.
                  </p>
                </div>
              ) : accountsLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
                </div>
              ) : accounts.length === 0 ? (
                <EmptyState
                  icon={FaLayerGroup}
                  message="No accounts found. Chart of accounts is provisioned automatically the first time it is initialised for this company."
                />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full min-w-[580px] border-collapse text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        {["Code", "Account Name", "Type", "Sub-Group", "Balance (KES)"].map(
                          (col) => (
                            <th
                              key={col}
                              className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-500"
                            >
                              {col}
                            </th>
                          )
                        )}
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {accounts.map((a) => (
                        <tr key={a._id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2.5 font-mono font-bold text-slate-700">
                            {a.code}
                          </td>
                          <td className="px-4 py-2.5 font-semibold text-slate-900">{a.name}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${
                                ACCOUNT_TYPE_COLORS[a.type] || "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {a.type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{a.subGroup || a.group || "—"}</td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono font-black ${
                              Number(a.balance || 0) < 0 ? "text-rose-600" : "text-slate-900"
                            }`}
                          >
                            {fmt(a.balance)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() =>
                                navigate(`/hr/chart-of-accounts/${a._id}/activity`)
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                            >
                              <FaChartLine size={8} /> Ledger
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
