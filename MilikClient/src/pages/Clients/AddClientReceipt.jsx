import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPrint, FaSms, FaCheckCircle, FaMagic } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import AppSelect from '../../components/common/AppSelect';
import CurrencyInput from '../../components/common/CurrencyInput';
import Modal from '../../components/common/Modal';
import { Section, Required } from '../../components/Clients/clientUi';
import { ApplyCreditModal } from '../../components/Clients/ClientReceiptModals';
import { clientsApi } from '../../services/clientsApi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDate, todayISO } from '../../utils/dates';
import {
  RECEIPT_METHOD_OPTIONS, money, round2, inputClass, labelClass, tableInputClass, textareaClass,
  footerBtn, footerPrimary, useCashbooks, useClientLookup, useClientsAccess, receiptDocSpec, printAfterFetch,
} from '../../components/Clients/clientHelpers';

const EMPTY = {
  clientId: '', receiptDate: todayISO(), method: 'bank_transfer', reference: '',
  chequeNumber: '', chequeClearingDate: '', cashbookAccountId: '', amount: '',
  whtIncomeTax: { amount: '', certificateNo: '' }, whtVat: { amount: '', certificateNo: '' }, notes: '',
};

const SummaryRow = ({ label, value, strong, tone = 'text-slate-900' }) => (
  <div className={`flex items-center justify-between gap-2 py-0.5 ${strong ? 'border-t border-slate-200 pt-1 font-black' : ''}`}>
    <span className="text-[11px] text-slate-600">{label}</span>
    <span className={`tabular-nums text-xs ${strong ? 'font-black' : 'font-semibold'} ${tone}`}>KES {money(value)}</span>
  </div>
);

const AddClientReceipt = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { businessId, company } = useClientsAccess();
  const { clients, options: clientOptions } = useClientLookup(businessId);
  const { options: cashbookOptions } = useCashbooks(businessId);

  const [form, setForm] = useState(() => ({ ...EMPTY, clientId: searchParams.get('clientId') || '' }));
  const [suggestions, setSuggestions] = useState(null);
  const [applies, setApplies] = useState({});
  const [loadingSug, setLoadingSug] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [applyCreditOpen, setApplyCreditOpen] = useState(false);
  const [sugTick, setSugTick] = useState(0);
  const touched = useRef({ applies: false, wht: false });

  const client = useMemo(() => clients.find((c) => String(c._id) === String(form.clientId)) || null, [clients, form.clientId]);
  const tax = client?.taxBehaviour || {};
  const isWhtAgent = Boolean(tax.vatWithholdingAgent || tax.incomeTaxWhtAgent);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setWht = (group, k, v) => {
    if (k === 'amount') touched.current.wht = true;
    setForm((f) => ({ ...f, [group]: { ...f[group], [k]: v } }));
  };

  // Default cashbook once the list arrives.
  useEffect(() => {
    if (!form.cashbookAccountId && cashbookOptions.length) setForm((f) => ({ ...f, cashbookAccountId: cashbookOptions[0].value }));
  }, [cashbookOptions, form.cashbookAccountId]);

  // Suggestions follow the client and the cash amount (debounced).
  useEffect(() => {
    if (!form.clientId) { setSuggestions(null); setApplies({}); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setLoadingSug(true);
      try {
        const data = unwrap(await clientsCollectionsApi.allocationSuggestions(form.clientId, form.amount || null));
        if (!alive) return;
        setSuggestions(data);
        if (!touched.current.applies) {
          const next = {};
          for (const inv of data?.invoices || []) if (inv.suggestedAmount > 0) next[inv._id] = String(inv.suggestedAmount);
          setApplies(next);
        }
        if (!touched.current.wht && form.amount) {
          setForm((f) => ({
            ...f,
            whtIncomeTax: { ...f.whtIncomeTax, amount: data?.totals?.suggestedWhtIncomeTax ? String(data.totals.suggestedWhtIncomeTax) : '' },
            whtVat: { ...f.whtVat, amount: data?.totals?.suggestedWhtVat ? String(data.totals.suggestedWhtVat) : '' },
          }));
        }
      } catch (err) {
        if (alive) toast.error(apiError(err, 'Failed to load open invoices'));
      } finally {
        if (alive) setLoadingSug(false);
      }
    }, form.amount ? 400 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [form.clientId, form.amount, sugTick]);

  const onClientChange = (v) => {
    touched.current = { applies: false, wht: false };
    setForm((f) => ({ ...EMPTY, receiptDate: f.receiptDate, method: f.method, cashbookAccountId: f.cashbookAccountId, clientId: v || '' }));
  };

  const cash = round2(form.amount);
  const wit = round2(form.whtIncomeTax.amount);
  const wvat = round2(form.whtVat.amount);
  const settlement = round2(cash + wit + wvat);
  const allocated = useMemo(() => round2(Object.values(applies).reduce((s, v) => s + Number(v || 0), 0)), [applies]);
  const unapplied = round2(settlement - allocated);
  const invoices = suggestions?.invoices || [];

  const setApply = (id, v) => { touched.current.applies = true; setApplies((a) => ({ ...a, [id]: v })); };
  const autoAllocate = () => {
    // Oldest first, skip disputed, up to cash + WHT.
    let left = settlement;
    const next = {};
    for (const inv of invoices) {
      if (left <= 0 || inv.disputed) continue;
      const amt = round2(Math.min(left, inv.outstanding));
      if (amt > 0) { next[inv._id] = String(amt); left = round2(left - amt); }
    }
    touched.current.applies = true;
    setApplies(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.clientId) { toast.error('Pick the client'); return; }
    if (!form.cashbookAccountId) { toast.error('Pick the cashbook the money went into'); return; }
    if (settlement <= 0) { toast.error('Enter the amount received'); return; }
    if (form.method === 'cheque' && !form.chequeNumber.trim()) { toast.error('Cheque number is required'); return; }
    if (allocated > settlement + 0.005) { toast.error(`Allocations (${money(allocated)}) exceed cash + WHT (${money(settlement)})`); return; }
    const over = invoices.find((inv) => Number(applies[inv._id] || 0) > inv.outstanding + 0.005);
    if (over) { toast.error(`${over.invoiceNumber}: amount exceeds the outstanding ${money(over.outstanding)}`); return; }
    setSaving(true);
    try {
      const payload = {
        clientId: form.clientId,
        receiptDate: form.receiptDate,
        method: form.method,
        reference: form.reference.trim(),
        cashbookAccountId: form.cashbookAccountId,
        amount: cash,
        whtIncomeTax: { amount: wit, certificateNo: form.whtIncomeTax.certificateNo.trim() },
        whtVat: { amount: wvat, certificateNo: form.whtVat.certificateNo.trim() },
        allocations: Object.entries(applies).filter(([, v]) => Number(v) > 0).map(([invoice, amount]) => ({ invoice, amount: Number(amount) })),
        notes: form.notes.trim(),
        ...(form.method === 'cheque' ? { chequeNumber: form.chequeNumber.trim(), chequeClearingDate: form.chequeClearingDate || null } : {}),
      };
      const res = await clientsCollectionsApi.createReceipt(payload);
      const receipt = res.data?.receipt || unwrap(res);
      toast.success(res.data?.message || 'Receipt posted');
      setSaved({ receipt, client, smsPhone: client?.phone || '' });
    } catch (err) {
      toast.error(apiError(err, 'Failed to post receipt'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = useCallback(() => {
    touched.current = { applies: false, wht: false };
    setForm((f) => ({ ...EMPTY, cashbookAccountId: f.cashbookAccountId }));
    setSuggestions(null);
    setApplies({});
  }, []);

  const printSaved = () => printAfterFetch(
    () => clientsCollectionsApi.getReceipt(saved.receipt._id).then((r) => unwrap(r).receipt),
    (receipt) => receiptDocSpec(receipt, company),
  );
  const smsSaved = async () => {
    const r = saved.receipt;
    const body = `Dear ${saved.client?.name || 'Customer'}, we have received KES ${money(r.amount)}${r.reference ? ` (ref ${r.reference})` : ''}. Receipt ${r.receiptNumber}. Thank you. - ${company?.companyName || ''}`.trim();
    try {
      const res = await clientsApi.sendSms(r.client?._id || r.client, { phone: saved.smsPhone, body });
      toast.success(res.data?.message || 'SMS sent');
    } catch (err) {
      toast.error(apiError(err, 'Failed to send SMS'));
    }
  };

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <form id="client-receipt-form" onSubmit={handleSubmit} noValidate className="grid w-full grid-cols-1 gap-2.5 xl:grid-cols-[1fr_280px]">
            <div className="min-w-0 space-y-2.5">
              <Section title="Receipt">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                  <div className="col-span-2">
                    <AppSelect size="sm" label="Client" required searchable value={form.clientId} onChange={onClientChange} options={clientOptions} placeholder="Search client…" />
                  </div>
                  <div>
                    <label className={labelClass}>Date<Required /></label>
                    <input type="date" className={inputClass} value={form.receiptDate} onChange={(e) => set('receiptDate', e.target.value)} />
                  </div>
                  <AppSelect size="sm" label="Method" required value={form.method} onChange={(v) => set('method', v || 'bank_transfer')} options={RECEIPT_METHOD_OPTIONS} />
                  <div>
                    <label className={labelClass}>Cash received<Required /></label>
                    <CurrencyInput value={form.amount} onChange={(e) => set('amount', e.target.value)} />
                  </div>
                  <AppSelect size="sm" label="Cashbook" required searchable value={form.cashbookAccountId} onChange={(v) => set('cashbookAccountId', v || '')} options={cashbookOptions} />
                  <div>
                    <label className={labelClass}>Reference{['bank_transfer', 'mobile_money'].includes(form.method) && <Required />}</label>
                    <input className={inputClass} value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder={form.method === 'mobile_money' ? 'M-Pesa code' : 'Bank / slip ref'} />
                  </div>
                  {form.method === 'cheque' ? (
                    <div className="grid grid-cols-2 gap-x-2">
                      <div>
                        <label className={labelClass}>Cheque no.<Required /></label>
                        <input className={inputClass} value={form.chequeNumber} onChange={(e) => set('chequeNumber', e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Clears</label>
                        <input type="date" className={inputClass} value={form.chequeClearingDate} onChange={(e) => set('chequeClearingDate', e.target.value)} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className={labelClass}>Notes</label>
                      <input className={inputClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                    </div>
                  )}
                </div>
              </Section>

              {(isWhtAgent || wit > 0 || wvat > 0) && (
                <Section title={`Tax withheld by client${tax.incomeTaxWhtAgent ? ` · income tax ${tax.incomeTaxWhtRate}%` : ''}${tax.vatWithholdingAgent ? ' · VAT 2%' : ''}`}>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                    <div>
                      <label className={labelClass}>Income tax WHT</label>
                      <CurrencyInput value={form.whtIncomeTax.amount} onChange={(e) => setWht('whtIncomeTax', 'amount', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelClass}>Certificate no.</label>
                      <input className={inputClass} value={form.whtIncomeTax.certificateNo} onChange={(e) => setWht('whtIncomeTax', 'certificateNo', e.target.value)} placeholder="Blank = chase later" />
                    </div>
                    <div>
                      <label className={labelClass}>VAT withheld (2%)</label>
                      <CurrencyInput value={form.whtVat.amount} onChange={(e) => setWht('whtVat', 'amount', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelClass}>Certificate no.</label>
                      <input className={inputClass} value={form.whtVat.certificateNo} onChange={(e) => setWht('whtVat', 'certificateNo', e.target.value)} placeholder="Blank = chase later" />
                    </div>
                  </div>
                </Section>
              )}

              <Section
                bodyClass="p-0"
                title={(
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">Allocate to open invoices {loadingSug && <span className="ml-1 font-normal normal-case text-slate-400">updating…</span>}</h3>
                    {invoices.length > 0 && (
                      <button type="button" onClick={autoAllocate} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0B3B2E] hover:underline"><FaMagic size={9} /> Oldest first</button>
                    )}
                  </div>
                )}
              >
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1">Invoice</th>
                      <th className="px-2 py-1">Issued</th>
                      <th className="px-2 py-1">Due</th>
                      <th className="px-2 py-1 text-right">Total</th>
                      <th className="px-2 py-1 text-right">Outstanding</th>
                      <th className="px-2 py-1 text-right" style={{ width: '22%' }}>Apply (incl. WHT)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!form.clientId && <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-400">Pick a client to see their open invoices</td></tr>}
                    {form.clientId && !loadingSug && invoices.length === 0 && <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-400">No open invoices — the full amount is held as client credit</td></tr>}
                    {invoices.map((inv) => (
                      <tr key={inv._id} className={`border-b border-slate-100 ${inv.disputed ? 'bg-amber-50/60' : ''}`}>
                        <td className="px-2 py-1 font-semibold text-slate-900">
                          {inv.invoiceNumber}
                          {inv.disputed && <span className="ml-1.5 border border-amber-300 bg-amber-50 px-1 text-[9px] font-bold uppercase text-amber-800" title="Disputed — not auto-allocated">Disputed</span>}
                        </td>
                        <td className="px-2 py-1 text-slate-600">{fmtDate(inv.issueDate)}</td>
                        <td className={`px-2 py-1 ${inv.daysOverdue > 0 ? 'font-semibold text-red-600' : 'text-slate-600'}`}>{fmtDate(inv.dueDate)}{inv.daysOverdue > 0 ? ` · ${inv.daysOverdue}d` : ''}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{money(inv.total)}</td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums">{money(inv.outstanding)}</td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <CurrencyInput prefix={null} inputClassName={`${tableInputClass} text-right`} value={applies[inv._id] || ''} onChange={(e) => setApply(inv._id, e.target.value)} />
                            <button type="button" title="Settle in full" className="h-7 shrink-0 border border-slate-300 px-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50" onClick={() => setApply(inv._id, String(inv.outstanding))}>Full</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>
            </div>

            <div className="space-y-2.5">
              <Section title="Totals">
                <SummaryRow label="Cash received" value={cash} />
                <SummaryRow label="Income tax withheld" value={wit} />
                <SummaryRow label="VAT withheld" value={wvat} />
                <SummaryRow label="Total settlement" value={settlement} strong />
                <SummaryRow label="Allocated to invoices" value={allocated} tone={allocated > settlement + 0.005 ? 'text-red-600' : 'text-slate-900'} />
                <SummaryRow label={unapplied < 0 ? 'Over-allocated' : 'Held as client credit'} value={Math.abs(unapplied)} strong tone={unapplied < -0.005 ? 'text-red-600' : unapplied > 0.005 ? 'text-[#0B3B2E]' : 'text-slate-900'} />
              </Section>
              {suggestions && (
                <Section title="Client position">
                  <SummaryRow label="Open invoices" value={suggestions.totals?.outstanding || 0} />
                  <SummaryRow label="Existing unapplied credit" value={suggestions.unappliedCreditAvailable || 0} />
                  {suggestions.unappliedCreditAvailable > 0 && invoices.length > 0 && (
                    <button type="button" onClick={() => setApplyCreditOpen(true)} className="mt-1 text-[11px] font-bold text-[#0B3B2E] hover:underline">Apply existing credit first →</button>
                  )}
                  {client?.creditHold && <p className="mt-1 border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">On credit hold: {client.creditHoldReason}</p>}
                </Section>
              )}
              {form.method === 'cheque' && (
                <Section title="Notes">
                  <textarea rows={2} className={textareaClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                </Section>
              )}
            </div>
          </form>
        </div>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={footerBtn} onClick={() => navigate('/clients/receipts')} disabled={saving}>Cancel</button>
            <button type="button" className={footerBtn} onClick={handleReset} disabled={saving}>Reset</button>
            <button type="submit" form="client-receipt-form" className={footerPrimary} disabled={saving}>{saving ? 'Posting…' : 'Post receipt'}</button>
          </div>
        </div>
      </div>

      {applyCreditOpen && (
        <ApplyCreditModal
          clientId={form.clientId}
          available={suggestions?.unappliedCreditAvailable || 0}
          onClose={() => setApplyCreditOpen(false)}
          onDone={() => { touched.current.applies = false; setSugTick((t) => t + 1); }}
        />
      )}

      {saved && (
        <Modal
          title="Receipt posted"
          icon={<FaCheckCircle />}
          size="sm"
          onClose={() => navigate('/clients/receipts')}
          footer={(
            <>
              <button type="button" className={footerBtn} onClick={() => { setSaved(null); handleReset(); }}>New receipt</button>
              <button type="button" className={footerPrimary} onClick={() => navigate('/clients/receipts')}>Done</button>
            </>
          )}
        >
          <p className="text-sm text-slate-800"><b>{saved.receipt.receiptNumber}</b> · KES {money(saved.receipt.amount)} from {saved.client?.name}</p>
          {saved.receipt.unappliedAmount > 0 && <p className="mt-1 text-xs text-slate-600">KES {money(saved.receipt.unappliedAmount)} is held as client credit.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={printSaved} className="inline-flex h-8 items-center gap-1.5 border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><FaPrint size={11} /> Print receipt</button>
            <div className="flex items-center gap-1">
              <input className={`${inputClass} w-36`} value={saved.smsPhone} onChange={(e) => setSaved((s) => ({ ...s, smsPhone: e.target.value }))} placeholder="Phone" />
              <button type="button" disabled={!saved.smsPhone} onClick={smsSaved} className="inline-flex h-7 items-center gap-1.5 border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><FaSms size={11} /> SMS</button>
            </div>
          </div>
        </Modal>
      )}
    </ClientsShell>
  );
};

export default AddClientReceipt;
