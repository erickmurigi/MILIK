import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  FaArrowRight, FaClipboardList, FaExclamationTriangle,
  FaFileAlt, FaFileInvoiceDollar, FaHome,
  FaMoneyBillWave, FaReceipt, FaTools,
} from 'react-icons/fa';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentUser, selectCurrentCompany, selectAllMaintenances, selectAllExpenseProperties } from '../../redux/selectors';
import { normalizeText, parseDate } from './dashboardUtils';
import DashboardCard from './DashboardCard';

// ─── Tone palette ─────────────────────────────────────────────────────────────
const TONES = {
  orange: { icon: 'text-[#C8511A]', badge: 'bg-orange-50 text-orange-700',   dot: 'bg-orange-400' },
  green:  { icon: 'text-[#0B3B2E]', badge: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-400' },
  blue:   { icon: 'text-blue-700',   badge: 'bg-blue-50 text-blue-700',       dot: 'bg-blue-400' },
  amber:  { icon: 'text-amber-700',  badge: 'bg-amber-50 text-amber-700',     dot: 'bg-amber-400' },
  red:    { icon: 'text-red-700',    badge: 'bg-red-50 text-red-700',         dot: 'bg-red-400' },
  purple: { icon: 'text-purple-700', badge: 'bg-purple-50 text-purple-700',   dot: 'bg-purple-400' },
  slate:  { icon: 'text-slate-600',  badge: 'bg-slate-100 text-slate-700',    dot: 'bg-slate-400' },
};

// ─── Component ────────────────────────────────────────────────────────────────
const QuickActions = ({ summaryData = {}, loading = false }) => {
  const navigate       = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser    = useSelector(selectCurrentUser);
  const maintenances   = useSelector(selectAllMaintenances);
  const expenseProps   = useSelector(selectAllExpenseProperties);

  const ctx        = currentCompany || currentUser?.company || null;
  const isLandlord = isSelfManagingLandlordCompany(ctx);
  const canInv     = hasCompanyPermission(currentUser || {}, currentCompany, 'tenantInvoices',     'view', 'propertyManagement');
  const canRec     = hasCompanyPermission(currentUser || {}, currentCompany, 'receipts',            'view', 'propertyManagement');
  const canVou     = hasCompanyPermission(currentUser || {}, currentCompany, 'paymentVouchers',     'view', 'accounts');
  const canStm     = hasCompanyPermission(currentUser || {}, currentCompany, 'processedStatements', 'view', 'accounts');

  const pendingMaintenance = useMemo(
    () => maintenances.filter((m) => ['pending', 'open', 'in_progress'].includes(normalizeText(m?.status))).length,
    [maintenances],
  );

  const thisMonthExpenseCount = useMemo(() => {
    if (!isLandlord) return 0;
    const now = new Date();
    return expenseProps.filter((e) => {
      const d = parseDate(e?.date || e?.createdAt);
      return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  }, [isLandlord, expenseProps]);

  const vacantUnits        = summaryData?.vacantUnits              ?? 0;
  const overdueInvoices    = summaryData?.overdueInvoiceCount      ?? 0;
  const leasesExpiringSoon = summaryData?.leasesExpiringSoonCount  ?? 0;
  const unpostedReceipts   = summaryData?.unpostedReceiptCount     ?? 0;
  const pendingStatements  = summaryData?.pendingStatementCount    ?? 0;
  const pendingVouchers    = summaryData?.draftVoucherCount        ?? 0;

  const items = useMemo(() => {
    const base = [
      { id: 'vacant',   label: isLandlord ? 'Vacant units (portfolio)' : 'Vacant units',                        value: vacantUnits,       icon: <FaHome />,               tone: 'green',  route: '/vacants',                    tabTitle: 'Availability Status' },
      ...(canInv ? [{   id: 'overdue',  label: 'Overdue invoices',                                               value: overdueInvoices,   icon: <FaFileInvoiceDollar />,  tone: 'orange', route: '/invoices/rental',            tabTitle: 'Rental Invoices' }] : []),
      {                 id: 'leases',   label: isLandlord ? 'Lease renewals due in 30 days' : 'Leases expiring (30 days)', value: leasesExpiringSoon, icon: <FaFileAlt />, tone: 'blue', route: '/tenants',                   tabTitle: 'Tenants' },
      ...(canRec ? [{   id: 'unposted', label: 'Unposted receipts',                                              value: unpostedReceipts,  icon: <FaReceipt />,            tone: 'amber',  route: '/receipts',                   tabTitle: 'Receipts' }] : []),
      {                 id: 'maint',    label: 'Pending maintenance requests',                                    value: pendingMaintenance,icon: <FaTools />,              tone: 'red',    route: '/maintenances',               tabTitle: 'Maintenance' },
      ...(canVou ? [{   id: 'vouchers', label: 'Payment vouchers awaiting approval',                             value: pendingVouchers,   icon: <FaExclamationTriangle />,tone: 'slate',  route: '/financial/payment-vouchers', tabTitle: 'Payment Vouchers' }] : []),
    ];
    if (isLandlord) {
      base.push({ id: 'expenses', label: 'Property expenses logged this month', value: thisMonthExpenseCount, icon: <FaMoneyBillWave />, tone: 'purple', route: '/property-expenses', tabTitle: 'Property Expenses' });
    } else if (canStm) {
      base.push({ id: 'stmts', label: 'Landlord statements pending settlement', value: pendingStatements, icon: <FaClipboardList />, tone: 'purple', route: '/landlord/processed-statements', tabTitle: 'Processed Statements' });
    }
    return base;
  }, [canInv, canRec, canStm, canVou, isLandlord, leasesExpiringSoon, overdueInvoices, pendingMaintenance, pendingStatements, pendingVouchers, thisMonthExpenseCount, unpostedReceipts, vacantUnits]);

  const liveAlerts   = items.filter((i) => Number(i.value || 0) > 0).length;
  const priorityItem = useMemo(
    () => [...items].filter((i) => Number(i.value || 0) > 0).sort((a, b) => Number(b.value) - Number(a.value))[0] || null,
    [items],
  );

  const go = (item) => item?.route && navigate(item.route, { state: { tabTitle: item.tabTitle } });

  return (
    <DashboardCard
      title={isLandlord ? 'Landlord Action Centre' : 'Action Centre'}
      right={<span className="text-[10px] font-bold text-[#0B3B2E]">{liveAlerts} live alert{liveAlerts !== 1 ? 's' : ''}</span>}
    >
      <div className="divide-y divide-slate-100">
        {items.map((item) => {
          const tone  = TONES[item.tone] || TONES.slate;
          const count = Number(item.value || 0);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 focus:outline-none"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${count > 0 ? tone.dot : 'bg-slate-200'}`} />
              <span className={`flex h-6 w-5 shrink-0 items-center justify-center text-sm ${tone.icon}`}>{item.icon}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{item.label}</span>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-black ${count > 0 ? tone.badge : 'bg-slate-50 text-slate-400'}`}>
                {loading ? '…' : item.value}
              </span>
              <FaArrowRight size={9} className="shrink-0 text-slate-300" />
            </button>
          );
        })}
      </div>

      <div className="border-t border-slate-100 bg-[#EDF5F1]/60 px-3 py-2">
        <p className="text-[9px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Focus today</p>
        <p className="mt-0.5 text-[10px] font-semibold text-slate-600">
          {priorityItem
            ? `${priorityItem.label} — ${priorityItem.value} item${Number(priorityItem.value) !== 1 ? 's' : ''} need attention.`
            : 'No urgent items right now.'}
        </p>
      </div>
    </DashboardCard>
  );
};

export default React.memo(QuickActions);
