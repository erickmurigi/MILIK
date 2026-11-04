import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPlus, FaTrash, FaExclamationTriangle, FaExternalLinkAlt } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import AppSelect from '../../components/common/AppSelect';
import CurrencyInput from '../../components/common/CurrencyInput';
import { clientsApi } from '../../services/clientsApi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { Section, Required, UploadButton } from '../../components/Clients/clientUi';
import {
  CLIENT_STATUS_OPTIONS, CLIENT_TYPE_OPTIONS, CURRENCY_OPTIONS, RECEIPT_METHOD_OPTIONS,
  inputClass, labelClass, tableInputClass, textareaClass, footerBtn, footerPrimary, iconBtnDanger,
  pinHint, useClientsAccess, useCompanyUsers, isoDate, invalidateClientLookup,
} from '../../components/Clients/clientHelpers';

const EMPTY_CONTACT = { name: '', role: '', email: '', phone: '', isPrimary: false, receivesInvoices: 'none' };
const RECIPIENT_OPTIONS = [
  { value: 'to', label: 'To' },
  { value: 'cc', label: 'Cc' },
  { value: 'none', label: 'No' },
];

const EMPTY = {
  clientType: 'company', name: '', tradingName: '', taxPin: '', companyRegistration: '', industry: '',
  status: 'active', accountManager: '', tags: '', email: '', phone: '',
  vatRegistered: false,
  taxBehaviour: { vatWithholdingAgent: false, incomeTaxWhtAgent: false, incomeTaxWhtRate: 5, taxExempt: false, exemptionCertificateNo: '', exemptionExpiry: '' },
  terms: { currency: 'KES', paymentTermsDays: 30, creditLimit: '', preferredPaymentMethod: '' },
  address: { line1: '', city: '', country: 'Kenya' },
  billingSame: true,
  billingAddress: { line1: '', city: '', country: '' },
  contactPersons: [{ ...EMPTY_CONTACT, isPrimary: true }],
  dunningOptOut: false, creditHold: false, creditHoldReason: '',
  documents: [],
  notes: '',
  // Preserved on edit (the API resets them to defaults when omitted).
  category: 'individual', source: 'direct',
};

const fromClient = (c) => ({
  ...EMPTY,
  clientType: c.clientType || 'company',
  name: c.name || '',
  tradingName: c.tradingName || '',
  taxPin: c.taxPin || '',
  companyRegistration: c.companyRegistration || '',
  industry: c.industry || '',
  status: c.status || 'active',
  accountManager: c.accountManager?._id || c.accountManager || '',
  tags: (c.tags || []).join(', '),
  email: c.email || '',
  phone: c.phone || '',
  vatRegistered: Boolean(c.vatRegistered),
  taxBehaviour: {
    ...EMPTY.taxBehaviour,
    ...(c.taxBehaviour || {}),
    exemptionExpiry: isoDate(c.taxBehaviour?.exemptionExpiry),
  },
  terms: { ...EMPTY.terms, ...(c.terms || {}), creditLimit: c.terms?.creditLimit ? String(c.terms.creditLimit) : '' },
  address: { ...EMPTY.address, ...(c.address || {}) },
  billingSame: !c.billingAddress,
  billingAddress: { ...EMPTY.billingAddress, ...(c.billingAddress || {}) },
  contactPersons: c.contactPersons?.length ? c.contactPersons.map((p) => ({ ...EMPTY_CONTACT, ...p })) : [{ ...EMPTY_CONTACT, isPrimary: true }],
  dunningOptOut: Boolean(c.dunningOptOut),
  creditHold: Boolean(c.creditHold),
  creditHoldReason: c.creditHoldReason || '',
  documents: (c.documents || []).map((d) => ({ ...d, uploadedAt: d.uploadedAt })),
  notes: c.notes || '',
  category: c.category || 'individual',
  source: c.source || 'direct',
});

const Check = ({ label, checked, onChange, disabled }) => (
  <label className={`inline-flex h-7 items-center gap-1.5 text-xs font-semibold text-slate-800 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <input type="checkbox" className="accent-[#0B3B2E]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

const ClientForm = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { businessId } = useClientsAccess();
  const { options: managerOptions } = useCompanyUsers(businessId);

  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const dupKeyRef = useRef('');

  useEffect(() => {
    if (!isEdit) return;
    let alive = true;
    clientsApi.get(id)
      .then((res) => { if (alive) setForm(fromClient(res.data?.client || unwrap(res))); })
      .catch((err) => toast.error(apiError(err, 'Failed to load client')))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, isEdit]);

  const set = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), []);
  const setIn = useCallback((group, key, value) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: value } })), []);
  const setContact = (index, key, value) => setForm((f) => ({
    ...f,
    contactPersons: f.contactPersons.map((p, i) => {
      if (key === 'isPrimary') return { ...p, isPrimary: i === index };
      return i === index ? { ...p, [key]: value } : p;
    }),
  }));
  const setDoc = (index, key, value) => setForm((f) => ({ ...f, documents: f.documents.map((d, i) => (i === index ? { ...d, [key]: value } : d)) }));

  const pin = useMemo(() => pinHint(form.taxPin, form.clientType), [form.taxPin, form.clientType]);

  // Duplicate check on blur of name / PIN / phone (skips repeat lookups).
  const checkDuplicates = useCallback(async () => {
    const params = { name: form.name.trim(), taxPin: form.taxPin.trim().toUpperCase(), phone: form.phone.trim(), email: form.email.trim() };
    if (!params.name && !params.taxPin && !params.phone) return;
    const key = JSON.stringify(params);
    if (key === dupKeyRef.current) return;
    dupKeyRef.current = key;
    try {
      const data = unwrap(await clientsCollectionsApi.duplicates({ ...params, ...(isEdit ? { excludeId: id } : {}) }));
      setDuplicates(data?.matches || []);
    } catch {
      // Advisory only.
    }
  }, [form.name, form.taxPin, form.phone, form.email, id, isEdit]);

  const buildPayload = () => {
    const tb = form.taxBehaviour;
    return {
      clientType: form.clientType,
      name: form.name.trim(),
      tradingName: form.tradingName.trim(),
      taxPin: form.taxPin.trim().toUpperCase(),
      companyRegistration: form.companyRegistration.trim(),
      industry: form.industry.trim(),
      status: form.status,
      accountManager: form.accountManager || '',
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      email: form.email.trim(),
      phone: form.phone.trim(),
      vatRegistered: form.vatRegistered,
      taxBehaviour: {
        vatWithholdingAgent: tb.vatWithholdingAgent,
        incomeTaxWhtAgent: tb.incomeTaxWhtAgent,
        incomeTaxWhtRate: Number(tb.incomeTaxWhtRate || 0),
        taxExempt: tb.taxExempt,
        exemptionCertificateNo: tb.taxExempt ? tb.exemptionCertificateNo.trim() : '',
        exemptionExpiry: tb.taxExempt && tb.exemptionExpiry ? tb.exemptionExpiry : null,
      },
      terms: {
        currency: form.terms.currency || 'KES',
        paymentTermsDays: Number(form.terms.paymentTermsDays || 0),
        creditLimit: Number(form.terms.creditLimit || 0),
        preferredPaymentMethod: form.terms.preferredPaymentMethod || '',
      },
      address: form.address,
      billingAddress: form.billingSame ? null : form.billingAddress,
      contactPersons: form.contactPersons.filter((p) => p.name.trim()),
      dunningOptOut: form.dunningOptOut,
      creditHold: form.creditHold,
      creditHoldReason: form.creditHold ? form.creditHoldReason.trim() : '',
      documents: form.documents.filter((d) => d.url.trim()),
      notes: form.notes,
      category: form.category,
      source: form.source,
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Client name is required'); return; }
    if (pin.error) { toast.error(`KRA PIN: ${pin.error}`); return; }
    if (form.creditHold && !form.creditHoldReason.trim()) { toast.error('Give a reason for the credit hold'); return; }
    if (form.taxBehaviour.incomeTaxWhtAgent && !(Number(form.taxBehaviour.incomeTaxWhtRate) > 0)) { toast.error('Enter the income tax WHT rate'); return; }
    setSaving(true);
    try {
      const payload = buildPayload();
      const res = isEdit ? await clientsApi.update(id, payload) : await clientsApi.create(payload);
      const saved = res.data?.client || unwrap(res);
      (res.data?.warnings || []).forEach((w) => toast.warn(w));
      toast.success(res.data?.message || (isEdit ? 'Client updated' : 'Client created'));
      invalidateClientLookup(businessId);
      navigate(`/clients/${saved?._id || id}`, { replace: true, state: { tabTitle: saved?.name || form.name } });
    } catch (err) {
      toast.error(apiError(err, 'Failed to save client'));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => navigate(isEdit ? `/clients/${id}` : '/clients');
  const handleReset = () => { setForm(EMPTY); setDuplicates([]); dupKeyRef.current = ''; };

  if (loading) {
    return <ClientsShell><div className="py-16 text-center text-sm text-slate-400">Loading client…</div></ClientsShell>;
  }

  const tb = form.taxBehaviour;

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <form id="client-form" onSubmit={handleSubmit} noValidate className="w-full space-y-2.5">
            <Section title="Identity">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6">
                <AppSelect size="sm" label="Client type" value={form.clientType} onChange={(v) => set('clientType', v || 'company')} options={CLIENT_TYPE_OPTIONS} />
                <div className="col-span-2">
                  <label className={labelClass}>Legal name<Required /></label>
                  <input className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} onBlur={checkDuplicates} placeholder="Registered / full legal name" />
                </div>
                <div>
                  <label className={labelClass}>Trading name</label>
                  <input className={inputClass} value={form.tradingName} onChange={(e) => set('tradingName', e.target.value)} placeholder="Trading as" />
                </div>
                <div>
                  <label className={labelClass}>KRA PIN</label>
                  <input
                    className={`${inputClass} font-mono uppercase ${pin.error ? '!border-red-400' : pin.warning ? '!border-amber-400' : ''}`}
                    value={form.taxPin}
                    onChange={(e) => set('taxPin', e.target.value.toUpperCase())}
                    onBlur={checkDuplicates}
                    placeholder="P051234567X"
                    maxLength={11}
                  />
                  {(pin.error || pin.warning) && <p className={`mt-0.5 text-[10px] font-semibold ${pin.error ? 'text-red-600' : 'text-amber-700'}`}>{pin.error || pin.warning}</p>}
                </div>
                <div>
                  <label className={labelClass}>Registration no.</label>
                  <input className={inputClass} value={form.companyRegistration} onChange={(e) => set('companyRegistration', e.target.value)} placeholder="CPR/2024/000000" />
                </div>
                <div>
                  <label className={labelClass}>Industry</label>
                  <input className={inputClass} value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. Banking" />
                </div>
                <AppSelect size="sm" label="Status" value={form.status} onChange={(v) => set('status', v || 'active')} options={CLIENT_STATUS_OPTIONS} />
                <AppSelect size="sm" label="Account manager" clearable searchable value={form.accountManager} onChange={(v) => set('accountManager', v || '')} options={managerOptions} placeholder="Unassigned" />
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" className={inputClass} value={form.email} onChange={(e) => set('email', e.target.value)} onBlur={checkDuplicates} placeholder="accounts@client.com, or -" />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="tel" className={inputClass} value={form.phone} onChange={(e) => set('phone', e.target.value)} onBlur={checkDuplicates} placeholder="0712 345 678, or -" />
                </div>
                <div>
                  <label className={labelClass}>Tags</label>
                  <input className={inputClass} value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="retainer, key-account" />
                </div>
              </div>
              {duplicates.length > 0 && (
                <div className="mt-2 border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                  <p className="flex items-center gap-1.5 font-bold"><FaExclamationTriangle size={10} /> Possible duplicate{duplicates.length > 1 ? 's' : ''} — check before saving</p>
                  <ul className="mt-1 space-y-0.5">
                    {duplicates.slice(0, 5).map((m) => (
                      <li key={m.client._id} className="flex flex-wrap items-center gap-1.5">
                        <Link to={`/clients/${m.client._id}`} state={{ tabTitle: m.client.name }} className="inline-flex items-center gap-1 font-semibold text-[#0B3B2E] underline">
                          {m.client.name}{m.client.clientCode ? ` (${m.client.clientCode})` : ''} <FaExternalLinkAlt size={8} />
                        </Link>
                        <span className="text-amber-800">matches on {m.reasons.map((r) => (r === 'taxPin' ? 'KRA PIN' : r)).join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              <Section title="Tax behaviour">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-3">
                  <Check label="VAT registered" checked={form.vatRegistered} onChange={(v) => set('vatRegistered', v)} />
                  <Check label="VAT withholding agent (2%)" checked={tb.vatWithholdingAgent} onChange={(v) => setIn('taxBehaviour', 'vatWithholdingAgent', v)} />
                  <Check label="Income tax WHT agent" checked={tb.incomeTaxWhtAgent} onChange={(v) => setIn('taxBehaviour', 'incomeTaxWhtAgent', v)} />
                  <div>
                    <label className={labelClass}>WHT rate %</label>
                    <input type="number" min="0" max="100" step="0.5" disabled={!tb.incomeTaxWhtAgent} className={inputClass} value={tb.incomeTaxWhtRate} onChange={(e) => setIn('taxBehaviour', 'incomeTaxWhtRate', e.target.value)} />
                  </div>
                  <div className="col-span-2 flex items-end">
                    <Check label="Tax exempt" checked={tb.taxExempt} onChange={(v) => setIn('taxBehaviour', 'taxExempt', v)} />
                  </div>
                  {tb.taxExempt && (
                    <>
                      <div className="col-span-2">
                        <label className={labelClass}>Exemption certificate no.</label>
                        <input className={inputClass} value={tb.exemptionCertificateNo} onChange={(e) => setIn('taxBehaviour', 'exemptionCertificateNo', e.target.value)} />
                      </div>
                      <div>
                        <label className={labelClass}>Expiry</label>
                        <input type="date" className={inputClass} value={tb.exemptionExpiry} onChange={(e) => setIn('taxBehaviour', 'exemptionExpiry', e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
              </Section>

              <Section title="Commercial terms">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <AppSelect size="sm" label="Currency" value={form.terms.currency} onChange={(v) => setIn('terms', 'currency', v || 'KES')} options={CURRENCY_OPTIONS} />
                  <div>
                    <label className={labelClass}>Payment terms (days)</label>
                    <input type="number" min="0" className={inputClass} value={form.terms.paymentTermsDays} onChange={(e) => setIn('terms', 'paymentTermsDays', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Credit limit <span className="font-normal text-slate-500">(0 = none)</span></label>
                    <CurrencyInput prefix={form.terms.currency || 'KES'} value={form.terms.creditLimit} onChange={(e) => setIn('terms', 'creditLimit', e.target.value)} />
                  </div>
                  <AppSelect size="sm" label="Preferred payment method" clearable value={form.terms.preferredPaymentMethod} onChange={(v) => setIn('terms', 'preferredPaymentMethod', v || '')} options={RECEIPT_METHOD_OPTIONS} />
                </div>
              </Section>
            </div>

            <Section
              title={(
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">Addresses</h3>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <input type="checkbox" className="accent-[#0B3B2E]" checked={form.billingSame} onChange={(e) => set('billingSame', e.target.checked)} />
                    Billing address same as physical
                  </label>
                </div>
              )}
            >
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6">
                <div className="col-span-2">
                  <label className={labelClass}>Physical address</label>
                  <input className={inputClass} value={form.address.line1} onChange={(e) => setIn('address', 'line1', e.target.value)} placeholder="Street / building / P.O. Box" />
                </div>
                <div>
                  <label className={labelClass}>City</label>
                  <input className={inputClass} value={form.address.city} onChange={(e) => setIn('address', 'city', e.target.value)} />
                </div>
                {!form.billingSame ? (
                  <>
                    <div className="col-span-2">
                      <label className={labelClass}>Billing address</label>
                      <input className={inputClass} value={form.billingAddress.line1} onChange={(e) => setIn('billingAddress', 'line1', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelClass}>Billing city</label>
                      <input className={inputClass} value={form.billingAddress.city} onChange={(e) => setIn('billingAddress', 'city', e.target.value)} />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className={labelClass}>Country</label>
                    <input className={inputClass} value={form.address.country} onChange={(e) => setIn('address', 'country', e.target.value)} />
                  </div>
                )}
              </div>
            </Section>

            <Section title="Contacts" bodyClass="p-0">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-white text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1" style={{ width: '22%' }}>Name</th>
                    <th className="px-2 py-1" style={{ width: '16%' }}>Role</th>
                    <th className="px-2 py-1" style={{ width: '24%' }}>Email</th>
                    <th className="px-2 py-1" style={{ width: '16%' }}>Phone</th>
                    <th className="px-2 py-1 text-center" style={{ width: '7%' }}>Primary</th>
                    <th className="px-2 py-1" style={{ width: '11%' }}>Invoices</th>
                    <th style={{ width: '4%' }} />
                  </tr>
                </thead>
                <tbody>
                  {form.contactPersons.map((p, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-2 py-1"><input className={tableInputClass} value={p.name} onChange={(e) => setContact(i, 'name', e.target.value)} placeholder="Full name" /></td>
                      <td className="px-2 py-1"><input className={tableInputClass} value={p.role} onChange={(e) => setContact(i, 'role', e.target.value)} placeholder="Finance manager" /></td>
                      <td className="px-2 py-1"><input type="email" className={tableInputClass} value={p.email} onChange={(e) => setContact(i, 'email', e.target.value)} placeholder="Email, or -" /></td>
                      <td className="px-2 py-1"><input type="tel" className={tableInputClass} value={p.phone} onChange={(e) => setContact(i, 'phone', e.target.value)} placeholder="Phone, or -" /></td>
                      <td className="px-2 py-1 text-center"><input type="radio" name="primaryContact" className="accent-[#0B3B2E]" checked={Boolean(p.isPrimary)} onChange={() => setContact(i, 'isPrimary', true)} /></td>
                      <td className="px-2 py-0.5"><AppSelect size="sm" value={p.receivesInvoices} onChange={(v) => setContact(i, 'receivesInvoices', v || 'none')} options={RECIPIENT_OPTIONS} /></td>
                      <td className="px-1 py-1 text-center">
                        <button type="button" title="Remove contact" className={iconBtnDanger} onClick={() => setForm((f) => ({ ...f, contactPersons: f.contactPersons.filter((_, j) => j !== i) }))}><FaTrash size={11} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-2 py-1.5">
                <button type="button" onClick={() => setForm((f) => ({ ...f, contactPersons: [...f.contactPersons, { ...EMPTY_CONTACT, isPrimary: f.contactPersons.length === 0 }] }))} className="inline-flex items-center gap-1 text-xs font-bold text-[#0B3B2E] hover:underline">
                  <FaPlus size={9} /> Add contact
                </button>
              </div>
            </Section>

            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              <Section title="Collections">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <Check label="Opt out of automated reminders" checked={form.dunningOptOut} onChange={(v) => set('dunningOptOut', v)} />
                  <Check label="Credit hold (blocks new billing)" checked={form.creditHold} onChange={(v) => set('creditHold', v)} />
                  {form.creditHold && (
                    <div className="col-span-2">
                      <label className={labelClass}>Hold reason<Required /></label>
                      <input className={inputClass} value={form.creditHoldReason} onChange={(e) => set('creditHoldReason', e.target.value)} placeholder="Why billing is blocked" />
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className={labelClass}>Notes</label>
                    <textarea rows={2} className={textareaClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                  </div>
                </div>
              </Section>

              <Section title="Documents" bodyClass="p-2.5 space-y-1.5">
                {form.documents.length === 0 && <p className="text-[11px] text-slate-500">No documents yet. Upload contracts, KYC or certificates (PDF or image), or add a link.</p>}
                {form.documents.map((d, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.6fr_auto] items-center gap-1.5">
                    <input className={tableInputClass} value={d.name} onChange={(e) => setDoc(i, 'name', e.target.value)} placeholder="Document name" />
                    <input className={tableInputClass} value={d.url} onChange={(e) => setDoc(i, 'url', e.target.value)} placeholder="https://… (stored file link)" />
                    <button type="button" title="Remove" className={iconBtnDanger} onClick={() => setForm((f) => ({ ...f, documents: f.documents.filter((_, j) => j !== i) }))}><FaTrash size={11} /></button>
                  </div>
                ))}
                <div className="flex items-center gap-4">
                  <UploadButton onUploaded={(doc) => setForm((f) => ({ ...f, documents: [...f.documents, doc] }))} />
                  <button type="button" onClick={() => setForm((f) => ({ ...f, documents: [...f.documents, { name: '', url: '', uploadedAt: new Date().toISOString() }] }))} className="inline-flex items-center gap-1 text-xs font-bold text-[#0B3B2E] hover:underline">
                    <FaPlus size={9} /> Add link
                  </button>
                </div>
              </Section>
            </div>
          </form>
        </div>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={handleCancel} className={footerBtn} disabled={saving}>Cancel</button>
            {!isEdit && <button type="button" onClick={handleReset} className={footerBtn} disabled={saving}>Reset</button>}
            <button type="submit" form="client-form" className={footerPrimary} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save client'}</button>
          </div>
        </div>
      </div>
    </ClientsShell>
  );
};

export default ClientForm;
