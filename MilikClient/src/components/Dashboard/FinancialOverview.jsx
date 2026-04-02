import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { adminRequests } from '../../utils/requestMethods';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const FinancialOverview = ({ darkMode }) => {
  const currentCompany = useSelector(state => state.company?.currentCompany);
  const currentUser = useSelector(state => state.auth?.currentUser);

  const rawTenants = useSelector(state => state.tenant?.tenants);
  const rawRentPayments = useSelector(state => state.rentPayment?.rentPayments);

  const tenants = Array.isArray(rawTenants)
    ? rawTenants
    : Array.isArray(rawTenants?.data)
      ? rawTenants.data
      : Array.isArray(rawTenants?.tenants)
        ? rawTenants.tenants
        : [];

  const rentPayments = Array.isArray(rawRentPayments)
    ? rawRentPayments
    : Array.isArray(rawRentPayments?.data)
      ? rawRentPayments.data
      : Array.isArray(rawRentPayments?.rentPayments)
        ? rawRentPayments.rentPayments
        : [];

  const [invoices, setInvoices] = useState([]);
  const [processedStatements, setProcessedStatements] = useState([]);

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
        adminRequests.get(`/tenant-invoices?business=${businessId}`),
        adminRequests.get(`/processed-statements/business/${businessId}`),
      ]);

      if (!active) return;

      const invoicePayload =
        invoiceRes.status === 'fulfilled'
          ? invoiceRes.value?.data
          : [];

      const statementPayload =
        statementRes.status === 'fulfilled'
          ? statementRes.value?.data
          : [];

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

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();

  const parseDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const isActiveInvoice = (invoice) => {
    const status = String(invoice?.status || "").toLowerCase();
    return !["cancelled", "reversed"].includes(status);
  };

  const amountFromInvoice = (invoice) =>
    Number(invoice?.adjustedAmount ?? invoice?.netAmount ?? invoice?.amount ?? 0);

  const formatMoney = (value) => {
    if (value >= 1000000) return `KSh ${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `KSh ${(value / 1000).toFixed(1)}K`;
    return `KSh ${Math.round(value).toLocaleString()}`;
  };

  const chartData = useMemo(() => {
    const expectedByMonth = new Array(12).fill(0);
    const collectedByMonth = new Array(12).fill(0);

    invoices.forEach((invoice) => {
      if (!isActiveInvoice(invoice)) return;
      const date = parseDate(invoice?.invoiceDate || invoice?.createdAt);
      if (!date || date.getFullYear() !== currentYear) return;
      expectedByMonth[date.getMonth()] += amountFromInvoice(invoice);
    });

    rentPayments.forEach((payment) => {
      const date = parseDate(payment?.paymentDate || payment?.createdAt);
      if (!date || date.getFullYear() !== currentYear) return;
      if (payment?.isConfirmed !== true) return;
      if (payment?.isReversed || payment?.isCancelled || payment?.reversalOf) return;
      if (String(payment?.postingStatus || "").toLowerCase() === "reversed") return;
      collectedByMonth[date.getMonth()] += Math.abs(Number(payment?.amount || 0));
    });

    return MONTHS.map((month, index) => ({
      month,
      expected: expectedByMonth[index],
      collected: collectedByMonth[index],
    }));
  }, [currentYear, invoices, rentPayments]);

  const currentMonthExpected = chartData[currentMonthIndex]?.expected || 0;
  const currentMonthCollected = chartData[currentMonthIndex]?.collected || 0;
  const outstandingArrears = tenants.reduce(
    (sum, tenant) => sum + Math.max(Number(tenant?.balance || 0), 0),
    0
  );
  const collectionRate =
    currentMonthExpected > 0 ? (currentMonthCollected / currentMonthExpected) * 100 : 0;
  const unpostedReceipts = rentPayments.filter(
    (payment) =>
      payment?.reversalOf !== true &&
      !payment?.reversalOf &&
      payment?.isReversed !== true &&
      payment?.isCancelled !== true &&
      (payment?.postingStatus === 'unposted' || payment?.isConfirmed !== true)
  ).length;
  const pendingStatements = processedStatements.filter((item) =>
    ['processed', 'unpaid', 'part_paid'].includes(item?.status)
  ).length;

  const cards = [
    { label: 'Expected', value: formatMoney(currentMonthExpected) },
    { label: 'Collected', value: formatMoney(currentMonthCollected) },
    { label: 'Arrears', value: formatMoney(outstandingArrears) },
    { label: 'Collection rate', value: `${collectionRate.toFixed(1)}%` },
  ];

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className={`p-3 rounded-lg shadow-lg border text-xs ${darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-[#31694E]/20 text-slate-800'}`}>
        <p className="font-extrabold mb-2 uppercase tracking-wide text-[10px]">{label}</p>
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
    <div className={`dashboard-panel rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-md border ${darkMode ? 'border-gray-700' : 'border-gray-100'} p-4`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className={`text-sm font-extrabold uppercase tracking-tight ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>
            Financial Operations Overview
          </h2>
          <p className={`mt-1 text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Compact collections and workflow money view.
          </p>
        </div>
        <div className={`rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'bg-[#31694E]/20 text-[#8bd1b0]' : 'bg-[#ECF6F1] text-[#1f4a35]'}`}>
          this month
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {cards.map((card) => (
          <div key={card.label} className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-700/30' : 'border-[#dce9e1] bg-[#fbfdfc]'}`}>
            <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>{card.label}</div>
            <div className={`mt-2 text-base font-extrabold ${darkMode ? 'text-white' : 'text-slate-900'}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-700/20' : 'border-[#dce9e1] bg-white/90'}`}>
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>Unposted receipts</div>
          <div className={`mt-2 text-lg font-extrabold ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>{unpostedReceipts}</div>
        </div>
        <div className={`rounded-xl border p-3 ${darkMode ? 'border-gray-700 bg-gray-700/20' : 'border-[#dce9e1] bg-white/90'}`}>
          <div className={`text-[10px] font-extrabold uppercase tracking-[0.16em] ${darkMode ? 'text-gray-400' : 'text-[#4a6b5e]'}`}>Pending statements</div>
          <div className={`mt-2 text-lg font-extrabold ${darkMode ? 'text-white' : 'text-[#1f4a35]'}`}>{pendingStatements}</div>
        </div>
      </div>

      <div className="h-[180px] min-h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="expectedFillCompact" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#E85C0D" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#E85C0D" stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="collectedFillCompact" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#31694E" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#31694E" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} vertical={false} />
            <XAxis dataKey="month" stroke={darkMode ? '#9ca3af' : '#6b7280'} fontSize={10} fontWeight={700} />
            <YAxis stroke={darkMode ? '#9ca3af' : '#6b7280'} fontSize={10} fontWeight={700} width={36} tickFormatter={(value) => `${(value / 1000).toFixed(0)}K`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="expected" name="Expected" stroke="#E85C0D" strokeWidth={2} fill="url(#expectedFillCompact)" />
            <Area type="monotone" dataKey="collected" name="Collected" stroke="#31694E" strokeWidth={2} fill="url(#collectedFillCompact)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default FinancialOverview;