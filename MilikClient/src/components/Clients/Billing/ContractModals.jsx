// Contract lifecycle modals: terminate, renew, suspend/resume, signed copy, attach document.
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Modal from '../../common/Modal';
import AppSelect from '../../common/AppSelect';
import CurrencyInput from '../../common/CurrencyInput';
import { fmtDate } from '../../../utils/dates';
import { contractsApi, apiError } from '../../../services/clientsBillingApi';
import { UploadButton } from '../clientUi';
import { Required, labelClass, inputClass, textareaClass, footerBtn, footerPrimary } from './BillingUi';
import { addDaysIso, addMonthsIso, isoDate, money, monthsBetween, taxOf, todayIso, useBillingSettings } from './billingShared';

const dangerBtn = 'inline-flex h-8 items-center bg-red-600 px-4 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50';

export const TerminateModal = ({ contract, onClose, onDone }) => {
  const navigate = useNavigate();
  const { taxOptions, taxCodes, defaultTaxCodeKey } = useBillingSettings();
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('');
  const [taxKey, setTaxKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const feeTaxKey = taxKey || defaultTaxCodeKey;

  const start = isoDate(contract.startDate);
  const served = effectiveDate && effectiveDate > start ? monthsBetween(start, addDaysIso(effectiveDate, -1)) : 0;
  const minTerm = Number(contract.minimumTermMonths || 0);
  const belowMin = minTerm > 0 && served < minTerm;
  const feeTax = useMemo(() => {
    const { taxType, taxRate } = taxOf(taxCodes, feeTaxKey);
    return taxType === 'vat' ? Math.round(Number(fee || 0) * taxRate) / 100 : 0;
  }, [taxCodes, feeTaxKey, fee]);

  const submit = async () => {
    if (!effectiveDate) { toast.error('Effective date is required'); return; }
    if (effectiveDate < start) { toast.error('Effective date cannot be before the contract start'); return; }
    if (!reason.trim()) { toast.error('A termination reason is required'); return; }
    setBusy(true);
    try {
      const res = await contractsApi.terminate(contract._id, {
        effectiveDate, reason: reason.trim(), earlyTerminationFee: Number(fee || 0), feeTaxCodeKey: Number(fee) > 0 ? feeTaxKey : undefined,
      });
      toast.success(res.data?.message || 'Contract terminated');
      setResult({ invoice: res.data?.terminationInvoice || null, belowMinimumTerm: Boolean(res.data?.belowMinimumTerm) });
      onDone();
    } catch (err) {
      toast.error(apiError(err, 'Could not terminate the contract'));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title={`${contract.contractNumber} terminated`} size="sm" onClose={onClose} footer={<button type="button" className={footerPrimary} onClick={onClose}>Done</button>}>
        <div className="space-y-2 text-xs text-slate-700">
          <p>Billing stops from <b>{fmtDate(effectiveDate)}</b>. Periods already invoiced in advance stay invoiced — credit them if a refund is due.</p>
          {result.belowMinimumTerm && <p className="border border-amber-300 bg-amber-50 px-2 py-1.5 font-semibold text-amber-900">Terminated inside the {minTerm}-month minimum term.</p>}
          {result.invoice ? (
            <p>
              Early termination fee raised as draft invoice{' '}
              <button type="button" className="font-black text-[#0B3B2E] hover:underline" onClick={() => { onClose(); navigate(`/clients/invoices/${result.invoice._id}`, { state: { tabTitle: result.invoice.invoiceNumber } }); }}>
                {result.invoice.invoiceNumber}
              </button>{' '}({money(result.invoice.total)}). Review and post it from the invoice.
            </p>
          ) : <p>No termination fee was charged.</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Terminate ${contract.contractNumber}`} size="md" onClose={busy ? () => {} : onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={dangerBtn} onClick={submit} disabled={busy || !reason.trim()}>{busy ? 'Terminating…' : 'Terminate contract'}</button>
      </>
    )}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <label className={labelClass}>Effective date<Required /></label>
          <input type="date" className={inputClass} value={effectiveDate} min={start} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
        <div className="flex items-end pb-1 text-[11px] text-slate-600">
          Served {served} of {minTerm || '—'} minimum months · notice {contract.noticePeriodDays ?? 0} days
        </div>
        {belowMin && (
          <p className="col-span-2 border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-900">
            This is inside the {minTerm}-month minimum term — consider an early termination fee.
          </p>
        )}
        <div>
          <label className={labelClass}>Early termination fee</label>
          <CurrencyInput prefix={contract.currency || 'KES'} value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Fee tax code</label>
          <AppSelect size="sm" value={feeTaxKey} onChange={(v) => setTaxKey(v || '')} options={taxOptions} disabled={!(Number(fee) > 0)} />
        </div>
        {Number(fee) > 0 && (
          <p className="col-span-2 text-[11px] text-slate-600">
            A draft invoice of <b className="tabular-nums">{money(Number(fee) + feeTax)}</b> ({money(fee)} + {money(feeTax)} tax) will be raised for review.
          </p>
        )}
        <div className="col-span-2">
          <label className={labelClass}>Reason<Required /></label>
          <textarea rows={3} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client moved to an in-house team" />
        </div>
      </div>
    </Modal>
  );
};

export const RenewModal = ({ contract, onClose }) => {
  const navigate = useNavigate();
  const defaultStart = contract.endDate ? addDaysIso(isoDate(contract.endDate), 1) : todayIso();
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(addDaysIso(addMonthsIso(defaultStart, Number(contract.renewalTermMonths || 12)), -1));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!startDate || !endDate || endDate <= startDate) { toast.error('Enter a valid renewal period'); return; }
    setBusy(true);
    try {
      const res = await contractsApi.renew(contract._id, { startDate, endDate, notes: notes.trim() });
      const next = res.data?.contract;
      toast.success(`Renewed as ${next?.contractNumber || 'a new contract'} — review and submit it`);
      onClose();
      if (next?._id) navigate(`/clients/contracts/${next._id}`, { state: { tabTitle: next.contractNumber } });
    } catch (err) {
      toast.error(apiError(err, 'Could not renew the contract'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Renew ${contract.contractNumber}`} size="sm" onClose={busy ? () => {} : onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={submit} disabled={busy}>{busy ? 'Renewing…' : 'Create renewal'}</button>
      </>
    )}>
      <p className="mb-2 text-xs text-slate-600">
        Creates a new contract with the same lines{Number(contract.escalationPercent) > 0 ? `, uplifted by the ${contract.escalationPercent}% escalation` : ''}. This contract is marked renewed.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>New start<Required /></label>
          <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>New end<Required /></label>
          <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea rows={2} className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

/** Suspend (reason + from date) or resume (from date). */
export const SuspendModal = ({ contract, resume = false, onClose, onDone }) => {
  const [date, setDate] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!resume && !reason.trim()) { toast.error('A suspension reason is required'); return; }
    setBusy(true);
    try {
      const res = resume
        ? await contractsApi.resume(contract._id, { effectiveDate: date })
        : await contractsApi.suspend(contract._id, { effectiveDate: date, reason: reason.trim() });
      toast.success(resume
        ? res.data?.message || 'Contract resumed'
        : `Contract suspended — ${res.data?.heldPeriods ?? 0} billing period(s) held`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(apiError(err, `Could not ${resume ? 'resume' : 'suspend'} the contract`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${resume ? 'Resume' : 'Suspend'} ${contract.contractNumber}`} size="sm" onClose={busy ? () => {} : onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={resume ? footerPrimary : dangerBtn} onClick={submit} disabled={busy || (!resume && !reason.trim())}>
          {busy ? 'Working…' : resume ? 'Resume billing' : 'Suspend'}
        </button>
      </>
    )}>
      <p className="mb-2 text-xs text-slate-600">
        {resume ? 'Periods held by the suspension from this date are released for billing.' : 'Billing periods from this date are held until the contract is resumed.'}
      </p>
      <label className={labelClass}>{resume ? 'Resume from' : 'Suspend from'}<Required /></label>
      <input type="date" className={`${inputClass} mb-2`} value={date} onChange={(e) => setDate(e.target.value)} />
      {!resume && (
        <>
          <label className={labelClass}>Reason<Required /></label>
          <textarea rows={3} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client requested a pause during relocation" />
        </>
      )}
    </Modal>
  );
};

const isUrl = (v) => /^https?:\/\/\S+$/i.test(String(v || '').trim());

/** Record the signed copy (link to the scanned document) and who signed when. */
export const SignedCopyModal = ({ contract, onClose, onDone }) => {
  const [form, setForm] = useState({
    url: '', name: 'Signed contract', signedByClientName: contract.signedByClientName || '',
    signedByClientAt: isoDate(contract.signedByClientAt), signedByUsAt: isoDate(contract.signedByUsAt),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    if (form.url && !isUrl(form.url)) { toast.error('The document link must start with http:// or https://'); return; }
    if (!form.url && !form.signedByClientAt && !form.signedByUsAt) { toast.error('Add the signed document link and/or a signature date'); return; }
    setBusy(true);
    try {
      await contractsApi.signedCopy(contract._id, {
        url: form.url.trim() || undefined, name: form.name.trim(), signedByClientName: form.signedByClientName.trim(),
        signedByClientAt: form.signedByClientAt || undefined, signedByUsAt: form.signedByUsAt || undefined,
      });
      toast.success('Signed copy recorded');
      onDone();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not record the signed copy'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Signed copy — ${contract.contractNumber}`} size="md" onClose={busy ? () => {} : onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </>
    )}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div className="col-span-2">
          <label className={labelClass}>Signed document</label>
          <div className="flex items-center gap-2">
            <input className={inputClass} value={form.url} onChange={set('url')} placeholder="Upload the signed PDF, or paste a link" />
            <UploadButton className="shrink-0" label="Upload" onUploaded={(doc) => setForm((f) => ({ ...f, url: doc.url }))} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Document name</label>
          <input className={inputClass} value={form.name} onChange={set('name')} maxLength={80} />
        </div>
        <div>
          <label className={labelClass}>Signed by (client)</label>
          <input className={inputClass} value={form.signedByClientName} onChange={set('signedByClientName')} placeholder="Name, title" maxLength={80} />
        </div>
        <div>
          <label className={labelClass}>Client signed on</label>
          <input type="date" className={inputClass} value={form.signedByClientAt} onChange={set('signedByClientAt')} />
        </div>
        <div>
          <label className={labelClass}>We signed on</label>
          <input type="date" className={inputClass} value={form.signedByUsAt} onChange={set('signedByUsAt')} />
        </div>
      </div>
    </Modal>
  );
};

const DOC_KINDS = [
  { value: 'amendment', label: 'Amendment' },
  { value: 'signed_contract', label: 'Signed contract' },
  { value: 'other', label: 'Other' },
];

export const AddDocumentModal = ({ contract, onClose, onDone }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState('other');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) { toast.error('Name the document'); return; }
    if (!isUrl(url)) { toast.error('Enter a link starting with http:// or https://'); return; }
    setBusy(true);
    try {
      await contractsApi.addDocument(contract._id, { name: name.trim(), url: url.trim(), kind });
      toast.success('Document attached');
      onDone();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not attach the document'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Attach document" size="sm" onClose={busy ? () => {} : onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Attach'}</button>
      </>
    )}>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className={labelClass}>Name<Required /></label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Signed SOW — phase 2" />
        </div>
        <div>
          <label className={labelClass}>Kind</label>
          <AppSelect size="sm" value={kind} onChange={(v) => setKind(v || 'other')} options={DOC_KINDS} />
        </div>
        <div className="col-span-3">
          <label className={labelClass}>File<Required /></label>
          <div className="flex items-center gap-2">
            <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Upload a file, or paste a link" />
            <UploadButton className="shrink-0" label="Upload" onUploaded={(doc) => { setUrl(doc.url); if (!name.trim()) setName(doc.name); }} />
          </div>
        </div>
      </div>
    </Modal>
  );
};
