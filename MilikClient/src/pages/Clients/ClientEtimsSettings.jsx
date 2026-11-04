import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPlug, FaRedoAlt, FaSyncAlt } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import MilikTable from '../../components/common/MilikTable';
import PaginationBar from '../../components/PaginationBar';
import AppSelect from '../../components/common/AppSelect';
import { Section, StatusPill, TabStrip, Chip } from '../../components/Clients/clientUi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDateTime } from '../../utils/dates';
import {
  inputClass, labelClass, footerBtn, footerPrimary, iconBtn, cell, cellLast, humanize, useClientsAccess,
} from '../../components/Clients/clientHelpers';

const FIELDS = ['enabled', 'environment', 'baseUrl', 'kraPin', 'branchId', 'deviceSerial', 'defaultItemClassCode', 'defaultItemCode', 'defaultQtyUnitCode', 'defaultPkgUnitCode', 'maxAttempts'];
const ENVIRONMENTS = [{ value: 'sandbox', label: 'Sandbox (testing)' }, { value: 'production', label: 'Production (live)' }];
const SUB_STATUS = ['pending', 'processing', 'submitted', 'failed', 'skipped'].map((s) => ({ value: s, label: humanize(s) }));
const DOC_TYPES = [{ value: 'invoice', label: 'Invoices' }, { value: 'credit_note', label: 'Credit notes' }];

const Field = ({ label, children, className = '' }) => (
  <div className={className}><label className={labelClass}>{label}</label>{children}</div>
);

const SettingsTab = () => {
  const { canEdit } = useClientsAccess();
  const [settings, setSettings] = useState(null);
  const [cmcKey, setCmcKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setSettings(unwrap(await clientsCollectionsApi.getEtimsSettings()));
      setCmcKey('');
    } catch (err) {
      toast.error(apiError(err, 'Failed to load eTIMS settings'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    if (settings.kraPin && !/^[A-Z]\d{9}[A-Z]$/.test(String(settings.kraPin).toUpperCase())) { toast.error('KRA PIN format: letter, 9 digits, letter'); return; }
    setSaving(true);
    try {
      const payload = Object.fromEntries(FIELDS.filter((f) => settings[f] !== undefined).map((f) => [f, settings[f]]));
      payload.maxAttempts = Number(payload.maxAttempts || 6);
      if (cmcKey.trim()) payload.cmcKey = cmcKey.trim();
      const res = await clientsCollectionsApi.updateEtimsSettings(payload);
      setSettings(unwrap(res));
      setCmcKey('');
      toast.success(res.data?.message || 'eTIMS settings saved');
    } catch (err) {
      toast.error(apiError(err, 'Failed to save eTIMS settings'));
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = unwrap(await clientsCollectionsApi.testEtims());
      setTestResult(r);
      if (r?.ok) toast.success('Connected to KRA eTIMS');
      else toast.error(r?.reason || r?.error || 'Connection failed');
      if (r?.ok) load();
    } catch (err) {
      toast.error(apiError(err, 'Connection test failed'));
    } finally {
      setTesting(false);
    }
  };

  if (!settings) return <div className="py-16 text-center text-sm text-slate-400">Loading eTIMS settings…</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <form id="etims-form" onSubmit={save} noValidate className="w-full space-y-2.5">
          <Section
            title={(
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-800">KRA eTIMS (OSCU) connection</h3>
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-slate-800">
                  <input type="checkbox" className="accent-[#0B3B2E]" checked={Boolean(settings.enabled)} onChange={(e) => set('enabled', e.target.checked)} />
                  {settings.enabled ? 'Enabled — invoices are signed with KRA' : 'Disabled'}
                </label>
              </div>
            )}
          >
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
              <AppSelect size="sm" label="Environment" value={settings.environment} onChange={(v) => set('environment', v || 'sandbox')} options={ENVIRONMENTS} />
              <Field label="Base URL" className="md:col-span-3"><input className={inputClass} value={settings.baseUrl || ''} onChange={(e) => set('baseUrl', e.target.value)} placeholder="Blank = KRA default for the environment" /></Field>
              <Field label="KRA PIN"><input className={`${inputClass} font-mono uppercase`} maxLength={11} value={settings.kraPin || ''} onChange={(e) => set('kraPin', e.target.value.toUpperCase())} placeholder="P051234567X" /></Field>
              <Field label="Branch ID"><input className={inputClass} value={settings.branchId || ''} onChange={(e) => set('branchId', e.target.value)} placeholder="00" /></Field>
              <Field label="Device serial"><input className={inputClass} value={settings.deviceSerial || ''} onChange={(e) => set('deviceSerial', e.target.value)} /></Field>
              <Field label={<>CMC key {settings.cmcKeyConfigured && <span className="ml-1 border border-emerald-200 bg-emerald-50 px-1 text-[9px] font-bold uppercase text-emerald-700">configured</span>}</>}>
                <input type="password" autoComplete="new-password" className={inputClass} value={cmcKey} onChange={(e) => setCmcKey(e.target.value)} placeholder={settings.cmcKeyConfigured ? 'Leave blank to keep' : 'Device communication key'} />
              </Field>
            </div>
            {(settings.sdcId || settings.mrcNo) && (
              <p className="mt-2 text-[11px] text-slate-600">Device initialised: SDC <b>{settings.sdcId || '—'}</b> · MRC <b>{settings.mrcNo || '—'}</b>{settings.lastInitializedAt ? ` · ${fmtDateTime(settings.lastInitializedAt)}` : ''}</p>
            )}
            {testResult && (
              <p className={`mt-2 border px-2 py-1 text-[11px] font-semibold ${testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {testResult.ok ? `Connected${testResult.resultMsg ? ` — ${testResult.resultMsg}` : ''}` : testResult.reason || testResult.error || 'Connection failed'}
              </p>
            )}
          </Section>
          <Section title="Defaults for invoice lines">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-5">
              <Field label="Item class code"><input className={inputClass} value={settings.defaultItemClassCode || ''} onChange={(e) => set('defaultItemClassCode', e.target.value)} /></Field>
              <Field label="Item code"><input className={inputClass} value={settings.defaultItemCode || ''} onChange={(e) => set('defaultItemCode', e.target.value)} /></Field>
              <Field label="Quantity unit"><input className={inputClass} value={settings.defaultQtyUnitCode || ''} onChange={(e) => set('defaultQtyUnitCode', e.target.value)} placeholder="U" /></Field>
              <Field label="Package unit"><input className={inputClass} value={settings.defaultPkgUnitCode || ''} onChange={(e) => set('defaultPkgUnitCode', e.target.value)} placeholder="NT" /></Field>
              <Field label="Max retries"><input type="number" min="1" max="20" className={inputClass} value={settings.maxAttempts ?? 6} onChange={(e) => set('maxAttempts', e.target.value)} /></Field>
            </div>
          </Section>
        </form>
      </div>
      <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={`${footerBtn} mr-auto inline-flex items-center gap-1.5`} onClick={test} disabled={testing}><FaPlug size={10} /> {testing ? 'Testing…' : 'Test connection'}</button>
          <button type="button" className={footerBtn} onClick={load} disabled={saving}>Reset</button>
          {canEdit && <button type="submit" form="etims-form" className={footerPrimary} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>}
        </div>
      </div>
    </div>
  );
};

const SubmissionsTab = () => {
  const { canEdit } = useClientsAccess();
  const [status, setStatus] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [data, setData] = useState({ rows: [], pagination: { total: 0, pages: 1 } });
  const [isFetching, setIsFetching] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsFetching(true);
    try {
      const d = unwrap(await clientsCollectionsApi.etimsSubmissions({ page, limit, status: status || undefined, documentType: documentType || undefined }));
      setData({ rows: d?.rows || [], pagination: d?.pagination || { total: 0, pages: 1 } });
    } catch (err) {
      toast.error(apiError(err, 'Failed to load submissions'));
    } finally {
      setIsFetching(false);
    }
  }, [page, limit, status, documentType]);
  useEffect(() => { load(); }, [load]);

  const resubmit = async (s) => {
    setBusyId(s._id);
    try {
      const res = s.documentType === 'credit_note'
        ? await clientsCollectionsApi.submitCreditNoteEtims(s.documentId, true)
        : await clientsCollectionsApi.submitInvoiceEtims(s.documentId, true);
      const r = unwrap(res);
      if (r?.submitted || r?.alreadySubmitted) toast.success('Accepted by KRA');
      else toast.info(r?.error || r?.reason || 'Submission queued');
      load();
    } catch (err) {
      toast.error(apiError(err, 'Resubmission failed'));
      load();
    } finally {
      setBusyId(null);
    }
  };

  const rows = data.rows;
  return (
    <>
      <ListToolbar>
        <Chip>Submissions: {(data.pagination?.total || 0).toLocaleString()}</Chip>
        <ListToolbar.Divider />
        <AppSelect compact clearable placeholder="All statuses" value={status} onChange={(v) => { setStatus(v || ''); setPage(1); }} options={SUB_STATUS} />
        <AppSelect compact clearable placeholder="All documents" value={documentType} onChange={(v) => { setDocumentType(v || ''); setPage(1); }} options={DOC_TYPES} />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={load}>Refresh</ListToolbar.Button>
      </ListToolbar>
      <MilikTable
        tableFixed
        columns={[
          { label: 'Document', width: '14%' },
          { label: 'Client', width: '18%' },
          { label: 'CU invoice no', width: '15%' },
          { label: 'Attempts', align: 'right', width: '7%' },
          { label: 'Last attempt', width: '13%' },
          { label: 'Result', width: '20%' },
          { label: 'Status', width: '8%' },
        ]}
        actionsWidth="5%"
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty="Nothing submitted to eTIMS yet"
        renderRow={(s) => (
          <>
            <td className={`${cell} font-bold text-slate-900`}>{s.documentNumber}<span className="ml-1.5 font-normal text-slate-500">· {s.documentType === 'credit_note' ? 'CN' : 'INV'}</span></td>
            <td className={`${cell} truncate font-semibold text-slate-900`}>{s.client?.name || '—'}</td>
            <td className={`${cell} truncate font-mono text-[10px]`}>{s.cuInvoiceNumber || '—'}</td>
            <td className={`${cell} text-right tabular-nums`}>{s.attempts}</td>
            <td className={`${cell} whitespace-nowrap`}>{s.lastAttemptAt ? fmtDateTime(s.lastAttemptAt) : '—'}</td>
            <td className={`${cell} truncate ${s.error ? 'text-red-600' : 'text-slate-700'}`} title={s.error || s.resultMessage}>{s.error || [s.resultCode, s.resultMessage].filter(Boolean).join(' · ') || '—'}</td>
            <td className={cellLast}><StatusPill status={s.status} /></td>
          </>
        )}
        renderActions={(s) => (canEdit && ['failed', 'pending', 'skipped'].includes(s.status) ? (
          <button type="button" title="Resubmit to KRA" className={iconBtn} disabled={busyId === s._id} onClick={() => resubmit(s)}><FaRedoAlt size={12} /></button>
        ) : null)}
      />
      <PaginationBar
        page={page}
        pages={data.pagination?.pages || 1}
        total={data.pagination?.total || 0}
        pageSize={limit}
        pageSizes={[25, 50, 100, 200]}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
        loading={isFetching}
        label="submissions"
      />
    </>
  );
};

const TABS = [{ key: 'settings', label: 'Settings' }, { key: 'submissions', label: 'Submissions' }];

const ClientEtimsSettings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'submissions' ? 'submissions' : 'settings';
  return (
    <ClientsShell>
      <TabStrip tabs={TABS} active={tab} onChange={(k) => setSearchParams({ tab: k }, { replace: true })} />
      {tab === 'settings' ? <SettingsTab /> : <SubmissionsTab />}
    </ClientsShell>
  );
};

export default ClientEtimsSettings;
