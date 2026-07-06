import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import { hasCompanyPermission } from '../../utils/permissions';
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllRentPayments,
  selectAllExpenseProperties,
} from '../../redux/selectors';

const GRN  = '#31694E';
const ORG  = '#E85C0D';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SNAPSHOT_CATEGORIES = new Set(['RENT_CHARGE', 'UTILITY_CHARGE']);

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const getInvoiceRecognitionDate = (invoice) =>
  parseDate(invoice?.bookingDate || invoice?.invoiceDate || invoice?.createdAt);

// ── Formatters ────────────────────────────────────────────────────────────────
const fullKES = (v) => `KES ${Number(v || 0).toLocaleString('en-KE', { minimumFractionDigits: 0 })}`;

const fmtMoney = (value) => {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `KSh ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `KSh ${(n / 1_000).toFixed(1)}K`;
  return `KSh ${Math.round(n).toLocaleString()}`;
};

const shortKES = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return `${Math.round(n)}`;
};

// ── Tooltip ───────────────────────────────────────────────────────────────────

const ChartTooltip = ({ active, payload, darkMode }) => {
  if (!active || !payload?.length) return null;
  const displayLabel = payload[0]?.payload?.label || payload[0]?.payload?.month || '';
  return (
    <div className={`border px-3 py-2 shadow-lg ${darkMode ? 'border-gray-600 bg-gray-800' : 'border-slate-200 bg-white'}`}>
      <div className={`mb-1.5 text-[10px] font-extrabold uppercase tracking-wide ${darkMode ? 'text-gray-200' : 'text-slate-700'}`}>{displayLabel}</div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-[10px]">
          <div className="h-2 w-2 shrink-0" style={{ backgroundColor: entry.fill || entry.color }} />
          <span className={darkMode ? 'text-gray-400' : 'text-slate-500'}>{entry.name}:</span>
          <span className={`font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>{fullKES(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ── Component ─────────────────────────────────────────────────────────────────
const FinancialOverview = ({ darkMode, invoices = [], summaryData = {} }) => {
  const currentCompany    = useSelector(selectCurrentCompany);
  const currentUser       = useSelector(selectCurrentUser);
  const rentPayments      = useSelector(selectAllRentPayments);
  const expenseProperties = useSelector(selectAllExpenseProperties);

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode    = isSelfManagingLandlordCompany(activeCompanyContext);
  const canViewFinancials = hasCompanyPermission(currentUser || {}, currentCompany, 'financialReports', 'view', ['accounts', 'propertyManagement']);

  const now               = new Date();
  const currentYear       = now.getFullYear();
  const currentMonthIndex = now.getMonth();

  const isActiveInvoice   = (invoice) => !['cancelled', 'reversed'].includes(normalizeText(invoice?.status));
  const isSnapshotInvoice = (invoice) => SNAPSHOT_CATEGORIES.has(String(invoice?.category || '').toUpperCase());
  const amountFromInvoice = (invoice) => Number(invoice?.adjustedAmount ?? invoice?.netAmount ?? invoice?.amount ?? 0);

  const outstandingFromInvoice = (invoice) => {
    const snap = Number(invoice?.outstanding ?? invoice?.remainingCreditableAmount ?? 0);
    if (snap > 0) return snap;
    const status = normalizeText(invoice?.status);
    if (['pending', 'partially_paid', 'part_paid'].includes(status)) return Math.max(0, amountFromInvoice(invoice));
    return 0;
  };

  // Server-computed monthly totals (authoritative); fall back to Redux if not yet available
  const serverByMonth = Array.isArray(summaryData?.collectedByMonth) ? summaryData.collectedByMonth : null;

  // Last 6 months ending with the current month
  const chartData = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const offset = currentMonthIndex - 5 + i;
      const year   = offset < 0 ? currentYear - 1 : currentYear;
      const m      = ((offset % 12) + 12) % 12;

      let expected = 0;
      invoices.forEach((invoice) => {
        if (!isActiveInvoice(invoice) || !isSnapshotInvoice(invoice)) return;
        const date = getInvoiceRecognitionDate(invoice);
        if (!date || date.getFullYear() !== year || date.getMonth() !== m) return;
        expected += amountFromInvoice(invoice);
      });

      let collected = 0;
      if (serverByMonth && year === currentYear) {
        collected = serverByMonth[m] || 0;
      } else {
        rentPayments.forEach((payment) => {
          const date = parseDate(payment?.paymentDate || payment?.createdAt);
          if (!date || date.getFullYear() !== year || date.getMonth() !== m) return;
          if (payment?.isConfirmed !== true) return;
          if (payment?.isReversed || payment?.isCancelled || payment?.reversalOf) return;
          if (normalizeText(payment?.postingStatus) === 'reversed') return;
          collected += Math.abs(Number(payment?.amount || 0));
        });
      }

      return {
        month: MONTHS[m],
        label: new Date(year, m, 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
        expected,
        collected,
      };
    });
  }, [currentYear, currentMonthIndex, invoices, rentPayments, serverByMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentMonthData      = chartData[chartData.length - 1] || { expected: 0, collected: 0 };
  const currentMonthExpected  = currentMonthData.expected;
  const currentMonthCollected = currentMonthData.collected;
  const remainingToCollect    = Math.max(0, currentMonthExpected - currentMonthCollected);

  const outstandingArrears = useMemo(
    () => invoices.reduce((sum, inv) => sum + (isActiveInvoice(inv) ? Math.max(0, outstandingFromInvoice(inv)) : 0), 0),
    [invoices] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const collectionRate = currentMonthExpected > 0 ? (currentMonthCollected / currentMonthExpected) * 100 : 0;

  const currentMonthExpenses = useMemo(() => {
    if (!isLandlordMode) return 0;
    return expenseProperties.reduce((sum, exp) => {
      const d = parseDate(exp?.date || exp?.createdAt);
      if (!d || d.getFullYear() !== currentYear || d.getMonth() !== currentMonthIndex) return sum;
      return sum + Math.abs(Number(exp?.amount || 0));
    }, 0);
  }, [isLandlordMode, expenseProperties, currentYear, currentMonthIndex]);

  const currentMonthNet = currentMonthCollected - currentMonthExpenses;

  const cards = isLandlordMode
    ? [
        { label: 'Billed',          value: fmtMoney(currentMonthExpected) },
        { label: 'Collected',       value: fmtMoney(currentMonthCollected) },
        { label: 'Expenses',        value: fmtMoney(currentMonthExpenses) },
        { label: 'Net income',      value: fmtMoney(currentMonthNet), accent: currentMonthNet >= 0 ? 'green' : 'red' },
        { label: 'Live arrears',    value: fmtMoney(outstandingArrears) },
        { label: 'Collection rate', value: `${collectionRate.toFixed(1)}%` },
      ]
    : [
        { label: 'Expected',        value: fmtMoney(currentMonthExpected) },
        { label: 'Collected',       value: fmtMoney(currentMonthCollected) },
        { label: 'Arrears',         value: fmtMoney(outstandingArrears) },
        { label: 'Collection rate', value: `${collectionRate.toFixed(1)}%` },
      ];

  if (!canViewFinancials) return null;

  return (
    <div
      className={`dashboard-panel rounded-xl shadow-md border p-4 ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'
      }`}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className={`text-sm font-extrabold uppercase tracking-tight ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
            {isLandlordMode ? 'Portfolio Cashflow Overview' : 'Financial Operations Overview'}
          </h2>
          <p className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {currentYear} full-year expected vs collected — current month stats in cards below.
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
          darkMode ? 'bg-[#31694E]/20 text-[#8bd1b0]' : 'bg-[#ECF6F1] text-[#1f4a35]'
        }`}>
          {currentYear}
        </div>
      </div>

      {/* Metric cards */}
      <div className={`mb-4 grid gap-3 ${isLandlordMode ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {cards.map((card) => {
          const accentGreen = card.accent === 'green';
          const accentRed   = card.accent === 'red';
          return (
            <div
              key={card.label}
              className={`rounded-xl border p-3 ${
                accentGreen ? 'border-emerald-200 bg-emerald-50/60'
                : accentRed ? 'border-red-200 bg-red-50/60'
                : darkMode  ? 'border-gray-700 bg-gray-700/30'
                            : 'border-[#dce9e1] bg-[#fbfdfc]'
              }`}
            >
              <div className={`text-[10px] font-extrabold uppercase tracking-wide ${
                accentGreen ? 'text-emerald-700' : accentRed ? 'text-red-700' : darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'
              }`}>{card.label}</div>
              <div className={`mt-2 text-base font-extrabold ${
                accentGreen ? 'text-emerald-800' : accentRed ? 'text-red-800' : darkMode ? 'text-white' : 'text-slate-900'
              }`}>{card.value}</div>
            </div>
          );
        })}
      </div>

      {/* Chart — same implementation as AccountsDashboard */}
      <div
        className={`flex flex-col border border-slate-200 ${darkMode ? 'border-gray-700' : ''}`}
        style={{ borderLeftWidth: '3px', borderLeftColor: GRN }}
      >
        {/* Chart header */}
        <div className={`flex items-center justify-between border-b px-4 py-2.5 ${
          darkMode ? 'border-gray-700 bg-gray-700/30' : 'border-slate-100 bg-white'
        }`}>
          <div>
            <div className={`text-[11px] font-extrabold ${darkMode ? 'text-white' : 'text-slate-800'}`}>
              {isLandlordMode ? 'Billed vs Collected' : 'Expected vs Collected'}
            </div>
            <div className="text-[10px] text-slate-400">Last 6 months</div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[10px] font-bold">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="inline-block h-2 w-2" style={{ backgroundColor: ORG }} />
              {isLandlordMode ? 'Billed' : 'Expected'}
            </span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="inline-block h-2 w-2" style={{ backgroundColor: GRN }} />
              Collected
            </span>
            {remainingToCollect > 0 && (
              <span className={`font-extrabold ${darkMode ? 'text-gray-300' : 'text-[#1f4a35]'}`}>
                {fmtMoney(remainingToCollect)} remaining
              </span>
            )}
          </div>
        </div>

        {/* Chart body */}
        <div className={`px-2 py-3 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barCategoryGap="30%" barGap={3}>
              <CartesianGrid strokeDasharray="2 2" stroke={darkMode ? '#374151' : '#f1f5f9'} vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 9, fill: darkMode ? '#9ca3af' : '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={shortKES}
                tick={{ fontSize: 9, fill: darkMode ? '#9ca3af' : '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                width={38}
              />
              <Tooltip content={<ChartTooltip darkMode={darkMode} />} cursor={{ fill: darkMode ? '#374151' : '#f8fafc' }} />
              <Bar dataKey="expected"  name={isLandlordMode ? 'Billed' : 'Expected'} fill={ORG} radius={0} />
              <Bar dataKey="collected" name="Collected"                               fill={GRN} radius={0} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default FinancialOverview;
