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
import useDebounce from '../../hooks/useDebounce';
import ResetFiltersButton from '../../components/common/ResetFiltersButton';
import { toast } from 'react-toastify';
import { hasCompanyPermission } from '../../utils/permissions';
import { buildTenantOption } from '../../utils/tenantUtils';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import AppSelect from '../../components/common/AppSelect';
import { adminRequests } from '../../utils/requestMethods';
import { fmtDate } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import { useTerms } from '../../hooks/useTerm';

const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatMethod = (value) => (value ? String(value).replace(/_/g, ' ') : 'All methods');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  .map((label, i) => ({ value: String(i + 1), label }));

// Module-scope — stable reference avoids busting AppSelect's internal useMemo every render
const PAYMENT_METHOD_OPTIONS = [
  { value: "cash",          label: "Cash" },
  { value: "mobile_money",  label: "Mobile money" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "check",         label: "Cheque" },
  { value: "credit_card",   label: "Card" },
];

const RentalCollectionReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const { tenant: termTenant, tenants: termTenants, unit: termUnit, units: termUnits, property: termProperty, properties: termProperties, landlord: termLandlord } = useTerms("tenant", "tenants", "unit", "units", "property", "properties", "landlord");
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", ["accounts", "propertyManagement"]);
  const properties = useSelector(selectAllProperties);
  const tenants = useSelector(selectAllTenants);
  const landlords = useSelector(selectAllLandlords);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const { propertiesLoaded, tenantsLoaded } = useEntityCache(businessId);
  const isLandlordMode = isSelfManagingLandlordCompany(currentCompany || currentUser?.company);
  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || currentUser?.company?.name || currentUser?.company?.companyName || 'Milik';

  const [loading, setLoading] = useState(false);
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
  };
  const [report, setReport] = useState({ summary: {}, byProperty: [], rows: [], allUtilityTypes: [] });

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

  const loadReportRef = useRef(null);
  const loadReport = useCallback(async (signal, filterOverrides = {}) => {
    if (!businessId) return;
    setLoading(true);
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

  useEffect(() => { loadReportRef.current = loadReport; }, [loadReport]);

  const debouncedTrigger = useDebounce(
    `${filters.startDate}|${filters.endDate}|${filters.propertyId}|${filters.tenantId}|${filters.unitId}|${filters.landlordId}|${filters.paymentMethod}|${filters.cashbook}|${filters.zone}`,
    500
  );
  useEffect(() => {
    if (!filtersInitialized.current) { filtersInitialized.current = true; return; }
    const controller = new AbortController();
    loadReportRef.current(controller.signal);
    return () => controller.abort();
  }, [debouncedTrigger]);

  const units = useMemo(() => {
    return tenants
      .filter((t) => !filters.tenantId || String(t?._id) === String(filters.tenantId))
      .map((t) => { const u = t?.unit || {}; return { _id: u?._id || u, unitNumber: u?.unitNumber || u?.name || 'Unit' }; })
      .filter((u, idx, arr) => u._id && arr.findIndex((e) => String(e._id) === String(u._id)) === idx);
  }, [tenants, filters.tenantId]);

  // Stable option arrays — avoids busting AppSelect's internal useMemo on every render
  const propertyOptions = useMemo(() => properties.map((p) => ({ value: p._id, label: p.propertyName || p.name })), [properties]);
  const tenantOptions   = useMemo(() => tenants.map((t) => buildTenantOption(t)), [tenants]);
  const unitOptions     = useMemo(() => units.map((u) => ({ value: u._id, label: u.unitNumber })), [units]);
  const landlordOptions = useMemo(() => landlords.map((l) => ({ value: l._id, label: l.landlordName || l.name })), [landlords]);

  const summary = report.summary || {};
  const allUtilityTypes = report.allUtilityTypes || [];
  const hasUtilityBreakdown = allUtilityTypes.length > 0;


  const detailGroups = useMemo(() => {
    const groups = new Map();
    for (const row of (report.rows || [])) {
      const key = String(row.propertyId || row.propertyName || 'Unknown');
      if (!groups.has(key)) groups.set(key, { propertyId: key, propertyName: row.propertyName || 'Unknown Property', rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()];
  }, [report.rows]);


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

  const handleExportCSV = () => {
    if (!canExportReports) { toast.error("You do not have permission to export reports"); return; }
    const utCols = hasUtilityBreakdown ? allUtilityTypes : ['Utility Applied'];
    const header = ['Date', 'Receipt #', termProperty, termTenant, termUnit, 'Method', 'Collected', 'Allocated', 'Rent Applied', ...utCols, 'Penalty Applied', 'Unapplied', 'Cashbook'];
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

    const GRN = "#0B3B2E";
    const co = {
      name: currentCompany?.companyName || currentCompany?.name || currentCompany?.businessName || 'Milik',
      logo: currentCompany?.logo || '',
      phone: currentCompany?.phone || currentCompany?.phoneNo || currentCompany?.phoneNumber || '',
      email: currentCompany?.email || currentCompany?.companyEmail || '',
      address: [currentCompany?.address || currentCompany?.postalAddress || '', currentCompany?.town || currentCompany?.city || ''].filter(Boolean).join(', '),
    };
    const infoLine = [co.address, co.phone, co.email].filter(Boolean).join(' · ');
    const by = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || '';

    const win = window.open('', '_blank', 'width=1200,height=900');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }

    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmt = (v) => esc(`KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const byProp = Array.isArray(report.byProperty) ? report.byProperty : [];
    const utTypes = allUtilityTypes;
    const hasUt = utTypes.length > 0;

    const totCollected = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const totAllocated = rows.reduce((s, r) => s + Number(r.allocatedAmount || 0), 0);
    const totRent = rows.reduce((s, r) => s + Number(r.rentApplied || 0), 0);
    const totUnapplied = rows.reduce((s, r) => s + Number(r.unappliedAmount || 0), 0);
    const totPenalty = rows.reduce((s, r) => s + Number(r.penaltyApplied || 0), 0);
    const totUtility = rows.reduce((s, r) => s + Number(r.utilityApplied || 0), 0);
    const utTotals = hasUt
      ? utTypes.reduce((m, ut) => { m[ut] = rows.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
      : {};
    const propByUtTotals = hasUt
      ? utTypes.reduce((m, ut) => { m[ut] = byProp.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
      : {};

    const utHeader = hasUt ? utTypes.map((ut) => `<th class="r">${esc(ut)}</th>`).join('') : `<th class="r">Utilities</th>`;

    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Rental Collection — ${esc(co.name)}</title><style>
      @page{size:A4 landscape;margin:8mm 10mm}
      *{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}
      body{font-family:'Arial Narrow',Arial,sans-serif;color:#0f172a;font-size:7.5px;margin:0;line-height:1.3}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:5px;margin-bottom:6px}
      .hdr-left .logo{max-height:32px;max-width:90px;object-fit:contain;display:block;margin-bottom:2px}
      .hdr-left .co{font-size:9.5px;font-weight:900;color:${GRN};letter-spacing:.04em;text-transform:uppercase}
      .hdr-left .ttl{font-size:14px;font-weight:900;color:#0f172a;margin:1px 0}
      .hdr-left .sub{font-size:7px;color:#64748b}
      .hdr-right{text-align:right;font-size:7px;color:#64748b;line-height:1.7}
      .divider{height:2px;background:${GRN};margin-bottom:6px}
      .cards{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:7px}
      .card{border:1px solid #dbe2ea;background:#f8fafc;padding:4px 6px}
      .card.grn{border-color:#d1fae5;background:#f0fdf4}.card.amb{border-color:#fef3c7;background:#fffbeb}
      .cl{font-size:6px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:10px;font-weight:900;color:#0f172a;margin-top:1px;white-space:nowrap}
      .cv.grn{color:#047857}.cv.amb{color:#b45309}
      .sec{font-size:7.5px;text-transform:uppercase;letter-spacing:.12em;color:${GRN};font-weight:900;margin:7px 0 3px;border-bottom:1px solid #dbe2ea;padding-bottom:2px}
      table{width:100%;border-collapse:collapse;font-size:7px;margin-bottom:7px}
      thead th{background:${GRN};color:#fff;padding:2.5px 4px;font-size:6.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;white-space:nowrap;text-align:left}
      thead th.r{text-align:right}
      tbody td{border-bottom:1px solid #e2e8f0;padding:2px 4px;vertical-align:middle}
      tbody td.r{text-align:right}
      tbody td.nm{font-weight:700}
      tbody tr:nth-child(even){background:#f8fafc}
      .prop-row td{background:#f0fdf4;border-top:1.5px solid rgba(11,59,46,.2);border-bottom:1px solid rgba(11,59,46,.12)}
      .prop-row td{font-weight:800;font-size:7px;color:${GRN}}
      tfoot td{border-top:2px solid ${GRN};padding:2.5px 4px;font-weight:900;background:#edf5f1;font-size:7px;color:#0f172a}
      tfoot td.r{text-align:right}
      .pb{page-break-before:always}
    </style></head><body>
    <div class="hdr">
      <div class="hdr-left">
        ${co.logo ? `<img src="${esc(co.logo)}" class="logo" alt="">` : ''}
        <div class="co">${esc(co.name)}</div>
        <div class="ttl">Rental Collection Report</div>
        <div class="sub">${infoLine ? `${esc(infoLine)} &nbsp;·&nbsp; ` : ''}${esc(fmtDate(filters.startDate))} to ${esc(fmtDate(filters.endDate))}</div>
      </div>
      <div class="hdr-right">
        <div><strong>Period:</strong> ${esc(fmtDate(filters.startDate))} to ${esc(fmtDate(filters.endDate))}</div>
        <div><strong>Generated:</strong> ${esc(new Date().toLocaleString())}</div>
        <div><strong>Prepared by:</strong> ${esc(by)}</div>
        <div><strong>Receipts:</strong> ${rows.length}</div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="cards">
      <div class="card grn"><div class="cl">Op. Income</div><div class="cv grn">${fmt(summary.operationalCollected ?? summary.totalCollected)}</div></div>
      <div class="card"><div class="cl">Total Collected</div><div class="cv">${fmt(summary.totalCollected)}</div></div>
      <div class="card"><div class="cl">Allocated</div><div class="cv">${fmt(summary.allocatedAmount)}</div></div>
      <div class="card amb"><div class="cl">Unapplied</div><div class="cv amb">${fmt(summary.unappliedAmount)}</div></div>
      <div class="card"><div class="cl">Receipts</div><div class="cv">${Number(summary.totalPayments || rows.length)}</div></div>
      <div class="card"><div class="cl">Collection Rate</div><div class="cv">${esc(formatPercent(summary.collectionRate))}</div></div>
    </div>
    <div class="sec">Collection Summary by Property</div>
    <table><thead><tr>
      <th>${termProperty}</th><th class="r">Receipts</th><th class="r">${termTenants}</th><th class="r">Collected</th><th class="r">Rent</th>${utHeader}<th class="r">Penalty</th><th class="r">Unapplied</th>
    </tr></thead>
    <tbody>${byProp.map((row) => `<tr>
      <td class="nm">${esc(row.propertyName)}</td>
      <td class="r">${row.paymentCount}</td>
      <td class="r">${row.tenantCount}</td>
      <td class="r" style="color:#047857;font-weight:700">${fmt(row.totalCollected)}</td>
      <td class="r">${fmt(row.rentApplied)}</td>
      ${hasUt ? utTypes.map((ut) => `<td class="r">${fmt(row.utilityBreakdown?.[ut] || 0)}</td>`).join('') : `<td class="r">${fmt(row.utilityApplied)}</td>`}
      <td class="r">${fmt(row.penaltyApplied)}</td>
      <td class="r" style="color:${Number(row.unappliedAmount || 0) > 0 ? '#b45309' : 'inherit'}">${fmt(row.unappliedAmount)}</td>
    </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td><strong>TOTAL</strong></td>
      <td class="r"><strong>${byProp.reduce((s, r) => s + Number(r.paymentCount || 0), 0)}</strong></td>
      <td></td>
      <td class="r" style="color:#047857"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.totalCollected || 0), 0))}</strong></td>
      <td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.rentApplied || 0), 0))}</strong></td>
      ${hasUt ? utTypes.map((ut) => `<td class="r"><strong>${fmt(propByUtTotals[ut] || 0)}</strong></td>`).join('') : `<td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.utilityApplied || 0), 0))}</strong></td>`}
      <td class="r"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.penaltyApplied || 0), 0))}</strong></td>
      <td class="r" style="color:#b45309"><strong>${fmt(byProp.reduce((s, r) => s + Number(r.unappliedAmount || 0), 0))}</strong></td>
    </tr></tfoot></table>
    <div class="sec pb">Receipts by Property</div>
    <table><thead><tr>
      <th>Date</th><th>Receipt #</th><th>${termTenant}</th><th>${termUnit}</th><th>Method</th>
      <th class="r">Collected</th><th class="r">Allocated</th><th class="r">Rent</th>
      ${utHeader}<th class="r">Penalty</th><th class="r">Unapplied</th><th>Cashbook</th>
    </tr></thead>
    <tbody>${(() => {
      const pGroups = new Map();
      rows.forEach((r) => {
        const key = String(r.propertyId || r.propertyName || 'Unknown');
        if (!pGroups.has(key)) pGroups.set(key, { name: r.propertyName || 'Unknown', rows: [] });
        pGroups.get(key).rows.push(r);
      });
      let html = '';
      for (const [, g] of pGroups) {
        const gC = g.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
        const gA = g.rows.reduce((s, r) => s + Number(r.allocatedAmount || 0), 0);
        const gR = g.rows.reduce((s, r) => s + Number(r.rentApplied || 0), 0);
        const gP = g.rows.reduce((s, r) => s + Number(r.penaltyApplied || 0), 0);
        const gU = g.rows.reduce((s, r) => s + Number(r.unappliedAmount || 0), 0);
        const gUt = g.rows.reduce((s, r) => s + Number(r.utilityApplied || 0), 0);
        const gUtMap = hasUt ? utTypes.reduce((m, ut) => { m[ut] = g.rows.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {}) : {};
        const utSubtotals = hasUt ? utTypes.map((ut) => `<td class="r" style="font-weight:700">${fmt(gUtMap[ut] || 0)}</td>`).join('') : `<td class="r" style="font-weight:700">${fmt(gUt)}</td>`;
        html += `<tr style="background:#f0fdf4;border-top:1.5px solid rgba(11,59,46,.2);border-bottom:1px solid rgba(11,59,46,.12)">
          <td colspan="5" style="padding:2.5px 4px;font-weight:900;font-size:7.5px;color:#0B3B2E;text-transform:uppercase;letter-spacing:.04em">${esc(g.name)} <span style="font-weight:500;font-size:6.5px;color:#64748b;text-transform:none">${g.rows.length} receipt${g.rows.length !== 1 ? 's' : ''}</span></td>
          <td class="r" style="color:#047857;font-weight:800">${fmt(gC)}</td>
          <td class="r" style="font-weight:700">${fmt(gA)}</td>
          <td class="r" style="font-weight:700">${fmt(gR)}</td>
          ${utSubtotals}
          <td class="r" style="font-weight:700">${fmt(gP)}</td>
          <td class="r" style="color:${gU > 0 ? '#b45309' : 'inherit'};font-weight:700">${fmt(gU)}</td>
          <td></td>
        </tr>`;
        g.rows.forEach((row, idx) => {
          const utCells = hasUt
            ? utTypes.map((ut) => `<td class="r">${fmt(row.utilityBreakdown?.[ut] || 0)}</td>`).join('')
            : `<td class="r">${fmt(row.utilityApplied)}</td>`;
          html += `<tr style="${idx % 2 === 1 ? 'background:#f8fafc' : ''}">
            <td style="white-space:nowrap">${row.paymentDate ? esc(new Date(row.paymentDate).toLocaleDateString()) : '—'}</td>
            <td>${esc(row.receiptNumber || '—')}</td>
            <td class="nm">${esc(row.tenantName || '—')}</td>
            <td>${esc(row.unitNumber || '—')}</td>
            <td style="text-transform:capitalize">${esc(formatMethod(row.paymentMethod))}</td>
            <td class="r" style="color:#047857;font-weight:700">${fmt(row.amount)}</td>
            <td class="r">${fmt(row.allocatedAmount)}</td>
            <td class="r">${fmt(row.rentApplied)}</td>
            ${utCells}
            <td class="r">${fmt(row.penaltyApplied)}</td>
            <td class="r" style="color:${Number(row.unappliedAmount || 0) > 0 ? '#b45309' : 'inherit'}">${fmt(row.unappliedAmount)}</td>
            <td>${esc(row.cashbook || '—')}</td>
          </tr>`;
        });
      }
      return html;
    })()}</tbody>
    <tfoot><tr>
      <td colspan="5"><strong>GRAND TOTAL — ${rows.length} receipts</strong></td>
      <td class="r" style="color:#047857"><strong>${fmt(totCollected)}</strong></td>
      <td class="r"><strong>${fmt(totAllocated)}</strong></td>
      <td class="r"><strong>${fmt(totRent)}</strong></td>
      ${hasUt ? utTypes.map((ut) => `<td class="r"><strong>${fmt(utTotals[ut] || 0)}</strong></td>`).join('') : `<td class="r"><strong>${fmt(totUtility)}</strong></td>`}
      <td class="r"><strong>${fmt(totPenalty)}</strong></td>
      <td class="r" style="color:#b45309"><strong>${fmt(totUnapplied)}</strong></td>
      <td></td>
    </tr></tfoot></table>
    </body></html>`);
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
            <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-1.5 shadow-sm backdrop-blur">
              <div className="grid gap-1.5 md:grid-cols-4 xl:grid-cols-8">
                <AppSelect value={selMonth} onChange={(v) => applyMonthYear(v, selYear)} options={MONTHS} placeholder="Month" clearable size="sm" />
                <select value={selYear} onChange={(e) => applyMonthYear(selMonth, e.target.value)} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:border-[#0B3B2E] focus:outline-none">
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <div className="flex items-center gap-1">
                  <input type="date" value={filters.startDate} onChange={setFilter("startDate")} className="h-7 flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                  <span className="flex-shrink-0 text-[10px] font-semibold text-slate-400">–</span>
                  <input type="date" value={filters.endDate} onChange={setFilter("endDate")} className="h-7 flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
                </div>
                <AppSelect value={filters.zone || null} onChange={(v) => setFilters((p) => ({ ...p, zone: v ?? "", propertyId: "" }))} options={zoneOptions} placeholder="Zone" searchable clearable size="sm" />
                <AppSelect value={filters.propertyId || null} onChange={(v) => setFilters((p) => ({ ...p, propertyId: v ?? "", zone: "" }))} options={propertyOptions} placeholder={termProperty} searchable clearable size="sm" />
                <AppSelect value={filters.tenantId || null} onChange={(v) => setFilters((p) => ({ ...p, tenantId: v ?? "", unitId: "" }))} options={tenantOptions} placeholder={termTenant} searchable clearable size="sm" />
                <AppSelect value={filters.paymentMethod || null} onChange={(v) => setFilters((p) => ({ ...p, paymentMethod: v ?? "" }))} options={PAYMENT_METHOD_OPTIONS} placeholder="Method" clearable size="sm" />
                <input value={filters.cashbook} onChange={setFilter("cashbook")} placeholder="Cashbook..." className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px] transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
              </div>
              {(!isLandlordMode || units.length > 0) && (
                <div className="mt-1.5 grid gap-1.5 md:grid-cols-3 xl:grid-cols-6">
                  <AppSelect value={filters.unitId || null} onChange={(v) => setFilters((p) => ({ ...p, unitId: v ?? "" }))} options={unitOptions} placeholder={termUnit} searchable clearable size="sm" />
                  {!isLandlordMode && (
                    <AppSelect value={filters.landlordId || null} onChange={(v) => setFilters((p) => ({ ...p, landlordId: v ?? "" }))} options={landlordOptions} placeholder={termLandlord} searchable clearable size="sm" />
                  )}
                </div>
              )}
            </div>

            {/* ── Stats + Actions bar ── */}
            <div className="flex-shrink-0 flex items-stretch border-b border-slate-200 bg-white">
              <div className="flex-1 overflow-x-auto">
                <div className="flex h-full min-w-max divide-x divide-slate-100">
                  {[
                    { label: 'Op. Income',      value: formatMoney(summary.operationalCollected ?? summary.totalCollected), accent: 'text-emerald-700' },
                    { label: 'Total Collected', value: formatMoney(summary.totalCollected),  accent: 'text-slate-800' },
                    { label: 'Allocated',        value: formatMoney(summary.allocatedAmount), accent: 'text-slate-800' },
                    { label: 'Unapplied',        value: formatMoney(summary.unappliedAmount), accent: 'text-amber-600' },
                    { label: 'Receipts',         value: String(Number(summary.totalPayments || report.rows?.length || 0)), accent: 'text-slate-800' },
                    { label: 'Collection Rate',  value: formatPercent(summary.collectionRate), accent: 'text-slate-800' },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col justify-center px-3 py-1.5">
                      <p className="whitespace-nowrap text-[8.5px] font-bold uppercase tracking-widest text-slate-400">{item.label}</p>
                      <p className={`whitespace-nowrap text-[11px] font-black leading-tight ${item.accent}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5 border-l border-slate-200 px-2">
                <button onClick={handleExportCSV} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaFileDownload /> Export</button>
                <button onClick={handlePrint} disabled={!canExportReports} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white disabled:opacity-40"><FaPrint /> Print</button>
                <ResetFiltersButton onReset={resetFilters} disabled={loading} />
                <button onClick={() => loadReport()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white p-1.5">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200">
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="min-w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                      <tr>
                        {['Date', 'Receipt #', termTenant, termUnit, 'Method', 'Collected', 'Allocated', 'Rent',
                          ...(hasUtilityBreakdown ? allUtilityTypes : ['Utilities']),
                          'Penalty', 'Unapplied', 'Cashbook'
                        ].map((h, i, arr) => (
                          <th key={h} className={`whitespace-nowrap px-2 py-1.5 text-left font-bold text-[9px] tracking-wide ${i >= 5 && i <= arr.length - 2 ? 'text-right' : ''} ${i < arr.length - 1 ? 'border-r border-white/10' : ''}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailGroups.length === 0 ? (
                        <tr><td colSpan={10 + (hasUtilityBreakdown ? allUtilityTypes.length : 1)} className="px-3 py-6 text-center text-slate-400 text-[11px]">
                          {loading ? 'Loading...' : 'No receipts found for the selected filters.'}
                        </td></tr>
                      ) : detailGroups.map((group) => {
                        const gC = group.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
                        const gA = group.rows.reduce((s, r) => s + Number(r.allocatedAmount || 0), 0);
                        const gR = group.rows.reduce((s, r) => s + Number(r.rentApplied || 0), 0);
                        const gP = group.rows.reduce((s, r) => s + Number(r.penaltyApplied || 0), 0);
                        const gU = group.rows.reduce((s, r) => s + Number(r.unappliedAmount || 0), 0);
                        const gUt = group.rows.reduce((s, r) => s + Number(r.utilityApplied || 0), 0);
                        const gUtMap = hasUtilityBreakdown
                          ? allUtilityTypes.reduce((m, ut) => { m[ut] = group.rows.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
                          : {};
                        return (
                          <React.Fragment key={group.propertyId}>
                            {/* Property header row */}
                            <tr className="bg-[#0B3B2E]/8 border-y border-[#0B3B2E]/20">
                              <td colSpan={5} className="px-2 py-1.5 border-r border-[#0B3B2E]/20">
                                <div className="flex items-center gap-2">
                                  <span className="font-black text-[10px] text-[#0B3B2E] uppercase tracking-wide">{group.propertyName}</span>
                                  <span className="text-[8px] text-slate-500 font-semibold">{group.rows.length} receipt{group.rows.length !== 1 ? 's' : ''}</span>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-emerald-700">{formatMoney(gC)}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-slate-600">{formatMoney(gA)}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-slate-600">{formatMoney(gR)}</td>
                              {hasUtilityBreakdown
                                ? allUtilityTypes.map((ut) => <td key={ut} className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-slate-600">{gUtMap[ut] > 0 ? formatMoney(gUtMap[ut]) : <span className="text-slate-300">—</span>}</td>)
                                : <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-slate-600">{gUt > 0 ? formatMoney(gUt) : <span className="text-slate-300">—</span>}</td>
                              }
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-slate-600">{gP > 0 ? formatMoney(gP) : <span className="text-slate-300">—</span>}</td>
                              <td className="px-2 py-1.5 border-r border-[#0B3B2E]/20 text-right text-[9px] font-bold text-amber-700">{gU > 0 ? formatMoney(gU) : <span className="text-slate-300">—</span>}</td>
                              <td className="px-2 py-1.5"></td>
                            </tr>
                            {/* Detail rows */}
                            {group.rows.map((row, idx) => (
                              <tr key={row.receiptId || `${group.propertyId}-${idx}`} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/50 hover:bg-emerald-50/30'}`}>
                                <td className="px-2 py-1 border-r border-gray-100 text-slate-700 whitespace-nowrap">{fmtDate(row.paymentDate)}</td>
                                <td className="px-2 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.receiptNumber || '—'}</td>
                                <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.tenantName}</td>
                                <td className="px-2 py-1 border-r border-gray-100 text-slate-700">{row.unitNumber}</td>
                                <td className="px-2 py-1 border-r border-gray-100 capitalize text-slate-700">{formatMethod(row.paymentMethod)}</td>
                                <td className="px-2 py-1 border-r border-gray-100 text-right font-semibold text-emerald-700">{formatMoney(row.amount)}</td>
                                <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.allocatedAmount)}</td>
                                <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.rentApplied)}</td>
                                {hasUtilityBreakdown
                                  ? allUtilityTypes.map((ut) => <td key={ut} className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.utilityBreakdown?.[ut] || 0)}</td>)
                                  : <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.utilityApplied)}</td>
                                }
                                <td className="px-2 py-1 border-r border-gray-100 text-right text-slate-700">{formatMoney(row.penaltyApplied)}</td>
                                <td className="px-2 py-1 border-r border-gray-100 text-right font-semibold text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                                <td className="px-2 py-1 text-slate-700">{row.cashbook || '—'}</td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                      {/* Grand total */}
                      {(report.rows || []).length > 0 && (() => {
                        const allRows = report.rows || [];
                        const utMap = hasUtilityBreakdown
                          ? allUtilityTypes.reduce((m, ut) => { m[ut] = allRows.reduce((s, r) => s + Number(r.utilityBreakdown?.[ut] || 0), 0); return m; }, {})
                          : {};
                        return (
                          <tr className="sticky bottom-0 bg-[#0B3B2E] text-white">
                            <td colSpan={5} className="px-2 py-1.5 font-black text-[9px] uppercase tracking-wide">
                              Grand Total · {allRows.length} receipts · {detailGroups.length} {detailGroups.length === 1 ? 'property' : 'properties'}
                            </td>
                            <td className="px-2 py-1.5 text-right font-black text-[9px] text-emerald-300">{formatMoney(allRows.reduce((s, r) => s + Number(r.amount || 0), 0))}</td>
                            <td className="px-2 py-1.5 text-right font-black text-[9px]">{formatMoney(allRows.reduce((s, r) => s + Number(r.allocatedAmount || 0), 0))}</td>
                            <td className="px-2 py-1.5 text-right font-black text-[9px]">{formatMoney(allRows.reduce((s, r) => s + Number(r.rentApplied || 0), 0))}</td>
                            {hasUtilityBreakdown
                              ? allUtilityTypes.map((ut) => <td key={ut} className="px-2 py-1.5 text-right font-black text-[9px]">{formatMoney(utMap[ut] || 0)}</td>)
                              : <td className="px-2 py-1.5 text-right font-black text-[9px]">{formatMoney(allRows.reduce((s, r) => s + Number(r.utilityApplied || 0), 0))}</td>
                            }
                            <td className="px-2 py-1.5 text-right font-black text-[9px]">{formatMoney(allRows.reduce((s, r) => s + Number(r.penaltyApplied || 0), 0))}</td>
                            <td className="px-2 py-1.5 text-right font-black text-[9px] text-amber-300">{formatMoney(allRows.reduce((s, r) => s + Number(r.unappliedAmount || 0), 0))}</td>
                            <td className="px-2 py-1.5"></td>
                          </tr>
                        );
                      })()}
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

export default RentalCollectionReport;
