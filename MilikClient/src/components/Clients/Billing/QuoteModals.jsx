// Quote conversions: accepted (or open) quote -> draft contract / draft invoice.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Modal from '../../common/Modal';
import AppSelect from '../../common/AppSelect';
import { quotesApi, apiError } from '../../../services/clientsBillingApi';
import { Required, labelClass, inputClass, footerBtn, footerPrimary } from './BillingUi';
import { CONTRACT_TYPE_OPTIONS, addDaysIso, addMonthsIso, money, todayIso } from './billingShared';

export const ConvertToContractModal = ({ quote, defaultTermsDays = 30, onClose, onDone }) => {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(addDaysIso(addMonthsIso(todayIso(), 12), -1));
  const [openEnded, setOpenEnded] = useState(false);
  const [contractType, setContractType] = useState('retainer');
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(defaultTermsDays));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!startDate) { toast.error('Start date is required'); return; }
    if (!openEnded && (!endDate || endDate <= startDate)) { toast.error('End date must be after the start date (or tick open-ended)'); return; }
    setBusy(true);
    try {
      const res = await quotesApi.toContract(quote._id, { startDate, endDate: openEnded ? null : endDate, openEnded, contractType, paymentTermsDays: Number(paymentTermsDays || 0) });
      const contract = res.data?.contract;
      toast.success(`Draft contract ${contract?.contractNumber || ''} created — review and submit it`);
      onDone?.();
      onClose();
      if (contract?._id) navigate(`/clients/contracts/${contract._id}/edit`, { state: { tabTitle: `Edit ${contract.contractNumber}` } });
    } catch (err) {
      toast.error(apiError(err, 'Could not convert the quote'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${quote.quoteNumber} → contract`} size="md" onClose={busy ? () => {} : onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create draft contract'}</button>
      </>
    )}>
      <p className="mb-2 text-xs text-slate-600">
        Creates a draft contract for {quote.client?.name || 'the client'} with the quote's {quote.lines?.length || 0} line(s) (recurring {money(quote.recurringMonthly)}/month). You can edit it before submitting.
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <label className={labelClass}>Contract type</label>
          <AppSelect size="sm" value={contractType} onChange={(v) => setContractType(v || 'retainer')} options={CONTRACT_TYPE_OPTIONS} />
        </div>
        <div>
          <label className={labelClass}>Payment terms (days)</label>
          <input className={inputClass} inputMode="numeric" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <div>
          <label className={labelClass}>Start<Required /></label>
          <input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={`${labelClass} flex items-center justify-between`}>
            <span>End{!openEnded && <Required />}</span>
            <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600"><input type="checkbox" className="accent-[#0B3B2E]" checked={openEnded} onChange={(e) => setOpenEnded(e.target.checked)} /> Open-ended</label>
          </label>
          <input type="date" className={inputClass} value={openEnded ? '' : endDate} disabled={openEnded} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

export const ConvertToInvoiceModal = ({ quote, defaultTermsDays = 30, onClose, onDone }) => {
  const navigate = useNavigate();
  const [issueDate, setIssueDate] = useState(todayIso());
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(defaultTermsDays));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await quotesApi.toInvoice(quote._id, { issueDate, paymentTermsDays: Number(paymentTermsDays || 0) });
      const invoice = res.data?.invoice;
      toast.success(`Draft invoice ${invoice?.invoiceNumber || ''} created`);
      onDone?.();
      onClose();
      if (invoice?._id) navigate(`/clients/invoices/${invoice._id}`, { state: { tabTitle: invoice.invoiceNumber } });
    } catch (err) {
      toast.error(apiError(err, 'Could not convert the quote'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${quote.quoteNumber} → invoice`} size="sm" onClose={busy ? () => {} : onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create draft invoice'}</button>
      </>
    )}>
      <p className="mb-2 text-xs text-slate-600">Bills every quote line once as a draft invoice of {quote.currency || 'KES'} {money(quote.total)}.</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Issue date</label>
          <input type="date" className={inputClass} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Payment terms (days)</label>
          <input className={inputClass} inputMode="numeric" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
      </div>
    </Modal>
  );
};
