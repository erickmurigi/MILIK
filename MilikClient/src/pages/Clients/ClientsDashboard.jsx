import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPlus, FaReceipt, FaSyncAlt } from 'react-icons/fa';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import { Kpi, Section, ShareBar, EmptyNote } from '../../components/Clients/clientUi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { money, createListCache, useClientsAccess } from '../../components/Clients/clientHelpers';
import { todayISO } from '../../utils/dates';

const cache = createListCache();
const compact = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return money(n);
};

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'quarter', label: 'Last 3 months' },
  { value: 'ytd', label: 'Year to date' },
];
const periodRange = (p) => {
  const now = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (p === 'last') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p === 'quarter') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: todayISO() };
  if (p === 'ytd') return { from: `${now.getFullYear()}-01-01`, to: todayISO() };
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayISO() };
};

const TopList = ({ rows, valueKey, tone, onOpen, empty }) => {
  const max = Math.max(0, ...rows.map((r) => r[valueKey] || 0));
  if (!rows.length) return <EmptyNote>{empty}</EmptyNote>;
  return (
    <div className="divide-y divide-slate-100">
      {rows.map((r) => (
        <button key={r.clientId} type="button" onClick={() => onOpen(r)} className="block w-full px-3 py-1.5 text-left hover:bg-[#EBF5EF]">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-semibold text-slate-900">{r.clientName || '—'}<span className="ml-1.5 font-normal text-slate-500">{r.clientCode}</span></span>
            <span className="shrink-0 font-bold tabular-nums text-slate-900">{money(r[valueKey])}</span>
          </div>
          <div className="mt-1"><ShareBar value={r[valueKey]} max={max} tone={tone} /></div>
        </button>
      ))}
    </div>
  );
};

const ClientsDashboard = () => {
  const navigate = useNavigate();
  const { businessId, canCreate } = useClientsAccess();
  const [period, setPeriod] = useState('month');
  const range = useMemo(() => periodRange(period), [period]);
  const key = `${businessId}:${range.from}:${range.to}`;
  const [state, setState] = useState(() => cache.peek(key) || { kpis: null, forecast: null });
  const [isFetching, setIsFetching] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!businessId) return;
    const hit = !force && cache.get(key);
    if (hit) { setState(hit); return; }
    setIsFetching(true);
    try {
      const [kpis, forecast] = await Promise.all([
        clientsCollectionsApi.report('dashboard', range).then(unwrap),
        clientsCollectionsApi.report('billing-forecast', { months: 6 }).then(unwrap).catch(() => null),
      ]);
      const next = { kpis, forecast };
      cache.set(key, next);
      setState(next);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load dashboard'));
    } finally {
      setIsFetching(false);
    }
  }, [businessId, key, range]);
  useEffect(() => { load(); }, [load]);

  const k = state.kpis;
  const openClient = useCallback((r) => navigate(`/clients/${r.clientId}`, { state: { tabTitle: r.clientName } }), [navigate]);
  const chartRows = useMemo(
    () => (state.forecast?.months || []).map((m) => ({ name: new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' }), amount: m.amount })),
    [state.forecast],
  );
  const collectionRate = k && k.billed?.total > 0 ? Math.round((k.collected?.total / k.billed.total) * 100) : null;

  return (
    <ClientsShell>
      <ListToolbar>
        <AppSelect compact value={period} onChange={(v) => setPeriod(v || 'month')} options={PERIODS} />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={() => load(true)} disabled={isFetching}>{isFetching ? 'Loading…' : 'Refresh'}</ListToolbar.Button>
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" onClick={() => navigate('/clients/reports/ar-aging')}>AR aging</ListToolbar.Button>
        <ListToolbar.Button variant="outline" onClick={() => navigate('/clients/collections')}>Collections</ListToolbar.Button>
        <ListToolbar.Divider />
        {canCreate && <ListToolbar.Button variant="outline" icon={FaReceipt} onClick={() => navigate('/clients/receipts/new')}>Record Receipt</ListToolbar.Button>}
        {canCreate && <ListToolbar.Button icon={FaPlus} onClick={() => navigate('/clients/new')}>New Client</ListToolbar.Button>}
      </ListToolbar>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-slate-50 p-3">
        {!k ? (
          <div className="py-16 text-center text-sm text-slate-400">{isFetching ? 'Loading dashboard…' : 'No data yet'}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
              <Kpi label="MRR" value={`KES ${compact(k.mrr)}`} sub={`${k.activeContracts} active contract(s)`} />
              <Kpi label="ARR" value={`KES ${compact(k.arr)}`} sub="MRR × 12" />
              <Kpi label="Billed" value={`KES ${compact(k.billed?.total)}`} sub={`${k.billed?.invoices || 0} invoice(s) · net ${compact(k.billed?.netAfterNotes)}`} />
              <Kpi label="Collected" value={`KES ${compact(k.collected?.total)}`} sub={`${collectionRate != null ? `${collectionRate}% of billed · ` : ''}${k.collected?.receipts || 0} receipt(s)`} />
              <Kpi label="Receivables" value={`KES ${compact(k.receivables)}`} sub="All open invoices" onClick={() => navigate('/clients/reports/ar-aging')} />
              <Kpi label="Overdue" value={`KES ${compact(k.overdue?.total)}`} tone={k.overdue?.total > 0 ? 'text-red-600' : 'text-slate-900'} sub={`${k.overdue?.invoices || 0} invoice(s)`} onClick={() => navigate('/clients/collections')} />
              <Kpi label="DSO" value={k.dso != null ? `${k.dso} days` : '—'} sub="Trailing 90 days" />
              <Kpi label="Churn" value={`${k.churn?.rate || 0}%`} sub={`${k.churn?.contracts || 0} lost · KES ${compact(k.churn?.lostMrr)} MRR`} tone={k.churn?.contracts ? 'text-red-600' : 'text-slate-900'} />
            </div>

            <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
              <Section title="Billing forecast — next 6 months" bodyClass="p-2" className="xl:col-span-2">
                {chartRows.length ? (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartRows} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} tickFormatter={compact} width={48} />
                        <Tooltip formatter={(v) => [`KES ${money(v)}`, 'Expected billing']} cursor={{ fill: '#EBF5EF' }} />
                        <Bar dataKey="amount" fill="#0B3B2E" maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <EmptyNote>No active contract schedules</EmptyNote>}
                {state.forecast && <p className="px-1 text-[10px] text-slate-500">Total KES {money(state.forecast.total)} · net of VAT · <button type="button" className="font-bold text-[#0B3B2E] hover:underline" onClick={() => navigate('/clients/reports/billing-forecast')}>12-month view</button></p>}
              </Section>
              <Section title="Renewals due" bodyClass="p-2">
                <div className="grid grid-cols-3 gap-2">
                  {[['30 days', k.renewalsDue?.d30], ['60 days', k.renewalsDue?.d60], ['90 days', k.renewalsDue?.d90]].map(([label, v]) => (
                    <Kpi key={label} label={label} value={v || 0} tone={label === '30 days' && v ? 'text-red-600' : 'text-slate-900'} onClick={() => navigate('/clients/reports/renewals')} />
                  ))}
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-slate-600">Cash collected</span><b className="tabular-nums">{money(k.collected?.cash)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-600">Income tax withheld</span><b className="tabular-nums">{money(k.collected?.whtIncomeTax)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-600">VAT withheld</span><b className="tabular-nums">{money(k.collected?.whtVat)}</b></div>
                  <div className="flex justify-between"><span className="text-slate-600">VAT billed</span><b className="tabular-nums">{money(k.billed?.vat)}</b></div>
                </div>
              </Section>
            </div>

            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              <Section title="Top clients by revenue" bodyClass="p-0">
                <TopList rows={k.topClientsByRevenue || []} valueKey="revenue" onOpen={openClient} empty="No billing in this period" />
              </Section>
              <Section title="Top clients by overdue" bodyClass="p-0">
                <TopList rows={k.topClientsByOverdue || []} valueKey="overdue" tone="bg-red-500" onOpen={openClient} empty="Nothing overdue" />
              </Section>
            </div>
          </>
        )}
      </div>
    </ClientsShell>
  );
};

export default ClientsDashboard;
