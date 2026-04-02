import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FaFileDownload, FaFilter, FaPrint, FaReceipt } from 'react-icons/fa';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getProperties } from '../../redux/propertyRedux';
import { adminRequests } from '../../utils/requestMethods';

const GREEN_BG = 'bg-[#0B3B2E]';
const ORANGE = '#F97316';
const DEFAULT_RATE = 16;

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

  const handleExportCSV = () => {
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
    <DashboardLayout>
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-900">
                <FaReceipt style={{ color: ORANGE }} /> Tax Reports
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                VAT / tax summary from posted tenant invoices and processed statement commission snapshots.
              </p>
            </div>
            <div className="flex gap-3 print:hidden">
              <button onClick={handleExportCSV} className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700">
                <FaFileDownload className="inline" /> Export CSV
              </button>
              <button onClick={() => window.print()} className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${GREEN_BG} hover:bg-[#0A3127]`}>
                <FaPrint className="inline" /> Print
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900">
              <FaFilter style={{ color: ORANGE }} /> Filters
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Start Date</label>
                <input type="date" value={filters.startDate} onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">End Date</label>
                <input type="date" value={filters.endDate} onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Property</label>
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm">
                  <option value="">All Properties</option>
                  {properties.map((property) => (
                    <option key={property._id} value={property._id}>{property.propertyName}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-sm text-slate-600">Taxable Net Amount</div>
              <div className="mt-2 text-3xl font-bold text-slate-900">{formatMoney(totals.netAmount)}</div>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-6 shadow-sm">
              <div className="text-sm text-orange-700">Output VAT / Tax</div>
              <div className="mt-2 text-3xl font-bold text-orange-700">{formatMoney(totals.taxAmount)}</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
              <div className="text-sm text-emerald-700">Gross Value</div>
              <div className="mt-2 text-3xl font-bold text-emerald-700">{formatMoney(totals.grossAmount)}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className={`${GREEN_BG} px-6 py-4 text-white`}>
              <h3 className="text-lg font-bold">Tax Breakdown</h3>
              <p className="mt-1 text-xs text-emerald-50">Default company VAT rate: {Number(companyTaxConfig?.taxSettings?.defaultVatRate || DEFAULT_RATE)}%</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-bold text-slate-700">Date</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-700">Source</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-700">Reference</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-700">Property</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-700">Party</th>
                    <th className="px-4 py-3 text-left font-bold text-slate-700">Tax Code</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700">Rate</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700">Net</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700">Tax</th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700">Gross</th>
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
                    rows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-200 hover:bg-slate-50">
                        <td className="px-4 py-3">{new Date(row.date).toLocaleDateString()}</td>
                        <td className="px-4 py-3">{row.source}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.reference}</td>
                        <td className="px-4 py-3">{row.propertyName}</td>
                        <td className="px-4 py-3">{row.partyName}</td>
                        <td className="px-4 py-3 uppercase">{row.taxCode}</td>
                        <td className="px-4 py-3 text-right">{row.taxRate.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right font-semibold">{formatMoney(row.netAmount)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-orange-700">{formatMoney(row.taxAmount)}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{formatMoney(row.grossAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default TaxReports;
