import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import { useTerms } from '../../hooks/useTerm';
import AppSelect from '../../components/common/AppSelect';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import ListToolbar from '../../components/common/ListToolbar';
import MilikTable from '../../components/common/MilikTable';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties, selectAllLandlords } from '../../redux/selectors';
import { getLandlords, getPropertyIncomeSummaryReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaPrint, FaRedoAlt, FaSyncAlt } from 'react-icons/fa';
import useDebounce from '../../hooks/useDebounce';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import printTabularList from '../../utils/printList';

const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatCategory = (value) => (value ? String(value).replace(/_/g, ' ') : '—');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ value: String(i + 1), label }));

const defaultFilters = () => ({
  startDate: toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
  endDate: toDateInputValue(new Date()),
  propertyId: '',
  landlordId: '',
});

const PropertyIncomeSummaryReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);
  const landlords = useSelector(selectAllLandlords);
  const isLandlordMode = isSelfManagingLandlordCompany(currentCompany || currentUser?.company);
  const { property: termProperty, landlord: termLandlord, landlords: termLandlords, properties: termProperties } = useTerms("property", "landlord", "landlords", "properties");

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const companyName = currentCompany?.name
    || currentCompany?.companyName
    || currentCompany?.businessName
    || currentUser?.company?.name
    || currentUser?.company?.companyName
    || 'Milik';

  const [loading, setLoading] = useState(false);
  const filtersInitialized = useRef(false);
  const [filters, setFilters] = useTabState("/reports/property-income-summary:filters", defaultFilters);
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const resetFilters = () => setFilters(defaultFilters());
  const [report, setReport] = useState({ summary: {}, byProperty: [], expensesByCategory: [] });

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
    if (!isLandlordMode) dispatch(getLandlords({ company: businessId }));
  }, [businessId, dispatch, isLandlordMode]);

  const loadReportRef = useRef(null);
  const loadReport = useCallback(async (filterOverrides = {}) => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await getPropertyIncomeSummaryReport({ business: businessId, ...filters, ...filterOverrides });
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
  }, [businessId, filters.startDate, filters.endDate, filters.propertyId, filters.landlordId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (businessId) loadReport();
  }, [businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadReportRef.current = loadReport; }, [loadReport]);

  const debouncedTrigger = useDebounce(`${filters.startDate}|${filters.endDate}|${filters.propertyId}|${filters.landlordId}`, 500);
  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    loadReportRef.current();
  }, [debouncedTrigger]);

  // ── Month / Year period selector ──────────────────────────────────────────
  const yearOptions = useMemo(() => { const y = new Date().getFullYear(); return [y + 1, y, y - 1, y - 2, y - 3].map(String); }, []);
  // Stable option objects — avoids busting AppSelect's internal useMemo every render
  const yearSelectOptions = useMemo(() => yearOptions.map((y) => ({ value: y, label: y })), [yearOptions]);
  const { selMonth, selYear } = useMemo(() => {
    const fallbackYear = String(new Date().getFullYear());
    if (!filters.startDate) return { selMonth: null, selYear: fallbackYear };
    const s = new Date(filters.startDate + 'T00:00:00');
    const lastDay = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    const expectedEnd = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    if (filters.startDate.endsWith('-01') && filters.endDate === expectedEnd) {
      return { selMonth: String(s.getMonth() + 1), selYear: String(s.getFullYear()) };
    }
    return { selMonth: null, selYear: String(s.getFullYear()) };
  }, [filters.startDate, filters.endDate]);
  const applyMonthYear = (month, year) => {
    const m = Number(month); const y = Number(year);
    if (!m || !y) return;
    const lastDay = new Date(y, m, 0).getDate();
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    setFilters((prev) => ({ ...prev, startDate, endDate }));
    loadReport({ startDate, endDate });
  };

  const summary = report.summary || {};
  const propertyNameMap = useMemo(() => new Map(properties.map((p) => [String(p?._id), p?.propertyName || p?.name || 'Unnamed Property'])), [properties]);
  const landlordNameMap = useMemo(() => new Map(landlords.map((l) => [String(l?._id), l?.landlordName || l?.name || 'Unnamed Landlord'])), [landlords]);

  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name })), [properties]);
  const landlordOptions = useMemo(() => landlords.map((l) => ({ value: l._id, label: l.landlordName || l.name })), [landlords]);

  const filterSummary = useMemo(() => {
    const rows = [
      { label: 'Period', value: `${fmtDate(filters.startDate)} to ${fmtDate(filters.endDate)}` },
      { label: termProperty, value: filters.propertyId ? propertyNameMap.get(String(filters.propertyId)) || 'Selected property' : 'All properties' },
    ];
    if (!isLandlordMode) {
      rows.push({ label: termLandlord, value: filters.landlordId ? landlordNameMap.get(String(filters.landlordId)) || 'Selected landlord' : 'All landlords' });
    }
    return rows;
  }, [filters, propertyNameMap, landlordNameMap, isLandlordMode, termProperty, termLandlord]);

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
    const header = [termProperty, 'Rent Invoiced', 'Utilities Invoiced', 'Total Invoiced', 'Total Collected', 'Total Expenses', 'Net Income (Cash)', 'Collection Rate'];
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
    const sm = report.summary || {};
    const fmtP = (v) => (v === null || v === undefined ? '—' : `${Number(v || 0).toFixed(1)}%`);
    const netTone = (v) => (Number(v || 0) >= 0 ? 'pos' : 'neg');
    const expenseCategories = report.expensesByCategory || [];
    const printed = printTabularList({
      title: 'Property Income Summary',
      subtitle: `Period: ${fmtDate(filters.startDate)} to ${fmtDate(filters.endDate)}`,
      company: currentCompany,
      columns: [
        { label: termProperty, value: (r) => r.propertyName || '—', bold: true },
        { label: 'Rent Invoiced', align: 'right', value: (r) => formatMoney(r.rentInvoiced) },
        { label: 'Utilities', align: 'right', value: (r) => formatMoney(r.utilitiesInvoiced) },
        { label: 'Total Invoiced', align: 'right', value: (r) => formatMoney(r.totalInvoiced) },
        { label: 'Collected', align: 'right', value: (r) => formatMoney(r.totalCollected) },
        { label: 'Expenses', align: 'right', value: (r) => formatMoney(r.totalExpenses), tone: () => 'neg' },
        { label: 'Net Income', align: 'right', value: (r) => formatMoney(r.netIncome), tone: (r) => netTone(r.netIncome), bold: true },
        { label: 'Collection Rate', align: 'right', value: (r) => fmtP(r.collectionRate) },
      ],
      rows: report.byProperty || [],
      summaryItems: [
        ['Total Invoiced', formatMoney(sm.totalInvoiced)],
        ['Total Collected', formatMoney(sm.totalCollected)],
        ['Collection Rate', fmtP(sm.collectionRate)],
        ['Total Expenses', formatMoney(sm.totalExpenses)],
        ['Net Income', formatMoney(sm.netIncome)],
        [termProperties, String(sm.propertyCount || 0)],
      ],
      totalsRow: ['TOTAL', formatMoney(sm.totalRentInvoiced), formatMoney(sm.totalUtilitiesInvoiced), formatMoney(sm.totalInvoiced), formatMoney(sm.totalCollected), formatMoney(sm.totalExpenses), formatMoney(sm.netIncome), fmtP(sm.collectionRate)],
      sections: expenseCategories.length ? [{
        heading: 'Expenses by Category',
        columns: [
          { label: 'Category', value: (r) => formatCategory(r.category) },
          { label: 'Total', align: 'right', value: (r) => formatMoney(r.total) },
          { label: 'Count', align: 'right', value: (r) => r.count },
        ],
        rows: expenseCategories,
        totalsRow: ['TOTAL', formatMoney(expenseCategories.reduce((s, r) => s + Number(r.total || 0), 0)), String(expenseCategories.reduce((s, r) => s + Number(r.count || 0), 0))],
      }] : [],
    });
    if (!printed) toast.error('Pop-up blocked — allow pop-ups for this site to print');
  }, [canExportReports, currentCompany, report, filters.startDate, filters.endDate, termProperty, termProperties]);

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
              <div><strong>Period:</strong> {fmtDate(filters.startDate)} to {fmtDate(filters.endDate)}</div>
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
            {insights.narrative.map((item) => (
              <div key={item} className="report-print-insight">{item}</div>
            ))}
          </div>

          <div className="report-print-section">
            <h2 className="report-print-section-title">Income &amp; Expenses by Property</h2>
            <table className="report-print-table">
              <thead>
                <tr>
                  <th>{termProperty}</th>
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

      <div className="no-print flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-2">
        <div className="mx-auto flex h-full w-full max-w-none min-h-0 flex-1 flex-col gap-2">
          <ListToolbar>
            <span className="shrink-0 border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
              {(report.byProperty || []).length} {(report.byProperty || []).length === 1 ? termProperty.toLowerCase() : termProperties.toLowerCase()}
            </span>
            <ListToolbar.Divider />
            <AppSelect value={selMonth} onChange={(v) => applyMonthYear(v, selYear)} options={MONTHS} placeholder="Month" clearable compact />
            <AppSelect value={selYear} onChange={(v) => applyMonthYear(selMonth, v ?? selYear)} options={yearSelectOptions} compact />
            <ListToolbar.Input type="date" width="w-32" value={filters.startDate} onChange={setFilter("startDate")} />
            <ListToolbar.Input type="date" width="w-32" value={filters.endDate} onChange={setFilter("endDate")} />
            <AppSelect value={filters.propertyId || null} onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? '' }))} options={propertyOptions} placeholder={termProperty} searchable clearable compact />
            {!isLandlordMode && (
              <AppSelect value={filters.landlordId || null} onChange={(v) => setFilters((prev) => ({ ...prev, landlordId: v ?? '' }))} options={landlordOptions} placeholder={termLandlord} searchable clearable compact />
            )}
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaRedoAlt} variant="outline" onClick={resetFilters} disabled={loading}>Reset</ListToolbar.Button>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaFileDownload} variant="outline" onClick={handleExportCSV} disabled={!canExportReports}>Export</ListToolbar.Button>
            <ListToolbar.Button icon={FaPrint} variant="outline" onClick={handlePrint} disabled={!canExportReports}>Print</ListToolbar.Button>
            <ListToolbar.Button icon={FaSyncAlt} variant="outline" onClick={() => loadReport()}>Refresh</ListToolbar.Button>
          </ListToolbar>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex min-h-0 flex-[2] flex-col overflow-hidden border border-slate-200 bg-white shadow-lg">
              <MilikTable
                columns={[
                  { label: termProperty },
                  { label: "Rent Invoiced", align: "right" },
                  { label: "Utilities Invoiced", align: "right" },
                  { label: "Total Invoiced", align: "right" },
                  { label: "Collected", align: "right" },
                  { label: "Expenses", align: "right" },
                  { label: "Net Income (Cash)", align: "right" },
                  { label: "Collection %", align: "right" },
                ]}
                rows={report.byProperty || []}
                rowKey={(row) => row.propertyId || row.propertyName}
                loading={loading && (report.byProperty || []).length === 0}
                empty="No data found for the selected filters."
                renderFooter={() => (
                  <>
                    <td className="px-3 py-1.5 border-r border-slate-200 font-black text-slate-700">Totals</td>
                    <td className="px-3 py-1.5 border-r border-slate-200 text-right font-black text-slate-700">{formatMoney((report.byProperty || []).reduce((s, r) => s + Number(r.rentInvoiced || 0), 0))}</td>
                    <td className="px-3 py-1.5 border-r border-slate-200 text-right font-black text-slate-700">{formatMoney((report.byProperty || []).reduce((s, r) => s + Number(r.utilitiesInvoiced || 0), 0))}</td>
                    <td className="px-3 py-1.5 border-r border-slate-200 text-right font-black text-slate-700">{formatMoney(summary.totalInvoiced)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-200 text-right font-black text-emerald-700">{formatMoney(summary.totalCollected)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-200 text-right font-black text-red-600">{formatMoney(summary.totalExpenses)}</td>
                    <td className={`px-3 py-1.5 border-r border-slate-200 text-right font-black ${Number(summary.netIncome || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatMoney(summary.netIncome)}</td>
                    <td className="px-3 py-1.5 text-right font-black text-slate-700">{formatPercent(summary.collectionRate)}</td>
                  </>
                )}
                renderRow={(row) => (
                  <>
                    <td className="px-3 py-1.5 border-r border-gray-100 font-semibold text-slate-900">{row.propertyName}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right text-slate-700 tabular-nums">{formatMoney(row.rentInvoiced)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right text-slate-700 tabular-nums">{formatMoney(row.utilitiesInvoiced)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right text-slate-700 tabular-nums">{formatMoney(row.totalInvoiced)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right font-semibold text-emerald-700 tabular-nums">{formatMoney(row.totalCollected)}</td>
                    <td className="px-3 py-1.5 border-r border-gray-100 text-right text-red-600 tabular-nums">{formatMoney(row.totalExpenses)}</td>
                    <td className={`px-3 py-1.5 border-r border-gray-100 text-right font-semibold tabular-nums ${Number(row.netIncome || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatMoney(row.netIncome)}</td>
                    <td className="px-3 py-1.5 text-right text-slate-700 tabular-nums">{formatPercent(row.collectionRate)}</td>
                  </>
                )}
              />
            </div>

            {/* Expenses by Category */}
            {(report.expensesByCategory || []).length > 0 && (
              <div className="flex max-h-[180px] flex-[1] flex-col overflow-hidden border border-slate-200 bg-white shadow-lg">
                <MilikTable
                  columns={[
                    { label: "Expense Category" },
                    { label: "Total", align: "right" },
                    { label: "Transactions", align: "right" },
                  ]}
                  rows={report.expensesByCategory || []}
                  rowKey="category"
                  empty="No expenses in the selected period."
                  renderRow={(row) => (
                    <>
                      <td className="px-3 py-1.5 border-r border-gray-100 capitalize font-semibold text-slate-900">{formatCategory(row.category)}</td>
                      <td className="px-3 py-1.5 border-r border-gray-100 text-right text-red-600 tabular-nums">{formatMoney(row.total)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-700 tabular-nums">{row.count}</td>
                    </>
                  )}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PropertyIncomeSummaryReport;
