// Quote / proforma form: /clients/quotes/new, /clients/quotes/:id/edit (draft & sent quotes are
// editable; accepted/declined/expired open read-only with their conversions).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import ClientsShell from './ClientsShell';
import AppSelect from '../../components/common/AppSelect';
import Spinner from '../../components/common/Spinner';
import LineItemsEditor from '../../components/Clients/Billing/LineItemsEditor';
import { blankLine, fromApiLine, toContractLine, validateLines } from '../../components/Clients/Billing/billingLines';
import { ConvertToContractModal, ConvertToInvoiceModal } from '../../components/Clients/Billing/QuoteModals';
import {
  Section, Required, StatusPill, TotalsBlock, labelClass, inputClass, textareaClass, footerBtn, footerPrimary, footerDark,
} from '../../components/Clients/Billing/BillingUi';
import {
  CURRENCY_OPTIONS, TAX_MODE_OPTIONS, addDaysIso, contractMetrics, idOf, invalidateList, isoDate, money, summarizeLines, todayIso,
  useBillingClients, useBillingSettings, useIncomeAccounts,
} from '../../components/Clients/Billing/billingShared';
import { quotesApi, apiError } from '../../services/clientsBillingApi';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';

const FORM_ID = 'client-quote-form';
const emptyForm = (clientId = '') => ({
  kind: 'quote',
  client: clientId,
  title: '',
  issueDate: todayIso(),
  validUntil: addDaysIso(todayIso(), 30),
  currency: 'KES',
  taxMode: 'exclusive',
  notes: '',
  terms: '',
});

const QuoteForm = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canSave = hasCompanyPermission(user, company, 'clients', id ? 'edit' : 'create');
  const canCreate = hasCompanyPermission(user, company, 'clients', 'create');

  const { options: clientOptions } = useBillingClients(businessId);
  const incomeOptions = useIncomeAccounts(businessId);
  const { settings, taxCodes, taxOptions, defaultTaxCodeKey, loaded: settingsLoaded } = useBillingSettings();

  const [form, setForm] = useState(() => emptyForm(params.get('clientId') || ''));
  const [lines, setLines] = useState(() => [blankLine('', 'quote')]);
  const [original, setOriginal] = useState(null);
  const [loadedId, setLoadedId] = useState(null);
  const [saving, setSaving] = useState('');
  const [modal, setModal] = useState('');
  const loading = Boolean(id) && loadedId !== id;

  const [defaultsApplied, setDefaultsApplied] = useState(false);
  if (!id && settingsLoaded && !defaultsApplied) {
    setDefaultsApplied(true);
    setForm((f) => ({ ...f, terms: f.terms || settings?.invoiceTerms || '' }));
    setLines((ls) => ls.map((l) => (l.taxCodeKey ? l : { ...l, taxCodeKey: defaultTaxCodeKey })));
  }

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    quotesApi.get(id)
      .then((res) => {
        if (!alive) return;
        const q = res.data?.quote || res.data?.data;
        setOriginal(q);
        setForm({
          kind: q.kind || 'quote',
          client: idOf(q.client),
          title: q.title || '',
          issueDate: isoDate(q.issueDate),
          validUntil: isoDate(q.validUntil),
          currency: q.currency || 'KES',
          taxMode: q.taxMode || 'exclusive',
          notes: q.notes || '',
          terms: q.terms || '',
        });
        setLines((q.lines || []).length ? q.lines.map(fromApiLine) : [blankLine('', 'quote')]);
        setLoadedId(id);
      })
      .catch((err) => { toast.error(apiError(err, 'Could not load the quote')); if (alive) setLoadedId(id); });
    return () => { alive = false; };
  }, [id]);

  const set = useCallback((field) => (e) => setForm((f) => ({ ...f, [field]: e?.target ? e.target.value : e })), []);
  const totals = useMemo(() => summarizeLines(lines, taxCodes, form.taxMode), [lines, taxCodes, form.taxMode]);
  const monthly = useMemo(() => contractMetrics({ lines, taxCodes, taxMode: form.taxMode, startDate: form.issueDate, openEnded: true }).mrr, [lines, taxCodes, form.taxMode, form.issueDate]);
  const locked = Boolean(original && !['draft', 'sent'].includes(original.status));
  const convertible = Boolean(original && ['draft', 'sent', 'accepted'].includes(original.status));

  const save = async (markSent = false) => {
    if (!form.client) { toast.error('Select the client'); return; }
    if (!form.issueDate || !form.validUntil) { toast.error('Quote date and validity are required'); return; }
    if (form.validUntil < form.issueDate) { toast.error('Valid-until cannot be before the quote date'); return; }
    const err = validateLines(lines, 'quote');
    if (err) { toast.error(err); return; }
    setSaving(markSent ? 'send' : 'save');
    try {
      const payload = { ...form, title: form.title.trim(), notes: form.notes.trim(), terms: form.terms.trim(), lines: lines.map(toContractLine) };
      const res = id ? await quotesApi.update(id, payload) : await quotesApi.create(payload);
      const q = res.data?.quote || res.data?.data;
      if (markSent) await quotesApi.send(q._id);
      toast.success(`${form.kind === 'proforma' ? 'Proforma' : 'Quote'} ${q.quoteNumber} ${markSent ? 'saved and marked sent' : 'saved'}`);
      invalidateList(`client-quotes:${businessId}`);
      navigate('/clients/quotes', { state: { tabTitle: 'Quotes' } });
    } catch (e) {
      toast.error(apiError(e, 'Could not save the quote'));
    } finally {
      setSaving('');
    }
  };
  const print = async () => {
    try { await quotesApi.pdf(id, { preview: true, number: original?.quoteNumber }); } catch (err) { toast.error(apiError(err, 'Could not open the quote')); }
  };

  if (loading) {
    return <ClientsShell><div className="flex flex-1 items-center justify-center gap-2 text-slate-400"><Spinner size="sm" /><span className="text-xs font-semibold">Loading quote…</span></div></ClientsShell>;
  }

  const cur = form.currency || 'KES';
  const busy = Boolean(saving);
  const kindToggle = (
    <div className="flex items-center gap-3">
      <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">Document</h3>
      {['quote', 'proforma'].map((k) => (
        <label key={k} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-700">
          <input type="radio" className="accent-[#0B3B2E]" checked={form.kind === k} onChange={() => setForm((f) => ({ ...f, kind: k }))} disabled={locked} />
          {k === 'quote' ? 'Quotation' : 'Proforma invoice'}
        </label>
      ))}
      {original && <span className="ml-auto flex items-center gap-2 text-xs"><b className="text-[#0B3B2E]">{original.quoteNumber}</b><StatusPill status={original.status} /></span>}
    </div>
  );

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <form id={FORM_ID} onSubmit={(e) => { e.preventDefault(); save(false); }} className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-2.5">
          {original?.declineReason && <div className="border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800"><b>Declined:</b> {original.declineReason}</div>}
          <Section title={kindToggle}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6">
              <div className="col-span-2">
                <label className={labelClass}>Client<Required /></label>
                <AppSelect size="sm" value={form.client} onChange={(v) => setForm((f) => ({ ...f, client: v || '' }))} options={clientOptions} placeholder="Select client…" searchable disabled={locked || Boolean(id)} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Title</label>
                <input className={inputClass} value={form.title} onChange={set('title')} maxLength={150} placeholder="e.g. Annual support & hosting proposal" disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Quote date<Required /></label>
                <input type="date" className={inputClass} value={form.issueDate} onChange={set('issueDate')} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Valid until<Required /></label>
                <input type="date" className={inputClass} value={form.validUntil} onChange={set('validUntil')} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Currency</label>
                <AppSelect size="sm" value={form.currency} onChange={(v) => setForm((f) => ({ ...f, currency: v || 'KES' }))} options={CURRENCY_OPTIONS} disabled={locked} />
              </div>
              <div>
                <label className={labelClass}>Tax mode</label>
                <AppSelect size="sm" value={form.taxMode} onChange={(v) => setForm((f) => ({ ...f, taxMode: v || 'exclusive' }))} options={TAX_MODE_OPTIONS} disabled={locked} />
              </div>
            </div>
          </Section>

          <Section title="Lines">
            <LineItemsEditor lines={lines} onChange={setLines} mode="quote" taxCodes={taxCodes} taxOptions={taxOptions} taxMode={form.taxMode} incomeOptions={incomeOptions} defaultTaxCodeKey={defaultTaxCodeKey} disabled={locked} />
            <div className="mt-2 flex flex-wrap items-start gap-3">
              <div className="grid min-w-[300px] flex-1 grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Notes</label>
                  <textarea rows={3} className={textareaClass} value={form.notes} onChange={set('notes')} placeholder="Scope, assumptions, delivery timelines…" disabled={locked} />
                </div>
                <div>
                  <label className={labelClass}>Terms</label>
                  <textarea rows={3} className={textareaClass} value={form.terms} onChange={set('terms')} disabled={locked} />
                </div>
              </div>
              <TotalsBlock rows={[
                { label: 'Subtotal', value: money(totals.gross) },
                totals.discount > 0 && { label: 'Discount', value: `− ${money(totals.discount)}`, muted: true },
                { label: 'VAT / tax', value: money(totals.tax) },
                { label: 'Total (all lines once)', value: `${cur} ${money(totals.total)}`, hero: true },
                monthly > 0 && { label: 'Recurring per month (net)', value: money(monthly), muted: true },
              ]} />
            </div>
          </Section>
        </form>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => navigate('/clients/quotes')} className={footerBtn} disabled={busy}>Cancel</button>
            {!id && <button type="button" onClick={() => { setForm(emptyForm(params.get('clientId') || '')); setLines([blankLine(defaultTaxCodeKey, 'quote')]); }} className={footerBtn} disabled={busy}>Reset</button>}
            {id && <button type="button" onClick={print} className={footerBtn} disabled={busy}>Print</button>}
            {convertible && canCreate && !original.convertedInvoice && <button type="button" onClick={() => setModal('invoice')} className={footerDark} disabled={busy}>To invoice</button>}
            {convertible && canCreate && !original.convertedContract && <button type="button" onClick={() => setModal('contract')} className={footerDark} disabled={busy}>To contract</button>}
            {!locked && (
              <>
                <button type="submit" form={FORM_ID} className={footerDark} disabled={!canSave || busy}>{saving === 'save' ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => save(true)} className={footerPrimary} disabled={!canSave || busy}>{saving === 'send' ? 'Saving…' : 'Save & mark sent'}</button>
              </>
            )}
          </div>
        </div>
      </div>
      {modal === 'contract' && original && <ConvertToContractModal quote={original} defaultTermsDays={Number(settings?.defaultPaymentTermsDays ?? 30)} onClose={() => setModal('')} onDone={() => invalidateList(`client-quotes:${businessId}`)} />}
      {modal === 'invoice' && original && <ConvertToInvoiceModal quote={original} defaultTermsDays={Number(settings?.defaultPaymentTermsDays ?? 30)} onClose={() => setModal('')} onDone={() => invalidateList(`client-quotes:${businessId}`)} />}
    </ClientsShell>
  );
};

export default QuoteForm;
