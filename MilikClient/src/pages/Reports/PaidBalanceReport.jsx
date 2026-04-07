import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getTenantPaidBalanceReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { FaBalanceScale, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';

const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];
const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);

const PaidBalanceReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const properties = useSelector((state) => state.property?.properties || []);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const companyName = currentCompany?.name
    || currentCompany?.companyName
    || currentCompany?.businessName
    || currentUser?.company?.name
    || currentUser?.company?.companyName
    || 'Milik';

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
  const propertyNameMap = useMemo(() => new Map(properties.map((property) => [String(property?._id), property?.propertyName || property?.name || 'Unnamed Property'])), [properties]);

  const balanceInsights = useMemo(() => {
    const rows = Array.isArray(report.rows) ? report.rows : [];
    const owingRows = rows.filter((row) => String(row?.status) === 'owing');
    const creditRows = rows.filter((row) => String(row?.status) === 'credit');
    const settledRows = rows.filter((row) => String(row?.status) === 'settled');
    const largestOwing = [...owingRows].sort((a, b) => Number(b?.netBalance || 0) - Number(a?.netBalance || 0))[0] || null;
    const largestCredit = [...creditRows].sort((a, b) => Number(a?.netBalance || 0) - Number(b?.netBalance || 0))[0] || null;
    const earliestArrear = [...owingRows]
      .filter((row) => row?.oldestDueDate)
      .sort((a, b) => new Date(a.oldestDueDate) - new Date(b.oldestDueDate))[0] || null;
    const tenantCount = Number(summary.tenantCount || rows.length || 0);
    const settlementRate = tenantCount > 0 ? (settledRows.length / tenantCount) * 100 : null;
    const averageOutstanding = owingRows.length > 0 ? Number(summary.totalOutstanding || 0) / owingRows.length : 0;

    return {
      largestOwing,
      largestCredit,
      earliestArrear,
      settlementRate,
      averageOutstanding,
      narrative: [
        owingRows.length > 0
          ? `${owingRows.length} tenant account${owingRows.length === 1 ? '' : 's'} are currently in arrears, with an average outstanding balance of ${formatMoney(averageOutstanding)}.`
          : 'No tenants are currently in an owing position for the selected filters.',
        largestOwing
          ? `${largestOwing.tenantName} carries the highest net debtor position at ${formatMoney(largestOwing.netBalance)}.`
          : 'There is no dominant debtor concentration to highlight yet.',
        creditRows.length > 0
          ? `${creditRows.length} tenant account${creditRows.length === 1 ? '' : 's'} hold unapplied credit or prepayment, led by ${largestCredit?.tenantName || 'the top credit tenant'}.`
          : 'There is no unapplied tenant credit exposed in the selected view.',
      ],
    };
  }, [report.rows, summary.tenantCount, summary.totalOutstanding]);

  const filterSummary = useMemo(() => ([
    { label: 'As At', value: formatDate(filters.asOfDate) },
    { label: 'Property', value: filters.propertyId ? propertyNameMap.get(String(filters.propertyId)) || 'Selected property' : 'All properties' },
    { label: 'Position Filter', value: filters.status === 'all' ? 'All tenant positions' : filters.status },
    { label: 'Search', value: filters.search || 'No free-text filter' },
  ]), [filters, propertyNameMap]);

  const printGeneratedAt = useMemo(() => new Date().toLocaleString(), [report, filters]);

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

  const handlePrint = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.print();
      });
    });
  };

  return (
    <DashboardLayout>
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
          .report-print-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; padding: 10px 12px; border: 1px solid #dbe2ea; border-radius: 12px; background: #ffffff; }
          .report-print-filter-item { font-size: 10px; color: #334155; }
          .report-print-filter-item strong { color: #0f172a; }
          .report-print-insights { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
          .report-print-insight { border-left: 4px solid #0B3B2E; background: #f8fafc; border-radius: 10px; padding: 10px 12px; font-size: 10px; line-height: 1.5; }
          .report-print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
          .report-print-table th, .report-print-table td { border: 1px solid #dbe2ea; padding: 6px 8px; vertical-align: top; }
          .report-print-table thead th { background: #edf4f0; color: #0B3B2E; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; text-align: left; }
          .report-print-table tbody tr:nth-child(even) { background: #fafafa; }
          .text-right { text-align: right; }
          .text-red { color: #b91c1c; font-weight: 800; }
          .text-emerald { color: #047857; font-weight: 800; }
          .text-amber { color: #b45309; font-weight: 800; }
        `}</style>

        <div className="report-print-shell">
          <div className="report-print-header">
            <div>
              <div className="report-print-brand report-print-label">{companyName}</div>
              <h1 className="report-print-title">Paid &amp; Balance Report</h1>
              <p className="report-print-subtitle">
                Tenant receivables control snapshot showing invoiced amounts, applied receipts, current debtor positions, unapplied credit and the accounts that require fastest follow-up.
              </p>
            </div>
            <div className="report-print-meta">
              <div><strong>As At:</strong> {formatDate(filters.asOfDate)}</div>
              <div><strong>Generated:</strong> {printGeneratedAt}</div>
              <div><strong>Prepared by:</strong> {currentUser?.username || currentUser?.email || 'System user'}</div>
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
              { label: 'Paid Applied', value: formatMoney(summary.totalPaidApplied) },
              { label: 'Outstanding', value: formatMoney(summary.totalOutstanding) },
              { label: 'Unapplied Credit', value: formatMoney(summary.totalUnappliedCredit) },
            ].map((card) => (
              <div key={card.label} className="report-print-metric">
                <div className="report-print-label">{card.label}</div>
                <div className="report-print-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="report-print-section report-print-grid">
            {[
              { label: 'Net Balance', value: formatMoney(summary.netBalance) },
              { label: 'Owing Accounts', value: Number(summary.owingCount || 0).toLocaleString() },
              { label: 'Credit Accounts', value: Number(summary.creditCount || 0).toLocaleString() },
              { label: 'Settlement Rate', value: formatPercent(balanceInsights.settlementRate) },
            ].map((card) => (
              <div key={card.label} className="report-print-metric">
                <div className="report-print-label">{card.label}</div>
                <div className="report-print-value">{card.value}</div>
              </div>
            ))}
          </div>

          <div className="report-print-section report-print-insights">
            {balanceInsights.narrative.map((item, index) => (
              <div key={`${item}-${index}`} className="report-print-insight">{item}</div>
            ))}
          </div>

          <div className="report-print-section">
            <h2 className="report-print-section-title">Tenant Positions</h2>
            <table className="report-print-table">
              <thead>
                <tr>
                  {['Tenant', 'Property', 'Unit', 'Invoiced', 'Paid', 'Outstanding', 'Credit', 'Net Balance', 'Oldest Due', 'Last Payment', 'Status'].map((header) => <th key={header}>{header}</th>)}
                </tr>
              </thead>
              <tbody>
                {(report.rows || []).length === 0 ? (
                  <tr><td colSpan={11}>No tenants matched the selected filters.</td></tr>
                ) : (report.rows || []).map((row) => (
                  <tr key={row.tenantId}>
                    <td>{row.tenantName}</td>
                    <td>{row.propertyName}</td>
                    <td>{row.unitNumber}</td>
                    <td className="text-right">{formatMoney(row.totalInvoiced)}</td>
                    <td className="text-right text-emerald">{formatMoney(row.totalPaidApplied)}</td>
                    <td className="text-right text-red">{formatMoney(row.outstanding)}</td>
                    <td className="text-right text-amber">{formatMoney(row.unappliedCredit)}</td>
                    <td className={`text-right ${Number(row.netBalance || 0) > 0 ? 'text-red' : Number(row.netBalance || 0) < 0 ? 'text-emerald' : ''}`}>{formatMoney(row.netBalance)}</td>
                    <td>{formatDate(row.oldestDueDate)}</td>
                    <td>{formatDate(row.lastPaymentDate)}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="no-print min-h-screen bg-slate-100 p-4 md:p-6">
        <div className="mx-auto max-w-[96%]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-100">Tenant receivables control</p>
                  <h1 className="mt-1 flex items-center gap-3 text-2xl font-black tracking-tight"><FaBalanceScale /> Paid &amp; Balance Report</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">
                    Uses tenant invoices and real receipt allocations to show what has been invoiced, what has been paid, what remains outstanding, and where tenants still have unapplied credit.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleExportCSV} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaFileDownload /> Export CSV</button>
                  <button onClick={handlePrint} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaPrint /> Print</button>
                  <button onClick={loadReport} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-white/15"><FaSyncAlt className={loading ? 'animate-spin' : ''} /> Refresh</button>
                </div>
              </div>
            </div>

            <div className="border-b border-slate-200 bg-slate-50 p-4">
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

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Largest Debtor</div>
                <div className="mt-2 text-xl font-black text-slate-900">{balanceInsights.largestOwing?.tenantName || '—'}</div>
                <p className="mt-2 text-sm text-slate-600">
                  {balanceInsights.largestOwing
                    ? `${formatMoney(balanceInsights.largestOwing.netBalance)} currently outstanding for ${balanceInsights.largestOwing.propertyName || 'selected property'}.`
                    : 'No owing tenant position is currently exposed in the filtered view.'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Largest Credit</div>
                <div className="mt-2 text-xl font-black text-slate-900">{balanceInsights.largestCredit?.tenantName || '—'}</div>
                <p className="mt-2 text-sm text-slate-600">
                  {balanceInsights.largestCredit
                    ? `${formatMoney(Math.abs(Number(balanceInsights.largestCredit.netBalance || 0)))} in credit still awaits invoice application or refund treatment.`
                    : 'No tenant credit position is currently open in the filtered view.'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Settlement Rate</div>
                <div className="mt-2 text-xl font-black text-slate-900">{formatPercent(balanceInsights.settlementRate)}</div>
                <p className="mt-2 text-sm text-slate-600">Share of tenant accounts that are fully settled in the current report view.</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-b-2xl bg-white p-4">
              <div className="mb-3 flex flex-wrap gap-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                <span>Owing: {summary.owingCount || 0}</span>
                <span>Credit: {summary.creditCount || 0}</span>
                <span>Settled: {summary.settledCount || 0}</span>
                {balanceInsights.earliestArrear?.tenantName && <span>Oldest due: {balanceInsights.earliestArrear.tenantName} ({formatDate(balanceInsights.earliestArrear.oldestDueDate)})</span>}
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
                        <td className="px-4 py-3 text-slate-700">{formatDate(row.oldestDueDate)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDate(row.lastPaymentDate)}</td>
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
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PaidBalanceReport;
