import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties, selectAllLandlords } from '../../redux/selectors';
import { getLandlords, getPropertyIncomeSummaryReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';

const MILIK_GREEN = '#0B3B2E';
const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');
const formatCategory = (value) => (value ? String(value).replace(/_/g, ' ') : '—');

const EXPENSE_CATEGORIES = ['maintenance', 'repair', 'utility', 'tax', 'insurance', 'supplies', 'other'];

const PropertyIncomeSummaryReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);
  const landlords = useSelector(selectAllLandlords);
  const isLandlordMode = isSelfManagingLandlordCompany(currentCompany || currentUser?.company);

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
  const [filters, setFilters] = useTabState("/reports/property-income-summary:filters", () => ({
    startDate: toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: toDateInputValue(new Date()),
    propertyId: '',
    landlordId: '',
  }));
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const [report, setReport] = useState({ summary: {}, byProperty: [], expensesByCategory: [] });

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
    if (!isLandlordMode) dispatch(getLandlords({ company: businessId }));
  }, [businessId, dispatch, isLandlordMode]);

  const loadReport = async () => {
    if (!businessId) return;
    setLoading(true);
    setFiltersChanged(false);
    try {
      const data = await getPropertyIncomeSummaryReport({ business: businessId, ...filters });
      setReport({
        summary: data?.summary || {},
        byProperty: Array.isArray(data?.byProperty) ? data.byProperty : [],
        expensesByCategory: Array.isArray(data?.expensesByCategory) ? data.expensesByCategory : [],
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load property income summary.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (businessId) loadReport();
  }, [businessId]);

  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    setFiltersChanged(true);
  }, [filters.startDate, filters.endDate, filters.propertyId, filters.landlordId]);

  const summary = report.summary || {};
  const propertyNameMap = useMemo(() => new Map(properties.map((p) => [String(p?._id), p?.propertyName || p?.name || 'Unnamed Property'])), [properties]);
  const landlordNameMap = useMemo(() => new Map(landlords.map((l) => [String(l?._id), l?.landlordName || l?.name || 'Unnamed Landlord'])), [landlords]);

  const filterSummary = useMemo(() => {
    const rows = [
      { label: 'Period', value: `${formatDate(filters.startDate)} to ${formatDate(filters.endDate)}` },
      { label: 'Property', value: filters.propertyId ? propertyNameMap.get(String(filters.propertyId)) || 'Selected property' : 'All properties' },
    ];
    if (!isLandlordMode) {
      rows.push({ label: 'Landlord', value: filters.landlordId ? landlordNameMap.get(String(filters.landlordId)) || 'Selected landlord' : 'All landlords' });
    }
    return rows;
  }, [filters, propertyNameMap, landlordNameMap, isLandlordMode]);

  const insights = useMemo(() => {
    const byProperty = Array.isArray(report.byProperty) ? report.byProperty : [];
    const expensesByCategory = Array.isArray(report.expensesByCategory) ? report.expensesByCategory : [];
    const totalInvoiced = Number(summary.totalInvoiced || 0);
    const totalCollected = Number(summary.totalCollected || 0);
    const totalExpenses = Number(summary.totalExpenses || 0);
    const netIncome = Number(summary.netIncome || 0);

    const topProperty = [...byProperty].sort((a, b) => Number(b?.netIncome || 0) - Number(a?.netIncome || 0))[0] || null;
    const topExpenseCategory = expensesByCategory[0] || null;
    const profitMargin = totalCollected > 0 ? (netIncome / totalCollected) * 100 : null;

    return {
      topProperty,
      topExpenseCategory,
      profitMargin,
      narrative: [
        totalInvoiced > 0
          ? `${formatMoney(totalCollected)} collected against ${formatMoney(totalInvoiced)} invoiced, a collection rate of ${formatPercent(summary.collectionRate)}.`
          : 'No invoices raised in the selected period.',
        topProperty
          ? `${topProperty.propertyName || 'Top property'} returned the best net income at ${formatMoney(topProperty.netIncome)}.`
          : 'No property income data for the selected period.',
        topExpenseCategory
          ? `${formatCategory(topExpenseCategory.category)} is the largest expense category at ${formatMoney(topExpenseCategory.total)} across ${topExpenseCategory.count} transaction(s).`
          : 'No expense records in the selected period.',
      ],
    };
  }, [report.byProperty, report.expensesByCategory, summary]);

  const printGeneratedAt = useMemo(() => new Date().toLocaleString(), [report, filters]);

  const handleExportCSV = () => {
    if (!canExportReports) {
      toast.warning ? toast.warning('You do not have permission to export reports') : toast.error('You do not have permission to export reports');
      return;
    }
    const header = ['Property', 'Rent Invoiced', 'Utilities Invoiced', 'Total Invoiced', 'Total Collected', 'Total Expenses', 'Net Income (Cash)', 'Collection Rate'];
    const rows = (report.byProperty || []).map((row) => [
      row.propertyName || '',
      row.rentInvoiced || 0,
      row.utilitiesInvoiced || 0,
      row.totalInvoiced || 0,
      row.totalCollected || 0,
      row.totalExpenses || 0,
      row.netIncome || 0,
      row.collectionRate !== null && row.collectionRate !== undefined ? `${row.collectionRate}%` : '',
    ]);

    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `property_income_summary_${filters.startDate}_to_${filters.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.error('You do not have permission to print reports'); return; }
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const by = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const fmtP = (v) => (v === null || v === undefined ? '—' : `${Number(v || 0).toFixed(1)}%`);
    win.document.write(`<!DOCTYPE html><html><head><title>Property Income Summary</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:12px;font-weight:900;color:#0f172a;margin-top:3px}
      h3{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#0B3B2E;font-weight:900;margin:12px 0 5px}
      table{width:100%;border-collapse:collapse;font-size:8.5px;margin-bottom:10px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 6px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Property Income Summary</div><div class="sub">Period: ${formatDate(filters.startDate)} to ${formatDate(filters.endDate)}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div><div>Prepared by: ${by}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Total Invoiced</div><div class="cv">${fmt(summary.totalInvoiced)}</div></div>
      <div class="card"><div class="cl">Total Collected</div><div class="cv" style="color:#0B3B2E">${fmt(summary.totalCollected)}</div></div>
      <div class="card"><div class="cl">Total Expenses</div><div class="cv" style="color:#b91c1c">${fmt(summary.totalExpenses)}</div></div>
      <div class="card"><div class="cl">Net Income</div><div class="cv" style="color:${Number(summary.netIncome || 0) >= 0 ? '#047857' : '#b91c1c'}">${fmt(summary.netIncome)}</div></div>
    </div>
    <h3>By Property</h3>
    <table><thead><tr><th>Property</th><th class="r">Rent Invoiced</th><th class="r">Utilities</th><th class="r">Total Invoiced</th><th class="r">Collected</th><th class="r">Expenses</th><th class="r">Net Income</th><th class="r">Collection Rate</th></tr></thead>
    <tbody>${(report.byProperty || []).map((row) => `<tr><td><strong>${row.propertyName || '—'}</strong></td><td class="r">${fmt(row.rentInvoiced)}</td><td class="r">${fmt(row.utilitiesInvoiced)}</td><td class="r">${fmt(row.totalInvoiced)}</td><td class="r">${fmt(row.totalCollected)}</td><td class="r" style="color:#b91c1c">${fmt(row.totalExpenses)}</td><td class="r" style="color:${Number(row.netIncome || 0) >= 0 ? '#047857' : '#b91c1c'}"><strong>${fmt(row.netIncome)}</strong></td><td class="r">${fmtP(row.collectionRate)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td><strong>TOTAL</strong></td><td class="r"><strong>${fmt(summary.totalRentInvoiced)}</strong></td><td class="r"><strong>${fmt(summary.totalUtilitiesInvoiced)}</strong></td><td class="r"><strong>${fmt(summary.totalInvoiced)}</strong></td><td class="r"><strong>${fmt(summary.totalCollected)}</strong></td><td class="r"><strong>${fmt(summary.totalExpenses)}</strong></td><td class="r"><strong>${fmt(summary.netIncome)}</strong></td><td class="r"><strong>${fmtP(summary.collectionRate)}</strong></td></tr></tfoot></table>
    ${(report.expensesByCategory || []).length > 0 ? `<h3>Expenses by Category</h3><table><thead><tr><th>Category</th><th class="r">Total</th><th class="r">Count</th></tr></thead><tbody>${(report.expensesByCategory || []).map((row) => `<tr><td>${formatCategory(row.category)}</td><td class="r">${fmt(row.total)}</td><td class="r">${row.count}</td></tr>`).join('')}</tbody></table>` : ''}
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, currentUser, report, summary, filters.startDate, filters.endDate]);

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
          .report-print-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 14px; padding: 10px 12px; border: 1px solid #dbe2ea; border-radius: 12px; background: #ffffff; }
          .report-print-filter-item { font-size: 10px; color: #334155; }
          .report-print-filter-item strong { color: #0f172a; }
          .report-print-insights { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
          .report-print-insight { border-left: 4px solid #0B3B2E; background: #f8fafc; border-radius: 10px; padding: 10px 12px; font-size: 10px; line-height: 1.5; }
          .report-print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
          .report-print-table th, .report-print-table td { border: 1px solid #dbe2ea; padding: 6px 8px; vertical-align: top; }
          .report-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; text-align: left; }
          .report-print-table tbody tr:nth-child(even) { background: #fafafa; }
          .text-right { text-align: right; }
          .text-emerald { color: #047857; font-weight: 800; }
          .text-red { color: #b91c1c; font-weight: 800; }
          .report-page-break { page-break-before: always; }
        `}</style>

        <div className="report-print-shell">
          <div className="report-print-header">
            <div>
              <div className="report-print-brand report-print-label">{companyName}</div>
              <h1 className="report-print-title">Property Income &amp; Expense Summary</h1>
              <p className="report-print-subtitle">
                Per-property breakdown of rent invoiced, collections received, operating expenses, and net income for the selected period.
              </p>
            </div>
            <div className="report-print-meta">
              <div><strong>Period:</strong> {formatDate(filters.startDate)} to {formatDate(filters.endDate)}</div>
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
              { label: 'Total Collected', value: formatMoney(summary.totalCollected) },
              { label: 'Total Expenses', value: formatMoney(summary.totalExpenses) },
              { label: 'Net Income (Cash)', value: formatMoney(summary.netIncome) },
            ].map((card) => (
              <div key={card.label} className="report-print-metric">
                <div className="report-print-label">{card.label}</div>
                <div className="report-print-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="report-print-section report-print-insights">
            {insights.narrative.map((item, index) => (
              <div key={index} className="report-print-insight">{item}</div>
            ))}
          </div>

          <div className="report-print-section">
            <h2 className="report-print-section-title">Income &amp; Expenses by Property</h2>
            <table className="report-print-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th className="text-right">Rent Invoiced</th>
                  <th className="text-right">Utilities Invoiced</th>
                  <th className="text-right">Total Invoiced</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Expenses</th>
                  <th className="text-right">Net Income</th>
                  <th className="text-right">Collection %</th>
                </tr>
              </thead>
              <tbody>
                {(report.byProperty || []).length === 0 ? (
                  <tr><td colSpan={8}>No data found for the selected filters.</td></tr>
                ) : (report.byProperty || []).map((row) => (
                  <tr key={row.propertyId || row.propertyName}>
                    <td>{row.propertyName}</td>
                    <td className="text-right">{formatMoney(row.rentInvoiced)}</td>
                    <td className="text-right">{formatMoney(row.utilitiesInvoiced)}</td>
                    <td className="text-right">{formatMoney(row.totalInvoiced)}</td>
                    <td className="text-right text-emerald">{formatMoney(row.totalCollected)}</td>
                    <td className="text-right">{formatMoney(row.totalExpenses)}</td>
                    <td className={`text-right ${Number(row.netIncome || 0) >= 0 ? 'text-emerald' : 'text-red'}`}>{formatMoney(row.netIncome)}</td>
                    <td className="text-right">{formatPercent(row.collectionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(report.expensesByCategory || []).length > 0 && (
            <div className="report-print-section report-page-break">
              <h2 className="report-print-section-title">Expenses by Category</h2>
              <table className="report-print-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.expensesByCategory || []).map((row) => (
                    <tr key={row.category}>
                      <td style={{ textTransform: 'capitalize' }}>{formatCategory(row.category)}</td>
                      <td className="text-right">{formatMoney(row.total)}</td>
                      <td className="text-right">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #0B3B2E; box-shadow: 0 0 0 1px rgba(11,59,46,0.2); outline: none; }
        `}</style>

        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            {/* Filter bar */}
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className={`grid gap-1.5 md:grid-cols-2 ${isLandlordMode ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}>
                <input type="date" value={filters.startDate} onChange={setFilter("startDate")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <input type="date" value={filters.endDate} onChange={setFilter("endDate")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <select value={filters.propertyId} onChange={setFilter("propertyId")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
                  <option value="">All properties</option>
                  {properties.map((p) => <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>)}
                </select>
                {!isLandlordMode && (
                  <select value={filters.landlordId} onChange={setFilter("landlordId")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
                    <option value="">All landlords</option>
                    {landlords.map((l) => <option key={l._id} value={l._id}>{l.landlordName || l.name}</option>)}
                  </select>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                <button onClick={handleExportCSV} disabled={!canExportReports} title={canExportReports ? 'Export CSV' : 'No export permission'} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} title={canExportReports ? 'Print' : 'No print permission'} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint /> Print</button>
                <button onClick={loadReport} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] transition ${filtersChanged ? 'border border-[#0B3B2E] bg-[#0B3B2E] text-white hover:bg-[#0A3127]' : 'border border-slate-200 bg-white text-slate-700 hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white'}`}><FaSyncAlt className={loading ? 'animate-spin' : ''} /> {filtersChanged ? 'Apply Filters' : 'Refresh'}</button>
              </div>
            </div>

            {/* ── Stat strip (6 core metrics) ── */}
            <div className="flex-shrink-0 border-b border-slate-100 bg-white">
              <div className="flex divide-x divide-slate-100">
                {[
                  { label: 'Total Invoiced',    value: formatMoney(summary.totalInvoiced),    accent: 'text-slate-800' },
                  { label: 'Total Collected',   value: formatMoney(summary.totalCollected),   accent: 'text-emerald-700' },
                  { label: 'Collection Rate',   value: formatPercent(summary.collectionRate), accent: 'text-slate-800' },
                  { label: 'Total Expenses',    value: formatMoney(summary.totalExpenses),    accent: 'text-red-600' },
                  { label: 'Net Income (Cash)', value: formatMoney(summary.netIncome),        accent: Number(summary.netIncome || 0) >= 0 ? 'text-emerald-700' : 'text-red-600' },
                  { label: 'Properties',        value: summary.propertyCount || 0,            accent: 'text-slate-800' },
                ].map((item) => (
                  <div key={item.label} className="flex-1 px-4 py-3">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                    <p className={`mt-1 text-[15px] font-black ${item.accent}`}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Tables ── */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

              {/* Income & Expenses by Property */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-shrink-0 border-b border-[#0B3B2E]/10 bg-[#0B3B2E] px-3 py-1.5 text-xs font-bold text-white">Income &amp; Expenses by Property</div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                      <tr>
                        {['Property', 'Rent Invoiced', 'Utilities Invoiced', 'Total Invoiced', 'Collected', 'Expenses', 'Net Income (Cash)', 'Collection %'].map((h, i, arr) => (
                          <th key={h} className={`whitespace-nowrap px-3 py-1.5 text-left font-bold ${i > 0 ? 'text-right' : ''} ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.byProperty || []).length === 0 ? (
                        <tr><td colSpan={8} className="px-3 py-6 text-center text-[11px] text-slate-400">{loading ? 'Loading…' : 'No data found for the selected filters.'}</td></tr>
                      ) : (report.byProperty || []).map((row, i) => (
                        <tr key={row.propertyId || row.propertyName} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-emerald-50/30`}>
                          <td className="px-3 py-1.5 border-r border-slate-100 font-semibold text-slate-900">{row.propertyName}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right text-slate-700">{formatMoney(row.rentInvoiced)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right text-slate-700">{formatMoney(row.utilitiesInvoiced)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right text-slate-700">{formatMoney(row.totalInvoiced)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right font-semibold text-emerald-700">{formatMoney(row.totalCollected)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right text-red-600">{formatMoney(row.totalExpenses)}</td>
                          <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-semibold ${Number(row.netIncome || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatMoney(row.netIncome)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700">{formatPercent(row.collectionRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {(report.byProperty || []).length > 1 && (
                      <tfoot className="bg-[#0B3B2E]/5 border-t-2 border-[#0B3B2E]/20 text-[11px]">
                        <tr>
                          <td className="px-3 py-2 font-black text-slate-700">Totals</td>
                          <td className="px-3 py-2 text-right font-black text-slate-700">{formatMoney((report.byProperty||[]).reduce((s,r)=>s+Number(r.rentInvoiced||0),0))}</td>
                          <td className="px-3 py-2 text-right font-black text-slate-700">{formatMoney((report.byProperty||[]).reduce((s,r)=>s+Number(r.utilitiesInvoiced||0),0))}</td>
                          <td className="px-3 py-2 text-right font-black text-slate-700">{formatMoney(summary.totalInvoiced)}</td>
                          <td className="px-3 py-2 text-right font-black text-emerald-700">{formatMoney(summary.totalCollected)}</td>
                          <td className="px-3 py-2 text-right font-black text-red-600">{formatMoney(summary.totalExpenses)}</td>
                          <td className={`px-3 py-2 text-right font-black ${Number(summary.netIncome || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatMoney(summary.netIncome)}</td>
                          <td className="px-3 py-2 text-right font-black text-slate-700">{formatPercent(summary.collectionRate)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Expenses by Category — fixed-height footer section */}
              {(report.expensesByCategory || []).length > 0 && (
                <div className="flex-shrink-0 border-t-2 border-slate-200" style={{ maxHeight: '170px', overflowY: 'auto' }}>
                  <table className="min-w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-bold border-r border-white/10">Expense Category</th>
                        <th className="px-3 py-1.5 text-right font-bold border-r border-white/10">Total</th>
                        <th className="px-3 py-1.5 text-right font-bold">Transactions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.expensesByCategory || []).map((row, i) => (
                        <tr key={row.category} className={`border-b border-slate-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-emerald-50/30`}>
                          <td className="px-3 py-1.5 border-r border-slate-100 capitalize font-semibold text-slate-900">{formatCategory(row.category)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right text-red-600">{formatMoney(row.total)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700">{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PropertyIncomeSummaryReport;
