import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPlus, FaTrash, FaChevronDown, FaChevronRight } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import AppSelect from '../../components/common/AppSelect';
import CurrencyInput from '../../components/common/CurrencyInput';
import { Section } from '../../components/Clients/clientUi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import {
  inputClass, labelClass, tableInputClass, textareaClass, footerBtn, footerPrimary, iconBtn, iconBtnDanger, useClientsAccess,
} from '../../components/Clients/clientHelpers';

const MERGE_FIELDS = ['clientName', 'invoiceNumber', 'amount', 'outstanding', 'dueDate', 'daysOverdue', 'payInstructions', 'companyName'];
const LIMIT_ACTIONS = [
  { value: 'warn', label: 'Warn, allow billing' },
  { value: 'block', label: 'Block new billing' },
];
const offsetLabel = (d) => (d < 0 ? `${-d} day(s) before due` : d === 0 ? 'On due date' : `${d} day(s) overdue`);

/** Textarea/input with merge-field chips that insert at the caret. */
const TemplateField = ({ label, value, onChange, rows = 0 }) => {
  const ref = useRef(null);
  const insert = (field) => {
    const el = ref.current;
    const token = `{{${field}}}`;
    if (!el) { onChange(`${value}${token}`); return; }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-bold text-slate-900">{label}</span>
        {MERGE_FIELDS.map((f) => (
          <button key={f} type="button" onClick={() => insert(f)} className="border border-slate-300 bg-white px-1 text-[9px] font-bold text-slate-600 hover:border-[#0B3B2E] hover:text-[#0B3B2E]">{f}</button>
        ))}
      </div>
      {rows
        ? <textarea ref={ref} rows={rows} className={textareaClass} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input ref={ref} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />}
      {!rows && label.startsWith('SMS') && <p className="mt-0.5 text-[10px] text-slate-500">{value.length} chars</p>}
    </div>
  );
};

const ClientDunningSettings = () => {
  const navigate = useNavigate();
  const { canEdit } = useClientsAccess();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      setSettings(unwrap(await clientsCollectionsApi.getCollectionSettings()));
    } catch (err) {
      toast.error(apiError(err, 'Failed to load collections settings'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const setStep = (i, k, v) => setSettings((s) => ({ ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, [k]: v } : st)) }));
  const toggleChannel = (i, ch) => setSettings((s) => ({
    ...s,
    steps: s.steps.map((st, j) => (j === i ? { ...st, channels: st.channels.includes(ch) ? st.channels.filter((c) => c !== ch) : [...st.channels, ch] } : st)),
  }));
  const addStep = () => setSettings((s) => {
    const last = s.steps[s.steps.length - 1];
    const offset = (last?.offsetDays ?? 0) + 7;
    return { ...s, steps: [...s.steps, { key: `overdue_${offset}`, offsetDays: offset, channels: ['sms', 'email'], smsTemplate: last?.smsTemplate || '', emailSubject: last?.emailSubject || '', emailTemplate: last?.emailTemplate || '', active: true }] };
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const keys = new Set();
    for (const st of settings.steps) {
      if (!st.key.trim()) { toast.error('Every step needs a key'); return; }
      if (keys.has(st.key.trim())) { toast.error(`Duplicate step key "${st.key}"`); return; }
      keys.add(st.key.trim());
    }
    setSaving(true);
    try {
      const res = await clientsCollectionsApi.updateCollectionSettings({
        dunningEnabled: settings.dunningEnabled,
        steps: [...settings.steps].map((st) => ({ ...st, key: st.key.trim(), offsetDays: Number(st.offsetDays) })).sort((a, b) => a.offsetDays - b.offsetDays),
        payInstructions: settings.payInstructions,
        minimumAmount: Number(settings.minimumAmount || 0),
        creditLimitAction: settings.creditLimitAction,
        creditWarnPercent: Number(settings.creditWarnPercent || 90),
      });
      setSettings(unwrap(res));
      toast.success(res.data?.message || 'Settings saved');
    } catch (err) {
      toast.error(apiError(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <ClientsShell><div className="py-16 text-center text-sm text-slate-400">Loading settings…</div></ClientsShell>;

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <form id="dunning-settings-form" onSubmit={handleSubmit} noValidate className="w-full space-y-2.5">
            <Section
              bodyClass="p-0"
              title={(
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">Automated payment reminders</h3>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-slate-800">
                    <input type="checkbox" className="accent-[#0B3B2E]" checked={settings.dunningEnabled} onChange={(e) => set('dunningEnabled', e.target.checked)} />
                    {settings.dunningEnabled ? 'On — sends daily' : 'Off — nothing is sent'}
                  </label>
                </div>
              )}
            >
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                    <th className="w-7" />
                    <th className="px-2 py-1" style={{ width: '18%' }}>Step key</th>
                    <th className="px-2 py-1" style={{ width: '12%' }}>Offset (days)</th>
                    <th className="px-2 py-1" style={{ width: '20%' }}>When</th>
                    <th className="px-2 py-1" style={{ width: '18%' }}>Channels</th>
                    <th className="px-2 py-1" style={{ width: '10%' }}>Active</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {settings.steps.map((st, i) => (
                    <React.Fragment key={i}>
                      <tr className="border-b border-slate-100">
                        <td className="px-1 text-center">
                          <button type="button" className={iconBtn} title="Edit templates" onClick={() => setOpen(open === i ? null : i)}>{open === i ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}</button>
                        </td>
                        <td className="px-2 py-1"><input className={tableInputClass} value={st.key} onChange={(e) => setStep(i, 'key', e.target.value)} /></td>
                        <td className="px-2 py-1"><input type="number" min="-60" max="365" className={tableInputClass} value={st.offsetDays} onChange={(e) => setStep(i, 'offsetDays', e.target.value)} /></td>
                        <td className="px-2 py-1 text-slate-600">{offsetLabel(Number(st.offsetDays))}</td>
                        <td className="px-2 py-1">
                          {['sms', 'email'].map((ch) => (
                            <label key={ch} className="mr-3 inline-flex cursor-pointer items-center gap-1 font-semibold uppercase text-slate-700">
                              <input type="checkbox" className="accent-[#0B3B2E]" checked={st.channels.includes(ch)} onChange={() => toggleChannel(i, ch)} /> {ch}
                            </label>
                          ))}
                        </td>
                        <td className="px-2 py-1"><input type="checkbox" className="accent-[#0B3B2E]" checked={st.active !== false} onChange={(e) => setStep(i, 'active', e.target.checked)} /></td>
                        <td className="px-1 text-center">
                          <button type="button" title="Remove step" className={iconBtnDanger} onClick={() => setSettings((s) => ({ ...s, steps: s.steps.filter((_, j) => j !== i) }))}><FaTrash size={11} /></button>
                        </td>
                      </tr>
                      {open === i && (
                        <tr className="border-b border-slate-200 bg-slate-50/70">
                          <td />
                          <td colSpan={6} className="space-y-2 px-2 py-2">
                            <TemplateField label="SMS template" value={st.smsTemplate} onChange={(v) => setStep(i, 'smsTemplate', v)} />
                            <TemplateField label="Email subject" value={st.emailSubject} onChange={(v) => setStep(i, 'emailSubject', v)} />
                            <TemplateField label="Email body" rows={6} value={st.emailTemplate} onChange={(v) => setStep(i, 'emailTemplate', v)} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              <div className="px-2 py-1.5">
                <button type="button" onClick={addStep} className="inline-flex items-center gap-1 text-xs font-bold text-[#0B3B2E] hover:underline"><FaPlus size={9} /> Add step</button>
              </div>
            </Section>

            <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
              <Section title="Payment instructions">
                <label className={labelClass}>Shown in every reminder as {'{{payInstructions}}'}</label>
                <textarea rows={3} maxLength={500} className={textareaClass} value={settings.payInstructions || ''} onChange={(e) => set('payInstructions', e.target.value)} placeholder="Pay via M-Pesa Paybill 123456, account = invoice number, or bank transfer to …" />
                <div className="mt-2 w-48">
                  <label className={labelClass}>Skip balances below</label>
                  <CurrencyInput value={settings.minimumAmount} onChange={(e) => set('minimumAmount', e.target.value)} />
                </div>
              </Section>
              <Section title="Credit limits">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <AppSelect size="sm" label="When a client is over their limit" value={settings.creditLimitAction} onChange={(v) => set('creditLimitAction', v || 'warn')} options={LIMIT_ACTIONS} />
                  <div>
                    <label className={labelClass}>Warn at % of limit</label>
                    <input type="number" min="1" max="100" className={inputClass} value={settings.creditWarnPercent} onChange={(e) => set('creditWarnPercent', e.target.value)} />
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Per-client limits are set on each client's commercial terms (0 = no limit). Credit hold always blocks billing.</p>
              </Section>
            </div>
          </form>
        </div>
        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={footerBtn} onClick={() => navigate('/clients/collections')} disabled={saving}>Cancel</button>
            <button type="button" className={footerBtn} onClick={load} disabled={saving}>Reset</button>
            {canEdit && <button type="submit" form="dunning-settings-form" className={footerPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>}
          </div>
        </div>
      </div>
    </ClientsShell>
  );
};

export default ClientDunningSettings;
