// Billing run: preview what the contract schedules would invoice for a period, then raise the
// invoices (posted, or as drafts for review). Every period is invoiced at most once.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaEye, FaHistory, FaPlay } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import MilikTable from '../../components/common/MilikTable';
import Modal from '../../components/common/Modal';
import { Chip, StatusPill, cell, cellLast, numCell, footerBtn, footerPrimary } from '../../components/Clients/Billing/BillingUi';
import { fmtMonth, money, monthIso, todayIso, useBillingClients, useBillingSettings, useClientContracts, invalidateList } from '../../components/Clients/Billing/billingShared';
import { billingApi, apiError } from '../../services/clientsBillingApi';
import { fmtDate } from '../../utils/dates';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';

const SCOPE_OPTIONS = [
  { value: 'all', label: 'All contracts' },
  { value: 'client', label: 'One client' },
  { value: 'contract', label: 'One contract' },
];
const GROUP_OPTIONS = [
  { value: 'client', label: 'One invoice per client' },
  { value: 'contract', label: 'One invoice per contract' },
];
const controlCls = 'h-[22px] shrink-0 border border-slate-200 bg-white px-1.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';
const keyOf = (inv, i) => `${inv.client}-${inv.contract || inv.contractNumbers?.join(',')}-${i}`;

const RunResult = ({ run, clientName, onOpen, onInvoices }) => {
  const blocked = (run.failures || []).filter((f) => f.kind === 'credit_block');
  const errors = (run.failures || []).filter((f) => f.kind !== 'credit_block');
  return (
    <div className="border-b border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusPill status={run.status} />
        <span className="font-bold text-slate-900">{run.invoiceCount} invoice(s) raised{run.postAsDraft ? ' as drafts' : ' and posted'} · KES {money(run.total)}</span>
        {blocked.length > 0 && <span className="font-semibold text-amber-700">{blocked.length} skipped by credit control</span>}
        {errors.length > 0 && <span className="font-semibold text-red-700">{errors.length} failed</span>}
        <button type="button" className="ml-auto font-bold text-[#0B3B2E] hover:underline" onClick={onOpen}>Open run →</button>
        <button type="button" className="font-bold text-[#0B3B2E] hover:underline" onClick={onInvoices}>View invoices →</button>
      </div>
      {(run.failures || []).length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px]">
          {run.failures.map((f, i) => (
            <li key={`${f.client}-${i}`} className={f.kind === 'credit_block' ? 'text-amber-800' : 'text-red-700'}>
              <b>{clientName(f.client)}</b> — {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const BillingRun = () => {
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canRun = hasCompanyPermission(user, company, 'clients', 'process');
  const { clients, options: clientOptions } = useBillingClients(businessId);
  const { settings, loaded: settingsLoaded } = useBillingSettings();

  const [period, setPeriod] = useState(monthIso(0));
  const [scope, setScope] = useState('all');
  const [clientId, setClientId] = useState('');
  const [contractId, setContractId] = useState('');
  const [groupBy, setGroupBy] = useState('client');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [draftChoice, setDraftChoice] = useState(null); // null = follow settings
  const postAsDraft = draftChoice ?? Boolean(settings?.billingRunPostsAsDraft);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const contractOptions = useClientContracts(scope === 'contract' ? '' : null, { liveOnly: true });

  const clientMap = useMemo(() => new Map(clients.map((c) => [String(c._id), c])), [clients]);
  const clientName = (cid) => clientMap.get(String(cid))?.name || 'Client';

  const params = () => {
    const p = { period, scope, groupBy, issueDate };
    if (scope === 'client') p.clientId = clientId;
    if (scope === 'contract') p.contractId = contractId;
    return p;
  };
  const scopeMissing = (scope === 'client' && !clientId) || (scope === 'contract' && !contractId);

  const runPreview = async () => {
    if (scopeMissing) { toast.error(`Pick the ${scope} to bill`); return; }
    setPreviewing(true);
    setResult(null);
    try {
      const res = await billingApi.preview(params());
      setPreview(res.data?.data || res.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not build the preview'));
    } finally {
      setPreviewing(false);
    }
  };

  const runBilling = async () => {
    setRunning(true);
    try {
      const res = await billingApi.run({ ...params(), postAsDraft });
      const run = res.data?.run || res.data?.data;
      setResult(run);
      setPreview(null);
      setConfirming(false);
      invalidateList(`invoices:${businessId}`);
      toast.success(`Billing run complete — ${run.invoiceCount} invoice(s) raised`);
    } catch (err) {
      toast.error(apiError(err, 'The billing run failed'));
    } finally {
      setRunning(false);
    }
  };

  const invoices = useMemo(() => preview?.invoices || [], [preview]);
  const blocked = invoices.filter((i) => i.creditCheck?.level === 'block');
  const warned = invoices.filter((i) => i.creditCheck?.level === 'warn');
  const billable = invoices.filter((i) => i.creditCheck?.level !== 'block');
  const billableTotal = billable.reduce((s, i) => s + Number(i.total || 0), 0);

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <ListToolbar>
          <span className="shrink-0 text-[10px] font-bold text-slate-600">Period</span>
          <input type="month" className={`${controlCls} w-[118px]`} value={period} onChange={(e) => { setPeriod(e.target.value); setPreview(null); }} />
          <div className="w-28 shrink-0"><AppSelect compact value={scope} onChange={(v) => { setScope(v || 'all'); setPreview(null); }} options={SCOPE_OPTIONS} /></div>
          {scope === 'client' && <div className="w-44 shrink-0"><AppSelect compact value={clientId} onChange={(v) => { setClientId(v || ''); setPreview(null); }} options={clientOptions} placeholder="Select client" searchable /></div>}
          {scope === 'contract' && <div className="w-44 shrink-0"><AppSelect compact value={contractId} onChange={(v) => { setContractId(v || ''); setPreview(null); }} options={contractOptions} placeholder="Select contract" searchable /></div>}
          <div className="w-40 shrink-0"><AppSelect compact value={groupBy} onChange={(v) => { setGroupBy(v || 'client'); setPreview(null); }} options={GROUP_OPTIONS} /></div>
          <span className="shrink-0 text-[10px] font-bold text-slate-600">Issue</span>
          <input type="date" className={`${controlCls} w-[108px]`} value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setPreview(null); }} />
          <label className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-slate-700" title={settingsLoaded ? `Company default: ${settings?.billingRunPostsAsDraft ? 'drafts' : 'post'}` : ''}>
            <input type="checkbox" className="accent-[#0B3B2E]" checked={postAsDraft} onChange={(e) => setDraftChoice(e.target.checked)} /> Post as draft
          </label>
          <ListToolbar.Divider />
          <ListToolbar.Button variant="accent" icon={FaEye} onClick={runPreview} disabled={previewing}>{previewing ? 'Building…' : 'Preview'}</ListToolbar.Button>
          <ListToolbar.Divider />
          <ListToolbar.Button variant="outline" icon={FaHistory} onClick={() => navigate('/clients/billing/runs', { state: { tabTitle: 'Billing Runs' } })}>Run history</ListToolbar.Button>
          {canRun && (
            <>
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaPlay} onClick={() => setConfirming(true)} disabled={!preview || !billable.length || running}>Run billing</ListToolbar.Button>
            </>
          )}
        </ListToolbar>

        {result && (
          <RunResult
            run={result}
            clientName={clientName}
            onOpen={() => navigate(`/clients/billing/runs/${result._id}`, { state: { tabTitle: `Run ${fmtMonth(result.period)}` } })}
            onInvoices={() => navigate('/clients/invoices')}
          />
        )}

        {preview && (
          <div className="flex flex-none flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-2 py-1">
            <Chip>Period: {fmtMonth(preview.period)} (to {fmtDate(preview.cutoff)})</Chip>
            <Chip>Invoices: {preview.invoiceCount}</Chip>
            <Chip>Periods: {preview.rowCount}</Chip>
            <Chip>Net: KES {money(preview.subtotal)}</Chip>
            <Chip>Tax: KES {money(preview.taxAmount)}</Chip>
            <Chip>Total: KES {money(preview.total)}</Chip>
            {warned.length > 0 && <Chip title="Over a soft credit limit — will still be billed">Credit warnings: {warned.length}</Chip>}
            {blocked.length > 0 && <Chip title="Credit hold / blacklisted / hard limit — will be skipped">Blocked: {blocked.length}</Chip>}
          </div>
        )}

        <MilikTable
          columns={[
            { label: 'Client', width: '22%' },
            { label: 'Contract(s)', width: '16%' },
            { label: 'Service period', width: '16%' },
            { label: 'Net', align: 'right', width: '10%' },
            { label: 'Tax', align: 'right', width: '9%' },
            { label: 'Total', align: 'right', width: '11%' },
            { label: 'Due', width: '8%' },
            { label: 'Credit', width: '8%' },
          ]}
          rows={invoices.map((inv, i) => ({ ...inv, _key: keyOf(inv, i) }))}
          rowKey="_key"
          loading={previewing && invoices.length === 0}
          empty={preview ? `Nothing to bill for ${fmtMonth(preview.period)} — every due period is already invoiced, held or skipped.` : 'Choose the period and scope, then Preview to see what will be invoiced.'}
          tableFixed
          minWidth={960}
          rowClassName={(inv) => (inv.creditCheck?.level === 'block' ? 'opacity-60' : '')}
          renderExpanded={(inv) => (
            <table className="w-full text-[11px] normal-case">
              <thead className="text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr><th className="px-2 py-0.5">Item</th><th className="px-2 py-0.5">Period</th><th className="px-2 py-0.5 text-right">Qty × price</th><th className="px-2 py-0.5">Tax</th><th className="px-2 py-0.5 text-right">Net</th><th className="px-2 py-0.5 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(inv.lines || []).map((l, i) => (
                  <tr key={`${l.scheduleKey || i}`}>
                    <td className="px-2 py-0.5 font-semibold text-slate-900">{l.itemName || l.description}</td>
                    <td className="px-2 py-0.5">{fmtDate(l.servicePeriodStart)} – {fmtDate(l.servicePeriodEnd)}{l.prorationFactor && l.prorationFactor !== 1 ? ` · ${Math.round(l.prorationFactor * 100)}%` : ''}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{l.quantity} × {money(l.unitPrice)}{l.discountPercent ? ` −${l.discountPercent}%` : ''}</td>
                    <td className="px-2 py-0.5">{l.taxCodeName || l.taxCodeKey || '—'}</td>
                    <td className="px-2 py-0.5 text-right tabular-nums">{money(l.amount)}</td>
                    <td className="px-2 py-0.5 text-right font-semibold tabular-nums">{money(l.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          renderRow={(inv) => (
            <>
              <td className={cell}><span className="block truncate font-semibold text-slate-900">{clientName(inv.client)}</span>{inv.poNumber && <span className="block text-[10px] text-slate-500">PO {inv.poNumber}</span>}</td>
              <td className={`${cell} text-slate-700`}>{(inv.contractNumbers || []).join(', ')}<span className="block text-[10px] text-slate-500">{(inv.lines || []).length} line(s){inv.currency !== 'KES' ? ` · ${inv.currency}` : ''}</span></td>
              <td className={`${cell} whitespace-nowrap text-slate-700`}>{fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</td>
              <td className={numCell}>{money(inv.subtotal)}</td>
              <td className={numCell}>{money(inv.taxAmount)}</td>
              <td className={`${numCell} font-bold text-slate-900`}>{money(inv.total)}</td>
              <td className={`${cell} whitespace-nowrap text-slate-700`}>{fmtDate(inv.dueDate)}</td>
              <td className={cellLast} title={(inv.creditCheck?.reasons || []).join('; ')}>
                {inv.creditCheck?.level === 'block' ? <StatusPill status="block" label="Blocked" /> : inv.creditCheck?.level === 'warn' ? <StatusPill status="warn" label="Warning" /> : <StatusPill status="ok" label="OK" />}
              </td>
            </>
          )}
        />
      </div>

      {confirming && preview && (
        <Modal title={`Run billing — ${fmtMonth(preview.period)}`} size="sm" onClose={running ? () => {} : () => setConfirming(false)} footer={(
          <>
            <button type="button" className={footerBtn} onClick={() => setConfirming(false)} disabled={running}>Cancel</button>
            <button type="button" className={footerPrimary} onClick={runBilling} disabled={running}>{running ? 'Running…' : `Raise ${billable.length} invoice(s)`}</button>
          </>
        )}>
          <div className="space-y-1.5 text-xs text-slate-700">
            <p>Raise <b>{billable.length}</b> invoice(s) totalling <b className="tabular-nums">KES {money(billableTotal)}</b>, issued {fmtDate(issueDate)}.</p>
            <p>{postAsDraft ? 'They are created as drafts — review and post them from Invoices.' : 'They are posted to the ledger immediately (not emailed).'}</p>
            {blocked.length > 0 && <p className="font-semibold text-amber-800">{blocked.length} client(s) on credit hold will be skipped.</p>}
          </div>
        </Modal>
      )}
    </ClientsShell>
  );
};

export default BillingRun;
