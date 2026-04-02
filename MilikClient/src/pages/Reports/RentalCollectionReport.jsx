import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { getRentPayments } from '../../redux/apiCalls';
import { getProperties } from '../../redux/propertyRedux';
import { getTenants } from '../../redux/tenantsRedux';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { FaPrint, FaFileDownload, FaCalendar, FaFilter, FaChartBar } from 'react-icons/fa';
import { toast } from 'react-toastify';

const MILIK_GREEN = "#0B3B2E";
const MILIK_GREEN_BG = "bg-[#0B3B2E]";
const MILIK_ORANGE = "#FF8C00";

const RentalCollectionReport = () => {
  const dispatch = useDispatch();
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const { rentPayments } = useSelector((state) => state.rentPayment);
  const { properties } = useSelector((state) => state.property);
  const { tenants } = useSelector((state) => state.tenants);

  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    propertyId: '',
    paymentMethod: ''
  });

  useEffect(() => {
    const businessId = currentCompany?._id || currentUser?.company?._id || currentUser?.company;
    if (businessId) {
      setLoading(true);
      Promise.all([
        getRentPayments(dispatch, businessId),
        dispatch(getProperties({ business: businessId })),
        dispatch(getTenants({ business: businessId }))
      ]).finally(() => setLoading(false));
    }
  }, [currentCompany?._id, currentUser?.company, dispatch]);

  const filteredPayments = rentPayments?.filter(payment => {
    const paymentDate = new Date(payment.paymentDate);
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    
    const matchesDate = paymentDate >= start && paymentDate <= end;
    const matchesProperty = !filters.propertyId || payment.property?._id === filters.propertyId || payment.property === filters.propertyId;
    const matchesMethod = !filters.paymentMethod || payment.paymentMethod === filters.paymentMethod;
    
    return matchesDate && matchesProperty && matchesMethod;
  }) || [];

  // Group by property
  const groupedByProperty = filteredPayments.reduce((acc, payment) => {
    const propertyId = payment.property?._id || payment.property;
    const propertyData = properties?.find(p => p._id === propertyId);
    const propertyName = propertyData?.propertyName || 'Unknown Property';
    
    if (!acc[propertyName]) {
      acc[propertyName] = {
        payments: [],
        total: 0,
        count: 0
      };
    }
    
    acc[propertyName].payments.push(payment);
    acc[propertyName].total += payment.amountPaid || 0;
    acc[propertyName].count += 1;
    
    return acc;
  }, {});

  // Calculate stats
  const stats = {
    totalCollected: filteredPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0),
    totalPayments: filteredPayments.length,
    properties: Object.keys(groupedByProperty).length,
    avgPayment: filteredPayments.length > 0 ? filteredPayments.reduce((sum, p) => sum + (p.amountPaid || 0), 0) / filteredPayments.length : 0
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const csvData = [
      ['Date', 'Property', 'Tenant', 'Unit', 'Amount', 'Payment Method', 'Receipt No'].join(','),
      ...filteredPayments.map(payment => {
        const propertyId = payment.property?._id || payment.property;
        const propertyData = properties?.find(p => p._id === propertyId);
        const tenantId = payment.tenant?._id || payment.tenant;
        const tenantData = tenants?.find(t => t._id === tenantId);
        
        return [
          new Date(payment.paymentDate).toLocaleDateString(),
          propertyData?.propertyName || 'N/A',
          tenantData?.tenantName || 'N/A',
          payment.unit?.unitNumber || 'N/A',
          payment.amountPaid || 0,
          payment.paymentMethod || 'N/A',
          payment.receiptNumber || 'N/A'
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rental_collection_${filters.startDate}_to_${filters.endDate}.csv`;
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
                  <FaChartBar style={{ color: MILIK_GREEN }} />
                  Rental Collection Report
                </h1>
                <p className="text-gray-600 mt-1">Analyze rent collection trends and performance</p>
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
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Start Date</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">End Date</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
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
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                <select
                  value={filters.paymentMethod}
                  onChange={(e) => setFilters(prev => ({ ...prev, paymentMethod: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                >
                  <option value="">All Methods</option>
                  <option value="cash">Cash</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Total Collected</div>
              <div className="text-3xl font-bold" style={{ color: MILIK_GREEN }}>
                KES {stats.totalCollected.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Total Payments</div>
              <div className="text-3xl font-bold text-gray-900">{stats.totalPayments}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Properties</div>
              <div className="text-3xl font-bold" style={{ color: MILIK_ORANGE }}>{stats.properties}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-600 mb-1">Avg Payment</div>
              <div className="text-3xl font-bold text-gray-900">
                KES {stats.avgPayment.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          </div>

          {/* Summary by Property */}
          <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
            <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
              <h3 className="text-lg font-bold">Collection Summary by Property</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Property</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Payments</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Total Collected</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Avg Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(groupedByProperty).map(([propertyName, data]) => (
                    <tr key={propertyName} className="border-t border-gray-200 hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900">{propertyName}</td>
                      <td className="px-6 py-4 text-sm text-right text-gray-700">{data.count}</td>
                      <td className="px-6 py-4 text-sm text-right font-semibold" style={{ color: MILIK_GREEN }}>
                        KES {data.total.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-right text-gray-700">
                        KES {(data.total / data.count).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-100 font-bold">
                  <tr>
                    <td className="px-6 py-4 text-sm">TOTAL</td>
                    <td className="px-6 py-4 text-sm text-right">{stats.totalPayments}</td>
                    <td className="px-6 py-4 text-sm text-right" style={{ color: MILIK_GREEN }}>
                      KES {stats.totalCollected.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-right">
                      KES {stats.avgPayment.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Detailed Transactions */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className={`${MILIK_GREEN_BG} text-white px-6 py-4`}>
              <h3 className="text-lg font-bold">Detailed Transactions</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Date</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Property</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Tenant</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Unit</th>
                    <th className="px-6 py-3 text-right text-sm font-semibold text-gray-700">Amount</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Method</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Receipt #</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                        No payments found for the selected period
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((payment) => {
                      const propertyId = payment.property?._id || payment.property;
                      const propertyData = properties?.find(p => p._id === propertyId);
                      const tenantId = payment.tenant?._id || payment.tenant;
                      const tenantData = tenants?.find(t => t._id === tenantId);
                      
                      return (
                        <tr key={payment._id} className="border-t border-gray-200 hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-700">
                            {new Date(payment.paymentDate).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">{propertyData?.propertyName || 'N/A'}</td>
                          <td className="px-6 py-4 text-sm text-gray-700">{tenantData?.tenantName || 'N/A'}</td>
                          <td className="px-6 py-4 text-sm text-gray-700">{payment.unit?.unitNumber || 'N/A'}</td>
                          <td className="px-6 py-4 text-sm text-right font-semibold" style={{ color: MILIK_GREEN }}>
                            KES {(payment.amountPaid || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 capitalize">{payment.paymentMethod || 'N/A'}</td>
                          <td className="px-6 py-4 text-sm text-gray-700">{payment.receiptNumber || 'N/A'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Print Footer */}
          <div className="hidden print:block mt-8 text-center text-sm text-gray-600">
            <p>Generated on {new Date().toLocaleString()} | {currentCompany?.name || 'Milik Property Management'}</p>
            <p className="mt-1">Period: {new Date(filters.startDate).toLocaleDateString()} - {new Date(filters.endDate).toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default RentalCollectionReport;
