import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  FaBuilding, FaHome, FaChartPie, FaMoneyBillWave,
  FaReceipt, FaChartLine, FaHandHoldingUsd,
} from 'react-icons/fa';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import { hasCompanyPermission } from '../../utils/permissions';
import {
  selectCurrentUser, selectCurrentCompany,
  selectAllProperties, selectAllUnits,
  selectAllRentPayments, selectAllExpenseProperties,
} from '../../redux/selectors';
import { fmtKES, parseDate } from './dashboardUtils';

const TONES = {
  green:  'bg-[#0B3B2E] border-[#0B3B2E]',
  orange: 'bg-[#C8511A] border-[#C8511A]',
  slate:  'bg-slate-700  border-slate-700',
  red:    'bg-red-700    border-red-700',
};

const MetricCard = ({ label, value, icon: Icon, tone = 'green' }) => (
  <div className={`relative overflow-hidden border ${TONES[tone] || TONES.green} px-4 py-3 shadow-sm`}>
    {Icon && <Icon className="absolute right-3 top-2.5 h-10 w-10 text-white/10" />}
    <p className="text-[9px] font-extrabold uppercase tracking-widest text-white/60">{label}</p>
    <p className="mt-1.5 text-2xl font-black leading-none text-white">{value}</p>
  </div>
);

const MetricsGrid = ({ summaryData = {}, loading = false }) => {
  const properties        = useSelector(selectAllProperties);
  const units             = useSelector(selectAllUnits);
  const rentPayments      = useSelector(selectAllRentPayments);
  const expenseProperties = useSelector(selectAllExpenseProperties);
  const currentCompany    = useSelector(selectCurrentCompany);
  const currentUser       = useSelector(selectCurrentUser);

  const ctx           = currentCompany || currentUser?.company || null;
  const isLandlord    = isSelfManagingLandlordCompany(ctx);
  const canFinancials = hasCompanyPermission(currentUser || {}, currentCompany, 'financialReports', 'view', ['accounts', 'propertyManagement']);

  const totalProperties = properties.length;

  const { totalUnits, occupiedUnits, occupancyRate } = useMemo(() => {
    const NON_MARKET = new Set(['off_market', 'inactive', 'archived', 'disabled']);
    const OCCUPIED   = new Set(['occupied', 'notice_given', 'reserved']);
    let total = 0, occ = 0;
    for (const u of units) {
      const s = String(u?.status || '').trim().toLowerCase();
      if (NON_MARKET.has(s)) continue;
      total++;
      if (OCCUPIED.has(s)) occ++;
    }
    return { totalUnits: total, occupiedUnits: occ, occupancyRate: total > 0 ? ((occ / total) * 100).toFixed(1) : '0.0' };
  }, [units]);

  const { curMonth, curYear } = useMemo(() => {
    const n = new Date();
    return { curMonth: n.getMonth(), curYear: n.getFullYear() };
  }, []);

  const monthlyCollected = useMemo(() => {
    const serverCollected = Number(summaryData?.collectedThisMonth ?? summaryData?.monthlyRevenue ?? -1);
    if (serverCollected >= 0) return serverCollected;
    return rentPayments
      .filter((p) => {
        const d = parseDate(p?.paymentDate || p?.createdAt);
        return d && d.getMonth() === curMonth && d.getFullYear() === curYear
          && p?.isConfirmed === true && !p?.isCancelled && !p?.isReversed && !p?.reversalOf
          && String(p?.postingStatus || '').toLowerCase() !== 'reversed';
      })
      .reduce((s, p) => s + Math.abs(Number(p?.amount || 0)), 0);
  }, [summaryData, rentPayments, curMonth, curYear]);

  const monthlyExpenses = useMemo(() => {
    if (!isLandlord) return 0;
    return expenseProperties.reduce((s, e) => {
      const d = parseDate(e?.date || e?.createdAt);
      return (d && d.getMonth() === curMonth && d.getFullYear() === curYear)
        ? s + Math.abs(Number(e?.amount || 0)) : s;
    }, 0);
  }, [isLandlord, expenseProperties, curMonth, curYear]);

  const netIncome            = monthlyCollected - monthlyExpenses;
  const totalLandlordPayable = Number(summaryData?.totalLandlordPayable || 0);

  const metrics = useMemo(() => {
    const v = loading ? '…' : null;
    const base = [
      { id: 1, label: isLandlord ? 'My Properties'   : 'Total Properties', value: v ?? totalProperties.toString(), icon: FaBuilding,     tone: 'green'  },
      { id: 2, label: isLandlord ? 'Portfolio Units'  : 'Total Units',      value: v ?? totalUnits.toString(),      icon: FaHome,          tone: 'green'  },
      { id: 3, label: 'Occupancy Rate',                                      value: v ?? `${occupancyRate}%`,        icon: FaChartPie,      tone: 'green'  },
      ...(canFinancials ? [
        { id: 4, label: 'Collected This Month', value: v ?? fmtKES(monthlyCollected), icon: FaMoneyBillWave, tone: 'orange' },
      ] : []),
    ];
    if (isLandlord && canFinancials) {
      base.push(
        { id: 5, label: 'Expenses This Month', value: v ?? fmtKES(monthlyExpenses),      icon: FaReceipt,   tone: 'slate' },
        { id: 6, label: 'Net Income',           value: v ?? fmtKES(Math.abs(netIncome)), icon: FaChartLine, tone: netIncome >= 0 ? 'green' : 'red' },
      );
    }
    if (!isLandlord && canFinancials && totalLandlordPayable > 0) {
      base.push({ id: 7, label: 'Owed to Landlords', value: fmtKES(totalLandlordPayable), icon: FaHandHoldingUsd, tone: 'orange' });
    }
    return base;
  }, [canFinancials, isLandlord, loading, monthlyCollected, monthlyExpenses, netIncome, occupancyRate, totalLandlordPayable, totalProperties, totalUnits]);

  const cols = metrics.length >= 6 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
    : metrics.length === 5          ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
    :                                  'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

  return (
    <div className={`grid gap-1.5 ${cols}`}>
      {metrics.map((m) => <MetricCard key={m.id} {...m} />)}
    </div>
  );
};

export default React.memo(MetricsGrid);
