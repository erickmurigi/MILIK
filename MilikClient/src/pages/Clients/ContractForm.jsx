// Contract create / edit-draft / amend (live contract) form.
//   /clients/contracts/new[?clientId=]   create a draft
//   /clients/contracts/:id/edit          drafts: full edit; live contracts: amendment mode
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaPlus, FaSyncAlt } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import AppSelect from '../../components/common/AppSelect';
import CurrencyInput from '../../components/common/CurrencyInput';
import Spinner from '../../components/common/Spinner';
import LineItemsEditor from '../../components/Clients/Billing/LineItemsEditor';
import { blankLine, fromApiLine, toContractLine, validateLines } from '../../components/Clients/Billing/billingLines';
import {
  Section, Required, TotalsBlock, labelClass, inputClass, textareaClass, footerBtn, footerPrimary, footerDark,
} from '../../components/Clients/Billing/BillingUi';
import {
  CONTRACT_TYPE_OPTIONS, CURRENCY_OPTIONS, INTEREST_BASIS_OPTIONS, PRORATION_OPTIONS, TAX_MODE_OPTIONS,
  contractMetrics, idOf, isoDate, money, summarizeLines, todayIso, addMonthsIso, addDaysIso,
  useBillingClients, useBillingSettings, useBillingUsers, useIncomeAccounts, invalidateList,
} from '../../components/Clients/Billing/billingShared';
import { contractsApi, apiError } from '../../services/clientsBillingApi';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';
import { hasCompanyPermission } from '../../utils/permissions';
import { useEntityCache } from '../../hooks/useEntityCache';
import { getProperties } from '../../redux/propertyRedux';

const FORM_ID = 'contract-form';
const LIVE = ['active', 'suspended', 'pending_renewal'];
// Fields an amendment can change (server AMENDABLE_FIELDS) vs. fields a live contract edits directly.
const AMENDABLE = [
  'endDate', 'openEnded', 'billingDay', 'prorationRule', 'taxMode', 'paymentTermsDays', 'escalationPercent',
  'escalationPeriodYears', 'currency', 'poNumber', 'minimumTermMonths', 'autoRenew', 'renewalTermMonths',
  'latePaymentInterestPercent', 'latePaymentInterestBasis', 'latePaymentGraceDays', 'depositAmount', 'terms',
  'slaText', 'noticePeriodDays',
];
const DIRECT = ['description', 'owner', 'property', 'contractType', 'autoBill'];

const emptyForm = (clientId = '', termsDays = 30) => {
  const start = todayIso();
  return {
    client: clientId,
    description: '',
    contractType: 'retainer',
    owner: '',
    property: '',
    poNumber: '',
    currency: 'KES',
    startDate: start,
    endDate: addDaysIso(addMonthsIso(start, 12), -1),
    openEnded: false,
    minimumTermMonths: '12',
    noticePeriodDays: '30',
    autoRenew: false,
    renewalTermMonths: '12',
    billingDay: '',
    prorationRule: 'none',
    autoBill: true,
    taxMode: 'exclusive',
    paymentTermsDays: String(termsDays),
    escalationPercent: '0',
    escalationPeriodYears: '1',
    latePaymentInterestPercent: '0',
    latePaymentInterestBasis: 'monthly',
    latePaymentGraceDays: '0',
    depositAmount: '',
    terms: '',
    slaText: '',
    effectiveDate: todayIso(),
    changeSummary: '',
  };
};

const fromContract = (c) => ({
  ...emptyForm(),
  client: idOf(c.client),
  description: c.description || '',
  contractType: c.contractType || 'retainer',
  owner: idOf(c.owner),
  property: idOf(c.property),
  poNumber: c.poNumber || '',
  currency: c.currency || 'KES',
  startDate: isoDate(c.startDate),
  endDate: isoDate(c.endDate),
  openEnded: Boolean(c.openEnded),
  minimumTermMonths: String(c.minimumTermMonths ?? 0),
  noticePeriodDays: String(c.noticePeriodDays ?? 30),
  autoRenew: Boolean(c.autoRenew),
  renewalTermMonths: String(c.renewalTermMonths ?? 12),
  billingDay: c.billingDay ? String(c.billingDay) : '',
  prorationRule: c.prorationRule || 'none',
  autoBill: Boolean(c.autoBill),
  taxMode: c.taxMode || 'exclusive',
  paymentTermsDays: String(c.paymentTermsDays ?? 30),
  escalationPercent: String(c.escalationPercent ?? 0),
  escalationPeriodYears: String(c.escalationPeriodYears ?? 1),
  latePaymentInterestPercent: String(c.latePaymentInterestPercent ?? 0),
  latePaymentInterestBasis: c.latePaymentInterestBasis || 'monthly',
  latePaymentGraceDays: String(c.latePaymentGraceDays ?? 0),
  depositAmount: c.depositAmount ? String(c.depositAmount) : '',
  terms: c.terms || '',
  slaText: c.slaText || '',
  effectiveDate: todayIso(),
  changeSummary: '',
});

// Form → API payload (numbers coerced, blanks normalised).
const toPayload = (f) => ({
  client: f.client,
  description: f.description.trim(),
  contractType: f.contractType,
  owner: f.owner || null,
  property: f.property || null,
  poNumber: f.poNumber.trim(),
  currency: f.currency,
  startDate: f.startDate,
  endDate: f.openEnded ? null : f.endDate,
  openEnded: f.openEnded,
  minimumTermMonths: Number(f.minimumTermMonths || 0),
  noticePeriodDays: Number(f.noticePeriodDays || 0),
  autoRenew: f.autoRenew,
  renewalTermMonths: Number(f.renewalTermMonths || 12),
  billingDay: f.billingDay ? Number(f.billingDay) : null,
  prorationRule: f.prorationRule,
  autoBill: f.autoBill,
  taxMode: f.taxMode,
  paymentTermsDays: Number(f.paymentTermsDays || 0),
  escalationPercent: Number(f.escalationPercent || 0),
  escalationPeriodYears: Number(f.escalationPeriodYears || 1),
  latePaymentInterestPercent: Number(f.latePaymentInterestPercent || 0),
  latePaymentInterestBasis: f.latePaymentInterestBasis,
  latePaymentGraceDays: Number(f.latePaymentGraceDays || 0),
  depositAmount: Number(f.depositAmount || 0),
  terms: f.terms.trim(),
  slaText: f.slaText.trim(),
});

const digits = (v) => v.replace(/[^0-9]/g, '');
const decimal = (v) => v.replace(/[^0-9.]/g, '');

const ContractForm = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canSave = hasCompanyPermission(user, company, 'clients', id ? 'edit' : 'create');

  const { options: clientOptions, refresh: refreshClients } = useBillingClients(businessId);
  const ownerOptions = useBillingUsers(businessId);
  const incomeOptions = useIncomeAccounts(businessId);
  const { settings, taxCodes, taxOptions, defaultTaxCodeKey, loaded: settingsLoaded } = useBillingSettings();
  const { propertiesLoaded } = useEntityCache(businessId);
  const properties = useSelector((s) => s.property?.properties);
  useEffect(() => {
    if (businessId && !propertiesLoaded) dispatch(getProperties({ business: businessId }));
  }, [businessId, propertiesLoaded, dispatch]);
  const propertyOptions = useMemo(
    () => (properties || []).map((p) => ({ value: p._id, label: p.propertyName || p.name || 'Property', description: p.propertyCode || '' })),
    [properties],
  );

  const [form, setForm] = useState(() => emptyForm(params.get('clientId') || ''));
  const [lines, setLines] = useState(() => [blankLine('', 'contract')]);
  const [original, setOriginal] = useState(null); // loaded contract (edit/amend)
  const [loadedId, setLoadedId] = useState(null);
  const loading = Boolean(id) && loadedId !== id;
  const [saving, setSaving] = useState('');
  const [amendResult, setAmendResult] = useState(null);

  const isLive = Boolean(original && LIVE.includes(original.status));
  const isAmend = isLive;
  const isLocked = Boolean(original && !LIVE.includes(original.status) && !['draft', 'pending_approval'].includes(original.status));

  // Defaults from billing settings for a brand-new contract (applied once, when they arrive).
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  if (!id && settingsLoaded && !defaultsApplied) {
    setDefaultsApplied(true);
    setForm((f) => ({ ...f, paymentTermsDays: String(settings?.defaultPaymentTermsDays ?? f.paymentTermsDays) }));
    setLines((ls) => ls.map((l) => (l.taxCodeKey ? l : { ...l, taxCodeKey: defaultTaxCodeKey })));
  }

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    contractsApi.get(id)
      .then((res) => {
        if (!alive) return;
        const c = res.data?.contract || res.data?.data;
        setOriginal(c);
        setForm(fromContract(c));
        setLines(c.lines?.length ? c.lines.map(fromApiLine) : [blankLine('', 'contract')]);
        setLoadedId(id);
      })
      .catch((err) => { toast.error(apiError(err, 'Could not load the contract')); if (alive) setLoadedId(id); });
    return () => { alive = false; };
  }, [id]);

  const set = useCallback((field) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [field]: value }));
  }, []);
  const setVal = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const totals = useMemo(() => summarizeLines(lines, taxCodes, form.taxMode), [lines, taxCodes, form.taxMode]);
  const metrics = useMemo(() => contractMetrics({
    lines, taxCodes, taxMode: form.taxMode, startDate: form.startDate, endDate: form.openEnded ? '' : form.endDate,
    openEnded: form.openEnded, minimumTermMonths: form.minimumTermMonths,
  }), [lines, taxCodes, form.taxMode, form.startDate, form.endDate, form.openEnded, form.minimumTermMonths]);
  const cur = form.currency || 'KES';

  const validate = () => {
    if (!form.client) return 'Select the client';
    if (!form.startDate) return 'Start date is required';
    if (!form.openEnded) {
      if (!form.endDate) return 'End date is required (or tick open-ended)';
      if (form.endDate <= form.startDate) return 'End date must be after the start date';
    }
    if (form.billingDay && (Number(form.billingDay) < 1 || Number(form.billingDay) > 28)) return 'Billing day must be between 1 and 28';
    if (Number(form.escalationPercent || 0) > 100) return 'Escalation cannot exceed 100%';
    if (Number(form.latePaymentInterestPercent || 0) > 100) return 'Late interest cannot exceed 100%';
    if (isAmend) {
      if (!form.effectiveDate) return 'Amendment effective date is required';
      if (form.effectiveDate < form.startDate) return 'Effective date cannot be before the contract start';
      if (!form.changeSummary.trim()) return 'Describe the change (change summary)';
    }
    return validateLines(lines, 'contract');
  };

  const afterSave = (contract) => {
    invalidateList(`contracts:${businessId}`);
    navigate(`/clients/contracts/${contract._id}`, { replace: true, state: { tabTitle: contract.contractNumber } });
  };

  const saveDraft = async (submitAfter = false) => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(submitAfter ? 'submit' : 'draft');
    try {
      const payload = { ...toPayload(form), lines: lines.map(toContractLine) };
      const res = id ? await contractsApi.update(id, payload) : await contractsApi.create(payload);
      let contract = res.data?.contract || res.data?.data;
      if (submitAfter) {
        const sub = await contractsApi.submit(contract._id);
        contract = sub.data?.contract || contract;
        if (sub.data?.requiresApproval) {
          toast.info(`Submitted for approval — ${(sub.data.approvalReasons || []).join('; ')}`, { autoClose: 8000 });
        } else {
          toast.success(sub.data?.message || 'Contract activated');
        }
      } else {
        toast.success(res.data?.message || 'Draft saved');
      }
      afterSave(contract);
    } catch (e) {
      toast.error(apiError(e, 'Could not save the contract'));
    } finally {
      setSaving('');
    }
  };

  const applyAmendment = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    const before = toPayload(fromContract(original));
    const after = toPayload(form);
    const amend = { effectiveDate: form.effectiveDate, changeSummary: form.changeSummary.trim() };
    for (const f of AMENDABLE) if (JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)) amend[f] = after[f];
    const beforeLines = JSON.stringify((original.lines || []).map(fromApiLine).map(toContractLine));
    const afterLines = lines.map(toContractLine);
    if (JSON.stringify(afterLines) !== beforeLines) amend.lines = afterLines;
    const direct = {};
    for (const f of DIRECT) if (JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null)) direct[f] = after[f];
    const hasAmendment = Object.keys(amend).length > 2;
    if (!hasAmendment && !Object.keys(direct).length) { toast.info('Nothing has changed'); return; }

    setSaving('amend');
    try {
      if (Object.keys(direct).length) await contractsApi.update(id, direct);
      if (!hasAmendment) {
        toast.success('Contract details updated');
        afterSave(original);
        return;
      }
      const res = await contractsApi.amend(id, amend);
      invalidateList(`contracts:${businessId}`);
      if (res.status === 202 || res.data?.requiresApproval) {
        setAmendResult({ pending: true, version: res.data?.version, reasons: res.data?.approvalReasons || [] });
      } else {
        toast.success(res.data?.message || 'Amendment applied');
        afterSave(original);
      }
    } catch (e) {
      toast.error(apiError(e, 'Could not apply the amendment'));
    } finally {
      setSaving('');
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (isAmend) applyAmendment(); else saveDraft(false);
  };
  const handleCancel = () => (id ? navigate(`/clients/contracts/${id}`, { state: { tabTitle: original?.contractNumber } }) : navigate('/clients/contracts'));
  const handleReset = () => {
    setForm(emptyForm(params.get('clientId') || '', settings?.defaultPaymentTermsDays ?? 30));
    setLines([blankLine(defaultTaxCodeKey, 'contract')]);
  };

  if (loading) {
    return <ClientsShell><div className="flex flex-1 items-center justify-center gap-2 text-slate-400"><Spinner size="sm" /><span className="text-xs font-semibold">Loading contract…</span></div></ClientsShell>;
  }

  const clientLocked = Boolean(original && !['draft', 'pending_approval'].includes(original.status));
  const cell2 = 'grid grid-cols-2 gap-x-3 gap-y-2';

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <form id={FORM_ID} onSubmit={onSubmit} className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-2.5">
          {original && (
            <div className="flex flex-wrap items-center gap-2 border border-slate-200 bg-white px-3 py-1.5 text-xs">
              <span className="font-black text-[#0B3B2E]">{original.contractNumber}</span>
              <span className="text-slate-500">v{original.version || 1} · {String(original.status).replace(/_/g, ' ')}</span>
              {original.status === 'pending_approval' && <span className="font-semibold text-amber-700">Editing withdraws it from approval — submit again when done.</span>}
              {isAmend && <span className="font-semibold text-slate-700">Amendment mode — commercial changes create a new contract version from the effective date.</span>}
              {isLocked && <span className="font-semibold text-red-700">This contract is {original.status} and can no longer be edited.</span>}
            </div>
          )}

          {amendResult?.pending && (
            <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-black uppercase tracking-wide">Amendment v{amendResult.version?.version || ''} requires approval</p>
              <p className="mt-0.5">It was saved and will apply from {form.effectiveDate} once approved on the contract's Versions tab.</p>
              {amendResult.reasons.length > 0 && <ul className="mt-1 list-disc pl-4">{amendResult.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <button type="button" className="mt-1.5 font-bold text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/contracts/${id}`, { state: { tabTitle: original.contractNumber, tab: 'versions' } })}>Open contract versions →</button>
            </div>
          )}

          {isAmend && (
            <Section title="Amendment">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6">
                <div>
                  <label className={labelClass}>Effective date<Required /></label>
                  <input type="date" className={inputClass} value={form.effectiveDate} onChange={set('effectiveDate')} />
                </div>
                <div className="col-span-2 md:col-span-5">
                  <label className={labelClass}>Change summary<Required /></label>
                  <input className={inputClass} value={form.changeSummary} onChange={set('changeSummary')} maxLength={200} placeholder="e.g. Added 2 user licences from March; price review" />
                </div>
              </div>
            </Section>
          )}

          <Section title="Client & type">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-6">
              <div className="col-span-2">
                <label className={`${labelClass} flex items-center justify-between`}>
                  <span>Client<Required /></span>
                  {!clientLocked && (
                    <span className="flex items-center gap-2 text-[10px] font-bold">
                      <button type="button" className="text-slate-500 hover:text-slate-800" title="Reload clients" onClick={refreshClients}><FaSyncAlt size={9} /></button>
                      <button type="button" className="inline-flex items-center gap-0.5 text-[#0B3B2E] hover:underline" onClick={() => navigate('/clients/new', { state: { tabTitle: 'New Client' } })}><FaPlus size={8} /> New client</button>
                    </span>
                  )}
                </label>
                <AppSelect size="sm" value={form.client} onChange={(v) => setVal('client', v || '')} options={clientOptions} placeholder="Select client…" searchable disabled={clientLocked} />
              </div>
              <div>
                <label className={labelClass}>Contract type</label>
                <AppSelect size="sm" value={form.contractType} onChange={(v) => setVal('contractType', v || 'retainer')} options={CONTRACT_TYPE_OPTIONS} disabled={isLocked} />
              </div>
              <div>
                <label className={labelClass}>Owner</label>
                <AppSelect size="sm" value={form.owner} onChange={(v) => setVal('owner', v || '')} options={ownerOptions} placeholder="Me" searchable clearable disabled={isLocked} />
              </div>
              <div>
                <label className={labelClass}>Linked property</label>
                <AppSelect size="sm" value={form.property} onChange={(v) => setVal('property', v || '')} options={propertyOptions} placeholder="None" searchable clearable disabled={isLocked} />
              </div>
              <div className="grid grid-cols-2 gap-x-2">
                <div>
                  <label className={labelClass}>PO no.</label>
                  <input className={inputClass} value={form.poNumber} onChange={set('poNumber')} maxLength={40} disabled={isLocked} />
                </div>
                <div>
                  <label className={labelClass}>Currency</label>
                  <AppSelect size="sm" value={form.currency} onChange={(v) => setVal('currency', v || 'KES')} options={CURRENCY_OPTIONS} disabled={isLocked} />
                </div>
              </div>
              <div className="col-span-2 md:col-span-6">
                <label className={labelClass}>Description</label>
                <input className={inputClass} value={form.description} onChange={set('description')} maxLength={200} placeholder="e.g. Managed IT support retainer" disabled={isLocked} />
              </div>
            </div>
          </Section>

          <div className="grid gap-2 lg:grid-cols-2">
            <Section title="Term">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                <div>
                  <label className={labelClass}>Start date<Required /></label>
                  <input type="date" className={inputClass} value={form.startDate} onChange={set('startDate')} disabled={isAmend || isLocked} />
                </div>
                <div>
                  <label className={`${labelClass} flex items-center justify-between`}>
                    <span>End date{!form.openEnded && <Required />}</span>
                    <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600">
                      <input type="checkbox" className="accent-[#0B3B2E]" checked={form.openEnded} onChange={set('openEnded')} disabled={isLocked} /> Open-ended
                    </label>
                  </label>
                  <input type="date" className={inputClass} value={form.openEnded ? '' : form.endDate} onChange={set('endDate')} disabled={form.openEnded || isLocked} />
                </div>
                <div>
                  <label className={labelClass}>Minimum term (months)</label>
                  <input className={inputClass} inputMode="numeric" value={form.minimumTermMonths} onChange={(e) => setVal('minimumTermMonths', digits(e.target.value))} disabled={isLocked} />
                </div>
                <div>
                  <label className={labelClass}>Notice (days)</label>
                  <input className={inputClass} inputMode="numeric" value={form.noticePeriodDays} onChange={(e) => setVal('noticePeriodDays', digits(e.target.value))} disabled={isLocked} />
                </div>
                <div className="col-span-2 flex items-end gap-3">
                  <label className="inline-flex h-7 items-center gap-1.5 text-xs font-bold text-slate-900">
                    <input type="checkbox" className="accent-[#0B3B2E]" checked={form.autoRenew} onChange={set('autoRenew')} disabled={isLocked} /> Auto-renew
                  </label>
                  <div className="flex-1">
                    <label className={labelClass}>Renewal term (months)</label>
                    <input className={inputClass} inputMode="numeric" value={form.renewalTermMonths} onChange={(e) => setVal('renewalTermMonths', digits(e.target.value))} disabled={!form.autoRenew || isLocked} />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Deposit</label>
                  <CurrencyInput prefix={cur} value={form.depositAmount} onChange={set('depositAmount')} disabled={isLocked} />
                </div>
              </div>
            </Section>

            <Section title="Billing">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
                <div>
                  <label className={labelClass}>Billing day (1–28)</label>
                  <input className={inputClass} inputMode="numeric" value={form.billingDay} onChange={(e) => setVal('billingDay', digits(e.target.value).slice(0, 2))} placeholder="Start day" disabled={isLocked} />
                </div>
                <div>
                  <label className={labelClass}>Proration</label>
                  <AppSelect size="sm" value={form.prorationRule} onChange={(v) => setVal('prorationRule', v || 'none')} options={PRORATION_OPTIONS} disabled={isLocked} />
                </div>
                <div>
                  <label className={labelClass}>Tax mode</label>
                  <AppSelect size="sm" value={form.taxMode} onChange={(v) => setVal('taxMode', v || 'exclusive')} options={TAX_MODE_OPTIONS} disabled={isLocked} />
                </div>
                <div>
                  <label className={labelClass}>Payment terms (days)</label>
                  <input className={inputClass} inputMode="numeric" value={form.paymentTermsDays} onChange={(e) => setVal('paymentTermsDays', digits(e.target.value))} disabled={isLocked} />
                </div>
                <div className="col-span-2 md:col-span-4">
                  <label className="inline-flex h-7 items-center gap-1.5 text-xs font-bold text-slate-900">
                    <input type="checkbox" className="accent-[#0B3B2E]" checked={form.autoBill} onChange={set('autoBill')} disabled={isLocked} />
                    Auto-bill — include in the scheduled billing run
                  </label>
                </div>
                <div>
                  <label className={labelClass}>Escalation %</label>
                  <input className={inputClass} inputMode="decimal" value={form.escalationPercent} onChange={(e) => setVal('escalationPercent', decimal(e.target.value))} disabled={isLocked} />
                </div>
                <div>
                  <label className={labelClass}>Every (years)</label>
                  <input className={inputClass} inputMode="numeric" value={form.escalationPeriodYears} onChange={(e) => setVal('escalationPeriodYears', digits(e.target.value))} disabled={isLocked} />
                </div>
                <div className="col-span-2 grid grid-cols-3 gap-x-2">
                  <div>
                    <label className={labelClass}>Late interest %</label>
                    <input className={inputClass} inputMode="decimal" value={form.latePaymentInterestPercent} onChange={(e) => setVal('latePaymentInterestPercent', decimal(e.target.value))} disabled={isLocked} />
                  </div>
                  <div>
                    <label className={labelClass}>Basis</label>
                    <AppSelect size="sm" value={form.latePaymentInterestBasis} onChange={(v) => setVal('latePaymentInterestBasis', v || 'monthly')} options={INTEREST_BASIS_OPTIONS} disabled={isLocked} />
                  </div>
                  <div>
                    <label className={labelClass}>Grace (days)</label>
                    <input className={inputClass} inputMode="numeric" value={form.latePaymentGraceDays} onChange={(e) => setVal('latePaymentGraceDays', digits(e.target.value))} disabled={isLocked} />
                  </div>
                </div>
              </div>
            </Section>
          </div>

          <Section title="Lines">
            <LineItemsEditor
              lines={lines}
              onChange={setLines}
              mode="contract"
              taxCodes={taxCodes}
              taxOptions={taxOptions}
              taxMode={form.taxMode}
              incomeOptions={incomeOptions}
              defaultTaxCodeKey={defaultTaxCodeKey}
              disabled={isLocked}
            />
            <div className="mt-2 flex flex-wrap items-start gap-3">
              <div className="grid flex-1 grid-cols-3 gap-2 text-xs">
                {[
                  ['MRR', metrics.mrr, 'Monthly recurring revenue (net of tax)'],
                  ['ACV', metrics.acv, 'Annual contract value'],
                  ['TCV', metrics.tcv, `Total contract value over ${metrics.term} months`],
                ].map(([label, value, hint]) => (
                  <div key={label} className="border border-slate-200 px-2.5 py-1.5" title={hint}>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</p>
                    <p className="text-sm font-black tabular-nums text-slate-900">{cur} {money(value)}</p>
                  </div>
                ))}
              </div>
              <TotalsBlock
                rows={[
                  { label: 'Subtotal', value: money(totals.gross) },
                  totals.discount > 0 && { label: 'Discount', value: `− ${money(totals.discount)}`, muted: true },
                  { label: form.taxMode === 'inclusive' ? 'Net of tax' : 'Net', value: money(totals.net) },
                  { label: 'VAT / tax', value: money(totals.tax) },
                  { label: 'Total per period', value: `${cur} ${money(totals.total)}`, hero: true },
                ]}
              />
            </div>
          </Section>

          <Section title="Terms & SLA">
            <div className={cell2}>
              <div>
                <label className={labelClass}>Contract terms</label>
                <textarea rows={3} className={textareaClass} value={form.terms} onChange={set('terms')} placeholder="Scope, payment terms, termination clauses…" disabled={isLocked} />
              </div>
              <div>
                <label className={labelClass}>Service levels (SLA)</label>
                <textarea rows={3} className={textareaClass} value={form.slaText} onChange={set('slaText')} placeholder="Response times, uptime, support hours…" disabled={isLocked} />
              </div>
            </div>
          </Section>
        </form>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={handleCancel} className={footerBtn} disabled={Boolean(saving)}>Cancel</button>
            {!id && <button type="button" onClick={handleReset} className={footerBtn} disabled={Boolean(saving)}>Reset</button>}
            {isAmend ? (
              <button type="submit" form={FORM_ID} className={footerPrimary} disabled={!canSave || Boolean(saving) || Boolean(amendResult)}>
                {saving === 'amend' ? 'Applying…' : 'Apply amendment'}
              </button>
            ) : !isLocked && (
              <>
                <button type="submit" form={FORM_ID} className={footerDark} disabled={!canSave || Boolean(saving)}>
                  {saving === 'draft' ? 'Saving…' : 'Save draft'}
                </button>
                <button type="button" onClick={() => saveDraft(true)} className={footerPrimary} disabled={!canSave || Boolean(saving)}>
                  {saving === 'submit' ? 'Submitting…' : 'Submit'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </ClientsShell>
  );
};

export default ContractForm;
