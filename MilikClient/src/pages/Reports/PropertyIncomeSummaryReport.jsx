import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getLandlords, getPropertyIncomeSummaryReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';

const MILIK_GREEN = '#0B3B2E';
const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');
const formatCategory = (value) => (value ? String(value).replace(/_/g, ' ') : '—');

const EXPENSE_CATEGORIES = ['maintenance', 'repair', 'utility', 'tax', 'insurance', 'supplies', 'other'];

const PropertyIncomeSummaryReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const properties = useSelector((state) => state.property?.properties || []);
  const landlords = useSelector((state) => state.landlord?.landlords || []);

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
  const [filters, setFilters] = useState({
    startDate: toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: toDateInputValue(new Date()),
    propertyId: '',
    landlordId: '',
  });
  const [report, setReport] = useState({ summary: {}, byProperty: [], expensesByCategory: [] });

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
    dispatch(getLandlords({ company: businessId }));
  }, [businessId, dispatch]);

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

  const filterSummary = useMemo(() => ([
    { label: 'Period', value: `${formatDate(filters.startDate)} to ${formatDate(filters.endDate)}` },
    { label: 'Property', value: filters.propertyId ? propertyNameMap.get(String(filters.propertyId)) || 'Selected property' : 'All properties' },
    { label: 'Landlord', value: filters.landlordId ? landlordNameMap.get(String(filters.landlordId)) || 'Selected landlord' : 'All landlords' },
  ]), [filters, propertyNameMap, landlordNameMap]);

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

  const handlePrint = () => {
    if (!canExportReports) {
      toast.warning ? toast.warning('You do not have permission to print reports') : toast.error('You do not have permission to print reports');
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  };

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

      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #f45b0b; box-shadow: 0 0 0 1px rgba(244, 91, 11, 0.45); outline: none; }
          .milik-report-page select option:checked { background: #f45b0b; color: #ffffff; }
        `}</style>

        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            {/* Filter bar */}
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
                <input type="date" value={filters.startDate} onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40" />
                <input type="date" value={filters.endDate} onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40" />
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40">
                  <option value="">All properties</option>
                  {properties.map((p) => <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>)}
                </select>
                <select value={filters.landlordId} onChange={(e) => setFilters((prev) => ({ ...prev, landlordId: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40">
                  <option value="">All landlords</option>
                  {landlords.map((l) => <option key={l._id} value={l._id}>{l.landlordName || l.name}</option>)}
                </select>
              </div>
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                <button onClick={handleExportCSV} disabled={!canExportReports} title={canExportReports ? 'Export CSV' : 'No export permission'} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} title={canExportReports ? 'Print' : 'No print permission'} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700"><FaPrint /> Print</button>
                <button onClick={loadReport} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] transition ${filtersChanged ? 'border border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100' : 'border border-slate-300 bg-white text-slate-700 hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700'}`}><FaSyncAlt className={loading ? 'animate-spin' : ''} /> {filtersChanged ? 'Apply Filters' : 'Refresh'}</button>
              </div>
            </div>

            {/* Summary metrics */}
            <div className="grid flex-shrink-0 gap-1.5 border-b border-slate-200 bg-white p-1.5 md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Total Invoiced', value: formatMoney(summary.totalInvoiced), accent: 'text-slate-900' },
                { label: 'Total Collected', value: formatMoney(summary.totalCollected), accent: 'text-emerald-700' },
                { label: 'Collection Rate', value: formatPercent(summary.collectionRate), accent: 'text-slate-900' },
                { label: 'Total Expenses', value: formatMoney(summary.totalExpenses), accent: 'text-red-700' },
                { label: 'Net Income (Cash)', value: formatMoney(summary.netIncome), accent: Number(summary.netIncome || 0) >= 0 ? 'text-emerald-700' : 'text-red-700' },
                { label: 'Properties', value: summary.propertyCount || 0, accent: 'text-slate-900' },
              ].map((card) => (
                <div key={card.label} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{card.label}</div>
                  <div className={`mt-0.5 text-base font-black ${card.accent}`}>{card.value}</div>
                </div>
              ))}
            </div>

            {/* Insight cards */}
            <div className="grid flex-shrink-0 gap-1.5 border-b border-slate-200 bg-slate-50 p-1.5 md:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Profit Margin</div>
                <div className="mt-0.5 text-sm font-black text-slate-900">{formatPercent(insights.profitMargin)}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-600">Net income as a share of total cash collected in the period.</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Best Property</div>
                <div className="mt-0.5 text-sm font-black text-slate-900">{insights.topProperty?.propertyName || '—'}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-600">
                  {insights.topProperty
                    ? `Net income: ${formatMoney(insights.topProperty.netIncome)} (collected ${formatMoney(insights.topProperty.totalCollected)}).`
                    : 'No property data for the selected filters.'}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Top Expense Category</div>
                <div className="mt-0.5 text-sm font-black capitalize text-slate-900">{insights.topExpenseCategory ? formatCategory(insights.topExpenseCategory.category) : '—'}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-600">
                  {insights.topExpenseCategory
                    ? `${formatMoney(insights.topExpenseCategory.total)} across ${insights.topExpenseCategory.count} transaction(s).`
                    : 'No expense records in the selected period.'}
                </p>
              </div>
            </div>

            {/* Tables */}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden bg-white p-1.5">
              {/* By-property table */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-xs font-bold text-white">Income &amp; Expenses by Property</div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                      <tr>
                        {['Property', 'Rent Invoiced', 'Utilities Invoiced', 'Total Invoiced', 'Collected', 'Expenses', 'Net Income (Cash)', 'Collection %'].map((h) => (
                          <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-[0.12em]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.byProperty || []).length === 0 ? (
                        <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">{loading ? 'Loading…' : 'No data found for the selected filters.'}</td></tr>
                      ) : (report.byProperty || []).map((row) => (
                        <tr key={row.propertyId || row.propertyName} className="border-t border-slate-200 hover:bg-slate-50/80">
                          <td className="px-2 py-1.5 font-semibold text-slate-900">{row.propertyName}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.rentInvoiced)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.utilitiesInvoiced)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.totalInvoiced)}</td>
                          <td className="px-2 py-1.5 font-semibold text-emerald-700">{formatMoney(row.totalCollected)}</td>
                          <td className="px-2 py-1.5 text-red-700">{formatMoney(row.totalExpenses)}</td>
                          <td className={`px-2 py-1.5 font-semibold ${Number(row.netIncome || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatMoney(row.netIncome)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatPercent(row.collectionRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Expenses by category */}
              {(report.expensesByCategory || []).length > 0 && (
                <div className="flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white" style={{ maxHeight: '200px' }}>
                  <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-xs font-bold text-white">Expenses by Category</div>
                  <div className="overflow-auto" style={{ maxHeight: '160px' }}>
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                        <tr>
                          {['Category', 'Total', 'Transactions'].map((h) => (
                            <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-[0.12em]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(report.expensesByCategory || []).map((row) => (
                          <tr key={row.category} className="border-t border-slate-200 hover:bg-slate-50/80">
                            <td className="px-2 py-1.5 capitalize font-semibold text-slate-900">{formatCategory(row.category)}</td>
                            <td className="px-2 py-1.5 text-red-700">{formatMoney(row.total)}</td>
                            <td className="px-2 py-1.5 text-slate-700">{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
