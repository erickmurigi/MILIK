import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { getTenants } from '../../redux/tenantsRedux';
import { getLeases, getRentPayments } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { FaPrint, FaFileDownload, FaFilter, FaClock } from 'react-icons/fa';
import { toast } from 'react-toastify';

const MILIK_GREEN = "#0B3B2E";
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_ORANGE = "#FF8C00";

const AgedAnalysisReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const { tenants } = useSelector((state) => state.tenants);
  const { leases } = useSelector((state) => state.leases);
  const { rentPayments } = useSelector((state) => state.rentPayment);
  const { properties } = useSelector((state) => state.property);

  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    propertyId: ''
  });

  useEffect(() => {
    const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company;
    if (businessId) {
      setLoading(true);
      Promise.all([
        dispatch(getTenants({ business: businessId })),
        getLeases(dispatch, businessId),
        getRentPayments(dispatch, businessId),
        dispatch(getProperties({ business: businessId }))
      ]).finally(() => setLoading(false));
    }
  }, [currentCompany?._id, currentUser?.company, dispatch]);

  // Calculate aged balances
  const agedData = tenants?.map(tenant => {
    const tenantLeases = leases?.filter(lease => {
      const leaseTenantId = lease.tenant?._id || lease.tenant;
      return leaseTenantId === tenant._id;
    }) || [];

    const tenantPayments = rentPayments?.filter(payment => {
      const paymentTenantId = payment.tenant?._id || payment.tenant;
      return paymentTenantId === tenant._id;
    }) || [];

    // Calculate amounts owed
    const totalInvoiced = tenantLeases.reduce((sum, lease) => sum + (lease.rentAmount || 0), 0);
    const totalPaid = tenantPayments.reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);
    const amountOwing = totalInvoiced - totalPaid;

    // Skip if no outstanding amount
    if (amountOwing <= 0) return null;

    // Get oldest unpaid invoice date (simplified - using lease start date)
    const oldestLease = tenantLeases.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))[0];
    const daysOutstanding = oldestLease ? Math.floor((new Date() - new Date(oldestLease.startDate)) / (1000 * 60 * 60 * 24)) : 0;

    // Age buckets
    let current = 0, days30 = 0, days60 = 0, days90 = 0, days90Plus = 0;
    
    if (daysOutstanding <= 30) current = amountOwing;
    else if (daysOutstanding <= 60) days30 = amountOwing;
    else if (daysOutstanding <= 90) days60 = amountOwing;
    else if (daysOutstanding <= 120) days90 = amountOwing;
    else days90Plus = amountOwing;

    const propertyId = tenant.property?._id || tenant.property;
    const propertyData = properties?.find(p => p._id === propertyId);

    return {
      tenantId: tenant._id,
      tenantName: tenant.tenantName,
      property: propertyData?.propertyName || 'N/A',
      propertyId: propertyId,
      unitNumber: tenant.unit?.unitNumber || 'N/A',
      current,
      days30,
      days60,
      days90,
      days90Plus,
      total: amountOwing,
      daysOutstanding
    };
  }).filter(Boolean) || [];

  // Apply filters
  const filteredData = agedData.filter(ad => {
    const matchesProperty = !filters.propertyId || ad.propertyId === filters.propertyId;
    return matchesProperty;
  });

  // Calculate totals
  const totals = {
    current: filteredData.reduce((sum, ad) => sum + ad.current, 0),
    days30: filteredData.reduce((sum, ad) => sum + ad.days30, 0),
    days60: filteredData.reduce((sum, ad) => sum + ad.days60, 0),
    days90: filteredData.reduce((sum, ad) => sum + ad.days90, 0),
    days90Plus: filteredData.reduce((sum, ad) => sum + ad.days90Plus, 0),
    total: filteredData.reduce((sum, ad) => sum + ad.total, 0)
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const csvData = [
      ['Tenant', 'Property', 'Unit', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'Total'].join(','),
      ...filteredData.map(ad => [
        ad.tenantName,
        ad.property,
        ad.unitNumber,
        ad.current,
        ad.days30,
        ad.days60,
        ad.days90,
        ad.days90Plus,
        ad.total
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aged_analysis_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('Report exported successfully');
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                  <FaClock style={{ color: MILIK_GREEN }} />
                  Aged Analysis Report
                </h1>
                <p className="text-gray-600 mt-1">Outstanding receivables by aging period</p>
              </div>
              <div className="flex gap-3 print:hidden">
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition"
                >
                  <FaFileDownload /> Export CSV
                </button>
                <button
                  onClick={handlePrint}
                  className={`flex items-center gap-2 px-4 py-2 ${MILIK_GREEN_BG} hover:bg-[#0A3127] text-white rounded-lg font-semibold transition`}
                >
                  <FaPrint /> Print
                </button>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg shadow p-6 mb-6 print:hidden">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
              <FaFilter style={{ color: MILIK_ORANGE }} />
              Filters
            </h3>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Property</label>
              <select
                value={filters.propertyId}
                onChange={(e) => setFilters(prev => ({ ...prev, propertyId: e.target.value }))}
                className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="">All Properties</option>
                {properties?.map(prop => (
                  <option key={prop._id} value={prop._id}>{prop.propertyName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-6 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600 mb-1">Current</div>
              <div className="text-xl font-bold text-green-600">
                KES {totals.current.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600 mb-1">1-30 Days</div>
              <div className="text-xl font-bold text-yellow-600">
                KES {totals.days30.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600 mb-1">31-60 Days</div>
              <div className="text-xl font-bold" style={{ color: MILIK_ORANGE }}>
                KES {totals.days60.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600 mb-1">61-90 Days</div>
              <div className="text-xl font-bold text-red-500">
                KES {totals.days90.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600 mb-1">90+ Days</div>
              <div className="text-xl font-bold text-red-700">
                KES {totals.days90Plus.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600 mb-1">Total</div>
              <div className="text-xl font-bold" style={{ color: MILIK_GREEN }}>
                KES {totals.total.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Aged Analysis Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
              <h3 className="text-lg font-bold">Aging Breakdown by Tenant</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Tenant</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Property</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Unit</th>
                    <th className="px-4 py-3 text-right font-semibold text-green-700">Current</th>
                    <th className="px-4 py-3 text-right font-semibold text-yellow-700">1-30 Days</th>
                    <th className="px-4 py-3 text-right font-semibold" style={{ color: MILIK_ORANGE }}>31-60 Days</th>
                    <th className="px-4 py-3 text-right font-semibold text-red-600">61-90 Days</th>
                    <th className="px-4 py-3 text-right font-semibold text-red-700">90+ Days</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-8 text-center text-gray-500">
                        No outstanding receivables
                      </td>
                    </tr>
                  ) : (
                    filteredData.map((ad) => (
                      <tr key={ad.tenantId} className="border-t border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold text-gray-900">{ad.tenantName}</td>
                        <td className="px-4 py-3 text-gray-700">{ad.property}</td>
                        <td className="px-4 py-3 text-gray-700">{ad.unitNumber}</td>
                        <td className="px-4 py-3 text-right text-green-600 font-semibold">
                          {ad.current > 0 && `KES ${ad.current.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-right text-yellow-600 font-semibold">
                          {ad.days30 > 0 && `KES ${ad.days30.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: MILIK_ORANGE }}>
                          {ad.days60 > 0 && `KES ${ad.days60.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600 font-semibold">
                          {ad.days90 > 0 && `KES ${ad.days90.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-right text-red-700 font-semibold">
                          {ad.days90Plus > 0 && `KES ${ad.days90Plus.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-3 text-right font-bold" style={{ color: MILIK_GREEN }}>
                          KES {ad.total.toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-gray-100 font-bold">
                  <tr>
                    <td colSpan="3" className="px-4 py-4">TOTAL</td>
                    <td className="px-4 py-4 text-right text-green-700">
                      KES {totals.current.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right text-yellow-700">
                      KES {totals.days30.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right" style={{ color: MILIK_ORANGE }}>
                      KES {totals.days60.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right text-red-600">
                      KES {totals.days90.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right text-red-700">
                      KES {totals.days90Plus.toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right" style={{ color: MILIK_GREEN }}>
                      KES {totals.total.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Print Footer */}
          <div className="hidden print:block mt-8 text-center text-sm text-gray-600">
            <p>Generated on {new Date().toLocaleString()} | {currentCompany?.name || 'Milik Property Management'}</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AgedAnalysisReport;
