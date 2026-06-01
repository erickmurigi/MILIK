import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties, selectAllTenants, selectAllLandlords } from '../../redux/selectors';
import { getLandlords, getRentalCollectionReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { getTenants } from '../../redux/tenantsRedux';
import { FaChartBar, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';

const MILIK_GREEN = '#0B3B2E';
const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');
const formatMethod = (value) => (value ? String(value).replace(/_/g, ' ') : 'All methods');
const ITEMS_PER_PAGE = 50;

const RentalCollectionReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const properties = useSelector(selectAllProperties);
  const tenants = useSelector(selectAllTenants);
  const landlords = useSelector(selectAllLandlords);

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
    tenantId: '',
    unitId: '',
    landlordId: '',
    paymentMethod: '',
    cashbook: '',
  });
  const [report, setReport] = useState({ summary: {}, byProperty: [], rows: [] });
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
    dispatch(getTenants({ business: businessId }));
    dispatch(getLandlords({ company: businessId }));
  }, [businessId, dispatch]);

  const loadReport = async (signal) => {
    if (!businessId) return;
    setLoading(true);
    setFiltersChanged(false);
    try {
      const data = await getRentalCollectionReport({ business: businessId, ...filters }, signal);
      if (signal?.aborted) return;
      setReport({
        summary: data?.summary || {},
        byProperty: Array.isArray(data?.byProperty) ? data.byProperty : [],
        rows: Array.isArray(data?.rows) ? data.rows : [],
      });
    } catch (error) {
      if (error?.name === 'CanceledError' || error?.name === 'AbortError') return;
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load rental collection report.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  // Auto-load only when the active company changes
  useEffect(() => {
    if (!businessId) return;
    const controller = new AbortController();
    loadReport(controller.signal);
    return () => controller.abort();
  }, [businessId]);

  // Track filter changes so the Refresh button shows a stale indicator
  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    setFiltersChanged(true);
  }, [filters.startDate, filters.endDate, filters.propertyId, filters.tenantId, filters.unitId, filters.landlordId, filters.paymentMethod, filters.cashbook]);

  const units = useMemo(() => {
    return tenants
      .filter((tenant) => !filters.tenantId || String(tenant?._id) === String(filters.tenantId))
      .map((tenant) => {
        const unit = tenant?.unit || {};
        return {
          _id: unit?._id || unit,
          unitNumber: unit?.unitNumber || unit?.name || 'Unit',
        };
      })
      .filter((unit, index, arr) => unit._id && arr.findIndex((entry) => String(entry._id) === String(unit._id)) === index);
  }, [tenants, filters.tenantId]);

  const summary = report.summary || {};
  const propertyNameMap = useMemo(() => new Map(properties.map((property) => [String(property?._id), property?.propertyName || property?.name || 'Unnamed Property'])), [properties]);
  const tenantNameMap = useMemo(() => new Map(tenants.map((tenant) => [String(tenant?._id), tenant?.tenantName || tenant?.name || 'Unnamed Tenant'])), [tenants]);
  const landlordNameMap = useMemo(() => new Map(landlords.map((landlord) => [String(landlord?._id), landlord?.landlordName || landlord?.name || 'Unnamed Landlord'])), [landlords]);
  const unitNameMap = useMemo(() => new Map(units.map((unit) => [String(unit?._id), unit?.unitNumber || unit?.name || 'Unit'])), [units]);

  const filterSummary = useMemo(() => ([
    { label: 'Period', value: `${formatDate(filters.startDate)} to ${formatDate(filters.endDate)}` },
    { label: 'Property', value: filters.propertyId ? propertyNameMap.get(String(filters.propertyId)) || 'Selected property' : 'All properties' },
    { label: 'Tenant', value: filters.tenantId ? tenantNameMap.get(String(filters.tenantId)) || 'Selected tenant' : 'All tenants' },
    { label: 'Unit', value: filters.unitId ? unitNameMap.get(String(filters.unitId)) || 'Selected unit' : 'All units' },
    { label: 'Landlord', value: filters.landlordId ? landlordNameMap.get(String(filters.landlordId)) || 'Selected landlord' : 'All landlords' },
    { label: 'Method', value: filters.paymentMethod ? formatMethod(filters.paymentMethod) : 'All methods' },
    { label: 'Cashbook', value: filters.cashbook || 'All cashbooks' },
  ]), [filters, propertyNameMap, tenantNameMap, unitNameMap, landlordNameMap]);

  const paginatedRows = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const startIndex = (Math.max(currentPage, 1) - 1) * ITEMS_PER_PAGE;
    return rows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [report.rows, currentPage]);

  const totalPages = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows.length : 0;
    return Math.max(1, Math.ceil(rows / ITEMS_PER_PAGE));
  }, [report.rows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.startDate, filters.endDate, filters.propertyId, filters.tenantId, filters.unitId, filters.landlordId, filters.paymentMethod, filters.cashbook]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const collectionInsights = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const byProperty = Array.isArray(report.byProperty) ? report.byProperty : [];
    const totalCollected = Number(summary.totalCollected || 0);
    const allocatedAmount = Number(summary.allocatedAmount || 0);
    const totalPayments = Number(summary.totalPayments || rows.length || 0);
    const averageReceipt = totalPayments > 0 ? totalCollected / totalPayments : 0;
    const allocationEfficiency = totalCollected > 0 ? (allocatedAmount / totalCollected) * 100 : null;
    const topProperty = [...byProperty].sort((a, b) => Number(b?.totalCollected || 0) - Number(a?.totalCollected || 0))[0] || null;
    const highestUnapplied = [...rows].sort((a, b) => Number(b?.unappliedAmount || 0) - Number(a?.unappliedAmount || 0))[0] || null;
    const totalUnapplied = Number(summary.unappliedAmount || 0);

    return {
      averageReceipt,
      allocationEfficiency,
      topProperty,
      highestUnapplied,
      narrative: [
        totalPayments > 0
          ? `The report reflects ${totalPayments} effective receipt${totalPayments === 1 ? '' : 's'} for the selected period, with an average receipt value of ${formatMoney(averageReceipt)}.`
          : 'No effective receipts were returned for the selected period.',
        topProperty
          ? `${topProperty.propertyName || 'The leading property'} contributed the strongest collection performance at ${formatMoney(topProperty.totalCollected)}.`
          : 'There is no property-level collection concentration to highlight yet.',
        totalUnapplied > 0
          ? `${formatMoney(totalUnapplied)} remains unapplied, so the collections team should review outstanding allocations and clean up receipt application discipline.`
          : 'All reported collections are fully allocated, which is healthy for landlord statement and tenant balance discipline.',
      ],
    };
  }, [report.byProperty, report.rows, summary.allocatedAmount, summary.totalCollected, summary.totalPayments, summary.unappliedAmount]);

  const printGeneratedAt = useMemo(() => new Date().toLocaleString(), [report, filters]);

  const handleExportCSV = () => {
    if (!canExportReports) {
      toast.warning ? toast.warning("You do not have permission to export reports") : toast.error("You do not have permission to export reports");
      return;
    }
    const header = ['Date', 'Receipt #', 'Property', 'Tenant', 'Unit', 'Method', 'Collected', 'Allocated', 'Rent Applied', 'Utility Applied', 'Penalty Applied', 'Unapplied', 'Cashbook'];
    const rows = (report.rows || []).map((row) => [
      row.paymentDate ? new Date(row.paymentDate).toLocaleDateString() : '',
      row.receiptNumber || '',
      row.propertyName || '',
      row.tenantName || '',
      row.unitNumber || '',
      row.paymentMethod || '',
      row.amount || 0,
      row.allocatedAmount || 0,
      row.rentApplied || 0,
      row.utilityApplied || 0,
      row.penaltyApplied || 0,
      row.unappliedAmount || 0,
      row.cashbook || '',
    ]);

    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rental_collection_report_${filters.startDate}_to_${filters.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    if (!canExportReports) {
      toast.warning ? toast.warning("You do not have permission to print reports") : toast.error("You do not have permission to print reports");
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
      });
    });
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
          .text-amber { color: #b45309; font-weight: 800; }
          .text-red { color: #b91c1c; font-weight: 800; }
          .report-page-break { page-break-before: always; }
        `}</style>

        <div className="report-print-shell">
          <div className="report-print-header">
            <div>
              <div className="report-print-brand report-print-label">{companyName}</div>
              <h1 className="report-print-title">Rental Collection Report</h1>
              <p className="report-print-subtitle">
                Real receipt-based collection view showing cash received, allocation efficiency, property concentration, and unapplied balances that still need operator attention.
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
              { label: 'Total Collected', value: formatMoney(summary.totalCollected) },
              { label: 'Allocated', value: formatMoney(summary.allocatedAmount) },
              { label: 'Unapplied', value: formatMoney(summary.unappliedAmount) },
              { label: 'Collection Rate', value: formatPercent(summary.collectionRate) },
            ].map((card) => (
              <div key={card.label} className="report-print-metric">
                <div className="report-print-label">{card.label}</div>
                <div className="report-print-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="report-print-section report-print-insights">
            {collectionInsights.narrative.map((item, index) => (
              <div key={`${item}-${index}`} className="report-print-insight">{item}</div>
            ))}
          </div>

          <div className="report-print-section">
            <h2 className="report-print-section-title">Collection Summary by Property</h2>
            <table className="report-print-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Receipts</th>
                  <th>Tenants</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Rent</th>
                  <th className="text-right">Utilities</th>
                  <th className="text-right">Penalty</th>
                  <th className="text-right">Unapplied</th>
                </tr>
              </thead>
              <tbody>
                {(report.byProperty || []).length === 0 ? (
                  <tr><td colSpan={8}>No collection rows found for the selected filters.</td></tr>
                ) : (report.byProperty || []).map((row) => (
                  <tr key={row.propertyId || row.propertyName}>
                    <td>{row.propertyName}</td>
                    <td>{row.paymentCount}</td>
                    <td>{row.tenantCount}</td>
                    <td className="text-right text-emerald">{formatMoney(row.totalCollected)}</td>
                    <td className="text-right">{formatMoney(row.rentApplied)}</td>
                    <td className="text-right">{formatMoney(row.utilityApplied)}</td>
                    <td className="text-right">{formatMoney(row.penaltyApplied)}</td>
                    <td className="text-right text-amber">{formatMoney(row.unappliedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="report-print-section report-page-break">
            <h2 className="report-print-section-title">Detailed Receipts</h2>
            <table className="report-print-table">
              <thead>
                <tr>
                  {['Date', 'Receipt #', 'Property', 'Tenant', 'Method', 'Collected', 'Allocated', 'Rent', 'Utilities', 'Penalty', 'Unapplied', 'Cashbook'].map((header) => <th key={header}>{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {(report.rows || []).length === 0 ? (
                  <tr><td colSpan={12}>No receipts found for the current filters.</td></tr>
                ) : (report.rows || []).map((row) => (
                  <tr key={row.receiptId}>
                    <td>{formatDate(row.paymentDate)}</td>
                    <td>{row.receiptNumber || '—'}</td>
                    <td>{row.propertyName || '—'}</td>
                    <td>{row.tenantName || '—'}</td>
                    <td>{formatMethod(row.paymentMethod)}</td>
                    <td className="text-right text-emerald">{formatMoney(row.amount)}</td>
                    <td className="text-right">{formatMoney(row.allocatedAmount)}</td>
                    <td className="text-right">{formatMoney(row.rentApplied)}</td>
                    <td className="text-right">{formatMoney(row.utilityApplied)}</td>
                    <td className="text-right">{formatMoney(row.penaltyApplied)}</td>
                    <td className="text-right text-amber">{formatMoney(row.unappliedAmount)}</td>
                    <td>{row.cashbook || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #f45b0b; box-shadow: 0 0 0 1px rgba(244, 91, 11, 0.45); outline: none; }
          .milik-report-page select option:checked { background: #f45b0b; color: #ffffff; }
          .milik-report-page select option:hover { background: #f45b0b; color: #ffffff; }
        `}</style>

        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
                <input type="date" value={filters.startDate} onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40" />
                <input type="date" value={filters.endDate} onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40" />
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40">
                  <option value="">All properties</option>
                  {properties.map((property) => <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>)}
                </select>
                <select value={filters.paymentMethod} onChange={(e) => setFilters((prev) => ({ ...prev, paymentMethod: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40">
                  <option value="">All methods</option>
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="check">Cheque</option>
                  <option value="credit_card">Card</option>
                </select>
                <select value={filters.tenantId} onChange={(e) => setFilters((prev) => ({ ...prev, tenantId: e.target.value, unitId: '' }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40">
                  <option value="">All tenants</option>
                  {tenants.map((tenant) => <option key={tenant._id} value={tenant._id}>{tenant.tenantName || tenant.name}</option>)}
                </select>
                <select value={filters.unitId} onChange={(e) => setFilters((prev) => ({ ...prev, unitId: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40">
                  <option value="">All units</option>
                  {units.map((unit) => <option key={unit._id} value={unit._id}>{unit.unitNumber}</option>)}
                </select>
                <select value={filters.landlordId} onChange={(e) => setFilters((prev) => ({ ...prev, landlordId: e.target.value }))} className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40">
                  <option value="">All landlords</option>
                  {landlords.map((landlord) => <option key={landlord._id} value={landlord._id}>{landlord.landlordName || landlord.name}</option>)}
                </select>
                <input value={filters.cashbook} onChange={(e) => setFilters((prev) => ({ ...prev, cashbook: e.target.value }))} placeholder="Cashbook contains..." className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] transition focus:border-orange-600 focus:ring-1 focus:ring-orange-500/40" />
              </div>
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                <button onClick={handleExportCSV} disabled={!canExportReports} title={canExportReports ? "Export CSV" : "You do not have permission to export reports"} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} title={canExportReports ? "Print" : "You do not have permission to print reports"} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700"><FaPrint /> Print</button>
                <button onClick={loadReport} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] transition ${filtersChanged ? 'border border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100' : 'border border-slate-300 bg-white text-slate-700 hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700'}`}><FaSyncAlt className={loading ? 'animate-spin' : ''} /> {filtersChanged ? 'Apply Filters' : 'Refresh'}</button>
              </div>
            </div>

            <div className="grid flex-shrink-0 gap-1.5 border-b border-slate-200 bg-white p-1.5 md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Total Collected', value: formatMoney(summary.totalCollected), accent: 'text-emerald-700' },
                { label: 'Allocated', value: formatMoney(summary.allocatedAmount), accent: 'text-slate-900' },
                { label: 'Unapplied', value: formatMoney(summary.unappliedAmount), accent: 'text-amber-600' },
                { label: 'Rent Applied', value: formatMoney(summary.rentApplied), accent: 'text-slate-900' },
                { label: 'Utilities Applied', value: formatMoney(summary.utilityApplied), accent: 'text-slate-900' },
                { label: 'Collection Rate', value: formatPercent(summary.collectionRate), accent: 'text-slate-900' },
              ].map((card) => (
                <div key={card.label} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{card.label}</div>
                  <div className={`mt-0.5 text-base font-black ${card.accent}`}>{card.value}</div>
                </div>
              ))}
            </div>

            <div className="grid flex-shrink-0 gap-1.5 border-b border-slate-200 bg-slate-50 p-1.5 md:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Average Receipt</div>
                <div className="mt-0.5 text-sm font-black text-slate-900">{formatMoney(collectionInsights.averageReceipt)}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-600">Average size of effective collections in the selected period.</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Allocation Efficiency</div>
                <div className="mt-0.5 text-sm font-black text-slate-900">{formatPercent(collectionInsights.allocationEfficiency)}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-600">Share of collected cash already tied to rent, utility or penalty invoices.</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Top Property</div>
                <div className="mt-0.5 text-sm font-black text-slate-900">{collectionInsights.topProperty?.propertyName || '—'}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-600">
                  {collectionInsights.topProperty
                    ? `${formatMoney(collectionInsights.topProperty.totalCollected)} collected across ${collectionInsights.topProperty.paymentCount || 0} receipt(s).`
                    : 'No property concentration insight yet for the selected filters.'}
                </p>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden bg-white p-1.5">
              <div className="flex min-h-0 max-h-[32%] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-xs font-bold text-white">Collection Summary by Property</div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                      <tr>
                        {['Property', 'Receipts', 'Tenants', 'Collected', 'Rent', 'Utilities', 'Penalty', 'Unapplied'].map((header) => <th key={header} className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-[0.12em]">{header}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.byProperty || []).length === 0 ? (
                        <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">No collection rows found for the selected filters.</td></tr>
                      ) : (report.byProperty || []).map((row) => (
                        <tr key={row.propertyId || row.propertyName} className="border-t border-slate-200 hover:bg-slate-50/80">
                          <td className="px-2 py-1.5 font-semibold text-slate-900">{row.propertyName}</td>
                          <td className="px-2 py-1.5 text-slate-700">{row.paymentCount}</td>
                          <td className="px-2 py-1.5 text-slate-700">{row.tenantCount}</td>
                          <td className="px-2 py-1.5 font-semibold text-emerald-700">{formatMoney(row.totalCollected)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.rentApplied)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.utilityApplied)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.penaltyApplied)}</td>
                          <td className="px-2 py-1.5 text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-xs font-bold text-white">Detailed Receipts</div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
                      <tr>
                        {['Date', 'Receipt #', 'Property', 'Tenant', 'Unit', 'Method', 'Collected', 'Allocated', 'Rent', 'Utilities', 'Penalty', 'Unapplied', 'Cashbook'].map((header) => <th key={header} className="whitespace-nowrap px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-[0.12em]">{header}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.rows || []).length === 0 ? (
                        <tr><td colSpan={13} className="px-2 py-4 text-center text-slate-500">No receipts found for the current filters.</td></tr>
                      ) : paginatedRows.map((row) => (
                        <tr key={row.receiptId} className="border-t border-slate-200 hover:bg-slate-50/80">
                          <td className="px-2 py-1.5 text-slate-700">{formatDate(row.paymentDate)}</td>
                          <td className="px-2 py-1.5 font-semibold text-slate-900">{row.receiptNumber || '—'}</td>
                          <td className="px-2 py-1.5 text-slate-700">{row.propertyName}</td>
                          <td className="px-2 py-1.5 text-slate-700">{row.tenantName}</td>
                          <td className="px-2 py-1.5 text-slate-700">{row.unitNumber}</td>
                          <td className="px-2 py-1.5 capitalize text-slate-700">{formatMethod(row.paymentMethod)}</td>
                          <td className="px-2 py-1.5 font-semibold text-emerald-700">{formatMoney(row.amount)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.allocatedAmount)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.rentApplied)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.utilityApplied)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{formatMoney(row.penaltyApplied)}</td>
                          <td className="px-2 py-1.5 font-semibold text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                          <td className="px-2 py-1.5 text-slate-700">{row.cashbook || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                  <div>
                    Showing {report.rows?.length ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}-
                    {Math.min(currentPage * ITEMS_PER_PAGE, report.rows?.length || 0)} of {report.rows?.length || 0} receipt row(s)
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

export default RentalCollectionReport;
