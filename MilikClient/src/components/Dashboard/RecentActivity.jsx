import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  FaBell, FaCalendarAlt, FaFileContract,
  FaMoneyBillWave, FaReceipt, FaTools, FaUsers,
} from 'react-icons/fa';
import { toast } from 'react-toastify';
import { markAllNotificationsAsRead } from '../../redux/apiCalls';
import {
  selectAllNotifications, selectAllRentPayments, selectAllMaintenances,
  selectAllLeases, selectAllTenants,
} from '../../redux/selectors';
import { parseDate } from './dashboardUtils';
import DashboardCard from './DashboardCard';

const TYPE_META = {
  payment:     { icon: FaMoneyBillWave, border: 'border-l-emerald-500', chip: 'bg-emerald-50 text-emerald-700',  label: 'Payment'     },
  receipt:     { icon: FaReceipt,       border: 'border-l-blue-500',    chip: 'bg-blue-50 text-blue-700',        label: 'Receipt'     },
  maintenance: { icon: FaTools,         border: 'border-l-orange-500',  chip: 'bg-orange-50 text-orange-700',    label: 'Maintenance' },
  lease:       { icon: FaFileContract,  border: 'border-l-violet-500',  chip: 'bg-violet-50 text-violet-700',    label: 'Lease'       },
  tenant:      { icon: FaUsers,         border: 'border-l-teal-500',    chip: 'bg-teal-50 text-teal-700',        label: 'Tenant'      },
  billing:     { icon: FaCalendarAlt,   border: 'border-l-rose-500',    chip: 'bg-rose-50 text-rose-700',        label: 'Billing'     },
  notification:{ icon: FaBell,          border: 'border-l-amber-500',   chip: 'bg-amber-50 text-amber-700',      label: 'Alert'       },
};

const NOTIF_MAP = {
  payment_due: 'notification', payment_received: 'payment', maintenance_request: 'maintenance',
  tenant_move_in: 'tenant', tenant_move_out: 'tenant', lease_expiry: 'lease', system: 'notification',
};

const ensureArr = (v, ...keys) => {
  if (Array.isArray(v)) return v;
  for (const k of keys) if (Array.isArray(v?.[k])) return v[k];
  return [];
};

const fmtRel = (v) => {
  const d = parseDate(v);
  if (!d) return '';
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const dy = Math.floor(h / 24);
  if (dy < 7)  return `${dy}d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

const RecentActivity = () => {
  const dispatch      = useDispatch();
  const notifications = useSelector(selectAllNotifications);
  const rentPayments  = useSelector(selectAllRentPayments);
  const maintenances  = useSelector(selectAllMaintenances);
  const leases        = useSelector(selectAllLeases);
  const tenants       = useSelector(selectAllTenants);

  const [newIds,    setNewIds]    = useState(new Set());
  const [marking,   setMarking]   = useState(false);
  const prevRef = useRef(new Set());
  const ONE_DAY = 86_400_000;

  const activities = useMemo(() => {
    const now        = Date.now();
    const tenantById = new Map(tenants.map((t) => [String(t?._id), t?.name || 'Tenant']));
    const sorted     = [...rentPayments].sort(
      (a, b) => new Date(b.paymentDate || b.createdAt || 0) - new Date(a.paymentDate || a.createdAt || 0)
    );

    return [
      ...notifications.map((n) => ({
        id: `n-${n._id}`, type: NOTIF_MAP[n.type] || 'notification',
        title: n.title || 'Notification', desc: n.message || '', time: n.createdAt, unread: !n.isRead,
      })),
      ...sorted.filter((p) => p?.receiptNumber).slice(0, 5).map((p) => ({
        id: `r-${p._id}`, type: 'receipt', title: 'Receipt Posted',
        desc: `${p.receiptNumber} · KSh ${Number(p.amount || 0).toLocaleString()}${p.unit?.unitNumber ? ` · Unit ${p.unit.unitNumber}` : ''}`,
        time: p.createdAt || p.paymentDate, unread: false,
      })),
      ...sorted.filter((p) => !p?.receiptNumber).slice(0, 3).map((p) => ({
        id: `p-${p._id}`, type: 'payment',
        title: p.isConfirmed ? 'Payment Confirmed' : 'Payment Received',
        desc: `KSh ${Number(p.amount || 0).toLocaleString()}${p.unit?.unitNumber ? ` · Unit ${p.unit.unitNumber}` : ''}`,
        time: p.paymentDate || p.createdAt, unread: false,
      })),
      ...maintenances.slice(0, 3).map((m) => ({
        id: `m-${m._id}`, type: 'maintenance',
        title: m.title || 'Maintenance Request', desc: m.description || '',
        time: m.createdAt, unread: false,
      })),
      ...tenants.reduce((acc, t) => {
        if (!t?.moveOutDate) return acc;
        const days = Math.ceil((new Date(t.moveOutDate) - now) / ONE_DAY);
        if (days >= 0 && days <= 30) acc.push({ t, days });
        return acc;
      }, []).slice(0, 3).map(({ t, days }) => ({
        id: `b-${t._id}`, type: 'billing', title: 'Billing Schedule Expiring',
        desc: `${t.name || 'Tenant'} ends in ${days} day${days !== 1 ? 's' : ''}`,
        time: t.updatedAt || t.moveOutDate, unread: true,
      })),
      ...leases.filter((l) => {
        if (!l?.endDate) return false;
        const days   = Math.ceil((new Date(l.endDate) - now) / ONE_DAY);
        const active = !l.status || l.status === 'active';
        const fixed  = !l.leaseType || l.leaseType === 'fixed';
        return active && fixed && days >= 0 && days <= 30;
      }).slice(0, 3).map((l) => ({
        id: `l-${l._id}`, type: 'lease', title: 'Lease Expiring Soon',
        desc: `${typeof l.tenant === 'object' ? l.tenant?.name : tenantById.get(String(l.tenant)) || 'Tenant'} · ${new Date(l.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`,
        time: l.updatedAt || l.createdAt, unread: true,
      })),
      ...tenants.slice(0, 2).map((t) => ({
        id: `t-${t._id}`, type: 'tenant', title: 'Tenant Added',
        desc: `${t.name || 'Tenant'}${t.unit?.unitNumber ? ` · Unit ${t.unit.unitNumber}` : ''}`,
        time: t.createdAt, unread: false,
      })),
    ].filter((a) => a.time).sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [notifications, rentPayments, maintenances, leases, tenants]);

  useEffect(() => {
    const curr = new Set(activities.map((a) => a.id));
    if (prevRef.current.size > 0) {
      const fresh = [...curr].filter((id) => !prevRef.current.has(id));
      if (fresh.length) {
        setNewIds((prev) => { const n = new Set(prev); fresh.forEach((id) => n.add(id)); return n; });
        const t = setTimeout(() => {
          setNewIds((prev) => { const n = new Set(prev); fresh.forEach((id) => n.delete(id)); return n; });
        }, 6000);
        prevRef.current = curr;
        return () => clearTimeout(t);
      }
    }
    prevRef.current = curr;
  }, [activities]);

  // Count only actual DB notification records — not computed billing/lease activity items
  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  const markAllRead = useCallback(async () => {
    if (marking) return;
    setMarking(true);
    try {
      await markAllNotificationsAsRead(dispatch);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to mark notifications as read');
    } finally {
      setMarking(false);
    }
  }, [dispatch, marking]);

  return (
    <DashboardCard
      title="Recent Activity"
      right={
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-black text-white">
              {unreadCount}
            </span>
          )}
          <button
            type="button"
            onClick={markAllRead}
            disabled={marking}
            className="text-[10px] font-bold uppercase tracking-wide text-[#0B3B2E] transition hover:text-[#C8511A] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {marking ? 'Marking…' : 'Mark all read'}
          </button>
        </div>
      }
    >
      <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
            <FaBell size={18} className="opacity-30" />
            <p className="text-[11px] font-semibold">No activity yet.</p>
          </div>
        ) : (
          activities.map((item) => {
            const meta = TYPE_META[item.type] || TYPE_META.notification;
            const Icon = meta.icon;
            return (
              <div
                key={item.id}
                className={`flex items-start gap-3 border-l-4 px-3 py-2.5 ${meta.border} ${newIds.has(item.id) ? 'bg-amber-50/50' : 'hover:bg-slate-50/70'}`}
              >
                <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded ${meta.chip}`}>
                  <Icon size={11} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${meta.chip}`}>
                          {meta.label}
                        </span>
                        {item.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />}
                      </div>
                      <p className="mt-0.5 text-xs font-bold leading-snug text-slate-900">{item.title}</p>
                      {item.desc && (
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">{item.desc}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[9px] font-semibold text-slate-400">{fmtRel(item.time)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </DashboardCard>
  );
};

export default React.memo(RecentActivity);
