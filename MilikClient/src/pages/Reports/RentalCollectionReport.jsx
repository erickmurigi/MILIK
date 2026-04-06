import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { getLandlords, getRentalCollectionReport } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { getTenants } from '../../redux/tenantsRedux';
import { FaChartBar, FaFileDownload, FaFilter, FaPrint, FaSyncAlt } from 'react-icons/fa';
import { toast } from 'react-toastify';

const MILIK_GREEN = '#0B3B2E';
const formatMoney = (value) => `KES ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const formatPercent = (value) => (value === null || value === undefined ? '—' : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const toDateInputValue = (value) => new Date(value).toISOString().split('T')[0];

const RentalCollectionReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const properties = useSelector((state) => state.property?.properties || []);
  const tenants = useSelector((state) => state.tenant?.tenants || []);
  const landlords = useSelector((state) => state.landlord?.landlords || []);

  const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company || '';
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (!businessId) return;
    dispatch(getProperties({ business: businessId }));
    dispatch(getTenants({ business: businessId }));
    dispatch(getLandlords({ company: businessId }));
  }, [businessId, dispatch]);

  const loadReport = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const data = await getRentalCollectionReport({ business: businessId, ...filters });
      setReport({
        summary: data?.summary || {},
        byProperty: Array.isArray(data?.byProperty) ? data.byProperty : [],
        rows: Array.isArray(data?.rows) ? data.rows : [],
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Failed to load rental collection report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [businessId, filters.startDate, filters.endDate, filters.propertyId, filters.tenantId, filters.unitId, filters.landlordId, filters.paymentMethod, filters.cashbook]);

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

  const handleExportCSV = () => {
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

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-100 p-4 md:p-6">
        <div className="mx-auto max-w-[96%] print:max-w-full">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
            <div className="border-b border-slate-200 bg-gradient-to-r from-[#0B3B2E] via-[#114b3d] to-slate-900 px-5 py-5 text-white">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-100">Property manager collections</p>
                  <h1 className="mt-1 flex items-center gap-3 text-2xl font-black tracking-tight"><FaChartBar /> Rental Collection Report</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-200">
                    Built from real receipts and receipt allocations so property managers can see total cash collected, what has been applied to rent, utilities and penalties, and what is still unapplied.
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
                <input type="date" value={filters.startDate} onChange={(e) => setFilters((prev) => ({ ...prev, startDate: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                <input type="date" value={filters.endDate} onChange={(e) => setFilters((prev) => ({ ...prev, endDate: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                <select value={filters.propertyId} onChange={(e) => setFilters((prev) => ({ ...prev, propertyId: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">All properties</option>
                  {properties.map((property) => <option key={property._id} value={property._id}>{property.propertyName || property.name}</option>)}
                </select>
                <select value={filters.paymentMethod} onChange={(e) => setFilters((prev) => ({ ...prev, paymentMethod: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">All methods</option>
                  <option value="cash">Cash</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="check">Cheque</option>
                  <option value="credit_card">Card</option>
                </select>
                <select value={filters.tenantId} onChange={(e) => setFilters((prev) => ({ ...prev, tenantId: e.target.value, unitId: '' }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">All tenants</option>
                  {tenants.map((tenant) => <option key={tenant._id} value={tenant._id}>{tenant.tenantName || tenant.name}</option>)}
                </select>
                <select value={filters.unitId} onChange={(e) => setFilters((prev) => ({ ...prev, unitId: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">All units</option>
                  {units.map((unit) => <option key={unit._id} value={unit._id}>{unit.unitNumber}</option>)}
                </select>
                <select value={filters.landlordId} onChange={(e) => setFilters((prev) => ({ ...prev, landlordId: e.target.value }))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="">All landlords</option>
                  {landlords.map((landlord) => <option key={landlord._id} value={landlord._id}>{landlord.landlordName || landlord.name}</option>)}
                </select>
                <input value={filters.cashbook} onChange={(e) => setFilters((prev) => ({ ...prev, cashbook: e.target.value }))} placeholder="Cashbook contains..." className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
              </div>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-white p-4 md:grid-cols-3 xl:grid-cols-6">
              {[
                { label: 'Total Collected', value: formatMoney(summary.totalCollected), accent: 'text-emerald-700' },
                { label: 'Allocated', value: formatMoney(summary.allocatedAmount), accent: 'text-slate-900' },
                { label: 'Unapplied', value: formatMoney(summary.unappliedAmount), accent: 'text-amber-600' },
                { label: 'Rent Applied', value: formatMoney(summary.rentApplied), accent: 'text-slate-900' },
                { label: 'Utilities Applied', value: formatMoney(summary.utilityApplied), accent: 'text-slate-900' },
                { label: 'Collection Rate', value: formatPercent(summary.collectionRate), accent: 'text-slate-900' },
              ].map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{card.label}</div>
                  <div className={`mt-2 text-2xl font-black ${card.accent}`}>{card.value}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-6 p-4">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="bg-[#0B3B2E] px-4 py-3 text-sm font-bold text-white">Collection Summary by Property</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        {['Property', 'Receipts', 'Tenants', 'Collected', 'Rent', 'Utilities', 'Penalty', 'Unapplied'].map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.14em]">{header}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.byProperty || []).length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No collection rows found for the selected filters.</td></tr>
                      ) : (report.byProperty || []).map((row) => (
                        <tr key={row.propertyId || row.propertyName} className="border-t border-slate-200 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.propertyName}</td>
                          <td className="px-4 py-3 text-slate-700">{row.paymentCount}</td>
                          <td className="px-4 py-3 text-slate-700">{row.tenantCount}</td>
                          <td className="px-4 py-3 font-semibold text-emerald-700">{formatMoney(row.totalCollected)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMoney(row.rentApplied)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMoney(row.utilityApplied)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMoney(row.penaltyApplied)}</td>
                          <td className="px-4 py-3 text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="bg-[#0B3B2E] px-4 py-3 text-sm font-bold text-white">Detailed Receipts</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        {['Date', 'Receipt #', 'Property', 'Tenant', 'Unit', 'Method', 'Collected', 'Allocated', 'Rent', 'Utilities', 'Penalty', 'Unapplied', 'Cashbook'].map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 text-left text-xs font-bold uppercase tracking-[0.14em]">{header}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {(report.rows || []).length === 0 ? (
                        <tr><td colSpan={13} className="px-4 py-10 text-center text-slate-500">No receipts found for the current filters.</td></tr>
                      ) : (report.rows || []).map((row) => (
                        <tr key={row.receiptId} className="border-t border-slate-200 hover:bg-slate-50/80">
                          <td className="px-4 py-3 text-slate-700">{row.paymentDate ? new Date(row.paymentDate).toLocaleDateString() : '—'}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.receiptNumber || '—'}</td>
                          <td className="px-4 py-3 text-slate-700">{row.propertyName}</td>
                          <td className="px-4 py-3 text-slate-700">{row.tenantName}</td>
                          <td className="px-4 py-3 text-slate-700">{row.unitNumber}</td>
                          <td className="px-4 py-3 capitalize text-slate-700">{String(row.paymentMethod || '').replace(/_/g, ' ') || '—'}</td>
                          <td className="px-4 py-3 font-semibold text-emerald-700">{formatMoney(row.amount)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMoney(row.allocatedAmount)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMoney(row.rentApplied)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMoney(row.utilityApplied)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMoney(row.penaltyApplied)}</td>
                          <td className="px-4 py-3 font-semibold text-amber-700">{formatMoney(row.unappliedAmount)}</td>
                          <td className="px-4 py-3 text-slate-700">{row.cashbook || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="hidden border-t border-slate-200 px-5 py-4 text-xs text-slate-500 print:block">
              Generated on {new Date().toLocaleString()} • Period {new Date(filters.startDate).toLocaleDateString()} to {new Date(filters.endDate).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RentalCollectionReport;
