// Contract detail: header metrics, lifecycle action bar and tabs
// (Overview, Billing schedule, Invoices, Versions, Revenue, Documents, Renewal).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FaArrowLeft, FaBan, FaCheck, FaEdit, FaExternalLinkAlt, FaFileContract, FaFilePdf, FaPause, FaPlay, FaPaperPlane,
  FaPlus, FaPrint, FaRedo, FaSignature, FaStop, FaTimes, FaTrash,
} from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import Spinner from '../../components/common/Spinner';
import ClientInvoicesPanel from '../../components/Clients/Billing/ClientInvoicesPanel';
import ContractScheduleTab from '../../components/Clients/Billing/ContractScheduleTab';
import ContractVersionsTab from '../../components/Clients/Billing/ContractVersionsTab';
import RevenueScheduleTable from '../../components/Clients/Billing/RevenueScheduleTable';
import {
  AddDocumentModal, RenewModal, SignedCopyModal, SuspendModal, TerminateModal,
} from '../../components/Clients/Billing/ContractModals';
import {
  EmptyNote, Metric, ReasonModal, Section, StatusPill, TabStrip, barBtn, iconBtnDanger,
} from '../../components/Clients/Billing/BillingUi';
import {
  CONTRACT_TYPE_OPTIONS, FREQUENCY_OPTIONS, INTEREST_BASIS_OPTIONS, RECOGNITION_OPTIONS, RENEWAL_STAGES, TIMING_OPTIONS,
  daysUntil, invalidateList, lineAmounts, money, optionLabel, todayIso, userName,
} from '../../components/Clients/Billing/billingShared';
import { contractsApi, apiError } from '../../services/clientsBillingApi';
import { fmtDate } from '../../utils/dates';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'schedule', label: 'Billing schedule' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'versions', label: 'Versions' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'documents', label: 'Documents' },
  { key: 'renewal', label: 'Renewal' },
];

const KV = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1 text-xs last:border-b-0">
    <span className="shrink-0 text-slate-500">{label}</span>
    <span className="text-right font-semibold text-slate-900">{children ?? '—'}</span>
  </div>
);

const OverviewTab = ({ contract }) => {
  const cur = contract.currency || 'KES';
  const lines = contract.lines || [];
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
      {(contract.approvalReasons?.length > 0 && contract.status === 'pending_approval') && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          <b className="uppercase tracking-wide">Needs approval:</b> {contract.approvalReasons.join('; ')}
        </div>
      )}
      {contract.rejectionReason && contract.status === 'draft' && (
        <div className="border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800"><b>Rejected:</b> {contract.rejectionReason}</div>
      )}
      {contract.status === 'suspended' && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900"><b>Suspended</b> from {fmtDate(contract.suspendedAt)}: {contract.suspensionReason}</div>
      )}
      {contract.status === 'terminated' && (
        <div className="border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">
          <b>Terminated</b> effective {fmtDate(contract.terminationEffectiveDate)}{contract.terminationReason ? `: ${contract.terminationReason}` : ''}
          {Number(contract.earlyTerminationFee) > 0 ? ` · early termination fee ${cur} ${money(contract.earlyTerminationFee)}` : ''}
        </div>
      )}

      <Section title="Lines" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[11px]">
            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-1">Item</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Unit price</th>
                <th className="px-2 py-1 text-right">Disc</th>
                <th className="px-2 py-1">Tax</th>
                <th className="px-2 py-1">Billing</th>
                <th className="px-2 py-1">Recognition</th>
                <th className="px-2 py-1 text-right">Net / period</th>
                <th className="px-3 py-1 text-right">Total / period</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => {
                const a = lineAmounts({ ...l, taxMode: contract.taxMode });
                return (
                  <tr key={l.lineKey || l._id}>
                    <td className="px-3 py-1.5">
                      <span className="font-semibold text-slate-900">{l.itemName}</span>
                      {l.description && <span className="block text-[10px] text-slate-500">{l.description}</span>}
                      {(l.startDate || l.endDate) && <span className="block text-[10px] text-slate-500">{fmtDate(l.startDate)} – {fmtDate(l.endDate)}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.discountPercent ? `${l.discountPercent}%` : '—'}</td>
                    <td className="px-2 py-1.5">{l.taxCodeName || l.taxCodeKey || '—'}</td>
                    <td className="px-2 py-1.5">{optionLabel(FREQUENCY_OPTIONS, l.billingFrequency)}{l.billingFrequency !== 'one_off' ? ` · ${optionLabel(TIMING_OPTIONS, l.billingTiming)}` : ''}</td>
                    <td className="px-2 py-1.5">{optionLabel(RECOGNITION_OPTIONS, l.revenueRecognition)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(a.net)}</td>
                    <td className="px-3 py-1.5 text-right font-bold tabular-nums">{money(a.total)}</td>
                  </tr>
                );
              })}
              {!lines.length && <tr><td colSpan={9}><EmptyNote>No priced lines — legacy contract value {cur} {money(contract.currentValue || contract.baseValue)}.</EmptyNote></td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-2 lg:grid-cols-3">
        <Section title="Term">
          <KV label="Start">{fmtDate(contract.startDate)}</KV>
          <KV label="End">{contract.openEnded ? 'Open-ended' : fmtDate(contract.endDate)}</KV>
          <KV label="Minimum term">{contract.minimumTermMonths ? `${contract.minimumTermMonths} months` : 'None'}</KV>
          <KV label="Notice period">{contract.noticePeriodDays ?? 0} days</KV>
          <KV label="Auto-renew">{contract.autoRenew ? `Yes · ${contract.renewalTermMonths} months` : 'No'}</KV>
          <KV label="Deposit">{Number(contract.depositAmount) > 0 ? `${cur} ${money(contract.depositAmount)}` : '—'}</KV>
        </Section>
        <Section title="Billing">
          <KV label="Auto-bill">{contract.autoBill ? 'Yes — scheduled billing run' : 'No — manual runs only'}</KV>
          <KV label="Billing day">{contract.billingDay || 'Start-date anniversary'}</KV>
          <KV label="Proration">{contract.prorationRule === 'daily' ? 'Daily' : 'None'}</KV>
          <KV label="Tax mode">{contract.taxMode === 'inclusive' ? 'Prices include tax' : 'Prices exclude tax'}</KV>
          <KV label="Payment terms">{contract.paymentTermsDays ?? 30} days</KV>
          <KV label="PO number">{contract.poNumber || '—'}</KV>
        </Section>
        <Section title="Escalation & interest">
          <KV label="Escalation">{Number(contract.escalationPercent) > 0 ? `${contract.escalationPercent}% every ${contract.escalationPeriodYears} yr` : 'None'}</KV>
          <KV label="Next escalation">{Number(contract.escalationPercent) > 0 ? fmtDate(contract.nextEscalationDate) : '—'}</KV>
          <KV label="Last escalated">{fmtDate(contract.lastEscalatedAt)}</KV>
          <KV label="Late interest">{Number(contract.latePaymentInterestPercent) > 0 ? `${contract.latePaymentInterestPercent} ${optionLabel(INTEREST_BASIS_OPTIONS, contract.latePaymentInterestBasis)}` : 'None'}</KV>
          <KV label="Interest grace">{contract.latePaymentGraceDays ?? 0} days</KV>
          <KV label="Linked property">{contract.property?.propertyName || '—'}</KV>
        </Section>
      </div>

      {(contract.terms || contract.slaText) && (
        <div className="grid gap-2 lg:grid-cols-2">
          <Section title="Terms"><p className="whitespace-pre-wrap text-xs text-slate-800">{contract.terms || '—'}</p></Section>
          <Section title="Service levels"><p className="whitespace-pre-wrap text-xs text-slate-800">{contract.slaText || '—'}</p></Section>
        </div>
      )}
    </div>
  );
};

const DocumentsTab = ({ contract, canEdit, onAdd, onSigned, onChanged }) => {
  const [removing, setRemoving] = useState(null);
  const pdf = async (preview) => {
    try { await contractsApi.pdf(contract._id, { preview, number: contract.contractNumber }); } catch (err) { toast.error(apiError(err, 'Could not generate the PDF')); }
  };
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
      <div className="grid gap-2 lg:grid-cols-2">
        <Section title="Generated contract">
          <p className="mb-2 text-xs text-slate-600">The contract document generated from the current terms, lines and SLA (v{contract.version || 1}).</p>
          <div className="flex gap-1.5">
            <button type="button" className={barBtn} onClick={() => pdf(true)}><FaPrint size={10} /> Print</button>
            <button type="button" className={barBtn} onClick={() => pdf(false)}><FaFilePdf size={10} /> Download PDF</button>
          </div>
        </Section>
        <Section title="Signatures">
          <KV label="Client signed">{contract.signedByClientAt ? `${fmtDate(contract.signedByClientAt)}${contract.signedByClientName ? ` · ${contract.signedByClientName}` : ''}` : 'Not yet'}</KV>
          <KV label="We signed">{contract.signedByUsAt ? fmtDate(contract.signedByUsAt) : 'Not yet'}</KV>
          <KV label="Signed copy">
            {contract.signedDocumentUrl
              ? <a href={contract.signedDocumentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#0B3B2E] hover:underline">Open <FaExternalLinkAlt size={9} /></a>
              : 'Not recorded'}
          </KV>
          {canEdit && <button type="button" className={`${barBtn} mt-1.5`} onClick={onSigned}><FaSignature size={10} /> Record signed copy</button>}
        </Section>
      </div>
      <Section title="Attachments" bodyClass="p-0">
        <table className="w-full text-[11px]">
          <tbody className="divide-y divide-slate-100">
            {(contract.documents || []).map((d) => (
              <tr key={d._id}>
                <td className="px-3 py-1.5"><a href={d.url} target="_blank" rel="noreferrer" className="font-semibold text-[#0B3B2E] hover:underline">{d.name || 'Document'}</a></td>
                <td className="px-3 py-1.5 capitalize text-slate-600">{String(d.kind || 'other').replace(/_/g, ' ')}</td>
                <td className="px-3 py-1.5 text-slate-600">{fmtDate(d.uploadedAt)}</td>
                <td className="w-10 px-2 py-1.5 text-right">
                  {canEdit && <button type="button" className={iconBtnDanger} title="Remove" onClick={() => setRemoving(d)}><FaTrash size={11} /></button>}
                </td>
              </tr>
            ))}
            {!(contract.documents || []).length && <tr><td colSpan={4}><EmptyNote>No attachments yet.</EmptyNote></td></tr>}
          </tbody>
        </table>
        {canEdit && (
          <div className="border-t border-slate-100 px-3 py-1.5">
            <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline"><FaPlus size={9} /> Attach document</button>
          </div>
        )}
      </Section>
      {removing && (
        <ReasonModal
          title="Remove attachment"
          message={`Remove "${removing.name}" from this contract?`}
          withReason={false}
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await contractsApi.removeDocument(contract._id, removing._id);
              toast.success('Attachment removed');
              setRemoving(null);
              onChanged();
            } catch (err) {
              toast.error(apiError(err, 'Could not remove the attachment'));
            }
          }}
        />
      )}
    </div>
  );
};

const RenewalTab = ({ contract, canEdit, onRenew, onChanged }) => {
  const navigate = useNavigate();
  const [lostReason, setLostReason] = useState(contract.lostReason || '');
  const [busy, setBusy] = useState('');
  const days = contract.openEnded ? null : daysUntil(contract.endDate);
  const currentIdx = RENEWAL_STAGES.findIndex((s) => s.value === contract.renewalStage);
  const setStage = async (stage) => {
    if (stage === 'lost' && !lostReason.trim()) { toast.error('Add the reason the renewal was lost'); return; }
    setBusy(stage);
    try {
      await contractsApi.renewalStage(contract._id, { renewalStage: stage, ...(stage === 'lost' ? { lostReason: lostReason.trim() } : {}) });
      toast.success('Renewal stage updated');
      onChanged();
    } catch (err) {
      toast.error(apiError(err, 'Could not update the renewal stage'));
    } finally {
      setBusy('');
    }
  };
  const reminders = contract.remindersSent || {};
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
      <Section title="Renewal pipeline">
        <div className="flex flex-wrap items-stretch gap-0">
          {RENEWAL_STAGES.map((s, i) => {
            const active = s.value === contract.renewalStage;
            const done = currentIdx >= 0 && i < currentIdx && !['lost'].includes(s.value);
            return (
              <button
                key={s.value}
                type="button"
                disabled={!canEdit || Boolean(busy)}
                onClick={() => setStage(s.value)}
                className={`-ml-px flex-1 border px-3 py-2 text-left text-xs font-bold first:ml-0 disabled:cursor-not-allowed ${active
                  ? (s.value === 'lost' ? 'border-red-600 bg-red-600 text-white' : 'border-[#0B3B2E] bg-[#0B3B2E] text-white')
                  : done ? 'border-slate-300 bg-[#0B3B2E]/5 text-[#0B3B2E]' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                <span className="block text-[9px] font-black uppercase tracking-widest opacity-70">Step {i + 1}</span>
                {busy === s.value ? 'Saving…' : s.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-bold text-slate-900">Lost reason</label>
            <input className="h-7 w-full border border-slate-300 px-2.5 text-sm outline-none focus:border-[#0B3B2E]" value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Required when marking the renewal lost" disabled={!canEdit} />
          </div>
          <div className="flex items-end">
            {canEdit && ['active', 'pending_renewal', 'expired', 'suspended'].includes(contract.status) && (
              <button type="button" className={barBtn} onClick={onRenew}><FaRedo size={10} /> Renew now</button>
            )}
          </div>
        </div>
      </Section>
      <div className="grid gap-2 lg:grid-cols-2">
        <Section title="Term">
          <KV label="Ends">{contract.openEnded ? 'Open-ended' : fmtDate(contract.endDate)}</KV>
          <KV label="Days left">{days == null ? '—' : days < 0 ? `Ended ${Math.abs(days)} days ago` : `${days} days`}</KV>
          <KV label="Notice period">{contract.noticePeriodDays ?? 0} days</KV>
          <KV label="Auto-renew">{contract.autoRenew ? `Yes · ${contract.renewalTermMonths} months` : 'No'}</KV>
        </Section>
        <Section title="Reminders & history">
          <KV label="90-day reminder">{fmtDate(reminders.days90)}</KV>
          <KV label="60-day reminder">{fmtDate(reminders.days60)}</KV>
          <KV label="30-day reminder">{fmtDate(reminders.days30)}</KV>
          <KV label="7-day reminder">{fmtDate(reminders.days7)}</KV>
          <KV label="Renews">{contract.supersedesContractId ? <button type="button" className="text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/contracts/${contract.supersedesContractId}`)}>Previous contract</button> : '—'}</KV>
          <KV label="Renewed as">{contract.supersededByContractId ? <button type="button" className="text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/contracts/${contract.supersededByContractId}`)}>Renewal contract</button> : '—'}</KV>
        </Section>
      </div>
    </div>
  );
};

const ContractDetail = () => {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canEdit = hasCompanyPermission(user, company, 'clients', 'edit');
  const canApprove = hasCompanyPermission(user, company, 'clients', 'approve');
  const canDelete = hasCompanyPermission(user, company, 'clients', 'delete');

  const [tab, setTab] = useState(location.state?.tab || 'overview');
  const [contract, setContract] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [schedule, setSchedule] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    contractsApi.get(id)
      .then((res) => { if (alive) { setContract(res.data?.contract || res.data?.data); setLoadError(''); } })
      .catch((err) => { if (alive) setLoadError(apiError(err, 'Could not load the contract')); });
    return () => { alive = false; };
  }, [id, tick]);

  const loadSchedule = useCallback(async (refresh = false) => {
    try {
      const res = await contractsApi.schedule(id, { refresh });
      setSchedule({ rows: res.data?.rows || [], summary: res.data?.summary || {} });
    } catch (err) {
      toast.error(apiError(err, 'Could not load the billing schedule'));
    } finally {
      setScheduleLoading(false);
    }
  }, [id]);
  useEffect(() => { loadSchedule(false); }, [loadSchedule, tick]);

  const reload = useCallback(() => { invalidateList(`contracts:${businessId}`); setTick((t) => t + 1); }, [businessId]);

  const nextInvoice = useMemo(() => {
    const rows = (schedule?.rows || []).filter((r) => r.status === 'scheduled');
    if (!rows.length) return null;
    const date = rows.reduce((m, r) => (String(r.billingDate) < m ? String(r.billingDate) : m), String(rows[0].billingDate));
    const day = date.slice(0, 10);
    const total = rows.filter((r) => String(r.billingDate).slice(0, 10) === day).reduce((s, r) => s + Number(r.totalAmount || 0), 0);
    return { date, total };
  }, [schedule]);

  const simple = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      const res = await fn();
      if (res?.data?.requiresApproval) toast.info(`Submitted for approval — ${(res.data.approvalReasons || []).join('; ')}`, { autoClose: 8000 });
      else toast.success(res?.data?.message || okMsg);
      reload();
      return res;
    } catch (err) {
      toast.error(apiError(err));
      return null;
    } finally {
      setBusy('');
    }
  };

  const pdf = async (preview) => {
    try { await contractsApi.pdf(id, { preview, number: contract?.contractNumber }); } catch (err) { toast.error(apiError(err, 'Could not generate the PDF')); }
  };

  if (!contract) {
    return (
      <ClientsShell>
        <div className="flex flex-1 items-center justify-center gap-2 text-slate-400">
          {loadError ? <span className="text-xs font-semibold text-red-600">{loadError}</span> : <><Spinner size="sm" /><span className="text-xs font-semibold">Loading contract…</span></>}
        </div>
      </ClientsShell>
    );
  }

  const s = contract.status;
  const cur = contract.currency || 'KES';
  const isDraft = s === 'draft';
  const isPending = s === 'pending_approval';
  const isLive = ['active', 'pending_renewal', 'suspended'].includes(s);
  const clientId = contract.client?._id || contract.client;
  const ownerName = userName(contract.owner);

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <ListToolbar>
          <ListToolbar.Button variant="outline" icon={FaArrowLeft} onClick={() => navigate('/clients/contracts')}>Contracts</ListToolbar.Button>
          <ListToolbar.Divider />
          {canEdit && (isDraft || isPending) && <ListToolbar.Button variant="outline" icon={FaEdit} onClick={() => navigate(`/clients/contracts/${id}/edit`, { state: { tabTitle: `Edit ${contract.contractNumber}` } })}>Edit</ListToolbar.Button>}
          {canEdit && isDraft && <ListToolbar.Button icon={FaPaperPlane} disabled={Boolean(busy)} onClick={() => simple('submit', () => contractsApi.submit(id), 'Submitted')}>{busy === 'submit' ? 'Submitting…' : 'Submit'}</ListToolbar.Button>}
          {canEdit && isDraft && <ListToolbar.Button variant="outlineOk" icon={FaCheck} onClick={() => setModal('activate')}>Activate</ListToolbar.Button>}
          {canApprove && isPending && <ListToolbar.Button variant="outlineOk" icon={FaCheck} onClick={() => setModal('approve')}>Approve</ListToolbar.Button>}
          {canApprove && isPending && <ListToolbar.Button variant="outline" icon={FaTimes} onClick={() => setModal('reject')}>Reject</ListToolbar.Button>}
          {canEdit && isLive && <ListToolbar.Button variant="dark" icon={FaEdit} onClick={() => navigate(`/clients/contracts/${id}/edit`, { state: { tabTitle: `Amend ${contract.contractNumber}` } })}>Amend</ListToolbar.Button>}
          {canEdit && ['active', 'pending_renewal'].includes(s) && <ListToolbar.Button variant="outline" icon={FaPause} onClick={() => setModal('suspend')}>Suspend</ListToolbar.Button>}
          {canEdit && s === 'suspended' && <ListToolbar.Button variant="outlineOk" icon={FaPlay} onClick={() => setModal('resume')}>Resume</ListToolbar.Button>}
          {canEdit && ['active', 'pending_renewal', 'expired', 'suspended'].includes(s) && <ListToolbar.Button variant="outline" icon={FaRedo} onClick={() => setModal('renew')}>Renew</ListToolbar.Button>}
          {canEdit && (isLive || s === 'expired') && <ListToolbar.Button variant="danger" icon={FaStop} onClick={() => setModal('terminate')}>Terminate</ListToolbar.Button>}
          {canDelete && (isDraft || isPending) && <ListToolbar.Button variant="danger" icon={FaBan} onClick={() => setModal('cancel')}>Cancel</ListToolbar.Button>}
          <ListToolbar.Divider />
          <ListToolbar.Button variant="outline" icon={FaPrint} onClick={() => pdf(true)}>Print</ListToolbar.Button>
          <ListToolbar.Button variant="outline" icon={FaFilePdf} onClick={() => pdf(false)}>PDF</ListToolbar.Button>
          {canEdit && <ListToolbar.Button variant="outline" icon={FaSignature} onClick={() => setModal('signed')}>Signed copy</ListToolbar.Button>}
        </ListToolbar>

        <div className="flex-none border-b border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <FaFileContract className="text-[#0B3B2E]" size={14} />
            <span className="text-base font-black text-slate-900">{contract.contractNumber}</span>
            <span className="text-[11px] font-bold text-slate-500">v{contract.version || 1}</span>
            <StatusPill status={s} />
            {contract.pendingVersion && <StatusPill status="pending_approval" label={`v${contract.pendingVersion.version} awaiting approval`} />}
            {contract.signedByClientAt && <span className="border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500" title={`Client signed ${fmtDate(contract.signedByClientAt)}`}>SIGNED</span>}
            <span className="text-xs text-slate-600">
              <button type="button" className="font-bold text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/${clientId}`, { state: { tabTitle: contract.client?.name } })}>{contract.client?.name}</button>
              {contract.client?.clientCode ? ` · ${contract.client.clientCode}` : ''}
              {' · '}{optionLabel(CONTRACT_TYPE_OPTIONS, contract.contractType)}
              {ownerName ? ` · Owner ${ownerName}` : ''}
            </span>
            {contract.description && <span className="truncate text-xs text-slate-500">— {contract.description}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-y-1">
            <Metric label="MRR" value={`${cur} ${money(contract.mrr)}`} />
            <Metric label="ACV" value={`${cur} ${money(contract.acv)}`} />
            <Metric label="TCV" value={`${cur} ${money(contract.tcv)}`} />
            <Metric label="Term" value={`${fmtDate(contract.startDate)} – ${contract.openEnded ? 'Open' : fmtDate(contract.endDate)}`} />
            <Metric
              label="Next invoice"
              value={nextInvoice ? fmtDate(nextInvoice.date) : '—'}
              sub={nextInvoice ? `${cur} ${money(nextInvoice.total)}${String(nextInvoice.date).slice(0, 10) < todayIso() ? ' · due for billing' : ''}` : (isLive ? 'Nothing scheduled' : '')}
            />
          </div>
        </div>

        <TabStrip tabs={TABS} active={tab} onChange={setTab} />

        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'overview' && <OverviewTab contract={contract} />}
          {tab === 'schedule' && (
            <ContractScheduleTab contract={contract} schedule={schedule} loading={scheduleLoading} onReload={loadSchedule} canEdit={canEdit} />
          )}
          {tab === 'invoices' && <ClientInvoicesPanel clientId={clientId} contractId={contract._id} />}
          {tab === 'versions' && <ContractVersionsTab contract={contract} canApprove={canApprove} onChanged={reload} />}
          {tab === 'revenue' && <div className="flex min-h-0 flex-1 flex-col"><RevenueScheduleTable contractId={contract._id} /></div>}
          {tab === 'documents' && <DocumentsTab contract={contract} canEdit={canEdit} onAdd={() => setModal('doc')} onSigned={() => setModal('signed')} onChanged={reload} />}
          {tab === 'renewal' && <RenewalTab key={contract.updatedAt} contract={contract} canEdit={canEdit} onRenew={() => setModal('renew')} onChanged={reload} />}
        </div>
      </div>

      {modal === 'activate' && (
        <ReasonModal title={`Activate ${contract.contractNumber}`} message="Activate without submitting for approval? The billing schedule is generated from the start date. Contracts above the approval threshold must be submitted instead." withReason={false} danger={false} confirmLabel="Activate"
          onClose={() => setModal('')} onConfirm={async () => { await simple('activate', () => contractsApi.activate(id), 'Contract activated'); setModal(''); }} />
      )}
      {modal === 'approve' && (
        <ReasonModal title={`Approve ${contract.contractNumber}`} message={<>Approve and activate this contract?{contract.approvalReasons?.length ? <span className="mt-1 block text-slate-500">{contract.approvalReasons.join('; ')}</span> : null}</>} withReason={false} danger={false} confirmLabel="Approve & activate"
          onClose={() => setModal('')} onConfirm={async () => { await simple('approve', () => contractsApi.approve(id), 'Contract approved'); setModal(''); }} />
      )}
      {modal === 'reject' && (
        <ReasonModal title={`Reject ${contract.contractNumber}`} message="The contract goes back to draft with your reason." confirmLabel="Reject"
          onClose={() => setModal('')} onConfirm={async (reason) => { await simple('reject', () => contractsApi.reject(id, reason), 'Contract rejected'); setModal(''); }} />
      )}
      {modal === 'cancel' && (
        <ReasonModal title={`Cancel ${contract.contractNumber}`} message="Cancel this draft? It will never bill. (Live contracts are terminated instead.)" required={false} confirmLabel="Cancel contract"
          onClose={() => setModal('')} onConfirm={async (reason) => { await simple('cancel', () => contractsApi.cancel(id, reason), 'Contract cancelled'); setModal(''); }} />
      )}
      {modal === 'suspend' && <SuspendModal contract={contract} onClose={() => setModal('')} onDone={reload} />}
      {modal === 'resume' && <SuspendModal contract={contract} resume onClose={() => setModal('')} onDone={reload} />}
      {modal === 'terminate' && <TerminateModal contract={contract} onClose={() => setModal('')} onDone={reload} />}
      {modal === 'renew' && <RenewModal contract={contract} onClose={() => { setModal(''); reload(); }} />}
      {modal === 'signed' && <SignedCopyModal contract={contract} onClose={() => setModal('')} onDone={reload} />}
      {modal === 'doc' && <AddDocumentModal contract={contract} onClose={() => setModal('')} onDone={reload} />}
    </ClientsShell>
  );
};

export default ContractDetail;
