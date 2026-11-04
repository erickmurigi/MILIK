// Contract billing settings (CompanySettings.clientBilling): approval rules, billing-run default,
// payment terms, document number prefixes, invoice terms and payment details.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaSyncAlt } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import CurrencyInput from '../../components/common/CurrencyInput';
import Spinner from '../../components/common/Spinner';
import { Section, labelClass, inputClass, textareaClass, footerBtn, footerPrimary, barBtn } from '../../components/Clients/Billing/BillingUi';
import { invalidateBillingSettings } from '../../components/Clients/Billing/billingShared';
import { billingApi, contractsApi, apiError } from '../../services/clientsBillingApi';

const FORM_ID = 'client-billing-settings';
const PREFIXES = [
  ['invoicePrefix', 'Invoices'],
  ['creditNotePrefix', 'Credit notes'],
  ['debitNotePrefix', 'Debit notes'],
  ['quotePrefix', 'Quotes'],
];
const BANK_FIELDS = [
  ['bankName', 'Bank'],
  ['branch', 'Branch'],
  ['accountName', 'Account name'],
  ['accountNumber', 'Account number'],
  ['swiftCode', 'SWIFT / BIC'],
];

const toForm = (s = {}) => ({
  approvalThreshold: s.approvalThreshold ?? '',
  maxDiscountWithoutApproval: s.maxDiscountWithoutApproval ?? '',
  escalationRequiresApproval: Boolean(s.escalationRequiresApproval),
  billingRunPostsAsDraft: Boolean(s.billingRunPostsAsDraft),
  defaultPaymentTermsDays: String(s.defaultPaymentTermsDays ?? 30),
  invoicePrefix: s.invoicePrefix || 'CINV',
  creditNotePrefix: s.creditNotePrefix || 'CN',
  debitNotePrefix: s.debitNotePrefix || 'DN',
  quotePrefix: s.quotePrefix || 'QUO',
  invoiceTerms: s.invoiceTerms || '',
  mpesaPaybill: s.mpesaPaybill || '',
  bankDetails: { bankName: '', branch: '', accountName: '', accountNumber: '', swiftCode: '', ...(s.bankDetails || {}) },
});

const BillingSettings = () => {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(null); // { settings, taxCodes, defaultTaxCodeKey }
  const [form, setForm] = useState(toForm());
  const [saving, setSaving] = useState(false);
  const [escalating, setEscalating] = useState(false);

  useEffect(() => {
    let alive = true;
    billingApi.getSettings()
      .then((res) => {
        if (!alive) return;
        const data = res.data?.data || {};
        setLoaded(data);
        setForm(toForm(data.settings));
      })
      .catch((err) => { toast.error(apiError(err, 'Could not load billing settings')); if (alive) setLoaded({}); });
    return () => { alive = false; };
  }, []);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };
  const setBank = (k) => (e) => setForm((f) => ({ ...f, bankDetails: { ...f.bankDetails, [k]: e.target.value } }));

  const save = async (e) => {
    e.preventDefault();
    for (const [key, label] of PREFIXES) {
      if (!/^[A-Za-z0-9]{1,8}$/.test(form[key])) { toast.error(`${label} prefix must be 1–8 letters/digits`); return; }
    }
    if (form.maxDiscountWithoutApproval !== '' && Number(form.maxDiscountWithoutApproval) > 100) { toast.error('Max discount cannot exceed 100%'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        approvalThreshold: form.approvalThreshold === '' ? null : Number(form.approvalThreshold),
        maxDiscountWithoutApproval: form.maxDiscountWithoutApproval === '' ? null : Number(form.maxDiscountWithoutApproval),
        defaultPaymentTermsDays: Number(form.defaultPaymentTermsDays || 0),
      };
      const res = await billingApi.updateSettings(payload);
      invalidateBillingSettings();
      const saved = res.data?.data?.settings || payload;
      setLoaded((l) => ({ ...l, settings: saved }));
      setForm(toForm(saved));
      toast.success('Billing settings saved');
    } catch (err) {
      toast.error(apiError(err, 'Could not save billing settings'));
    } finally {
      setSaving(false);
    }
  };

  const runEscalations = async () => {
    setEscalating(true);
    try {
      const res = await contractsApi.runEscalations({});
      const d = res.data?.data || res.data || {};
      toast.success(`Escalations: ${d.escalated ?? 0} applied, ${d.pendingApproval ?? 0} awaiting approval`);
    } catch (err) {
      toast.error(apiError(err, 'Could not run escalations'));
    } finally {
      setEscalating(false);
    }
  };

  if (!loaded) {
    return <ClientsShell><div className="flex flex-1 items-center justify-center gap-2 text-slate-400"><Spinner size="sm" /><span className="text-xs font-semibold">Loading settings…</span></div></ClientsShell>;
  }

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <form id={FORM_ID} onSubmit={save} className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-2.5">
          <div className="grid gap-2 lg:grid-cols-2">
            <Section title="Approvals">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <label className={labelClass}>Approval above contract value (TCV)</label>
                  <CurrencyInput value={form.approvalThreshold} onChange={set('approvalThreshold')} placeholder="No limit" />
                </div>
                <div>
                  <label className={labelClass}>Max line discount without approval (%)</label>
                  <input className={inputClass} inputMode="decimal" value={form.maxDiscountWithoutApproval} placeholder="No limit" onChange={(e) => setForm((f) => ({ ...f, maxDiscountWithoutApproval: e.target.value.replace(/[^0-9.]/g, '') }))} />
                </div>
                <label className="col-span-2 inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <input type="checkbox" className="accent-[#0B3B2E]" checked={form.escalationRequiresApproval} onChange={set('escalationRequiresApproval')} />
                  Scheduled price escalations need approval before they apply
                </label>
                <p className="col-span-2 text-[11px] text-slate-500">Contracts and amendments over the threshold or discount limit go to "Pending approval"; the approver must be someone other than the creator.</p>
              </div>
            </Section>

            <Section title="Billing">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div>
                  <label className={labelClass}>Default payment terms (days)</label>
                  <input className={inputClass} inputMode="numeric" value={form.defaultPaymentTermsDays} onChange={(e) => setForm((f) => ({ ...f, defaultPaymentTermsDays: e.target.value.replace(/[^0-9]/g, '') }))} />
                </div>
                <div className="flex items-end">
                  <label className="inline-flex h-7 items-center gap-1.5 text-xs font-bold text-slate-900">
                    <input type="checkbox" className="accent-[#0B3B2E]" checked={form.billingRunPostsAsDraft} onChange={set('billingRunPostsAsDraft')} />
                    Billing runs create drafts
                  </label>
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                  <button type="button" className={barBtn} onClick={runEscalations} disabled={escalating}><FaSyncAlt size={10} /> {escalating ? 'Running…' : 'Run due escalations now'}</button>
                  <span className="text-[11px] text-slate-500">Escalations also run automatically every day.</span>
                </div>
              </div>
            </Section>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            <Section title="Document numbering">
              <div className="grid grid-cols-4 gap-x-3 gap-y-2">
                {PREFIXES.map(([key, label]) => (
                  <div key={key}>
                    <label className={labelClass}>{label}</label>
                    <input className={`${inputClass} uppercase`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() }))} />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">e.g. {form.invoicePrefix}-00042. Changing a prefix starts a new series; existing numbers are kept.</p>
            </Section>

            <Section title="Tax codes">
              <div className="flex flex-wrap gap-1">
                {(loaded.taxCodes || []).map((c) => (
                  <span key={c.key} className={`border px-1.5 py-0.5 text-[11px] ${c.key === loaded.defaultTaxCodeKey ? 'border-[#0B3B2E] font-bold text-[#0B3B2E]' : 'border-slate-200 text-slate-700'}`}>
                    {c.name}{c.type === 'vat' ? ` · ${c.rate}%` : ''}{c.key === loaded.defaultTaxCodeKey ? ' (default)' : ''}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Tax codes come from the company tax settings.{' '}
                <button type="button" className="font-bold text-[#0B3B2E] hover:underline" onClick={() => navigate('/settings')}>Manage tax codes</button>
              </p>
            </Section>
          </div>

          <Section title="Invoice footer & payment details">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6">
              <div className="col-span-2 md:col-span-3 md:row-span-2">
                <label className={labelClass}>Default invoice terms</label>
                <textarea rows={4} className={textareaClass} value={form.invoiceTerms} onChange={set('invoiceTerms')} placeholder="e.g. Payment due within 30 days. Interest of 1.5% per month on overdue balances." />
              </div>
              <div className="md:col-span-1">
                <label className={labelClass}>M-Pesa paybill</label>
                <input className={inputClass} value={form.mpesaPaybill} onChange={set('mpesaPaybill')} maxLength={20} />
              </div>
              {BANK_FIELDS.map(([key, label]) => (
                <div key={key} className={key === 'accountName' ? 'md:col-span-2' : ''}>
                  <label className={labelClass}>{label}</label>
                  <input className={inputClass} value={form.bankDetails[key] || ''} onChange={setBank(key)} maxLength={80} />
                </div>
              ))}
            </div>
          </Section>
        </form>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={footerBtn} onClick={() => navigate(-1)} disabled={saving}>Cancel</button>
            <button type="button" className={footerBtn} onClick={() => setForm(toForm(loaded.settings))} disabled={saving}>Reset</button>
            <button type="submit" form={FORM_ID} className={footerPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </ClientsShell>
  );
};

export default BillingSettings;
