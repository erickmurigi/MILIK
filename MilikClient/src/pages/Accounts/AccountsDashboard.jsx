import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaBalanceScale, FaBook, FaCalculator, FaChartLine,
  FaCreditCard, FaFileAlt, FaLayerGroup, FaWallet,
  FaFileInvoice, FaCog,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getJournalEntries, getChartOfAccounts } from "../../redux/apiCalls";

// ─── Static quick-nav tiles ───────────────────────────────────────────────────
const QUICK_NAV = [
  { label: "Chart of Accounts", icon: FaLayerGroup, route: "/accounts/chart-of-accounts", color: "#0B3B2E", desc: "Manage your GL account structure" },
  { label: "Journal Entries",   icon: FaBook,       route: "/accounts/journals",           color: "#0B3B2E", desc: "All journals across every module" },
  { label: "Payment Vouchers",  icon: FaCreditCard, route: "/accounts/payment-vouchers",   color: "#b45309", desc: "Outgoing payment documentation" },
  { label: "Petty Cash",        icon: FaWallet,     route: "/accounts/petty-cash",         color: "#b45309", desc: "Petty cash disbursements" },
  { label: "Expense Requisitions", icon: FaFileInvoice, route: "/accounts/expenses",      color: "#b45309", desc: "Expense requests & approvals" },
  { label: "Service Providers", icon: FaCog,        route: "/accounts/service-providers",  color: "#b45309", desc: "Vendor & supplier register" },
  { label: "Trial Balance",     icon: FaBook,       route: "/accounts/trial-balance",      color: "#0f766e", desc: "Debit / credit balance check" },
  { label: "Income Statement",  icon: FaChartLine,  route: "/accounts/income-statement",   color: "#0f766e", desc: "Revenue vs. expense (P&L)" },
  { label: "Balance Sheet",     icon: FaBalanceScale, route: "/accounts/balance-sheet",    color: "#0f766e", desc: "Assets, liabilities & equity" },
  { label: "Tax Reports",       icon: FaCalculator, route: "/accounts/tax-reports",        color: "#0f766e", desc: "VAT, withholding & statutory" },
];

const AccountsDashboard = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const [stats, setStats] = useState({ accounts: null, draftJournals: null, postedJournals: null });
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!currentCompany?._id || fetchedRef.current) return;
    fetchedRef.current = true;

    const businessId = currentCompany._id;
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const endDate = now.toISOString().split("T")[0];

    Promise.all([
      getChartOfAccounts({ business: businessId }),
      getJournalEntries({ business: businessId, company: businessId, status: "draft",  startDate, endDate }),
      getJournalEntries({ business: businessId, company: businessId, status: "posted", startDate, endDate }),
    ])
      .then(([coa, drafts, posted]) => {
        setStats({
          accounts:      Array.isArray(coa)    ? coa.length    : 0,
          draftJournals: Array.isArray(drafts)  ? drafts.length  : 0,
          postedJournals:Array.isArray(posted)  ? posted.length  : 0,
        });
      })
      .catch(() => {});
  }, [currentCompany?._id]);

  const companyName = String(currentCompany?.companyName || currentCompany?.name || "").trim();

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-6xl px-4 py-6">

        {/* Header */}
        <div className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#0B3B2E]">Financial Accounts</p>
          <h1 className="mt-0.5 text-2xl font-black text-slate-800">
            {companyName || "Accounting Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Unified general ledger across all modules — one chart of accounts, one source of truth.
          </p>
        </div>

        {/* Stats row */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[
            { label: "GL Accounts",       value: stats.accounts,       sub: "in chart of accounts" },
            { label: "Draft Journals",    value: stats.draftJournals,  sub: "this month, unposted" },
            { label: "Posted Journals",   value: stats.postedJournals, sub: "this month" },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
              <p className="mt-1 text-3xl font-black text-slate-800">
                {value === null ? <span className="text-lg text-slate-300">—</span> : value}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
            </div>
          ))}
        </div>

        {/* Quick nav grid */}
        <p className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Quick Access</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {QUICK_NAV.map(({ label, icon: Icon, route, color, desc }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="group flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md active:scale-[0.98]"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: color }}
              >
                <Icon size={16} />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-800 group-hover:text-[#0B3B2E]">{label}</p>
                <p className="mt-0.5 text-xs leading-snug text-slate-400">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AccountsDashboard;
