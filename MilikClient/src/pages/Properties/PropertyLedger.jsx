import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDate } from "../../utils/dates";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  FaArrowLeft, FaArrowRight, FaBook, FaBuilding,
  FaFileAlt, FaFileInvoiceDollar, FaMoneyBillWave, FaWallet,
} from "react-icons/fa";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import PaginationBar from "../../components/PaginationBar";
import DashboardCard, { DashboardStatCard } from "../../components/Dashboard/DashboardCard";
import { getPropertyById } from "../../redux/propertyRedux";
import {
  getPropertyLedgerTrialBalance,
  getPropertyLedgerIncomeStatement,
  getPropertyLedgerBalanceSheet,
  getPropertyLedgerJournals,
} from "../../redux/apiCalls";
import { useTerm } from "../../hooks/useTerm";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const GRN = "#0B3B2E";

const fmt = (v) =>
  Number(v || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today     = () => new Date().toISOString().split("T")[0];
const firstOfMonth = () =>
  new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];

const isPropertyGL = (p) => {
  const v = String(p?.accountLedgerType || "").toLowerCase().trim();
  return v.startsWith("off") || v === "property-gl";
};

const businessIdFromState = (currentCompany, currentUser) => {
  const activeId   = localStorage.getItem("milik_active_company_id");
  const storedUser = (() => { try { return JSON.parse(localStorage.getItem("milik_user") || "null"); } catch { return null; } })();
  return (
    currentCompany?._id || currentUser?.company?._id || currentUser?.company ||
    currentUser?.businessId || activeId || storedUser?.company?._id ||
    storedUser?.company || storedUser?.businessId || ""
  );
};

const StatCard = DashboardStatCard;
const Card     = DashboardCard;

const Spinner = () => (
  <div className="flex justify-center items-center py-16">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0B3B2E] border-t-transparent" />
  </div>
);

const Empty = ({ text = "No data for this period." }) => (
  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
    <FaBook className="mb-3 text-4xl opacity-20" />
    <p className="text-xs font-semibold">{text}</p>
  </div>
);

const THead = ({ cols }) => (
  <thead>
    <tr style={{ backgroundColor: GRN }}>
      {cols.map((c, i) => (
        <th key={c.label || i} className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white ${c.right ? "text-right" : "text-left"}`}>
          {c.label}
        </th>
      ))}
    </tr>
  </thead>
);


// ─── Tab: Overview ────────────────────────────────────────────────────────────
const OverviewTab = ({ propertyId, property, navigate }) => {
  const termProperty  = useTerm("property");
  const termUnits     = useTerm("units");
  const termRent      = useTerm("rent");
  const termInvoices  = useTerm("invoices");
  const termReceipts  = useTerm("receipts");
  const termLandlord  = useTerm("landlord");
  const [loading, setLoading] = useState(true);
  const [data, setData]       = useState({ is: null, tb: null });

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const [isData, tbData] = await Promise.all([
          getPropertyLedgerIncomeStatement(propertyId, { startDate: firstOfMonth(), endDate: today() }),
          getPropertyLedgerTrialBalance(propertyId, { asOfDate: today() }),
        ]);
        if (active) setData({ is: isData, tb: tbData });
      } catch {
        // silently — empty state is fine for overview
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [propertyId]);

  const { is, tb } = data;
  const totalIncome   = is?.summary?.totalIncome   ?? is?.income?.total  ?? 0;
  const totalExpenses = is?.summary?.totalExpenses ?? is?.expenses?.total ?? 0;
  const netProfit     = is?.summary?.netProfit     ?? 0;
  const units         = property?.unitCount ?? "—";

  const receivablesRow = (tb?.rows || []).find((r) => {
    const name = String(r.name || "").toLowerCase();
    const type = String(r.accountType || "").toLowerCase();
    return name.includes("receivable") || type.includes("receivable");
  });
  const outstanding = receivablesRow ? (receivablesRow.debitBalance || receivablesRow.balance || 0) : null;

  // Navigate to existing pages pre-filtered by this property
  const navState = { fromPropertyLedger: true, propertyId, propertyName: property?.propertyName };

  const quickLinks = [
    {
      label: termInvoices,
      sub: `${termRent} charges & ${termInvoices.toLowerCase()}`,
      icon: FaFileInvoiceDollar,
      onClick: () => navigate("/invoices/rental", { state: navState }),
    },
    {
      label: termReceipts,
      sub: `${termRent} payments collected`,
      icon: FaMoneyBillWave,
      onClick: () => navigate("/receipts", { state: navState }),
    },
    {
      label: `${termLandlord} Statements`,
      sub: "Processed monthly statements",
      icon: FaFileAlt,
      onClick: () => navigate("/landlord/processed-statements", { state: navState }),
    },
  ];

  return (
    <div className="p-3 space-y-3">
      {/* ── KPI stat cards ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {[1,2,3,4].map((i) => <div key={i} className="h-16 animate-pulse bg-slate-100 border border-slate-200" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <StatCard label="This Month Income"   value={`KES ${fmt(totalIncome)}`}                                    icon={FaMoneyBillWave}     tone="green" />
          <StatCard label="This Month Expenses" value={`KES ${fmt(totalExpenses)}`}                                  icon={FaWallet}            tone="orange" />
          <StatCard label={outstanding != null ? "Receivables" : "Net Profit"}
                    value={`KES ${fmt(outstanding != null ? outstanding : netProfit)}`}
                    icon={FaFileInvoiceDollar}
                    tone={netProfit < 0 ? "orange" : "green"}
                    sub={outstanding != null ? "Outstanding" : (netProfit >= 0 ? "Profit" : "Loss")} />
          <StatCard label={termUnits}           value={units}                                                        icon={FaBuilding}          tone="green" sub={property?.propertyType || ""} />
        </div>
      )}

      {/* ── Quick access to existing pages ─────────────────────────────────── */}
      <Card title="Quick Access">
        <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {quickLinks.map((link) => (
            <button
              key={link.label}
              onClick={link.onClick}
              className="group flex items-center justify-between px-4 py-4 text-left hover:bg-[#EDF5F1] transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded bg-[#EDF5F1] text-[#0B3B2E] group-hover:bg-white">
                  <link.icon size={16} />
                </span>
                <div>
                  <p className="text-xs font-bold text-slate-800">{link.label}</p>
                  <p className="text-[10px] text-slate-400">{link.sub}</p>
                </div>
              </div>
              <FaArrowRight size={10} className="text-slate-300 group-hover:text-[#0B3B2E] transition-colors" />
            </button>
          ))}
        </div>
      </Card>

      {/* ── Property info strip ────────────────────────────────────────────── */}
      <Card title={`${termProperty} Info`}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-4 py-3 text-[11px] sm:grid-cols-4">
          {[
            { label: "Code",    value: property?.propertyCode },
            { label: "Type",    value: property?.propertyType },
            { label: "Location", value: property?.location || property?.address },
            { label: "Status",  value: property?.status },
          ].map(({ label, value }) => value ? (
            <div key={label}>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
              <p className="font-semibold text-slate-700">{value}</p>
            </div>
          ) : null)}
        </div>
      </Card>
    </div>
  );
};

// ─── Tab: Trial Balance ───────────────────────────────────────────────────────
const TrialBalanceTab = ({ propertyId, asOfDate }) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await getPropertyLedgerTrialBalance(propertyId, { asOfDate })); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed to load trial balance."); }
    finally { setLoading(false); }
  }, [propertyId, asOfDate]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;
  const rows = report?.rows || [];
  if (rows.length === 0) return <Empty />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <THead cols={[{ label: "Code" }, { label: "Account" }, { label: "Type" }, { label: "Debit Balance", right: true }, { label: "Credit Balance", right: true }]} />
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.code || row._id || i} className="border-b border-slate-50 hover:bg-slate-50/80">
              <td className="px-3 py-1.5 font-mono text-[9px] text-slate-400">{row.code}</td>
              <td className="px-3 py-1.5 text-slate-700">{row.name}</td>
              <td className="px-3 py-1.5 text-slate-500">{row.accountType}</td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-800">{row.debitBalance ? `KES ${fmt(row.debitBalance)}` : "—"}</td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-800">{row.creditBalance ? `KES ${fmt(row.creditBalance)}` : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ backgroundColor: GRN }}>
            <td colSpan={3} className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">Totals</td>
            <td className="px-3 py-2 text-right font-mono text-white">KES {fmt(report.totals?.debit)}</td>
            <td className="px-3 py-2 text-right font-mono text-white">KES {fmt(report.totals?.credit)}</td>
          </tr>
          <tr className={Math.abs(Number(report.totals?.difference || 0)) < 0.005 ? "bg-emerald-50" : "bg-red-50"}>
            <td colSpan={5} className={`px-3 py-1.5 text-[10px] font-bold ${Math.abs(Number(report.totals?.difference || 0)) < 0.005 ? "text-emerald-700" : "text-red-700"}`}>
              {Math.abs(Number(report.totals?.difference || 0)) < 0.005 ? "Balanced ✓" : `Out of balance — Diff: KES ${fmt(report.totals?.difference)}`}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ─── Tab: Income Statement ────────────────────────────────────────────────────
const IncomeStatementTab = ({ propertyId, startDate, endDate }) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await getPropertyLedgerIncomeStatement(propertyId, { startDate, endDate })); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed to load income statement."); }
    finally { setLoading(false); }
  }, [propertyId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;
  if (!report) return <Empty />;

  const { income, expenses, summary } = report;
  const incRows = (income?.sections  || []).flatMap((s) => s.accounts || []);
  const expRows = (expenses?.sections || []).flatMap((s) => s.accounts || []);
  const net     = summary?.netProfit ?? 0;

  const Section = ({ title, rows, total, th }) => (
    <table className="w-full text-[11px]">
      <thead><tr className={`border-b text-[10px] font-black uppercase tracking-widest ${th}`}>
        <th className="px-3 py-1.5 text-left w-12">Code</th>
        <th className="px-3 py-1.5 text-left">{title}</th>
        <th className="px-3 py-1.5 text-right">Amount</th>
      </tr></thead>
      <tbody>
        {rows.length === 0
          ? <tr><td colSpan={3} className="px-3 py-3 text-center text-xs text-slate-400">No entries</td></tr>
          : rows.map((r, i) => (
            <tr key={r.code || r._id || i} className="border-b border-slate-50 hover:bg-slate-50/80">
              <td className="px-3 py-1.5 font-mono text-[9px] text-slate-400">{r.code}</td>
              <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-800">KES {fmt(r.amount)}</td>
            </tr>
          ))}
      </tbody>
      <tfoot><tr className="border-t border-slate-200 bg-slate-50">
        <td colSpan={2} className="px-3 py-1.5 text-[10px] font-bold text-slate-600">Total {title}</td>
        <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-900">KES {fmt(total)}</td>
      </tr></tfoot>
    </table>
  );

  return (
    <div>
      <Section title="Income"   rows={incRows} total={income?.total   || 0} th="text-emerald-700 border-emerald-100 bg-emerald-50/50" />
      <Section title="Expenses" rows={expRows} total={expenses?.total || 0} th="text-red-700 border-red-100 bg-red-50/50" />
      <div className={`flex items-center justify-between border-t-2 px-4 py-3 ${net >= 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
        <span className={`font-bold ${net >= 0 ? "text-emerald-800" : "text-red-800"}`}>{summary?.resultLabel || "Net Profit"}</span>
        <span className={`font-mono font-bold ${net >= 0 ? "text-emerald-800" : "text-red-800"}`}>KES {fmt(net)}</span>
      </div>
    </div>
  );
};

// ─── Tab: Balance Sheet ───────────────────────────────────────────────────────
const BalanceSheetTab = ({ propertyId, asOfDate }) => {
  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await getPropertyLedgerBalanceSheet(propertyId, { asOfDate })); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed to load balance sheet."); }
    finally { setLoading(false); }
  }, [propertyId, asOfDate]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;
  if (!report) return <Empty />;

  const { assets, liabilities, equity, summary } = report;
  const balanced = summary?.balanced ?? Math.abs(Number(summary?.difference || 0)) < 0.005;

  const Section = ({ title, rows, total, th }) => (
    <table className="w-full text-[11px]">
      <thead><tr className={`border-b text-[10px] font-black uppercase tracking-widest ${th}`}>
        <th className="px-3 py-1.5 text-left w-12">Code</th>
        <th className="px-3 py-1.5 text-left">{title}</th>
        <th className="px-3 py-1.5 text-right">Amount</th>
      </tr></thead>
      <tbody>
        {rows.length === 0
          ? <tr><td colSpan={3} className="px-3 py-3 text-center text-xs text-slate-400">No entries</td></tr>
          : rows.map((r, i) => (
            <tr key={r.code || r._id || i} className="border-b border-slate-50 hover:bg-slate-50/80">
              <td className="px-3 py-1.5 font-mono text-[9px] text-slate-400">{r.code}</td>
              <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
              <td className="px-3 py-1.5 text-right font-mono text-slate-800">KES {fmt(r.amount)}</td>
            </tr>
          ))}
      </tbody>
      <tfoot><tr className="border-t border-slate-200 bg-slate-50">
        <td colSpan={2} className="px-3 py-1.5 text-[10px] font-bold text-slate-600">Total {title}</td>
        <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-900">KES {fmt(total)}</td>
      </tr></tfoot>
    </table>
  );

  return (
    <div>
      <Section title="Assets"      rows={(assets?.sections     || []).flatMap((s) => s.accounts || [])} total={assets?.total      || 0} th="text-sky-700 border-sky-100 bg-sky-50/50" />
      <Section title="Liabilities" rows={(liabilities?.sections || []).flatMap((s) => s.accounts || [])} total={liabilities?.total || 0} th="text-orange-700 border-orange-100 bg-orange-50/50" />
      <Section title="Equity"      rows={(equity?.sections      || []).flatMap((s) => s.accounts || [])} total={equity?.total      || 0} th="text-purple-700 border-purple-100 bg-purple-50/50" />
      <div className={`flex items-center justify-between border-t-2 px-4 py-3 ${balanced ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
        <span className={`font-bold ${balanced ? "text-emerald-800" : "text-red-800"}`}>
          {balanced ? "Balance Sheet Balanced ✓" : "Out of Balance ✗"}
        </span>
        {!balanced && <span className="font-mono font-bold text-red-800">Diff: KES {fmt(summary?.difference)}</span>}
      </div>
    </div>
  );
};

// ─── Tab: Journal Entries ─────────────────────────────────────────────────────
const JournalsTab = ({ propertyId, startDate, endDate }) => {
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState([]);
  const [total, setTotal]     = useState(0);
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPropertyLedgerJournals(propertyId, { startDate, endDate, page, limit: pageSize });
      setEntries(data.data || []);
      setTotal(data.total || 0);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load journal entries.");
    } finally {
      setLoading(false);
    }
  }, [propertyId, startDate, endDate, page, pageSize]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [startDate, endDate]);

  if (loading) return <Spinner />;
  if (entries.length === 0) return <Empty />;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <THead cols={[{ label: "Date" }, { label: "Account" }, { label: "Narration" }, { label: "Debit", right: true }, { label: "Credit", right: true }]} />
          <tbody>
            {entries.map((entry, i) =>
              (entry.lines || []).map((line, li) => (
                <tr key={`${entry._id || i}-${li}`} className={`border-b border-slate-50 hover:bg-slate-50/80 ${li === 0 && i > 0 ? "border-t border-slate-100" : ""}`}>
                  <td className="px-3 py-1.5 text-slate-500">{li === 0 ? fmtDate(entry.date) : ""}</td>
                  <td className="px-3 py-1.5 text-slate-700">
                    <span className="mr-1.5 font-mono text-[9px] text-slate-400">{line.account?.code}</span>
                    {line.account?.name}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500">{li === 0 ? entry.narration : ""}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-800">{line.debit  ? `KES ${fmt(line.debit)}`  : "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-800">{line.credit ? `KES ${fmt(line.credit)}` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar
        page={page}
        pages={pages}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        loading={loading}
        label="journal entries"
      />
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────
const EMBEDDED_TABS = [
  { key: "overview",         label: "Overview" },
  { key: "trial-balance",    label: "Trial Balance" },
  { key: "income-statement", label: "Income Statement" },
  { key: "balance-sheet",    label: "Balance Sheet" },
  { key: "journals",         label: "Journals" },
];

const PropertyLedger = () => {
  const termProperty   = useTerm("property");
  const termProperties = useTerm("properties");
  const termInvoices   = useTerm("invoices");
  const termReceipts   = useTerm("receipts");
  const { id }      = useParams();
  const dispatch    = useDispatch();
  const navigate    = useNavigate();
  const location    = useLocation();
  const currentUser    = useSelector((s) => s.auth?.currentUser);
  const currentCompany = useSelector((s) => s.company?.currentCompany);
  const { currentProperty, loading: propLoading } = useSelector((s) => s.property);

  const [activeTab, setActiveTab] = useTabState(`${location.pathname}:activeTab`, "overview");
  const [dates, setDates] = useTabState(`${location.pathname}:dates`, () => ({ startDate: firstOfMonth(), endDate: today(), asOfDate: today() }));

  useEffect(() => { dispatch(getPropertyById(id)); }, [dispatch, id]);

  const property    = currentProperty?._id === id ? currentProperty : null;
  const notGl       = property && !isPropertyGL(property);
  const notEnabled  = property && isPropertyGL(property) && !property.propertyLedgerEnabled;

  if (propLoading) return <DashboardLayout><Spinner /></DashboardLayout>;

  if (!property) return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p className="text-sm">{termProperty} not found.</p>
        <button onClick={() => navigate("/properties")} className="mt-3 text-sm text-[#0B3B2E] hover:underline">Back to {termProperties}</button>
      </div>
    </DashboardLayout>
  );

  if (notGl) return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <FaBook className="mb-4 text-5xl opacity-20" />
        <p className="text-sm font-medium">This {termProperty.toLowerCase()} does not use {termProperty} GL.</p>
        <p className="mt-1 text-xs">Switch Account Ledger Type to "{termProperty} GL" in {termProperty.toLowerCase()} settings to activate an isolated ledger.</p>
        <Link to="/properties" className="mt-4 text-sm text-[#0B3B2E] hover:underline">Back to {termProperties}</Link>
      </div>
    </DashboardLayout>
  );

  if (notEnabled) return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <FaBook className="mb-4 text-5xl opacity-20" />
        <p className="text-sm font-medium">{termProperty} GL is configured but not yet enabled for this {termProperty.toLowerCase()}.</p>
        <p className="mt-1 text-xs">Enable "{termProperty} Ledger" in {termProperty.toLowerCase()} settings to start posting entries here.</p>
        <Link to={`/properties/edit/${id}`} className="mt-4 text-sm text-[#0B3B2E] hover:underline">Open {termProperty} Settings</Link>
      </div>
    </DashboardLayout>
  );

  const navState    = { fromPropertyLedger: true, propertyId: id, propertyName: property.propertyName };
  const isPointInTime = activeTab === "trial-balance" || activeTab === "balance-sheet";

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => navigate("/properties")} className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-800">
              <FaArrowLeft className="text-[10px]" /> {termProperties}
            </button>
            <span className="text-slate-300">/</span>
            <Link to={`/properties/${id}`} className="text-[11px] text-slate-500 hover:text-slate-800">
              {property.propertyCode} — {property.propertyName}
            </Link>
            <span className="text-slate-300">/</span>
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[#0B3B2E]">
              <FaBook className="text-[10px]" /> {termProperty} Ledger
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-[#0B3B2E]">
              {termProperty} GL — Ledger Active
            </span>
          </div>
          <h1 className="mt-1 text-sm font-black text-slate-800">
            {property.propertyName}
            <span className="ml-2 text-xs font-normal text-slate-400">{property.propertyCode}</span>
          </h1>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-slate-200 bg-white">
          <div className="flex items-end justify-between overflow-x-auto px-2">
            <div className="flex min-w-max gap-0">
              {/* Embedded tabs */}
              {EMBEDDED_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`border-b-2 px-3 py-2.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    activeTab === tab.key
                      ? "border-[#0B3B2E] text-[#0B3B2E]"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}

              {/* Separator */}
              <div className="mx-1 mb-2 self-end h-5 w-px bg-slate-200" />

              {/* Navigate-out tabs */}
              {[
                { label: termInvoices,  path: "/invoices/rental" },
                { label: termReceipts,  path: "/receipts" },
                { label: "Statements",  path: "/landlord/processed-statements" },
              ].map(({ label, path }) => (
                <button
                  key={label}
                  onClick={() => navigate(path, { state: navState })}
                  className="flex items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-[11px] font-semibold whitespace-nowrap text-slate-500 hover:text-[#0B3B2E] transition-colors"
                >
                  {label}
                  <FaArrowRight size={8} className="opacity-50" />
                </button>
              ))}
            </div>

            {/* Date filters */}
            {activeTab !== "overview" && (
              <div className="flex shrink-0 items-center gap-2 pb-2 pl-4">
                {isPointInTime ? (
                  <>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">As of</label>
                    <input type="date" value={dates.asOfDate}
                      onChange={(e) => setDates((d) => ({ ...d, asOfDate: e.target.value }))}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] focus:border-[#0B3B2E] focus:outline-none" />
                  </>
                ) : (
                  <>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">From</label>
                    <input type="date" value={dates.startDate}
                      onChange={(e) => setDates((d) => ({ ...d, startDate: e.target.value }))}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] focus:border-[#0B3B2E] focus:outline-none" />
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">To</label>
                    <input type="date" value={dates.endDate}
                      onChange={(e) => setDates((d) => ({ ...d, endDate: e.target.value }))}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] focus:border-[#0B3B2E] focus:outline-none" />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          {activeTab === "overview"         && <OverviewTab        propertyId={id} property={property} navigate={navigate} />}
          {activeTab === "trial-balance"    && <TrialBalanceTab    propertyId={id} asOfDate={dates.asOfDate} />}
          {activeTab === "income-statement" && <IncomeStatementTab propertyId={id} startDate={dates.startDate} endDate={dates.endDate} />}
          {activeTab === "balance-sheet"    && <BalanceSheetTab    propertyId={id} asOfDate={dates.asOfDate} />}
          {activeTab === "journals"         && <JournalsTab        propertyId={id} startDate={dates.startDate} endDate={dates.endDate} />}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PropertyLedger;
