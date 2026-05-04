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
import { adminRequests } from '../../utils/requestMethods';
import { isSelfManagingLandlordCompany } from '../../utils/companyModules';

const SNAPSHOT_CATEGORIES = new Set(['RENT_CHARGE', 'UTILITY_CHARGE']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const normalizeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rentPayments)) return value.rentPayments;
  return [];
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const getInvoiceRecognitionDate = (invoice) =>
  parseDate(invoice?.bookingDate || invoice?.invoiceDate || invoice?.createdAt);

const FinancialOverview = ({ darkMode }) => {
  const currentCompany = useSelector((state) => state.company?.currentCompany);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);
  const units = useSelector((state) => normalizeArray(state.unit?.units));
  const rawRentPayments = useSelector((state) => state.rentPayment?.rentPayments);
  const rentPayments = useMemo(() => normalizeArray(rawRentPayments), [rawRentPayments]);

  const [invoices, setInvoices] = useState([]);
  const [processedStatements, setProcessedStatements] = useState([]);
  const chartRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);

  const businessId =
    currentCompany?._id ||
    currentUser?.company?._id ||
    (typeof currentUser?.company === 'string' ? currentUser.company : '');

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      if (!businessId) {
        if (active) {
          setInvoices([]);
          setProcessedStatements([]);
        }
        return;
      }

      const [invoiceRes, statementRes] = await Promise.allSettled([
        adminRequests.get(`/tenant-invoices?business=${businessId}&includeSnapshots=true`),
        adminRequests.get(`/processed-statements/business/${businessId}`),
      ]);

      if (!active) return;

      const invoicePayload = invoiceRes.status === 'fulfilled' ? invoiceRes.value?.data : [];
      const statementPayload = statementRes.status === 'fulfilled' ? statementRes.value?.data : [];

      setInvoices(
        Array.isArray(invoicePayload)
          ? invoicePayload
          : Array.isArray(invoicePayload?.invoices)
          ? invoicePayload.invoices
          : Array.isArray(invoicePayload?.data)
          ? invoicePayload.data
          : []
      );

      setProcessedStatements(
        Array.isArray(statementPayload?.statements)
          ? statementPayload.statements
          : Array.isArray(statementPayload)
          ? statementPayload
          : Array.isArray(statementPayload?.data)
          ? statementPayload.data
          : []
      );
    };

    loadData();

    return () => {
      active = false;
    };
  }, [businessId]);

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

  const chartData = useMemo(() => {
    let expected = 0;
    let collected = 0;

    invoices.forEach((invoice) => {
      if (!isActiveInvoice(invoice) || !isSnapshotInvoice(invoice)) return;
      const date = getInvoiceRecognitionDate(invoice);
      if (!date || date.getFullYear() !== currentYear || date.getMonth() !== currentMonthIndex) return;
      expected += amountFromInvoice(invoice);
    });

    rentPayments.forEach((payment) => {
      const date = parseDate(payment?.paymentDate || payment?.createdAt);
      if (!date || date.getFullYear() !== currentYear || date.getMonth() !== currentMonthIndex) return;
      if (payment?.isConfirmed !== true) return;
      if (payment?.isReversed || payment?.isCancelled || payment?.reversalOf) return;
      if (normalizeText(payment?.postingStatus) === 'reversed') return;
      collected += Math.abs(Number(payment?.amount || 0));
    });

    return [
      {
        month: currentMonthLabel,
        label: currentMonthName,
        expected,
        collected,
      },
    ];
  }, [currentMonthIndex, currentMonthLabel, currentMonthName, currentYear, invoices, rentPayments]);

  const currentMonthExpected = chartData.reduce((sum, item) => sum + item.expected, 0);
  const currentMonthCollected = chartData.reduce((sum, item) => sum + item.collected, 0);
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

  const unpostedReceipts = useMemo(
    () =>
      rentPayments.filter(
        (payment) =>
          !payment?.reversalOf &&
          !payment?.isReversed &&
          !payment?.isCancelled &&
          (normalizeText(payment?.postingStatus) === 'unposted' || payment?.isConfirmed !== true)
      ).length,
    [rentPayments]
  );

  const pendingStatements = useMemo(
    () =>
      processedStatements.filter((item) => {
        if (normalizeText(item?.status) === 'reversed') return false;
        return (
          ['processed', 'unpaid', 'part_paid'].includes(normalizeText(item?.status)) ||
          Number(item?.balanceDue || 0) > 0 ||
          Number(item?.recoveryBalance || 0) > 0
        );
      }).length,
    [processedStatements]
  );

  const occupiedUnits = useMemo(
    () => units.filter((unit) => normalizeText(unit?.status) === 'occupied' || unit?.isVacant === false).length,
    [units]
  );

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
              ? `${currentMonthName} billed versus collected, aligned to booking dates and live arrears across your portfolio.`
              : `${currentMonthName} expected versus collected, aligned to booking dates with live arrears across unpaid invoices.`}
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] ${
            darkMode ? 'bg-[#31694E]/20 text-[#8bd1b0]' : 'bg-[#ECF6F1] text-[#1f4a35]'
          }`}
        >
          this month
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

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-700/20' : 'border-[#dce9e1] bg-white/90'}`}>
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>
            Unposted receipts
          </div>
          <div className={`mt-2 text-lg font-extrabold ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>{unpostedReceipts}</div>
        </div>
        <div className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-700/20' : 'border-[#dce9e1] bg-white/90'}`}>
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>
            {isLandlordMode ? 'Occupied units' : 'Pending statements'}
          </div>
          <div className={`mt-2 text-lg font-extrabold ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
            {isLandlordMode ? occupiedUnits : pendingStatements}
          </div>
        </div>
      </div>

      <div ref={chartRef} className="h-[180px] min-h-[180px] min-w-0 w-full">
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
            margin={{ top: 20, right: 12, left: 10, bottom: 0 }}
            barCategoryGap="42%"
            barGap={10}
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
            <Bar
              dataKey="expected"
              name={isLandlordMode ? 'Billed' : 'Expected'}
              fill="#E85C0D"
              radius={[5, 5, 0, 0]}
            >
              <LabelList
                dataKey="expected"
                position="top"
                formatter={formatChartMoney}
                fill={darkMode ? '#f9fafb' : '#334155'}
                fontSize={10}
                fontWeight={800}
              />
            </Bar>
            <Bar
              dataKey="collected"
              name="Collected"
              fill="#31694E"
              radius={[5, 5, 0, 0]}
            >
              <LabelList
                dataKey="collected"
                position="top"
                formatter={formatChartMoney}
                fill={darkMode ? '#f9fafb' : '#334155'}
                fontSize={10}
                fontWeight={800}
              />
            </Bar>
          </BarChart>
        ) : null}
      </div>
    </div>
  );
};

export default FinancialOverview;
