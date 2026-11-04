// Ad-hoc client invoice (drafts): create /clients/invoices/new[?clientId=&contractId=],
// edit a draft /clients/invoices/:id/edit. Save draft / Post / Post & send.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import ClientsShell from './ClientsShell';
import AppSelect from '../../components/common/AppSelect';
import Spinner from '../../components/common/Spinner';
import LineItemsEditor from '../../components/Clients/Billing/LineItemsEditor';
import { blankLine, fromApiLine, toInvoiceLine, validateLines } from '../../components/Clients/Billing/billingLines';
import {
  Section, Required, TotalsBlock, labelClass, inputClass, textareaClass, footerBtn, footerPrimary, footerDark,
} from '../../components/Clients/Billing/BillingUi';
import {
  CURRENCY_OPTIONS, TAX_MODE_OPTIONS, addDaysIso, idOf, invalidateList, isoDate, money, summarizeLines, todayIso,
  useBillingClients, useBillingSettings, useClientContracts, useIncomeAccounts,
} from '../../components/Clients/Billing/billingShared';
import { invoicesApi, apiError } from '../../services/clientsBillingApi';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';

const FORM_ID = 'client-invoice-form';

const emptyForm = (clientId = '', contractId = '', terms = 30, series = 'CINV', invoiceTerms = '') => ({
  client: clientId,
  contract: contractId,
  issueDate: todayIso(),
  dueDate: addDaysIso(todayIso(), terms),
  periodStart: '',
  periodEnd: '',
  poNumber: '',
  series,
  taxMode: 'exclusive',
  currency: 'KES',
  notes: '',
  terms: invoiceTerms,
});

const InvoiceForm = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canSave = hasCompanyPermission(user, company, 'clients', id ? 'edit' : 'create');

  const { options: clientOptions } = useBillingClients(businessId);
  const incomeOptions = useIncomeAccounts(businessId);
  const { settings, taxCodes, taxOptions, defaultTaxCodeKey, loaded: settingsLoaded } = useBillingSettings();

  const [form, setForm] = useState(() => emptyForm(params.get('clientId') || '', params.get('contractId') || ''));
  const [lines, setLines] = useState(() => [blankLine('', 'invoice')]);
  const [original, setOriginal] = useState(null);
  const [loadedId, setLoadedId] = useState(null);
  const [saving, setSaving] = useState('');
  const loading = Boolean(id) && loadedId !== id;
  const contractOptions = useClientContracts(form.client || null);

  // Settings defaults for a new invoice (applied once, when they arrive).
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  if (!id && settingsLoaded && !defaultsApplied) {
    setDefaultsApplied(true);
    const days = Number(settings?.defaultPaymentTermsDays ?? 30);
    setForm((f) => ({
      ...f,
      dueDate: addDaysIso(f.issueDate, days),
      series: settings?.invoicePrefix || f.series,
      terms: f.terms || settings?.invoiceTerms || '',
    }));
    setLines((ls) => ls.map((l) => (l.taxCodeKey ? l : { ...l, taxCodeKey: defaultTaxCodeKey })));
  }

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    invoicesApi.get(id)
      .then((res) => {
        if (!alive) return;
        const inv = res.data?.invoice || res.data?.data;
        setOriginal(inv);
        setForm({
          client: idOf(inv.client),
          contract: idOf(inv.contract),
          issueDate: isoDate(inv.issueDate),
          dueDate: isoDate(inv.dueDate),
          periodStart: isoDate(inv.periodStart),
          periodEnd: isoDate(inv.periodEnd),
          poNumber: inv.poNumber || '',
          series: inv.series || 'CINV',
          taxMode: inv.taxMode || 'exclusive',
          currency: inv.currency || 'KES',
          notes: inv.notes || '',
          terms: inv.terms || '',
        });
        setLines((inv.lineItems || []).length ? inv.lineItems.map(fromApiLine) : [blankLine('', 'invoice')]);
        setLoadedId(id);
      })
      .catch((err) => { toast.error(apiError(err, 'Could not load the invoice')); if (alive) setLoadedId(id); });
    return () => { alive = false; };
  }, [id]);

  const set = useCallback((field) => (e) => setForm((f) => ({ ...f, [field]: e?.target ? e.target.value : e })), []);
  const setVal = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const totals = useMemo(() => summarizeLines(lines, taxCodes, form.taxMode), [lines, taxCodes, form.taxMode]);
  const locked = Boolean(original && original.status !== 'draft');

  const validate = () => {
    if (!form.client) return 'Select the client';
    if (!form.issueDate) return 'Issue date is required';
    if (!form.dueDate) return 'Due date is required';
    if (form.dueDate < form.issueDate) return 'Due date cannot be before the issue date';
    if (form.periodStart && form.periodEnd && form.periodEnd < form.periodStart) return 'Billing period ends before it starts';
    if (!/^[A-Za-z0-9]{1,8}$/.test(form.series || '')) return 'Series must be 1–8 letters/digits';
    return validateLines(lines, 'invoice');
  };

  // then: '' (save only) | 'post' | 'send'
  const save = async (then = '') => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(then || 'draft');
    try {
      const payload = {
        ...form,
        contract: form.contract || null,
        periodStart: form.periodStart || null,
        periodEnd: form.periodEnd || null,
        series: form.series.toUpperCase(),
        lineItems: lines.map(toInvoiceLine),
      };
      const res = id ? await invoicesApi.update(id, payload) : await invoicesApi.create(payload);
      const inv = res.data?.invoice || res.data?.data;
      if (then === 'post') {
        await invoicesApi.post(inv._id);
        toast.success(`Invoice ${inv.invoiceNumber} posted`);
      } else if (then === 'send') {
        const sent = await invoicesApi.send(inv._id);
        toast.success(sent.data?.message || `Invoice ${inv.invoiceNumber} posted & sent`);
      } else {
        toast.success(`Draft ${inv.invoiceNumber} saved`);
      }
      invalidateList(`invoices:${businessId}`);
      navigate(`/clients/invoices/${inv._id}`, { replace: true, state: { tabTitle: inv.invoiceNumber } });
    } catch (e) {
      toast.error(apiError(e, 'Could not save the invoice'));
    } finally {
      setSaving('');
    }
  };

  const onSubmit = (e) => { e.preventDefault(); save(''); };
  const handleCancel = () => (id ? navigate(`/clients/invoices/${id}`, { state: { tabTitle: original?.invoiceNumber } }) : navigate('/clients/invoices'));
  const handleReset = () => {
    setForm(emptyForm(params.get('clientId') || '', params.get('contractId') || '', Number(settings?.defaultPaymentTermsDays ?? 30), settings?.invoicePrefix || 'CINV', settings?.invoiceTerms || ''));
    setLines([blankLine(defaultTaxCodeKey, 'invoice')]);
  };

  if (loading) {
    return <ClientsShell><div className="flex flex-1 items-center justify-center gap-2 text-slate-400"><Spinner size="sm" /><span className="text-xs font-semibold">Loading invoice…</span></div></ClientsShell>;
  }

  const cur = form.currency || 'KES';
  const busy = Boolean(saving);
  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <form id={FORM_ID} onSubmit={onSubmit} className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-2.5">
          {original && (
            <div className="flex flex-wrap items-center gap-2 border border-slate-200 bg-white px-3 py-1.5 text-xs">
              <span className="font-black text-[#0B3B2E]">{original.invoiceNumber}</span>
              <span className="text-slate-500">{original.status}</span>
              {locked && <span className="font-semibold text-red-700">Only drafts can be edited — use a credit or debit note to change a posted invoice.</span>}
            </div>
          )}

          <Section title="Invoice details">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6">
              <div className="col-span-2">
                <label className={labelClass}>Client<Required /></label>
                <AppSelect size="sm" value={form.client} onChange={(v) => setForm((f) => ({ ...f, client: v || '', contract: '' }))} options={clientOptions} placeholder="Select client…" searchable disabled={locked} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Contract (optional)</label>
                <AppSelect size="sm" value={form.contract} onChange={(v) => setVal('contract', v || '')} options={contractOptions} placeholder={form.client ? 'Not linked to a contract' : 'Pick a client first'} searchable clearable disabled={locked || !form.client} />
              </div>
              <div>
                <label className={labelClass}>Issue date<Required /></label>
                <input type="date" className={inputClass} value={form.issueDate} onChange={set('issueDate')} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Due date<Required /></label>
                <input type="date" className={inputClass} value={form.dueDate} onChange={set('dueDate')} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>PO no.</label>
                <input className={inputClass} value={form.poNumber} onChange={set('poNumber')} maxLength={40} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Series</label>
                <input className={`${inputClass} uppercase`} value={form.series} onChange={(e) => setVal('series', e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8))} disabled={locked || Boolean(id)} title={id ? 'The number is already assigned' : 'Invoice number prefix'} />
              </div>
              <div>
                <label className={labelClass}>Tax mode</label>
                <AppSelect size="sm" value={form.taxMode} onChange={(v) => setVal('taxMode', v || 'exclusive')} options={TAX_MODE_OPTIONS} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Currency</label>
                <AppSelect size="sm" value={form.currency} onChange={(v) => setVal('currency', v || 'KES')} options={CURRENCY_OPTIONS} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Period from</label>
                <input type="date" className={inputClass} value={form.periodStart} onChange={set('periodStart')} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Period to</label>
                <input type="date" className={inputClass} value={form.periodEnd} onChange={set('periodEnd')} disabled={locked} />
              </div>
            </div>
          </Section>

          <Section title="Lines">
            <LineItemsEditor
              lines={lines}
              onChange={setLines}
              mode="invoice"
              taxCodes={taxCodes}
              taxOptions={taxOptions}
              taxMode={form.taxMode}
              incomeOptions={incomeOptions}
              defaultTaxCodeKey={defaultTaxCodeKey}
              disabled={locked}
            />
            <div className="mt-2 flex flex-wrap items-start gap-3">
              <div className="grid min-w-[300px] flex-1 grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Notes (shown on the invoice)</label>
                  <textarea rows={3} className={textareaClass} value={form.notes} onChange={set('notes')} disabled={locked} />
                </div>
                <div>
                  <label className={labelClass}>Terms</label>
                  <textarea rows={3} className={textareaClass} value={form.terms} onChange={set('terms')} disabled={locked} />
                </div>
              </div>
              <TotalsBlock
                rows={[
                  { label: 'Subtotal', value: money(totals.gross) },
                  totals.discount > 0 && { label: 'Discount', value: `− ${money(totals.discount)}`, muted: true },
                  { label: form.taxMode === 'inclusive' ? 'Net of tax' : 'Net', value: money(totals.net) },
                  { label: 'VAT / tax', value: money(totals.tax) },
                  { label: 'Total', value: `${cur} ${money(totals.total)}`, hero: true },
                ]}
              />
            </div>
          </Section>
        </form>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={handleCancel} className={footerBtn} disabled={busy}>Cancel</button>
            {!id && <button type="button" onClick={handleReset} className={footerBtn} disabled={busy}>Reset</button>}
            {!locked && (
              <>
                <button type="submit" form={FORM_ID} className={footerDark} disabled={!canSave || busy}>{saving === 'draft' ? 'Saving…' : 'Save draft'}</button>
                <button type="button" onClick={() => save('post')} className={footerDark} disabled={!canSave || busy}>{saving === 'post' ? 'Posting…' : 'Post'}</button>
                <button type="button" onClick={() => save('send')} className={footerPrimary} disabled={!canSave || busy}>{saving === 'send' ? 'Sending…' : 'Post & send'}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </ClientsShell>
  );
};

export default InvoiceForm;
