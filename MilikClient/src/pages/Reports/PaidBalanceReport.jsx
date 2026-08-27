import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import AppSelect from '../../components/common/AppSelect';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties } from '../../redux/selectors';
import { getTenantPaidBalanceReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import ResetFiltersButton from '../../components/common/ResetFiltersButton';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import useDebounce from '../../hooks/useDebounce';

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

// Module-scope constant — avoids allocating a new array on every render
const COLS = ['Tenant', 'Unit', 'BAL B/F', 'Rent', 'Other Exp\'d', 'Rent Paid', 'Others Paid', 'Total Paid', 'BAL C/F', 'Oldest Due', 'Status'];

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
  const canExportReports = useMemo(
    () => hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]),
    [currentUser, currentCompany]
  );
  const properties = useSelector(selectAllProperties);

  const businessId = useMemo(
    () => currentCompany?._id || currentUser?.company?._id || currentUser?.company || '',
    [currentCompany, currentUser]
  );
  const companyName = useMemo(
    () => currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || currentUser?.company?.name || 'Milik',
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
      return {
        ...row,
        _otherExpd,
        _rentPaid,
        _otherPaid,
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
    totalBalance:   sumRows(searchFilteredRows, 'netBalance'),
  }), [searchFilteredRows]);

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
    const header = ['Property', 'Tenant', 'Unit', 'BAL B/F', 'Rent', 'Other Exp\'d', 'Rent Paid', 'Others Paid', 'Total Paid', 'BAL C/F', 'Oldest Due', 'Status'];
    const rows = (report.rows || []).map((row) => [
      row.propertyName || '',
      row.tenantName || '',
      row.unitNumber || '',
      calcBalBF(row),
      row.rentInvoiced || 0,
      calcOtherExpd(row),
      calcRentPaid(row),
      calcOtherPaid(row),
      calcRentPaid(row) + calcOtherPaid(row),
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
  }, [canExportReports, report.rows, filters.asOfDate]);

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.error("You do not have permission to print reports"); return; }

    const GRN = "#0B3B2E";
    const allRows = searchFilteredRows;
    const summ = report.summary || {};
    const dateRange = [filters.startDate && fmtDate(filters.startDate), filters.asOfDate && fmtDate(filters.asOfDate)].filter(Boolean).join(" – ");

    const co = {
      name: companyName,
      logo: currentCompany?.logo || "",
      phone: currentCompany?.phone || currentCompany?.phoneNo || currentCompany?.phoneNumber || "",
      email: currentCompany?.email || currentCompany?.companyEmail || "",
      address: [currentCompany?.address || currentCompany?.postalAddress || "", currentCompany?.town || currentCompany?.city || ""].filter(Boolean).join(", "),
    };
    const infoLine = [co.address, co.phone, co.email].filter(Boolean).join(" · ");

    const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const mon = (v) => esc(formatMoney(v));
    const dash = (v) => Number(v || 0) === 0 ? "—" : mon(v);
    const cfStyle = (v) => Number(v || 0) > 0 ? "color:#dc2626;font-weight:700" : Number(v || 0) < 0 ? "color:#059669;font-weight:700" : "color:#94a3b8";
    const statusColor = (s) => s === "owing" ? "#dc2626" : s === "credit" ? "#059669" : "#64748b";

    // Build grouped rows
    const groups = (() => {
      const map = new Map();
      for (const row of allRows) {
        const key = String(row.propertyId || row.propertyName || "Unknown");
        if (!map.has(key)) map.set(key, { name: row.propertyName || "Unknown Property", rows: [] });
        map.get(key).rows.push(row);
      }
      return [...map.values()];
    })();

    let rowsHtml = "";
    let grandBF = 0, grandRent = 0, grandOther = 0, grandAmtPaid = 0, grandOtherPaid = 0, grandBalance = 0;

    groups.forEach((group) => {
      const gr = group.rows;
      const gBF = sumBalBF(gr);
      const gRent = sumRows(gr, 'rentInvoiced');
      const gOther = sumOtherExpd(gr);
      const gAmtPaid = sumRentPaid(gr);
      const gOtherPaid = sumOtherPaid(gr);
      const gBalance = sumRows(gr, 'netBalance');
      grandBF += gBF; grandRent += gRent; grandOther += gOther;
      grandAmtPaid += gAmtPaid; grandOtherPaid += gOtherPaid; grandBalance += gBalance;

      const gOwing = gr.filter((r) => r.status === 'owing').length;
      const gCredit = gr.filter((r) => r.status === 'credit').length;
      const gSettled = gr.filter((r) => r.status === 'settled').length;
      const badges = [
        gOwing > 0 ? `<span style="color:#dc2626">${gOwing} ${STATUS_LABEL.owing}</span>` : "",
        gCredit > 0 ? `<span style="color:#059669">${gCredit} ${STATUS_LABEL.credit}</span>` : "",
        gSettled > 0 ? `<span style="color:#94a3b8">${gSettled} ${STATUS_LABEL.settled}</span>` : "",
      ].filter(Boolean).join(" &nbsp;&middot;&nbsp; ");

      rowsHtml += `<tr class="prop-hdr">
        <td colspan="2"><span class="prop-name">${esc(group.name)}</span> <span class="prop-meta">${gr.length} unit${gr.length !== 1 ? "s" : ""} &nbsp;&middot;&nbsp; ${badges}</span></td>
        <td style="text-align:right;${gBF > 0 ? "color:#ea580c;font-weight:700" : gBF < 0 ? "color:#059669;font-weight:700" : "color:#94a3b8"}">${gBF !== 0 ? mon(gBF) : "—"}</td>
        <td style="text-align:right">${mon(gRent)}</td>
        <td style="text-align:right">${dash(gOther)}</td>
        <td style="text-align:right;color:#059669;font-weight:700">${mon(gAmtPaid)}</td>
        <td style="text-align:right;${gOtherPaid > 0 ? "color:#059669;font-weight:700" : "color:#94a3b8"}">${dash(gOtherPaid)}</td>
        <td style="text-align:right;color:#059669;font-weight:900">${mon(gAmtPaid + gOtherPaid)}</td>
        <td style="text-align:right;${cfStyle(gBalance)}">${mon(gBalance)}</td>
        <td></td><td></td>
      </tr>`;

      gr.forEach((row, i) => {
        const bf = calcBalBF(row);
        const otherExpd = calcOtherExpd(row);
        const amtPaid = calcRentPaid(row);
        const otherPaid = calcOtherPaid(row);
        const cf = Number(row.netBalance || 0);
        const st = row.status || "";
        rowsHtml += `<tr class="${i % 2 === 1 ? "alt" : ""}">
          <td>${esc(row.tenantName || "—")}</td>
          <td>${esc(row.unitNumber || "—")}</td>
          <td style="text-align:right;${bf > 0 ? "color:#ea580c;font-weight:600" : bf < 0 ? "color:#059669;font-weight:600" : "color:#cbd5e1"}">${bf !== 0 ? mon(bf) : "—"}</td>
          <td style="text-align:right">${mon(row.rentInvoiced)}</td>
          <td style="text-align:right;${otherExpd > 0 ? "" : "color:#cbd5e1"}">${dash(otherExpd)}</td>
          <td style="text-align:right;color:#059669">${mon(amtPaid)}</td>
          <td style="text-align:right;${otherPaid > 0 ? "color:#059669" : "color:#cbd5e1"}">${dash(otherPaid)}</td>
          <td style="text-align:right;color:#059669;font-weight:700">${mon(amtPaid + otherPaid)}</td>
          <td style="text-align:right;${cfStyle(cf)}">${mon(cf)}</td>
          <td>${row.oldestDueDate ? esc(fmtDate(row.oldestDueDate)) : "—"}</td>
          <td style="color:${statusColor(st)};font-weight:700">${esc(STATUS_LABEL[st] || (st.charAt(0).toUpperCase() + st.slice(1)))}</td>
        </tr>`;
      });
    });

    rowsHtml += `<tr class="grand-total">
      <td>GRAND TOTAL</td>
      <td style="color:rgba(255,255,255,.6)">${allRows.length} tenants</td>
      <td style="text-align:right;${grandBF > 0 ? "color:#fca5a5" : grandBF < 0 ? "color:#6ee7b7" : ""}">${grandBF !== 0 ? mon(grandBF) : "—"}</td>
      <td style="text-align:right">${mon(grandRent)}</td>
      <td style="text-align:right">${dash(grandOther)}</td>
      <td style="text-align:right">${mon(grandAmtPaid)}</td>
      <td style="text-align:right">${dash(grandOtherPaid)}</td>
      <td style="text-align:right;font-weight:900">${mon(grandAmtPaid + grandOtherPaid)}</td>
      <td style="text-align:right;${grandBalance > 0 ? "color:#fca5a5" : grandBalance < 0 ? "color:#6ee7b7" : ""}">${mon(grandBalance)}</td>
      <td></td><td></td>
    </tr>`;

    const css = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; padding: 22px 26px; font-size: 11px; }
      .hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding-bottom: 14px; gap: 16px; }
      .hdr-center { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
      .logo-fallback { width: 52px; height: 52px; background: ${GRN}; color: #fff; font-size: 20px; font-weight: 900; display: flex; align-items: center; justify-content: center; border-radius: 8px; }
      .logo-img { max-height: 52px; max-width: 140px; object-fit: contain; border-radius: 6px; }
      .co-name { font-size: 16px; font-weight: 900; color: #0f172a; margin-top: 5px; }
      .co-sub { font-size: 9px; color: #64748b; }
      .rpt-title { font-size: 13px; font-weight: 800; color: #1e293b; margin-top: 5px; }
      .rpt-sub { font-size: 10px; color: #475569; margin-top: 2px; }
      .hdr-right { text-align: right; align-self: flex-start; }
      .print-date { font-size: 9px; color: #64748b; line-height: 1.7; }
      .divider { height: 2px; background: ${GRN}; margin: 12px 0; }
      .summary-bar { display: flex; flex-wrap: wrap; gap: 6px 20px; font-size: 10px; color: #334155; background: #f8fafc; border-left: 3px solid ${GRN}; padding: 7px 10px; margin-bottom: 12px; border-radius: 0 4px 4px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 10px; }
      thead tr { background: ${GRN}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      thead th { color: #fff; padding: 7px 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; border-right: 1px solid rgba(255,255,255,.15); white-space: nowrap; }
      tbody td { padding: 6px 8px; border: 1px solid #e2e8f0; vertical-align: middle; white-space: nowrap; }
      tbody tr.alt td { background: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tr.prop-hdr td { background: #f0faf5; border-top: 2px solid ${GRN}; border-bottom: 1px solid #b7c9c0; padding: 6px 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .prop-name { font-weight: 900; color: ${GRN}; text-transform: uppercase; letter-spacing: .06em; font-size: 9px; }
      .prop-meta { font-size: 8.5px; color: #64748b; margin-left: 8px; }
      tr.grand-total td { background: ${GRN}; color: #fff; font-weight: 700; font-size: 10px; padding: 7px 8px; border: 1px solid rgba(255,255,255,.15); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @media print { body { padding: 10px 12px; } @page { size: A4 landscape; margin: 8mm; } }
    `;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Paid &amp; Balance Report</title><style>${css}</style></head>
<body>
<div class="hdr">
  <div></div>
  <div class="hdr-center">
    ${co.logo ? `<img src="${esc(co.logo)}" class="logo-img" alt="logo"/>` : `<div class="logo-fallback">${esc(co.name.slice(0,1).toUpperCase())}</div>`}
    <div class="co-name">${esc(co.name)}</div>
    ${infoLine ? `<div class="co-sub">${esc(infoLine)}</div>` : ""}
    <div class="rpt-title">Paid &amp; Balance Report</div>
    <div class="rpt-sub">Tenant receivables &mdash; ${esc(dateRange)}</div>
  </div>
  <div class="hdr-right"><div class="print-date">Printed: ${new Date().toLocaleDateString("en-KE", { day:"2-digit", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit" })}<br/>${groups.length} ${groups.length === 1 ? "property" : "properties"} &middot; ${allRows.length} tenants</div></div>
</div>
<div class="divider"></div>
<div class="summary-bar">
  <span>Invoiced: <b>${mon(summ.totalInvoiced)}</b></span>
  <span>Paid: <b style="color:#059669">${mon(summ.totalPaidApplied)}</b></span>
  <span>Outstanding: <b style="color:#dc2626">${mon(summ.totalOutstanding)}</b></span>
  <span>Net Balance: <b>${mon(summ.netBalance)}</b></span>
  <span>Arrears: <b style="color:#dc2626">${summ.owingCount || 0}</b></span>
  <span>Overpaid: <b style="color:#059669">${summ.creditCount || 0}</b></span>
  <span>Settled: <b>${summ.settledCount || 0}</b></span>
</div>
<table>
  <thead><tr>
    <th style="text-align:left">Tenant</th>
    <th style="text-align:left">Unit</th>
    <th style="text-align:right">BAL B/F</th>
    <th style="text-align:right">Rent</th>
    <th style="text-align:right">Other Exp'd</th>
    <th style="text-align:right">Rent Paid</th>
    <th style="text-align:right">Others Paid</th>
    <th style="text-align:right">Total Paid</th>
    <th style="text-align:right">BAL C/F</th>
    <th style="text-align:left">Oldest Due</th>
    <th style="text-align:left">Status</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
</body></html>`;

    const win = window.open("", "_blank", "width=1200,height=800");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 450);
  // propertyGroups removed: handlePrint builds its own groups directly from searchFilteredRows
  }, [canExportReports, companyName, currentCompany, searchFilteredRows, report.summary, filters]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-1.5">
        <style>{REPORT_STYLE}</style>
        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            {/* ── Toolbar ── */}
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className="grid gap-1.5 md:grid-cols-3 xl:grid-cols-6">
                <AppSelect value={selMonth} onChange={(v) => applyMonthYear(v, selYear)} options={MONTHS} placeholder="Month" clearable size="sm" />
                <select value={selYear} onChange={(e) => applyMonthYear(selMonth, e.target.value)} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[#0B3B2E] focus:outline-none">
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <input type="date" value={filters.startDate} onChange={setFilter("startDate")} className="h-7 flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  <span className="flex-shrink-0 text-[10px] font-semibold text-slate-400">–</span>
                  <input type="date" value={filters.asOfDate} onChange={setFilter("asOfDate")} className="h-7 flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </div>
                <AppSelect value={filters.propertyId} onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? '' }))} options={properties.map((p) => ({ value: p._id, label: p.propertyName || p.name }))} placeholder="All properties" searchable clearable size="sm" />
                <AppSelect value={filters.status} onChange={(v) => setFilters((prev) => ({ ...prev, status: v ?? "all" }))} options={[{ value: "owing", label: "Arrears" }, { value: "credit", label: "Overpaid" }, { value: "settled", label: "Settled" }]} placeholder="All tenant positions" clearable size="sm" />
                <input value={filters.search} onChange={setFilter("search")} placeholder="Search tenant, property, unit" className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
            </div>

            {/* ── Stats + Actions bar ── */}
            <div className="flex-shrink-0 flex items-stretch border-b border-slate-200 bg-white">
              <div className="flex-1 overflow-x-auto">
                <div className="flex h-full min-w-max divide-x divide-slate-100">
                  {[
                    { label: 'Period Invoiced', value: formatMoney(summary.totalInvoiced),        accent: 'text-slate-800' },
                    { label: 'Total Paid',       value: formatMoney(summary.totalPaidApplied),     accent: 'text-emerald-700' },
                    { label: 'Outstanding',       value: formatMoney(summary.totalOutstanding),     accent: 'text-red-600',     sub: summary.owingCount ? `${summary.owingCount} in arrears` : null },
                    { label: 'Unapplied Credit',  value: formatMoney(summary.totalUnappliedCredit), accent: 'text-amber-600',   sub: summary.creditCount ? `${summary.creditCount} overpaid` : null },
                    { label: 'Net Balance',       value: formatMoney(summary.netBalance),           accent: 'text-slate-800' },
                    { label: 'Largest Debtor',    value: balanceInsights.largestOwing?.tenantName || '—', accent: 'text-red-600', sub: balanceInsights.largestOwing ? formatMoney(balanceInsights.largestOwing.netBalance) : null },
                    { label: 'Largest Credit',    value: balanceInsights.largestCredit?.tenantName || '—', accent: 'text-emerald-700', sub: balanceInsights.largestCredit ? formatMoney(Math.abs(Number(balanceInsights.largestCredit.netBalance || 0))) : null },
                    { label: 'Settlement Rate',   value: formatPercent(balanceInsights.settlementRate), accent: 'text-slate-800', sub: 'Fully settled' },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col justify-center px-3 py-1.5">
                      <p className="whitespace-nowrap text-[8.5px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                      <p className={`whitespace-nowrap text-[11px] font-black leading-tight ${item.accent}`}>{item.value}</p>
                      {item.sub && <p className="whitespace-nowrap text-[8px] leading-tight text-slate-400">{item.sub}</p>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5 border-l border-slate-200 px-2">
                <button onClick={handleExportCSV} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint /> Print</button>
                <ResetFiltersButton onReset={resetFilters} disabled={loading} />
                <button onClick={() => loadReport()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
            </div>

            {/* ── Info strip ── */}
            <div className="flex-shrink-0 flex flex-wrap gap-3 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] border-b border-slate-100">
              <span className="text-red-600">Arrears: {summary.owingCount || 0}</span>
              <span className="text-emerald-700">Overpaid: {summary.creditCount || 0}</span>
              <span className="text-slate-500">Settled: {summary.settledCount || 0}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">{enrichedPropertyGroups.length} {enrichedPropertyGroups.length === 1 ? 'property' : 'properties'} · {searchFilteredRows.length} tenants</span>
              {balanceInsights.earliestArrear?.tenantName && (
                <span className="text-orange-600">Oldest due: {balanceInsights.earliestArrear.tenantName} ({fmtDate(balanceInsights.earliestArrear.oldestDueDate)})</span>
              )}
            </div>

            {/* ── Table ── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-1.5">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200">
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
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-black text-emerald-700">{formatMoney(gRentP + gOtherP)}</td>
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
                                  <td className="px-2 py-1 border-r border-gray-100 text-right font-bold text-emerald-700">{formatMoney(row._rentPaid + row._otherPaid)}</td>
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
                          <td className="px-2 py-1.5 border-r border-white/10 text-right font-black text-[9px] text-emerald-300">{formatMoney(grandTotals.totalRentPaid + grandTotals.totalOtherPaid)}</td>
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
      </div>
    </DashboardLayout>
  );
};

export default PaidBalanceReport;
