import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useEntityCache } from '../../hooks/useEntityCache';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { selectCurrentUser, selectCurrentCompany, selectAllProperties, selectAllTenants, selectAllLandlords } from '../../redux/selectors';
import { getLandlords, getRentalCollectionReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { getTenants } from '../../redux/tenantsRedux';
import { FaFileDownload, FaPrint, FaSyncAlt } from 'react-icons/fa';
import ResetFiltersButton from '../../components/common/ResetFiltersButton';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { buildTenantOption } from '../../utils/tenantUtils';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import AppSelect from '../../components/common/AppSelect';
import { adminRequests } from '../../utils/requestMethods';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';

const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatMethod = (value) => (value ? String(value).replace(/_/g, ' ') : 'All methods');
const ITEMS_PER_PAGE = 50;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ value: String(i + 1), label }));

const RentalCollectionReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);
  const tenants = useSelector(selectAllTenants);
  const landlords = useSelector(selectAllLandlords);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const { propertiesLoaded, tenantsLoaded } = useEntityCache(businessId);
  const isLandlordMode = isSelfManagingLandlordCompany(currentCompany || currentUser?.company);
  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || currentUser?.company?.name || currentUser?.company?.companyName || 'Milik';

  const [loading, setLoading] = useState(false);
  const [filtersChanged, setFiltersChanged] = useState(false);
  const filtersInitialized = useRef(false);
  const [zoneOptions, setZoneOptions] = useState([]);
  const [filters, setFilters] = useTabState("/reports/rental-collection:filters", () => ({
    startDate: toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: toDateInputValue(new Date()),
    propertyId: '', tenantId: '', unitId: '', landlordId: '',
    paymentMethod: '', cashbook: '', zone: '',
  }));
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const resetFilters = () => {
    setFilters({
      startDate: toDateInputValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
      endDate: toDateInputValue(new Date()),
      propertyId: '', tenantId: '', unitId: '', landlordId: '',
      paymentMethod: '', cashbook: '', zone: '',
    });
    setFiltersChanged(true);
  };
  const [report, setReport] = useState({ summary: {}, byProperty: [], rows: [], allUtilityTypes: [] });
  const [currentPage, setCurrentPage] = useTabState("/reports/rental-collection:currentPage", 1);

  useEffect(() => {
    if (!businessId) return;
    if (!propertiesLoaded) dispatch(getProperties({ business: businessId }));
    if (!tenantsLoaded) dispatch(getTenants({ business: businessId }));
    if (!isLandlordMode) dispatch(getLandlords({ company: businessId }));
  }, [businessId, isLandlordMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    adminRequests.get('/zones', { params: { limit: 500, isActive: 'true' } })
      .then((res) => setZoneOptions((res.data?.zones || []).map((z) => ({ value: z.name, label: z.name }))))
      .catch(() => {});
  }, []);

  const loadReport = useCallback(async (signal, filterOverrides = {}) => {
    if (!businessId) return;
    setLoading(true);
    setFiltersChanged(false);
    try {
      const data = await getRentalCollectionReport({ business: businessId, ...filters, ...filterOverrides }, signal);
      if (signal?.aborted) return;
      setReport({
        summary: data?.summary || {},
        byProperty: Array.isArray(data?.byProperty) ? data.byProperty : [],
        rows: Array.isArray(data?.rows) ? data.rows : [],
        allUtilityTypes: Array.isArray(data?.allUtilityTypes) ? data.allUtilityTypes : [],
      });
    } catch (error) {
      if (error?.name === 'CanceledError' || error?.name === 'AbortError') return;
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load rental collection report.');
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

  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    setFiltersChanged(true);
  }, [filters.startDate, filters.endDate, filters.propertyId, filters.tenantId, filters.unitId, filters.landlordId, filters.paymentMethod, filters.cashbook, filters.zone]);

  const units = useMemo(() => {
    return tenants
      .filter((t) => !filters.tenantId || String(t?._id) === String(filters.tenantId))
      .map((t) => { const u = t?.unit || {}; return { _id: u?._id || u, unitNumber: u?.unitNumber || u?.name || 'Unit' }; })
      .filter((u, idx, arr) => u._id && arr.findIndex((e) => String(e._id) === String(u._id)) === idx);
  }, [tenants, filters.tenantId]);

  const summary = report.summary || {};
  const allUtilityTypes = report.allUtilityTypes || [];
  const hasUtilityBreakdown = allUtilityTypes.length > 0;

  const propertyNameMap = useMemo(() => new Map(properties.map((p) => [String(p?._id), p?.propertyName || p?.name || 'Unnamed Property'])), [properties]);
  const tenantNameMap = useMemo(() => new Map(tenants.map((t) => [String(t?._id), t?.tenantName || t?.name || 'Unnamed Tenant'])), [tenants]);
  const landlordNameMap = useMemo(() => new Map(landlords.map((l) => [String(l?._id), l?.landlordName || l?.name || 'Unnamed Landlord'])), [landlords]);
  const unitNameMap = useMemo(() => new Map(units.map((u) => [String(u?._id), u?.unitNumber || 'Unit'])), [units]);

  const paginatedRows = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const startIndex = (Math.max(currentPage, 1) - 1) * ITEMS_PER_PAGE;
    return rows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [report.rows, currentPage]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil((report.rows?.length || 0) / ITEMS_PER_PAGE)), [report.rows]);

  useEffect(() => { setCurrentPage(1); }, [filters.startDate, filters.endDate, filters.propertyId, filters.tenantId, filters.unitId, filters.landlordId, filters.paymentMethod, filters.cashbook, filters.zone]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  // ── Month period selector ─────────────────────────────────────────────────
  const recentMonths = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 18 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (17 - i), 1);
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const isCurrent = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
      const startStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const endStr = isCurrent
        ? toDateInputValue(today)
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
      return {
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString('default', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2),
        startDate: startStr,
        endDate: endStr,
      };
    });
  }, []);

  // ── Month / Year period selector ──────────────────────────────────────────
  const yearOptions = useMemo(() => { const y = new Date().getFullYear(); return [y + 1, y, y - 1, y - 2, y - 3].map(String); }, []);
  const { selMonth, selYear } = useMemo(() => {
    const fallbackYear = String(new Date().getFullYear());
    if (!filters.startDate) return { selMonth: null, selYear: fallbackYear };
    const s = new Date(filters.startDate + 'T00:00:00');
    const lastDay = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    const expectedEnd = `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
    if (filters.startDate.endsWith('-01') && filters.endDate === expectedEnd) {
      return { selMonth: String(s.getMonth() + 1), selYear: String(s.getFullYear()) };
    }
    return { selMonth: null, selYear: String(s.getFullYear()) };
  }, [filters.startDate, filters.endDate]);
  const applyMonthYear = (month, year) => {
    const m = Number(month); const y = Number(year);
    if (!m || !y) return;
    const lastDay = new Date(y, m, 0).getDate();
    const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
    const endDate = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    setFilters(prev => ({ ...prev, startDate, endDate }));
    loadReport(undefined, { startDate, endDate });
  };
  const applyPeriod = (startDate, endDate) =>
    setFilters((prev) => ({ ...prev, startDate, endDate }));

  const handleExportCSV = () => {
    if (!canExportReports) { toast.error("You do not have permission to export reports"); return; }
    const utCols = hasUtilityBreakdown ? allUtilityTypes : ['Utility Applied'];
    const header = ['Date', 'Receipt #', 'Property', 'Tenant', 'Unit', 'Method', 'Collected', 'Allocated', 'Rent Applied', ...utCols, 'Penalty Applied', 'Unapplied', 'Cashbook'];
    const rows = (report.rows || []).map((row) => [
      row.paymentDate ? new Date(row.paymentDate).toLocaleDateString() : '',
      row.receiptNumber || '', row.propertyName || '', row.tenantName || '', row.unitNumber || '',
      row.paymentMethod || '', row.amount || 0, row.allocatedAmount || 0, row.rentApplied || 0,
      ...(hasUtilityBreakdown ? allUtilityTypes.map((ut) => row.utilityBreakdown?.[ut] || 0) : [row.utilityApplied || 0]),
      row.penaltyApplied || 0, row.unappliedAmount || 0, row.cashbook || '',
    ]);
    const csv = [header, ...rows].map((line) => line.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rental_collection_${filters.startDate}_to_${filters.endDate}.csv`;
    a.click(); URL.revokeObjectURL(url);
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
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const byProp = Array.isArray(report.byProperty) ? report.byProperty : [];
    const utTypes = allUtilityTypes;
    const hasUt = utTypes.length > 0;

    // Totals
    const totCollected = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const totAllocated = rows.reduce((s, r) => s + Number(r.allocatedAmount || 0), 0);
    const totRent = rows.reduce((s, r) => s + Number(r.rentApplied || 0), 0);
    const totUnapplied = rows.reduce((s, r) => s + Number(r.unappliedAmount || 0), 0);
    const utTotals = hasUt
      ? utTypes.reduce((m, ut) => { m[ut] = rows.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
      : {};
    const totUtility = rows.reduce((s, r) => s + Number(r.utilityApplied || 0), 0);
    const totPenalty = rows.reduce((s, r) => s + Number(r.penaltyApplied || 0), 0);

    const utDetailHeader = hasUt
      ? utTypes.map((ut) => `<th class="r">${ut}</th>`).join('')
      : `<th class="r">Utilities</th>`;
    const utPropHeader = hasUt
      ? utTypes.map((ut) => `<th class="r">${ut}</th>`).join('')
      : `<th class="r">Utilities</th>`;

    const propByUtTotals = hasUt
      ? utTypes.reduce((m, ut) => { m[ut] = byProp.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
      : {};

    win.document.write(`<!DOCTYPE html><html><head><title>Rental Collection Report — ${name}</title><style>
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
      .card.grn{border-color:#d1fae5;background:#f0fdf4}.card.amb{border-color:#fef3c7;background:#fffbeb}
      .cl{font-size:6.5px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:10.5px;font-weight:900;color:#0f172a;margin-top:2px;white-space:nowrap}
      .cv.grn{color:#047857}.cv.amb{color:#b45309}.cv.red{color:#b91c1c}
      table{width:100%;border-collapse:collapse;font-size:7.5px;margin-bottom:8px}
      thead th{background:#0B3B2E;color:#fff;padding:3px 5px;font-size:6.8px;text-transform:uppercase;letter-spacing:.09em;font-weight:800;white-space:nowrap}
      thead th.r{text-align:right}
      tbody td{border-bottom:1px solid #e2e8f0;padding:2.5px 5px;vertical-align:middle}
      tbody td.r{text-align:right}
      tbody td.name{font-weight:700}
      tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:3px 5px;font-weight:900;background:#edf5f1;font-size:7px}
      tfoot td.r{text-align:right}
      .sec-title{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#0B3B2E;font-weight:900;margin:8px 0 4px;border-bottom:1px solid #dbe2ea;padding-bottom:3px}
      .page-break{page-break-before:always}
    </style></head><body>
    <div class="hdr">
      <div class="hdr-left">
        ${logo ? `<img src="${logo}" class="logo" alt="">` : ''}
        <div class="co">${name}</div>
        <div class="ttl">Rental Collection Report</div>
        <div class="sub">Cash received, allocation efficiency and unapplied balances — ${fmtDate(filters.startDate)} to ${fmtDate(filters.endDate)}</div>
      </div>
      <div class="hdr-right">
        <div><strong>Period:</strong> ${fmtDate(filters.startDate)} to ${fmtDate(filters.endDate)}</div>
        <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
        <div><strong>Prepared by:</strong> ${by}</div>
        <div><strong>Receipts:</strong> ${rows.length}</div>
      </div>
    </div>
    <div class="cards">
      <div class="card grn"><div class="cl">Operational Income</div><div class="cv grn">${fmt(summary.operationalCollected ?? summary.totalCollected)}</div></div>
      <div class="card"><div class="cl">Total Collected</div><div class="cv">${fmt(summary.totalCollected)}</div></div>
      <div class="card"><div class="cl">Allocated</div><div class="cv">${fmt(summary.allocatedAmount)}</div></div>
      <div class="card amb"><div class="cl">Unapplied</div><div class="cv amb">${fmt(summary.unappliedAmount)}</div></div>
      <div class="card"><div class="cl">Receipts</div><div class="cv">${Number(summary.totalPayments || rows.length)}</div></div>
      <div class="card"><div class="cl">Collection Rate</div><div class="cv">${formatPercent(summary.collectionRate)}</div></div>
    </div>
    <div class="sec-title">Collection Summary by Property</div>
    <table><thead><tr>
      <th>Property</th><th>Receipts</th><th>Tenants</th><th class="r">Collected</th><th class="r">Rent</th>${utPropHeader}<th class="r">Penalty</th><th class="r">Unapplied</th>
    </tr></thead>
    <tbody>${byProp.map((row) => `<tr>
      <td class="name">${row.propertyName}</td>
      <td>${row.paymentCount}</td>
      <td>${row.tenantCount}</td>
      <td class="r" style="color:#047857;font-weight:700">${fmt(row.totalCollected)}</td>
      <td class="r">${fmt(row.rentApplied)}</td>
      ${hasUt ? utTypes.map((ut) => `<td class="r">${fmt(row.utilityBreakdown?.[ut] || 0)}</td>`).join('') : `<td class="r">${fmt(row.utilityApplied)}</td>`}
      <td class="r">${fmt(row.penaltyApplied)}</td>
      <td class="r" style="color:${Number(row.unappliedAmount || 0) > 0 ? '#b45309' : 'inherit'}">${fmt(row.unappliedAmount)}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td><strong>TOTAL</strong></td><td>${byProp.reduce((s, r) => s + r.paymentCount, 0)}</td><td></td>
      <td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.totalCollected || 0), 0))}</strong></td>
      <td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.rentApplied || 0), 0))}</strong></td>
      ${hasUt ? utTypes.map((ut) => `<td class="r"><strong>${fmt(propByUtTotals[ut] || 0)}</strong></td>`).join('') : `<td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.utilityApplied || 0), 0))}</strong></td>`}
      <td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.penaltyApplied || 0), 0))}</strong></td>
      <td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.unappliedAmount || 0), 0))}</strong></td>
    </tr></tfoot>
    </table>
    <div class="sec-title page-break">Detailed Receipts</div>
    <table><thead><tr>
      <th>Date</th><th>Receipt #</th><th>Property</th><th>Tenant</th><th>Unit</th><th>Method</th>
      <th class="r">Collected</th><th class="r">Allocated</th><th class="r">Rent</th>
      ${utDetailHeader}<th class="r">Penalty</th><th class="r">Unapplied</th><th>Cashbook</th>
    </tr></thead>
    <tbody>${rows.map((row) => {
      const utCells = hasUt
        ? utTypes.map((ut) => `<td class="r">${fmt(row.utilityBreakdown?.[ut] || 0)}</td>`).join('')
        : `<td class="r">${fmt(row.utilityApplied)}</td>`;
      return `<tr>
        <td style="white-space:nowrap">${row.paymentDate ? new Date(row.paymentDate).toLocaleDateString() : '—'}</td>
        <td>${row.receiptNumber || '—'}</td>
        <td>${row.propertyName || '—'}</td>
        <td class="name">${row.tenantName || '—'}</td>
        <td>${row.unitNumber || '—'}</td>
        <td style="text-transform:capitalize">${formatMethod(row.paymentMethod)}</td>
        <td class="r" style="color:#047857;font-weight:700">${fmt(row.amount)}</td>
        <td class="r">${fmt(row.allocatedAmount)}</td>
        <td class="r">${fmt(row.rentApplied)}</td>
        ${utCells}
        <td class="r">${fmt(row.penaltyApplied)}</td>
        <td class="r" style="color:${Number(row.unappliedAmount || 0) > 0 ? '#b45309' : 'inherit'}">${fmt(row.unappliedAmount)}</td>
        <td>${row.cashbook || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
    <tfoot><tr>
      <td colspan="6"><strong>TOTALS — ${rows.length} receipts</strong></td>
      <td class="r" style="color:#047857"><strong>${fmt(totCollected)}</strong></td>
      <td class="r"><strong>${fmt(totAllocated)}</strong></td>
      <td class="r"><strong>${fmt(totRent)}</strong></td>
      ${hasUt ? utTypes.map((ut) => `<td class="r"><strong>${fmt(utTotals[ut])}</strong></td>`).join('') : `<td class="r"><strong>${fmt(totUtility)}</strong></td>`}
      <td class="r"><strong>${fmt(totPenalty)}</strong></td>
      <td class="r" style="color:#b45309"><strong>${fmt(totUnapplied)}</strong></td>
      <td></td>
    </tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, currentUser, report, filters, allUtilityTypes, summary]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="no-print milik-report-page flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-1.5">
        <style>{`
          .milik-report-page select:focus, .milik-report-page input:focus { border-color: #0B3B2E; box-shadow: 0 0 0 1px rgba(11,59,46,0.2); outline: none; }
        `}</style>
        <div className="mx-auto flex w-full max-w-none min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

            {/* ── Toolbar ── */}
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5 px-3 py-2.5">
                <div>
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Period</p>
                  <div className="flex items-center gap-1">
                    <div className="w-[130px]">
                      <AppSelect
                        value={selMonth}
                        onChange={(v) => applyMonthYear(v, selYear)}
                        options={MONTHS}
                        placeholder="Month"
                        clearable size="sm"
                      />
                    </div>
                    <select
                      value={selYear}
                      onChange={(e) => applyMonthYear(selMonth, e.target.value)}
                      className="h-7 w-[72px] rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[#0B3B2E] focus:outline-none"
                    >
                      {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <span className="h-4 w-px bg-slate-200 mx-0.5" />
                    <input type="date" value={filters.startDate} onChange={setFilter("startDate")} className="h-7 w-[110px] rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20" />
                    <span className="text-[10px] font-semibold text-slate-400">–</span>
                    <input type="date" value={filters.endDate} onChange={setFilter("endDate")} className="h-7 w-[110px] rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  </div>
                </div>
                <div className="w-[140px]">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Zone</p>
                  <AppSelect value={filters.zone || null} onChange={(v) => setFilters((p) => ({ ...p, zone: v ?? "", propertyId: "" }))} options={zoneOptions} placeholder="All zones" searchable clearable size="sm" />
                </div>
                <div className="w-[165px]">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Property</p>
                  <AppSelect value={filters.propertyId || null} onChange={(v) => setFilters((p) => ({ ...p, propertyId: v ?? "", zone: "" }))} options={properties.map((p) => ({ value: p._id, label: p.propertyName || p.name }))} placeholder="All properties" searchable clearable size="sm" />
                </div>
                <div className="w-[155px]">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Tenant</p>
                  <AppSelect value={filters.tenantId || null} onChange={(v) => setFilters((p) => ({ ...p, tenantId: v ?? "", unitId: "" }))} options={tenants.map((t) => buildTenantOption(t))} placeholder="All tenants" searchable clearable size="sm" />
                </div>
                <div className="w-[110px]">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Unit</p>
                  <AppSelect value={filters.unitId || null} onChange={(v) => setFilters((p) => ({ ...p, unitId: v ?? "" }))} options={units.map((u) => ({ value: u._id, label: u.unitNumber }))} placeholder="All units" searchable clearable size="sm" />
                </div>
                {!isLandlordMode && (
                  <div className="w-[155px]">
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Landlord</p>
                    <AppSelect value={filters.landlordId || null} onChange={(v) => setFilters((p) => ({ ...p, landlordId: v ?? "" }))} options={landlords.map((l) => ({ value: l._id, label: l.landlordName || l.name }))} placeholder="All landlords" searchable clearable size="sm" />
                  </div>
                )}
                <div className="w-[130px]">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Method</p>
                  <AppSelect value={filters.paymentMethod || null} onChange={(v) => setFilters((p) => ({ ...p, paymentMethod: v ?? "" }))}
                    options={[{ value: "cash", label: "Cash" }, { value: "mobile_money", label: "Mobile money" }, { value: "bank_transfer", label: "Bank transfer" }, { value: "check", label: "Cheque" }, { value: "credit_card", label: "Card" }]}
                    placeholder="All methods" clearable size="sm" />
                </div>
                <div>
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-slate-400">Cashbook</p>
                  <input value={filters.cashbook} onChange={setFilter("cashbook")} placeholder="Contains..." className="h-7 w-[140px] rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 placeholder:text-slate-400 focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </div>
                <div className="flex-1" />
                <div className="flex items-end gap-1.5">
                  <button onClick={handleExportCSV} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaFileDownload size={10} /> Export</button>
                  <button onClick={handlePrint} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-600 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint size={10} /> Print</button>
                  <ResetFiltersButton onReset={resetFilters} disabled={loading} />
                  <button onClick={() => loadReport()} className={`inline-flex h-7 items-center gap-1.5 rounded px-3 text-[10px] font-bold uppercase tracking-[0.08em] transition ${filtersChanged ? 'bg-[#0B3B2E] text-white hover:bg-[#0A3127]' : 'border border-slate-200 bg-white text-slate-600 hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white'}`}><FaSyncAlt size={10} className={loading ? 'animate-spin' : ''} />{filtersChanged ? 'Apply Filters' : 'Refresh'}</button>
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden bg-white p-1.5">

              {/* ── Property summary ── */}
              <div className="flex min-h-0 max-h-[32%] flex-col overflow-hidden rounded-lg border border-slate-200">
                <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-[10px] font-bold text-white">Collection Summary by Property</div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#0B3B2E] text-white">
                        {['Property', 'Receipts', 'Tenants', 'Collected', 'Rent',
                          ...(hasUtilityBreakdown ? allUtilityTypes : ['Utilities']),
                          'Penalty', 'Unapplied'
                        ].map((h, i, arr) => (
                          <th key={h} className={`whitespace-nowrap px-2 py-1 text-left font-bold text-[9px] tracking-wide ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.byProperty || []).length === 0 ? (
                        <tr><td colSpan={6 + (hasUtilityBreakdown ? allUtilityTypes.length : 1)} className="px-2 py-4 text-center text-slate-500">No collection rows found.</td></tr>
                      ) : (report.byProperty || []).map((row, idx) => (
                        <tr key={row.propertyId || row.propertyName} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/50 hover:bg-emerald-50/30'}`}>
                          <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.propertyName}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.paymentCount}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.tenantCount}</td>
                          <td className="px-2 py-1 border-r border-gray-100 font-semibold text-emerald-700">{formatMoney(row.totalCollected)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.rentApplied)}</td>
                          {hasUtilityBreakdown
                            ? allUtilityTypes.map((ut) => <td key={ut} className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.utilityBreakdown?.[ut] || 0)}</td>)
                            : <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.utilityApplied)}</td>
                          }
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.penaltyApplied)}</td>
                          <td className="px-2 py-1 text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Detailed receipts ── */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200">
                <div className="flex-shrink-0 bg-[#0B3B2E] px-2 py-1.5 text-[10px] font-bold text-white">
                  Detailed Receipts
                  {hasUtilityBreakdown && <span className="ml-2 font-normal opacity-70">Utilities: {allUtilityTypes.join(' · ')}</span>}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#0B3B2E] text-white">
                        {['Date', 'Receipt #', 'Property', 'Tenant', 'Unit', 'Method', 'Collected', 'Allocated', 'Rent',
                          ...(hasUtilityBreakdown ? allUtilityTypes : ['Utilities']),
                          'Penalty', 'Unapplied', 'Cashbook'
                        ].map((h, i, arr) => (
                          <th key={h} className={`whitespace-nowrap px-2 py-1 text-left font-bold text-[9px] tracking-wide ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.rows || []).length === 0 ? (
                        <tr><td colSpan={11 + (hasUtilityBreakdown ? allUtilityTypes.length : 1)} className="px-2 py-4 text-center text-slate-500">No receipts found for the current filters.</td></tr>
                      ) : paginatedRows.map((row, idx) => (
                        <tr key={row.receiptId} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/50 hover:bg-emerald-50/30'}`}>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700 whitespace-nowrap">{fmtDate(row.paymentDate)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.receiptNumber || '—'}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.propertyName}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.tenantName}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                          <td className="px-2 py-1 border-r border-gray-100 capitalize text-slate-700">{formatMethod(row.paymentMethod)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 font-semibold text-emerald-700">{formatMoney(row.amount)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.allocatedAmount)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.rentApplied)}</td>
                          {hasUtilityBreakdown
                            ? allUtilityTypes.map((ut) => <td key={ut} className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.utilityBreakdown?.[ut] || 0)}</td>)
                            : <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.utilityApplied)}</td>
                          }
                          <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{formatMoney(row.penaltyApplied)}</td>
                          <td className="px-2 py-1 border-r border-gray-100 font-semibold text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                          <td className="px-2 py-1 text-slate-700">{row.cashbook || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                  <div>Showing {report.rows?.length ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}–{Math.min(currentPage * ITEMS_PER_PAGE, report.rows?.length || 0)} of {report.rows?.length || 0} receipt row(s)</div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">50 items per page</span>
                    <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:opacity-50">Previous</button>
                    <span className="font-semibold text-slate-700">Page {currentPage} of {totalPages}</span>
                    <button type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 disabled:opacity-50">Next</button>
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
