// Credit / debit note against a posted client invoice. Credit: full remainder or per-line net
// amounts (VAT follows the original line's tax). Debit: new lines with their own tax code.
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { FaPlus, FaTrash } from 'react-icons/fa';
import Modal from '../../common/Modal';
import AppSelect from '../../common/AppSelect';
import CurrencyInput from '../../common/CurrencyInput';
import Spinner from '../../common/Spinner';
import { invoicesApi, apiError } from '../../../services/clientsBillingApi';
import { Required, TotalsBlock, labelClass, inputClass, tableInputClass, tableMoneyClass, textareaClass, footerBtn, footerPrimary, iconBtnDanger } from './BillingUi';
import { money, round2, taxOf, todayIso, useBillingSettings, newLineKey } from './billingShared';

const lineRate = (invoice, line) => {
  if (invoice.taxCalculation === 'line') return String(line.taxType || '').toLowerCase() === 'vat' ? Number(line.taxRate || 0) : 0;
  return line.taxable === false ? 0 : Number(invoice.vatRate || 0);
};

const NoteModal = ({ invoiceId, type = 'credit', onClose, onDone }) => {
  const isCredit = type === 'credit';
  const { taxCodes, taxOptions, defaultTaxCodeKey } = useBillingSettings();
  const [invoice, setInvoice] = useState(null);
  const [full, setFull] = useState(true);
  const [amounts, setAmounts] = useState({}); // credit: invoiceLineIndex -> net amount
  const [debitLines, setDebitLines] = useState(() => [{ key: newLineKey(), description: '', amount: '', taxCodeKey: '' }]);
  const [reason, setReason] = useState('');
  const [noteDate, setNoteDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    invoicesApi.get(invoiceId)
      .then((res) => { if (alive) setInvoice(res.data?.invoice || res.data?.data); })
      .catch((err) => { toast.error(apiError(err, 'Could not load the invoice')); onClose(); });
    return () => { alive = false; };
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Net already credited per invoice line (posted credit notes only).
  const creditLines = useMemo(() => {
    if (!invoice) return [];
    const credited = new Map();
    for (const n of invoice.notes || []) {
      if (n.noteType !== 'CREDIT_NOTE' || n.status !== 'posted') continue;
      for (const l of n.lines || []) {
        if (l.invoiceLineIndex == null) continue;
        credited.set(l.invoiceLineIndex, round2((credited.get(l.invoiceLineIndex) || 0) + Number(l.netAmount || 0)));
      }
    }
    return (invoice.lineItems || []).map((l, index) => {
      const net = Number(l.amount || 0);
      const already = credited.get(index) || 0;
      return { index, description: l.itemName || l.description, net, already, remaining: round2(net - already), rate: lineRate(invoice, l) };
    });
  }, [invoice]);

  const totals = useMemo(() => {
    if (!invoice) return { net: 0, tax: 0, total: 0 };
    if (isCredit) {
      return creditLines.reduce((acc, l) => {
        const net = full ? Math.max(0, l.remaining) : Math.min(Number(amounts[l.index] || 0), Math.max(0, l.remaining));
        const tax = round2((net * l.rate) / 100);
        return { net: round2(acc.net + net), tax: round2(acc.tax + tax), total: round2(acc.total + net + tax) };
      }, { net: 0, tax: 0, total: 0 });
    }
    return debitLines.reduce((acc, l) => {
      const net = Number(l.amount || 0);
      const { taxType, taxRate } = taxOf(taxCodes, l.taxCodeKey || defaultTaxCodeKey);
      const tax = taxType === 'vat' ? round2((net * taxRate) / 100) : 0;
      return { net: round2(acc.net + net), tax: round2(acc.tax + tax), total: round2(acc.total + net + tax) };
    }, { net: 0, tax: 0, total: 0 });
  }, [invoice, isCredit, creditLines, full, amounts, debitLines, taxCodes, defaultTaxCodeKey]);

  const setDebit = (key, field, value) => setDebitLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  const submit = async () => {
    if (!reason.trim()) { toast.error('A reason is required'); return; }
    let payload;
    if (isCredit) {
      if (full) {
        payload = { reason: reason.trim(), noteDate, full: true };
      } else {
        const lines = [];
        for (const l of creditLines) {
          const amt = Number(amounts[l.index] || 0);
          if (!(amt > 0)) continue;
          if (amt > l.remaining + 0.005) { toast.error(`"${l.description}": only ${money(l.remaining)} (net) is left to credit`); return; }
          lines.push({ invoiceLineIndex: l.index, amount: amt });
        }
        if (!lines.length) { toast.error('Enter an amount on at least one line'); return; }
        payload = { reason: reason.trim(), noteDate, lines };
      }
    } else {
      const lines = debitLines.filter((l) => l.description.trim() || Number(l.amount) > 0);
      if (!lines.length) { toast.error('Add at least one debit line'); return; }
      for (const l of lines) {
        if (!l.description.trim()) { toast.error('Each debit line needs a description'); return; }
        if (!(Number(l.amount) > 0)) { toast.error('Each debit line needs an amount'); return; }
      }
      payload = { reason: reason.trim(), noteDate, lines: lines.map((l) => ({ description: l.description.trim(), amount: Number(l.amount), taxCodeKey: l.taxCodeKey || defaultTaxCodeKey || null })) };
    }
    setBusy(true);
    try {
      const res = isCredit ? await invoicesApi.creditNote(invoiceId, payload) : await invoicesApi.debitNote(invoiceId, payload);
      const note = res.data?.note;
      toast.success(`${isCredit ? 'Credit' : 'Debit'} note ${note?.noteNumber || ''} posted (${money(note?.total)})`);
      onDone?.(res.data);
      onClose();
    } catch (err) {
      toast.error(apiError(err, `Could not post the ${isCredit ? 'credit' : 'debit'} note`));
    } finally {
      setBusy(false);
    }
  };

  const currency = invoice?.currency || 'KES';
  return (
    <Modal
      title={`${isCredit ? 'Credit' : 'Debit'} note${invoice ? ` — ${invoice.invoiceNumber}` : ''}`}
      size="wide"
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={footerPrimary} onClick={submit} disabled={busy || !invoice || !(totals.total > 0) || !reason.trim()}>
            {busy ? 'Posting…' : `Post ${isCredit ? 'credit' : 'debit'} note`}
          </button>
        </>
      )}
    >
      {!invoice ? (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-400"><Spinner size="sm" /><span className="text-xs font-semibold">Loading invoice…</span></div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
            <span><span className="text-slate-500">Client</span> <b>{invoice.client?.name}</b></span>
            <span><span className="text-slate-500">Invoice total</span> <b className="tabular-nums">{currency} {money(invoice.total)}</b></span>
            <span><span className="text-slate-500">Outstanding</span> <b className="tabular-nums">{currency} {money(invoice.outstanding)}</b></span>
          </div>

          {isCredit ? (
            <>
              <div className="flex items-center gap-4 text-xs font-bold text-slate-800">
                <label className="inline-flex items-center gap-1.5"><input type="radio" className="accent-[#0B3B2E]" checked={full} onChange={() => setFull(true)} /> Credit everything left on the invoice</label>
                <label className="inline-flex items-center gap-1.5"><input type="radio" className="accent-[#0B3B2E]" checked={!full} onChange={() => setFull(false)} /> Credit specific lines</label>
              </div>
              <div className="overflow-x-auto border border-slate-200">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-2 py-1">Line</th>
                      <th className="px-2 py-1 text-right">Net</th>
                      <th className="px-2 py-1 text-right">Credited</th>
                      <th className="px-2 py-1 text-right">Remaining</th>
                      <th className="px-2 py-1 text-right">Tax %</th>
                      <th className="w-36 px-2 py-1 text-right">Credit (net)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {creditLines.map((l) => (
                      <tr key={l.index}>
                        <td className="px-2 py-1 text-slate-800">{l.description}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(l.net)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-500">{money(l.already)}</td>
                        <td className="px-2 py-1 text-right font-bold tabular-nums">{money(l.remaining)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{l.rate}%</td>
                        <td className="px-1 py-1">
                          {full ? (
                            <span className="block px-2 text-right tabular-nums text-slate-700">{money(Math.max(0, l.remaining))}</span>
                          ) : (
                            <CurrencyInput
                              prefix={null}
                              value={amounts[l.index] ?? ''}
                              onChange={(e) => setAmounts((a) => ({ ...a, [l.index]: e.target.value }))}
                              disabled={l.remaining <= 0}
                              inputClassName={tableMoneyClass}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div>
              <div className="overflow-x-auto border border-slate-200">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-2 py-1">Description<span className="text-red-600">*</span></th>
                      <th className="w-44 px-2 py-1">Tax code</th>
                      <th className="w-36 px-2 py-1 text-right">Amount (net)</th>
                      <th className="w-7" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {debitLines.map((l) => (
                      <tr key={l.key}>
                        <td className="px-1 py-1"><input className={tableInputClass} value={l.description} onChange={(e) => setDebit(l.key, 'description', e.target.value)} placeholder="e.g. Additional on-site support hours" maxLength={200} /></td>
                        <td className="px-1 py-1"><AppSelect size="sm" value={l.taxCodeKey || defaultTaxCodeKey} onChange={(v) => setDebit(l.key, 'taxCodeKey', v || '')} options={taxOptions} /></td>
                        <td className="px-1 py-1"><CurrencyInput prefix={null} value={l.amount} onChange={(e) => setDebit(l.key, 'amount', e.target.value)} inputClassName={tableMoneyClass} /></td>
                        <td className="px-1 py-1 text-center">
                          {debitLines.length > 1 && <button type="button" className={iconBtnDanger} onClick={() => setDebitLines((ls) => ls.filter((x) => x.key !== l.key))}><FaTrash size={11} /></button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => setDebitLines((ls) => [...ls, { key: newLineKey(), description: '', amount: '', taxCodeKey: '' }])} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">
                <FaPlus size={9} /> Add line
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-start gap-3">
            <div className="grid min-w-[260px] flex-1 grid-cols-3 gap-2">
              <div>
                <label className={labelClass}>Note date</label>
                <input type="date" className={inputClass} value={noteDate} onChange={(e) => setNoteDate(e.target.value)} />
              </div>
              <div className="col-span-3">
                <label className={labelClass}>Reason<Required /></label>
                <textarea rows={2} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isCredit ? 'e.g. Service credit for March downtime' : 'e.g. Out-of-scope work approved by client'} />
              </div>
            </div>
            <TotalsBlock rows={[
              { label: 'Net', value: money(totals.net) },
              { label: 'VAT / tax', value: money(totals.tax) },
              { label: `${isCredit ? 'Credit' : 'Debit'} total`, value: `${currency} ${money(totals.total)}`, hero: true },
            ]} />
          </div>
        </div>
      )}
    </Modal>
  );
};

export default NoteModal;
