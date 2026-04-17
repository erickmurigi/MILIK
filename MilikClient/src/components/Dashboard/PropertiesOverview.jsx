import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { adminRequests } from '../../utils/requestMethods';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rentPayments)) return value.rentPayments;
  return [];
};

const normalizeId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value?._id || value?.id || '';
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const getInvoiceRecognitionDate = (invoice) => parseDate(invoice?.bookingDate || invoice?.invoiceDate || invoice?.createdAt);
const isOpenMaintenanceStatus = (status) => !['completed', 'cancelled', 'resolved', 'closed'].includes(normalizeText(status));
const isOperationalTenant = (tenant) => !['inactive', 'terminated', 'evicted', 'moved_out'].includes(normalizeText(tenant?.status));

const PropertiesOverview = ({ darkMode }) => {
  const navigate = useNavigate();
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const properties = useSelector((state) => normalizeArray(state.property?.properties));
  const units = useSelector((state) => normalizeArray(state.unit?.units));
  const tenants = useSelector((state) => normalizeArray(state.tenant?.tenants));
  const maintenances = useSelector((state) => normalizeArray(state.maintenance?.maintenances));
  const rawRentPayments = useSelector((state) => state.rentPayment?.rentPayments);
  const rentPayments = useMemo(() => normalizeArray(rawRentPayments), [rawRentPayments]);
  const propertiesLoading = useSelector((state) => state.property?.loading || state.property?.isFetching);

  const [invoices, setInvoices] = useState([]);

  const businessId =
    currentCompany?._id ||
    currentUser?.company?._id ||
    (typeof currentUser?.company === 'string' ? currentUser.company : '');
  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);

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
    () => properties.filter((p) => !p?.status || normalizeText(p.status) === 'active'),
    [properties]
  );

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const unitMap = useMemo(() => new Map(units.map((unit) => [String(unit?._id || ''), unit])), [units]);

  const tenantAssignmentsByUnit = useMemo(() => {
    const byUnit = new Map();
    tenants.forEach((tenant) => {
      if (!isOperationalTenant(tenant)) return;
      const unitIds = [normalizeId(tenant?.unit), ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits.map(normalizeId) : [])].filter(Boolean);
      unitIds.forEach((unitId) => {
        if (!byUnit.has(unitId)) byUnit.set(unitId, []);
        byUnit.get(unitId).push(tenant);
      });
    });
    return byUnit;
  }, [tenants]);

  const maintenanceAssignmentsByUnit = useMemo(() => {
    const byUnit = new Map();
    maintenances.forEach((item) => {
      if (!isOpenMaintenanceStatus(item?.status)) return;
      const unitId = normalizeId(item?.unit);
      if (!unitId) return;
      if (!byUnit.has(unitId)) byUnit.set(unitId, []);
      byUnit.get(unitId).push(item);
    });
    return byUnit;
  }, [maintenances]);

  const isActiveInvoice = (invoice) => !['cancelled', 'reversed'].includes(normalizeText(invoice?.status));
  const isActivePayment = (payment) => {
    const postingStatus = normalizeText(payment?.postingStatus);
    return !payment?.reversalOf && !payment?.isReversed && !payment?.isCancelled && postingStatus !== 'reversed';
  };
  const amountFromInvoice = (invoice) => Number(invoice?.adjustedAmount ?? invoice?.netAmount ?? invoice?.amount ?? 0);

  const formatMoney = (value) => {
    const numeric = Number(value || 0);
    if (numeric >= 1000000) return `KSh ${(numeric / 1000000).toFixed(1)}M`;
    if (numeric >= 1000) return `KSh ${(numeric / 1000).toFixed(1)}K`;
    return `KSh ${Math.round(numeric).toLocaleString()}`;
  };

  const propertiesWithStats = useMemo(() => {
    const propertyStats = activeProperties.map((property) => {
      const propertyId = String(property._id || '');
      const propertyUnits = units.filter((unit) => String(normalizeId(unit.property) || '') === propertyId);
      const unitIds = new Set(propertyUnits.map((unit) => String(unit._id)));

      const availability = propertyUnits.reduce(
        (summary, unit) => {
          const unitId = normalizeId(unit?._id);
          const currentTenant = unit?.currentTenant || (tenantAssignmentsByUnit.get(unitId) || [])[0] || null;
          const maintenanceItems = maintenanceAssignmentsByUnit.get(unitId) || [];
          const rawStatus = normalizeText(unit?.status);
          const moveOutDate = parseDate(currentTenant?.moveOutDate || currentTenant?.terminationDate || currentTenant?.noticeDate);
          const hasFutureMoveOut = Boolean(moveOutDate && moveOutDate >= now);
          const hasOccupant = Boolean(
            currentTenant || rawStatus === 'occupied' || unit?.isVacant === false || normalizeText(unit?.tenantName) !== ''
          );

          let status = 'vacant';
          if (['off_market', 'inactive', 'archived', 'disabled'].includes(rawStatus)) {
            status = 'off_market';
          } else if (['maintenance', 'under_maintenance'].includes(rawStatus) || maintenanceItems.length > 0) {
            status = 'under_maintenance';
          } else if (rawStatus === 'reserved') {
            status = 'reserved';
          } else if (hasFutureMoveOut) {
            status = 'notice_given';
          } else if (hasOccupant) {
            status = 'occupied';
          }

          if (status === 'occupied' || status === 'notice_given') summary.occupied += 1;
          if (status === 'vacant') summary.vacant += 1;
          return summary;
        },
        { occupied: 0, vacant: 0 }
      );

      const totalUnits = propertyUnits.length;
      const occupancyRate = totalUnits > 0 ? (availability.occupied / totalUnits) * 100 : 0;

      const periodInvoices = invoices.filter((invoice) => {
        if (!isActiveInvoice(invoice)) return false;
        if (!['RENT_CHARGE', 'UTILITY_CHARGE'].includes(String(invoice?.category || '').toUpperCase())) return false;
        const invoicePropertyId = String(normalizeId(invoice?.property) || '');
        if (invoicePropertyId !== propertyId) return false;
        const recognitionDate = getInvoiceRecognitionDate(invoice);
        return Boolean(recognitionDate && recognitionDate.getMonth() === currentMonth && recognitionDate.getFullYear() === currentYear);
      });

      const invoicedThisMonth = periodInvoices.reduce((sum, invoice) => sum + amountFromInvoice(invoice), 0);
      const bookedRentThisMonth = periodInvoices
        .filter((invoice) => String(invoice?.category || '').toUpperCase() === 'RENT_CHARGE')
        .reduce((sum, invoice) => sum + amountFromInvoice(invoice), 0);

      const expectedCollections = tenants
        .filter((tenant) => isOperationalTenant(tenant))
        .reduce((sum, tenant) => {
          const primaryUnitId = String(normalizeId(tenant?.unit) || '');
          const additionalUnitIds = Array.isArray(tenant?.additionalUnits)
            ? tenant.additionalUnits.map((item) => String(normalizeId(item) || '')).filter(Boolean)
            : [];

          if (primaryUnitId && unitIds.has(primaryUnitId)) {
            return sum + Number(tenant?.rent || unitMap.get(primaryUnitId)?.rent || 0);
          }

          const additionalPropertyRent = additionalUnitIds.reduce((unitSum, additionalUnitId) => {
            if (!unitIds.has(additionalUnitId)) return unitSum;
            return unitSum + Number(unitMap.get(additionalUnitId)?.rent || 0);
          }, 0);

          return sum + additionalPropertyRent;
        }, 0);

      const monthlyCollectionRaw = rentPayments
        .filter((payment) => {
          const paymentDate = parseDate(payment?.paymentDate || payment?.createdAt);
          if (!paymentDate) return false;
          const unitId = String(normalizeId(payment?.unit) || '');
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
      const expectedBookingRate = expectedCollections > 0 ? (bookedRentThisMonth / expectedCollections) * 100 : 0;
      const expectedBookingStatus =
        expectedCollections <= 0
          ? 'No expected rent'
          : bookedRentThisMonth + 0.009 >= expectedCollections
          ? 'Fully booked'
          : 'Booking gap';

      return {
        id: propertyId,
        name: property.propertyName || property.name || 'Unnamed Property',
        code: property.propertyCode || '---',
        totalUnits,
        occupiedUnits: availability.occupied,
        vacantUnits: availability.vacant,
        occupancyRate,
        expectedRevenue: invoicedThisMonth,
        expectedCollections,
        bookedRentThisMonth,
        expectedBookingRate,
        expectedBookingStatus,
        monthlyCollection,
        collectionRate,
        invoicedStatus,
      };
    });

    return propertyStats.sort((a, b) => b.occupancyRate - a.occupancyRate);
  }, [activeProperties, invoices, units, tenants, rentPayments, currentMonth, currentYear, unitMap, maintenances, tenantAssignmentsByUnit, maintenanceAssignmentsByUnit, now]);

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
            Portfolio Overview
          </h2>
          <p className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
            Booking-date aware property billing, occupancy and collection snapshot across your portfolio.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/properties', { state: { tabTitle: isLandlordMode ? 'My Properties' : 'Properties' } })}
          className="text-xs font-bold text-[#31694E] hover:text-[#E85C0D] transition-colors uppercase tracking-wide"
        >
          View portfolio →
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
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className={`${darkMode ? 'text-gray-500' : 'text-slate-500'}`}>{property.code}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">
                      {property.invoicedStatus}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-lg font-extrabold ${darkMode ? 'text-gray-900' : 'text-[#1f4a35]'}`}>{property.occupancyRate.toFixed(0)}%</div>
                  <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-500' : 'text-[#4a6b5e]'}`}>Occupied</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-lg border border-[#dce9e1] bg-[#fbfdfc] p-2">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#4a6b5e]">Units</div>
                  <div className="mt-1 text-sm font-bold text-slate-900">{property.totalUnits}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Occupied {property.occupiedUnits}</div>
                </div>
                <div className="rounded-lg border border-[#f7d3c1] bg-[#fff7f2] p-2">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#c44b0b]">Vacant</div>
                  <div className="mt-1 text-sm font-bold text-[#c44b0b]">{property.vacantUnits}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Availability ready</div>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                    <span>Collections this month</span>
                    <span>{formatMoney(property.monthlyCollection)} / {formatMoney(property.expectedRevenue)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#E85C0D]" style={{ width: `${Math.min(property.collectionRate, 100)}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-1">
                    <span>Scheduled rent</span>
                    <span>{formatMoney(property.expectedCollections)} / {formatMoney(property.bookedRentThisMonth)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#31694E]" style={{ width: `${Math.min(property.expectedBookingRate, 100)}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-[#31694E] uppercase tracking-[0.14em]">{property.expectedBookingStatus}</div>
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
