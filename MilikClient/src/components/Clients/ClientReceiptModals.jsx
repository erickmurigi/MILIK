// Receipt follow-up actions: apply unapplied credit to invoices, refund credit.
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import Modal from '../common/Modal';
import AppSelect from '../common/AppSelect';
import CurrencyInput from '../common/CurrencyInput';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { Required } from './clientUi';
import {
  money, round2, inputClass, labelClass, tableInputClass, footerBtn, footerPrimary,
  REFUND_METHOD_OPTIONS, useCashbooks, useClientsAccess,
} from './clientHelpers';
import { fmtDate, todayISO } from '../../utils/dates';

/**
 * Apply unapplied credit to open invoices. With `receipt` the credit comes
 * from that receipt only; with just `clientId` it is drawn FIFO across all of
 * the client's receipts (POST /apply-credit).
 */
export const ApplyCreditModal = ({ receipt, clientId, available, onClose, onDone }) => {
  const cid = clientId || receipt?.client?._id || receipt?.client;
  const [invoices, setInvoices] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [date, setDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const limit = round2(available ?? receipt?.unappliedAmount ?? 0);

  useEffect(() => {
    let alive = true;
    clientsCollectionsApi.allocationSuggestions(cid)
      .then((res) => {
        if (!alive) return;
        const rows = unwrap(res)?.invoices || [];
        setInvoices(rows);
        // Oldest first, skip disputed, up to the credit available.
        let left = limit;
        const next = {};
        for (const inv of rows) {
          if (left <= 0 || inv.disputed) continue;
          const amt = round2(Math.min(left, inv.outstanding));
          if (amt > 0) { next[inv._id] = String(amt); left = round2(left - amt); }
        }
        setAmounts(next);
      })
      .catch((err) => toast.error(apiError(err, 'Failed to load open invoices')))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cid, limit]);

  const total = useMemo(() => round2(Object.values(amounts).reduce((s, v) => s + Number(v || 0), 0)), [amounts]);
  const over = total > limit + 0.005;

  const submit = async () => {
    const allocations = Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([invoice, amount]) => ({ invoice, amount: Number(amount) }));
    if (!allocations.length) { toast.error('Enter an amount against at least one invoice'); return; }
    if (over) { toast.error(`Only ${money(limit)} of credit is available`); return; }
    const bad = invoices.find((inv) => Number(amounts[inv._id] || 0) > inv.outstanding + 0.005);
    if (bad) { toast.error(`${bad.invoiceNumber}: amount exceeds the outstanding ${money(bad.outstanding)}`); return; }
    setSaving(true);
    try {
      const res = receipt
        ? await clientsCollectionsApi.applyReceiptCredit(receipt._id, { allocations, date })
        : await clientsCollectionsApi.applyCredit({ clientId: cid, allocations, date });
      toast.success(res.data?.message || 'Credit applied');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Failed to apply credit'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={receipt ? `Apply credit — ${receipt.receiptNumber}` : 'Apply client credit'}
      size="wide"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={footerPrimary} onClick={submit} disabled={saving || loading || over || total <= 0}>{saving ? 'Applying…' : `Apply ${money(total)}`}</button>
        </>
      )}
    >
      <div className="mb-2 flex flex-wrap items-end gap-3 text-xs">
        <div className="border border-slate-200 bg-slate-50 px-2.5 py-1">
          <span className="text-[10px] font-bold uppercase text-slate-500">Credit available</span>
          <p className="font-black tabular-nums text-slate-900">KES {money(limit)}</p>
        </div>
        <div className="border border-slate-200 bg-slate-50 px-2.5 py-1">
          <span className="text-[10px] font-bold uppercase text-slate-500">Applying</span>
          <p className={`font-black tabular-nums ${over ? 'text-red-600' : 'text-slate-900'}`}>KES {money(total)}</p>
        </div>
        <div className="ml-auto w-36">
          <label className={labelClass}>Date</label>
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-[#0B3B2E] text-left text-[10px] font-black uppercase tracking-widest text-white">
            <th className="px-2 py-1.5">Invoice</th>
            <th className="px-2 py-1.5">Due</th>
            <th className="px-2 py-1.5 text-right">Outstanding</th>
            <th className="px-2 py-1.5 text-right" style={{ width: '30%' }}>Apply</th>
          </tr>
        </thead>
        <tbody>
          {loading && <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-400">Loading open invoices…</td></tr>}
          {!loading && invoices.length === 0 && <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-400">No open invoices for this client</td></tr>}
          {invoices.map((inv) => (
            <tr key={inv._id} className="border-b border-slate-100">
              <td className="px-2 py-1 font-semibold text-slate-900">
                {inv.invoiceNumber}
                {inv.disputed && <span className="ml-1.5 border border-amber-300 bg-amber-50 px-1 text-[9px] font-bold uppercase text-amber-800">Disputed</span>}
              </td>
              <td className={`px-2 py-1 ${inv.daysOverdue > 0 ? 'text-red-600' : 'text-slate-600'}`}>{fmtDate(inv.dueDate)}{inv.daysOverdue > 0 ? ` · ${inv.daysOverdue}d` : ''}</td>
              <td className="px-2 py-1 text-right tabular-nums">{money(inv.outstanding)}</td>
              <td className="px-2 py-1">
                <CurrencyInput prefix={null} inputClassName={`${tableInputClass} text-right`} value={amounts[inv._id] || ''} onChange={(e) => setAmounts((a) => ({ ...a, [inv._id]: e.target.value }))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
};

/** Pay a receipt's unapplied credit back to the client (Dr 2136 / Cr cashbook). */
export const RefundModal = ({ receipt, onClose, onDone }) => {
  const { businessId } = useClientsAccess();
  const { options: cashbookOptions } = useCashbooks(businessId);
  const [form, setForm] = useState({
    amount: String(receipt.unappliedAmount || ''),
    method: 'bank_transfer',
    cashbookAccountId: '',
    refundDate: todayISO(),
    reference: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const amount = Number(form.amount || 0);
    if (!(amount > 0)) { toast.error('Enter the refund amount'); return; }
    if (amount > Number(receipt.unappliedAmount || 0) + 0.005) { toast.error(`Refund cannot exceed the unapplied ${money(receipt.unappliedAmount)}`); return; }
    if (!form.cashbookAccountId) { toast.error('Pick the cashbook the refund is paid from'); return; }
    setSaving(true);
    try {
      const res = await clientsCollectionsApi.refund(receipt._id, { ...form, amount });
      toast.success(res.data?.message || 'Refund posted');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Failed to post refund'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Refund credit — ${receipt.receiptNumber}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={footerPrimary} onClick={submit} disabled={saving}>{saving ? 'Posting…' : 'Post refund'}</button>
        </>
      )}
    >
      <p className="mb-2 text-xs text-slate-600">Unapplied credit on this receipt: <b className="tabular-nums text-slate-900">KES {money(receipt.unappliedAmount)}</b></p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <label className={labelClass}>Amount<Required /></label>
          <CurrencyInput value={form.amount} onChange={(e) => set('amount', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Date<Required /></label>
          <input type="date" className={inputClass} value={form.refundDate} onChange={(e) => set('refundDate', e.target.value)} />
        </div>
        <AppSelect size="sm" label="Method" required value={form.method} onChange={(v) => set('method', v || 'bank_transfer')} options={REFUND_METHOD_OPTIONS} />
        <AppSelect size="sm" label="Paid from (cashbook)" required searchable value={form.cashbookAccountId} onChange={(v) => set('cashbookAccountId', v || '')} options={cashbookOptions} />
        <div>
          <label className={labelClass}>Reference</label>
          <input className={inputClass} value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Transfer / cheque ref" />
        </div>
        <div>
          <label className={labelClass}>Notes</label>
          <input className={inputClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};
