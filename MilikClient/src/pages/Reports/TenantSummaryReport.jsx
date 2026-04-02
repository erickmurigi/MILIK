import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { getTenants } from '../../redux/tenantsRedux';
import { getLeases, getRentPayments } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { FaPrint, FaFileDownload, FaFilter, FaUsers } from 'react-icons/fa';
import { toast } from 'react-toastify';

const MILIK_GREEN = "#0B3B2E";
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_ORANGE = "#FF8C00";

const TenantSummaryReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const { tenants } = useSelector((state) => state.tenants);
  const { leases } = useSelector((state) => state.leases);
  const { rentPayments } = useSelector((state) => state.rentPayment);
  const { properties } = useSelector((state) => state.property);

  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    propertyId: '',
    status: 'all' // all, active, inactive
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

  // Build tenant summary
  const tenantSummary = tenants?.map(tenant => {
    const tenantLeases = leases?.filter(lease => {
      const leaseTenantId = lease.tenant?._id || lease.tenant;
      return leaseTenantId === tenant._id;
    }) || [];

    const tenantPayments = rentPayments?.filter(payment => {
      const paymentTenantId = payment.tenant?._id || payment.tenant;
      return paymentTenantId === tenant._id;
    }) || [];

    const activeLease = tenantLeases.find(lease => lease.status === 'active') || tenantLeases[0];
    const isActive = activeLease && activeLease.status === 'active';

    const totalPaid = tenantPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
    const totalInvoiced = tenantLeases.reduce((sum, lease) => sum + (lease.rentAmount || 0), 0);
    const balance = totalPaid - totalInvoiced;

    const propertyId = tenant.property?._id || tenant.property;
    const propertyData = properties?.find(p => p._id === propertyId);

    return {
      tenantId: tenant._id,
      tenantName: tenant.tenantName,
      email: tenant.email || 'N/A',
      phone: tenant.phone || 'N/A',
      property: propertyData?.propertyName || 'N/A',
      propertyId: propertyId,
      unitNumber: tenant.unit?.unitNumber || 'N/A',
      rentAmount: activeLease?.rentAmount || 0,
      totalPaid,
      balance,
      paymentCount: tenantPayments.length,
      leaseStart: activeLease?.startDate,
      leaseEnd: activeLease?.endDate,
      status: isActive ? 'active' : 'inactive'
    };
  }) || [];

  // Apply filters
  const filteredData = tenantSummary.filter(ts => {
    const matchesProperty = !filters.propertyId || ts.propertyId === filters.propertyId;
    const matchesStatus = filters.status === 'all' || ts.status === filters.status;
    return matchesProperty && matchesStatus;
  });

  // Calculate stats
  const stats = {
    totalTenants: filteredData.length,
    activeTenants: filteredData.filter(ts => ts.status === 'active').length,
    inactiveTenants: filteredData.filter(ts => ts.status === 'inactive').length,
    totalRentCollected: filteredData.reduce((sum, ts) => sum + ts.totalPaid, 0),
    avgRent: filteredData.length > 0 ? filteredData.reduce((sum, ts) => sum + ts.rentAmount, 0) / filteredData.length : 0
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const csvData = [
      ['Tenant', 'Email', 'Phone', 'Property', 'Unit', 'Rent Amount', 'Total Paid', 'Balance', 'Payment Count', 'Lease Start', 'Lease End', 'Status'].join(','),
      ...filteredData.map(ts => [
        ts.tenantName,
        ts.email,
        ts.phone,
        ts.property,
        ts.unitNumber,
        ts.rentAmount,
        ts.totalPaid,
        ts.balance,
        ts.paymentCount,
        ts.leaseStart ? new Date(ts.leaseStart).toLocaleDateString() : 'N/A',
        ts.leaseEnd ? new Date(ts.leaseEnd).toLocaleDateString() : 'N/A',
        ts.status
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tenant_summary_${new Date().toISOString().split('T')[0]}.csv`;
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
                  <FaUsers style={{ color: MILIK_GREEN }} />
                  Tenant Summary Report
                </h1>
                <p className="text-gray-600 mt-1">Comprehensive tenant overview and analysis</p>
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Property</label>
                <select
                  value={filters.propertyId}
                  onChange={(e) => setFilters(prev => ({ ...prev, propertyId: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="">All Properties</option>
                  {properties?.map(prop => (
                    <option key={prop._id} value={prop._id}>{prop.propertyName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="all">All Tenants</option>
                  <option value="active">Active Only</option>
                  <option value="inactive">Inactive Only</option>
                </select>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Total Tenants</div>
              <div className="text-3xl font-bold text-gray-900">{stats.totalTenants}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Active</div>
              <div className="text-3xl font-bold text-green-600">{stats.activeTenants}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Inactive</div>
              <div className="text-3xl font-bold text-red-600">{stats.inactiveTenants}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Total Collected</div>
              <div className="text-2xl font-bold" style={{ color: MILIK_GREEN }}>
                KES {stats.totalRentCollected.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Avg Rent</div>
              <div className="text-2xl font-bold" style={{ color: MILIK_ORANGE }}>
                KES {stats.avgRent.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>

          {/* Tenant Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
              <h3 className="text-lg font-bold">Tenant Details</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Tenant</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Contact</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Property</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Unit</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Rent</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Total Paid</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Balance</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700">Payments</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-8 text-center text-gray-500">
                        No tenant data available
                      </td>
                    </tr>
                  ) : (
                    filteredData.map((ts) => (
                      <tr key={ts.tenantId} className="border-t border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold text-gray-900">{ts.tenantName}</td>
                        <td className="px-4 py-3 text-gray-700">
                          <div className="text-xs">{ts.email}</div>
                          <div className="text-xs text-gray-500">{ts.phone}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{ts.property}</td>
                        <td className="px-4 py-3 text-gray-700">{ts.unitNumber}</td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          KES {ts.rentAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: MILIK_GREEN }}>
                          KES {ts.totalPaid.toLocaleString()}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${ts.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          KES {ts.balance.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                            {ts.paymentCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${
                            ts.status === 'active' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-gray-100 text-gray-800'
                          }`}>
                            {ts.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
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

export default TenantSummaryReport;
