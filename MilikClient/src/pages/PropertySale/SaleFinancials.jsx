import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaBook,
  FaCalendarAlt,
  FaChartLine,
  FaExternalLinkAlt,
  FaHandshake,
  FaLayerGroup,
  FaMoneyBillWave,
  FaRedoAlt,
  FaSearch,
  FaTimes,
  FaWallet,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getChartOfAccounts, getJournalEntries } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { GL_ACCESS_MODULES } from "../../utils/companyModules";
import useDebounce from "../../hooks/useDebounce";

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const todayISO = () => new Date().toISOString().split("T")[0];
const firstOfMonthISO = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split("T")[0];
};

const STATUS_BADGE = {
  draft:    "bg-slate-100 text-slate-600 border-slate-200",
  posted:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  reversed: "bg-amber-100 text-amber-700 border-amber-200",
};

const ACCOUNT_TYPE_COLORS = {
  asset:     "bg-blue-50 text-blue-700",
  liability: "bg-rose-50 text-rose-700",
  equity:    "bg-violet-50 text-violet-700",
  revenue:   "bg-emerald-50 text-emerald-700",
  income:    "bg-emerald-50 text-emerald-700",
  expense:   "bg-amber-50 text-amber-700",
};

const SALE_COLOR = "#027333";

const KpiCard = ({ icon: Icon, label, value, sub, bg = SALE_COLOR }) => (
  <div className="flex items-center gap-3 border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: bg }}>
      <Icon className="text-sm" />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm font-extrabold leading-tight text-slate-900">{value ?? "—"}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  </div>
);

const EmptyState = ({ icon: Icon, message }) => (
  <div className="flex h-52 flex-col items-center justify-center gap-3 text-slate-400">
    <Icon size={28} className="opacity-40" />
    <p className="max-w-xs text-center text-xs leading-5">{message}</p>
  </div>
);

export default function SaleFinancials() {
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const currentUser    = useSelector((s) => s.auth?.currentUser || s.auth?.user);

  const canViewAccounts = hasCompanyPermission(currentUser || {}, currentCompany, "chartOfAccounts", "view", GL_ACCESS_MODULES);

  const [tab, setTab]           = useState("journals");
  const [journals, setJournals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [journalsLoading, setJournalsLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [acctLoaded, setAcctLoaded]           = useState(false);
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate]       = useState(firstOfMonthISO());
  const [endDate, setEndDate]           = useState(todayISO());

  const debouncedSearch = useDebounce(search, 350);

  const loadJournals = useCallback(async () => {
    if (!currentCompany?._id) return;
    setJournalsLoading(true);
    try {
      const { data: rows } = await getJournalEntries({
        business:     currentCompany._id,
        sourceModule: "propertySale",
        status:       statusFilter !== "all" ? statusFilter : undefined,
        startDate:    startDate || undefined,
        endDate:      endDate   || undefined,
        search:       debouncedSearch || undefined,
      });
      setJournals(Array.isArray(rows) ? rows : []);
    } catch {
      toast.error("Failed to load Sale GL journals");
    } finally {
      setJournalsLoading(false);
    }
  }, [currentCompany?._id, statusFilter, startDate, endDate, debouncedSearch]);

  const loadAccounts = useCallback(async () => {
    if (!currentCompany?._id || !canViewAccounts || acctLoaded) return;
    setAccountsLoading(true);
    try {
      const rows = await getChartOfAccounts({ business: currentCompany._id });
      setAccounts(Array.isArray(rows) ? rows : []);
      setAcctLoaded(true);
    } catch {
      toast.error("Failed to load Sale chart of accounts");
    } finally {
      setAccountsLoading(false);
    }
  }, [currentCompany?._id, canViewAccounts, acctLoaded]);

  useEffect(() => { loadJournals(); }, [loadJournals]);
  useEffect(() => { if (tab === "accounts") loadAccounts(); }, [tab, loadAccounts]);

  const kpis = useMemo(() => {
    const posted = journals.filter((j) => j.status === "posted");
    const commissionIncome = posted
      .filter((j) => ["income", "revenue"].includes(String(j.creditAccount?.type || "").toLowerCase()))
      .reduce((sum, j) => sum + Number(j.amount || 0), 0);
    const expenses = posted
      .filter((j) => String(j.debitAccount?.type || "").toLowerCase() === "expense")
      .reduce((sum, j) => sum + Number(j.amount || 0), 0);
    return { total: journals.length, postedCount: posted.length, commissionIncome, expenses, net: commissionIncome - expenses };
  }, [journals]);

  const handleRefresh = () => { loadJournals(); setAcctLoaded(false); };

  const TABS = [
    { id: "journals", label: "GL Journals" },
    { id: "accounts", label: "Accounts" },
  ];

  return (
    <DashboardLayout>
      <div className="p-2 sm:p-4 space-y-3 sm:space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-slate-900">Sale Financials</h1>
            <p className="text-xs text-slate-500">GL journals and accounts for the Property Sale module</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
              <FaCalendarAlt size={10} className="shrink-0 text-slate-400" />
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0" />
              <span className="text-slate-300">—</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0" />
            </div>
            <button onClick={handleRefresh} className="inline-flex items-center gap-1.5 border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors rounded">
              <FaRedoAlt size={10} /> Refresh
            </button>
            <button
              onClick={() => navigate("/sale/chart-of-accounts")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black text-white rounded transition-colors"
              style={{ backgroundColor: SALE_COLOR }}
            >
              <FaExternalLinkAlt size={9} />
              <span className="hidden sm:inline">Full Chart of Accounts</span>
              <span className="sm:hidden">COA</span>
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <KpiCard icon={FaBook} label="Total Entries" value={kpis.total.toLocaleString()} sub={`${kpis.postedCount} posted`} bg="#374151" />
          <KpiCard icon={FaHandshake} label="Commission Income" value={`KES ${fmt(kpis.commissionIncome)}`} sub="posted credit-side income" bg={SALE_COLOR} />
          <KpiCard icon={FaWallet} label="Expenses Posted" value={`KES ${fmt(kpis.expenses)}`} sub="posted debit-side expenses" bg="#E65F1A" />
          <KpiCard icon={FaMoneyBillWave} label="Net Position" value={`KES ${fmt(kpis.net)}`} sub={kpis.net >= 0 ? "surplus" : "deficit"} bg={kpis.net >= 0 ? SALE_COLOR : "#DC2626"} />
          <KpiCard icon={FaLayerGroup} label="GL Accounts" value={accounts.length || "—"} sub="active accounts" bg="#6D28D9" />
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-slate-200 bg-white">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                tab === t.id ? "border-[#027333] text-[#027333]" : "border-transparent text-slate-400 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Journals Tab */}
        {tab === "journals" && (
          <div className="rounded border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
              <div className="relative min-w-0 flex-1 max-w-xs sm:min-w-[180px]">
                <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search journal #, narration…"
                  className="w-full rounded border border-slate-200 py-1.5 pl-8 pr-8 text-xs text-slate-700 placeholder-slate-400 focus:outline-none"
                  style={{ "--tw-ring-color": SALE_COLOR }}
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                    <FaTimes size={10} />
                  </button>
                )}
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none">
                <option value="all">All Status</option>
                <option value="draft">Draft</option>
                <option value="posted">Posted</option>
                <option value="reversed">Reversed</option>
              </select>
              {(search || statusFilter !== "all") && (
                <button onClick={() => { setSearch(""); setStatusFilter("all"); }} className="text-[10px] font-bold text-slate-500 hover:text-rose-600 transition-colors">
                  Clear
                </button>
              )}
              <span className="ml-auto text-[10px] font-bold text-slate-400">
                {journals.length.toLocaleString()} {journals.length === 1 ? "entry" : "entries"}
              </span>
            </div>

            {journalsLoading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200" style={{ borderTopColor: SALE_COLOR }} />
              </div>
            ) : journals.length === 0 ? (
              <EmptyState
                icon={FaBook}
                message="No Property Sale GL journals found for the selected period. Journals will be posted automatically when sale transactions are processed and GL integration is active."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-[11px]">
                  <thead className="bg-[#027333] text-white">
                    <tr>
                      {["Journal #", "Date", "Debit Account", "Credit Account", "Amount (KES)", "Status"].map((col, i, arr) => (
                        <th key={col} className={`px-3 py-1 text-left font-bold whitespace-nowrap ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {journals.map((j, i) => (
                      <tr key={j._id} className={`border-b border-gray-100 transition-colors ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                        <td className="px-3 py-1 border-r border-gray-100 font-mono font-bold text-slate-700">{j.journalNo || "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 whitespace-nowrap text-slate-600">{fmtDate(j.date)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[200px]">{j.debitAccount ? `${j.debitAccount.code} – ${j.debitAccount.name}` : "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-700 max-w-[200px]">{j.creditAccount ? `${j.creditAccount.code} – ${j.creditAccount.name}` : "—"}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-mono font-black text-slate-900 whitespace-nowrap">{fmt(j.amount)}</td>
                        <td className="px-3 py-1">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black capitalize ${STATUS_BADGE[j.status] || "bg-slate-100 text-slate-500 border-slate-200"}`}>
                            {j.status || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Accounts Tab */}
        {tab === "accounts" && (
          <div className="rounded border border-slate-200 bg-white shadow-sm">
            {!canViewAccounts ? (
              <div className="flex h-40 items-center justify-center">
                <p className="text-xs text-slate-400">You do not have permission to view the chart of accounts.</p>
              </div>
            ) : accountsLoading ? (
              <div className="flex h-40 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200" style={{ borderTopColor: SALE_COLOR }} />
              </div>
            ) : accounts.length === 0 ? (
              <EmptyState
                icon={FaLayerGroup}
                message="No accounts found. Chart of accounts is provisioned automatically the first time it is initialised for this company."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[11px]">
                  <thead className="bg-[#027333] text-white">
                    <tr>
                      {["Code", "Account Name", "Type", "Sub-Group", "Balance (KES)"].map((col, i, arr) => (
                        <th key={col} className={`px-3 py-1 text-left font-bold ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>
                          {col}
                        </th>
                      ))}
                      <th className="px-3 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a, i) => (
                      <tr key={a._id} className={`border-b border-gray-100 transition-colors ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                        <td className="px-3 py-1 border-r border-gray-100 font-mono font-bold text-slate-700">{a.code}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{a.name}</td>
                        <td className="px-3 py-1 border-r border-gray-100">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${ACCOUNT_TYPE_COLORS[a.type] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                            {a.type}
                          </span>
                        </td>
                        <td className="px-3 py-1 border-r border-gray-100 text-slate-500">{a.subGroup || a.group || "—"}</td>
                        <td className={`px-3 py-1 border-r border-gray-100 text-right font-mono font-black ${Number(a.balance || 0) < 0 ? "text-rose-600" : "text-slate-900"}`}>
                          {fmt(a.balance)}
                        </td>
                        <td className="px-3 py-1 text-right">
                          <button
                            onClick={() => navigate(`/sale/chart-of-accounts/${a._id}/activity`)}
                            className="inline-flex items-center gap-1 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:text-[#027333] hover:border-[#027333] transition-colors"
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
    </DashboardLayout>
  );
}
