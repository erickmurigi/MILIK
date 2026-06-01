import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  FaBuilding,
  FaHome,
  FaChartPie,
  FaMoneyBillWave,
} from 'react-icons/fa';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllProperties,
  selectAllUnits,
  selectAllRentPayments,
} from '../../redux/selectors';

const MetricsGrid = ({ darkMode }) => {
  const properties = useSelector(selectAllProperties);
  const units = useSelector(selectAllUnits);
  const rentPayments = useSelector(selectAllRentPayments);
  const propertiesLoading = useSelector((state) => state.property?.isFetching);
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);

  const totalProperties = properties.length;
  const totalUnits = units.filter((u) => {
    const s = String(u?.status || '').trim().toLowerCase();
    return !['off_market', 'inactive', 'archived', 'disabled'].includes(s);
  }).length;
  const occupiedUnits = units.filter((u) => {
    const s = String(u?.status || '').trim().toLowerCase();
    return s === 'occupied' || s === 'notice_given' || s === 'reserved';
  }).length;
  const occupancyRate = totalUnits > 0 ? ((occupiedUnits / totalUnits) * 100).toFixed(1) : '0.0';

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const thisMonthPayments = rentPayments.filter((payment) => {
    const paymentDate = new Date(payment?.paymentDate || payment?.createdAt || 0);
    return (
      !Number.isNaN(paymentDate.getTime()) &&
      paymentDate.getMonth() === currentMonth &&
      paymentDate.getFullYear() === currentYear &&
      payment?.isConfirmed === true &&
      payment?.isCancelled !== true &&
      payment?.isReversed !== true &&
      !payment?.reversalOf &&
      String(payment?.postingStatus || '').toLowerCase() !== 'reversed'
    );
  });

  const monthlyCollected = thisMonthPayments.reduce(
    (sum, payment) => sum + Math.abs(Number(payment?.amount || 0)),
    0
  );

  const formatCurrency = (value) => {
    if (value >= 1000000) return `KSh ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `KSh ${(value / 1000).toFixed(1)}K`;
    return `KSh ${Number(value || 0).toLocaleString()}`;
  };

  const metrics = useMemo(
    () => [
      {
        id: 1,
        label: isLandlordMode ? 'My Properties' : 'Total Properties',
        value: totalProperties.toString(),
        icon: <FaBuilding />,
        color: 'from-[#1e5a4a] to-[#0f3d2e]',
        iconBg: 'bg-[#1e5a4a]/20',
        loading: propertiesLoading,
      },
      {
        id: 2,
        label: isLandlordMode ? 'Portfolio Units' : 'Total Units',
        value: totalUnits.toString(),
        icon: <FaHome />,
        color: 'from-[#31694E] to-[#1f4a35]',
        iconBg: 'bg-[#31694E]/25',
        loading: propertiesLoading,
      },
      {
        id: 3,
        label: 'Occupancy Rate',
        value: `${occupancyRate}%`,
        icon: <FaChartPie />,
        color: 'from-[#4a9976] to-[#31694E]',
        iconBg: 'bg-[#4a9976]/25',
        loading: propertiesLoading,
      },
      {
        id: 4,
        label: isLandlordMode ? 'Collected This Month' : 'Total Collected This Month',
        value: formatCurrency(monthlyCollected),
        icon: <FaMoneyBillWave />,
        color: 'from-[#E85C0D] to-[#c7490a]',
        iconBg: 'bg-[#E85C0D]/25',
        loading: propertiesLoading,
      },
    ],
    [isLandlordMode, monthlyCollected, occupancyRate, propertiesLoading, totalProperties, totalUnits]
  );

  return (
    <div className="sticky top-0 z-20 grid grid-cols-1 gap-2 border-b border-gray-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <div
          key={metric.id}
          className={`bg-gradient-to-br ${metric.color} rounded-lg p-2 text-white shadow-sm transition-all duration-300 ${
            metric.loading ? 'opacity-60' : ''
          }`}
        >
          <div className="mb-1.5 flex items-center justify-between">
            <div className={`p-1.5 ${metric.iconBg} rounded-lg backdrop-blur-sm`}>
              <div className="text-white text-base">{metric.icon}</div>
            </div>
          </div>
          <h3 className="mb-0.5 text-base font-extrabold tracking-tight">
            {metric.loading ? '...' : metric.value}
          </h3>
          <p className="text-white/80 text-[10px] font-semibold uppercase tracking-wide">{metric.label}</p>
        </div>
      ))}
    </div>
  );
};

export default MetricsGrid;
