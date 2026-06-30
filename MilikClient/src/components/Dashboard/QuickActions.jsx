import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  FaArrowRight,
  FaClipboardList,
  FaExclamationTriangle,
  FaFileAlt,
  FaFileInvoiceDollar,
  FaHome,
  FaMoneyBillWave,
  FaReceipt,
  FaTools,
} from 'react-icons/fa';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import { hasCompanyPermission } from '../../utils/permissions';
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllUnits,
  selectAllTenants,
  selectAllMaintenances,
  selectAllExpenseProperties,
} from '../../redux/selectors';

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

const isOpenMaintenanceStatus = (status) => !['completed', 'cancelled', 'resolved', 'closed'].includes(normalizeText(status));
const isOperationalTenant = (tenant) => !['inactive', 'terminated', 'evicted', 'moved_out'].includes(normalizeText(tenant?.status));
const isOffMarketUnitStatus = (status) => ['off_market', 'inactive', 'archived', 'disabled'].includes(normalizeText(status));
const isReservedUnitStatus = (status) => normalizeText(status) === 'reserved';
const isMaintenanceUnitStatus = (status) => ['maintenance', 'under_maintenance'].includes(normalizeText(status));
const hasFutureMoveOut = (tenant, today) => {
  const moveOutDate = parseDate(tenant?.moveOutDate || tenant?.terminationDate || tenant?.noticeDate);
  return Boolean(moveOutDate && moveOutDate >= today);
};

const QuickActions = ({
  darkMode,
  summaryData = {},
  loading = false,
}) => {
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const units = useSelector(selectAllUnits);
  const tenants = useSelector(selectAllTenants);
  const maintenances = useSelector(selectAllMaintenances);
  const expenseProperties = useSelector(selectAllExpenseProperties);

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);

  const canViewInvoices = hasCompanyPermission(currentUser || {}, currentCompany, 'tenantInvoices', 'view', 'propertyManagement');
  const canViewReceipts = hasCompanyPermission(currentUser || {}, currentCompany, 'receipts', 'view', 'propertyManagement');
  const canViewVouchers = hasCompanyPermission(currentUser || {}, currentCompany, 'paymentVouchers', 'view', 'accounts');
  const canViewProcessedStatements = hasCompanyPermission(currentUser || {}, currentCompany, 'processedStatements', 'view', 'accounts');

  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

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

  const availabilitySummary = useMemo(() => {
    return units.reduce(
      (summary, unit) => {
        const unitId = normalizeId(unit?._id);
        const currentTenant = unit?.currentTenant || (tenantAssignmentsByUnit.get(unitId) || [])[0] || null;
        const maintenanceItems = maintenanceAssignmentsByUnit.get(unitId) || [];
        const rawStatus = normalizeText(unit?.status);

        const isOffMarket = isOffMarketUnitStatus(rawStatus);
        const isMaintenance = isMaintenanceUnitStatus(rawStatus) || maintenanceItems.length > 0;
        const isReserved = isReservedUnitStatus(rawStatus);
        const tenantNotice = hasFutureMoveOut(currentTenant, today);
        const hasOccupant = Boolean(
          currentTenant || rawStatus === 'occupied' || unit?.isVacant === false || normalizeText(unit?.tenantName) !== ''
        );

        let availabilityStatus = 'vacant';
        if (isOffMarket) {
          availabilityStatus = 'off_market';
        } else if (isMaintenance) {
          availabilityStatus = 'under_maintenance';
        } else if (isReserved) {
          availabilityStatus = 'reserved';
        } else if (tenantNotice) {
          availabilityStatus = 'notice_given';
        } else if (hasOccupant) {
          availabilityStatus = 'occupied';
        }

        summary.total += 1;
        if (availabilityStatus === 'vacant') summary.vacant += 1;
        if (availabilityStatus === 'occupied') summary.occupied += 1;
        if (availabilityStatus === 'notice_given') summary.notice += 1;
        if (availabilityStatus === 'reserved') summary.reserved += 1;
        if (availabilityStatus === 'under_maintenance') summary.maintenance += 1;
        if (availabilityStatus === 'off_market') summary.offMarket += 1;
        return summary;
      },
      { total: 0, vacant: 0, occupied: 0, notice: 0, reserved: 0, maintenance: 0, offMarket: 0 }
    );
  }, [maintenanceAssignmentsByUnit, tenantAssignmentsByUnit, today, units]);

  const overdueInvoices = summaryData?.overdueInvoiceCount ?? 0;

  const vacantUnits = availabilitySummary.vacant;

  const leasesExpiringSoon = summaryData?.leasesExpiringSoonCount ?? 0;

  const unpostedReceipts = summaryData?.unpostedReceiptCount ?? 0;

  const pendingMaintenance = useMemo(
    () => maintenances.filter((item) => ['pending', 'open', 'in_progress'].includes(normalizeText(item?.status))).length,
    [maintenances]
  );

  const pendingStatements = summaryData?.pendingStatementCount ?? 0;
  const pendingVoucherApprovals = summaryData?.draftVoucherCount ?? 0;

  const thisMonthExpenseCount = useMemo(() => {
    if (!isLandlordMode) return 0;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return expenseProperties.filter((exp) => {
      const d = parseDate(exp?.date || exp?.createdAt);
      return d && d.getFullYear() === y && d.getMonth() === m;
    }).length;
  }, [isLandlordMode, expenseProperties]);

  const items = useMemo(() => {
    const baseItems = [
      {
        id: 'vacant-units',
        label: isLandlordMode ? 'Vacant units in my portfolio' : 'Vacant units',
        value: vacantUnits,
        icon: <FaHome />,
        tone: 'green',
        helper: isLandlordMode
          ? 'Open availability status to review vacancies, notices and readiness across your portfolio.'
          : 'Open availability status to review empty spaces, notices and letting readiness.',
        route: '/vacants',
        tabTitle: 'Availability Status',
      },
      ...(canViewInvoices ? [{
        id: 'overdue-invoices',
        label: 'Overdue invoices',
        value: overdueInvoices,
        icon: <FaFileInvoiceDollar />,
        tone: 'orange',
        helper: 'Open rental invoices to follow up overdue tenant balances.',
        route: '/invoices/rental',
        tabTitle: 'Rental Invoices',
      }] : []),
      {
        id: 'leases-expiring',
        label: isLandlordMode ? 'Lease renewals due in 30 days' : 'Leases expiring in 30 days',
        value: leasesExpiringSoon,
        icon: <FaFileAlt />,
        tone: 'blue',
        helper: isLandlordMode
          ? 'Open tenants workspace to review renewals and direct tenant follow-up.'
          : 'Open tenants workspace to review renewals and tenant records.',
        route: '/tenants',
        tabTitle: 'Tenants',
      },
      ...(canViewReceipts ? [{
        id: 'unposted-receipts',
        label: isLandlordMode ? 'Receipts awaiting posting' : 'Unposted receipts',
        value: unpostedReceipts,
        icon: <FaReceipt />,
        tone: 'amber',
        helper: 'Open receipts to post or confirm incoming collections.',
        route: '/receipts',
        tabTitle: 'Receipts',
      }] : []),
      {
        id: 'pending-maintenance',
        label: 'Pending maintenance requests',
        value: pendingMaintenance,
        icon: <FaTools />,
        tone: 'red',
        helper: 'Open maintenance workspace for pending operational tasks.',
        route: '/maintenances',
        tabTitle: 'Maintenance',
      },
      ...(canViewVouchers ? [{
        id: 'pending-vouchers',
        label: isLandlordMode ? 'Outgoing payments pending approval' : 'Payment vouchers pending approvals',
        value: pendingVoucherApprovals,
        icon: <FaExclamationTriangle />,
        tone: 'slate',
        helper: isLandlordMode
          ? 'Open outgoing payments to review approvals before cash leaves the business.'
          : 'Open payment vouchers for approval and posting workflow.',
        route: '/financial/payment-vouchers',
        tabTitle: 'Payment Vouchers',
      }] : []),
    ];

    if (isLandlordMode) {
      baseItems.push({
        id: 'monthly-expenses',
        label: 'Property expenses logged this month',
        value: thisMonthExpenseCount,
        icon: <FaMoneyBillWave />,
        tone: 'purple',
        helper: 'Open Property Expenses to review and record costs for your portfolio this month.',
        route: '/property-expenses',
        tabTitle: 'Property Expenses',
      });
    } else if (canViewProcessedStatements) {
      baseItems.push({
        id: 'pending-statements',
        label: 'Landlord statements pending settlement',
        value: pendingStatements,
        icon: <FaClipboardList />,
        tone: 'purple',
        helper: 'Open processed statements to review unpaid landlord settlements and recovery balances.',
        route: '/landlord/processed-statements',
        tabTitle: 'Processed Statements',
      });
    }

    return baseItems;
  }, [canViewInvoices, canViewProcessedStatements, canViewReceipts, canViewVouchers, isLandlordMode, leasesExpiringSoon, overdueInvoices, pendingMaintenance, pendingStatements, pendingVoucherApprovals, summaryData, thisMonthExpenseCount, unpostedReceipts, vacantUnits]);

  const getToneClasses = (tone) => {
    const tones = {
      orange: { icon: 'text-[#E85C0D]', badge: 'bg-[#FFF1E8] text-[#C44B0B]', border: 'border-[#F7C9AF]' },
      green: { icon: 'text-[#1f4a35]', badge: 'bg-[#ECF6F1] text-[#1f4a35]', border: 'border-[#CFE4D8]' },
      blue: { icon: 'text-blue-700', badge: 'bg-blue-50 text-blue-700', border: 'border-blue-200' },
      amber: { icon: 'text-amber-700', badge: 'bg-amber-50 text-amber-700', border: 'border-amber-200' },
      red: { icon: 'text-red-700', badge: 'bg-red-50 text-red-700', border: 'border-red-200' },
      purple: { icon: 'text-purple-700', badge: 'bg-purple-50 text-purple-700', border: 'border-purple-200' },
      slate: { icon: 'text-slate-700', badge: 'bg-slate-100 text-slate-700', border: 'border-slate-200' },
    };
    return tones[tone] || tones.green;
  };

  const handleItemOpen = (item) => {
    if (!item?.route) return;
    navigate(item.route, { state: { tabTitle: item.tabTitle || item.label } });
  };

  const priorityItem = useMemo(
    () =>
      items
        .filter((item) => Number(item.value || 0) > 0)
        .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))[0] || null,
    [items]
  );

  return (
    <div
      className={`dashboard-panel rounded-xl ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-[#f8faf9] border-[#31694E]/10'
      } shadow-md border p-4`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className={`font-extrabold text-sm tracking-tight uppercase ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
            {isLandlordMode ? 'Landlord Action Center' : 'Action Center'}
          </h3>
          <p className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {isLandlordMode
              ? 'Portfolio alerts, tenant collections and expense approvals that need direct owner attention.'
              : 'Alerts, exceptions and workflow items that need attention.'}
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide ${darkMode ? 'bg-[#31694E]/20 text-[#8bd1b0]' : 'bg-[#ECF6F1] text-[#1f4a35]'}`}>
          {items.filter((item) => item.value > 0).length} live alerts
        </div>
      </div>

      <div className="dashboard-scroll-list space-y-2.5 pr-1">
        {items.map((item) => {
          const tone = getToneClasses(item.tone);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleItemOpen(item)}
              className={`w-full text-left rounded-xl border p-3 transition-all ${
                darkMode ? 'border-gray-700 bg-gray-700/30 hover:bg-gray-700/50' : `${tone.border} bg-white hover:shadow-sm`
              } focus:outline-none focus:ring-2 focus:ring-[#0B3B2E]/30`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} ${tone.icon}`}>
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className={`text-sm font-bold leading-5 ${darkMode ? 'text-white' : 'text-slate-900'}`}>{item.label}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${darkMode ? 'bg-gray-800 text-white' : tone.badge}`}>
                        {loading ? '...' : item.value}
                      </div>
                      <div className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-[0.14em] ${darkMode ? 'text-gray-400' : 'text-[#31694E]'}`}>
                        Open
                        <FaArrowRight className="text-[10px]" />
                      </div>
                    </div>
                  </div>
                  <div className={`mt-1 text-xs ${darkMode ? 'text-gray-400' : 'text-slate-500'}`}>{item.helper}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => priorityItem && handleItemOpen(priorityItem)}
        className={`mt-4 w-full rounded-xl border p-3 text-left transition ${
          darkMode ? 'border-gray-700 bg-gray-700/20 hover:bg-gray-700/35' : 'border-[#dce9e1] bg-white/90 hover:bg-white'
        } ${priorityItem ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className={`text-[10px] font-extrabold uppercase tracking-[0.18em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>
              Focus today
            </div>
            <div className={`mt-1 text-sm font-bold ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
              {priorityItem
                ? `${priorityItem.label} require attention first.`
                : isLandlordMode
                ? 'Collections, vacancies and expense approvals first.'
                : 'Collections and pending posting items first.'}
            </div>
          </div>
          <FaArrowRight className={darkMode ? 'text-gray-500' : 'text-[#31694E]'} />
        </div>
      </button>
    </div>
  );
};

export default QuickActions;
