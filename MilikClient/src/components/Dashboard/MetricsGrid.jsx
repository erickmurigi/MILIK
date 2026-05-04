import React, { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  FaBuilding,
  FaHome,
  FaChartPie,
  FaMoneyBillWave,
} from 'react-icons/fa';
import { getProperties } from '../../redux/propertyRedux';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';

const MetricsGrid = ({ darkMode }) => {
  const dispatch = useDispatch();

  const properties = useSelector((state) => state.property?.properties || []);
  const units = useSelector((state) => state.unit?.units || []);
  const rentPayments = useSelector((state) => state.rentPayment?.rentPayments || []);
  const propertiesLoading = useSelector((state) => state.property?.isFetching);
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);

  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(
        getProperties({
          business: currentCompany._id,
          status: 'active',
          limit: 1000,
        })
      );
    }
  }, [dispatch, currentCompany?._id]);

  const totalProperties = properties.length;
  const totalUnits = units.length;
  const occupiedUnits = units.filter((u) => u.status === 'occupied').length;
  const occupancyRate = totalUnits > 0 ? ((occupiedUnits / totalUnits) * 100).toFixed(1) : '0.0';

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const thisMonthPayments = rentPayments.filter((payment) => {
    const paymentDate = new Date(payment?.createdAt || payment?.paymentDate || 0);
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
        change: '-',
        loading: propertiesLoading,
      },
      {
        id: 2,
        label: isLandlordMode ? 'Portfolio Units' : 'Total Units',
        value: totalUnits.toString(),
        icon: <FaHome />,
        color: 'from-[#31694E] to-[#1f4a35]',
        iconBg: 'bg-[#31694E]/25',
        change: '-',
        loading: propertiesLoading,
      },
      {
        id: 3,
        label: 'Occupancy Rate',
        value: `${occupancyRate}%`,
        icon: <FaChartPie />,
        color: 'from-[#4a9976] to-[#31694E]',
        iconBg: 'bg-[#4a9976]/25',
        change: '-',
        loading: propertiesLoading,
      },
      {
        id: 4,
        label: isLandlordMode ? 'Collected This Month' : 'Total Collected This Month',
        value: formatCurrency(monthlyCollected),
        icon: <FaMoneyBillWave />,
        color: 'from-[#E85C0D] to-[#c7490a]',
        iconBg: 'bg-[#E85C0D]/25',
        change: '-',
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
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-gray-500/35 text-white">
              {metric.change}
            </span>
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
