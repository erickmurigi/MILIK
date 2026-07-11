import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties } from '../../redux/selectors';
import { getTenantPaidBalanceReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaBalanceScale, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const ITEMS_PER_PAGE = 50;

const PaidBalanceReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const companyName = currentCompany?.name
    || currentCompany?.companyName
    || currentCompany?.businessName
    || currentUser?.company?.name
    || currentUser?.company?.companyName
    || 'Milik';

  const [loading, setLoading] = useState(false);
  const [filtersChanged, setFiltersChanged] = useState(false);
  const filtersInitialized = useRef(false);
  const [filters, setFilters] = useTabState("/reports/paid-balance:filters", () => ({
    asOfDate: toDateInputValue(new Date()),
    propertyId: '',
    status: 'all',
    search: '',
  }));
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [report, setReport] = useState({ summary: {}, rows: [] });
  const [currentPage, setCurrentPage] = useTabState("/reports/paid-balance:currentPage", 1);

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch]);

  const loadReport = async (signal) => {
    if (!businessId) return;
    setLoading(true);
    setFiltersChanged(false);
    try {
      const data = await getTenantPaidBalanceReport({ business: businessId, ...filters }, signal);
      if (signal?.aborted) return;
      setReport({
        summary: data?.summary || {},
        rows: Array.isArray(data?.rows) ? data.rows : [],
      });
    } catch (error) {
      if (error?.name === 'CanceledError' || error?.name === 'AbortError') return;
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load paid and balance report.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  // Auto-load only when active company changes
  useEffect(() => {
    if (!businessId) return;
    const controller = new AbortController();
    loadReport(controller.signal);
    return () => controller.abort();
  }, [businessId]);

  // Track filter changes (search is applied client-side, others trigger stale indicator)
  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    setFiltersChanged(true);
  }, [filters.asOfDate, filters.propertyId, filters.status]);

  const searchFilteredRows = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const term = String(filters.search || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      [row.tenantName, row.propertyName, row.unitNumber].join(' ').toLowerCase().includes(term)
    );
  }, [report.rows, filters.search]);

  const paginatedRows = useMemo(() => {
    const startIndex = (Math.max(currentPage, 1) - 1) * ITEMS_PER_PAGE;
    return searchFilteredRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [searchFilteredRows, currentPage]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(searchFilteredRows.length / ITEMS_PER_PAGE));
  }, [searchFilteredRows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.asOfDate, filters.propertyId, filters.status, filters.search]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const summary = report.summary || {};
  const propertyNameMap = useMemo(() => new Map(properties.map((property) => [String(property?._id), property?.propertyName || property?.name || 'Unnamed Property'])), [properties]);

  const balanceInsights = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const owingRows = [], creditRows = [], settledRows = [];
    rows.forEach(row => {
      const s = String(row?.status);
      if (s === 'owing') owingRows.push(row);
      else if (s === 'credit') creditRows.push(row);
      else if (s === 'settled') settledRows.push(row);
    });
    const largestOwing = [...owingRows].sort((a, b) => Number(b?.netBalance || 0) - Number(a?.netBalance || 0))[0] || null;
    const largestCredit = [...creditRows].sort((a, b) => Number(a?.netBalance || 0) - Number(b?.netBalance || 0))[0] || null;
    const earliestArrear = [...owingRows]
      .filter((row) => row?.oldestDueDate)
      .sort((a, b) => new Date(a.oldestDueDate) - new Date(b.oldestDueDate))[0] || null;
    const tenantCount = Number(summary.tenantCount || rows.length || 0);
    const settlementRate = tenantCount > 0 ? (settledRows.length / tenantCount) * 100 : null;
    const averageOutstanding = owingRows.length > 0 ? Number(summary.totalOutstanding || 0) / owingRows.length : 0;

    return {
      largestOwing,
      largestCredit,
      earliestArrear,
      settlementRate,
      averageOutstanding,
      narrative: [
        owingRows.length > 0
          ? `${owingRows.length} tenant account${owingRows.length === 1 ? '' : 's'} are currently in arrears, with an average outstanding balance of ${formatMoney(averageOutstanding)}.`
          : 'No tenants are currently in an owing position for the selected filters.',
        largestOwing
          ? `${largestOwing.tenantName} carries the highest net debtor position at ${formatMoney(largestOwing.netBalance)}.`
          : 'There is no dominant debtor concentration to highlight yet.',
        creditRows.length > 0
          ? `${creditRows.length} tenant account${creditRows.length === 1 ? '' : 's'} hold unapplied credit or prepayment, led by ${largestCredit?.tenantName || 'the top credit tenant'}.`
          : 'There is no unapplied tenant credit exposed in the selected view.',
      ],
    };
  }, [report.rows, summary.tenantCount, summary.totalOutstanding]);

  const filterSummary = useMemo(() => ([
    { label: 'As At', value: formatDate(filters.asOfDate) },
    { label: 'Property', value: filters.propertyId ? propertyNameMap.get(String(filters.propertyId)) || 'Selected property' : 'All properties' },
    { label: 'Position Filter', value: filters.status === 'all' ? 'All tenant positions' : filters.status },
    { label: 'Search', value: filters.search || 'No free-text filter' },
  ]), [filters, propertyNameMap]);

  const printGeneratedAt = useMemo(() => new Date().toLocaleString(), []);

  const handleExportCSV = () => {
    if (!canExportReports) {
      toast.warning ? toast.warning("You do not have permission to export reports") : toast.error("You do not have permission to export reports");
      return;
    }
    const header = ['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid Applied', 'Outstanding', 'Unapplied Credit', 'Net Balance', 'Rent Balance', 'Utility Balance', 'Penalty Balance', 'Deposit Balance', 'Other Balance', 'Oldest Due', 'Last Payment', 'Status'];
    const rows = (report.rows || []).map((row) => [
      row.tenantName || '',
      row.propertyName || '',
      row.unitNumber || '',
      row.totalInvoiced || 0,
      row.totalPaidApplied || 0,
      row.outstanding || 0,
      row.unappliedCredit || 0,
      row.netBalance || 0,
      row.rentBalance || 0,
      row.utilityBalance || 0,
      row.penaltyBalance || 0,
      row.depositBalance || 0,
      row.otherBalance || 0,
      row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '',
      row.lastPaymentDate ? new Date(row.lastPaymentDate).toLocaleDateString() : '',
      row.status || '',
    ]);

    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

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
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const by = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const rows = searchFilteredRows;
    const summ = report.summary || {};
    win.document.write(`<!DOCTYPE html><html><head><title>Paid & Balance Report</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:12px;font-weight:900;color:#0f172a;margin-top:3px}
      table{width:100%;border-collapse:collapse;font-size:8.5px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 6px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      .ba{display:inline-block;padding:1px 6px;border-radius:99px;font-size:7.5px;font-weight:800}
      .owing{background:#fee2e2;color:#b91c1c}.credit{background:#d1fae5;color:#065f46}.settled{background:#f1f5f9;color:#475569}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Paid &amp; Balance Report</div><div class="sub">As at ${formatDate(filters.asOfDate)}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div><div>Prepared by: ${by}</div><div>Tenants: ${rows.length}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Tenants</div><div class="cv">${Number(summ.tenantCount || rows.length)}</div></div>
      <div class="card"><div class="cl">Total Invoiced</div><div class="cv">${fmt(summ.totalInvoiced)}</div></div>
      <div class="card"><div class="cl">Total Outstanding</div><div class="cv" style="color:#b91c1c">${fmt(summ.totalOutstanding)}</div></div>
      <div class="card"><div class="cl">Total Credit</div><div class="cv" style="color:#047857">${fmt(summ.totalCredit)}</div></div>
    </div>
    <table><thead><tr><th>Tenant</th><th>Property</th><th>Unit</th><th class="r">Invoiced</th><th class="r">Paid Applied</th><th class="r">Outstanding</th><th class="r">Unapplied</th><th class="r">Net Balance</th><th>Oldest Due</th><th>Status</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td><strong>${row.tenantName}</strong></td><td>${row.propertyName}</td><td>${row.unitNumber}</td><td class="r">${fmt(row.totalInvoiced)}</td><td class="r">${fmt(row.totalPaidApplied)}</td><td class="r" style="color:${row.outstanding > 0 ? '#b91c1c' : 'inherit'}">${fmt(row.outstanding)}</td><td class="r">${fmt(row.unappliedCredit)}</td><td class="r" style="color:${row.netBalance > 0 ? '#b91c1c' : row.netBalance < 0 ? '#047857' : 'inherit'}"><strong>${fmt(row.netBalance)}</strong></td><td>${row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '—'}</td><td><span class="ba ${row.status}">${row.status}</span></td></tr>`).join('')}</tbody>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, currentUser, searchFilteredRows, report.summary, filters.asOfDate]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="print-only-wrapper">
        <style>{`
          @page { size: landscape; margin: 11mm; }
          .report-print-shell { font-family: 'Nunito Sans', Arial, sans-serif; color: #0f172a; }
          .report-print-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
          .report-print-brand { color: #0B3B2E; }
          .report-print-title { margin: 2px 0 4px; font-size: 22px; font-weight: 900; color: #0f172a; }
          .report-print-subtitle { margin: 0; font-size: 11px; line-height: 1.45; color: #475569; max-width: 780px; }
          .report-print-meta { text-align: right; font-size: 10px; color: #475569; }
          .report-print-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
          .report-print-metric { border: 1px solid #dbe2ea; border-radius: 12px; background: #f8fafc; padding: 10px 12px; }
          .report-print-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; font-weight: 800; }
          .report-print-value { margin-top: 6px; font-size: 17px; font-weight: 900; color: #0f172a; }
          .report-print-section { margin-top: 14px; }
          .report-print-section-title { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em; color: #0B3B2E; font-weight: 900; }
          .report-print-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; padding: 10px 12px; border: 1px solid #dbe2ea; border-radius: 12px; background: #ffffff; }
          .report-print-filter-item { font-size: 10px; color: #334155; }
          .report-print-filter-item strong { color: #0f172a; }
          .report-print-insights { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
          .report-print-insight { border-left: 4px solid #0B3B2E; background: #f8fafc; border-radius: 10px; padding: 10px 12px; font-size: 10px; line-height: 1.5; }
          .report-print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
          .report-print-table th, .report-print-table td { border: 1px solid #dbe2ea; padding: 6px 8px; vertical-align: top; }
          .report-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; text-align: left; }
          .report-print-table tbody tr:nth-child(even) { background: #fafafa; }
          .text-right { text-align: right; }
          .text-red { color: #b91c1c; font-weight: 800; }
          .text-emerald { color: #047857; font-weight: 800; }
          .text-amber { color: #b45309; font-weight: 800; }
        `}</style>

        <div className="report-print-shell">
          <div className="report-print-header">
            <div>
              <div className="report-print-brand report-print-label">{companyName}</div>
              <h1 className="report-print-title">Paid &amp; Balance Report</h1>
              <p className="report-print-subtitle">
                Tenant receivables control snapshot showing invoiced amounts, applied receipts, current debtor positions, unapplied credit and the accounts that require fastest follow-up.
              </p>
            </div>
            <div className="report-print-meta">
              <div><strong>As At:</strong> {formatDate(filters.asOfDate)}</div>
              <div><strong>Generated:</strong> {printGeneratedAt}</div>
              <div><strong>Prepared by:</strong> {[currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || 'Milik Admin'}</div>
            </div>
          </div>

          <div className="report-print-section">
            <div className="report-print-filters">
              {filterSummary.map((item) => (
                <div key={item.label} className="report-print-filter-item"><strong>{item.label}:</strong> {item.value}</div>
              ))}
            </div>
          </div>

          <div className="report-print-section report-print-grid">
            {[
              { label: 'Total Invoiced', value: formatMoney(summary.totalInvoiced) },
              { label: 'Paid Applied', value: formatMoney(summary.totalPaidApplied) },
              { label: 'Outstanding', value: formatMoney(summary.totalOutstanding) },
              { label: 'Unapplied Credit', value: formatMoney(summary.totalUnappliedCredit) },
            ].map((card) => (
              <div key={card.label} className="report-print-metric">
                <div className="report-print-label">{card.label}</div>
                <div className="report-print-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="report-print-section report-print-grid">
            {[
              { label: 'Net Balance', value: formatMoney(summary.netBalance) },
              { label: 'Owing Accounts', value: Number(summary.owingCount || 0).toLocaleString() },
              { label: 'Credit Accounts', value: Number(summary.creditCount || 0).toLocaleString() },
              { label: 'Settlement Rate', value: formatPercent(balanceInsights.settlementRate) },
            ].map((card) => (
              <div key={card.label} className="report-print-metric">
                <div className="report-print-label">{card.label}</div>
                <div className="report-print-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="report-print-section report-print-insights">
            {balanceInsights.narrative.map((item, index) => (
              <div key={`${item}-${index}`} className="report-print-insight">{item}</div>
            ))}
          </div>

          <div className="report-print-section">
            <h2 className="report-print-section-title">Tenant Positions</h2>
            <table className="report-print-table">
              <thead>
                <tr>
                  {['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid', 'Outstanding', 'Credit', 'Net Balance', 'Rent Balance', 'Utility Balance', 'Penalty Balance', 'Deposit Balance', 'Other Balance', 'Oldest Due', 'Last Payment', 'Status'].map((header) => <th key={header}>{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {(report.rows || []).length === 0 ? (
                  <tr><td colSpan={16}>No tenants matched the selected filters.</td></tr>
                ) : (report.rows || []).map((row) => (
                  <tr key={row.tenantId}>
                    <td>{row.tenantName}</td>
                    <td>{row.propertyName}</td>
                    <td>{row.unitNumber}</td>
                    <td className="text-right">{formatMoney(row.totalInvoiced)}</td>
                    <td className="text-right text-emerald">{formatMoney(row.totalPaidApplied)}</td>
                    <td className="text-right text-red">{formatMoney(row.outstanding)}</td>
                    <td className="text-right text-amber">{formatMoney(row.unappliedCredit)}</td>
                    <td className={`text-right ${Number(row.netBalance || 0) > 0 ? 'text-red' : Number(row.netBalance || 0) < 0 ? 'text-emerald' : ''}`}>{formatMoney(row.netBalance)}</td>
                    <td className="text-right">{formatMoney(row.rentBalance)}</td>
                    <td className="text-right">{formatMoney(row.utilityBalance)}</td>
                    <td className="text-right">{formatMoney(row.penaltyBalance)}</td>
                    <td className="text-right">{formatMoney(row.depositBalance)}</td>
                    <td className="text-right">{formatMoney(row.otherBalance)}</td>
                    <td>{formatDate(row.oldestDueDate)}</td>
                    <td>{formatDate(row.lastPaymentDate)}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #0B3B2E; box-shadow: 0 0 0 1px rgba(11,59,46,0.2); outline: none; }
        `}</style>

        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
                <input type="date" value={filters.asOfDate} onChange={setFilter("asOfDate")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <select value={filters.propertyId} onChange={setFilter("propertyId")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
                  <option value="">All properties</option>
                  {properties.map((property) => <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>)}
                </select>
                <select value={filters.status} onChange={setFilter("status")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
                  <option value="all">All tenant positions</option>
                  <option value="owing">Owing</option>
                  <option value="credit">Credit</option>
                  <option value="settled">Settled</option>
                </select>
                <input value={filters.search} onChange={setFilter("search")} placeholder="Search tenant, property, unit" className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                <button onClick={handleExportCSV} disabled={!canExportReports} title={canExportReports ? "Export CSV" : "No export permission"} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} title={canExportReports ? "Print" : "No print permission"} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint /> Print</button>
                <button onClick={loadReport} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] transition ${filtersChanged ? 'border border-[#0B3B2E] bg-[#0B3B2E] text-white hover:bg-[#0A3127]' : 'border border-slate-200 bg-white text-slate-700 hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white'}`}><FaSyncAlt className={loading ? 'animate-spin' : ''} /> {filtersChanged ? 'Apply Filters' : 'Refresh'}</button>
              </div>
            </div>

            {/* ── Stat strip ── */}
            <div className="flex-shrink-0 overflow-x-auto border-b border-slate-100 bg-white">
              <div className="flex min-w-max divide-x divide-slate-100">
                {[
                  { label: 'Total Invoiced',   value: formatMoney(summary.totalInvoiced),          accent: 'text-slate-800',   sub: null },
                  { label: 'Paid Applied',      value: formatMoney(summary.totalPaidApplied),       accent: 'text-emerald-700', sub: null },
                  { label: 'Outstanding',       value: formatMoney(summary.totalOutstanding),       accent: 'text-red-600',     sub: Number(summary.totalOutstanding || 0) > 0 ? `${summary.owingCount || 0} owing account(s)` : null },
                  { label: 'Unapplied Credit',  value: formatMoney(summary.totalUnappliedCredit),   accent: 'text-amber-600',   sub: Number(summary.totalUnappliedCredit || 0) > 0 ? `${summary.creditCount || 0} credit account(s)` : null },
                  { label: 'Net Balance',       value: formatMoney(summary.netBalance),             accent: 'text-slate-800',   sub: null },
                  { label: 'Tenant Rows',       value: Number(summary.tenantCount || 0).toLocaleString(), accent: 'text-slate-800', sub: null },
                  { label: 'Largest Debtor',    value: balanceInsights.largestOwing?.tenantName || '—', accent: 'text-red-600', sub: balanceInsights.largestOwing ? formatMoney(balanceInsights.largestOwing.netBalance) : null },
                  { label: 'Largest Credit',    value: balanceInsights.largestCredit?.tenantName || '—', accent: 'text-emerald-700', sub: balanceInsights.largestCredit ? formatMoney(Math.abs(Number(balanceInsights.largestCredit.netBalance || 0))) : null },
                  { label: 'Settlement Rate',   value: formatPercent(balanceInsights.settlementRate), accent: 'text-slate-800', sub: 'Share of fully settled accounts' },
                ].map((item) => (
                  <div key={item.label} className="min-w-[115px] flex-1 px-3 py-2.5">
                    <p className="whitespace-nowrap text-[9px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                    <p className={`mt-0.5 whitespace-nowrap text-[13px] font-black ${item.accent}`}>{item.value}</p>
                    {item.sub && <p className="mt-0.5 whitespace-nowrap text-[9px] leading-tight text-slate-400">{item.sub}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-1.5">
              <div className="mb-1.5 flex flex-shrink-0 flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                <span>Owing: {summary.owingCount || 0}</span>
                <span>Credit: {summary.creditCount || 0}</span>
                <span>Settled: {summary.settledCount || 0}</span>
                {balanceInsights.earliestArrear?.tenantName && <span>Oldest due: {balanceInsights.earliestArrear.tenantName} ({formatDate(balanceInsights.earliestArrear.oldestDueDate)})</span>}
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200">
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    <tr>
                      {['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid', 'Outstanding', 'Unapplied Credit', 'Net Balance', 'Rent Bal', 'Utility Bal', 'Penalty Bal', 'Deposit Bal', 'Other Bal', 'Oldest Due', 'Last Payment', 'Status'].map((header, i, arr) => <th key={header} className={`whitespace-nowrap px-2 py-1 text-left font-bold ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(report.rows || []).length === 0 ? (
                      <tr><td colSpan={16} className="px-2 py-4 text-center text-slate-500">No tenants matched the selected filters.</td></tr>
                    ) : paginatedRows.map((row, i) => (
                      <tr key={row.tenantId} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                        <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.tenantName}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.propertyName}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.totalInvoiced)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-emerald-700">{formatMoney(row.totalPaidApplied)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-red-600">{formatMoney(row.outstanding)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-amber-700">{formatMoney(row.unappliedCredit)}</td>
                        <td className={`px-2 py-1 border-r border-gray-100 font-bold ${Number(row.netBalance || 0) > 0 ? 'text-red-700' : Number(row.netBalance || 0) < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{formatMoney(row.netBalance)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.rentBalance)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.utilityBalance)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.penaltyBalance)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.depositBalance)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.otherBalance)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatDate(row.oldestDueDate)}</td>
                        <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatDate(row.lastPaymentDate)}</td>
                        <td className="px-2 py-1">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${row.status === 'owing' ? 'border-red-200 bg-red-100 text-red-700' : row.status === 'credit' ? 'border-emerald-200 bg-emerald-100 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                  <div>
                    Showing {searchFilteredRows.length ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}-
                    {Math.min(currentPage * ITEMS_PER_PAGE, searchFilteredRows.length)} of {searchFilteredRows.length} tenant row(s)
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">50 items per page</span>
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="font-semibold text-slate-700">Page {currentPage} of {totalPages}</span>
                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
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
