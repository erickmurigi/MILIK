import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import AppSelect from '../../components/common/AppSelect';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties } from '../../redux/selectors';
import { getTenantPaidBalanceReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import printTabularList from '../../utils/printList';
import ResetFiltersButton from '../../components/common/ResetFiltersButton';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import useDebounce from '../../hooks/useDebounce';

const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const ITEMS_PER_PAGE = 50;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ value: String(i + 1), label }));

const fmtCompact = (v) => {
  const n = Number(v || 0);
  if (n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (n >= 1000) return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const buildBreakdownParts = ({ rent, utilityBreakdown, utility, penalty, deposit, other }) => {
  const parts = [];
  if (Number(rent || 0) > 0) parts.push({ label: 'Rent', value: fmtCompact(rent) });
  const utMap = utilityBreakdown || {};
  const utKeys = Object.keys(utMap).filter((k) => utMap[k] > 0).sort();
  if (utKeys.length > 0) {
    utKeys.forEach((k) => parts.push({ label: k, value: fmtCompact(utMap[k]) }));
  } else if (Number(utility || 0) > 0) {
    parts.push({ label: 'Utility', value: fmtCompact(utility) });
  }
  if (Number(penalty || 0) > 0) parts.push({ label: 'Penalty', value: fmtCompact(penalty) });
  if (Number(deposit || 0) > 0) parts.push({ label: 'Deposit', value: fmtCompact(deposit) });
  if (Number(other || 0) > 0) parts.push({ label: 'Other', value: fmtCompact(other) });
  return parts;
};

const buildInvoicedBreakdownParts = (row) => buildBreakdownParts({
  rent: row.rentInvoiced, utilityBreakdown: row.utilityInvoicedBreakdown,
  utility: row.utilityInvoiced, penalty: row.penaltyInvoiced,
  deposit: row.depositInvoiced, other: row.otherInvoiced,
});

const buildArrearsBreakdownParts = (row) => buildBreakdownParts({
  rent: row.previousArrearsRent, utilityBreakdown: row.previousArrearsUtilityBreakdown,
  utility: row.previousArrearsUtility, penalty: row.previousArrearsPenalty,
  deposit: row.previousArrearsDeposit, other: row.previousArrearsOther,
});

const PaidBalanceReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || currentUser?.company?.name || currentUser?.company?.companyName || 'Milik';

  const [loading, setLoading] = useState(false);
  const filtersInitialized = useRef(false);
  const [filters, setFilters] = useTabState("/reports/paid-balance:filters", () => {
    const now = new Date();
    return {
      startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      asOfDate: toDateInputValue(now),
      propertyId: '',
      status: 'all',
      search: '',
    };
  });
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const resetFilters = () => {
    const now = new Date();
    setFilters({
      startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      asOfDate: toDateInputValue(now),
      propertyId: '',
      status: 'all',
      search: '',
    });
  };
  const [report, setReport] = useState({ summary: {}, rows: [], allUtilityTypes: [] });
  const [currentPage, setCurrentPage] = useTabState("/reports/paid-balance:currentPage", 1);

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch]);

  const loadReportRef = useRef(null);
  const loadReport = useCallback(async (signal, filterOverrides = {}) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await getTenantPaidBalanceReport({ business: businessId, ...filters, ...filterOverrides }, signal);
      if (signal?.aborted) return;
      setReport({
        summary: data?.summary || {},
        rows: Array.isArray(data?.rows) ? data.rows : [],
        allUtilityTypes: Array.isArray(data?.allUtilityTypes) ? data.allUtilityTypes : [],
      });
    } catch (error) {
      if (error?.name === 'CanceledError' || error?.name === 'AbortError') return;
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load paid and balance report.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [businessId, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!businessId) return;
    const controller = new AbortController();
    loadReport(controller.signal);
    return () => controller.abort();
  }, [businessId]);

  // Keep a ref to the latest loadReport so the auto-fetch effect doesn't need it as a dep
  useEffect(() => { loadReportRef.current = loadReport; }, [loadReport]);

  // Auto-fetch when date/property/status filters change (debounced for date typing)
  const debouncedFilterTrigger = useDebounce(
    `${filters.startDate}|${filters.asOfDate}|${filters.propertyId}|${filters.status}`,
    500
  );
  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    const controller = new AbortController();
    loadReportRef.current(controller.signal);
    return () => controller.abort();
  }, [debouncedFilterTrigger]);

  // Debounce search so the filter useMemo doesn't fire on every keystroke
  const debouncedSearch = useDebounce(filters.search, 300);

  const searchFilteredRows = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const term = String(debouncedSearch || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => [row.tenantName, row.propertyName, row.unitNumber].join(' ').toLowerCase().includes(term));
  }, [report.rows, debouncedSearch]);

  const paginatedRows = useMemo(() => {
    const startIndex = (Math.max(currentPage, 1) - 1) * ITEMS_PER_PAGE;
    return searchFilteredRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [searchFilteredRows, currentPage]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(searchFilteredRows.length / ITEMS_PER_PAGE)), [searchFilteredRows]);

  useEffect(() => { setCurrentPage(1); }, [filters.startDate, filters.asOfDate, filters.propertyId, filters.status, debouncedSearch]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  const summary = report.summary || {};
  const allUtilityTypes = report.allUtilityTypes || [];
  const hasUtilityBreakdown = allUtilityTypes.length > 0;

  const propertyNameMap = useMemo(() => new Map(properties.map((p) => [String(p?._id), p?.propertyName || p?.name || 'Unnamed Property'])), [properties]);

  const balanceInsights = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const owingRows = rows.filter((r) => r?.status === 'owing');
    const creditRows = rows.filter((r) => r?.status === 'credit');
    const settledRows = rows.filter((r) => r?.status === 'settled');
    const largestOwing = [...owingRows].sort((a, b) => Number(b?.netBalance || 0) - Number(a?.netBalance || 0))[0] || null;
    const largestCredit = [...creditRows].sort((a, b) => Number(a?.netBalance || 0) - Number(b?.netBalance || 0))[0] || null;
    const earliestArrear = [...owingRows].filter((r) => r?.oldestDueDate).sort((a, b) => new Date(a.oldestDueDate) - new Date(b.oldestDueDate))[0] || null;
    const tenantCount = Number(summary.tenantCount || rows.length || 0);
    const settlementRate = tenantCount > 0 ? (settledRows.length / tenantCount) * 100 : null;
    const averageOutstanding = owingRows.length > 0 ? Number(summary.totalOutstanding || 0) / owingRows.length : 0;
    return { largestOwing, largestCredit, earliestArrear, settlementRate, averageOutstanding };
  }, [report.rows, summary.tenantCount, summary.totalOutstanding]);

  // ── Month / Year period selector ──────────────────────────────────────────
  const yearOptions = useMemo(() => { const y = new Date().getFullYear(); return [y + 1, y, y - 1, y - 2, y - 3].map(String); }, []);
  const { selMonth, selYear } = useMemo(() => {
    const fallbackYear = String(new Date().getFullYear());
    if (!filters.asOfDate) return { selMonth: null, selYear: fallbackYear };
    const e = new Date(filters.asOfDate + 'T00:00:00');
    const lastDay = new Date(e.getFullYear(), e.getMonth() + 1, 0);
    const expectedStart = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-01`;
    if (e.getDate() === lastDay.getDate() && filters.startDate === expectedStart) {
      return { selMonth: String(e.getMonth() + 1), selYear: String(e.getFullYear()) };
    }
    return { selMonth: null, selYear: String(e.getFullYear()) };
  }, [filters.asOfDate, filters.startDate]);
  const applyMonthYear = (month, year) => {
    const m = Number(month); const y = Number(year);
    if (!m || !y) return;
    const lastDay = new Date(y, m, 0).getDate();
    const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
    const asOfDate = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    setFilters(prev => ({ ...prev, startDate, asOfDate }));
    loadReport(undefined, { startDate, asOfDate });
  };

  const handleExportCSV = () => {
    if (!canExportReports) { toast.error("You do not have permission to export reports"); return; }
    const utilityCols = hasUtilityBreakdown ? allUtilityTypes : ['Utility Balance'];
    const utilInvCols = hasUtilityBreakdown ? allUtilityTypes.map((ut) => `${ut} Invoiced`) : ['Utility Invoiced'];
    const header = ['Tenant', 'Property', 'Unit', 'Prev. Arrears', 'Rent Invoiced', ...utilInvCols, 'Penalty Invoiced', 'Deposit Invoiced', 'Other Invoiced', 'Paid Applied', 'Outstanding', 'Unapplied Credit', 'Net Balance', 'Rent Balance', ...utilityCols, 'Penalty Balance', 'Deposit Balance', 'Other Balance', 'Oldest Due', 'Last Payment', 'Status'];
    const rows = (report.rows || []).map((row) => [
      row.tenantName || '', row.propertyName || '', row.unitNumber || '',
      row.previousArrears || 0,
      row.rentInvoiced || 0,
      ...(hasUtilityBreakdown ? allUtilityTypes.map((ut) => row.utilityInvoicedBreakdown?.[ut] || 0) : [row.utilityInvoiced || 0]),
      row.penaltyInvoiced || 0, row.depositInvoiced || 0, row.otherInvoiced || 0,
      row.totalPaidApplied || 0, row.outstanding || 0,
      row.unappliedCredit || 0, row.netBalance || 0, row.rentBalance || 0,
      ...(hasUtilityBreakdown ? allUtilityTypes.map((ut) => row.utilityBreakdown?.[ut] || 0) : [row.utilityBalance || 0]),
      row.penaltyBalance || 0, row.depositBalance || 0, row.otherBalance || 0,
      row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '',
      row.lastPaymentDate ? new Date(row.lastPaymentDate).toLocaleDateString() : '',
      row.status || '',
    ]);
    const csv = [header, ...rows].map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paid_balance_report_${filters.asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.error("You do not have permission to print reports"); return; }

    const rows   = searchFilteredRows;
    const summ   = report.summary || {};
    const utTypes = allUtilityTypes;
    const hasUt  = utTypes.length > 0;

    const dateRange = [filters.startDate && fmtDate(filters.startDate), filters.asOfDate && fmtDate(filters.asOfDate)]
      .filter(Boolean).join(" – ");
    const propLabel = filters.propertyId ? (propertyNameMap.get(String(filters.propertyId)) || "Selected property") : "All properties";
    const statusLabel = !filters.status || filters.status === "all" ? "All positions" : filters.status;

    const summaryLine = [
      `Invoiced: ${formatMoney(summ.totalInvoiced)}`,
      `Paid: ${formatMoney(summ.totalPaidApplied)}`,
      `Outstanding: ${formatMoney(summ.totalOutstanding)}`,
      `Unapplied Credit: ${formatMoney(summ.totalUnappliedCredit)}`,
      `Net Balance: ${formatMoney(summ.netBalance)}`,
      `Owing: ${summ.owingCount || 0}  ·  Credit: ${summ.creditCount || 0}  ·  Settled: ${summ.settledCount || 0}`,
      `${propLabel}  ·  ${statusLabel}`,
    ].join("     ");

    // Compute column totals
    const sum = (key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
    const utTotals = hasUt
      ? utTypes.reduce((m, ut) => { m[ut] = rows.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
      : {};

    const utCols = hasUt
      ? utTypes.map((ut) => ({ label: ut, align: "right", value: (r) => formatMoney(r.utilityBreakdown?.[ut] || 0) }))
      : [{ label: "Utility Bal", align: "right", value: (r) => formatMoney(r.utilityBalance || 0) }];

    const columns = [
      { label: "Tenant",      value: (r) => r.tenantName || "—" },
      { label: "Property",    value: (r) => r.propertyName || "—" },
      { label: "Unit",        value: (r) => r.unitNumber || "—" },
      { label: "B/F Arrears",     align: "right", value: (r) => Number(r.previousArrears || 0) > 0 ? `${formatMoney(r.previousArrears)} (${buildArrearsBreakdownParts(r).map((p) => `${p.label} ${p.value}`).join(" · ")})` : "—" },
      { label: "Period Charges",  value: (r) => buildInvoicedBreakdownParts(r).map((p) => `${p.label} ${p.value}`).join(" · ") || "—" },
      { label: "Applied",   align: "right", value: (r) => formatMoney(r.totalPaidApplied) },
      { label: "Outstanding", align: "right", value: (r) => formatMoney(r.outstanding) },
      { label: "Unapplied Credit", align: "right", value: (r) => formatMoney(r.unappliedCredit) },
      { label: "Net Balance", align: "right", value: (r) => formatMoney(r.netBalance) },
      { label: "Rent O/S",   align: "right", value: (r) => formatMoney(r.rentBalance) },
      ...utCols,
      { label: "Penalty O/S", align: "right", value: (r) => formatMoney(r.penaltyBalance) },
      { label: "Deposit O/S", align: "right", value: (r) => formatMoney(r.depositBalance) },
      { label: "Other O/S",   align: "right", value: (r) => formatMoney(r.otherBalance) },
      { label: "Oldest Due",  value: (r) => r.oldestDueDate ? fmtDate(r.oldestDueDate) : "—" },
      { label: "Status",      value: (r) => (r.status || "").charAt(0).toUpperCase() + (r.status || "").slice(1) },
    ];

    const totalsRow = [
      `TOTALS — ${rows.length} rows`,
      "", "",
      formatMoney(sum("previousArrears")),
      "",
      formatMoney(sum("totalPaidApplied")),
      formatMoney(sum("outstanding")),
      formatMoney(sum("unappliedCredit")),
      formatMoney(sum("netBalance")),
      formatMoney(sum("rentBalance")),
      ...(hasUt ? utTypes.map((ut) => formatMoney(utTotals[ut])) : [formatMoney(sum("utilityBalance"))]),
      formatMoney(sum("penaltyBalance")),
      formatMoney(sum("depositBalance")),
      formatMoney(sum("otherBalance")),
      "", "",
    ];

    printTabularList({
      title:     "Paid & Balance Report",
      subtitle:  `Tenant receivables snapshot — ${dateRange}`,
      company:   currentCompany,
      summary:   summaryLine,
      columns,
      rows,
      totalsRow,
    });
  }, [canExportReports, currentCompany, searchFilteredRows, report.summary, filters, allUtilityTypes, propertyNameMap]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #0B3B2E; box-shadow: 0 0 0 1px rgba(11,59,46,0.2); outline: none; }
        `}</style>
        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            {/* ── Toolbar ── */}
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className="grid gap-1.5 md:grid-cols-3 xl:grid-cols-6">
                <AppSelect
                  value={selMonth}
                  onChange={(v) => applyMonthYear(v, selYear)}
                  options={MONTHS}
                  placeholder="Month"
                  clearable size="sm"
                />
                <select
                  value={selYear}
                  onChange={(e) => applyMonthYear(selMonth, e.target.value)}
                  className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
                >
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <input type="date" value={filters.startDate} onChange={setFilter("startDate")} className="h-7 flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  <span className="flex-shrink-0 text-[10px] font-semibold text-slate-400">–</span>
                  <input type="date" value={filters.asOfDate} onChange={setFilter("asOfDate")} className="h-7 flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </div>
                <AppSelect
                  value={filters.propertyId}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? '' }))}
                  options={properties.map((p) => ({ value: p._id, label: p.propertyName || p.name }))}
                  placeholder="All properties" searchable clearable size="sm"
                />
                <AppSelect
                  value={filters.status}
                  onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "all" }))}
                  options={[{ value: "owing", label: "Owing" }, { value: "credit", label: "Credit" }, { value: "settled", label: "Settled" }]}
                  placeholder="All tenant positions" clearable size="sm"
                />
                <input value={filters.search} onChange={setFilter("search")} placeholder="Search tenant, property, unit" className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
            </div>

            {/* ── Stats + Actions bar ── */}
            <div className="flex-shrink-0 flex items-stretch border-b border-slate-200 bg-white">
              {/* Scrollable stats */}
              <div className="flex-1 overflow-x-auto">
                <div className="flex h-full min-w-max divide-x divide-slate-100">
                  {[
                    { label: 'Period Invoiced', value: formatMoney(summary.totalInvoiced),        accent: 'text-slate-800',   sub: null },
                    { label: 'Applied',         value: formatMoney(summary.totalPaidApplied),     accent: 'text-emerald-700', sub: null },
                    { label: 'Outstanding',      value: formatMoney(summary.totalOutstanding),     accent: 'text-red-600',     sub: Number(summary.totalOutstanding || 0) > 0 ? `${summary.owingCount || 0} owing` : null },
                    { label: 'Unapplied',        value: formatMoney(summary.totalUnappliedCredit), accent: 'text-amber-600',   sub: Number(summary.totalUnappliedCredit || 0) > 0 ? `${summary.creditCount || 0} credit` : null },
                    { label: 'Net Balance',      value: formatMoney(summary.netBalance),           accent: 'text-slate-800',   sub: null },
                    { label: 'Tenant Rows',      value: Number(summary.tenantCount || 0).toLocaleString(), accent: 'text-slate-800', sub: null },
                    { label: 'Largest Debtor',   value: balanceInsights.largestOwing?.tenantName || '—',   accent: 'text-red-600',     sub: balanceInsights.largestOwing ? formatMoney(balanceInsights.largestOwing.netBalance) : null },
                    { label: 'Largest Credit',   value: balanceInsights.largestCredit?.tenantName || '—',  accent: 'text-emerald-700', sub: balanceInsights.largestCredit ? formatMoney(Math.abs(Number(balanceInsights.largestCredit.netBalance || 0))) : null },
                    { label: 'Settlement Rate',  value: formatPercent(balanceInsights.settlementRate),     accent: 'text-slate-800',   sub: 'Fully settled' },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col justify-center px-3 py-1.5">
                      <p className="whitespace-nowrap text-[8.5px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                      <p className={`whitespace-nowrap text-[11px] font-black leading-tight ${item.accent}`}>{item.value}</p>
                      {item.sub && <p className="whitespace-nowrap text-[8px] leading-tight text-slate-400">{item.sub}</p>}
                    </div>
                  ))}
                </div>
              </div>
              {/* Action buttons */}
              <div className="flex flex-shrink-0 items-center gap-1.5 border-l border-slate-200 px-2">
                <button onClick={handleExportCSV} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint /> Print</button>
                <ResetFiltersButton onReset={resetFilters} disabled={loading} />
                <button onClick={() => loadReport()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
            </div>

            {/* ── Info strip ── */}
            <div className="flex-shrink-0 flex flex-wrap gap-2 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 border-b border-slate-100">
              <span>Owing: {summary.owingCount || 0}</span>
              <span>Credit: {summary.creditCount || 0}</span>
              <span>Settled: {summary.settledCount || 0}</span>
              {hasUtilityBreakdown && <span className="text-[#0B3B2E]">Utilities: {allUtilityTypes.join(' · ')}</span>}
              {balanceInsights.earliestArrear?.tenantName && <span>Oldest due: {balanceInsights.earliestArrear.tenantName} ({fmtDate(balanceInsights.earliestArrear.oldestDueDate)})</span>}
            </div>

            {/* ── Table ── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-1.5">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200">
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                      <tr>
                        {['Tenant', 'Property', 'Unit', 'B/F Arrears', 'Period Charges', 'Applied', 'Outstanding', 'Unapplied Credit', 'Net Balance', 'Rent O/S',
                          ...(hasUtilityBreakdown ? allUtilityTypes.map(u => `${u} O/S`) : ['Utility O/S']),
                          'Penalty O/S', 'Deposit O/S', 'Other O/S', 'Oldest Due', 'Status'
                        ].map((h, i, arr) => (
                          <th key={h} className={`whitespace-nowrap px-2 py-1 text-left font-bold text-[9px] tracking-wide ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedRows.length === 0 ? (
                        <tr><td colSpan={13 + (hasUtilityBreakdown ? allUtilityTypes.length : 1) + 1} className="px-2 py-4 text-center text-slate-500">No tenants matched the selected filters.</td></tr>
                      ) : paginatedRows.map((row, i) => (
                        <tr key={`${row.tenantId}-${row.unitId || i}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/50 hover:bg-emerald-50/30'}`}>
                          <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900 whitespace-nowrap">{row.tenantName}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-600 whitespace-nowrap">{row.propertyName}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-600">{row.unitNumber}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-[8.5px] text-orange-500 whitespace-nowrap">
                            {(() => {
                              const parts = buildArrearsBreakdownParts(row);
                              if (parts.length === 0) return <span className="text-slate-300">—</span>;
                              return parts.map(({ label, value }, idx) => (
                                <span key={label}>{idx > 0 && <span className="mx-0.5 text-orange-200">·</span>}<span className="font-semibold text-orange-600">{label}</span> {value}</span>
                              ));
                            })()}
                          </td>
                          <td className="px-2 py-1 border-r border-gray-100 text-[8.5px] text-slate-500 whitespace-nowrap">
                            {(() => {
                              const parts = buildInvoicedBreakdownParts(row);
                              if (parts.length === 0) return <span className="text-slate-300">—</span>;
                              return parts.map(({ label, value }, idx) => (
                                <span key={label}>{idx > 0 && <span className="mx-0.5 text-slate-300">·</span>}<span className="font-semibold text-slate-600">{label}</span> {value}</span>
                              ));
                            })()}
                          </td>
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-emerald-700">{formatMoney(row.totalPaidApplied)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-red-600">{formatMoney(row.outstanding)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-amber-700">{formatMoney(row.unappliedCredit)}</td>
                          <td className={`px-2 py-1 border-r border-gray-100 text-right font-bold ${Number(row.netBalance || 0) > 0 ? 'text-red-700' : Number(row.netBalance || 0) < 0 ? 'text-emerald-700' : 'text-slate-600'}`}>{formatMoney(row.netBalance)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.rentBalance)}</td>
                          {hasUtilityBreakdown
                            ? allUtilityTypes.map((ut) => <td key={ut} className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.utilityBreakdown?.[ut] || 0)}</td>)
                            : <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.utilityBalance)}</td>
                          }
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.penaltyBalance)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.depositBalance)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.otherBalance)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-600 whitespace-nowrap">{fmtDate(row.oldestDueDate)}</td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-black ${row.status === 'owing' ? 'border-red-200 bg-red-50 text-red-700' : row.status === 'credit' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Pagination ── */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  <div>Showing {searchFilteredRows.length ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–{Math.min(currentPage * ITEMS_PER_PAGE, searchFilteredRows.length)} of {searchFilteredRows.length} tenant row(s)</div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">50 items per page</span>
                    <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                    <span className="font-semibold text-slate-700">Page {currentPage} of {totalPages}</span>
                    <button type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PaidBalanceReport;
