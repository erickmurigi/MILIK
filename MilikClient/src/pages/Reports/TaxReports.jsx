import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTabState } from '../../hooks/useTabState';
import { useDispatch, useSelector } from 'react-redux';
import { selectCurrentCompany, selectCurrentUser, selectAllProperties } from '../../redux/selectors';
import { FaFileDownload, FaFilter, FaPrint, FaReceipt } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { hasCompanyPermission } from '../../utils/permissions';
import AppSelect from '../../components/common/AppSelect';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getProperties } from '../../redux/propertyRedux';
import { fetchCompanySettings, selectCompanySettings } from '../../redux/companySettingsRedux';
import { adminRequests } from '../../utils/requestMethods';
import { formatMoney } from '../../utils/money';
import PaginationBar from '../../components/PaginationBar';

const GREEN_BG = 'bg-[#0B3B2E]';
const ORANGE = '#F97316';
const DEFAULT_RATE = 16;

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const toDateInput = (value) => {
  const date = parseDate(value) || new Date();
  return date.toISOString().split('T')[0];
};

const withinRange = (value, startDate, endDate) => {
  const date = parseDate(value);
  if (!date) return false;
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start && date < start) return false;
  if (end) {
    const cappedEnd = new Date(end);
    cappedEnd.setHours(23, 59, 59, 999);
    if (date > cappedEnd) return false;
  }
  return true;
};

const TaxReports = () => {
  const dispatch = useDispatch();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const properties = useSelector(selectAllProperties);

  const [filters, setFilters] = useTabState("/accounts/tax-reports:filters", () => ({
    startDate: toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: toDateInput(new Date()),
    propertyId: '',
  }));
  const setFilter = (key) => (e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const storedSettings = useSelector(selectCompanySettings);
  const companyTaxConfig = storedSettings || { taxSettings: { defaultVatRate: DEFAULT_RATE } };
  const [loading, setLoading] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [processedStatements, setProcessedStatements] = useState([]);
  const [currentPage, setCurrentPage] = useTabState("/accounts/tax-reports:currentPage", 1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
    dispatch(fetchCompanySettings(currentCompany._id));
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    let cancelled = false;

    const loadTaxData = async () => {
      if (!currentCompany?._id) return;
      setLoading(true);
      try {
        const invoiceUrl = `/tenant-invoices?business=${currentCompany._id}${filters.startDate ? `&fromDate=${filters.startDate}` : ""}${filters.endDate ? `&toDate=${filters.endDate}` : ""}`;
        const statementParams = new URLSearchParams();
        if (filters.startDate) statementParams.set("startDate", filters.startDate);
        if (filters.endDate) statementParams.set("endDate", filters.endDate);
        const statementQuery = statementParams.toString() ? `?${statementParams}` : "";
        const [invoiceRes, statementRes] = await Promise.all([
          adminRequests.get(invoiceUrl),
          adminRequests.get(`/processed-statements/business/${currentCompany._id}${statementQuery}`),
        ]);

        if (cancelled) return;

        setInvoices(Array.isArray(invoiceRes?.data) ? invoiceRes.data : []);

        const statements = Array.isArray(statementRes?.data?.statements)
          ? statementRes.data.statements
          : Array.isArray(statementRes?.data)
          ? statementRes.data
          : [];
        setProcessedStatements(statements);
      } catch (error) {
        if (!cancelled) {
          toast.error('Failed to load tax report data');
          setInvoices([]);
          setProcessedStatements([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadTaxData();
    return () => {
      cancelled = true;
    };
  }, [currentCompany?._id, filters.startDate, filters.endDate]);

  const rows = useMemo(() => {
    const invoiceRows = invoices
      .filter((invoice) => {
        if (filters.propertyId && String(invoice?.property?._id || invoice?.property) !== String(filters.propertyId)) return false;
        if (['cancelled', 'reversed'].includes(String(invoice?.status || '').toLowerCase())) return false;
        return Number(invoice?.taxSnapshot?.taxAmount || 0) > 0;
      })
      .map((invoice) => ({
        id: `invoice-${invoice._id}`,
        source: 'Tenant Invoice',
        date: invoice?.invoiceDate || invoice?.createdAt,
        reference: invoice?.invoiceNumber || invoice?._id,
        propertyName: invoice?.property?.propertyName || invoice?.propertyName || '-',
        partyName:
          invoice?.tenant?.name ||
          invoice?.tenant?.tenantName ||
          [invoice?.tenant?.firstName, invoice?.tenant?.lastName].filter(Boolean).join(' ') ||
          '-',
        taxCode: invoice?.taxSnapshot?.taxCodeKey || 'vat_standard',
        taxRate: Number(invoice?.taxSnapshot?.taxRate || 0),
        netAmount: Number(invoice?.taxSnapshot?.netAmount || invoice?.amount || 0),
        taxAmount: Number(invoice?.taxSnapshot?.taxAmount || 0),
        grossAmount: Number(invoice?.taxSnapshot?.grossAmount || invoice?.amount || 0),
      }));

    const statementRows = processedStatements
      .filter((statement) => {
        if (filters.propertyId && String(statement?.property?._id || statement?.property) !== String(filters.propertyId)) return false;
        if (!withinRange(statement?.closedAt || statement?.cutoffAt || statement?.createdAt, filters.startDate, filters.endDate)) return false;
        if (String(statement?.status || '').toLowerCase() === 'reversed') return false;
        return Number(statement?.commissionTaxAmount || 0) > 0;
      })
      .map((statement) => ({
        id: `statement-${statement._id}`,
        source: 'Processed Statement Commission',
        date: statement?.closedAt || statement?.cutoffAt || statement?.createdAt,
        reference: statement?.sourceStatementNumber || statement?._id,
        propertyName: statement?.property?.propertyName || statement?.propertyName || '-',
        partyName:
          statement?.landlord?.landlordName ||
          [statement?.landlord?.firstName, statement?.landlord?.lastName].filter(Boolean).join(' ') ||
          '-',
        taxCode: statement?.commissionTaxCodeKey || 'vat_standard',
        taxRate: Number(statement?.commissionTaxRate || 0),
        netAmount: Number(statement?.commissionAmount || 0),
        taxAmount: Number(statement?.commissionTaxAmount || 0),
        grossAmount: Number(statement?.commissionGrossAmount || (Number(statement?.commissionAmount || 0) + Number(statement?.commissionTaxAmount || 0))),
      }));

    return [...invoiceRows, ...statementRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [filters.endDate, filters.propertyId, filters.startDate, invoices, processedStatements]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          netAmount: acc.netAmount + Number(row.netAmount || 0),
          taxAmount: acc.taxAmount + Number(row.taxAmount || 0),
          grossAmount: acc.grossAmount + Number(row.grossAmount || 0),
        }),
        { netAmount: 0, taxAmount: 0, grossAmount: 0 }
      ),
    [rows]
  );

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rows.length / pageSize)), [rows.length, pageSize]);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedRows = useMemo(() => rows.slice(startIndex, endIndex), [rows, startIndex, endIndex]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.startDate, filters.endDate, filters.propertyId]);

  useEffect(() => {
    if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const handleExportCSV = () => {
    if (!canExportReports) {
      toast.error("You do not have permission to export reports");
      return;
    }
    const csv = [
      ['Date', 'Source', 'Reference', 'Property', 'Party', 'Tax Code', 'Tax Rate', 'Net Amount', 'Tax Amount', 'Gross Amount'].join(','),
      ...rows.map((row) => [
        new Date(row.date).toLocaleDateString(),
        row.source,
        row.reference,
        row.propertyName,
        row.partyName,
        row.taxCode,
        row.taxRate,
        row.netAmount,
        row.taxAmount,
        row.grossAmount,
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `milik_tax_report_${filters.startDate}_to_${filters.endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const companyName = currentCompany?.name || currentCompany?.companyName || currentCompany?.businessName || "Milik";
  const preparedBy = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(" ") || currentUser?.email || "Milik Admin";

  const handlePrint = useCallback(() => {
    if (!canExportReports) { toast.error("You do not have permission to print reports"); return; }
    const co = currentCompany || {};
    const name = co.companyName || co.name || co.businessName || 'Milik';
    const logo = co.logo || '';
    const win = window.open('', '_blank', 'width=1120,height=800');
    if (!win) { toast.error('Pop-up blocked. Please allow pop-ups to print.'); return; }
    const fmt = (v) => `KES ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    win.document.write(`<!DOCTYPE html><html><head><title>Tax Report</title><style>
      @page{size:A4 landscape;margin:12mm 14mm}body{font-family:Arial,sans-serif;color:#0f172a;font-size:9px;margin:0}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0B3B2E;padding-bottom:8px;margin-bottom:10px}
      .co{font-size:13px;font-weight:900;color:#0B3B2E}.ttl{font-size:16px;font-weight:900;margin:2px 0}
      .sub{font-size:10px;color:#475569;margin-top:2px}.meta{text-align:right;color:#64748b;font-size:8.5px;line-height:1.6}
      .logo{max-height:40px;max-width:110px;object-fit:contain;margin-bottom:4px}
      .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px}
      .card{border:1px solid #dbe2ea;border-radius:6px;background:#f8fafc;padding:6px 8px}
      .cl{font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:800}
      .cv{font-size:13px;font-weight:900;color:#0f172a;margin-top:3px}
      table{width:100%;border-collapse:collapse;font-size:8.5px}
      thead th{background:#0B3B2E;color:#fff;padding:4px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.1em}
      thead th.r{text-align:right}tbody td{border-bottom:1px solid #dbe2ea;padding:3.5px 6px}
      tbody td.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}
      tfoot td{border-top:2px solid #0B3B2E;padding:4px 6px;font-weight:900;background:#EDF5F1}tfoot td.r{text-align:right}
      *{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    </style></head><body>
    <div class="hdr"><div>${logo ? `<img src="${logo}" class="logo" alt="">` : ''}<div class="co">${name}</div><div class="ttl">Tax Report</div><div class="sub">Period: ${filters.startDate} to ${filters.endDate}</div></div>
    <div class="meta"><div>Generated: ${new Date().toLocaleString()}</div><div>Prepared by: ${preparedBy}</div><div>Total records: ${rows.length}</div></div></div>
    <div class="cards">
      <div class="card"><div class="cl">Taxable Net Amount</div><div class="cv">${fmt(totals.netAmount)}</div></div>
      <div class="card"><div class="cl">Output VAT / Tax</div><div class="cv" style="color:#c2410c">${fmt(totals.taxAmount)}</div></div>
      <div class="card"><div class="cl">Gross Value</div><div class="cv" style="color:#047857">${fmt(totals.grossAmount)}</div></div>
    </div>
    <table><thead><tr><th>Date</th><th>Source</th><th>Reference</th><th>Property</th><th>Party</th><th>Tax Code</th><th class="r">Rate</th><th class="r">Net</th><th class="r">Tax</th><th class="r">Gross</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${row.date ? new Date(row.date).toLocaleDateString() : '—'}</td><td>${row.source || ''}</td><td>${row.reference || ''}</td><td>${row.propertyName || ''}</td><td>${row.partyName || ''}</td><td>${row.taxCode || ''}</td><td class="r">${row.taxRate || 0}%</td><td class="r">${fmt(row.netAmount)}</td><td class="r">${fmt(row.taxAmount)}</td><td class="r"><strong>${fmt(row.grossAmount)}</strong></td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="7"><strong>TOTALS (${rows.length} records)</strong></td><td class="r">${fmt(totals.netAmount)}</td><td class="r">${fmt(totals.taxAmount)}</td><td class="r"><strong>${fmt(totals.grossAmount)}</strong></td></tr></tfoot>
    </table></body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
  }, [canExportReports, currentCompany, rows, totals, filters.startDate, filters.endDate, preparedBy]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="print-only-wrapper">
        <style>{`
          @page { size: landscape; margin: 10mm; }
          .tax-print-shell { font-family: Arial, sans-serif; color: #0f172a; }
          .tax-print-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
          .tax-print-brand { color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 900; }
          .tax-print-title { margin: 2px 0 4px; font-size: 18px; font-weight: 900; color: #0f172a; }
          .tax-print-meta { text-align: right; font-size: 9px; color: #475569; line-height: 1.6; }
          .tax-print-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
          .tax-print-metric { border: 1px solid #dbe2ea; border-radius: 6px; background: #f8fafc; padding: 6px 8px; }
          .tax-print-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 800; }
          .tax-print-value { margin-top: 3px; font-size: 13px; font-weight: 900; color: #0f172a; }
          .tax-print-table { width: 100%; border-collapse: collapse; font-size: 8.5px; }
          .tax-print-table th, .tax-print-table td { border: 1px solid #dbe2ea; padding: 4px 5px; vertical-align: top; }
          .tax-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
          .tr { text-align: right; }
        `}</style>
        <div className="tax-print-shell">
          <div className="tax-print-header">
            <div>
              <div className="tax-print-brand">{companyName}</div>
              <h1 className="tax-print-title">Tax Report</h1>
              <p style={{ margin: 0, fontSize: "10px", color: "#475569" }}>VAT and tax summary for the selected period.</p>
            </div>
            <div className="tax-print-meta">
              <div><strong>Period:</strong> {filters.startDate} to {filters.endDate}</div>
              <div><strong>Property:</strong> {filters.propertyId ? (properties.find((p) => String(p._id) === filters.propertyId)?.propertyName || "Selected") : "All properties"}</div>
              <div><strong>Generated:</strong> {new Date().toLocaleString()}</div>
              <div><strong>Prepared by:</strong> {preparedBy}</div>
            </div>
          </div>
          <div className="tax-print-grid">
            {[
              { label: "Net Amount", value: formatMoney(totals.netAmount) },
              { label: "Tax Amount", value: formatMoney(totals.taxAmount) },
              { label: "Gross Amount", value: formatMoney(totals.grossAmount) },
            ].map((c) => (
              <div key={c.label} className="tax-print-metric">
                <div className="tax-print-label">{c.label}</div>
                <div className="tax-print-value">{c.value}</div>
              </div>
            ))}
          </div>
          <table className="tax-print-table">
            <thead>
              <tr>
                {["Date", "Source", "Reference", "Property", "Party", "Tax Code", "Rate %", "Net", "Tax", "Gross"].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", padding: "12px" }}>No taxable entries found for the selected period.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date ? new Date(row.date).toLocaleDateString() : "—"}</td>
                  <td>{row.source}</td>
                  <td>{row.reference}</td>
                  <td>{row.propertyName}</td>
                  <td>{row.partyName}</td>
                  <td>{row.taxCode}</td>
                  <td className="tr">{row.taxRate}%</td>
                  <td className="tr">{formatMoney(row.netAmount)}</td>
                  <td className="tr">{formatMoney(row.taxAmount)}</td>
                  <td className="tr"><strong>{formatMoney(row.grossAmount)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 p-2">
        <div className="flex w-full max-w-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur print:hidden">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Start Date</label>
                <input type="date" value={filters.startDate} onChange={setFilter("startDate")} className="w-full rounded-md border border-orange-300 bg-orange-50 px-2 py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">End Date</label>
                <input type="date" value={filters.endDate} onChange={setFilter("endDate")} className="w-full rounded-md border border-orange-300 bg-orange-50 px-2 py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Property</label>
                <AppSelect
                  value={filters.propertyId}
                  onChange={(v) => setFilters((prev) => ({ ...prev, propertyId: v ?? '' }))}
                  options={properties.map((p) => ({ value: p._id, label: p.propertyName }))}
                  placeholder="All Properties"
                  searchable
                  clearable
                  size="sm"
                />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button onClick={handleExportCSV} disabled={!canExportReports} title={canExportReports ? "Export CSV" : "You do not have permission to export reports"} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00] disabled:opacity-50"><FaFileDownload /> Export CSV</button>
              <button onClick={handlePrint} disabled={!canExportReports} title={canExportReports ? "Print" : "You do not have permission to print reports"} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-bold text-white disabled:opacity-50 ${GREEN_BG} hover:bg-[#0A3127]`}><FaPrint /> Print</button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-white p-2 shadow-sm">
              <div className="text-xs text-slate-600">Taxable Net Amount</div>
              <div className="mt-0.5 text-sm font-bold text-slate-900">{formatMoney(totals.netAmount)}</div>
            </div>
            <div className="rounded-md border border-orange-200 bg-orange-50 p-2 shadow-sm">
              <div className="text-xs text-orange-700">Output VAT / Tax</div>
              <div className="mt-0.5 text-sm font-bold text-orange-700">{formatMoney(totals.taxAmount)}</div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 shadow-sm">
              <div className="text-xs text-emerald-700">Gross Value</div>
              <div className="mt-0.5 text-sm font-bold text-emerald-700">{formatMoney(totals.grossAmount)}</div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <div className={`${GREEN_BG} px-3 py-2 text-white`}>
              <h3 className="text-xs font-bold">Tax Breakdown</h3>
              <p className="mt-1 text-xs text-emerald-50">Default company VAT rate: {Number(companyTaxConfig?.taxSettings?.defaultVatRate || DEFAULT_RATE)}%</p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[1000px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-20 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Date</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Source</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Reference</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Party</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tax Code</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Rate</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Net</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Tax</th>
                    <th className="px-3 py-1 text-right font-bold">Gross</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="10" className="px-4 py-8 text-center text-slate-500">Loading tax data...</td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="px-4 py-8 text-center text-slate-500">No tax rows found for the selected period.</td>
                    </tr>
                  ) : (
                    paginatedRows.map((row, idx) => (
                      <tr key={row.id} className={`border-b border-gray-100 ${idx % 2 === 0 ? "bg-white hover:bg-blue-50/40" : "bg-slate-50/60 hover:bg-blue-50/40"}`}>
                        <td className="px-3 py-1 border-r border-gray-100">{new Date(row.date).toLocaleDateString()}</td>
                        <td className="px-3 py-1 border-r border-gray-100">{row.source}</td>
                        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{row.reference}</td>
                        <td className="px-3 py-1 border-r border-gray-100">{row.propertyName}</td>
                        <td className="px-3 py-1 border-r border-gray-100">{row.partyName}</td>
                        <td className="px-3 py-1 border-r border-gray-100 uppercase">{row.taxCode}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right">{row.taxRate.toFixed(2)}%</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold">{formatMoney(row.netAmount)}</td>
                        <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-orange-700">{formatMoney(row.taxAmount)}</td>
                        <td className="px-3 py-1 text-right font-bold text-slate-900">{formatMoney(row.grossAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={safeCurrentPage}
              pages={totalPages}
              total={rows.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(n) => { setPageSize(n); setCurrentPage(1); }}
              loading={loading}
              label="tax rows"
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TaxReports;
