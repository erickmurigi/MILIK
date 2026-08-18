import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentUser, selectCurrentCompany, selectAllExpenseProperties } from '../../redux/selectors';
import { parseDate, fmtKES, shortKES, fullKES } from './dashboardUtils';
import DashboardCard from './DashboardCard';

const GRN    = '#0B3B2E';
const ORG    = '#C8511A';
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-700">
        {payload[0]?.payload?.label || ''}
      </div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-[10px]">
          <div className="h-2 w-2 shrink-0" style={{ backgroundColor: entry.fill }} />
          <span className="text-slate-500">{entry.name}:</span>
          <span className="font-bold text-slate-900">{fullKES(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

// FinancialOverview no longer needs the invoices prop — all chart data comes from summaryData:
//   summaryData.expectedByMonth  — server-computed 12-month billed array
//   summaryData.collectedByMonth — server-computed 12-month collected array
//   summaryData.outstandingArrears — server-computed total arrears balance
const FinancialOverview = ({ summaryData = {} }) => {
  const currentCompany    = useSelector(selectCurrentCompany);
  const currentUser       = useSelector(selectCurrentUser);
  const expenseProperties = useSelector(selectAllExpenseProperties);

  const ctx           = currentCompany || currentUser?.company || null;
  const isLandlord    = isSelfManagingLandlordCompany(ctx);
  const canFinancials = hasCompanyPermission(currentUser || {}, currentCompany, 'financialReports', 'view', ['accounts', 'propertyManagement']);

  // Use Kenya time (UTC+3) for month/year so they match the server-side aggregation timezone
  const nowKE    = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const curYear  = nowKE.getUTCFullYear();
  const curMonth = nowKE.getUTCMonth(); // 0-indexed, matching expectedByMonth/collectedByMonth

  const expectedByMonth  = Array.isArray(summaryData?.expectedByMonth)  ? summaryData.expectedByMonth  : [];
  const collectedByMonth = Array.isArray(summaryData?.collectedByMonth) ? summaryData.collectedByMonth : [];

  const chartData = useMemo(() => Array.from({ length: 12 }, (_, m) => ({
    month:    MONTHS[m],
    label:    new Date(curYear, m, 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
    expected:  expectedByMonth[m]  || 0,
    collected: collectedByMonth[m] || 0,
  })), [curYear, expectedByMonth, collectedByMonth]);

  const cur              = chartData[curMonth] || { expected: 0, collected: 0 };
  const outstandingTotal = Number(summaryData?.outstandingArrears || 0);

  const curExpenses = useMemo(() => {
    if (!isLandlord) return 0;
    return expenseProperties.reduce((s, e) => {
      const raw = parseDate(e?.date || e?.createdAt);
      if (!raw) return s;
      const dKE = new Date(raw.getTime() + 3 * 60 * 60 * 1000);
      return (dKE.getUTCFullYear() === curYear && dKE.getUTCMonth() === curMonth)
        ? s + Math.abs(Number(e?.amount || 0)) : s;
    }, 0);
  }, [isLandlord, expenseProperties, curYear, curMonth]);

  const { remaining, statRows } = useMemo(() => {
    const rawRate        = cur.expected > 0 ? (cur.collected / cur.expected) * 100 : 0;
    const rate           = Math.min(rawRate, 100);
    const arrearsCleared = Math.max(0, cur.collected - cur.expected);
    const net            = cur.collected - curExpenses;
    const color          = rate >= 80 ? 'text-emerald-700' : rate >= 50 ? 'text-amber-700' : 'text-red-700';
    const rows = isLandlord ? [
      { label: 'Billed',          value: fmtKES(cur.expected) },
      { label: 'Collected',       value: fmtKES(cur.collected) },
      { label: 'Expenses',        value: fmtKES(curExpenses) },
      { label: 'Net Income',      value: fmtKES(net),              cls: net >= 0 ? 'text-emerald-700' : 'text-red-700' },
      { label: 'Outstanding',     value: fmtKES(outstandingTotal), cls: outstandingTotal > 0 ? 'text-amber-700' : 'text-slate-900' },
      { label: 'Collection Rate', value: `${rate.toFixed(1)}%`,    cls: color },
    ] : [
      { label: 'Expected',        value: fmtKES(cur.expected) },
      { label: 'Collected',       value: fmtKES(cur.collected) },
      ...(arrearsCleared > 0 ? [{ label: 'Arrears Cleared', value: fmtKES(arrearsCleared), cls: 'text-emerald-700' }] : []),
      { label: 'Outstanding',     value: fmtKES(outstandingTotal), cls: outstandingTotal > 0 ? 'text-amber-700' : 'text-slate-900' },
      { label: 'Collection Rate', value: `${rate.toFixed(1)}%`,    cls: color },
    ];
    return { remaining: Math.max(0, cur.expected - cur.collected), statRows: rows };
  }, [isLandlord, cur, curExpenses, outstandingTotal]);

  if (!canFinancials) return null;

  return (
    <DashboardCard
      title={isLandlord ? 'Portfolio Cashflow Overview' : 'Financial Operations Overview'}
      right={<span className="text-[10px] font-bold text-[#0B3B2E]">{curYear}</span>}
    >
      {/* Current-month stat rows */}
      <div className="divide-y divide-slate-100 border-b border-slate-200">
        {statRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 px-3 py-2.5">
            <p className="text-xs font-bold text-slate-600">{row.label}</p>
            <p className={`text-right text-sm font-extrabold tabular-nums ${row.cls || 'text-slate-900'}`}>
              {row.value}
            </p>
          </div>
        ))}
      </div>

      {/* Chart section */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2" style={{ backgroundColor: '#F8FAF9' }}>
          <div>
            <p className="text-[10px] font-extrabold text-slate-800">
              {isLandlord ? 'Billed vs Collected' : 'Expected vs Collected'}
            </p>
            <p className="text-[10px] text-slate-400">Jan – Dec {curYear}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold">
            <span className="flex items-center gap-1 text-slate-500">
              <span className="inline-block h-2 w-2" style={{ backgroundColor: ORG }} />
              {isLandlord ? 'Billed' : 'Expected'}
            </span>
            <span className="flex items-center gap-1 text-slate-500">
              <span className="inline-block h-2 w-2" style={{ backgroundColor: GRN }} />
              Collected
            </span>
            {remaining > 0 && (
              <span className="font-extrabold text-[#0B3B2E]">{fmtKES(remaining)} remaining</span>
            )}
          </div>
        </div>
        <div className="px-2 py-3">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barCategoryGap="30%" barGap={3}>
              <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={shortKES} tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={38} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="expected"  name={isLandlord ? 'Billed' : 'Expected'} fill={ORG} radius={0} />
              <Bar dataKey="collected" name="Collected"                           fill={GRN} radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </DashboardCard>
  );
};

export default React.memo(FinancialOverview);
