// Revenue recognition: preview/run the monthly release of deferred revenue (2165 → income),
// and the deferred-revenue reports (balance, 12-month waterfall, billed vs recognised).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaEye, FaPlay } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import MilikTable from '../../components/common/MilikTable';
import Modal from '../../components/common/Modal';
import RevenueScheduleTable from '../../components/Clients/Billing/RevenueScheduleTable';
import { Chip, EmptyNote, TabStrip, cell, cellLast, numCell, footerBtn, footerPrimary } from '../../components/Clients/Billing/BillingUi';
import { fmtMonth, money, monthIso, useBillingClients } from '../../components/Clients/Billing/billingShared';
import { revenueApi, apiError } from '../../services/clientsBillingApi';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';

const TABS = [
  { key: 'run', label: 'Recognition run' },
  { key: 'balance', label: 'Deferred balance' },
  { key: 'waterfall', label: 'Waterfall (12 months)' },
  { key: 'billed', label: 'Billed vs recognised' },
  { key: 'schedules', label: 'All schedules' },
];
const monthCls = 'h-[22px] w-[118px] shrink-0 border border-slate-200 bg-white px-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

const Bar = ({ value, max, tone = 'bg-[#0B3B2E]' }) => (
  <div className="h-2 w-full bg-slate-100"><div className={`h-2 ${tone}`} style={{ width: `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%` }} /></div>
);

const RunTab = ({ canRun }) => {
  const company = useSelector(selectCurrentCompany);
  const { clients } = useBillingClients(company?._id || '');
  const clientMap = useMemo(() => new Map(clients.map((c) => [String(c._id), c.name])), [clients]);
  const [throughMonth, setThroughMonth] = useState(monthIso(-1));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);

  const load = async () => {
    setBusy('preview');
    setResult(null);
    try {
      const res = await revenueApi.preview({ throughMonth });
      setPreview(res.data?.data || res.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not build the recognition preview'));
    } finally {
      setBusy('');
    }
  };
  const run = async () => {
    setBusy('run');
    try {
      const res = await revenueApi.run({ throughMonth });
      const data = res.data?.data || res.data;
      setResult(data);
      setPreview(null);
      setConfirming(false);
      toast.success(`Recognised ${data.recognized} month(s) · KES ${money(data.total)}`);
    } catch (err) {
      toast.error(apiError(err, 'Recognition run failed'));
    } finally {
      setBusy('');
    }
  };

  const items = (preview?.items || []).map((i) => ({ ...i, _key: `${i.scheduleId}-${i.entryId}` }));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar>
        <span className="shrink-0 text-[10px] font-bold text-slate-600">Recognise through</span>
        <input type="month" className={monthCls} value={throughMonth} onChange={(e) => { setThroughMonth(e.target.value); setPreview(null); }} />
        <ListToolbar.Divider />
        <ListToolbar.Button variant="accent" icon={FaEye} onClick={load} disabled={Boolean(busy)}>{busy === 'preview' ? 'Loading…' : 'Preview'}</ListToolbar.Button>
        {preview && (
          <>
            <ListToolbar.Divider />
            <Chip>Entries: {preview.count}</Chip>
            <Chip>To recognise: KES {money(preview.total)}</Chip>
          </>
        )}
        {canRun && (
          <>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlay} onClick={() => setConfirming(true)} disabled={!preview?.count || Boolean(busy)}>Run recognition</ListToolbar.Button>
          </>
        )}
      </ListToolbar>
      {result && (
        <div className="flex-none border-b border-slate-200 bg-white px-3 py-1.5 text-xs">
          <b>{result.recognized}</b> month(s) recognised through {fmtMonth(result.throughMonth)} · <b className="tabular-nums">KES {money(result.total)}</b> released from deferred revenue to income.
          {(result.failures || []).length > 0 && (
            <ul className="mt-1 text-red-700">{result.failures.map((f) => <li key={`${f.scheduleId}-${f.month}`}>{f.invoiceNumber} {fmtMonth(f.month)}: {f.message}</li>)}</ul>
          )}
        </div>
      )}
      <MilikTable
        columns={[
          { label: 'Month', width: '10%' },
          { label: 'Invoice', width: '13%' },
          { label: 'Client', width: '24%' },
          { label: 'Line', width: '35%' },
          { label: 'Amount', align: 'right', width: '13%' },
        ]}
        rows={items}
        rowKey="_key"
        groupBy={(i) => fmtMonth(i.month)}
        loading={busy === 'preview' && items.length === 0}
        empty={preview ? `Nothing pending through ${fmtMonth(throughMonth)}.` : 'Pick the month and Preview to see what will be released.'}
        tableFixed
        minWidth={760}
        renderRow={(i) => (
          <>
            <td className={`${cell} text-slate-700`}>{fmtMonth(i.month)}</td>
            <td className={`${cell} font-bold text-[#0B3B2E]`}>{i.invoiceNumber}</td>
            <td className={cell}><span className="block truncate font-semibold text-slate-900">{i.client?.name || clientMap.get(String(i.client)) || '—'}</span></td>
            <td className={cell}><span className="block truncate text-slate-700">{i.description}</span></td>
            <td className={`${numCell} border-r-0 font-bold text-slate-900`}>{money(i.amount)}</td>
          </>
        )}
      />
      {confirming && (
        <Modal title={`Recognise through ${fmtMonth(throughMonth)}`} size="sm" onClose={busy ? () => {} : () => setConfirming(false)} footer={(
          <>
            <button type="button" className={footerBtn} onClick={() => setConfirming(false)} disabled={Boolean(busy)}>Cancel</button>
            <button type="button" className={footerPrimary} onClick={run} disabled={Boolean(busy)}>{busy === 'run' ? 'Posting…' : 'Post recognition'}</button>
          </>
        )}>
          <p className="text-xs text-slate-700">Posts <b>{preview?.count}</b> journal(s) releasing <b className="tabular-nums">KES {money(preview?.total)}</b> from Deferred Revenue (2165) to income. Each month is recognised once — re-running is safe.</p>
        </Modal>
      )}
    </div>
  );
};

const BalanceTab = () => {
  const navigate = useNavigate();
  const [groupBy, setGroupBy] = useState('client');
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    revenueApi.deferredBalance({ groupBy })
      .then((res) => { if (alive) setData(res.data?.data || res.data); })
      .catch((err) => toast.error(apiError(err, 'Could not load the deferred balance')));
    return () => { alive = false; };
  }, [groupBy]);
  const rows = (data?.groupBy === groupBy ? data.rows : null) || [];
  const max = rows.reduce((m, r) => Math.max(m, r.deferred), 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar>
        {['client', 'contract'].map((g) => (
          <ListToolbar.Button key={g} variant={groupBy === g ? 'primary' : 'outline'} onClick={() => setGroupBy(g)}>By {g}</ListToolbar.Button>
        ))}
        <ListToolbar.Divider />
        {data && <Chip>Deferred revenue: KES {money(data.total)}</Chip>}
      </ListToolbar>
      <MilikTable
        columns={[
          { label: groupBy === 'client' ? 'Client' : 'Contract', width: '28%' },
          { label: 'Deferred at invoicing', align: 'right', width: '14%' },
          { label: 'Recognised', align: 'right', width: '12%' },
          { label: 'Credited', align: 'right', width: '11%' },
          { label: 'Deferred balance', align: 'right', width: '14%' },
          { label: 'Share', width: '21%' },
        ]}
        rows={rows.map((r) => ({ ...r, _id: String(r.id) }))}
        loading={!data || data.groupBy !== groupBy}
        empty="No deferred revenue outstanding."
        tableFixed
        minWidth={800}
        onRowClick={(r) => r.id && navigate(groupBy === 'client' ? `/clients/${r.id}` : `/clients/contracts/${r.id}`, { state: { tabTitle: r.ref?.name || r.ref?.contractNumber } })}
        renderRow={(r) => (
          <>
            <td className={cell}>
              <span className="block truncate font-semibold text-slate-900">{groupBy === 'client' ? r.ref?.name || '—' : r.ref?.contractNumber || '—'}</span>
              <span className="block truncate text-[10px] text-slate-500">{groupBy === 'client' ? r.ref?.clientCode : r.ref?.description}{` · ${r.schedules} line(s)`}</span>
            </td>
            <td className={numCell}>{money(r.billed)}</td>
            <td className={numCell}>{money(r.recognized)}</td>
            <td className={numCell}>{money(r.credited)}</td>
            <td className={`${numCell} font-bold text-slate-900`}>{money(r.deferred)}</td>
            <td className={cellLast}><Bar value={r.deferred} max={max} /></td>
          </>
        )}
      />
    </div>
  );
};

const WaterfallTab = () => {
  const [fromMonth, setFromMonth] = useState(monthIso(0));
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    revenueApi.waterfall({ months: 12, fromMonth })
      .then((res) => { if (alive) setData(res.data?.data || res.data); })
      .catch((err) => toast.error(apiError(err, 'Could not load the waterfall')));
    return () => { alive = false; };
  }, [fromMonth]);
  const months = data?.months || [];
  const max = months.reduce((m, r) => Math.max(m, r.amount), 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar>
        <span className="shrink-0 text-[10px] font-bold text-slate-600">From</span>
        <input type="month" className={monthCls} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        {data && (
          <>
            <ListToolbar.Divider />
            <Chip title="Pending entries for months before the start month — run recognition">Past unrecognised: KES {money(data.unrecognisedPastMonths)}</Chip>
            <Chip>Later: KES {money(data.later)}</Chip>
            <Chip>Total deferred: KES {money(data.total)}</Chip>
          </>
        )}
      </ListToolbar>
      <div className="flex-1 overflow-y-auto p-3">
        {!data ? <EmptyNote>Loading…</EmptyNote> : (
          <div className="mx-auto max-w-4xl border border-slate-200 bg-white p-3">
            <div className="flex h-48 items-end gap-1.5 border-b border-slate-200">
              {months.map((m) => (
                <div key={m.month} className="flex h-full flex-1 flex-col justify-end" title={`${fmtMonth(m.month)}: KES ${money(m.amount)}`}>
                  <span className="mb-0.5 text-center text-[9px] font-bold tabular-nums text-slate-600">{m.amount > 0 ? money(m.amount).replace(/\.00$/, '') : ''}</span>
                  <div className="w-full bg-[#0B3B2E]" style={{ height: `${max > 0 ? (m.amount / max) * 85 : 0}%`, minHeight: m.amount > 0 ? 2 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1.5">
              {months.map((m) => <span key={m.month} className="flex-1 text-center text-[9px] font-bold uppercase text-slate-500">{fmtMonth(m.month).replace(' ', ' ')}</span>)}
            </div>
            <table className="mt-3 w-full text-[11px]">
              <tbody className="divide-y divide-slate-100">
                {months.map((m) => (
                  <tr key={m.month}><td className="px-2 py-1 text-slate-700">{fmtMonth(m.month)}</td><td className="px-2 py-1 text-right font-semibold tabular-nums">{money(m.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const BilledTab = () => {
  const [fromMonth, setFromMonth] = useState(monthIso(-11));
  const [toMonth, setToMonth] = useState(monthIso(0));
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    revenueApi.billedVsRecognised({ fromMonth, toMonth })
      .then((res) => { if (alive) setData(res.data?.data || res.data); })
      .catch((err) => toast.error(apiError(err, 'Could not load billed vs recognised')));
    return () => { alive = false; };
  }, [fromMonth, toMonth]);
  const months = data?.months || [];
  const max = months.reduce((m, r) => Math.max(m, Math.abs(r.billed), Math.abs(r.recognized)), 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar>
        <span className="shrink-0 text-[10px] font-bold text-slate-600">From</span>
        <input type="month" className={monthCls} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
        <span className="shrink-0 text-[10px] font-bold text-slate-600">To</span>
        <input type="month" className={monthCls} value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
        {data && (
          <>
            <ListToolbar.Divider />
            <Chip>Billed (net): KES {money(data.totals?.billed)}</Chip>
            <Chip>Recognised: KES {money(data.totals?.recognized)}</Chip>
            <Chip>Deferred movement: KES {money((data.totals?.billed || 0) - (data.totals?.recognized || 0))}</Chip>
          </>
        )}
      </ListToolbar>
      <MilikTable
        columns={[
          { label: 'Month', width: '12%' },
          { label: 'Billed (net)', align: 'right', width: '14%' },
          { label: 'Recognised', align: 'right', width: '14%' },
          { label: 'Deferred movement', align: 'right', width: '14%' },
          { label: 'Billed ▪ recognised', width: '46%' },
        ]}
        rows={months.map((m) => ({ ...m, _id: m.month }))}
        loading={!data}
        empty="No billing in this range."
        tableFixed
        minWidth={760}
        renderRow={(m) => (
          <>
            <td className={`${cell} font-semibold text-slate-900`}>{fmtMonth(m.month)}</td>
            <td className={numCell}>{money(m.billed)}</td>
            <td className={numCell}>{money(m.recognized)}</td>
            <td className={`${numCell} ${m.deferredMovement < 0 ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>{money(m.deferredMovement)}</td>
            <td className={cellLast}>
              <div className="space-y-0.5">
                <Bar value={m.billed} max={max} tone="bg-slate-400" />
                <Bar value={m.recognized} max={max} tone="bg-[#0B3B2E]" />
              </div>
            </td>
          </>
        )}
      />
    </div>
  );
};

const RevenueRecognition = () => {
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const canRun = hasCompanyPermission(user, company, 'clients', 'process');
  const [tab, setTab] = useState('run');
  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <TabStrip tabs={TABS} active={tab} onChange={setTab} />
        {tab === 'run' && <RunTab canRun={canRun} />}
        {tab === 'balance' && <BalanceTab />}
        {tab === 'waterfall' && <WaterfallTab />}
        {tab === 'billed' && <BilledTab />}
        {tab === 'schedules' && <div className="flex min-h-0 flex-1 flex-col"><RevenueScheduleTable /></div>}
      </div>
    </ClientsShell>
  );
};

export default RevenueRecognition;
