import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaMoneyBillWave } from 'react-icons/fa';
import Modal from '../common/Modal';
import FormField from '../common/FormField';
import AppSelect from '../common/AppSelect';
import { clientsApi } from '../../services/clientsApi';
import { getChartOfAccounts } from '../../redux/apiCalls';
import { selectCurrentCompany } from '../../redux/selectors';
import { todayISO } from '../../utils/dates';

// Shared by ClientsInvoices.jsx and ClientDetail.jsx's InvoicesTab — was two
// near-identical local components (one on raw <table>/<select> markup, one on
// Modal/AppSelect), both calling the removed markPaid endpoint. One component,
// matching PayLandlordModal.jsx's established shape (components/Modals/), used
// from both places.

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money',  label: 'Mobile Money (M-Pesa)' },
  { value: 'cash',          label: 'Cash' },
  { value: 'check',         label: 'Check' },
  { value: 'credit_card',   label: 'Credit Card' },
  { value: 'other',         label: 'Other' },
];

const CASHBOOK_PATTERN = /cash|bank|m-?pesa|mobile money|wallet|petty|till|collection/i;
const isCashbookLikeAccount = (account = {}) =>
  String(account?.type || '').toLowerCase() === 'asset' &&
  CASHBOOK_PATTERN.test(`${account?.name || ''} ${account?.group || ''} ${account?.subGroup || ''}`);

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(Number(n) || 0);

const inputCls = 'w-full border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-[#0B3B2E]';

const RecordClientPaymentModal = ({ invoice, onClose, onRecorded }) => {
  const currentCompany = useSelector(selectCurrentCompany);
  const balance = Math.max(0, (invoice?.total || 0) - (invoice?.paidAmount || 0));
  const [form, setForm] = useState({
    amount:            String(balance || ''),
    paymentDate:       todayISO(),
    paymentMethod:     'bank_transfer',
    paymentReference:  '',
    cashbookAccountId: '',
    notes:             '',
  });
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await getChartOfAccounts({ business: currentCompany?._id });
        const postingRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.isPosting !== false);
        const cashbooks = postingRows.filter(isCashbookLikeAccount);
        if (!cancelled) {
          setCashbookOptions(cashbooks);
          setForm((f) => (f.cashbookAccountId ? f : { ...f, cashbookAccountId: cashbooks[0]?._id || '' }));
        }
      } catch (_err) {
        // Non-fatal — the submit button below stays disabled without a
        // resolvable cashbook, and the error surfaces there instead.
      }
    })();
    return () => { cancelled = true; };
  }, [currentCompany?._id]);

  const handleSubmit = async () => {
    if (!form.amount || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      toast.error('Valid amount required');
      return;
    }
    if (!form.cashbookAccountId) {
      toast.error('Select which cashbook/bank account received this payment');
      return;
    }
    setSaving(true);
    try {
      await clientsApi.recordPayment(invoice._id, {
        amount:            Number(form.amount),
        paymentDate:       form.paymentDate,
        paymentMethod:     form.paymentMethod,
        paymentReference:  form.paymentReference.trim() || undefined,
        cashbookAccountId: form.cashbookAccountId,
        notes:             form.notes.trim() || undefined,
      });
      toast.success('Payment recorded');
      onRecorded();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record Client Payment"
      icon={<FaMoneyBillWave className="text-emerald-400" />}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-700 bg-slate-200 hover:bg-slate-300 transition-colors">
            Cancel
          </button>
          <button type="submit" form="record-client-payment-form" disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-[#0B3B2E] hover:bg-[#0A3127] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <FaMoneyBillWave size={11} /> {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </>
      }
    >
      <form id="record-client-payment-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
        <div className="bg-slate-50 border border-slate-200 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Invoice Summary</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <p className="text-xs text-slate-400">Invoice #</p>
              <p className="font-bold text-slate-800">{invoice?.invoiceNumber || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Balance Due</p>
              <p className="font-bold text-emerald-700 text-base">{fmtKES(balance)}</p>
            </div>
          </div>
          {invoice?.paidAmount > 0 && (
            <p className="mt-2 text-xs text-amber-700">
              Partially paid: {fmtKES(invoice.paidAmount)} of {fmtKES(invoice.total)} already recorded.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Amount Paying Now (KES)" required>
            <input type="number" value={form.amount} required min="0.01" step="0.01"
              onChange={(e) => set('amount', e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Payment Date" required>
            <input type="date" value={form.paymentDate} required
              onChange={(e) => set('paymentDate', e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Payment Method" required>
            <AppSelect
              size="md"
              value={form.paymentMethod}
              onChange={(v) => set('paymentMethod', v ?? 'bank_transfer')}
              options={PAYMENT_METHODS}
            />
          </FormField>
          <FormField label="Reference">
            <input type="text" value={form.paymentReference}
              placeholder="Transaction / cheque / transfer ref"
              onChange={(e) => set('paymentReference', e.target.value)} className={inputCls} />
          </FormField>
          <FormField label="Received Into" required className="sm:col-span-2">
            <AppSelect
              size="md"
              value={form.cashbookAccountId || null}
              onChange={(v) => set('cashbookAccountId', v ?? '')}
              options={cashbookOptions.map((a) => ({
                value: a._id,
                label: a.code ? `${a.code} — ${a.name}` : a.name,
              }))}
              placeholder={cashbookOptions.length === 0 ? 'No cashbook accounts found' : 'Select account…'}
            />
          </FormField>
        </div>

        <FormField label="Notes">
          <textarea value={form.notes} rows={2}
            placeholder="Optional notes…"
            onChange={(e) => set('notes', e.target.value)}
            className={`${inputCls} resize-none`} />
        </FormField>
      </form>
    </Modal>
  );
};

export default RecordClientPaymentModal;
