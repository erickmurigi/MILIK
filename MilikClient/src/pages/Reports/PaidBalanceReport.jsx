import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getTenantPaidBalanceReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaBalanceScale, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];

const PaidBalanceReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const properties = useSelector((state) => state.property?.properties || []);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    asOfDate: toDateInputValue(new Date()),
    propertyId: '',
    status: 'all',
    search: '',
  });
  const [report, setReport] = useState({ summary: {}, rows: [] });

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
  }, [businessId, dispatch]);

  const loadReport = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await getTenantPaidBalanceReport({ business: businessId, ...filters });
      setReport({
        summary: data?.summary || {},
        rows: Array.isArray(data?.rows) ? data.rows : [],
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load paid and balance report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [businessId, filters.asOfDate, filters.propertyId, filters.status, filters.search]);

  const summary = report.summary || {};

  const handleExportCSV = () => {
    const header = ['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid Applied', 'Outstanding', 'Unapplied Credit', 'Net Balance', 'Rent Balance', 'Utility Balance', 'Penalty Balance', 'Oldest Due', 'Last Payment', 'Status'];
    const rows = (report.rows || []).map((row) => [
      row.tenantName || '',
      row.propertyName || '',
      row.unitNumber || '',
      row.totalInvoiced || 0,
      row.totalPaidApplied || 0,
      row.outstanding || 0,
      row.unappliedCredit || 0,
      row.netBalance || 0,
      row.rentBalance || 0,
      row.utilityBalance || 0,
      row.penaltyBalance || 0,
      row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '',
      row.lastPaymentDate ? new Date(row.lastPaymentDate).toLocaleDateString() : '',
      row.status || '',
    ]);

    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paid_balance_report_${filters.asOfDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-100 p-4 md:p-6">
        <div className="mx-auto max-w-[96%] print:max-w-full">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-100">Tenant receivables control</p>
                  <h1 className="mt-1 flex items-center gap-3 text-2xl font-black tracking-tight"><FaBalanceScale /> Paid &amp; Balance Report</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">
                    Uses tenant invoices and real receipt allocations to show what has been invoiced, what has been paid, what remains outstanding, and where tenants still have unapplied credit.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 print:hidden">
                  <button onClick={handleExportCSV} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaFileDownload /> Export CSV</button>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaPrint /> Print</button>
                  <button onClick={loadReport} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
                </div>
              </div>
            </div>

            <div className="border-b border-slate-200 bg-slate-50 p-4 print:hidden">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700"><FaFilter className="text-amber-600" /> Filters</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <input type="date" value={filters.asOfDate} onChange={(e) => setFilters((prev) => ({ ...prev, asOfDate: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">All properties</option>
                  {properties.map((property) => <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>)}
                </select>
                <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="all">All tenant positions</option>
                  <option value="owing">Owing</option>
                  <option value="credit">Credit</option>
                  <option value="settled">Settled</option>
                </select>
                <input value={filters.search} onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))} placeholder="Search tenant, property, unit" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-white p-4 md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Total Invoiced', value: formatMoney(summary.totalInvoiced), accent: 'text-slate-900' },
                { label: 'Paid Applied', value: formatMoney(summary.totalPaidApplied), accent: 'text-emerald-700' },
                { label: 'Outstanding', value: formatMoney(summary.totalOutstanding), accent: 'text-red-600' },
                { label: 'Unapplied Credit', value: formatMoney(summary.totalUnappliedCredit), accent: 'text-amber-600' },
                { label: 'Net Balance', value: formatMoney(summary.netBalance), accent: 'text-slate-900' },
                { label: 'Tenant Rows', value: Number(summary.tenantCount || 0).toLocaleString(), accent: 'text-slate-900' },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{card.label}</div>
                  <div className={`mt-2 text-2xl font-black ${card.accent}`}>{card.value}</div>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-b-2xl bg-white p-4">
              <div className="mb-3 flex flex-wrap gap-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                <span>Owing: {summary.owingCount || 0}</span>
                <span>Credit: {summary.creditCount || 0}</span>
                <span>Settled: {summary.settledCount || 0}</span>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      {['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid', 'Outstanding', 'Unapplied Credit', 'Net Balance', 'Rent Bal', 'Utility Bal', 'Penalty Bal', 'Oldest Due', 'Last Payment', 'Status'].map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.14em]">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(report.rows || []).length === 0 ? (
                      <tr><td colSpan={14} className="px-4 py-10 text-center text-slate-500">No tenants matched the selected filters.</td></tr>
                    ) : (report.rows || []).map((row) => (
                      <tr key={row.tenantId} className="border-t border-slate-200 hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.tenantName}</td>
                        <td className="px-4 py-3 text-slate-700">{row.propertyName}</td>
                        <td className="px-4 py-3 text-slate-700">{row.unitNumber}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMoney(row.totalInvoiced)}</td>
                        <td className="px-4 py-3 text-emerald-700">{formatMoney(row.totalPaidApplied)}</td>
                        <td className="px-4 py-3 text-red-600">{formatMoney(row.outstanding)}</td>
                        <td className="px-4 py-3 text-amber-700">{formatMoney(row.unappliedCredit)}</td>
                        <td className={`px-4 py-3 font-bold ${Number(row.netBalance || 0) > 0 ? 'text-red-700' : Number(row.netBalance || 0) < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{formatMoney(row.netBalance)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMoney(row.rentBalance)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMoney(row.utilityBalance)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMoney(row.penaltyBalance)}</td>
                        <td className="px-4 py-3 text-slate-700">{row.oldestDueDate ? new Date(row.oldestDueDate).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{row.lastPaymentDate ? new Date(row.lastPaymentDate).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] ${row.status === 'owing' ? 'bg-red-100 text-red-700' : row.status === 'credit' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="hidden border-t border-slate-200 px-5 py-4 text-xs text-slate-500 print:block">
              Generated on {new Date().toLocaleString()} • As at {new Date(filters.asOfDate).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PaidBalanceReport;
