import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties } from '../../redux/selectors';
import { getMRITaxSummaryReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaFileDownload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MRITaxSummaryReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);

  const isLandlordMode = isSelfManagingLandlordCompany(currentCompany || currentUser?.company);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const companyName = currentCompany?.name
    || currentCompany?.companyName
    || currentCompany?.businessName
    || currentUser?.company?.name
    || 'Milik';

  const currentYear = new Date().getFullYear();

  const [loading, setLoading] = useState(false);
  const [filtersChanged, setFiltersChanged] = useState(false);
  const filtersInitialized = useRef(false);
  const [filters, setFilters] = useState({
    startDate: toDateInputValue(new Date(currentYear, 0, 1)),
    endDate: toDateInputValue(new Date(currentYear, 11, 31)),
    propertyId: '',
  });
  const [report, setReport] = useState({ summary: {}, byProperty: [], byMonth: [], mriRate: 0.075 });

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch]);

  const loadReport = async () => {
    if (!businessId) return;
    setLoading(true);
    setFiltersChanged(false);
    try {
      const data = await getMRITaxSummaryReport({ business: businessId, ...filters });
      setReport({
        summary: data?.summary || {},
        byProperty: Array.isArray(data?.byProperty) ? data.byProperty : [],
        byMonth: Array.isArray(data?.byMonth) ? data.byMonth : [],
        mriRate: data?.mriRate ?? 0.075,
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load MRI tax summary.');
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
  }, [filters.startDate, filters.endDate, filters.propertyId]);

  const summary = report.summary || {};
  const mriRatePercent = Math.round((report.mriRate || 0.075) * 100);
  const propertyNameMap = useMemo(() => new Map(properties.map((p) => [String(p?._id), p?.propertyName || p?.name || 'Unnamed'])), [properties]);
  const printGeneratedAt = useMemo(() => new Date().toLocaleString(), [report, filters]);

  const handleExportCSV = () => {
    if (!canExportReports) {
      toast.warning ? toast.warning('No export permission') : toast.error('No export permission');
      return;
    }
    const propHeader = ['Property', 'Gross Rent', `MRI Tax (${mriRatePercent}%)`];
    const propRows = (report.byProperty || []).map((row) => [
      row.propertyName || '',
      row.grossRent || 0,
      row.mriTax || 0,
    ]);
    const monthHeader = ['Month', 'Gross Rent', `MRI Tax (${mriRatePercent}%)`];
    const monthRows = (report.byMonth || []).map((row) => [
      `${MONTH_NAMES[(row.month || 1) - 1]} ${row.year}`,
      row.grossRent || 0,
      row.mriTax || 0,
    ]);

    const lines = [
      'PROPERTY SUMMARY',
      propHeader.map((c) => `"${c}"`).join(','),
      ...propRows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')),
      '',
      'MONTHLY BREAKDOWN',
      monthHeader.map((c) => `"${c}"`).join(','),
      ...monthRows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mri_tax_summary_${filters.startDate}_to_${filters.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.error('No print permission'); return; }
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const by = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || '';
    const win = window.open('', '_blank', 'width=900,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const printTitle = isLandlordMode ? 'Rental Income Tax (MRI)' : 'MRI Tax Summary';
    win.document.write(`<!DOCTYPE html><html><head><title>${printTitle}</title><style>
      @page{size:A4 portrait;margin:14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:13px;font-weight:900;color:#0f172a;margin-top:3px}
      h3{font-size:10px;text-transform:uppercase;letter-spacing:.14em;color:#0B3B2E;font-weight:900;margin:14px 0 6px}
      table{width:100%;border-collapse:collapse;font-size:9px;margin-bottom:12px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 8px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:4px 8px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 8px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      .note{margin-top:14px;border-left:4px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:8px 10px;font-size:8.5px;color:#78350f}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">${printTitle}</div><div class="sub">Residential Rental Income — ${mriRatePercent}% flat rate · Period: ${formatDate(filters.startDate)} to ${formatDate(filters.endDate)}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div><div>Prepared by: ${by}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Total Gross Rent</div><div class="cv">${fmt(summary.totalGrossRent)}</div></div>
      <div class="card"><div class="cl">Total MRI Tax (${mriRatePercent}%)</div><div class="cv" style="color:#c2410c">${fmt(summary.totalMriTax)}</div></div>
      <div class="card"><div class="cl">Properties</div><div class="cv">${(report.byProperty || []).length}</div></div>
    </div>
    <h3>By Property</h3>
    <table><thead><tr><th>Property</th><th class="r">Gross Rent</th><th class="r">MRI Tax (${mriRatePercent}%)</th></tr></thead>
    <tbody>${(report.byProperty || []).map((row) => `<tr><td>${row.propertyName || '—'}</td><td class="r">${fmt(row.grossRent)}</td><td class="r" style="color:#c2410c"><strong>${fmt(row.mriTax)}</strong></td></tr>`).join('')}</tbody>
    <tfoot><tr><td><strong>TOTAL</strong></td><td class="r"><strong>${fmt(summary.totalGrossRent)}</strong></td><td class="r" style="color:#c2410c"><strong>${fmt(summary.totalMriTax)}</strong></td></tr></tfoot></table>
    <h3>Monthly Breakdown</h3>
    <table><thead><tr><th>Month</th><th class="r">Gross Rent</th><th class="r">MRI Tax (${mriRatePercent}%)</th></tr></thead>
    <tbody>${(report.byMonth || []).map((row) => `<tr><td>${MONTH_NAMES[(row.month || 1) - 1]} ${row.year}</td><td class="r">${fmt(row.grossRent)}</td><td class="r" style="color:#c2410c">${fmt(row.mriTax)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="note">MRI tax is computed at ${mriRatePercent}% on gross residential rent as per Kenya Revenue Authority guidelines. This report is for informational purposes and should be reviewed alongside official KRA submissions.</div>
    </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, currentUser, report, summary, mriRatePercent, filters.startDate, filters.endDate]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="print-only-wrapper">
        <style>{`
          @page { size: A4 portrait; margin: 14mm; }
          .mri-print-shell { font-family: 'Nunito Sans', Arial, sans-serif; color: #0f172a; }
          .mri-print-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
          .mri-print-brand { font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; color: #0B3B2E; font-weight: 800; }
          .mri-print-title { margin: 2px 0 4px; font-size: 20px; font-weight: 900; color: #0f172a; }
          .mri-print-subtitle { margin: 0; font-size: 10px; line-height: 1.45; color: #475569; max-width: 500px; }
          .mri-print-meta { text-align: right; font-size: 10px; color: #475569; }
          .mri-print-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
          .mri-print-metric { border: 1px solid #dbe2ea; border-radius: 10px; background: #f8fafc; padding: 10px 12px; }
          .mri-print-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; font-weight: 800; }
          .mri-print-value { margin-top: 5px; font-size: 16px; font-weight: 900; color: #0f172a; }
          .mri-print-section { margin-top: 16px; }
          .mri-print-section-title { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #0B3B2E; font-weight: 900; }
          .mri-print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
          .mri-print-table th, .mri-print-table td { border: 1px solid #dbe2ea; padding: 6px 8px; }
          .mri-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; text-align: left; }
          .mri-print-table tbody tr:nth-child(even) { background: #fafafa; }
          .text-right { text-align: right; }
          .text-orange { color: #c2410c; font-weight: 800; }
          .text-emerald { color: #047857; font-weight: 800; }
          .mri-disclaimer { margin-top: 20px; border-left: 4px solid #f59e0b; background: #fffbeb; border-radius: 8px; padding: 10px 12px; font-size: 9px; line-height: 1.55; color: #78350f; }
        `}</style>

        <div className="mri-print-shell">
          <div className="mri-print-header">
            <div>
              <div className="mri-print-brand">{companyName}</div>
              <h1 className="mri-print-title">{isLandlordMode ? 'Rental Income Tax (MRI)' : 'MRI Tax Summary'}</h1>
              <p className="mri-print-subtitle">
                Residential Rental Income (MRI) tax summary — {mriRatePercent}% flat rate on gross rent collected.
                Period: {formatDate(filters.startDate)} to {formatDate(filters.endDate)}.
              </p>
            </div>
            <div className="mri-print-meta">
              <div><strong>Generated:</strong> {printGeneratedAt}</div>
              <div><strong>Prepared by:</strong> {[currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || 'Milik Admin'}</div>
            </div>
          </div>

          <div className="mri-print-grid">
            {[
              { label: 'Gross Rent Collected', value: formatMoney(summary.grossRent) },
              { label: `MRI Tax (${mriRatePercent}%)`, value: formatMoney(summary.mriTax) },
              { label: 'Properties', value: summary.propertyCount || 0 },
            ].map((card) => (
              <div key={card.label} className="mri-print-metric">
                <div className="mri-print-label">{card.label}</div>
                <div className="mri-print-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="mri-print-section">
            <h2 className="mri-print-section-title">By Property</h2>
            <table className="mri-print-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th className="text-right">Gross Rent</th>
                  <th className="text-right">MRI Tax ({mriRatePercent}%)</th>
                </tr>
              </thead>
              <tbody>
                {(report.byProperty || []).length === 0 ? (
                  <tr><td colSpan={3}>No data for selected period.</td></tr>
                ) : (report.byProperty || []).map((row) => (
                  <tr key={row.propertyId || row.propertyName}>
                    <td>{row.propertyName}</td>
                    <td className="text-right text-emerald">{formatMoney(row.grossRent)}</td>
                    <td className="text-right text-orange">{formatMoney(row.mriTax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mri-print-section">
            <h2 className="mri-print-section-title">Monthly Breakdown</h2>
            <table className="mri-print-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Gross Rent</th>
                  <th className="text-right">MRI Tax ({mriRatePercent}%)</th>
                </tr>
              </thead>
              <tbody>
                {(report.byMonth || []).length === 0 ? (
                  <tr><td colSpan={3}>No monthly data.</td></tr>
                ) : (report.byMonth || []).map((row) => (
                  <tr key={row.monthKey || `${row.year}-${row.month}`}>
                    <td>{MONTH_NAMES[(row.month || 1) - 1]} {row.year}</td>
                    <td className="text-right text-emerald">{formatMoney(row.grossRent)}</td>
                    <td className="text-right text-orange">{formatMoney(row.mriTax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mri-disclaimer">
            <strong>Disclaimer:</strong> This report is generated from payment records in the MILIK system and is for reference purposes only.
            The {mriRatePercent}% MRI rate applies to gross rental income as stipulated under the Kenya Income Tax Act (Residential Rental Income Tax).
            Consult a qualified tax advisor before filing your returns.
          </div>
        </div>
      </div>

      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #f45b0b; box-shadow: 0 0 0 1px rgba(244, 91, 11, 0.45); outline: none; }
        `}</style>

        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            {/* Filter bar */}
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className="grid gap-1.5 md:grid-cols-3">
                <input type="date" value={filters.startDate} onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))} className="h-7 rounded border border-slate-200 bg-white px-2 text-xs transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <input type="date" value={filters.endDate} onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))} className="h-7 rounded border border-slate-200 bg-white px-2 text-xs transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="h-7 rounded border border-slate-200 bg-white px-2 text-xs transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20">
                  <option value="">All properties</option>
                  {properties.map((p) => <option key={p._id} value={p._id}>{p.propertyName || p.name}</option>)}
                </select>
              </div>
              <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                <button onClick={handleExportCSV} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700"><FaFileDownload /> Export CSV</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700"><FaPrint /> Print</button>
                <button onClick={loadReport} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] transition ${filtersChanged ? 'border border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100' : 'border border-slate-200 bg-white text-slate-700 hover:border-orange-500 hover:bg-orange-50 hover:text-orange-700'}`}><FaSyncAlt className={loading ? 'animate-spin' : ''} /> {filtersChanged ? 'Apply Filters' : 'Refresh'}</button>
              </div>
            </div>

            {/* Summary metrics */}
            <div className="grid flex-shrink-0 gap-1.5 border-b border-slate-200 bg-white p-1.5 md:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Gross Rent Collected</div>
                <div className="mt-0.5 text-base font-black text-emerald-700">{formatMoney(summary.grossRent)}</div>
              </div>
              <div className="rounded-md border border-orange-100 bg-orange-50 px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-orange-600">MRI Tax ({mriRatePercent}% Flat Rate)</div>
                <div className="mt-0.5 text-base font-black text-orange-700">{formatMoney(summary.mriTax)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Properties</div>
                <div className="mt-0.5 text-base font-black text-slate-900">{summary.propertyCount || 0}</div>
              </div>
            </div>

            {/* Info banner */}
            <div className="flex-shrink-0 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[10px] text-amber-800">
              <strong>Kenya Residential Rental Income (MRI) Tax:</strong> {mriRatePercent}% flat rate on gross rent collected, paid monthly to KRA. This report uses confirmed receipts from the selected period. Consult your tax advisor before filing.
            </div>

            {/* Tables */}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden bg-white p-1.5">
              <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden md:flex-row">

                {/* By property */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-xs font-bold text-white">By Property</div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <table className="min-w-full text-[11px] border-collapse">
                      <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="whitespace-nowrap px-2 py-1 text-left font-bold border-r border-white/10">Property</th>
                          <th className="whitespace-nowrap px-2 py-1 text-left font-bold border-r border-white/10">Gross Rent</th>
                          <th className="whitespace-nowrap px-2 py-1 text-left font-bold">MRI Tax ({mriRatePercent}%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.byProperty || []).length === 0 ? (
                          <tr><td colSpan={3} className="px-2 py-4 text-center text-slate-500">{loading ? 'Loading…' : 'No data for selected period.'}</td></tr>
                        ) : (report.byProperty || []).map((row, i) => (
                          <tr key={row.propertyId || row.propertyName} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.propertyName}</td>
                            <td className="px-2 py-1 border-r border-gray-100 font-semibold text-emerald-700">{formatMoney(row.grossRent)}</td>
                            <td className="px-2 py-1 font-semibold text-orange-700">{formatMoney(row.mriTax)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* By month */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-xs font-bold text-white">Monthly Breakdown</div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <table className="min-w-full text-[11px] border-collapse">
                      <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="whitespace-nowrap px-2 py-1 text-left font-bold border-r border-white/10">Month</th>
                          <th className="whitespace-nowrap px-2 py-1 text-left font-bold border-r border-white/10">Gross Rent</th>
                          <th className="whitespace-nowrap px-2 py-1 text-left font-bold">MRI Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(report.byMonth || []).length === 0 ? (
                          <tr><td colSpan={3} className="px-2 py-4 text-center text-slate-500">{loading ? 'Loading…' : 'No monthly data.'}</td></tr>
                        ) : (report.byMonth || []).map((row, i) => (
                          <tr key={row.monthKey || `${row.year}-${row.month}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{MONTH_NAMES[(row.month || 1) - 1]} {row.year}</td>
                            <td className="px-2 py-1 border-r border-gray-100 font-semibold text-emerald-700">{formatMoney(row.grossRent)}</td>
                            <td className="px-2 py-1 font-semibold text-orange-700">{formatMoney(row.mriTax)}</td>
                          </tr>
                        ))}
                        {(report.byMonth || []).length > 0 && (
                          <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                            <td className="px-2 py-1.5 text-slate-900">Total</td>
                            <td className="px-2 py-1.5 text-emerald-700">{formatMoney(summary.grossRent)}</td>
                            <td className="px-2 py-1.5 text-orange-700">{formatMoney(summary.mriTax)}</td>
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
      </div>
    </DashboardLayout>
  );
};

export default MRITaxSummaryReport;
