import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { adminRequests } from '../../utils/requestMethods';

const PropertiesOverview = ({ darkMode }) => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser);
  const properties = useSelector((state) => state.property?.properties || []);
  const units = useSelector((state) => state.unit?.units || []);
  const rentPayments = useSelector((state) => state.rentPayment?.rentPayments || []);
  const propertiesLoading = useSelector((state) => state.property?.loading || state.property?.isFetching);

  const [invoices, setInvoices] = useState([]);

  const businessId =
    currentCompany?._id ||
    currentUser?.company?._id ||
    (typeof currentUser?.company === 'string' ? currentUser.company : '');

  useEffect(() => {
    let active = true;

    const loadInvoices = async () => {
      if (!businessId) {
        if (active) setInvoices([]);
        return;
      }

      try {
        const response = await adminRequests.get(`/tenant-invoices?business=${businessId}`);
        if (!active) return;
        const payload = response?.data;
        setInvoices(Array.isArray(payload) ? payload : Array.isArray(payload?.invoices) ? payload.invoices : []);
      } catch (_error) {
        if (active) setInvoices([]);
      }
    };

    loadInvoices();
    return () => {
      active = false;
    };
  }, [businessId]);

  const activeProperties = useMemo(
    () => properties.filter((p) => !p?.status || String(p.status).toLowerCase() === 'active'),
    [properties]
  );

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const getId = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    return value._id || null;
  };

  const parseDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  };

  const isActiveInvoice = (invoice) => {
    const status = String(invoice?.status || '').toLowerCase();
    return !['cancelled', 'reversed'].includes(status);
  };

  const isActivePayment = (payment) => {
    const postingStatus = String(payment?.postingStatus || '').toLowerCase();
    return !payment?.reversalOf && !payment?.isReversed && !payment?.isCancelled && postingStatus !== 'reversed';
  };

  const amountFromInvoice = (invoice) =>
    Number(invoice?.adjustedAmount ?? invoice?.netAmount ?? invoice?.amount ?? 0);

  const formatMoney = (value) => {
    const numeric = Number(value || 0);
    if (numeric >= 1000000) return `KSh ${(numeric / 1000000).toFixed(1)}M`;
    if (numeric >= 1000) return `KSh ${(numeric / 1000).toFixed(1)}K`;
    return `KSh ${Math.round(numeric).toLocaleString()}`;
  };

  const propertiesWithStats = useMemo(() => {
    const propertyStats = activeProperties.map((property) => {
      const propertyId = String(property._id || '');
      const propertyUnits = units.filter((unit) => String(getId(unit.property) || '') === propertyId);
      const unitIds = new Set(propertyUnits.map((unit) => String(unit._id)));
      const occupiedUnits = propertyUnits.filter((unit) => unit.status === 'occupied' || unit.isVacant === false).length;
      const vacantUnits = Math.max(propertyUnits.length - occupiedUnits, 0);
      const totalUnits = propertyUnits.length;
      const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;

      const periodInvoices = invoices.filter((invoice) => {
        if (!isActiveInvoice(invoice)) return false;
        if (!['RENT_CHARGE', 'UTILITY_CHARGE'].includes(String(invoice?.category || '').toUpperCase())) return false;

        const invoicePropertyId = String(getId(invoice?.property) || '');
        if (invoicePropertyId !== propertyId) return false;

        const invoiceDate = parseDate(invoice?.invoiceDate || invoice?.createdAt);
        if (!invoiceDate) return false;

        return invoiceDate.getMonth() === currentMonth && invoiceDate.getFullYear() === currentYear;
      });

      const invoicedThisMonth = periodInvoices.reduce((sum, invoice) => sum + amountFromInvoice(invoice), 0);

      const monthlyCollectionRaw = rentPayments
        .filter((payment) => {
          const paymentDate = parseDate(payment?.paymentDate || payment?.createdAt);
          if (!paymentDate) return false;
          const unitId = String(getId(payment?.unit) || '');
          return (
            unitId &&
            unitIds.has(unitId) &&
            paymentDate.getMonth() === currentMonth &&
            paymentDate.getFullYear() === currentYear &&
            isActivePayment(payment)
          );
        })
        .reduce((sum, payment) => sum + Math.abs(Number(payment?.amount || 0)), 0);

      const monthlyCollection = invoicedThisMonth > 0 ? monthlyCollectionRaw : 0;
      const collectionRate = invoicedThisMonth > 0 ? (monthlyCollection / invoicedThisMonth) * 100 : 0;
      const invoicedStatus = invoicedThisMonth > 0 ? 'Invoiced' : 'Not invoiced';

      return {
        id: propertyId,
        name: property.propertyName || property.name || 'Unnamed Property',
        code: property.propertyCode || '---',
        totalUnits,
        occupiedUnits,
        vacantUnits,
        occupancyRate,
        expectedRevenue: invoicedThisMonth,
        monthlyCollection,
        collectionRate,
        invoicedStatus,
      };
    });

    return propertyStats.sort((a, b) => b.occupancyRate - a.occupancyRate);
  }, [activeProperties, invoices, units, rentPayments, currentMonth, currentYear]);

  const portfolioOccupancy = useMemo(() => {
    const totalUnits = propertiesWithStats.reduce((sum, item) => sum + item.totalUnits, 0);
    const occupiedUnits = propertiesWithStats.reduce((sum, item) => sum + item.occupiedUnits, 0);
    return totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
  }, [propertiesWithStats]);

  const portfolioCollection = useMemo(() => {
    const expectedRevenue = propertiesWithStats.reduce((sum, item) => sum + item.expectedRevenue, 0);
    const monthlyCollection = propertiesWithStats.reduce((sum, item) => sum + item.monthlyCollection, 0);
    return expectedRevenue > 0 ? (monthlyCollection / expectedRevenue) * 100 : 0;
  }, [propertiesWithStats]);

  return (
    <div className={`dashboard-panel dashboard-panel-compact rounded-xl ${darkMode ? 'bg-white/95' : 'bg-white'} shadow-md border ${darkMode ? 'border-gray-700' : 'border-gray-100'} p-4`}>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h2 className={`text-sm font-extrabold uppercase tracking-tight ${darkMode ? 'text-gray-900' : 'text-[#1f4a35]'}`}>
            Properties Overview
          </h2>
          <p className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            Invoice-aware property billing and collection snapshot.
          </p>
        </div>
        <button className="text-xs font-bold text-[#31694E] hover:text-[#E85C0D] transition-colors uppercase tracking-wide">
          View all →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-50' : 'border-[#dce9e1] bg-[#fbfdfc]'}`}>
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-500' : 'text-[#4a6b5e]'}`}>Portfolio occupancy</div>
          <div className={`mt-1 text-lg font-extrabold ${darkMode ? 'text-gray-900' : 'text-slate-900'}`}>{portfolioOccupancy.toFixed(1)}%</div>
        </div>
        <div className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-50' : 'border-[#dce9e1] bg-[#fbfdfc]'}`}>
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-500' : 'text-[#4a6b5e]'}`}>Collection pace</div>
          <div className={`mt-1 text-lg font-extrabold ${darkMode ? 'text-gray-900' : 'text-slate-900'}`}>{portfolioCollection.toFixed(1)}%</div>
        </div>
      </div>

      <div className="dashboard-scroll-list space-y-2.5 pr-1">
        {propertiesWithStats.length === 0 ? (
          <div className={`p-5 rounded-lg border text-center ${
            darkMode
              ? 'bg-gray-50 border-gray-700 text-gray-500'
              : 'bg-gray-50/80 border-gray-200 text-gray-500'
          }`}>
            {propertiesLoading ? 'Loading properties...' : 'No properties found'}
          </div>
        ) : (
          propertiesWithStats.map((property) => (
            <div
              key={property.id}
              className={`rounded-xl border p-3 ${
                darkMode
                  ? 'border-gray-700 bg-gray-50'
                  : 'border-[#dce9e1] bg-white'
              } hover:shadow-sm transition-all`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className={`font-extrabold text-sm truncate ${darkMode ? 'text-gray-900' : 'text-slate-900'}`} title={property.name}>
                    {property.name}
                  </h4>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className={`text-[11px] font-semibold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      {property.code}
                    </p>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      property.expectedRevenue > 0
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {property.invoicedStatus}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-lg font-extrabold ${darkMode ? 'text-gray-900' : 'text-[#1f4a35]'}`}>{property.occupancyRate.toFixed(0)}%</div>
                  <div className={`text-[10px] font-bold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>occupied</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 mb-3">
                <div className={`rounded-lg border px-2.5 py-2 ${darkMode ? 'border-gray-700 bg-white' : 'border-[#CFE4D8] bg-[#f8fbf9]'}`}>
                  <div className={`text-[10px] font-extrabold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-[#31694E]'}`}>Units</div>
                  <div className={`mt-1 text-sm font-extrabold ${darkMode ? 'text-gray-900' : 'text-slate-900'}`}>{property.occupiedUnits}/{property.totalUnits}</div>
                </div>
                <div className={`rounded-lg border px-2.5 py-2 ${darkMode ? 'border-gray-700 bg-white' : 'border-[#F7C9AF] bg-[#fff8f4]'}`}>
                  <div className={`text-[10px] font-extrabold uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-[#c44b0b]'}`}>Vacant</div>
                  <div className="mt-1 text-sm font-extrabold text-[#E85C0D]">{property.vacantUnits}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className={`${darkMode ? 'text-gray-500' : 'text-gray-600'} font-bold`}>Occupancy</span>
                    <span className={`font-extrabold ${darkMode ? 'text-gray-900' : 'text-[#1f4a35]'}`}>{property.occupancyRate.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#31694E] to-[#4a9976] rounded-full" style={{ width: `${Math.min(property.occupancyRate, 100)}%` }} />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className={`${darkMode ? 'text-gray-500' : 'text-gray-600'} font-bold`}>Collections this month</span>
                    <span className="font-extrabold text-[#E85C0D]">{formatMoney(property.monthlyCollection)} / {formatMoney(property.expectedRevenue)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#E85C0D] to-[#ff8c42] rounded-full" style={{ width: `${Math.min(property.collectionRate, 100)}%` }} />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default PropertiesOverview;
