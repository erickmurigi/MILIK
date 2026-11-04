// Revenue recognition schedules (deferred invoice lines) for a contract or an invoice, with the
// monthly release plan per line and "recognise milestone" for milestone lines.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaFlagCheckered } from 'react-icons/fa';
import MilikTable from '../../common/MilikTable';
import Modal from '../../common/Modal';
import CurrencyInput from '../../common/CurrencyInput';
import { fmtDate } from '../../../utils/dates';
import { revenueApi, apiError } from '../../../services/clientsBillingApi';
import { StatusPill, Required, cell, cellLast, numCell, iconBtn, labelClass, inputClass, footerBtn, footerPrimary } from './BillingUi';
import { fmtMonth, money, todayIso } from './billingShared';

const MilestoneModal = ({ schedule, onClose, onDone }) => {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!(Number(amount) > 0)) { toast.error('Enter the amount to recognise'); return; }
    if (Number(amount) > Number(schedule.unrecognized) + 0.005) { toast.error(`Only ${money(schedule.unrecognized)} is left to recognise`); return; }
    setBusy(true);
    try {
      await revenueApi.milestone(schedule._id, { amount: Number(amount), date, description: description.trim() });
      toast.success('Milestone queued for recognition — it posts on the next recognition run');
      onDone();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not record the milestone'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Milestone — ${schedule.description}`} size="sm" onClose={onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Recognise'}</button>
      </>
    )}>
      <p className="mb-2 text-xs text-slate-600">Unrecognised on this line: <b className="tabular-nums">{money(schedule.unrecognized)}</b></p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Amount<Required /></label>
          <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Delivered on</label>
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Milestone</label>
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Phase 1 go-live" maxLength={120} />
        </div>
      </div>
    </Modal>
  );
};

const RevenueScheduleTable = ({ contractId, invoiceId, schedules: given, onChanged }) => {
  const navigate = useNavigate();
  const [fetched, setFetched] = useState([]);
  const [loaded, setLoaded] = useState(Boolean(given));
  const [milestone, setMilestone] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (given && tick === 0) return undefined;
    let alive = true;
    const params = {};
    if (contractId) params.contractId = contractId;
    if (invoiceId) params.invoiceId = invoiceId;
    revenueApi.schedules(params)
      .then((res) => { if (alive) { setFetched(res.data?.schedules || res.data?.data || []); setLoaded(true); } })
      .catch((err) => { if (alive) { toast.error(apiError(err, 'Could not load revenue schedules')); setLoaded(true); } });
    return () => { alive = false; };
  }, [contractId, invoiceId, given, tick]);

  const rows = given && tick === 0 ? given : fetched;
  const refresh = useCallback(() => { setTick((t) => t + 1); onChanged?.(); }, [onChanged]);

  return (
    <>
      <MilikTable
        columns={[
          { label: 'Invoice', width: '12%' },
          { label: 'Line', width: '22%' },
          { label: 'Method', width: '10%' },
          { label: 'Service period', width: '16%' },
          { label: 'Deferred', align: 'right', width: '10%' },
          { label: 'Recognised', align: 'right', width: '10%' },
          { label: 'Unrecognised', align: 'right', width: '10%' },
          { label: 'Status', width: '8%' },
        ]}
        rows={rows}
        loading={!loaded && rows.length === 0}
        empty="No deferred revenue — every line here is recognised when invoiced."
        tableFixed
        minWidth={900}
        renderExpanded={(s) => (
          <div className="flex flex-wrap gap-1">
            {(s.entries || []).map((e) => (
              <span key={e._id} className="border border-slate-200 bg-white px-1.5 py-0.5 text-[10px]" title={e.description || ''}>
                <b>{fmtMonth(e.month)}</b> <span className="tabular-nums">{money(e.amount)}</span> <StatusPill status={e.status === 'recognized' ? 'posted' : e.status} label={e.status} />
              </span>
            ))}
            {!(s.entries || []).length && <span className="text-[11px] text-slate-500">No release plan yet{s.method === 'milestone' ? ' — recognise milestones as they are delivered.' : '.'}</span>}
          </div>
        )}
        renderRow={(s) => (
          <>
            <td className={cell}>
              <button type="button" className="font-bold text-[#0B3B2E] hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/clients/invoices/${s.invoice}`, { state: { tabTitle: s.invoiceNumber } }); }}>{s.invoiceNumber || '—'}</button>
            </td>
            <td className={cell}><span className="block truncate text-slate-900">{s.description}</span>{s.incomeAccount?.name && <span className="block truncate text-[10px] text-slate-500">{s.incomeAccount.code} · {s.incomeAccount.name}</span>}</td>
            <td className={`${cell} text-slate-700`}>{s.method === 'milestone' ? 'Milestone' : 'Straight-line'}</td>
            <td className={`${cell} whitespace-nowrap text-slate-700`}>{s.servicePeriodStart ? `${fmtDate(s.servicePeriodStart)} – ${fmtDate(s.servicePeriodEnd)}` : '—'}</td>
            <td className={numCell}>{money(s.totalAmount - (s.creditedAmount || 0))}</td>
            <td className={numCell}>{money(s.recognizedAmount)}</td>
            <td className={`${numCell} font-bold text-slate-900`}>{money(s.unrecognized ?? (s.totalAmount - (s.creditedAmount || 0) - (s.recognizedAmount || 0)))}</td>
            <td className={cellLast}><StatusPill status={s.status === 'active' ? 'scheduled' : s.status} label={s.status} /></td>
          </>
        )}
        renderActions={(s) => (s.method === 'milestone' && s.status === 'active' ? (
          <button type="button" className={iconBtn} title="Recognise milestone" onClick={() => setMilestone(s)}><FaFlagCheckered size={12} /></button>
        ) : null)}
        actionsWidth="60px"
      />
      {milestone && <MilestoneModal schedule={milestone} onClose={() => setMilestone(null)} onDone={refresh} />}
    </>
  );
};

export default RevenueScheduleTable;
