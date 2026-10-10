import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import AppSelect from '../../components/common/AppSelect';
import { useTerms } from '../../hooks/useTerm';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import ListToolbar from '../../components/common/ListToolbar';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties } from '../../redux/selectors';
import { getTenantPaidBalanceReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaPrint, FaRedoAlt, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import useDebounce from '../../hooks/useDebounce';
import printTabularList from '../../utils/printList';

const POPUP_BLOCKED = 'Pop-up blocked — allow pop-ups for this site to print';
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ value: String(i + 1), label }));

const fmtCompact = (v) => {
  const n = Number(v || 0);
  if (n === 0) return '0';
  if (n >= 1000000) return `${(n / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (n >= 1000) return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

const calcOtherExpd = (row) =>
  Number(row.utilityInvoiced || 0) +
  Number(row.penaltyInvoiced || 0) +
  Number(row.depositInvoiced || 0) +
  Number(row.otherInvoiced || 0);

// Rent paid = (previous rent arrears + rent invoiced) − rent outstanding
const calcRentPaid = (row) => {
  const totalRentCharged = Number(row.previousArrearsRent || 0) + Number(row.rentInvoiced || 0);
  return Math.max(0, totalRentCharged - Number(row.rentBalance || 0));
};

// Other paid = (previous other arrears + other invoiced) − other outstanding
const calcOtherPaid = (row) => {
  const prevOtherArrears =
    Number(row.previousArrearsUtility || 0) +
    Number(row.previousArrearsPenalty || 0) +
    Number(row.previousArrearsDeposit || 0) +
    Number(row.previousArrearsOther || 0);
  const totalOtherCharged = prevOtherArrears + calcOtherExpd(row);
  const otherOutstanding =
    Number(row.utilityBalance || 0) +
    Number(row.penaltyBalance || 0) +
    Number(row.depositBalance || 0) +
    Number(row.otherBalance || 0);
  return Math.max(0, totalOtherCharged - otherOutstanding);
};

const buildOtherExpdTooltip = (row) => {
  const parts = [];
  const utMap = row.utilityInvoicedBreakdown || {};
  const utKeys = Object.keys(utMap).filter((k) => utMap[k] > 0).sort();
  if (utKeys.length > 0) utKeys.forEach((k) => parts.push(`${k}: ${fmtCompact(utMap[k])}`));
  else if (Number(row.utilityInvoiced || 0) > 0) parts.push(`Utility: ${fmtCompact(row.utilityInvoiced)}`);
  if (Number(row.penaltyInvoiced || 0) > 0) parts.push(`Penalty: ${fmtCompact(row.penaltyInvoiced)}`);
  if (Number(row.depositInvoiced || 0) > 0) parts.push(`Deposit: ${fmtCompact(row.depositInvoiced)}`);
  if (Number(row.otherInvoiced || 0) > 0) parts.push(`Other: ${fmtCompact(row.otherInvoiced)}`);
  return parts.join('  ·  ');
};

const buildOtherPaidTooltip = (row) => {
  const parts = [];
  const invMap = row.utilityInvoicedBreakdown || {};
  const balMap = row.utilityBreakdown || {};
  // Use invoiced keys — fully-paid utilities have bal=0 and would be missed if we used balance keys
  const utKeys = Object.keys(invMap).filter((k) => Number(invMap[k] || 0) > 0).sort();
  if (utKeys.length > 0) {
    utKeys.forEach((k) => {
      const paid = Math.max(0, Number(invMap[k] || 0) - Number(balMap[k] || 0));
      if (paid > 0) parts.push(`${k}: ${fmtCompact(paid)}`);
    });
  } else {
    const utilPaid = Math.max(0, Number(row.utilityInvoiced || 0) + Number(row.previousArrearsUtility || 0) - Number(row.utilityBalance || 0));
    if (utilPaid > 0) parts.push(`Utility: ${fmtCompact(utilPaid)}`);
  }
  const penPaid = Math.max(0, Number(row.previousArrearsPenalty || 0) + Number(row.penaltyInvoiced || 0) - Number(row.penaltyBalance || 0));
  const depPaid = Math.max(0, Number(row.previousArrearsDeposit || 0) + Number(row.depositInvoiced || 0) - Number(row.depositBalance || 0));
  const othPaid = Math.max(0, Number(row.previousArrearsOther || 0) + Number(row.otherInvoiced || 0) - Number(row.otherBalance || 0));
  if (penPaid > 0) parts.push(`Penalty: ${fmtCompact(penPaid)}`);
  if (depPaid > 0) parts.push(`Deposit: ${fmtCompact(depPaid)}`);
  if (othPaid > 0) parts.push(`Other: ${fmtCompact(othPaid)}`);
  return parts.join('  ·  ');
};

// Net balance brought forward from backend: gross prior invoices − gross prior receipts (signed — negative = credit)
const calcBalBF = (row) => Number(row.balBF || 0);

const sumRows = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);
const sumOtherExpd = (rows) => rows.reduce((s, r) => s + calcOtherExpd(r), 0);
const sumRentPaid = (rows) => rows.reduce((s, r) => s + calcRentPaid(r), 0);
const sumOtherPaid = (rows) => rows.reduce((s, r) => s + calcOtherPaid(r), 0);
const sumBalBF = (rows) => rows.reduce((s, r) => s + calcBalBF(r), 0);

const STATUS_LABEL = { owing: 'Arrears', credit: 'Overpaid', settled: 'Settled' };
const STATUS_FILTER_OPTIONS = [
  { value: 'owing', label: 'Arrears' },
  { value: 'credit', label: 'Overpaid' },
  { value: 'settled', label: 'Settled' },
];


// Inline <style> content moved here so it is not a new string on every render
const REPORT_STYLE = `
  .milik-report-page select:focus, .milik-report-page input:focus { border-color: #0B3B2E; box-shadow: 0 0 0 1px rgba(11,59,46,0.2); outline: none; }
  .pb-tooltip { position: relative; cursor: default; }
  .pb-tooltip:hover::after { content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 4px); transform: translateX(-50%); white-space: nowrap; background: #1e293b; color: #fff; font-size: 9px; padding: 3px 7px; border-radius: 3px; z-index: 50; pointer-events: none; }
`;

const statusStyle = (s) =>
  s === 'owing'
    ? 'border-red-200 bg-red-50 text-red-700'
    : s === 'credit'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-slate-200 bg-slate-100 text-slate-500';

const balCfStyle = (v) =>
  v > 0 ? 'text-red-700 font-bold' : v < 0 ? 'text-emerald-700 font-bold' : 'text-slate-500';

const PaidBalanceReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const { tenant: termTenant, tenants: termTenants, unit: termUnit, property: termProperty } = useTerms('tenant', 'tenants', 'unit', 'property');
  const COLS = useMemo(() => [termTenant, termUnit, 'BAL B/F', 'Rent', "Other Exp'd", 'Rent Paid', 'Others Paid', 'Total Paid', 'BAL C/F', 'Oldest Due', 'Status'], [termTenant, termUnit]);
  const canExportReports = useMemo(
    () => hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]),
    [currentUser, currentCompany]
  );
  const properties = useSelector(selectAllProperties);

  const businessId = useMemo(
    () => currentCompany?._id || currentUser?.company?._id || currentUser?.company || '',
    [currentCompany, currentUser]
  );

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
  const resetFilters = useCallback(() => {
    const now = new Date();
    setFilters({
      startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      asOfDate: toDateInputValue(now),
      propertyId: '',
      status: 'all',
      search: '',
    });
  }, [setFilters]);
  const [report, setReport] = useState({ summary: {}, rows: [], allUtilityTypes: [] });

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

  useEffect(() => { loadReportRef.current = loadReport; }, [loadReport]);

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

  const debouncedSearch = useDebounce(filters.search, 300);

  const searchFilteredRows = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const term = String(debouncedSearch || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => [row.tenantName, row.propertyName, row.unitNumber].join(' ').toLowerCase().includes(term));
  }, [report.rows, debouncedSearch]);

  // Group rows by property
  const propertyGroups = useMemo(() => {
    const groups = new Map();
    for (const row of searchFilteredRows) {
      const key = String(row.propertyId || row.propertyName || 'Unknown');
      if (!groups.has(key)) {
        groups.set(key, { propertyId: key, propertyName: row.propertyName || 'Unknown Property', rows: [] });
      }
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }, [searchFilteredRows]);

  const summary = report.summary || {};

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
    return { largestOwing, largestCredit, earliestArrear, settlementRate };
  }, [report.rows, summary.tenantCount]);

  // Pre-compute per-row derived values once per propertyGroups update instead of
  // calling calcRentPaid/calcOtherPaid/calcOtherExpd 2-3× each during render.
  const enrichedPropertyGroups = useMemo(() => propertyGroups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => {
      const _otherExpd = calcOtherExpd(row);
      const _rentPaid  = calcRentPaid(row);
      const _otherPaid = calcOtherPaid(row);
      const _balBF     = calcBalBF(row);
      // Gross cash received in period — drives Total Paid column so BAL B/F + Charged − Total Paid = BAL C/F
      const _totalPaid = Number(row.periodReceiptTotal || 0);
      return {
        ...row,
        _otherExpd,
        _rentPaid,
        _otherPaid,
        _totalPaid,
        _balBF,
        _otherExpdTip: _otherExpd > 0 ? buildOtherExpdTooltip(row) : '',
        _otherPaidTip: _otherPaid > 0 ? buildOtherPaidTooltip(row) : '',
      };
    }),
  })), [propertyGroups]);

  // Grand-total row: computed once from filtered rows, not re-derived in the JSX closure.
  const grandTotals = useMemo(() => ({
    totalBF:        sumBalBF(searchFilteredRows),
    totalRent:      sumRows(searchFilteredRows, 'rentInvoiced'),
    totalOther:     sumOtherExpd(searchFilteredRows),
    totalRentPaid:  sumRentPaid(searchFilteredRows),
    totalOtherPaid: sumOtherPaid(searchFilteredRows),
    totalPaidGross: sumRows(searchFilteredRows, 'periodReceiptTotal'),
    totalBalance:   sumRows(searchFilteredRows, 'netBalance'),
  }), [searchFilteredRows]);

  const yearOptions = useMemo(() => { const y = new Date().getFullYear(); return [y + 1, y, y - 1, y - 2, y - 3].map(String); }, []);
  // Stable option arrays — avoids busting AppSelect's internal useMemo every render
  const yearSelectOptions = useMemo(() => yearOptions.map((y) => ({ value: y, label: y })), [yearOptions]);
  const propertyFilterOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name })), [properties]);
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

  const applyMonthYear = useCallback((month, year) => {
    const m = Number(month); const y = Number(year);
    if (!m || !y) return;
    const lastDay = new Date(y, m, 0).getDate();
    const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
    const asOfDate = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    setFilters(prev => ({ ...prev, startDate, asOfDate }));
    loadReport(undefined, { startDate, asOfDate });
  }, [loadReport, setFilters]);

  const handleExportCSV = useCallback(() => {
    if (!canExportReports) { toast.error("You do not have permission to export reports"); return; }
    const header = [termProperty, termTenant, termUnit, 'BAL B/F', 'Rent', "Other Exp'd", 'Rent Paid', 'Others Paid', 'Total Paid', 'BAL C/F', 'Oldest Due', 'Status'];
    const rows = (report.rows || []).map((row) => [
      row.propertyName || '',
      row.tenantName || '',
      row.unitNumber || '',
      calcBalBF(row),
      row.rentInvoiced || 0,
      calcOtherExpd(row),
      calcRentPaid(row),
      calcOtherPaid(row),
      Number(row.periodReceiptTotal || 0),
      row.netBalance || 0,
      row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '',
      row.status || '',
    ]);
    const csv = [header, ...rows].map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paid_balance_${filters.asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [canExportReports, report.rows, filters.asOfDate, termProperty, termTenant, termUnit]);

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.error("You do not have permission to print reports"); return; }

    const allRows = searchFilteredRows;
    const summ = report.summary || {};
    const dateRange = [filters.startDate && fmtDate(filters.startDate), filters.asOfDate && fmtDate(filters.asOfDate)].filter(Boolean).join(" – ");
    const dash = (v) => (Number(v || 0) === 0 ? "—" : formatMoney(v));
    const bfText = (v) => (v !== 0 ? formatMoney(v) : "—");
    const balTone = (v) => (v > 0 ? "neg" : v < 0 ? "pos" : "muted");

    // Rows grouped by property, each group followed by its subtotal
    const map = new Map();
    for (const row of allRows) {
      const key = String(row.propertyId || row.propertyName || "Unknown");
      if (!map.has(key)) map.set(key, { name: row.propertyName || "Unknown Property", rows: [] });
      map.get(key).rows.push(row);
    }
    const groups = [...map.values()];

    const printRows = [];
    let grandBF = 0, grandRent = 0, grandOther = 0, grandAmtPaid = 0, grandOtherPaid = 0, grandTotalPaid = 0, grandBalance = 0;
    groups.forEach((group) => {
      const gr = group.rows;
      const gBF = sumBalBF(gr);
      const gRent = sumRows(gr, 'rentInvoiced');
      const gOther = sumOtherExpd(gr);
      const gAmtPaid = sumRentPaid(gr);
      const gOtherPaid = sumOtherPaid(gr);
      const gTotalPaid = sumRows(gr, 'periodReceiptTotal');
      const gBalance = sumRows(gr, 'netBalance');
      grandBF += gBF; grandRent += gRent; grandOther += gOther;
      grandAmtPaid += gAmtPaid; grandOtherPaid += gOtherPaid; grandTotalPaid += gTotalPaid; grandBalance += gBalance;

      const statusCounts = ['owing', 'credit', 'settled']
        .map((st) => { const n = gr.filter((r) => r.status === st).length; return n > 0 ? `${n} ${STATUS_LABEL[st]}` : ""; })
        .filter(Boolean);
      printRows.push({ __group: group.name, meta: [`${gr.length} unit${gr.length !== 1 ? "s" : ""}`, ...statusCounts].join("  ·  ") });
      gr.forEach((row) => printRows.push({
        ...row,
        _bf: calcBalBF(row),
        _otherExpd: calcOtherExpd(row),
        _rentPaid: calcRentPaid(row),
        _otherPaid: calcOtherPaid(row),
        _totalPaid: Number(row.periodReceiptTotal || 0),
        _cf: Number(row.netBalance || 0),
      }));
      printRows.push({ __subtotal: ["Subtotal", "", bfText(gBF), formatMoney(gRent), dash(gOther), formatMoney(gAmtPaid), dash(gOtherPaid), formatMoney(gTotalPaid), formatMoney(gBalance), "", ""] });
    });

    const columns = [
      { label: termTenant, value: (r) => r.tenantName || "—" },
      { label: termUnit, value: (r) => r.unitNumber || "—" },
      { label: "BAL B/F", align: "right", value: (r) => bfText(r._bf), tone: (r) => (r._bf > 0 ? "neg" : r._bf < 0 ? "pos" : "muted") },
      { label: "Rent", align: "right", value: (r) => formatMoney(r.rentInvoiced) },
      { label: "Other Exp'd", align: "right", value: (r) => dash(r._otherExpd), tone: (r) => (r._otherExpd > 0 ? "" : "muted") },
      { label: "Rent Paid", align: "right", value: (r) => formatMoney(r._rentPaid), tone: () => "pos" },
      { label: "Others Paid", align: "right", value: (r) => dash(r._otherPaid), tone: (r) => (r._otherPaid > 0 ? "pos" : "muted") },
      { label: "Total Paid", align: "right", value: (r) => formatMoney(r._totalPaid), tone: () => "pos" },
      { label: "BAL C/F", align: "right", value: (r) => formatMoney(r._cf), tone: (r) => balTone(r._cf) },
      { label: "Oldest Due", value: (r) => (r.oldestDueDate ? fmtDate(r.oldestDueDate) : "—") },
      { label: "Status", value: (r) => STATUS_LABEL[r.status] || (r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : "—"), tone: (r) => (r.status === "owing" ? "neg" : r.status === "credit" ? "pos" : "muted") },
    ];

    const printed = printTabularList({
      title: "Paid & Balance Report",
      subtitle: `Tenant receivables — ${dateRange}`,
      company: currentCompany,
      columns,
      rows: printRows,
      summaryItems: [
        ["Invoiced", formatMoney(summ.totalInvoiced)],
        ["Paid", formatMoney(grandTotalPaid)],
        ["Outstanding", formatMoney(summ.totalOutstanding)],
        ["Unapplied Credit", formatMoney(summ.totalUnappliedCredit)],
        ["Net Balance", formatMoney(summ.netBalance)],
        ["Arrears", String(summ.owingCount || 0)],
        ["Overpaid", String(summ.creditCount || 0)],
        ["Settled", String(summ.settledCount || 0)],
        ["Settlement Rate", formatPercent(balanceInsights.settlementRate)],
        ["Largest Debtor", balanceInsights.largestOwing ? `${balanceInsights.largestOwing.tenantName} (${formatMoney(balanceInsights.largestOwing.netBalance)})` : "—"],
        ["Largest Credit", balanceInsights.largestCredit ? `${balanceInsights.largestCredit.tenantName} (${formatMoney(Math.abs(Number(balanceInsights.largestCredit.netBalance || 0)))})` : "—"],
        [`${termProperty}s`, String(enrichedPropertyGroups.length)],
        [`${termTenants}`, String(searchFilteredRows.length)],
        ["Oldest Due", balanceInsights.earliestArrear?.tenantName ? `${balanceInsights.earliestArrear.tenantName} (${fmtDate(balanceInsights.earliestArrear.oldestDueDate)})` : "—"],
      ],
      totalsRow: ["GRAND TOTAL", `${allRows.length} tenants`, bfText(grandBF), formatMoney(grandRent), dash(grandOther), formatMoney(grandAmtPaid), dash(grandOtherPaid), formatMoney(grandTotalPaid), formatMoney(grandBalance), "", ""],
    });
    if (!printed) toast.error(POPUP_BLOCKED);
  }, [canExportReports, currentCompany, searchFilteredRows, report.summary, filters, termTenant, termTenants, termUnit, termProperty, balanceInsights, enrichedPropertyGroups]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <style>{REPORT_STYLE}</style>
        <div className="mx-auto flex h-full w-full max-w-none min-h-0 flex-1 flex-col gap-2">
          <ListToolbar>
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
              {searchFilteredRows.length} tenant{searchFilteredRows.length !== 1 ? "s" : ""}{summary.owingCount ? ` · ${summary.owingCount} in arrears` : ""}
            </span>
            <ListToolbar.Divider />
            <AppSelect value={selMonth} onChange={(v) => applyMonthYear(v, selYear)} options={MONTHS} placeholder="Month" clearable compact />
            <AppSelect value={selYear} onChange={(v) => applyMonthYear(selMonth, v ?? selYear)} options={yearSelectOptions} compact />
            <ListToolbar.Input type="date" width="w-32" value={filters.startDate} onChange={setFilter("startDate")} />
            <ListToolbar.Input type="date" width="w-32" value={filters.asOfDate} onChange={setFilter("asOfDate")} />
            <AppSelect value={filters.propertyId || null} onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? '' }))} options={propertyFilterOptions} placeholder={termProperty} searchable clearable compact />
            <AppSelect value={filters.status === 'all' ? null : filters.status} onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "all" }))} options={STATUS_FILTER_OPTIONS} placeholder="All tenant positions" clearable compact />
            <ListToolbar.Input value={filters.search} onChange={setFilter("search")} placeholder={`Search ${termTenant.toLowerCase()}, ${termProperty.toLowerCase()}, ${termUnit.toLowerCase()}`} width="w-52" />
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={resetFilters} disabled={loading}>Reset</ListToolbar.Button>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaFileDownload} variant="outline" onClick={handleExportCSV} disabled={!canExportReports}>Export</ListToolbar.Button>
            <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrint} disabled={!canExportReports}>Print</ListToolbar.Button>
            <ListToolbar.Button icon={FaSyncAlt} variant="outline" onClick={() => loadReport()}>Refresh</ListToolbar.Button>
          </ListToolbar>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white border border-slate-200 shadow-lg">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                      <tr>
                        {COLS.map((h, i) => (
                          <th key={h} className={`whitespace-nowrap px-2 py-1.5 text-left font-bold text-[9px] tracking-wide ${i >= 2 && i <= 7 ? 'text-right' : ''} ${i < COLS.length - 1 ? 'border-r border-white/10' : ''}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enrichedPropertyGroups.length === 0 ? (
                        <tr>
                          <td colSpan={COLS.length} className="px-3 py-6 text-center text-slate-400 text-[11px]">
                            {loading ? 'Loading...' : 'No tenants matched the selected filters.'}
                          </td>
                        </tr>
                      ) : enrichedPropertyGroups.map((group) => {
                        const gRows = group.rows;
                        // Use pre-computed _rentPaid / _otherPaid / _otherExpd / _balBF per row
                        const gBF      = gRows.reduce((s, r) => s + r._balBF,     0);
                        const gRent    = sumRows(gRows, 'rentInvoiced');
                        const gOther   = gRows.reduce((s, r) => s + r._otherExpd,  0);
                        const gRentP   = gRows.reduce((s, r) => s + r._rentPaid,   0);
                        const gOtherP  = gRows.reduce((s, r) => s + r._otherPaid,  0);
                        const gTotalP  = gRows.reduce((s, r) => s + r._totalPaid,  0);
                        const gBalance = sumRows(gRows, 'netBalance');
                        const gOwing   = gRows.filter((r) => r.status === 'owing').length;
                        const gCredit  = gRows.filter((r) => r.status === 'credit').length;
                        const gSettled = gRows.filter((r) => r.status === 'settled').length;

                        return (
                          <React.Fragment key={group.propertyId}>
                            {/* Property header row */}
                            <tr className="bg-[#0B3B2E]/8 border-y border-[#0B3B2E]/20">
                              <td colSpan={2} className="px-2 py-1.5 border-r border-[#0B3B2E]/20">
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-[10px] text-[#0B3B2E] uppercase tracking-wide">{group.propertyName}</span>
                                  <span className="text-[8px] text-slate-500 font-semibold">{gRows.length} unit{gRows.length !== 1 ? 's' : ''}</span>
                                  {gOwing > 0 && <span className="text-[8px] text-red-600 font-bold">{gOwing} {STATUS_LABEL.owing}</span>}
                                  {gCredit > 0 && <span className="text-[8px] text-emerald-700 font-bold">{gCredit} {STATUS_LABEL.credit}</span>}
                                  {gSettled > 0 && <span className="text-[8px] text-slate-400 font-bold">{gSettled} {STATUS_LABEL.settled}</span>}
                                </div>
                              </td>
                              <td className={`px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold ${gBF > 0 ? 'text-orange-600' : gBF < 0 ? 'text-emerald-700' : ''}`}>{gBF !== 0 ? formatMoney(gBF) : <span className="text-slate-300">—</span>}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-slate-700">{formatMoney(gRent)}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-slate-700">{gOther > 0 ? formatMoney(gOther) : <span className="text-slate-300">—</span>}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-emerald-700">{formatMoney(gRentP)}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-emerald-700">{gOtherP > 0 ? formatMoney(gOtherP) : <span className="text-white/30">—</span>}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-black text-emerald-700">{formatMoney(gTotalP)}</td>
                              <td className={`px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] ${balCfStyle(gBalance)}`}>{formatMoney(gBalance)}</td>
                              <td colSpan={2} />
                            </tr>

                            {/* Tenant rows — use pre-computed _* fields to avoid re-invoking calc helpers */}
                            {gRows.map((row, i) => {
                              const balCf = Number(row.netBalance || 0);
                              return (
                                <tr key={`${row.tenantId}-${row.unitId || i}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/40 hover:bg-emerald-50/30'}`}>
                                  <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900 whitespace-nowrap">{row.tenantName}</td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-slate-500 whitespace-nowrap">{row.unitNumber || '—'}</td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-right">
                                    {row._balBF > 0 ? <span className="text-orange-600 font-semibold">{formatMoney(row._balBF)}</span> : row._balBF < 0 ? <span className="text-emerald-700 font-semibold">{formatMoney(row._balBF)}</span> : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.rentInvoiced)}</td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-right">
                                    {row._otherExpd > 0
                                      ? <span className="pb-tooltip text-slate-700 underline decoration-dotted decoration-slate-400" data-tip={row._otherExpdTip || undefined}>{formatMoney(row._otherExpd)}</span>
                                      : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-right text-emerald-700">{formatMoney(row._rentPaid)}</td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-right">
                                    {row._otherPaid > 0
                                      ? <span className="pb-tooltip text-emerald-700 underline decoration-dotted decoration-emerald-400" data-tip={row._otherPaidTip || undefined}>{formatMoney(row._otherPaid)}</span>
                                      : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-right font-bold text-emerald-700">{formatMoney(row._totalPaid)}</td>
                                  <td className={`px-2 py-1 border-r border-gray-100 text-right ${balCfStyle(balCf)}`}>{formatMoney(balCf)}</td>
                                  <td className="px-2 py-1 border-r border-gray-100 text-slate-500 whitespace-nowrap text-[9px]">
                                    {row.oldestDueDate ? fmtDate(row.oldestDueDate) : <span className="text-slate-300">—</span>}
                                  </td>
                                  <td className="px-2 py-1">
                                    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-black ${statusStyle(row.status)}`}>
                                      {STATUS_LABEL[row.status] || row.status}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}

                      {/* Grand total row — uses memoized grandTotals to avoid re-summing on each render */}
                      {enrichedPropertyGroups.length > 0 && (
                        <tr className="border-t-2 border-[#0B3B2E] bg-[#0B3B2E] text-white">
                          <td className="px-2 py-1.5 font-black text-[9px] tracking-wide uppercase">Grand Total</td>
                          <td className="px-2 py-1.5 text-[9px] text-white/60 border-r border-white/10">{searchFilteredRows.length} tenants</td>
                          <td className={`px-2 py-1.5 border-r border-white/10 text-right font-bold text-[9px] ${grandTotals.totalBF > 0 ? 'text-orange-300' : grandTotals.totalBF < 0 ? 'text-emerald-300' : ''}`}>{grandTotals.totalBF !== 0 ? formatMoney(grandTotals.totalBF) : '—'}</td>
                          <td className="px-2 py-1.5 border-r border-white/10 text-right font-bold text-[9px]">{formatMoney(grandTotals.totalRent)}</td>
                          <td className="px-2 py-1.5 border-r border-white/10 text-right font-bold text-[9px]">{grandTotals.totalOther > 0 ? formatMoney(grandTotals.totalOther) : '—'}</td>
                          <td className="px-2 py-1.5 border-r border-white/10 text-right font-bold text-[9px]">{formatMoney(grandTotals.totalRentPaid)}</td>
                          <td className="px-2 py-1.5 border-r border-white/10 text-right font-bold text-[9px]">{grandTotals.totalOtherPaid > 0 ? formatMoney(grandTotals.totalOtherPaid) : '—'}</td>
                          <td className="px-2 py-1.5 border-r border-white/10 text-right font-black text-[9px] text-emerald-300">{formatMoney(grandTotals.totalPaidGross)}</td>
                          <td className={`px-2 py-1.5 border-r border-white/10 text-right font-black text-[9px] ${grandTotals.totalBalance > 0 ? 'text-red-300' : grandTotals.totalBalance < 0 ? 'text-emerald-300' : ''}`}>{formatMoney(grandTotals.totalBalance)}</td>
                          <td colSpan={2} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PaidBalanceReport;
