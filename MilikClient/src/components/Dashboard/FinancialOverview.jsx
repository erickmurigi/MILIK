import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllRentPayments,
} from '../../redux/selectors';

const SNAPSHOT_CATEGORIES = new Set(['RENT_CHARGE', 'UTILITY_CHARGE']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const getInvoiceRecognitionDate = (invoice) =>
  parseDate(invoice?.bookingDate || invoice?.invoiceDate || invoice?.createdAt);

const FinancialOverview = ({ darkMode, invoices = [] }) => {
  const currentCompany  = useSelector(selectCurrentCompany);
  const currentUser     = useSelector(selectCurrentUser);
  const rentPayments    = useSelector(selectAllRentPayments);

  const chartRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    const updateSize = () => {
      const nextWidth = Math.max(0, Math.floor(element.clientWidth || 0));
      const nextHeight = Math.max(0, Math.floor(element.clientHeight || 0));

      setChartSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) return prev;
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateSize();
      });
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();
  const currentMonthName = now.toLocaleString('default', { month: 'long' });
  const currentMonthLabel = MONTHS[currentMonthIndex];

  const isActiveInvoice = (invoice) => !['cancelled', 'reversed'].includes(normalizeText(invoice?.status));
  const isSnapshotInvoice = (invoice) => SNAPSHOT_CATEGORIES.has(String(invoice?.category || '').toUpperCase());
  const amountFromInvoice = (invoice) => Number(invoice?.adjustedAmount ?? invoice?.netAmount ?? invoice?.amount ?? 0);

  const outstandingFromInvoice = (invoice) => {
    const snapshotOutstanding = Number(invoice?.outstanding ?? invoice?.remainingCreditableAmount ?? 0);
    if (snapshotOutstanding > 0) return snapshotOutstanding;

    const status = normalizeText(invoice?.status);
    if (['pending', 'partially_paid', 'part_paid'].includes(status)) {
      return Math.max(0, amountFromInvoice(invoice));
    }

    return 0;
  };

  const formatMoney = (value) => {
    const numeric = Number(value || 0);
    if (numeric >= 1000000) return `KSh ${(numeric / 1000000).toFixed(1)}M`;
    if (numeric >= 1000) return `KSh ${(numeric / 1000).toFixed(1)}K`;
    return `KSh ${Math.round(numeric).toLocaleString()}`;
  };

  const formatChartMoney = (value) => {
    const numeric = Number(value || 0);
    if (numeric >= 1000000) return `KSh ${(numeric / 1000000).toFixed(1)}M`;
    if (numeric >= 1000) return `KSh ${(numeric / 1000).toFixed(1)}K`;
    return `KSh ${Math.round(numeric).toLocaleString()}`;
  };

  const formatChartMoneySkipZero = (value) => (Number(value) > 0 ? formatChartMoney(value) : '');

  const chartData = useMemo(() => {
    // All 12 months of the current year in normal calendar order; future months show 0
    return MONTHS.map((monthLabel, m) => {
      let expected = 0;
      let collected = 0;

      invoices.forEach((invoice) => {
        if (!isActiveInvoice(invoice) || !isSnapshotInvoice(invoice)) return;
        const date = getInvoiceRecognitionDate(invoice);
        if (!date || date.getFullYear() !== currentYear || date.getMonth() !== m) return;
        expected += amountFromInvoice(invoice);
      });

      rentPayments.forEach((payment) => {
        const date = parseDate(payment?.paymentDate || payment?.createdAt);
        if (!date || date.getFullYear() !== currentYear || date.getMonth() !== m) return;
        if (payment?.isConfirmed !== true) return;
        if (payment?.isReversed || payment?.isCancelled || payment?.reversalOf) return;
        if (normalizeText(payment?.postingStatus) === 'reversed') return;
        collected += Math.abs(Number(payment?.amount || 0));
      });

      return {
        month: monthLabel,
        label: new Date(currentYear, m, 1).toLocaleString('default', { month: 'long', year: 'numeric' }),
        expected,
        collected,
      };
    });
  }, [currentYear, invoices, rentPayments]);

  const currentMonthData = chartData[currentMonthIndex] || { expected: 0, collected: 0 };
  const currentMonthExpected = currentMonthData.expected;
  const currentMonthCollected = currentMonthData.collected;
  const remainingToCollect = Math.max(0, currentMonthExpected - currentMonthCollected);

  const outstandingArrears = useMemo(
    () =>
      invoices.reduce((sum, invoice) => {
        if (!isActiveInvoice(invoice)) return sum;
        return sum + Math.max(0, outstandingFromInvoice(invoice));
      }, 0),
    [invoices]
  );

  const collectionRate = currentMonthExpected > 0 ? (currentMonthCollected / currentMonthExpected) * 100 : 0;

  const cards = [
    { label: isLandlordMode ? 'Billed' : 'Expected', value: formatMoney(currentMonthExpected) },
    { label: 'Collected', value: formatMoney(currentMonthCollected) },
    { label: isLandlordMode ? 'Live arrears' : 'Arrears', value: formatMoney(outstandingArrears) },
    { label: 'Collection rate', value: `${collectionRate.toFixed(1)}%` },
  ];

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const displayLabel = payload[0]?.payload?.label || label;

    return (
      <div
        className={`p-3 rounded-lg shadow-lg border text-xs ${
          darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-[#31694E]/20 text-slate-800'
        }`}
      >
        <p className="font-extrabold mb-2 uppercase tracking-wide text-[10px]">{displayLabel}</p>
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
            <span className="font-semibold">{entry.name}</span>
            <span className="font-extrabold">{formatMoney(entry.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      className={`dashboard-panel rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-md border ${
        darkMode ? 'border-gray-700' : 'border-gray-100'
      } p-4`}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className={`text-sm font-extrabold uppercase tracking-tight ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
            {isLandlordMode ? 'Portfolio Cashflow Overview' : 'Financial Operations Overview'}
          </h2>
          <p className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {isLandlordMode
              ? `${currentYear} full-year billed vs collected — current month stats in cards below.`
              : `${currentYear} full-year expected vs collected — current month stats in cards below.`}
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] ${
            darkMode ? 'bg-[#31694E]/20 text-[#8bd1b0]' : 'bg-[#ECF6F1] text-[#1f4a35]'
          }`}
        >
          {currentYear}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-700/30' : 'border-[#dce9e1] bg-[#fbfdfc]'}`}
          >
            <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>
              {card.label}
            </div>
            <div className={`mt-2 text-base font-extrabold ${darkMode ? 'text-white' : 'text-slate-900'}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div ref={chartRef} className="h-[265px] min-h-[265px] min-w-0 w-full">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4 text-[10px] font-extrabold uppercase tracking-[0.14em]">
            <span className={`inline-flex items-center gap-1.5 ${darkMode ? 'text-gray-300' : 'text-[#4a6b5e]'}`}>
              <span className="h-2.5 w-2.5 rounded-sm bg-[#E85C0D]" />
              {isLandlordMode ? 'Billed' : 'Expected'}
            </span>
            <span className={`inline-flex items-center gap-1.5 ${darkMode ? 'text-gray-300' : 'text-[#4a6b5e]'}`}>
              <span className="h-2.5 w-2.5 rounded-sm bg-[#31694E]" />
              Collected
            </span>
          </div>
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.14em] ${darkMode ? 'text-gray-300' : 'text-[#1f4a35]'}`}>
            {formatMoney(remainingToCollect)} remaining
          </div>
        </div>
        {chartSize.width > 0 && chartSize.height > 0 ? (
          <BarChart
            width={chartSize.width}
            height={chartSize.height - 28}
            data={chartData}
            margin={{ top: 20, right: 8, left: 10, bottom: 0 }}
            barCategoryGap="25%"
            barGap={4}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} vertical={false} />
            <XAxis
              dataKey="month"
              stroke={darkMode ? '#9ca3af' : '#6b7280'}
              fontSize={10}
              fontWeight={700}
            />
            <YAxis
              stroke={darkMode ? '#9ca3af' : '#6b7280'}
              fontSize={10}
              fontWeight={700}
              width={48}
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="expected" name={isLandlordMode ? 'Billed' : 'Expected'} fill="#E85C0D" radius={[5, 5, 0, 0]}>
              <LabelList dataKey="expected" position="top" formatter={formatChartMoneySkipZero} fill={darkMode ? '#f9fafb' : '#334155'} fontSize={9} fontWeight={800} />
            </Bar>
            <Bar dataKey="collected" name="Collected" fill="#31694E" radius={[5, 5, 0, 0]}>
              <LabelList dataKey="collected" position="top" formatter={formatChartMoneySkipZero} fill={darkMode ? '#f9fafb' : '#334155'} fontSize={9} fontWeight={800} />
            </Bar>
          </BarChart>
        ) : null}
      </div>
    </div>
  );
};

export default FinancialOverview;
