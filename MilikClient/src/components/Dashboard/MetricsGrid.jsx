import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  FaBuilding,
  FaHome,
  FaChartPie,
  FaMoneyBillWave,
  FaReceipt,
  FaChartLine,
} from 'react-icons/fa';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import { hasCompanyPermission } from '../../utils/permissions';
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllProperties,
  selectAllUnits,
  selectAllRentPayments,
  selectAllExpenseProperties,
} from '../../redux/selectors';

const MetricsGrid = ({ darkMode, summaryData = {} }) => {
  const properties = useSelector(selectAllProperties);
  const units = useSelector(selectAllUnits);
  const rentPayments = useSelector(selectAllRentPayments);
  const expenseProperties = useSelector(selectAllExpenseProperties);
  const propertiesLoading = useSelector((state) => state.property?.isFetching);
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);
  const canViewFinancials = hasCompanyPermission(currentUser || {}, currentCompany, 'financialReports', 'view', ['accounts', 'propertyManagement']);

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

  // Prefer the authoritative server-computed total; fall back to local Redux if summaryData not yet loaded
  const serverCollected = Number(summaryData?.collectedThisMonth ?? summaryData?.monthlyRevenue ?? -1);
  const thisMonthPayments = serverCollected >= 0 ? [] : rentPayments.filter((payment) => {
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

  const monthlyCollected = serverCollected >= 0
    ? serverCollected
    : thisMonthPayments.reduce((sum, p) => sum + Math.abs(Number(p?.amount || 0)), 0);

  const monthlyExpenses = useMemo(() => {
    if (!isLandlordMode) return 0;
    return expenseProperties.reduce((sum, exp) => {
      const d = new Date(exp?.date || exp?.createdAt || 0);
      if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) return sum;
      return sum + Math.abs(Number(exp?.amount || 0));
    }, 0);
  }, [isLandlordMode, expenseProperties, currentMonth, currentYear]);

  const netIncome = monthlyCollected - monthlyExpenses;

  const formatCurrency = (value) => {
    if (value >= 1000000) return `KSh ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `KSh ${(value / 1000).toFixed(1)}K`;
    return `KSh ${Number(value || 0).toLocaleString()}`;
  };

  const baseMetrics = useMemo(
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
      ...(canViewFinancials ? [{
        id: 4,
        label: isLandlordMode ? 'Collected This Month' : 'Total Collected This Month',
        value: formatCurrency(monthlyCollected),
        icon: <FaMoneyBillWave />,
        color: 'from-[#E85C0D] to-[#c7490a]',
        iconBg: 'bg-[#E85C0D]/25',
        loading: propertiesLoading,
      }] : []),
    ],
    [canViewFinancials, isLandlordMode, monthlyCollected, occupancyRate, propertiesLoading, totalProperties, totalUnits]
  );

  const landlordExtraMetrics = useMemo(() => {
    if (!isLandlordMode || !canViewFinancials) return [];
    return [
      {
        id: 5,
        label: 'Expenses This Month',
        value: formatCurrency(monthlyExpenses),
        icon: <FaReceipt />,
        color: 'from-[#6b21a8] to-[#4c1d95]',
        iconBg: 'bg-[#6b21a8]/25',
        loading: propertiesLoading,
      },
      {
        id: 6,
        label: 'Net Income This Month',
        value: formatCurrency(Math.max(0, netIncome)),
        icon: <FaChartLine />,
        color: netIncome >= 0 ? 'from-[#065f46] to-[#064e3b]' : 'from-[#991b1b] to-[#7f1d1d]',
        iconBg: 'bg-white/20',
        loading: propertiesLoading,
      },
    ];
  }, [canViewFinancials, isLandlordMode, monthlyExpenses, netIncome, propertiesLoading]);

  const metrics = [...baseMetrics, ...landlordExtraMetrics];

  return (
    <div className={`sticky top-0 z-20 grid gap-2 border-b border-gray-200 bg-slate-50/95 p-2 shadow-sm backdrop-blur ${
      isLandlordMode && canViewFinancials
        ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
    }`}>
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
