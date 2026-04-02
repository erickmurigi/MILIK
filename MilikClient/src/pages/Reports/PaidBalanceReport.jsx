import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { getTenants } from '../../redux/tenantsRedux';
import { getLeases, getRentPayments } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { FaPrint, FaFileDownload, FaFilter, FaBalanceScale } from 'react-icons/fa';
import { toast } from 'react-toastify';

const MILIK_GREEN = "#0B3B2E";
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_ORANGE = "#FF8C00";

const PaidBalanceReport = () => {
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
    status: 'all' // all, positive, negative
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

  const tenantBalances = tenants?.map(tenant => {
    const tenantLeases = leases?.filter(lease => {
      const leaseTenantId = lease.tenant?._id || lease.tenant;
      return leaseTenantId === tenant._id;
    }) || [];

    const tenantPayments = rentPayments?.filter(payment => {
      const paymentTenantId = payment.tenant?._id || payment.tenant;
      return paymentTenantId === tenant._id;
    }) || [];

    const totalInvoiced = tenantLeases.reduce((sum, lease) => {
      return sum + (lease.rentAmount || 0);
    }, 0);

    // Calculate total paid
    const totalPaid = tenantPayments.reduce((sum, payment) => {
      return sum + (payment.amountPaid || 0);
    }, 0);

    const balance = totalPaid - totalInvoiced;

    const propertyId = tenant.property?._id || tenant.property;
    const propertyData = properties?.find(p => p._id === propertyId);

    return {
      tenantId: tenant._id,
      tenantName: tenant.tenantName,
      property: propertyData?.propertyName || 'N/A',
      propertyId: propertyId,
      unitNumber: tenant.unit?.unitNumber || 'N/A',
      totalInvoiced,
      totalPaid,
      balance,
      status: balance >= 0 ? 'positive' : 'negative'
    };
  }) || [];

  // Apply filters
  const filteredBalances = tenantBalances.filter(tb => {
    const matchesProperty = !filters.propertyId || tb.propertyId === filters.propertyId;
    const matchesStatus = filters.status === 'all' || tb.status === filters.status;
    return matchesProperty && matchesStatus;
  });

  // Calculate stats
  const stats = {
    totalInvoiced: filteredBalances.reduce((sum, tb) => sum + tb.totalInvoiced, 0),
    totalPaid: filteredBalances.reduce((sum, tb) => sum + tb.totalPaid, 0),
    totalBalance: filteredBalances.reduce((sum, tb) => sum + tb.balance, 0),
    positiveBalances: filteredBalances.filter(tb => tb.balance >= 0).length,
    negativeBalances: filteredBalances.filter(tb => tb.balance < 0).length
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const csvData = [
      ['Tenant', 'Property', 'Unit', 'Total Invoiced', 'Total Paid', 'Balance', 'Status'].join(','),
      ...filteredBalances.map(tb => [
        tb.tenantName,
        tb.property,
        tb.unitNumber,
        tb.totalInvoiced,
        tb.totalPaid,
        tb.balance,
        tb.status
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paid_balance_report_${new Date().toISOString().split('T')[0]}.csv`;
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
                  <FaBalanceScale style={{ color: MILIK_GREEN }} />
                  Paid & Balance Report
                </h1>
                <p className="text-gray-600 mt-1">Outstanding balances and payments by tenant</p>
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
                <label className="block text-sm font-semibold text-gray-700 mb-2">Balance Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="all">All Tenants</option>
                  <option value="positive">Positive Balance (Overpaid)</option>
                  <option value="negative">Negative Balance (Owing)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Total Invoiced</div>
              <div className="text-2xl font-bold text-gray-900">
                KES {stats.totalInvoiced.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Total Paid</div>
              <div className="text-2xl font-bold" style={{ color: MILIK_GREEN }}>
                KES {stats.totalPaid.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Net Balance</div>
              <div className={`text-2xl font-bold ${stats.totalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                KES {stats.totalBalance.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Positive</div>
              <div className="text-2xl font-bold text-green-600">{stats.positiveBalances}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Negative</div>
              <div className="text-2xl font-bold text-red-600">{stats.negativeBalances}</div>
            </div>
          </div>

          {/* Tenant Balances Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
              <h3 className="text-lg font-bold">Tenant Balances</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Tenant</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Property</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Unit</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Invoiced</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Paid</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Balance</th>
                    <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBalances.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                        No tenant data available
                      </td>
                    </tr>
                  ) : (
                    filteredBalances.map((tb) => (
                      <tr key={tb.tenantId} className="border-t border-gray-200 hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900">{tb.tenantName}</td>
                        <td className="px-6 py-4 text-sm text-gray-700">{tb.property}</td>
                        <td className="px-6 py-4 text-sm text-gray-700">{tb.unitNumber}</td>
                        <td className="px-6 py-4 text-sm text-right text-gray-700">
                          KES {tb.totalInvoiced.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-semibold" style={{ color: MILIK_GREEN }}>
                          KES {tb.totalPaid.toLocaleString()}
                        </td>
                        <td className={`px-6 py-4 text-sm text-right font-bold ${tb.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          KES {tb.balance.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                            tb.balance >= 0 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {tb.balance >= 0 ? 'Overpaid' : 'Owing'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="bg-gray-100 font-bold">
                  <tr>
                    <td colSpan="3" className="px-6 py-4 text-sm">TOTAL</td>
                    <td className="px-6 py-4 text-sm text-right">KES {stats.totalInvoiced.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-right" style={{ color: MILIK_GREEN }}>
                      KES {stats.totalPaid.toLocaleString()}
                    </td>
                    <td className={`px-6 py-4 text-sm text-right ${stats.totalBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      KES {stats.totalBalance.toLocaleString()}
                    </td>
                    <td></td>
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

export default PaidBalanceReport;
