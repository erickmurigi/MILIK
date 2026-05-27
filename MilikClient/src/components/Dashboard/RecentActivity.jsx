import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  FaMoneyBillWave,
  FaTools,
  FaFileContract,
  FaUsers,
  FaCalendarAlt,
  FaReceipt,
  FaBell,
} from 'react-icons/fa';
import { markAllNotificationsAsRead } from '../../redux/apiCalls';

const TYPE_META = {
  payment:     { icon: FaMoneyBillWave, bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-l-emerald-500', label: 'Payment',     chip: 'bg-emerald-100 text-emerald-700' },
  receipt:     { icon: FaReceipt,       bg: 'bg-blue-100',    text: 'text-blue-700',    border: 'border-l-blue-500',    label: 'Receipt',     chip: 'bg-blue-100 text-blue-700' },
  maintenance: { icon: FaTools,         bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border-l-orange-500',  label: 'Maintenance', chip: 'bg-orange-100 text-orange-700' },
  lease:       { icon: FaFileContract,  bg: 'bg-violet-100',  text: 'text-violet-700',  border: 'border-l-violet-500',  label: 'Lease',       chip: 'bg-violet-100 text-violet-700' },
  tenant:      { icon: FaUsers,         bg: 'bg-teal-100',    text: 'text-teal-700',    border: 'border-l-teal-500',    label: 'Tenant',      chip: 'bg-teal-100 text-teal-700' },
  billing:     { icon: FaCalendarAlt,   bg: 'bg-rose-100',    text: 'text-rose-700',    border: 'border-l-rose-500',    label: 'Billing',     chip: 'bg-rose-100 text-rose-700' },
  notification:{ icon: FaBell,          bg: 'bg-amber-100',   text: 'text-amber-700',   border: 'border-l-amber-500',   label: 'Alert',       chip: 'bg-amber-100 text-amber-700' },
};

const ensureArray = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};

const parseDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmtRelative = (value) => {
  const date = parseDate(value);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const NOTIF_TYPE_MAP = {
  payment_due: 'notification', payment_received: 'payment',
  maintenance_request: 'maintenance', tenant_move_in: 'tenant',
  tenant_move_out: 'tenant', lease_expiry: 'lease', system: 'notification',
};

const RecentActivity = ({ darkMode }) => {
  const dispatch = useDispatch();
  const rawNotifications = useSelector(s => s.notification?.notifications);
  const rawRentPayments  = useSelector(s => s.rentPayment?.rentPayments);
  const rawMaintenances  = useSelector(s => s.maintenance?.maintenances);
  const rawLeases        = useSelector(s => s.lease?.leases);
  const rawTenants       = useSelector(s => s.tenant?.tenants);
  const currentUser      = useSelector(s => s.auth?.currentUser);

  const notifications = ensureArray(rawNotifications, 'data', 'notifications');
  const rentPayments  = ensureArray(rawRentPayments, 'data', 'rentPayments');
  const maintenances  = ensureArray(rawMaintenances, 'data', 'maintenances');
  const leases        = ensureArray(rawLeases, 'data', 'leases');
  const tenants       = ensureArray(rawTenants, 'data', 'tenants');

  const [newIds, setNewIds] = useState(new Set());
  const prevIdsRef = useRef(new Set());
  const ONE_DAY = 86400000;

  const activities = useMemo(() => {
    const now = Date.now();
    const tenantById = new Map(tenants.map(t => [String(t?._id), t?.name || 'Tenant']));

    const notifItems = notifications.map(n => ({
      id: `notif-${n._id}`, type: NOTIF_TYPE_MAP[n.type] || 'notification',
      title: n.title || 'Notification', desc: n.message || 'System update',
      time: n.createdAt, unread: !n.isRead,
    }));

    const sorted = [...rentPayments].sort(
      (a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0)
    );

    const receiptItems = sorted.filter(p => p?.receiptNumber).slice(0, 5).map(p => ({
      id: `receipt-${p._id}`, type: 'receipt',
      title: 'Receipt Posted',
      desc: `${p.receiptNumber} · KSh ${Number(p.amount || 0).toLocaleString()}${p.unit?.unitNumber ? ` · Unit ${p.unit.unitNumber}` : ''}`,
      time: p.createdAt || p.paymentDate, unread: false,
    }));

    const paymentItems = sorted.filter(p => !p?.receiptNumber).slice(0, 3).map(p => ({
      id: `payment-${p._id}`, type: 'payment',
      title: p.isConfirmed ? 'Payment Confirmed' : 'Payment Received',
      desc: `KSh ${Number(p.amount || 0).toLocaleString()}${p.unit?.unitNumber ? ` · Unit ${p.unit.unitNumber}` : ''}`,
      time: p.paymentDate || p.createdAt, unread: false,
    }));

    const maintItems = maintenances.slice(0, 3).map(m => ({
      id: `maint-${m._id}`, type: 'maintenance',
      title: m.title || 'Maintenance Request',
      desc: m.description || '',
      time: m.createdAt, unread: false,
    }));

    const billingItems = tenants
      .reduce((acc, t) => {
        if (!t?.moveOutDate) return acc;
        const days = Math.ceil((new Date(t.moveOutDate) - now) / ONE_DAY);
        if (days >= 0 && days <= 30) acc.push({ t, days });
        return acc;
      }, [])
      .slice(0, 3)
      .map(({ t, days }) => ({
        id: `billing-${t._id}`, type: 'billing',
        title: 'Billing Schedule Expiring',
        desc: `${t.name || 'Tenant'} ends in ${days} day${days !== 1 ? 's' : ''}`,
        time: t.updatedAt || t.moveOutDate, unread: true,
      }));

    const leaseItems = leases
      .filter(l => {
        if (!l?.endDate) return false;
        const days = Math.ceil((new Date(l.endDate) - now) / ONE_DAY);
        const active = !l.status || l.status === 'active';
        const fixed = !l.leaseType || l.leaseType === 'fixed';
        return active && fixed && days >= 0 && days <= 30;
      }).slice(0, 3).map(l => ({
        id: `lease-${l._id}`, type: 'lease',
        title: 'Lease Expiring Soon',
        desc: `${typeof l.tenant === 'object' ? l.tenant?.name : tenantById.get(String(l.tenant)) || 'Tenant'} · ${new Date(l.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
        time: l.updatedAt || l.createdAt, unread: true,
      }));

    const tenantItems = tenants.slice(0, 2).map(t => ({
      id: `tenant-${t._id}`, type: 'tenant',
      title: 'Tenant Added',
      desc: `${t.name || 'Tenant'}${t.unit?.unitNumber ? ` · Unit ${t.unit.unitNumber}` : ''}`,
      time: t.createdAt, unread: false,
    }));

    return [
      ...notifItems, ...billingItems, ...leaseItems,
      ...receiptItems, ...paymentItems, ...maintItems, ...tenantItems,
    ].filter(a => a.time).sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [notifications, rentPayments, maintenances, leases, tenants]);

  useEffect(() => {
    const currentIds = new Set(activities.map(a => a.id));
    if (prevIdsRef.current.size > 0) {
      const freshIds = [...currentIds].filter(id => !prevIdsRef.current.has(id));
      if (freshIds.length) {
        setNewIds(prev => { const next = new Set(prev); freshIds.forEach(id => next.add(id)); return next; });
        const t = setTimeout(() => {
          setNewIds(prev => { const next = new Set(prev); freshIds.forEach(id => next.delete(id)); return next; });
        }, 6000);
        prevIdsRef.current = currentIds;
        return () => clearTimeout(t);
      }
    }
    prevIdsRef.current = currentIds;
  }, [activities]);

  const unreadCount = useMemo(() => activities.filter(a => a.unread).length, [activities]);

  const markAllRead = async () => {
    const recipient = currentUser?.landlordId || currentUser?._id;
    if (recipient) await markAllNotificationsAsRead(dispatch, recipient);
  };

  return (
    <div className={`rounded-xl shadow-md border p-4 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <h2 className={`text-sm font-extrabold uppercase tracking-tight ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
            Recent Activity
          </h2>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-black text-white min-w-[18px]">
              {unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={markAllRead}
          className={`text-[10px] font-bold uppercase tracking-wide transition ${darkMode ? 'text-emerald-400 hover:text-emerald-300' : 'text-[#31694E] hover:text-[#E85C0D]'}`}
        >
          Mark all read
        </button>
      </div>

      {/* Activity list */}
      <div className="max-h-[22rem] overflow-y-auto space-y-2 pr-0.5">
        {activities.length === 0 ? (
          <div className={`flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 ${darkMode ? 'border-white/10 text-white/40' : 'border-slate-200 text-slate-400'}`}>
            <FaBell size={20} className="opacity-30" />
            <p className="text-xs font-semibold">No activity yet. New events appear here in real time.</p>
          </div>
        ) : (
          activities.map((item) => {
            const meta = TYPE_META[item.type] || TYPE_META.notification;
            const Icon = meta.icon;
            const isNew = newIds.has(item.id);

            return (
              <div
                key={item.id}
                className={[
                  'flex items-start gap-3 rounded-xl border-l-4 px-3 py-2.5 transition-all',
                  meta.border,
                  darkMode ? 'bg-white/5' : 'bg-slate-50/80',
                  isNew ? 'ring-2 ring-amber-400/40 shadow-sm' : 'hover:shadow-sm',
                ].join(' ')}
              >
                {/* Icon */}
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.bg} ${meta.text}`}>
                  <Icon size={12} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${meta.chip}`}>
                          {meta.label}
                        </span>
                        {item.unread && (
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" title="Unread" />
                        )}
                      </div>
                      <p className={`mt-0.5 text-xs font-bold leading-snug ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                        {item.title}
                      </p>
                      {item.desc && (
                        <p className={`mt-0.5 text-[10px] leading-snug line-clamp-2 ${darkMode ? 'text-white/60' : 'text-slate-500'}`}>
                          {item.desc}
                        </p>
                      )}
                    </div>
                    <span className={`shrink-0 text-[9px] font-semibold ${darkMode ? 'text-white/40' : 'text-slate-400'}`}>
                      {fmtRelative(item.time)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RecentActivity;
