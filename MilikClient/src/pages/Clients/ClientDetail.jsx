import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  FaReceipt, FaPrint, FaSms, FaEnvelope, FaEdit, FaLock, FaLockOpen, FaSyncAlt, FaExternalLinkAlt,
} from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import StatementLedgerTab from '../../components/common/StatementLedgerTab';
import { clientsApi } from '../../services/clientsApi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDate, fmtDateTime, todayISO } from '../../utils/dates';
import { Kpi, Section, StatusPill, TabStrip, ReasonModal, Chip, EmptyNote } from '../../components/Clients/clientUi';
import {
  money, humanize, methodLabel, userName, useClientsAccess, printReport, createListCache,
} from '../../components/Clients/clientHelpers';
import ClientReceiptsTable from '../../components/Clients/ClientReceiptsTable';
import WhtCertificatesTable from '../../components/Clients/WhtCertificatesTable';
import { ApplyCreditModal } from '../../components/Clients/ClientReceiptModals';
import { DisputesPanel, PromisesPanel, DunningLogPanel, LateInterestPanel } from '../../components/Clients/CollectionsPanels';
import ClientTimelineTab, { SendSmsModal } from '../../components/Clients/ClientTimelineTab';
import ClientContractsPanel from '../../components/Clients/Billing/ClientContractsPanel';
import ClientInvoicesPanel from '../../components/Clients/Billing/ClientInvoicesPanel';

const detailCache = createListCache(); // clientId -> { client, summary }

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'statement', label: 'Statement' },
  { key: 'collections', label: 'Collections' },
  { key: 'wht', label: 'WHT certificates' },
  { key: 'documents', label: 'Documents' },
  { key: 'timeline', label: 'Timeline' },
];

const CREDIT_TONE = { ok: 'ok', warn: 'warn', block: 'block' };
const CREDIT_LABEL = { ok: 'Credit OK', warn: 'Credit warning', block: 'Credit blocked' };

// ─── Statement ───────────────────────────────────────────────────────────────
const STATEMENT_TYPE_OPTIONS = [
  { value: 'CHARGE', label: 'Invoices & refunds' },
  { value: 'DEBIT_NOTE', label: 'Debit notes' },
  { value: 'CREDIT_NOTE', label: 'Credit notes' },
  { value: 'PAYMENT', label: 'Receipts & WHT' },
];
const STATEMENT_TYPE_META = {
  CHARGE: { label: 'Invoice', cls: 'text-red-700 bg-red-50 ring-1 ring-red-200' },
  DEBIT_NOTE: { label: 'Debit Note', cls: 'text-rose-700 bg-rose-50 ring-1 ring-rose-200' },
  CREDIT_NOTE: { label: 'Credit', cls: 'text-sky-700 bg-sky-50 ring-1 ring-sky-200' },
  PAYMENT: { label: 'Receipt', cls: 'text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200' },
};
const KIND_TYPE = { debit_note: 'DEBIT_NOTE', credit_note: 'CREDIT_NOTE' };
const KIND_LABEL = { invoice: 'Invoice', debit_note: 'Debit note', credit_note: 'Credit note', receipt: 'Payment', client_receipt: 'Receipt', wht_income_tax: 'Income tax WHT', wht_vat: 'VAT WHT', credit_refund: 'Refund' };

const StatementTab = ({ client, activeContracts }) => {
  const { company } = useClientsAccess();
  const [from, setFrom] = useState('2000-01-01');
  const [to, setTo] = useState(todayISO());
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statement, setStatement] = useState(null);

  // The server computes the opening balance for `from` and the running
  // balance, so the ledger component never has to re-derive it.
  useEffect(() => {
    let alive = true;
    clientsCollectionsApi.statement(client._id, { from: from === '2000-01-01' ? undefined : from, to })
      .then((res) => { if (alive) setStatement(unwrap(res)); })
      .catch((err) => toast.error(apiError(err, 'Failed to load statement')));
    return () => { alive = false; };
  }, [client._id, from, to]);

  const statementData = useMemo(() => {
    if (!statement) return null;
    return {
      ...statement,
      transactions: (statement.transactions || []).map((t) => ({ ...t, type: KIND_TYPE[t.sourceKind] || t.type })),
    };
  }, [statement]);

  const print = () => {
    const tx = statementData?.transactions || [];
    const signed = (t) => (t.type === 'CHARGE' || t.type === 'DEBIT_NOTE');
    printReport({
      title: `Statement — ${client.name}`,
      kicker: 'Client statement',
      orientation: 'portrait',
      subtitle: `${from === '2000-01-01' ? 'All activity' : `${fmtDate(from)}`} – ${fmtDate(to)}${client.taxPin ? ` · PIN ${client.taxPin}` : ''}`,
      summaryItems: [
        ['Opening balance', money(statement.openingBalance)],
        ['Charges', money(statement.totalCharges)],
        ['Credits', money(statement.totalCredits)],
        ['Payments & WHT', money(statement.totalPayments)],
        ['Closing balance', money(statement.closingBalance)],
      ],
      columns: [
        { label: 'Date', value: (t) => (t.opening ? '' : fmtDate(t.date)) },
        { label: 'Type', value: (t) => (t.opening ? '' : KIND_LABEL[t.sourceKind] || t.type) },
        { label: 'Reference', value: (t) => t.transactionCode || '' },
        { label: 'Description', value: (t) => t.description },
        { label: 'Debit', align: 'right', value: (t) => (!t.opening && signed(t) ? money(t.amount) : '') },
        { label: 'Credit', align: 'right', value: (t) => (!t.opening && !signed(t) ? money(t.amount) : '') },
        { label: 'Balance', align: 'right', value: (t) => money(t.balance) },
      ],
      rows: [{ opening: true, description: 'Opening balance', balance: statement.openingBalance }, ...tx],
      company,
    });
  };

  if (!statementData) return <div className="py-16 text-center text-sm text-slate-400">Loading statement…</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListToolbar>
        <Chip>Opening: KES {money(statement.openingBalance)}</Chip>
        <Chip>WHT: KES {money(statement.totalWht)}</Chip>
        <Chip>Closing: KES {money(statement.closingBalance)}</Chip>
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" icon={FaPrint} onClick={print}>Print / PDF</ListToolbar.Button>
      </ListToolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        <StatementLedgerTab
          statementData={statementData}
          extraKpi={{ label: 'Active Contracts', value: String(activeContracts || 0), color: 'text-white' }}
          typeOptions={STATEMENT_TYPE_OPTIONS}
          typeMeta={STATEMENT_TYPE_META}
          from={from}
          to={to}
          typeFilter={typeFilter}
          onFromChange={setFrom}
          onToChange={setTo}
          onTypeFilterChange={setTypeFilter}
        />
      </div>
    </div>
  );
};

// ─── Overview ────────────────────────────────────────────────────────────────
const KV = ({ label, children }) => (
  <div className="flex justify-between gap-3 border-b border-slate-100 py-1 text-xs last:border-b-0">
    <span className="text-slate-500">{label}</span>
    <span className="text-right font-semibold text-slate-900">{children || '—'}</span>
  </div>
);

const OverviewTab = ({ client, summary }) => {
  const [activity, setActivity] = useState(null);
  useEffect(() => {
    let alive = true;
    clientsApi.listInteractions({ clientId: client._id, limit: 8 })
      .then((res) => { if (alive) setActivity(res.data?.interactions || unwrap(res)?.interactions || []); })
      .catch(() => { if (alive) setActivity([]); });
    return () => { alive = false; };
  }, [client._id]);

  const tb = client.taxBehaviour || {};
  const terms = client.terms || {};
  const addr = (a) => [a?.line1, a?.city, a?.country].filter(Boolean).join(', ');

  return (
    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
        <Section title="Contacts" bodyClass="p-0" className="xl:col-span-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1">Name</th><th className="px-3 py-1">Role</th><th className="px-3 py-1">Email</th><th className="px-3 py-1">Phone</th><th className="px-3 py-1">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {(client.contactPersons || []).length === 0 && <tr><td colSpan={5}><EmptyNote>No contact persons — edit the client to add them</EmptyNote></td></tr>}
              {(client.contactPersons || []).map((p, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-1 font-semibold text-slate-900">{p.name}{p.isPrimary && <span className="ml-1.5 border border-slate-300 px-1 text-[9px] font-bold uppercase text-slate-500">Primary</span>}</td>
                  <td className="px-3 py-1 text-slate-700">{p.role || '—'}</td>
                  <td className="px-3 py-1">{p.email ? <a className="text-[#0B3B2E] hover:underline" href={`mailto:${p.email}`}>{p.email}</a> : '—'}</td>
                  <td className="px-3 py-1 tabular-nums">{p.phone || '—'}</td>
                  <td className="px-3 py-1 uppercase text-slate-600">{p.receivesInvoices === 'none' ? '—' : p.receivesInvoices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Commercial terms">
          <KV label="Currency">{terms.currency}</KV>
          <KV label="Payment terms">{terms.paymentTermsDays != null ? `${terms.paymentTermsDays} days` : ''}</KV>
          <KV label="Credit limit">{terms.creditLimit ? `KES ${money(terms.creditLimit)}` : 'No limit'}</KV>
          <KV label="Preferred method">{terms.preferredPaymentMethod ? methodLabel(terms.preferredPaymentMethod) : ''}</KV>
          <KV label="Account manager">{userName(client.accountManager)}</KV>
          <KV label="Reminders">{client.dunningOptOut ? 'Opted out' : 'Automated'}</KV>
        </Section>
      </div>
      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3">
        <Section title="Tax behaviour">
          <KV label="VAT registered">{client.vatRegistered ? 'Yes' : 'No'}</KV>
          <KV label="VAT withholding agent">{tb.vatWithholdingAgent ? 'Yes — 2%' : 'No'}</KV>
          <KV label="Income tax WHT agent">{tb.incomeTaxWhtAgent ? `Yes — ${tb.incomeTaxWhtRate}%` : 'No'}</KV>
          <KV label="Tax exempt">{tb.taxExempt ? `${tb.exemptionCertificateNo || 'Yes'}${tb.exemptionExpiry ? ` · to ${fmtDate(tb.exemptionExpiry)}` : ''}` : 'No'}</KV>
          {summary?.openWhtCertificates?.count > 0 && <KV label="Open WHT certificates">{`${summary.openWhtCertificates.count} · KES ${money(summary.openWhtCertificates.incomeTax + summary.openWhtCertificates.vat)}`}</KV>}
        </Section>
        <Section title="Profile">
          <KV label="Type">{humanize(client.clientType)}</KV>
          <KV label="Trading name">{client.tradingName}</KV>
          <KV label="Registration no.">{client.companyRegistration}</KV>
          <KV label="Industry">{client.industry}</KV>
          <KV label="Address">{addr(client.address)}</KV>
          <KV label="Billing address">{client.billingAddress ? addr(client.billingAddress) : 'Same as physical'}</KV>
          <KV label="Tags">{(client.tags || []).join(', ')}</KV>
        </Section>
        <Section title="Recent activity" bodyClass="p-0">
          {activity === null && <EmptyNote>Loading…</EmptyNote>}
          {activity?.length === 0 && <EmptyNote>No activity yet</EmptyNote>}
          {(activity || []).map((a) => (
            <div key={a._id} className="border-b border-slate-100 px-3 py-1.5 text-xs last:border-b-0">
              <div className="flex justify-between gap-2">
                <span className="truncate font-semibold text-slate-900"><span className="mr-1.5 text-[9px] font-bold uppercase text-slate-500">{a.type}</span>{a.subject || a.body?.slice(0, 60) || '—'}</span>
                <span className="shrink-0 text-[10px] text-slate-500">{fmtDateTime(a.createdAt)}</span>
              </div>
            </div>
          ))}
        </Section>
      </div>
      {client.notes && <Section title="Notes"><p className="whitespace-pre-wrap text-xs text-slate-700">{client.notes}</p></Section>}
    </div>
  );
};

// ─── Collections (per client) ────────────────────────────────────────────────
const COLLECTION_TABS = [
  { key: 'disputes', label: 'Disputes' },
  { key: 'promises', label: 'Promises to pay' },
  { key: 'log', label: 'Reminder log' },
  { key: 'interest', label: 'Late interest' },
];
const ClientCollectionsTab = ({ clientId }) => {
  const [tab, setTab] = useState('disputes');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabStrip tabs={COLLECTION_TABS} active={tab} onChange={setTab} />
      {tab === 'disputes' && <DisputesPanel clientId={clientId} />}
      {tab === 'promises' && <PromisesPanel clientId={clientId} />}
      {tab === 'log' && <DunningLogPanel clientId={clientId} />}
      {tab === 'interest' && <LateInterestPanel clientId={clientId} />}
    </div>
  );
};

const DocumentsTab = ({ client, onEdit }) => (
  <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
    <Section title="Documents" bodyClass="p-0">
      {(client.documents || []).length === 0 && <EmptyNote>No documents linked. Use Edit to add contracts, KYC or certificates.</EmptyNote>}
      {(client.documents || []).map((d, i) => (
        <div key={i} className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-xs last:border-b-0">
          <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-[#0B3B2E] hover:underline">{d.name || d.url} <FaExternalLinkAlt size={9} /></a>
          <span className="text-[10px] text-slate-500">{fmtDate(d.uploadedAt)}</span>
        </div>
      ))}
      <div className="px-3 py-1.5"><button type="button" onClick={onEdit} className="text-xs font-bold text-[#0B3B2E] hover:underline">Manage documents →</button></div>
    </Section>
  </div>
);

// ─── Page ────────────────────────────────────────────────────────────────────
// Client + summary in one call; falls back to the plain record if the summary fails.
const fetchDetail = async (id) => {
  try {
    const d = unwrap(await clientsCollectionsApi.summary(id));
    detailCache.set(id, { client: d.client, summary: d.summary });
    return { client: d.client, summary: d.summary };
  } catch (err) {
    try {
      const res = await clientsApi.get(id);
      return { client: res.data?.client || unwrap(res), summary: null };
    } catch {
      return { client: null, summary: null, error: apiError(err, 'Failed to load client') };
    }
  }
};

const ClientDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit, canCreate } = useClientsAccess();
  const cached = detailCache.peek(id);
  const [client, setClient] = useState(cached?.client || null);
  const [summary, setSummary] = useState(cached?.summary || null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const [contracts, setContracts] = useState(null);
  const [modal, setModal] = useState(null);
  const [receiptsReload, setReceiptsReload] = useState(0);

  const apply = useCallback((d) => {
    setClient(d.client);
    setSummary(d.summary);
    setError(d.error || null);
  }, []);
  const load = useCallback(() => fetchDetail(id).then(apply), [id, apply]);
  useEffect(() => {
    let alive = true;
    fetchDetail(id).then((d) => { if (alive) apply(d); });
    return () => { alive = false; };
  }, [id, apply]);

  // getClient populates accountManager; the summary's client does not.
  useEffect(() => {
    if (!client || typeof client.accountManager !== 'string') return;
    let alive = true;
    clientsApi.get(id).then((res) => { if (alive) setClient((c) => ({ ...c, accountManager: res.data?.client?.accountManager || c.accountManager })); }).catch(() => {});
    return () => { alive = false; };
  }, [client, id]);

  // Contracts shared by the Contracts and Invoices tabs — loaded once, on demand.
  useEffect(() => {
    if (contracts !== null || (tab !== 'contracts' && tab !== 'invoices')) return;
    clientsApi.listContracts({ clientId: id, limit: 200 })
      .then(({ data }) => setContracts(data?.contracts || data?.data || []))
      .catch(() => setContracts([]));
  }, [tab, id, contracts]);

  const refresh = useCallback(() => { load(); setReceiptsReload((k) => k + 1); }, [load]);

  if (error) {
    return (
      <ClientsShell>
        <div className="py-20 text-center">
          <p className="text-sm font-semibold text-red-600">{error}</p>
          <button type="button" onClick={load} className="mt-3 text-xs font-bold text-[#0B3B2E] underline">Retry</button>
        </div>
      </ClientsShell>
    );
  }
  if (!client) return <ClientsShell><div className="py-16 text-center text-sm text-slate-400">Loading client…</div></ClientsShell>;

  const s = summary || {};
  const level = s.creditStatus?.level || 'ok';
  const usedPct = s.creditUsedPercent;
  const goEdit = () => navigate(`/clients/${id}/edit`, { state: { tabTitle: `Edit ${client.name}` } });
  const primaryEmail = client.email || (client.contactPersons || []).find((p) => p.receivesInvoices === 'to')?.email || '';

  const toggleHold = async (reason) => {
    try {
      const res = await clientsCollectionsApi.setCreditHold(id, { hold: !client.creditHold, reason });
      toast.success(res.data?.message || 'Saved');
      setModal(null);
      load();
    } catch (err) {
      toast.error(apiError(err, 'Failed to update credit hold'));
    }
  };

  return (
    <ClientsShell>
      {/* Header strip — identity + quick actions (toolbar-styled, no banner). */}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-3 py-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="truncate text-sm font-black text-slate-900">{client.name}</h1>
            {client.tradingName && <span className="text-xs text-slate-500">t/a {client.tradingName}</span>}
            <StatusPill status={client.status} />
            <StatusPill status={CREDIT_TONE[level]} label={CREDIT_LABEL[level]} />
            {client.creditHold && <StatusPill status="block" label="On credit hold" />}
          </div>
          <p className="text-[11px] text-slate-500">
            <span className="font-bold text-slate-700">{client.clientCode || '—'}</span>
            {client.taxPin && <span className="ml-2 font-mono">PIN {client.taxPin}</span>}
            {client.phone && <span className="ml-2">{client.phone}</span>}
            {client.email && <span className="ml-2">{client.email}</span>}
            {level !== 'ok' && s.creditStatus?.reasons?.length > 0 && <span className="ml-2 text-amber-700">· {s.creditStatus.reasons.join('; ')}</span>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {canCreate && <ListToolbar.Button icon={FaReceipt} onClick={() => navigate(`/clients/receipts/new?clientId=${id}`)}>Record Receipt</ListToolbar.Button>}
          <ListToolbar.Button variant="outline" icon={FaPrint} onClick={() => setTab('statement')}>Statement</ListToolbar.Button>
          <ListToolbar.Button variant="outline" icon={FaSms} onClick={() => setModal('sms')}>SMS</ListToolbar.Button>
          <ListToolbar.Button variant="outline" icon={FaEnvelope} disabled={!primaryEmail} onClick={() => { window.location.href = `mailto:${primaryEmail}`; }}>Email</ListToolbar.Button>
          {canEdit && <ListToolbar.Button variant="outline" icon={FaEdit} onClick={goEdit}>Edit</ListToolbar.Button>}
          {canEdit && (
            client.creditHold
              ? <ListToolbar.Button variant="outlineOk" icon={FaLockOpen} onClick={() => setModal('release')}>Release hold</ListToolbar.Button>
              : <ListToolbar.Button variant="outline" icon={FaLock} onClick={() => setModal('hold')}>Credit hold</ListToolbar.Button>
          )}
          <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={refresh} title="Refresh" />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid flex-none grid-cols-2 gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-1.5 sm:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Balance" value={`KES ${money(s.balance)}`} sub={`${s.openInvoices || 0} open invoice(s)`} />
        <Kpi label="Overdue" value={`KES ${money(s.overdue)}`} tone={s.overdue > 0 ? 'text-red-600' : 'text-slate-900'} sub={s.oldestDueDate ? `Oldest due ${fmtDate(s.oldestDueDate)}` : 'Nothing overdue'} />
        <Kpi label="MRR / ARR" value={`KES ${money(s.mrr)}`} sub={`ARR ${money(s.arr)} · ${s.activeContracts || 0} contract(s)`} />
        <Kpi
          label="Unapplied credit"
          value={`KES ${money(s.unappliedCredit)}`}
          sub={s.unappliedCredit > 0 && s.openInvoices > 0 ? 'Click to apply' : `Net ${money(s.netBalance)}`}
          onClick={s.unappliedCredit > 0 && s.openInvoices > 0 && canEdit ? () => setModal('apply') : undefined}
        />
        <Kpi label="Credit used" value={usedPct != null ? `${usedPct}%` : 'No limit'} sub={s.creditLimit ? `of KES ${money(s.creditLimit)}` : ''}>
          {usedPct != null && (
            <div className="mt-1 h-1.5 w-full bg-slate-200">
              <div className={`h-1.5 ${usedPct >= 100 ? 'bg-red-600' : usedPct >= 90 ? 'bg-amber-500' : 'bg-[#0B3B2E]'}`} style={{ width: `${Math.min(100, usedPct)}%` }} />
            </div>
          )}
        </Kpi>
        <Kpi label="Open WHT certs" value={s.openWhtCertificates?.count || 0} sub={s.openWhtCertificates?.count ? `KES ${money((s.openWhtCertificates.incomeTax || 0) + (s.openWhtCertificates.vat || 0))}` : 'All received'} onClick={() => setTab('wht')} />
        <Kpi label="Last payment" value={s.lastPayment ? `KES ${money(s.lastPayment.amount)}` : '—'} sub={s.lastPayment ? `${fmtDate(s.lastPayment.date)} · ${methodLabel(s.lastPayment.method)}` : 'No payments yet'} />
      </div>

      <TabStrip tabs={TABS} active={tab} onChange={setTab} />

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'overview' && <OverviewTab client={client} summary={summary} />}
        {tab === 'contracts' && <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><ClientContractsPanel clientId={id} embedded /></div>}
        {tab === 'invoices' && <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><ClientInvoicesPanel clientId={id} /></div>}
        {tab === 'receipts' && (
          <>
            <ListToolbar>
              <Chip>Unapplied: KES {money(s.unappliedCredit)}</Chip>
              <ListToolbar.Divider />
              {canEdit && s.unappliedCredit > 0 && s.openInvoices > 0 && <ListToolbar.Button variant="outline" onClick={() => setModal('apply')}>Apply credit</ListToolbar.Button>}
              {canCreate && <ListToolbar.Button icon={FaReceipt} onClick={() => navigate(`/clients/receipts/new?clientId=${id}`)}>Record Receipt</ListToolbar.Button>}
            </ListToolbar>
            <ClientReceiptsTable params={{ clientId: id, includeReversed: 'true' }} showClient={false} reloadKey={receiptsReload} onChanged={load} />
          </>
        )}
        {tab === 'statement' && <StatementTab client={client} activeContracts={s.activeContracts} />}
        {tab === 'collections' && <ClientCollectionsTab clientId={id} />}
        {tab === 'wht' && <WhtCertificatesTable status="all" clientId={id} showClient={false} />}
        {tab === 'documents' && <DocumentsTab client={client} onEdit={goEdit} />}
        {tab === 'timeline' && <div className="min-h-0 flex-1 overflow-auto p-3"><ClientTimelineTab clientId={id} clientPhone={client.phone} /></div>}
      </div>

      {modal === 'sms' && <SendSmsModal clientId={id} defaultPhone={client.phone || ''} onClose={() => setModal(null)} onSent={() => setModal(null)} />}
      {modal === 'apply' && <ApplyCreditModal clientId={id} available={s.unappliedCredit} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'hold' && (
        <ReasonModal title={`Put ${client.name} on credit hold`} message="New billing is blocked until the hold is released." confirmLabel="Put on hold" onClose={() => setModal(null)} onConfirm={toggleHold} />
      )}
      {modal === 'release' && (
        <ReasonModal title={`Release credit hold — ${client.name}`} message={client.creditHoldReason ? `Held for: ${client.creditHoldReason}` : ''} confirmLabel="Release hold" danger={false} required={false} onClose={() => setModal(null)} onConfirm={toggleHold} />
      )}
    </ClientsShell>
  );
};

export default ClientDetail;
