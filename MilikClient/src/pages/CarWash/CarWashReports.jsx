import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { FaExternalLinkAlt, FaPrint, FaRedoAlt, FaSearch } from "react-icons/fa";
import { carWashApi, formatMoney, getActiveBranchId, normalizeListPayload, todayISO } from "../../services/carWashApi";
import { selectCurrentCompany } from "../../redux/selectors";
import CarWashShell from "./CarWashShell";

// ── module-level constants ──────────────────────────────────────────────────
const statusLabels = { waiting: "Waiting", washing: "Washing", done: "Done", paid: "Paid", cancelled: "Cancelled" };
const paymentLabels = { cash: "Cash", mpesa: "M-Pesa", bank: "Bank", card: "Card", other: "Other" };
const reportStatuses = ["waiting", "washing", "done", "paid", "cancelled"];
const paymentMethods = ["cash", "mpesa", "bank", "card", "other"];

const MODES = [
  { key: "daily",   label: "Daily" },
  { key: "weekly",  label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "custom",  label: "Custom Range" },
];

const monthISO = () => new Date().toISOString().slice(0, 7);

const weekRange = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  const monday = new Date(d);
  monday.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
};

const monthRange = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { start: `${monthStr}-01`, end: `${monthStr}-${String(lastDay).padStart(2, "0")}` };
};

const buildExpenseParams = (applied) => {
  const { mode, date, month, fromDate, toDate, branch } = applied;
  const base = branch ? { branch } : {};
  if (mode === "daily")  return { ...base, date, limit: 50, page: 1 };
  if (mode === "custom") return { ...base, startDate: fromDate, endDate: toDate, limit: 1, page: 1 };
  if (mode === "weekly") {
    const r = weekRange(date);
    return { ...base, startDate: r.start, endDate: r.end, limit: 1, page: 1 };
  }
  const r = monthRange(month);
  return { ...base, startDate: r.start, endDate: r.end, limit: 1, page: 1 };
};

const formatTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
};

const pct = (part, total) => (total ? `${Math.round((part / total) * 100)}%` : "0%");

// ── sub-components ──────────────────────────────────────────────────────────
const ReportTable = ({ title, right, children, minWidth = "100%", className = "" }) => (
  <section className={`overflow-x-auto border border-slate-200 bg-white shadow-sm ${className}`}>
    <div className="flex min-h-8 items-center justify-between border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5">
      <h2 className="text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">{title}</h2>
      {right}
    </div>
    <table className="w-full text-xs" style={{ minWidth }}>
      {children}
    </table>
  </section>
);

const Th = ({ children, right }) => (
  <th className={`px-2 py-1.5 font-bold uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>{children}</th>
);

const EmptyRow = ({ colSpan, text }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-8 text-center text-xs font-semibold text-slate-500">{text}</td>
  </tr>
);

const NavBtn = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase text-[#0B3B2E] hover:text-[#FF8C00]">
    <FaExternalLinkAlt />{children}
  </button>
);

// ── main component ──────────────────────────────────────────────────────────
const CarWashReports = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const today = todayISO();

  // draft filters (controlled inputs, not yet applied)
  const [mode, setMode] = useState("daily");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(monthISO());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [branch, setBranch] = useState(() => getActiveBranchId() || "");

  // committed filters (trigger data load)
  const [applied, setApplied] = useTabState("/carwash/reports:applied", () => ({
    mode: "daily", date: today, month: monthISO(), fromDate: today, toDate: today, branch: getActiveBranchId() || "",
  }));

  // data
  const [branches, setBranches] = useState([]);
  const [summary, setSummary] = useState(null);
  const [customService, setCustomService] = useState(null);
  const [customStaff, setCustomStaff] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenseList, setExpenseList] = useState([]);
  const [expenseSummary, setExpenseSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  // load branches once
  useEffect(() => {
    carWashApi.listBranches().then((data) => setBranches(data?.branches || data || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = applied;
      const eParams = buildExpenseParams(a);
      const branchFilter = a.branch ? { branch: a.branch } : {};

      if (a.mode === "daily") {
        const [sumPayload, jobsPayload, paymentsPayload, expPayload] = await Promise.all([
          carWashApi.getDailySummary(a.date),
          carWashApi.listJobs({ date: a.date, limit: 50, page: 1, ...branchFilter }),
          carWashApi.listPayments({ date: a.date, limit: 50, page: 1, ...branchFilter }),
          carWashApi.listExpenses(eParams),
        ]);
        setSummary(sumPayload || null);
        setJobs(normalizeListPayload(jobsPayload, "jobs"));
        setPayments(normalizeListPayload(paymentsPayload, "payments"));
        setExpenseList(normalizeListPayload(expPayload, "expenses"));
        setExpenseSummary(expPayload?.summary || null);
        setCustomService(null);
        setCustomStaff(null);
        return;
      }

      if (a.mode === "custom") {
        const [svcPayload, staffPayload, expPayload] = await Promise.all([
          carWashApi.getServiceReport({ from: a.fromDate, to: a.toDate, ...branchFilter }),
          carWashApi.getStaffReport({ from: a.fromDate, to: a.toDate, ...branchFilter }),
          carWashApi.listExpenses(eParams),
        ]);
        setSummary(null);
        setJobs([]);
        setPayments([]);
        setExpenseList([]);
        setCustomService(svcPayload || null);
        setCustomStaff(staffPayload || null);
        setExpenseSummary(expPayload?.summary || null);
        return;
      }

      // weekly / monthly
      const [sumPayload, expPayload] = await Promise.all([
        a.mode === "weekly" ? carWashApi.getWeeklySummary(a.date) : carWashApi.getMonthlySummary(a.month),
        carWashApi.listExpenses(eParams),
      ]);
      setSummary(sumPayload || null);
      setJobs([]);
      setPayments([]);
      setExpenseList([]);
      setCustomService(null);
      setCustomStaff(null);
      setExpenseSummary(expPayload?.summary || null);
    } catch {
      setSummary(null);
      setExpenseSummary(null);
      setJobs([]);
      setPayments([]);
      setExpenseList([]);
      setCustomService(null);
      setCustomStaff(null);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => { load(); }, [load]);

  // ── derived from main summary (daily/weekly/monthly) ──────────────────────
  const period = summary?.period || {};
  const counts = summary?.statusCounts || {};
  const totalRevenue = Number(summary?.totalRevenue ?? summary?.todayRevenue ?? 0);
  const totalExpenses = Number(summary?.totalExpenses || 0);
  const pendingExpenses = Number(summary?.pendingExpenses || 0);
  const pendingExpenseCount = Number(summary?.pendingExpenseCount || 0);
  const netPosition = Number(summary?.netPosition ?? totalRevenue - totalExpenses);
  const jobsCount = Number(summary?.jobsCount || 0);
  const paymentCount = Number(summary?.paymentCount || 0);
  const cashTotal = Number(summary?.cashTotal || 0);
  const mpesaTotal = Number(summary?.mpesaTotal || 0);
  const nonCashTotal = Number(summary?.nonCashTotal ?? Math.max(totalRevenue - cashTotal, 0));
  const openJobs = Number(summary?.openJobs ?? Number(counts.waiting || 0) + Number(counts.washing || 0) + Number(counts.done || 0));
  const averageJobValue = Number(summary?.averageJobValue ?? (jobsCount ? totalRevenue / jobsCount : 0));
  const trendRows = summary?.trendRows || [];
  const serviceRows = summary?.serviceRows || [];
  const staffRows = summary?.staffRows || [];

  const revenueByMethod = summary?.revenueByMethod || {};
  const methodRows = useMemo(
    () => paymentMethods.map((key) => ({ key, label: paymentLabels[key], amount: Number(revenueByMethod[key] || 0) })),
    [revenueByMethod]
  );

  const opsRows = useMemo(() => [
    ["Total Jobs",       jobsCount,                                           "All jobs created in the report period"],
    ["Paid Jobs",        counts.paid || 0,                                    "Jobs completed and paid"],
    ["Open Jobs",        openJobs,                                            "Waiting, washing or done but not paid"],
    ["Cancelled",        counts.cancelled || 0,                               "Jobs removed from the active flow"],
    ["Avg Job Value",    formatMoney(averageJobValue),                        "Revenue divided by total jobs"],
    ["Paid Expenses",    formatMoney(totalExpenses),                          "Expenses already settled from a cashbook"],
    ["Pending Expenses", `${pendingExpenseCount} / ${formatMoney(pendingExpenses)}`, "Draft or approved costs not yet paid"],
    ["Net Position",     formatMoney(netPosition),                            "Revenue minus paid expenses"],
  ], [jobsCount, counts.paid, counts.cancelled, openJobs, averageJobValue, totalExpenses, pendingExpenseCount, pendingExpenses, netPosition]);

  const cashRows = useMemo(() => [
    ["Cash Drawer",       formatMoney(cashTotal),      "Physical cash expected in drawer"],
    ["Non-Cash",          formatMoney(nonCashTotal),   "M-Pesa, bank, card and other"],
    ["Total Collections", formatMoney(totalRevenue),   "All payments received"],
    ["Payment Count",     paymentCount,                "Number of payments recorded"],
  ], [cashTotal, nonCashTotal, totalRevenue, paymentCount]);

  // ── derived from custom service/staff reports ─────────────────────────────
  const customServiceRows = useMemo(() => customService?.rows || [], [customService]);
  const customStaffRows = useMemo(() => customStaff?.rows || [], [customStaff]);

  const customRevenue = useMemo(
    () => customService?.totalRevenue ?? customServiceRows.reduce((s, r) => s + Number(r.revenue || 0), 0),
    [customService, customServiceRows]
  );
  const customJobs = useMemo(
    () => customService?.totalJobs ?? customServiceRows.reduce((s, r) => s + Number(r.jobs || 0), 0),
    [customService, customServiceRows]
  );

  // ── derived from expense summary ──────────────────────────────────────────
  const expCategoryRows = useMemo(() => expenseSummary?.byCategory || [], [expenseSummary]);

  // byMethod is { cash: { amount, count }, mpesa: { amount, count }, ... }
  const expMethodRows = useMemo(() => {
    const bm = expenseSummary?.byMethod || {};
    return Object.entries(bm).map(([key, val]) => ({
      key,
      label: paymentLabels[key] || key,
      amount: Number(val?.amount || 0),
      count: Number(val?.count || 0),
    }));
  }, [expenseSummary]);

  const expPaidAmt    = Number(expenseSummary?.paid?.amount || 0);
  const expPaidCount  = Number(expenseSummary?.paid?.count || 0);
  const expAppAmt     = Number(expenseSummary?.approved?.amount || 0);
  const expAppCount   = Number(expenseSummary?.approved?.count || 0);
  const expDraftAmt   = Number(expenseSummary?.draft?.amount || 0);
  const expDraftCount = Number(expenseSummary?.draft?.count || 0);
  const expTotalAmt   = Number(expenseSummary?.totalAmount || expPaidAmt + expAppAmt + expDraftAmt);
  const expTotalCount = Number(expenseSummary?.totalCount || expPaidCount + expAppCount + expDraftCount);

  // ── period label ──────────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    const a = applied;
    if (a.mode === "custom")  return `${a.fromDate} to ${a.toDate}`;
    if (a.mode === "daily")   return a.date;
    if (a.mode === "monthly") return period.start && period.end ? `${period.start} to ${period.end}` : a.month;
    return period.start && period.end ? `${period.start} to ${period.end}` : a.date;
  }, [applied, period]);

  const modeLabel = MODES.find((m) => m.key === applied.mode)?.label || "Daily";

  const handlePrint = useCallback(() => {
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) return;
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString()}`;
    const isCustom = applied.mode === 'custom';
    win.document.write(`<!DOCTYPE html><html><head><title>Car Wash Report</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:12px;font-weight:900;color:#0f172a;margin-top:3px}
      h3{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;font-weight:900;margin:12px 0 5px}
      table{width:100%;border-collapse:collapse;font-size:9px;margin-bottom:10px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Car Wash ${modeLabel} Report</div><div class="sub">Period: ${periodLabel}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Total Revenue</div><div class="cv" style="color:#0B3B2E">${fmt(isCustom ? customRevenue : totalRevenue)}</div></div>
      <div class="card"><div class="cl">Total Jobs</div><div class="cv">${isCustom ? customJobs : jobsCount}</div></div>
      <div class="card"><div class="cl">Paid Expenses</div><div class="cv" style="color:#c2410c">${fmt(totalExpenses)}</div></div>
      <div class="card"><div class="cl">Net Position</div><div class="cv" style="color:${netPosition >= 0 ? '#047857' : '#b91c1c'}">${fmt(netPosition)}</div></div>
    </div>
    ${!isCustom && opsRows.length > 0 ? `<h3>Operations Position</h3><table><thead><tr><th>Metric</th><th class="r">Value</th><th>Notes</th></tr></thead><tbody>${opsRows.map(([l, v, n]) => `<tr><td>${l}</td><td class="r"><strong>${v}</strong></td><td>${n}</td></tr>`).join('')}</tbody></table>` : ''}
    ${!isCustom && serviceRows.length > 0 ? `<h3>By Service</h3><table><thead><tr><th>Service</th><th class="r">Jobs</th><th class="r">Revenue</th></tr></thead><tbody>${serviceRows.map((r) => `<tr><td>${r.serviceType || r.name || '—'}</td><td class="r">${r.jobs || r.count || 0}</td><td class="r">${fmt(r.revenue || r.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${isCustom && customServiceRows.length > 0 ? `<h3>By Service</h3><table><thead><tr><th>Service</th><th class="r">Jobs</th><th class="r">Revenue</th></tr></thead><tbody>${customServiceRows.map((r) => `<tr><td>${r.serviceType || r.name || '—'}</td><td class="r">${r.jobs || 0}</td><td class="r">${fmt(r.revenue)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${isCustom && customStaffRows.length > 0 ? `<h3>By Staff</h3><table><thead><tr><th>Staff</th><th class="r">Jobs</th><th class="r">Revenue</th><th class="r">Commission</th></tr></thead><tbody>${customStaffRows.map((r) => `<tr><td>${r.staff}</td><td class="r">${r.jobs}</td><td class="r">${fmt(r.revenue)}</td><td class="r">${fmt(r.commission)}</td></tr>`).join('')}</tbody></table>` : ''}
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [currentCompany, applied, modeLabel, periodLabel, totalRevenue, totalExpenses, netPosition, jobsCount, customRevenue, customJobs, opsRows, serviceRows, customServiceRows, customStaffRows]);

  const submit = (event) => {
    event.preventDefault();
    setApplied({ mode, date, month, fromDate, toDate, branch });
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setApplied((prev) => ({ ...prev, mode: nextMode }));
  };

  return (
    <CarWashShell
      title={`${modeLabel} Reports`}
      action={
        <>
          <button type="button" onClick={load} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaRedoAlt className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button type="button" onClick={handlePrint} className="inline-flex h-8 items-center gap-1.5 border border-[#B7C9C0] bg-white px-2.5 text-xs font-bold text-[#0B3B2E] hover:bg-[#F1F6F3]">
            <FaPrint />
            Print
          </button>
        </>
      }
    >
      {/* ── FILTER BAR ─────────────────────────────────────────────────────── */}
      <form onSubmit={submit} className="mb-2 flex flex-wrap items-end gap-2 border border-slate-200 bg-white p-2 shadow-sm">
        {/* mode toggle */}
        <div className="flex h-8 border border-[#B7C9C0] bg-[#F1F6F3]">
          {MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => changeMode(item.key)}
              className={`h-full px-3 text-xs font-extrabold uppercase ${mode === item.key ? "bg-[#0B3B2E] text-white" : "text-[#0B3B2E] hover:bg-white"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* date controls — vary by mode */}
        {mode === "monthly" && (
          <input
            type="month"
            className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        )}
        {(mode === "daily" || mode === "weekly") && (
          <input
            type="date"
            className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        )}
        {mode === "custom" && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase">From</span>
            <input
              type="date"
              className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <span className="text-[11px] font-bold text-slate-500 uppercase">To</span>
            <input
              type="date"
              min={fromDate}
              className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        )}

        {/* branch filter */}
        {branches.length > 0 && (
          <select
            className="h-8 border border-slate-300 px-2 text-xs font-semibold text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        )}

        <button type="submit" className="inline-flex h-8 items-center gap-1.5 bg-[#FF8C00] px-4 text-xs font-bold text-white hover:bg-[#E67E00]">
          <FaSearch />
          Search
        </button>
      </form>

      {/* ── SUMMARY BAR ────────────────────────────────────────────────────── */}
      <div className="mb-2 overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-8 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-200 bg-[#EDF5F1] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span>Period: <strong className="text-slate-900">{periodLabel}</strong></span>
          {applied.mode === "custom" ? (
            <>
              <span>Jobs: <strong className="text-[#0B3B2E]">{customJobs}</strong></span>
              <span>Revenue: <strong className="text-[#0B3B2E]">{formatMoney(customRevenue)}</strong></span>
              {customStaff?.totalCommission > 0 && (
                <span>Commission: <strong className="text-amber-700">{formatMoney(customStaff.totalCommission)}</strong></span>
              )}
            </>
          ) : (
            <>
              {!applied.branch && <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold normal-case text-slate-500 tracking-normal">All Branches</span>}
              <span>Jobs: <strong className="text-[#0B3B2E]">{jobsCount}</strong></span>
              <span>Revenue: <strong className="text-[#0B3B2E]">{formatMoney(totalRevenue)}</strong></span>
              <span>Paid Expenses: <strong className="text-[#FF8C00]">{formatMoney(totalExpenses)}</strong></span>
              <span>Pending: <strong className="text-cyan-700">{formatMoney(pendingExpenses)}</strong></span>
              <span>Net: <strong className={netPosition >= 0 ? "text-[#0B3B2E]" : "text-red-700"}>{formatMoney(netPosition)}</strong></span>
              <span>Cash: <strong className="text-[#0B3B2E]">{formatMoney(cashTotal)}</strong></span>
              <span>M-Pesa: <strong className="text-[#0B3B2E]">{formatMoney(mpesaTotal)}</strong></span>
              <span>Open Jobs: <strong className="text-[#FF8C00]">{openJobs}</strong></span>
            </>
          )}
        </div>
      </div>

      {/* ── OPS POSITION + CASH CONTROL (daily / weekly / monthly) ─────────── */}
      {applied.mode !== "custom" && (
        <div className="grid gap-2 grid-cols-1 xl:grid-cols-[0.95fr_1.05fr]">
          <ReportTable title="Operations Position">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Metric</Th><Th right>Value</Th><Th>Control Note</Th></tr>
            </thead>
            <tbody>
              {opsRows.map(([label, value, note]) => (
                <tr key={label} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{label}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{value}</td>
                  <td className="px-2 py-1 text-slate-500">{note}</td>
                </tr>
              ))}
            </tbody>
          </ReportTable>

          <ReportTable title="Cash Control">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Control</Th><Th right>Amount</Th><Th>Meaning</Th></tr>
            </thead>
            <tbody>
              {cashRows.map(([label, value, note]) => (
                <tr key={label} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{label}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{value}</td>
                  <td className="px-2 py-1 text-slate-500">{note}</td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </div>
      )}

      {/* ── JOB STATUS + REVENUE BY METHOD (daily / weekly / monthly) ───────── */}
      {applied.mode !== "custom" && (
        <div className="mt-2 grid gap-2 grid-cols-1 xl:grid-cols-2">
          <ReportTable title="Job Status Breakdown">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Status</Th><Th right>Count</Th><Th right>% of Jobs</Th></tr>
            </thead>
            <tbody>
              {reportStatuses.map((key) => {
                const value = Number(counts[key] || 0);
                return (
                  <tr key={key} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-2 py-1 font-bold text-slate-700">{statusLabels[key]}</td>
                    <td className="px-2 py-1 text-right font-extrabold text-slate-900">{value}</td>
                    <td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{pct(value, jobsCount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </ReportTable>

          <ReportTable title="Revenue By Method">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Method</Th><Th right>Amount</Th><Th right>% of Revenue</Th></tr>
            </thead>
            <tbody>
              {methodRows.map((row) => (
                <tr key={row.key} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{row.label}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                  <td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{pct(row.amount, totalRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </ReportTable>
        </div>
      )}

      {/* ── TREND + STAFF + SERVICE (weekly / monthly) ───────────────────────── */}
      {(applied.mode === "weekly" || applied.mode === "monthly") && (
        <div className="mt-2 grid gap-2 grid-cols-1 xl:grid-cols-[1.2fr_0.8fr]">
          <ReportTable title="Daily Trend" minWidth="580px">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Date</Th><Th right>Jobs</Th><Th right>Payments</Th><Th right>Revenue</Th></tr>
            </thead>
            <tbody>
              {trendRows.length ? trendRows.map((row) => (
                <tr key={row.date} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{row.date}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.payments}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.revenue)}</td>
                </tr>
              )) : <EmptyRow colSpan={4} text="No trend data for this period." />}
            </tbody>
          </ReportTable>

          <ReportTable title="Staff Productivity">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Staff</Th><Th right>Jobs</Th><Th right>Value</Th></tr>
            </thead>
            <tbody>
              {staffRows.length ? staffRows.map((row) => (
                <tr key={row.staff} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{row.staff}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.value)}</td>
                </tr>
              )) : <EmptyRow colSpan={3} text="No staff activity for this period." />}
            </tbody>
          </ReportTable>

          <ReportTable title="Service Performance" className="xl:col-span-2">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Service</Th><Th right>Jobs</Th><Th right>Value</Th></tr>
            </thead>
            <tbody>
              {serviceRows.length ? serviceRows.map((row) => (
                <tr key={row.service} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{row.service}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.value)}</td>
                </tr>
              )) : <EmptyRow colSpan={3} text="No service activity for this period." />}
            </tbody>
          </ReportTable>
        </div>
      )}

      {/* ── CUSTOM RANGE: detailed service + staff ───────────────────────────── */}
      {applied.mode === "custom" && (
        <div className="mt-2 space-y-2">
          <ReportTable title="Service Performance" minWidth="680px">
            <thead className="bg-[#0B3B2E] text-white">
              <tr>
                <Th>Service</Th><Th>Category</Th>
                <Th right>Jobs</Th><Th right>Paid</Th><Th right>Cancelled</Th>
                <Th right>Revenue</Th><Th right>Cash</Th><Th right>M-Pesa</Th>
                <Th right>Avg Price</Th><Th right>Revenue %</Th>
              </tr>
            </thead>
            <tbody>
              {customServiceRows.length ? customServiceRows.map((row) => (
                <tr key={row.service} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{row.service || "-"}</td>
                  <td className="px-2 py-1 text-slate-500">{row.category || "-"}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs || 0}</td>
                  <td className="px-2 py-1 text-right text-[#0B3B2E] font-semibold">{row.paidJobs || 0}</td>
                  <td className="px-2 py-1 text-right text-red-600 font-semibold">{row.cancelledJobs || 0}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.revenue)}</td>
                  <td className="px-2 py-1 text-right text-slate-700">{formatMoney(row.cash)}</td>
                  <td className="px-2 py-1 text-right text-slate-700">{formatMoney(row.mpesa)}</td>
                  <td className="px-2 py-1 text-right text-slate-700">{formatMoney(row.avgPrice)}</td>
                  <td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{row.revenueShare != null ? `${Math.round(row.revenueShare)}%` : "-"}</td>
                </tr>
              )) : <EmptyRow colSpan={10} text="No service data for this range." />}
            </tbody>
          </ReportTable>

          <ReportTable title="Staff Productivity" minWidth="620px">
            <thead className="bg-[#0B3B2E] text-white">
              <tr>
                <Th>Staff</Th>
                <Th right>Jobs</Th><Th right>Paid Jobs</Th>
                <Th right>Revenue</Th><Th right>Cash</Th><Th right>M-Pesa</Th>
                <Th right>Commission</Th><Th right>Net Revenue</Th><Th right>Job %</Th>
              </tr>
            </thead>
            <tbody>
              {customStaffRows.length ? customStaffRows.map((row) => (
                <tr key={row.staff} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{row.staff || "-"}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.jobs || 0}</td>
                  <td className="px-2 py-1 text-right text-[#0B3B2E] font-semibold">{row.paidJobs || 0}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.revenue)}</td>
                  <td className="px-2 py-1 text-right text-slate-700">{formatMoney(row.cash)}</td>
                  <td className="px-2 py-1 text-right text-slate-700">{formatMoney(row.mpesa)}</td>
                  <td className="px-2 py-1 text-right text-amber-700 font-semibold">{formatMoney(row.commission)}</td>
                  <td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{formatMoney(row.netRevenue)}</td>
                  <td className="px-2 py-1 text-right text-slate-500">{row.jobShare != null ? `${Math.round(row.jobShare)}%` : "-"}</td>
                </tr>
              )) : <EmptyRow colSpan={9} text="No staff data for this range." />}
            </tbody>
          </ReportTable>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* EXPENSE ANALYSIS — all modes                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-3 border-b-2 border-[#0B3B2E] pb-1">
          <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Expense Analysis</h2>
          <span className="text-[10px] font-semibold text-slate-400 normal-case tracking-normal">All expense statuses · {periodLabel}</span>
          <NavBtn onClick={() => navigate("/carwash/expenses")} className="ml-auto">Open Expenses</NavBtn>
        </div>

        {/* Status overview cards */}
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Paid", amt: expPaidAmt, count: expPaidCount, color: "text-[#0B3B2E]", bg: "bg-[#EDF5F1]" },
            { label: "Approved", amt: expAppAmt, count: expAppCount, color: "text-amber-700", bg: "bg-amber-50" },
            { label: "Draft", amt: expDraftAmt, count: expDraftCount, color: "text-slate-500", bg: "bg-slate-50" },
            { label: "Total", amt: expTotalAmt, count: expTotalCount, color: "text-slate-900", bg: "bg-white" },
          ].map(({ label, amt, count, color, bg }) => (
            <div key={label} className={`border border-slate-200 ${bg} px-3 py-2`}>
              <p className={`text-[10px] font-extrabold uppercase tracking-wide ${color}`}>{label}</p>
              <p className="text-sm font-extrabold text-slate-900">{formatMoney(amt)}</p>
              <p className="text-[10px] font-semibold text-slate-500">{count} expense{count !== 1 ? "s" : ""}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-2 grid-cols-1 xl:grid-cols-[1.1fr_0.9fr]">
          {/* By Category */}
          <ReportTable title="By Category">
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Category</Th><Th right>Count</Th><Th right>Amount</Th><Th right>% Total</Th></tr>
            </thead>
            <tbody>
              {expCategoryRows.length ? expCategoryRows.map((row) => (
                <tr key={row.category} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 font-bold text-slate-700">{row.category || "Unspecified"}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.count || 0}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                  <td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{pct(row.amount, expTotalAmt)}</td>
                </tr>
              )) : <EmptyRow colSpan={4} text="No expense data for this period." />}
            </tbody>
          </ReportTable>

          {/* By Method + Status breakdown */}
          <div className="space-y-2">
            <ReportTable title="By Payment Method">
              <thead className="bg-[#0B3B2E] text-white">
                <tr><Th>Method</Th><Th right>Count</Th><Th right>Amount</Th><Th right>% Total</Th></tr>
              </thead>
              <tbody>
                {expMethodRows.length ? expMethodRows.map((row) => (
                  <tr key={row.key} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="px-2 py-1 font-bold text-slate-700">{row.label}</td>
                    <td className="px-2 py-1 text-right font-extrabold text-slate-900">{row.count}</td>
                    <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(row.amount)}</td>
                    <td className="px-2 py-1 text-right font-semibold text-[#0B3B2E]">{pct(row.amount, expTotalAmt)}</td>
                  </tr>
                )) : <EmptyRow colSpan={4} text="No expense data." />}
              </tbody>
            </ReportTable>

            <ReportTable title="Approval Status">
              <thead className="bg-[#0B3B2E] text-white">
                <tr><Th>Status</Th><Th right>Count</Th><Th right>Amount</Th><Th right>% of Total</Th></tr>
              </thead>
              <tbody>
                {[
                  ["Paid",     expPaidCount,  expPaidAmt,  "font-semibold text-[#0B3B2E]"],
                  ["Approved", expAppCount,   expAppAmt,   "font-semibold text-amber-700"],
                  ["Draft",    expDraftCount, expDraftAmt,  "text-slate-500"],
                ].map(([label, count, amt, cls]) => (
                  <tr key={label} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className={`px-2 py-1 font-bold ${cls}`}>{label}</td>
                    <td className="px-2 py-1 text-right font-extrabold text-slate-900">{count}</td>
                    <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(amt)}</td>
                    <td className="px-2 py-1 text-right font-semibold text-slate-600">{pct(amt, expTotalAmt)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 border-t border-slate-300">
                  <td className="px-2 py-1 font-extrabold text-slate-700">Total</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{expTotalCount}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(expTotalAmt)}</td>
                  <td className="px-2 py-1 text-right text-slate-500">100%</td>
                </tr>
              </tbody>
            </ReportTable>
          </div>
        </div>

        {/* CSS bar chart — category distribution */}
        {expCategoryRows.length > 0 && (
          <div className="mt-2 border border-slate-200 bg-white p-3 shadow-sm">
            <p className="mb-2.5 text-[11px] font-extrabold uppercase tracking-wide text-[#0B3B2E]">Expenditure Distribution</p>
            <div className="space-y-2">
              {expCategoryRows.slice(0, 12).map((row) => (
                <div key={row.category} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] font-bold text-slate-700">{row.category || "Other"}</span>
                  <div className="h-4 min-w-0 flex-1 overflow-hidden bg-slate-100">
                    <div
                      className="h-full bg-[#0B3B2E] transition-all duration-300"
                      style={{ width: expTotalAmt ? `${Math.round((row.amount / expTotalAmt) * 100)}%` : "0%" }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-[11px] font-extrabold text-slate-900">{formatMoney(row.amount)}</span>
                  <span className="w-8 shrink-0 text-right text-[11px] font-semibold text-slate-400">{pct(row.amount, expTotalAmt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── DAILY AUDIT TABLES ───────────────────────────────────────────────── */}
      {applied.mode === "daily" && (
        <div className="mt-2 grid gap-2 grid-cols-1 xl:grid-cols-[1.65fr_0.35fr]">
          <ReportTable
            title="Job Audit"
            minWidth="100%"
            right={<NavBtn onClick={() => navigate("/carwash/jobs")}>Open Jobs</NavBtn>}
          >
            <thead className="bg-[#0B3B2E] text-white">
              <tr>
                <Th>Time</Th><Th>Job</Th><Th>Plate</Th><Th>Customer</Th>
                <Th>Service</Th><Th>Status</Th><Th>Payment</Th><Th right>Price</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.length ? jobs.map((job) => (
                <tr key={job._id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 text-slate-600">{formatTime(job.createdAt)}</td>
                  <td className="px-2 py-1 font-extrabold text-slate-900">{job.jobNumber || "-"}</td>
                  <td className="px-2 py-1 font-bold uppercase text-slate-800">{job.plateNumber || "-"}</td>
                  <td className="px-2 py-1 text-slate-700">{job.customerName || "-"}</td>
                  <td className="px-2 py-1 text-slate-700">{job.serviceName || "-"}</td>
                  <td className="px-2 py-1 font-bold text-slate-700">{statusLabels[job.status] || job.status || "-"}</td>
                  <td className="px-2 py-1 font-bold uppercase text-slate-700">{job.paymentStatus || "unpaid"}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(job.price)}</td>
                </tr>
              )) : <EmptyRow colSpan={8} text="No Car Wash jobs recorded for this date." />}
            </tbody>
          </ReportTable>

          <ReportTable
            title="Payment Audit"
            minWidth="100%"
            right={<NavBtn onClick={() => navigate("/carwash/payments")}>Open Payments</NavBtn>}
          >
            <thead className="bg-[#0B3B2E] text-white">
              <tr><Th>Time</Th><Th>Method</Th><Th>Ref</Th><Th right>Amount</Th></tr>
            </thead>
            <tbody>
              {payments.length ? payments.map((payment) => (
                <tr key={payment._id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 text-slate-600">{formatTime(payment.paymentDate)}</td>
                  <td className="px-2 py-1 font-bold uppercase text-slate-700">{payment.method || "-"}</td>
                  <td className="px-2 py-1 text-slate-700">{payment.reference || payment.job?.jobNumber || "-"}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(payment.amount)}</td>
                </tr>
              )) : <EmptyRow colSpan={4} text="No Car Wash payments recorded for this date." />}
            </tbody>
          </ReportTable>

          <ReportTable
            title="Expense Audit"
            className="xl:col-span-2"
            right={<NavBtn onClick={() => navigate("/carwash/expenses")}>Open Expenses</NavBtn>}
          >
            <thead className="bg-[#0B3B2E] text-white">
              <tr>
                <Th>Time</Th><Th>Expense #</Th><Th>Payee</Th>
                <Th>Category</Th><Th>Method</Th><Th>Status</Th><Th right>Amount</Th>
              </tr>
            </thead>
            <tbody>
              {expenseList.length ? expenseList.map((expense) => (
                <tr key={expense._id} className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="px-2 py-1 text-slate-600">{formatTime(expense.expenseDate)}</td>
                  <td className="px-2 py-1 font-extrabold text-slate-900">{expense.expenseNumber || "-"}</td>
                  <td className="px-2 py-1 text-slate-700">{expense.payee || "-"}</td>
                  <td className="px-2 py-1 text-slate-700">{expense.category || "-"}</td>
                  <td className="px-2 py-1 font-bold uppercase text-slate-700">{expense.method || "-"}</td>
                  <td className="px-2 py-1 font-bold uppercase text-slate-700">{expense.status || "-"}</td>
                  <td className="px-2 py-1 text-right font-extrabold text-slate-900">{formatMoney(expense.amount)}</td>
                </tr>
              )) : <EmptyRow colSpan={7} text="No Car Wash expenses recorded for this date." />}
            </tbody>
          </ReportTable>
        </div>
      )}
    </CarWashShell>
  );
};

export default CarWashReports;
