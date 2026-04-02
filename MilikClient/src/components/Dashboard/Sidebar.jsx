import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { FaMoneyBillWave, FaTools, FaFileContract, FaUsers, FaCalendarAlt, FaReceipt } from 'react-icons/fa';
import { markAllNotificationsAsRead } from '../../redux/apiCalls';

const RecentActivity = ({ darkMode }) => {
  const dispatch = useDispatch();
  const notifications = useSelector(state => state.notification?.notifications || []);
  const rentPayments = useSelector(state => state.rentPayment?.rentPayments || []);
  const maintenances = useSelector(state => state.maintenance?.maintenances || []);
  const leases = useSelector(state => state.lease?.leases || []);
  const tenants = useSelector(state => state.tenant?.tenants || []);
  const currentUser = useSelector(state => state.auth?.currentUser);

  const [newActivityIds, setNewActivityIds] = useState(new Set());
  const previousIdsRef = useRef(new Set());
  const oneDayMs = 1000 * 60 * 60 * 24;

  const parseDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const formatRelativeTime = (value) => {
    const date = parseDate(value);
    if (!date) return 'just now';

    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  const notificationTypeToActivityType = {
    payment_due: 'payment',
    payment_received: 'payment',
    maintenance_request: 'maintenance',
    tenant_move_in: 'tenant',
    tenant_move_out: 'tenant',
    lease_expiry: 'lease',
    system: 'maintenance'
  };

  const activities = useMemo(() => {
    const now = Date.now();
    const tenantNameById = new Map(
      tenants.map((tenant) => [tenant?._id?.toString(), tenant?.name || 'Tenant'])
    );

    const notificationActivities = notifications.map((item) => ({
      id: `notif-${item._id}`,
      type: notificationTypeToActivityType[item.type] || 'maintenance',
      title: item.title || 'Notification',
      description: item.message || 'System update',
      time: item.createdAt,
      isRead: item.isRead
    }));

    const sortedPayments = [...rentPayments].sort(
      (a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0)
    );

    const receiptActivities = sortedPayments
      .filter((payment) => Boolean(payment?.receiptNumber))
      .slice(0, 4)
      .map((payment) => ({
        id: `receipt-${payment._id}`,
        type: 'receipt',
        title: 'New Receipt Added',
        description: `${payment.receiptNumber ? `${payment.receiptNumber} • ` : ''}KSh ${(Number(payment.amount || 0)).toLocaleString()}${payment.unit?.unitNumber ? ` for Unit ${payment.unit.unitNumber}` : ''}`,
        time: payment.createdAt || payment.paymentDate,
        isRead: true
      }));

    const paymentActivities = sortedPayments
      .filter((payment) => !payment?.receiptNumber)
      .slice(0, 3)
      .map((payment) => ({
      id: `payment-${payment._id}`,
      type: 'payment',
      title: payment.isConfirmed ? 'Rent Payment Confirmed' : 'Rent Payment Received',
      description: `KSh ${(Number(payment.amount || 0)).toLocaleString()} ${payment.unit?.unitNumber ? `for Unit ${payment.unit.unitNumber}` : ''}`.trim(),
      time: payment.paymentDate || payment.createdAt,
      isRead: true
    }));

    const maintenanceActivities = maintenances.slice(0, 2).map((maintenance) => ({
      id: `maintenance-${maintenance._id}`,
      type: 'maintenance',
      title: maintenance.title || 'Maintenance Request',
      description: maintenance.description || 'Maintenance update',
      time: maintenance.createdAt,
      isRead: true
    }));

    const billingScheduleActivities = tenants
      .filter((tenant) => {
        if (!tenant?.moveOutDate) return false;
        const daysToScheduleEnd = Math.ceil((new Date(tenant.moveOutDate).getTime() - now) / oneDayMs);
        return daysToScheduleEnd >= 0 && daysToScheduleEnd <= 30;
      })
      .slice(0, 3)
      .map((tenant) => {
        const daysToScheduleEnd = Math.ceil((new Date(tenant.moveOutDate).getTime() - now) / oneDayMs);
        return {
          id: `billing-schedule-${tenant._id}`,
          type: 'billing',
          title: 'Billing Schedule Expiring Soon',
          description: `${tenant.name || 'Tenant'} billing schedule ends in ${daysToScheduleEnd} day${daysToScheduleEnd === 1 ? '' : 's'} (${new Date(tenant.moveOutDate).toLocaleDateString()})`,
          time: tenant.updatedAt || tenant.createdAt || tenant.moveOutDate,
          isRead: false
        };
      });

    const fixedLeaseExpiryActivities = leases
      .filter(lease => {
        if (!lease?.endDate) return false;
        const endDate = new Date(lease.endDate);
        const daysToExpiry = Math.ceil((endDate.getTime() - now) / oneDayMs);
        const leaseType = lease?.leaseType || lease?.tenant?.leaseType;
        const isFixedLease = leaseType ? leaseType === 'fixed' : true;
        const isActive = !lease?.status || lease.status === 'active';
        return isFixedLease && isActive && daysToExpiry >= 0 && daysToExpiry <= 30;
      })
      .slice(0, 3)
      .map((lease) => ({
        id: `fixed-lease-${lease._id}`,
        type: 'lease',
        title: 'Fixed Lease Expiring Soon',
        description: `${typeof lease.tenant === 'object' ? (lease.tenant?.name || 'Tenant') : (tenantNameById.get(lease?.tenant?.toString()) || 'Tenant')} lease ends on ${new Date(lease.endDate).toLocaleDateString()}`,
        time: lease.updatedAt || lease.createdAt,
        isRead: false
      }));

    const tenantActivities = tenants.slice(0, 2).map((tenant) => ({
      id: `tenant-${tenant._id}`,
      type: 'tenant',
      title: 'New Tenant Added',
      description: `${tenant.name || 'Tenant'} added${tenant.unit?.unitNumber ? ` to Unit ${tenant.unit.unitNumber}` : ''}`,
      time: tenant.createdAt,
      isRead: true
    }));

    return [
      ...notificationActivities,
      ...billingScheduleActivities,
      ...fixedLeaseExpiryActivities,
      ...receiptActivities,
      ...paymentActivities,
      ...maintenanceActivities,
      ...tenantActivities
    ]
      .filter(item => item.time)
      .sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [notifications, rentPayments, maintenances, leases, tenants]);

  // Show all items; height constraint displays 2, scroll reveals rest
  const displayedActivities = activities;

  useEffect(() => {
    const currentIds = new Set(activities.map(item => item.id));

    if (previousIdsRef.current.size > 0) {
      const newIds = [...currentIds].filter(id => !previousIdsRef.current.has(id));

      if (newIds.length) {
        setNewActivityIds(prev => {
          const next = new Set(prev);
          newIds.forEach(id => next.add(id));
          return next;
        });

        const timeout = setTimeout(() => {
          setNewActivityIds(prev => {
            const next = new Set(prev);
            newIds.forEach(id => next.delete(id));
            return next;
          });
        }, 6000);

        return () => clearTimeout(timeout);
      }
    }

    previousIdsRef.current = currentIds;
    return undefined;
  }, [activities]);

  useEffect(() => {
    previousIdsRef.current = new Set(activities.map(item => item.id));
  }, [activities.length]);

  const markAllAsRead = async () => {
    const recipient = currentUser?.landlordId || currentUser?._id;
    if (!recipient) return;
    await markAllNotificationsAsRead(dispatch, recipient);
  };

  const getIcon = (type) => {
    const colorClass = type === 'payment' || type === 'tenant' ? 'text-[#31694E]' : 'text-[#E85C0D]';
    const bgClass = type === 'payment' || type === 'tenant' ? 'bg-[#31694E]/10' : 'bg-[#E85C0D]/10';

    const icons = {
      payment: <FaMoneyBillWave className={colorClass} />,
      receipt: <FaReceipt className={colorClass} />,
      maintenance: <FaTools className={colorClass} />,
      lease: <FaFileContract className={colorClass} />,
      tenant: <FaUsers className={colorClass} />,
      billing: <FaCalendarAlt className={colorClass} />
    };

    return (
      <div className={`p-2.5 rounded-lg ${bgClass}`}>
        {icons[type] || <FaTools className={colorClass} />}
      </div>
    );
  };

  const getBorderClass = (type) => {
    return type === 'payment' || type === 'tenant' || type === 'receipt' ? 'border-[#31694E]' : 'border-[#E85C0D]';
  };

  return (
    <div className={`rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-md border ${darkMode ? 'border-gray-700' : 'border-gray-100'} p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-sm font-extrabold uppercase tracking-tight ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>Recent Activity</h2>
        <button
          onClick={markAllAsRead}
          className="text-xs font-bold text-[#31694E] hover:text-[#E85C0D] transition-colors uppercase tracking-wide"
        >
          Mark All Read
        </button>
      </div>

      <div className={`max-h-[32rem] overflow-y-auto space-y-3 scrollbar-thin ${darkMode ? 'scrollbar-thumb-gray-600 scrollbar-track-gray-700' : 'scrollbar-thumb-gray-300 scrollbar-track-gray-50'}`}>
        {displayedActivities.length === 0 ? (
          <div className={`p-4 rounded-lg text-xs font-semibold ${darkMode ? 'bg-gray-700/40 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
            No activity yet. New events will appear here in real time.
          </div>
        ) : (
          displayedActivities.map((activity) => {
            const isNew = newActivityIds.has(activity.id);

            return (
              <div
                key={activity.id}
                className={`p-3.5 rounded-xl border-l-4 ${getBorderClass(activity.type)} ${
                  darkMode ? 'bg-gray-700/30' : 'bg-gray-50/80'
                } ${
                  isNew ? 'ring-2 ring-[#E85C0D]/40 shadow-md animate-pulse' : 'hover:shadow-sm'
                } transition-all cursor-pointer`}
              >
                <div className="flex items-start space-x-3">
                  {getIcon(activity.type)}
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-bold text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {activity.title}
                    </h4>
                    <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'} mt-0.5 leading-relaxed`}>
                      {activity.description}
                    </p>
                    <div className="flex items-center justify-between mt-1.5">
                      <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'} font-medium`}>
                        {formatRelativeTime(activity.time)}
                      </p>
                      {!activity.isRead && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#E85C0D]/15 text-[#E85C0D] font-bold uppercase tracking-wide">
                          New
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {activities.length > 2 && (
        <div className={`mt-3 text-[11px] font-semibold ${darkMode ? 'text-gray-400' : 'text-gray-500'} text-center`}>
          Scroll to see more • Auto-refresh every 30 seconds
        </div>
      )}
      {activities.length <= 2 && (
        <div className={`mt-3 text-[11px] font-semibold ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Auto-refresh every 30 seconds
        </div>
      )}
    </div>
  );
};

export default RecentActivity;
