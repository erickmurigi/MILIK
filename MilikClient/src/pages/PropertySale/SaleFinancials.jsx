import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaBook, FaCalendarAlt, FaChartLine, FaExternalLinkAlt,
  FaHandshake, FaLayerGroup, FaMoneyBillWave, FaRedoAlt,
  FaSearch, FaTimes, FaWallet,
} from "react-icons/fa";
import { toast } from "react-toastify";
import PropertySaleShell from "./PropertySaleShell";
import { getChartOfAccounts, getJournalEntries } from "../../redux/apiCalls";
import { hasCompanyPermission } from "../../utils/permissions";
import { GL_ACCESS_MODULES } from "../../utils/companyModules";
import useDebounce from "../../hooks/useDebounce";

const fmt = (n) =>
  Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const todayISO      = () => new Date().toISOString().split("T")[0];
const firstOfMonth  = () => { const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0]; };

const STATUS_BADGE = {
  draft:    "border-slate-200 bg-slate-50 text-slate-600",
  posted:   "border-emerald-200 bg-emerald-50 text-emerald-700",
  reversed: "border-amber-200 bg-amber-50 text-amber-700",
};

const ACCOUNT_TYPE_COLORS = {
  asset:     "border-sky-200 bg-sky-50 text-sky-700",
  liability: "border-orange-200 bg-orange-50 text-orange-700",
  equity:    "border-violet-200 bg-violet-50 text-violet-700",
  revenue:   "border-emerald-200 bg-emerald-50 text-emerald-700",
  income:    "border-emerald-200 bg-emerald-50 text-emerald-700",
  expense:   "border-amber-200 bg-amber-50 text-amber-700",
};

const KpiCard = ({ icon: Icon, label, value, sub, color = "#0B3B2E" }) => (
  <div className="flex items-center gap-3 border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center text-white" style={{ backgroundColor: color }}>
      <Icon className="text-sm" />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm font-extrabold leading-tight text-slate-900">{value ?? "—"}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  </div>
);

const TABS = [
  { id: "journals", label: "GL Journals" },
  { id: "accounts", label: "Accounts" },
];

export default function SaleFinancials() {
  const navigate        = useNavigate();
  const currentCompany  = useSelector((s) => s.company?.currentCompany);
  const currentUser     = useSelector((s) => s.auth?.currentUser || s.auth?.user);

  const canViewAccounts = hasCompanyPermission(currentUser || {}, currentCompany, "chartOfAccounts", "view", GL_ACCESS_MODULES);

  const [tab,            setTab]           = useState("journals");
  const [journals,       setJournals]      = useState([]);
  const [accounts,       setAccounts]      = useState([]);
  const [journalsLoading, setJournalsLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [acctLoaded,     setAcctLoaded]    = useState(false);
  const [search,         setSearch]        = useTabState("/sale/financials:search", "");
  const [statusFilter,   setStatusFilter]  = useTabState("/sale/financials:statusFilter", "all");
  const [startDate,      setStartDate]     = useTabState("/sale/financials:startDate", () => firstOfMonth());
  const [endDate,        setEndDate]       = useTabState("/sale/financials:endDate", () => todayISO());

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
      toast.error("Failed to load chart of accounts");
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
      .reduce((s, j) => s + Number(j.amount || 0), 0);
    const expenses = posted
      .filter((j) => String(j.debitAccount?.type || "").toLowerCase() === "expense")
      .reduce((s, j) => s + Number(j.amount || 0), 0);
    return { total: journals.length, postedCount: posted.length, commissionIncome, expenses, net: commissionIncome - expenses };
  }, [journals]);

  const handleRefresh = () => { loadJournals(); setAcctLoaded(false); };

  return (
    <PropertySaleShell
      title="Sale Financials"
      subtitle="GL journals & chart of accounts"
      action={
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefresh}
            className="inline-flex h-7 items-center gap-1 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
          >
            <FaRedoAlt size={9} /> Refresh
          </button>
          <button
            onClick={() => navigate("/sale/chart-of-accounts")}
            className="inline-flex h-7 items-center gap-1 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#07271e]"
          >
            <FaExternalLinkAlt size={9} />
            <span className="hidden sm:inline">Full COA</span>
          </button>
        </div>
      }
    >
      <div className="flex h-full flex-col">

        {/* KPI strip */}
        <div className="flex-shrink-0 grid grid-cols-2 gap-1.5 border-b border-slate-200 bg-slate-50 p-2 sm:grid-cols-3 xl:grid-cols-5">
          <KpiCard icon={FaBook}         label="Total Entries"      value={kpis.total.toLocaleString()}        sub={`${kpis.postedCount} posted`}                          color="#0B3B2E" />
          <KpiCard icon={FaHandshake}    label="Commission Income"  value={`KES ${fmt(kpis.commissionIncome)}`} sub="posted income"                                         color="#0B3B2E" />
          <KpiCard icon={FaWallet}       label="Expenses Posted"    value={`KES ${fmt(kpis.expenses)}`}        sub="posted expenses"                                        color="#C8511A" />
          <KpiCard icon={FaMoneyBillWave} label="Net Position"      value={`KES ${fmt(kpis.net)}`}             sub={kpis.net >= 0 ? "surplus" : "deficit"}                  color={kpis.net >= 0 ? "#0B3B2E" : "#C8511A"} />
          <KpiCard icon={FaLayerGroup}   label="GL Accounts"        value={accounts.length || "—"}             sub="active accounts"                                        color="#0B3B2E" />
        </div>

        {/* Tab bar */}
        <div className="flex flex-shrink-0 gap-0 border-b border-slate-200 bg-white">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                tab === t.id ? "border-[#0B3B2E] text-[#0B3B2E]" : "border-transparent text-slate-400 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content area */}
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">

          {/* ── Journals tab ───────────────────────────────────────────────── */}
          {tab === "journals" && (
            <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white m-2 shadow-sm">
              {/* Filter bar */}
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
                <div className="flex items-center gap-1.5 border border-slate-200 bg-white px-2.5 py-1 text-xs">
                  <FaCalendarAlt size={9} className="shrink-0 text-slate-400" />
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0" />
                  <span className="text-slate-300">—</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border-0 bg-transparent text-xs text-slate-700 outline-none min-w-0" />
                </div>
                <div className="relative flex-1 min-w-[160px] max-w-xs">
                  <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={9} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search journal #, narration…"
                    className="h-7 w-full border border-slate-200 bg-white pl-7 pr-7 text-xs text-slate-700 placeholder-slate-400 focus:border-[#0B3B2E] focus:outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                      <FaTimes size={9} />
                    </button>
                  )}
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-7 border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-[#0B3B2E] focus:outline-none">
                  <option value="all">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="posted">Posted</option>
                  <option value="reversed">Reversed</option>
                </select>
                {(search || statusFilter !== "all") && (
                  <button onClick={() => { setSearch(""); setStatusFilter("all"); }} className="border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500 hover:bg-slate-50">
                    Clear
                  </button>
                )}
                <span className="ml-auto text-[10px] font-bold text-slate-400">
                  {journals.length.toLocaleString()} {journals.length === 1 ? "entry" : "entries"}
                </span>
              </div>

              <div className="flex-1 min-h-0 overflow-auto">
                {journalsLoading ? (
                  <div className="flex h-40 items-center justify-center">
                    <div className="h-6 w-6 animate-spin border-2 border-slate-200" style={{ borderTopColor: "#0B3B2E" }} />
                  </div>
                ) : journals.length === 0 ? (
                  <div className="flex h-52 flex-col items-center justify-center gap-3 text-slate-400">
                    <FaBook size={28} className="opacity-40" />
                    <p className="max-w-xs text-center text-xs leading-5">No Property Sale GL journals found for the selected period. Journals are posted automatically when sale transactions are processed.</p>
                  </div>
                ) : (
                  <table className="w-full min-w-[700px] border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0B3B2E]">
                        {["Journal #", "Date", "Debit Account", "Credit Account", "Amount (KES)", "Status"].map((col, i, arr) => (
                          <th key={col} className={`px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white whitespace-nowrap ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {journals.map((j, i) => (
                        <tr key={j._id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white hover:bg-[#F1F6F3]" : "bg-slate-50/60 hover:bg-[#F1F6F3]"}`}>
                          <td className="px-3 py-1.5 border-r border-slate-100 font-mono font-bold text-[#0B3B2E]">{j.journalNo || "—"}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap text-slate-600">{fmtDate(j.date)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700 max-w-[200px]">{j.debitAccount ? `${j.debitAccount.code} – ${j.debitAccount.name}` : "—"}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-slate-700 max-w-[200px]">{j.creditAccount ? `${j.creditAccount.code} – ${j.creditAccount.name}` : "—"}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono font-black text-slate-900 whitespace-nowrap">{fmt(j.amount)}</td>
                          <td className="px-3 py-1.5">
                            <span className={`border px-1.5 py-0.5 text-[9px] font-black uppercase ${STATUS_BADGE[j.status] || "border-slate-200 bg-slate-50 text-slate-500"}`}>
                              {j.status || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── Accounts tab ───────────────────────────────────────────────── */}
          {tab === "accounts" && (
            <div className="flex flex-col flex-1 min-h-0 border border-slate-200 bg-white m-2 shadow-sm">
              {!canViewAccounts ? (
                <div className="flex h-40 items-center justify-center">
                  <p className="text-xs text-slate-400">You do not have permission to view the chart of accounts.</p>
                </div>
              ) : accountsLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-6 w-6 animate-spin border-2 border-slate-200" style={{ borderTopColor: "#0B3B2E" }} />
                </div>
              ) : accounts.length === 0 ? (
                <div className="flex h-52 flex-col items-center justify-center gap-3 text-slate-400">
                  <FaLayerGroup size={28} className="opacity-40" />
                  <p className="max-w-xs text-center text-xs leading-5">No accounts found. Chart of accounts is provisioned automatically the first time it is initialised for this company.</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#0B3B2E]">
                        {["Code", "Account Name", "Type", "Sub-Group", "Balance (KES)", ""].map((col, i, arr) => (
                          <th key={i} className={`px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-white ${i < arr.length - 1 ? "border-r border-white/10" : ""}`}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((a, i) => (
                        <tr key={a._id} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white hover:bg-[#F1F6F3]" : "bg-slate-50/60 hover:bg-[#F1F6F3]"}`}>
                          <td className="px-3 py-1.5 border-r border-slate-100 font-mono font-bold text-slate-700">{a.code}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 font-semibold text-slate-900">{a.name}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className={`border px-1.5 py-0.5 text-[9px] font-bold uppercase ${ACCOUNT_TYPE_COLORS[a.type] || "border-slate-200 bg-slate-50 text-slate-600"}`}>
                              {a.type}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-slate-500">{a.subGroup || a.group || "—"}</td>
                          <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono font-black ${Number(a.balance || 0) < 0 ? "text-rose-600" : "text-slate-900"}`}>
                            {fmt(a.balance)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              onClick={() => navigate(`/sale/chart-of-accounts/${a._id}/activity`)}
                              className="inline-flex items-center gap-1 border border-[#B7C9C0] px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]"
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
    </PropertySaleShell>
  );
}
