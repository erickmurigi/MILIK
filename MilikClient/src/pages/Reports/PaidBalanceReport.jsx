import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import AppSelect from '../../components/common/AppSelect';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties } from '../../redux/selectors';
import { getTenantPaidBalanceReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const ITEMS_PER_PAGE = 50;

const PaidBalanceReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || currentUser?.company?.name || currentUser?.company?.companyName || 'Milik';

  const [loading, setLoading] = useState(false);
  const [filtersChanged, setFiltersChanged] = useState(false);
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
  const [report, setReport] = useState({ summary: {}, rows: [], allUtilityTypes: [] });
  const [currentPage, setCurrentPage] = useTabState("/reports/paid-balance:currentPage", 1);

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch]);

  const loadReport = async (signal, filterOverrides = {}) => {
    if (!businessId) return;
    setLoading(true);
    setFiltersChanged(false);
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
  };

  useEffect(() => {
    if (!businessId) return;
    const controller = new AbortController();
    loadReport(controller.signal);
    return () => controller.abort();
  }, [businessId]);

  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    setFiltersChanged(true);
  }, [filters.startDate, filters.asOfDate, filters.propertyId, filters.status]);

  const searchFilteredRows = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const term = String(filters.search || '').trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => [row.tenantName, row.propertyName, row.unitNumber].join(' ').toLowerCase().includes(term));
  }, [report.rows, filters.search]);

  const paginatedRows = useMemo(() => {
    const startIndex = (Math.max(currentPage, 1) - 1) * ITEMS_PER_PAGE;
    return searchFilteredRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [searchFilteredRows, currentPage]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(searchFilteredRows.length / ITEMS_PER_PAGE)), [searchFilteredRows]);

  useEffect(() => { setCurrentPage(1); }, [filters.startDate, filters.asOfDate, filters.propertyId, filters.status, filters.search]);
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
  const MONTHS = useMemo(() => ['January','February','March','April','May','June','July','August','September','October','November','December'].map((label, i) => ({ value: String(i + 1), label })), []);
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
    const header = ['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid Applied', 'Outstanding', 'Unapplied Credit', 'Net Balance', 'Rent Balance', ...utilityCols, 'Penalty Balance', 'Deposit Balance', 'Other Balance', 'Oldest Due', 'Last Payment', 'Status'];
    const rows = (report.rows || []).map((row) => [
      row.tenantName || '', row.propertyName || '', row.unitNumber || '',
      row.totalInvoiced || 0, row.totalPaidApplied || 0, row.outstanding || 0,
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
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const by = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || '';
    const win = window.open('', '_blank', 'width=1200,height=900');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const rows = searchFilteredRows;
    const summ = report.summary || {};
    const utTypes = allUtilityTypes;
    const hasUt = utTypes.length > 0;

    const utHeaderCols = hasUt
      ? utTypes.map((ut) => `<th class="r">${ut}</th>`).join('')
      : `<th class="r">Utility Bal</th>`;

    const totRow = {
      totalInvoiced: rows.reduce((s, r) => s + Number(r.totalInvoiced || 0), 0),
      totalPaidApplied: rows.reduce((s, r) => s + Number(r.totalPaidApplied || 0), 0),
      outstanding: rows.reduce((s, r) => s + Number(r.outstanding || 0), 0),
      unappliedCredit: rows.reduce((s, r) => s + Number(r.unappliedCredit || 0), 0),
      netBalance: rows.reduce((s, r) => s + Number(r.netBalance || 0), 0),
      rentBalance: rows.reduce((s, r) => s + Number(r.rentBalance || 0), 0),
      utilityBalance: rows.reduce((s, r) => s + Number(r.utilityBalance || 0), 0),
      penaltyBalance: rows.reduce((s, r) => s + Number(r.penaltyBalance || 0), 0),
      depositBalance: rows.reduce((s, r) => s + Number(r.depositBalance || 0), 0),
      otherBalance: rows.reduce((s, r) => s + Number(r.otherBalance || 0), 0),
    };
    const utTotals = hasUt
      ? utTypes.reduce((m, ut) => { m[ut] = rows.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
      : {};

    const colCount = 10 + (hasUt ? utTypes.length : 1) + 3; // tenant/prop/unit + financials + uts + date/date/status

    win.document.write(`<!DOCTYPE html><html><head><title>Paid &amp; Balance Report — ${name}</title><style>
      @page{size:A4 landscape;margin:10mm 12mm}
      *{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      body{font-family:'Arial Narrow',Arial,sans-serif;color:#0f172a;font-size:8px;margin:0;line-height:1.3}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:6px;margin-bottom:8px;border-bottom:2.5px solid #0B3B2E}
      .hdr-left .co{font-size:10px;font-weight:900;color:#0B3B2E;letter-spacing:.04em;text-transform:uppercase}
      .hdr-left .ttl{font-size:15px;font-weight:900;color:#0f172a;margin:1px 0 2px}
      .hdr-left .sub{font-size:8px;color:#64748b}
      .hdr-right{text-align:right;font-size:7.5px;color:#64748b;line-height:1.7}
      .logo{max-height:36px;max-width:100px;object-fit:contain;margin-bottom:3px;display:block}
      .cards{display:grid;grid-template-columns:repeat(6,1fr);gap:5px;margin-bottom:8px}
      .card{border:1px solid #dbe2ea;border-radius:4px;background:#f8fafc;padding:5px 7px}
      .card.red{border-color:#fee2e2;background:#fff5f5}.card.grn{border-color:#d1fae5;background:#f0fdf4}
      .cl{font-size:6.5px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:10.5px;font-weight:900;color:#0f172a;margin-top:2px;white-space:nowrap}
      .cv.red{color:#b91c1c}.cv.grn{color:#047857}.cv.amb{color:#b45309}
      table{width:100%;border-collapse:collapse;font-size:7.5px}
      thead th{background:#0B3B2E;color:#fff;padding:3px 5px;font-size:6.8px;text-transform:uppercase;letter-spacing:.09em;font-weight:800;white-space:nowrap}
      thead th.r{text-align:right}
      tbody td{border-bottom:1px solid #e2e8f0;padding:2.5px 5px;vertical-align:middle}
      tbody td.r{text-align:right}
      tbody td.name{font-weight:700;color:#0f172a}
      tbody tr:nth-child(even){background:#f8fafc}
      tbody tr:hover{background:#edf4f0}
      tfoot td{border-top:2px solid #0B3B2E;padding:3px 5px;font-weight:900;background:#edf5f1;font-size:7px}
      tfoot td.r{text-align:right}
      .ba{display:inline-block;padding:1px 5px;border-radius:99px;font-size:6.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}
      .owing{background:#fee2e2;color:#b91c1c}.credit{background:#d1fae5;color:#065f46}.settled{background:#f1f5f9;color:#475569}
      .sec-title{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;font-weight:900;margin:8px 0 5px;border-bottom:1px solid #dbe2ea;padding-bottom:3px}
      .filter-row{display:flex;flex-wrap:wrap;gap:4px 16px;margin-bottom:8px;font-size:7.5px;color:#475569}
      .filter-item strong{color:#0f172a}
    </style></head><body>
    <div class="hdr">
      <div class="hdr-left">
        ${logo ? `<img src="${logo}" class="logo" alt="">` : ''}
        <div class="co">${name}</div>
        <div class="ttl">Paid &amp; Balance Report</div>
        <div class="sub">Tenant receivables control snapshot — outstanding debtor positions as at ${fmtDate(filters.asOfDate)}</div>
      </div>
      <div class="hdr-right">
        <div><strong>As At:</strong> ${fmtDate(filters.asOfDate)}</div>
        <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
        <div><strong>Prepared by:</strong> ${by}</div>
        <div><strong>Tenant rows:</strong> ${rows.length}</div>
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-item"><strong>Property:</strong> ${filters.propertyId ? (propertyNameMap.get(String(filters.propertyId)) || 'Selected') : 'All properties'}</span>
      <span class="filter-item"><strong>Position:</strong> ${filters.status === 'all' ? 'All' : filters.status}</span>
      ${filters.search ? `<span class="filter-item"><strong>Search:</strong> ${filters.search}</span>` : ''}
    </div>
    <div class="cards">
      <div class="card"><div class="cl">Total Invoiced</div><div class="cv">${fmt(summ.totalInvoiced)}</div></div>
      <div class="card grn"><div class="cl">Paid Applied</div><div class="cv grn">${fmt(summ.totalPaidApplied)}</div></div>
      <div class="card red"><div class="cl">Outstanding</div><div class="cv red">${fmt(summ.totalOutstanding)}</div></div>
      <div class="card"><div class="cl">Unapplied Credit</div><div class="cv amb">${fmt(summ.totalUnappliedCredit)}</div></div>
      <div class="card"><div class="cl">Net Balance</div><div class="cv">${fmt(summ.netBalance)}</div></div>
      <div class="card"><div class="cl">Owing / Credit / Settled</div><div class="cv">${summ.owingCount || 0} / ${summ.creditCount || 0} / ${summ.settledCount || 0}</div></div>
    </div>
    <div class="sec-title">Tenant Positions</div>
    <table><thead><tr>
      <th>Tenant</th><th>Property</th><th>Unit</th>
      <th class="r">Invoiced</th><th class="r">Paid</th><th class="r">Outstanding</th><th class="r">Unapplied</th><th class="r">Net Bal</th>
      <th class="r">Rent Bal</th>${utHeaderCols}<th class="r">Penalty</th><th class="r">Deposit</th><th class="r">Other</th>
      <th>Oldest Due</th><th>Last Pmt</th><th>Status</th>
    </tr></thead>
    <tbody>${rows.map((row) => {
      const utCells = hasUt
        ? utTypes.map((ut) => `<td class="r">${fmt(row.utilityBreakdown?.[ut] || 0)}</td>`).join('')
        : `<td class="r">${fmt(row.utilityBalance)}</td>`;
      const nbColor = Number(row.netBalance || 0) > 0 ? '#b91c1c' : Number(row.netBalance || 0) < 0 ? '#047857' : 'inherit';
      return `<tr>
        <td class="name">${row.tenantName}</td>
        <td>${row.propertyName}</td>
        <td>${row.unitNumber}</td>
        <td class="r">${fmt(row.totalInvoiced)}</td>
        <td class="r" style="color:#047857">${fmt(row.totalPaidApplied)}</td>
        <td class="r" style="color:${Number(row.outstanding || 0) > 0 ? '#b91c1c' : 'inherit'}">${fmt(row.outstanding)}</td>
        <td class="r" style="color:#b45309">${fmt(row.unappliedCredit)}</td>
        <td class="r" style="color:${nbColor};font-weight:800">${fmt(row.netBalance)}</td>
        <td class="r">${fmt(row.rentBalance)}</td>
        ${utCells}
        <td class="r">${fmt(row.penaltyBalance)}</td>
        <td class="r">${fmt(row.depositBalance)}</td>
        <td class="r">${fmt(row.otherBalance)}</td>
        <td>${row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '—'}</td>
        <td>${row.lastPaymentDate ? new Date(row.lastPaymentDate).toLocaleDateString() : '—'}</td>
        <td><span class="ba ${row.status}">${row.status}</span></td>
      </tr>`;
    }).join('')}</tbody>
    <tfoot><tr>
      <td colspan="3"><strong>TOTALS — ${rows.length} rows</strong></td>
      <td class="r"><strong>${fmt(totRow.totalInvoiced)}</strong></td>
      <td class="r" style="color:#047857"><strong>${fmt(totRow.totalPaidApplied)}</strong></td>
      <td class="r" style="color:#b91c1c"><strong>${fmt(totRow.outstanding)}</strong></td>
      <td class="r"><strong>${fmt(totRow.unappliedCredit)}</strong></td>
      <td class="r"><strong>${fmt(totRow.netBalance)}</strong></td>
      <td class="r"><strong>${fmt(totRow.rentBalance)}</strong></td>
      ${hasUt ? utTypes.map((ut) => `<td class="r"><strong>${fmt(utTotals[ut])}</strong></td>`).join('') : `<td class="r"><strong>${fmt(totRow.utilityBalance)}</strong></td>`}
      <td class="r"><strong>${fmt(totRow.penaltyBalance)}</strong></td>
      <td class="r"><strong>${fmt(totRow.depositBalance)}</strong></td>
      <td class="r"><strong>${fmt(totRow.otherBalance)}</strong></td>
      <td colspan="3"></td>
    </tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, currentUser, searchFilteredRows, report.summary, filters, allUtilityTypes, propertyNameMap]);

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
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                <button onClick={handleExportCSV} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint /> Print</button>
                <button onClick={() => loadReport()} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] transition ${filtersChanged ? 'border border-[#0B3B2E] bg-[#0B3B2E] text-white hover:bg-[#0A3127]' : 'border border-slate-200 bg-white text-slate-700 hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white'}`}><FaSyncAlt className={loading ? 'animate-spin' : ''} /> {filtersChanged ? 'Apply Filters' : 'Refresh'}</button>
              </div>
            </div>

            {/* ── Stat strip ── */}
            <div className="flex-shrink-0 overflow-x-auto border-b border-slate-100 bg-white">
              <div className="flex min-w-max divide-x divide-slate-100">
                {[
                  { label: 'Total Invoiced',   value: formatMoney(summary.totalInvoiced),        accent: 'text-slate-800', sub: null },
                  { label: 'Paid Applied',      value: formatMoney(summary.totalPaidApplied),     accent: 'text-emerald-700', sub: null },
                  { label: 'Outstanding',       value: formatMoney(summary.totalOutstanding),     accent: 'text-red-600', sub: Number(summary.totalOutstanding || 0) > 0 ? `${summary.owingCount || 0} owing account(s)` : null },
                  { label: 'Unapplied Credit',  value: formatMoney(summary.totalUnappliedCredit), accent: 'text-amber-600', sub: Number(summary.totalUnappliedCredit || 0) > 0 ? `${summary.creditCount || 0} credit account(s)` : null },
                  { label: 'Net Balance',       value: formatMoney(summary.netBalance),           accent: 'text-slate-800', sub: null },
                  { label: 'Tenant Rows',       value: Number(summary.tenantCount || 0).toLocaleString(), accent: 'text-slate-800', sub: null },
                  { label: 'Largest Debtor',    value: balanceInsights.largestOwing?.tenantName || '—', accent: 'text-red-600', sub: balanceInsights.largestOwing ? formatMoney(balanceInsights.largestOwing.netBalance) : null },
                  { label: 'Largest Credit',    value: balanceInsights.largestCredit?.tenantName || '—', accent: 'text-emerald-700', sub: balanceInsights.largestCredit ? formatMoney(Math.abs(Number(balanceInsights.largestCredit.netBalance || 0))) : null },
                  { label: 'Settlement Rate',   value: formatPercent(balanceInsights.settlementRate), accent: 'text-slate-800', sub: 'Share of fully settled accounts' },
                ].map((item) => (
                  <div key={item.label} className="min-w-[115px] flex-1 px-3 py-2">
                    <p className="whitespace-nowrap text-[9px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                    <p className={`mt-0.5 whitespace-nowrap text-[12px] font-black ${item.accent}`}>{item.value}</p>
                    {item.sub && <p className="mt-0.5 whitespace-nowrap text-[9px] leading-tight text-slate-400">{item.sub}</p>}
                  </div>
                ))}
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
                        {['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid', 'Outstanding', 'Unapplied', 'Net Bal', 'Rent Bal',
                          ...(hasUtilityBreakdown ? allUtilityTypes : ['Utility Bal']),
                          'Penalty', 'Deposit', 'Other', 'Oldest Due', 'Last Pmt', 'Status'
                        ].map((h, i, arr) => (
                          <th key={h} className={`whitespace-nowrap px-2 py-1 text-left font-bold text-[9px] tracking-wide ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedRows.length === 0 ? (
                        <tr><td colSpan={13 + (hasUtilityBreakdown ? allUtilityTypes.length : 1)} className="px-2 py-4 text-center text-slate-500">No tenants matched the selected filters.</td></tr>
                      ) : paginatedRows.map((row, i) => (
                        <tr key={`${row.tenantId}-${row.unitId || i}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/50 hover:bg-emerald-50/30'}`}>
                          <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900 whitespace-nowrap">{row.tenantName}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-600 whitespace-nowrap">{row.propertyName}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-600">{row.unitNumber}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.totalInvoiced)}</td>
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
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-600 whitespace-nowrap">{fmtDate(row.lastPaymentDate)}</td>
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
