// Collections building blocks: reminder preview/run, dunning log, promises to
// pay, invoice disputes and late-interest preview. The Collections page shows
// them company-wide; the client detail page shows them for one client.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { FaPlus, FaCheck, FaTimes, FaBan, FaPlay, FaSyncAlt, FaFlag, FaFlagCheckered, FaPrint } from 'react-icons/fa';
import ListToolbar from '../common/ListToolbar';
import MilikTable from '../common/MilikTable';
import PaginationBar from '../PaginationBar';
import AppSelect from '../common/AppSelect';
import Modal from '../common/Modal';
import CurrencyInput from '../common/CurrencyInput';
import { useConfirm } from '../../context/ConfirmContext';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDate, fmtDateTime, todayISO } from '../../utils/dates';
import { Chip, ReasonModal, Required, StatusPill, EmptyNote } from './clientUi';
import {
  money, humanize, useClientLookup, useClientsAccess, printReport,
  cell, cellLast, numCell, iconBtn, iconBtnDanger, inputClass, labelClass, footerBtn, footerPrimary,
} from './clientHelpers';

// Small paged-fetch hook for the panels (each keeps its own state; lists are
// short and change often, so no cross-mount cache here).
const usePaged = (fetcher, deps) => {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [data, setData] = useState({ rows: [], pagination: { total: 0, pages: 1 } });
  const [isFetching, setIsFetching] = useState(false);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);
  useEffect(() => { setPage(1); }, [run]);
  useEffect(() => {
    let alive = true;
    setIsFetching(true);
    run({ page, limit })
      .then((d) => { if (alive) setData(d); })
      .catch((err) => toast.error(apiError(err, 'Failed to load')))
      .finally(() => { if (alive) setIsFetching(false); });
    return () => { alive = false; };
  }, [run, page, limit, tick]);
  const pager = (label) => (
    <PaginationBar
      page={page}
      pages={data.pagination?.pages || 1}
      total={data.pagination?.total || 0}
      pageSize={limit}
      pageSizes={[25, 50, 100, 200]}
      onPageChange={setPage}
      onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
      loading={isFetching}
      label={label}
    />
  );
  return { data, isFetching, reload: () => setTick((t) => t + 1), pager };
};

// ─── Today's reminders (dry run) + run now ───────────────────────────────────
export const DunningPreviewPanel = () => {
  const confirm = useConfirm();
  const { canEdit } = useClientsAccess();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPreview(unwrap(await clientsCollectionsApi.previewDunning()));
    } catch (err) {
      toast.error(apiError(err, 'Failed to preview reminders'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    const ok = await confirm({ title: 'Send reminders now?', message: `This sends ${preview?.actions?.length || 0} reminder(s) by SMS/email right away.`, confirmText: 'Send now' });
    if (!ok) return;
    setRunning(true);
    try {
      const res = await clientsCollectionsApi.runDunning();
      toast.success(res.data?.message || 'Reminders sent');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Failed to run reminders'));
    } finally {
      setRunning(false);
    }
  };

  const actions = preview?.actions || [];
  const skipped = preview?.skipped || [];
  const sends = actions.reduce((s, a) => s + (a.sends?.length || 0), 0);

  return (
    <>
      <ListToolbar>
        <Chip>Invoices due a reminder: {actions.length}</Chip>
        <Chip>Messages: {sends}</Chip>
        <Chip>Outstanding: KES {money(actions.reduce((s, a) => s + Number(a.outstanding || 0), 0))}</Chip>
        {skipped.length > 0 && <Chip title={skipped.map((s) => `${s.invoiceNumber}: ${humanize(s.reason)}`).join('\n')}>Skipped: {skipped.length}</Chip>}
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={load}>Refresh</ListToolbar.Button>
        <ListToolbar.Divider />
        {canEdit && <ListToolbar.Button icon={FaPlay} onClick={run} disabled={running || !actions.length}>{running ? 'Sending…' : 'Run now'}</ListToolbar.Button>}
      </ListToolbar>
      <MilikTable
        tableFixed
        rowKey="invoice"
        columns={[
          { label: 'Invoice', width: '13%' },
          { label: 'Client', width: '24%' },
          { label: 'Step', width: '13%' },
          { label: 'Outstanding', align: 'right', width: '12%' },
          { label: 'Sends to', width: '38%' },
        ]}
        rows={actions}
        loading={loading && actions.length === 0}
        empty="Nothing to send today"
        renderExpanded={(a) => (
          <div className="space-y-2 normal-case">
            {(a.sends || []).map((s, i) => (
              <div key={i} className="border border-slate-200 bg-white p-2 text-[11px]">
                <p className="font-bold uppercase text-slate-500">{s.channel} → {s.to || <span className="text-red-600">no {s.channel === 'sms' ? 'phone' : 'email'} on file</span>}</p>
                {s.subject && <p className="font-semibold text-slate-900">{s.subject}</p>}
                <p className="whitespace-pre-wrap text-slate-700">{s.body}</p>
              </div>
            ))}
          </div>
        )}
        renderRow={(a) => (
          <>
            <td className={`${cell} font-bold text-slate-900`}>{a.invoiceNumber}</td>
            <td className={`${cell} truncate font-semibold text-slate-900`}>{a.clientName}</td>
            <td className={cell}>{a.stepKey} <span className="text-slate-500">· {a.offsetDays < 0 ? `${-a.offsetDays}d before` : a.offsetDays === 0 ? 'due day' : `${a.offsetDays}d after`}</span></td>
            <td className={`${numCell} font-bold`}>{money(a.outstanding)}</td>
            <td className={`${cellLast} truncate text-slate-700`}>{(a.sends || []).map((s) => `${s.channel.toUpperCase()} ${s.to || '—'}`).join(' · ')}</td>
          </>
        )}
      />
    </>
  );
};

// ─── Dunning log ─────────────────────────────────────────────────────────────
const LOG_STATUS = [
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];
export const DunningLogPanel = ({ clientId = '' }) => {
  const [status, setStatus] = useState('');
  const { data, isFetching, reload, pager } = usePaged(
    ({ page, limit }) => clientsCollectionsApi.dunningLog({ page, limit, clientId: clientId || undefined, status: status || undefined })
      .then((res) => { const d = unwrap(res); return { rows: d?.logs || [], pagination: d?.pagination }; }),
    [clientId, status],
  );
  const rows = data.rows;
  return (
    <>
      <ListToolbar>
        <Chip>Messages: {(data.pagination?.total || 0).toLocaleString()}</Chip>
        <ListToolbar.Divider />
        <AppSelect compact clearable placeholder="All statuses" value={status} onChange={(v) => setStatus(v || '')} options={LOG_STATUS} />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={reload}>Refresh</ListToolbar.Button>
      </ListToolbar>
      <MilikTable
        tableFixed
        columns={[
          { label: 'Sent', width: '14%' },
          ...(clientId ? [] : [{ label: 'Client', width: '18%' }]),
          { label: 'Invoice', width: '11%' },
          { label: 'Step · channel', width: '14%' },
          { label: 'To', width: clientId ? '27%' : '17%' },
          { label: 'Outstanding', align: 'right', width: '11%' },
          { label: 'Status', width: '9%' },
        ]}
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty="No reminders sent yet"
        renderExpanded={(l) => (
          <div className="text-[11px] normal-case">
            {l.subject && <p className="font-semibold text-slate-900">{l.subject}</p>}
            <p className="whitespace-pre-wrap text-slate-700">{l.body}</p>
            {l.error && <p className="mt-1 text-red-600">{l.error}</p>}
          </div>
        )}
        renderRow={(l) => (
          <>
            <td className={`${cell} whitespace-nowrap`}>{fmtDateTime(l.sentAt)}</td>
            {!clientId && <td className={`${cell} truncate font-semibold text-slate-900`}>{l.client?.name || '—'}</td>}
            <td className={`${cell} font-bold text-slate-900`}>{l.invoiceNumber}</td>
            <td className={cell}>{l.stepKey} <span className="text-slate-500">· {l.channel.toUpperCase()}</span></td>
            <td className={`${cell} truncate text-slate-700`}>{l.to || '—'}</td>
            <td className={numCell}>{money(l.outstanding)}</td>
            <td className={cellLast}><StatusPill status={l.status} /></td>
          </>
        )}
      />
      {pager('messages')}
    </>
  );
};

// ─── Promises to pay ─────────────────────────────────────────────────────────
const PROMISE_STATUS = [
  { value: 'open', label: 'Open' },
  { value: 'kept', label: 'Kept' },
  { value: 'broken', label: 'Broken' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const PromiseModal = ({ clientId: fixedClientId = '', onClose, onDone }) => {
  const { businessId } = useClientsAccess();
  const { options: clientOptions } = useClientLookup(businessId);
  const [form, setForm] = useState({ clientId: fixedClientId, promiseDate: todayISO(), promisedAmount: '', contactName: '', notes: '', invoices: [] });
  const [openInvoices, setOpenInvoices] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.clientId) { setOpenInvoices([]); return undefined; }
    let alive = true;
    clientsCollectionsApi.allocationSuggestions(form.clientId)
      .then((res) => { if (alive) setOpenInvoices(unwrap(res)?.invoices || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [form.clientId]);

  const toggleInvoice = (id) => setForm((f) => ({ ...f, invoices: f.invoices.includes(id) ? f.invoices.filter((x) => x !== id) : [...f.invoices, id] }));

  const submit = async () => {
    if (!form.clientId) { toast.error('Pick the client'); return; }
    if (!form.promiseDate) { toast.error('Pick the promised date'); return; }
    setSaving(true);
    try {
      const res = await clientsCollectionsApi.createPromise({ ...form, promisedAmount: Number(form.promisedAmount || 0) });
      toast.success(res.data?.message || 'Promise recorded');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Failed to record promise'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Promise to pay"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={footerPrimary} onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save promise'}</button>
        </>
      )}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {!fixedClientId && (
          <div className="col-span-2">
            <AppSelect size="sm" label="Client" required searchable value={form.clientId} onChange={(v) => setForm((f) => ({ ...f, clientId: v || '', invoices: [] }))} options={clientOptions} />
          </div>
        )}
        <div>
          <label className={labelClass}>Pay by<Required /></label>
          <input type="date" className={inputClass} value={form.promiseDate} onChange={(e) => set('promiseDate', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Amount promised</label>
          <CurrencyInput value={form.promisedAmount} onChange={(e) => set('promisedAmount', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Promised by</label>
          <input className={inputClass} value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Contact name" />
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <input className={inputClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="col-span-2">
          <p className={labelClass}>Covers invoices <span className="font-normal text-slate-500">(none ticked = all open invoices)</span></p>
          <div className="max-h-36 overflow-y-auto border border-slate-200">
            {openInvoices.length === 0 && <p className="px-2 py-2 text-[11px] text-slate-400">{form.clientId ? 'No open invoices' : 'Pick a client first'}</p>}
            {openInvoices.map((inv) => (
              <label key={inv._id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1 text-xs last:border-b-0 hover:bg-slate-50">
                <input type="checkbox" className="accent-[#0B3B2E]" checked={form.invoices.includes(inv._id)} onChange={() => toggleInvoice(inv._id)} />
                <span className="font-semibold">{inv.invoiceNumber}</span>
                <span className="text-slate-500">due {fmtDate(inv.dueDate)}</span>
                <span className="ml-auto tabular-nums">{money(inv.outstanding)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export const PromisesPanel = ({ clientId = '' }) => {
  const { canEdit } = useClientsAccess();
  const [status, setStatus] = useState('open');
  const [creating, setCreating] = useState(false);
  const { data, isFetching, reload, pager } = usePaged(
    ({ page, limit }) => clientsCollectionsApi.listPromises({ page, limit, clientId: clientId || undefined, status: status || undefined })
      .then((res) => { const d = unwrap(res); return { rows: d?.promises || [], pagination: d?.pagination }; }),
    [clientId, status],
  );
  const update = async (p, next) => {
    try {
      const res = await clientsCollectionsApi.updatePromise(p._id, { status: next });
      toast.success(res.data?.message || 'Promise updated');
      reload();
    } catch (err) {
      toast.error(apiError(err, 'Failed to update promise'));
    }
  };
  const rows = data.rows;
  const today = todayISO();
  return (
    <>
      <ListToolbar>
        <Chip>Promises: {(data.pagination?.total || 0).toLocaleString()}</Chip>
        <Chip>Promised: KES {money(rows.reduce((s, p) => s + Number(p.promisedAmount || 0), 0))}</Chip>
        <ListToolbar.Divider />
        <AppSelect compact clearable placeholder="All statuses" value={status} onChange={(v) => setStatus(v || '')} options={PROMISE_STATUS} />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={reload}>Refresh</ListToolbar.Button>
        <ListToolbar.Divider />
        {canEdit && <ListToolbar.Button icon={FaPlus} onClick={() => setCreating(true)}>New Promise</ListToolbar.Button>}
      </ListToolbar>
      <MilikTable
        tableFixed
        columns={[
          { label: 'Pay by', width: '11%' },
          ...(clientId ? [] : [{ label: 'Client', width: '20%' }]),
          { label: 'Invoices', width: clientId ? '30%' : '20%' },
          { label: 'Amount', align: 'right', width: '11%' },
          { label: 'Promised by · notes', width: '21%' },
          { label: 'Status', width: '9%' },
        ]}
        actionsWidth="8%"
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty="No promises to pay"
        renderRow={(p) => {
          const late = p.status === 'open' && String(p.promiseDate).slice(0, 10) < today;
          return (
            <>
              <td className={`${cell} whitespace-nowrap ${late ? 'font-bold text-red-600' : ''}`}>{fmtDate(p.promiseDate)}</td>
              {!clientId && <td className={`${cell} truncate font-semibold text-slate-900`}>{p.client?.name || '—'}</td>}
              <td className={`${cell} truncate`}>{(p.invoices || []).length ? p.invoices.map((i) => i.invoiceNumber).join(', ') : <span className="text-slate-500">All open invoices</span>}</td>
              <td className={`${numCell} font-bold`}>{p.promisedAmount ? money(p.promisedAmount) : '—'}</td>
              <td className={`${cell} truncate text-slate-700`}>{[p.contactName, p.notes].filter(Boolean).join(' · ') || '—'}</td>
              <td className={cellLast}><StatusPill status={p.status} /></td>
            </>
          );
        }}
        renderActions={(p) => (canEdit && p.status === 'open' ? (
          <div className="flex justify-end gap-0.5">
            <button type="button" title="Mark kept" className={iconBtn} onClick={() => update(p, 'kept')}><FaCheck size={12} /></button>
            <button type="button" title="Mark broken" className={iconBtnDanger} onClick={() => update(p, 'broken')}><FaTimes size={12} /></button>
            <button type="button" title="Cancel promise" className={iconBtn} onClick={() => update(p, 'cancelled')}><FaBan size={12} /></button>
          </div>
        ) : null)}
      />
      {pager('promises')}
      {creating && <PromiseModal clientId={clientId} onClose={() => setCreating(false)} onDone={reload} />}
    </>
  );
};

// ─── Disputes ────────────────────────────────────────────────────────────────
/**
 * With no client picked: every open dispute in the company. With a client: that client's open
 * invoices, to raise or resolve disputes. Disputed invoices are skipped by reminders, late interest
 * and auto-allocation until resolved.
 */
export const DisputesPanel = ({ clientId: fixedClientId = '' }) => {
  const { businessId, canEdit } = useClientsAccess();
  const { options: clientOptions } = useClientLookup(businessId);
  const [clientId, setClientId] = useState(fixedClientId);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(null); // { invoice, raise }
  const [onlyDisputed, setOnlyDisputed] = useState(false);
  const [companyDisputes, setCompanyDisputes] = useState({ disputes: [], total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!clientId) {
        setInvoices([]);
        setCompanyDisputes(unwrap(await clientsCollectionsApi.listDisputes({ status: 'open' })) || { disputes: [], total: 0 });
        return;
      }
      setInvoices(unwrap(await clientsCollectionsApi.allocationSuggestions(clientId))?.invoices || []);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load invoices'));
    } finally {
      setLoading(false);
    }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (onlyDisputed ? invoices.filter((i) => i.disputed) : invoices), [invoices, onlyDisputed]);
  const disputedTotal = invoices.filter((i) => i.disputed).reduce((s, i) => s + i.outstanding, 0);

  return (
    <>
      <ListToolbar>
        {clientId ? (
          <>
            <Chip>Open invoices: {invoices.length}</Chip>
            <Chip>Disputed: {invoices.filter((i) => i.disputed).length} · KES {money(disputedTotal)}</Chip>
          </>
        ) : (
          <Chip>Open disputes: {companyDisputes.disputes.length} · KES {money(companyDisputes.total)}</Chip>
        )}
        <ListToolbar.Divider />
        {!fixedClientId && <AppSelect compact searchable placeholder="Pick a client…" value={clientId} onChange={(v) => setClientId(v || '')} options={clientOptions} />}
        {clientId && <ListToolbar.Button variant={onlyDisputed ? 'primary' : 'outline'} onClick={() => setOnlyDisputed((v) => !v)}>Disputed only</ListToolbar.Button>}
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={load}>Refresh</ListToolbar.Button>
      </ListToolbar>
      {!clientId ? (
        <MilikTable
          tableFixed
          columns={[
            { label: 'Invoice', width: '14%' },
            { label: 'Client', width: '22%' },
            { label: 'Disputed', width: '12%' },
            { label: 'Reason', width: '30%' },
            { label: 'Outstanding', align: 'right', width: '16%' },
          ]}
          actionsWidth="6%"
          rows={companyDisputes.disputes}
          loading={loading && companyDisputes.disputes.length === 0}
          empty="No open disputes. Pick a client to raise one."
          renderRow={(d) => (
            <>
              <td className={`${cell} font-bold text-slate-900`}>{d.invoice?.invoiceNumber || '—'}</td>
              <td className={cell}><span className="truncate block">{d.client?.name || '—'}<span className="ml-1.5 font-normal text-slate-500">· {d.client?.clientCode}</span></span></td>
              <td className={cell}>{fmtDate(d.disputedAt)}</td>
              <td className={cell}><span className="truncate block" title={d.disputeReason}>{d.disputeReason || '—'}</span></td>
              <td className={`${numCell} font-bold`}>{money(d.outstanding)}</td>
            </>
          )}
          renderActions={(d) => (canEdit && d.invoice ? (
            <button type="button" title="Resolve dispute" className={iconBtn} onClick={() => setActing({ invoice: d.invoice, raise: false })}><FaFlagCheckered size={12} /></button>
          ) : null)}
        />
      ) : (
        <MilikTable
          tableFixed
          columns={[
            { label: 'Invoice', width: '16%' },
            { label: 'Issued', width: '12%' },
            { label: 'Due', width: '14%' },
            { label: 'Total', align: 'right', width: '14%' },
            { label: 'Outstanding', align: 'right', width: '14%' },
            { label: 'Dispute', width: '20%' },
          ]}
          actionsWidth="6%"
          rows={rows}
          loading={loading && rows.length === 0}
          empty="No open invoices"
          renderRow={(inv) => (
            <>
              <td className={`${cell} font-bold text-slate-900`}>{inv.invoiceNumber}</td>
              <td className={cell}>{fmtDate(inv.issueDate)}</td>
              <td className={`${cell} ${inv.daysOverdue > 0 ? 'font-semibold text-red-600' : ''}`}>{fmtDate(inv.dueDate)}{inv.daysOverdue > 0 ? ` · ${inv.daysOverdue}d` : ''}</td>
              <td className={numCell}>{money(inv.total)}</td>
              <td className={`${numCell} font-bold`}>{money(inv.outstanding)}</td>
              <td className={cellLast}>{inv.disputed ? <StatusPill status="warn" label="Disputed" /> : <span className="text-slate-400">—</span>}</td>
            </>
          )}
          renderActions={(inv) => (canEdit ? (
            inv.disputed
              ? <button type="button" title="Resolve dispute" className={iconBtn} onClick={() => setActing({ invoice: inv, raise: false })}><FaFlagCheckered size={12} /></button>
              : <button type="button" title="Raise dispute" className={iconBtnDanger} onClick={() => setActing({ invoice: inv, raise: true })}><FaFlag size={12} /></button>
          ) : null)}
        />
      )}
      {acting && (
        <ReasonModal
          title={`${acting.raise ? 'Dispute' : 'Resolve dispute on'} ${acting.invoice.invoiceNumber}`}
          message={acting.raise ? 'Reminders, late interest and auto-allocation skip this invoice until the dispute is resolved.' : 'Record how the dispute was resolved.'}
          confirmLabel={acting.raise ? 'Raise dispute' : 'Resolve'}
          danger={acting.raise}
          required={acting.raise}
          onClose={() => setActing(null)}
          onConfirm={async (reason) => {
            try {
              const res = await clientsCollectionsApi.setDispute(acting.invoice._id, acting.raise ? { disputed: true, reason } : { disputed: false, resolution: reason });
              toast.success(res.data?.message || 'Saved');
              setActing(null);
              load();
            } catch (err) {
              toast.error(apiError(err, 'Failed to update dispute'));
            }
          }}
        />
      )}
    </>
  );
};

// ─── Late-payment interest preview ───────────────────────────────────────────
export const LateInterestPanel = ({ clientId: fixedClientId = '' }) => {
  const { businessId } = useClientsAccess();
  const { options: clientOptions } = useClientLookup(businessId);
  const [asOf, setAsOf] = useState(todayISO());
  const [clientId, setClientId] = useState(fixedClientId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(unwrap(await clientsCollectionsApi.lateInterestPreview({ asOf, clientId: clientId || undefined })));
    } catch (err) {
      toast.error(apiError(err, 'Failed to compute late interest'));
    } finally {
      setLoading(false);
    }
  }, [asOf, clientId]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.rows || [];
  const columns = [
    { label: 'Invoice', value: (r) => r.invoiceNumber },
    { label: 'Client', value: (r) => r.clientName },
    { label: 'Contract', value: (r) => r.contractNumber },
    { label: 'Outstanding', align: 'right', value: (r) => money(r.outstanding) },
    { label: 'Rate', value: (r) => `${r.ratePercent}% ${r.basis}` },
    { label: 'Period', value: (r) => `${fmtDate(r.interestFrom)} – ${fmtDate(r.interestThrough)} (${r.days}d)` },
    { label: 'Interest', align: 'right', value: (r) => money(r.amount) },
  ];
  return (
    <>
      <ListToolbar>
        <Chip>Invoices: {rows.length}</Chip>
        <Chip>Interest due: KES {money(data?.total || 0)}</Chip>
        <ListToolbar.Divider />
        <ListToolbar.Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} width="w-28" title="As at" />
        {!fixedClientId && <AppSelect compact clearable searchable placeholder="All clients" value={clientId} onChange={(v) => setClientId(v || '')} options={clientOptions} />}
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={load}>Refresh</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaPrint} onClick={() => printReport({ title: 'Late-payment interest', subtitle: `As at ${fmtDate(asOf)}`, columns, rows, summaryItems: [['Total interest', `KES ${money(data?.total || 0)}`]] })}>Print</ListToolbar.Button>
      </ListToolbar>
      <MilikTable
        tableFixed
        rowKey="invoice"
        columns={[
          { label: 'Invoice', width: '12%' },
          ...(fixedClientId ? [] : [{ label: 'Client', width: '18%' }]),
          { label: 'Contract', width: '12%' },
          { label: 'Outstanding', align: 'right', width: '12%' },
          { label: 'Rate', width: '11%' },
          { label: 'Period', width: '23%' },
          { label: 'Interest', align: 'right', width: '12%' },
        ]}
        rows={rows}
        loading={loading && rows.length === 0}
        empty="No late interest due — only contracts with a late-payment rate accrue interest"
        renderRow={(r) => (
          <>
            <td className={`${cell} font-bold text-slate-900`}>{r.invoiceNumber}</td>
            {!fixedClientId && <td className={`${cell} truncate font-semibold text-slate-900`}>{r.clientName}</td>}
            <td className={cell}>{r.contractNumber}</td>
            <td className={numCell}>{money(r.outstanding)}</td>
            <td className={cell}>{r.ratePercent}% {r.basis}</td>
            <td className={`${cell} truncate`}>{fmtDate(r.interestFrom)} – {fmtDate(r.interestThrough)} <span className="text-slate-500">· {r.days}d</span></td>
            <td className={`${numCell} border-r-0 font-bold`}>{money(r.amount)}</td>
          </>
        )}
      />
    </>
  );
};
