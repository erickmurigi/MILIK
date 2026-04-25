import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FaFileDownload, FaFilter, FaPrint, FaReceipt } from 'react-icons/fa';
import toast from 'react-hot-toast';
import { hasCompanyPermission } from '../../utils/permissions';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getProperties } from '../../redux/propertyRedux';
import { adminRequests } from '../../utils/requestMethods';

const GREEN_BG = 'bg-[#0B3B2E]';
const ORANGE = '#F97316';
const DEFAULT_RATE = 16;
const ITEMS_PER_PAGE = 50;

const formatMoney = (value) =>
  `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;

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
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const canExportReports = hasCompanyPermission(currentUser || {}, currentCompany, "financialReports", "export", "accounts");
  const propertyState = useSelector((state) => state.property || {});
  const properties = Array.isArray(propertyState?.properties?.data)
    ? propertyState.properties.data
    : Array.isArray(propertyState?.properties)
    ? propertyState.properties
    : [];

  const [filters, setFilters] = useState({
    startDate: toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: toDateInput(new Date()),
    propertyId: '',
  });
  const [loading, setLoading] = useState(false);
  const [companyTaxConfig, setCompanyTaxConfig] = useState({ taxSettings: { defaultVatRate: DEFAULT_RATE } });
  const [invoices, setInvoices] = useState([]);
  const [processedStatements, setProcessedStatements] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!currentCompany?._id) return;
    dispatch(getProperties({ business: currentCompany._id }));
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    let cancelled = false;

    const loadTaxData = async () => {
      if (!currentCompany?._id) return;
      setLoading(true);
      try {
        const [settingsRes, invoiceRes, statementRes] = await Promise.all([
          adminRequests.get(`/company-settings/${currentCompany._id}`),
          adminRequests.get(`/tenant-invoices?business=${currentCompany._id}`),
          adminRequests.get(`/processed-statements/business/${currentCompany._id}`),
        ]);

        if (cancelled) return;

        setCompanyTaxConfig(settingsRes?.data || { taxSettings: { defaultVatRate: DEFAULT_RATE } });
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
  }, [currentCompany?._id]);

  const rows = useMemo(() => {
    const invoiceRows = invoices
      .filter((invoice) => {
        if (filters.propertyId && String(invoice?.property?._id || invoice?.property) !== String(filters.propertyId)) return false;
        if (!withinRange(invoice?.invoiceDate || invoice?.createdAt, filters.startDate, filters.endDate)) return false;
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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE)), [rows.length]);
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
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

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 p-2">
        <div className="flex w-full max-w-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="sticky top-0 z-30 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur print:hidden">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Start Date</label>
                <input type="date" value={filters.startDate} onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))} className="w-full rounded-md border border-orange-300 bg-orange-50 px-2 py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">End Date</label>
                <input type="date" value={filters.endDate} onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))} className="w-full rounded-md border border-orange-300 bg-orange-50 px-2 py-1.5 text-xs" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Property</label>
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="w-full rounded-md border border-orange-300 bg-orange-50 px-2 py-1.5 text-xs">
                  <option value="">All Properties</option>
                  {properties.map((property) => (
                    <option key={property._id} value={property._id}>{property.propertyName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button onClick={handleExportCSV} disabled={!canExportReports} title={canExportReports ? "Export CSV" : "You do not have permission to export reports"} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00] disabled:opacity-50"><FaFileDownload /> Export CSV</button>
              <button onClick={() => { if (!canExportReports) { toast.error("You do not have permission to print reports"); return; } window.print(); }} disabled={!canExportReports} title={canExportReports ? "Print" : "You do not have permission to print reports"} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-bold text-white disabled:opacity-50 ${GREEN_BG} hover:bg-[#0A3127]`}><FaPrint /> Print</button>
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
              <table className="w-full min-w-[1000px] text-xs">
                <thead className="sticky top-0 z-20 bg-[#0B3B2E] text-white">
                  <tr>
                    <th className="px-4 py-2 text-left font-bold text-white">Date</th>
                    <th className="px-4 py-2 text-left font-bold text-white">Source</th>
                    <th className="px-4 py-2 text-left font-bold text-white">Reference</th>
                    <th className="px-4 py-2 text-left font-bold text-slate-700">Property</th>
                    <th className="px-4 py-2 text-left font-bold text-white">Party</th>
                    <th className="px-4 py-2 text-left font-bold text-white">Tax Code</th>
                    <th className="px-4 py-2 text-right font-bold text-white">Rate</th>
                    <th className="px-4 py-2 text-right font-bold text-white">Net</th>
                    <th className="px-4 py-2 text-right font-bold text-white">Tax</th>
                    <th className="px-4 py-2 text-right font-bold text-white">Gross</th>
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
                    paginatedRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-2">{new Date(row.date).toLocaleDateString()}</td>
                        <td className="px-4 py-2">{row.source}</td>
                        <td className="px-4 py-2 font-semibold text-slate-900">{row.reference}</td>
                        <td className="px-4 py-2">{row.propertyName}</td>
                        <td className="px-4 py-2">{row.partyName}</td>
                        <td className="px-4 py-2 uppercase">{row.taxCode}</td>
                        <td className="px-4 py-2 text-right">{row.taxRate.toFixed(2)}%</td>
                        <td className="px-4 py-2 text-right font-semibold">{formatMoney(row.netAmount)}</td>
                        <td className="px-4 py-2 text-right font-semibold text-orange-700">{formatMoney(row.taxAmount)}</td>
                        <td className="px-4 py-2 text-right font-bold text-slate-900">{formatMoney(row.grossAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="sticky bottom-0 z-20 flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold">Showing <span className="font-bold text-slate-900">{rows.length ? startIndex + 1 : 0}</span> to <span className="font-bold text-slate-900">{Math.min(endIndex, rows.length)}</span> of <span className="font-bold text-slate-900">{rows.length}</span> tax row(s)</div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Per page: {ITEMS_PER_PAGE}</span>
                <button type="button" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                <span className="font-semibold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
                <button type="button" onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">Next</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TaxReports;
