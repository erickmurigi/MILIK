import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPlus, FaSearch, FaTimes, FaEye, FaEdit, FaPrint, FaFileExcel } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import AppSelect from '../../components/common/AppSelect';
import ListToolbar from '../../components/common/ListToolbar';
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import { Chip, SentTags, StatusPill } from '../../components/Clients/clientUi';
import {
  CLIENT_STATUS_OPTIONS, CLIENT_TYPE_OPTIONS, createListCache, money, useClientsAccess, useCompanyUsers,
  cell, cellLast, numCell, iconBtn, printReport, exportExcel, humanize,
} from '../../components/Clients/clientHelpers';

const PAGE_SIZE = 50;
const listCache = createListCache();
const metricsCache = createListCache();

const CREDIT_HOLD_OPTIONS = [
  { value: 'true', label: 'On credit hold' },
  { value: 'false', label: 'Not on hold' },
];

// Balances + MRR come from two company-wide batch reports (AR aging by client
// and the active-contract register) rather than one summary call per row.
const loadMetrics = async (businessId, force = false) => {
  const cached = !force && metricsCache.get(businessId);
  if (cached) return cached;
  const [aging, register] = await Promise.all([
    clientsCollectionsApi.report('ar-aging', { groupBy: 'client', limit: 200 }).then(unwrap).catch(() => null),
    clientsCollectionsApi.report('contract-register', { status: 'active', limit: 200 }).then(unwrap).catch(() => null),
  ]);
  const balance = new Map();
  for (const r of aging?.rows || []) {
    balance.set(String(r.clientId), { total: r.total, overdue: Math.max(0, (r.total || 0) - (r.current || 0)), net: r.net });
  }
  const mrr = new Map();
  for (const c of register?.rows || []) {
    const id = String(c.client?._id || c.client || '');
    mrr.set(id, (mrr.get(id) || 0) + Number(c.mrr || 0));
  }
  const totals = aging?.totals || {};
  const data = { balance, mrr, overdueTotal: Math.max(0, (totals.total || 0) - (totals.current || 0)) };
  metricsCache.set(businessId, data);
  return data;
};

const ClientsList = () => {
  const navigate = useNavigate();
  const { businessId, canCreate, canEdit } = useClientsAccess();
  const { options: managerOptions } = useCompanyUsers(businessId);
  const debounceRef = useRef(null);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [clientType, setClientType] = useState('');
  const [tag, setTag] = useState('');
  const [manager, setManager] = useState('');
  const [creditHold, setCreditHold] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const params = useMemo(() => {
    const p = { page, limit };
    if (query) p.search = query;
    if (status) p.status = status;
    if (clientType) p.clientType = clientType;
    if (tag) p.tag = tag;
    if (manager) p.accountManager = manager;
    if (creditHold) p.creditHold = creditHold;
    return p;
  }, [page, limit, query, status, clientType, tag, manager, creditHold]);
  const cacheKey = `${businessId}:${JSON.stringify(params)}`;

  const [data, setData] = useState(() => listCache.peek(cacheKey) || { clients: [], pagination: { total: 0, pages: 1 } });
  const [metrics, setMetrics] = useState(() => metricsCache.peek(businessId));
  const [activeCount, setActiveCount] = useState(null);
  const [isFetching, setIsFetching] = useState(false);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!businessId) return;
    const cached = !force && listCache.get(cacheKey);
    if (cached) { setData(cached); return; }
    setIsFetching(true);
    try {
      const res = await clientsApi.list(params);
      const next = { clients: res.data?.clients || [], pagination: res.data?.pagination || { total: 0, pages: 1 } };
      listCache.set(cacheKey, next);
      setData(next);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load clients'));
    } finally {
      setIsFetching(false);
    }
  }, [businessId, cacheKey, params]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    loadMetrics(businessId).then((m) => { if (alive) setMetrics(m); });
    clientsApi.list({ status: 'active', limit: 1 })
      .then((res) => { if (alive) setActiveCount(res.data?.pagination?.total ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [businessId]);

  const onSearch = (value) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setPage(1); setQuery(value.trim()); }, 350);
  };
  const setFilter = (setter) => (v) => { setter(v ?? ''); setPage(1); };
  const reset = () => {
    setSearch(''); setQuery(''); setStatus(''); setClientType(''); setTag(''); setManager(''); setCreditHold(''); setPage(1);
  };

  const rows = data.clients;
  const total = data.pagination?.total || 0;
  const pages = data.pagination?.pages || Math.max(Math.ceil(total / limit), 1);
  const isFiltered = Boolean(query || status || clientType || tag || manager || creditHold);

  const openClient = useCallback((c) => navigate(`/clients/${c._id}`, { state: { tabTitle: c.name } }), [navigate]);
  const primaryContact = (c) => (c.contactPersons || []).find((p) => p.isPrimary) || (c.contactPersons || [])[0] || null;

  const exportColumns = useMemo(() => [
    { label: 'Code', value: (c) => c.clientCode || '' },
    { label: 'Client', value: (c) => c.name },
    { label: 'Trading name', value: (c) => c.tradingName || '' },
    { label: 'Type', value: (c) => humanize(c.clientType) },
    { label: 'KRA PIN', value: (c) => c.taxPin || '' },
    { label: 'Email', value: (c) => c.email || '' },
    { label: 'Phone', value: (c) => c.phone || '' },
    { label: 'MRR', align: 'right', value: (c) => money(metrics?.mrr.get(String(c._id)) || 0), raw: (c) => metrics?.mrr.get(String(c._id)) || 0 },
    { label: 'Balance', align: 'right', value: (c) => money(metrics?.balance.get(String(c._id))?.total || 0), raw: (c) => metrics?.balance.get(String(c._id))?.total || 0 },
    { label: 'Status', value: (c) => humanize(c.status) },
  ], [metrics]);

  return (
    <ClientsShell>
      <ListToolbar>
        <Chip>Clients: {total.toLocaleString()}</Chip>
        {activeCount != null && <Chip>Active: {activeCount.toLocaleString()}</Chip>}
        {metrics && <Chip title="Past-due receivables across all clients">Overdue: KES {money(metrics.overdueTotal)}</Chip>}
        <ListToolbar.Divider />
        <div className="relative shrink-0">
          <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
          <ListToolbar.Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Name, code, PIN, trading name, phone…" width="w-60" className="pl-5 pr-5" />
          {search && (
            <button type="button" onClick={() => onSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><FaTimes size={8} /></button>
          )}
        </div>
        <AppSelect compact clearable placeholder="All statuses" value={status} onChange={setFilter(setStatus)} options={CLIENT_STATUS_OPTIONS} />
        <AppSelect compact clearable placeholder="All types" value={clientType} onChange={setFilter(setClientType)} options={CLIENT_TYPE_OPTIONS} />
        <ListToolbar.Input value={tag} onChange={(e) => { setTag(e.target.value.trim().toLowerCase()); setPage(1); }} placeholder="Tag" width="w-20" />
        <AppSelect compact clearable searchable placeholder="Any manager" value={manager} onChange={setFilter(setManager)} options={managerOptions} />
        <AppSelect compact clearable placeholder="Credit hold" value={creditHold} onChange={setFilter(setCreditHold)} options={CREDIT_HOLD_OPTIONS} />
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" onClick={reset} disabled={!isFiltered}>Reset</ListToolbar.Button>
        <ListToolbar.Divider />
        <ListToolbar.Button
          variant="outline"
          icon={FaPrint}
          onClick={() => printReport({ title: 'Clients', subtitle: `${total} client(s)`, columns: exportColumns, rows })}
        >Print</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaFileExcel} onClick={() => exportExcel(exportColumns, rows, 'clients')}>Export</ListToolbar.Button>
        <ListToolbar.Divider />
        {canCreate && <ListToolbar.Button icon={FaPlus} onClick={() => navigate('/clients/new')}>New Client</ListToolbar.Button>}
      </ListToolbar>

      <MilikTable
        tableFixed
        columns={[
          { label: 'Code', width: '11%' },
          { label: 'Client', width: '25%' },
          { label: 'PIN', width: '11%' },
          { label: 'Contact', width: '19%' },
          { label: 'MRR', align: 'right', width: '10%' },
          { label: 'Balance', align: 'right', width: '11%' },
          { label: 'Status', width: '8%' },
        ]}
        actionsWidth="5%"
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty={isFiltered ? 'No clients match these filters' : 'No clients yet'}
        onRowClick={openClient}
        renderRow={(c) => {
          const contact = primaryContact(c);
          const bal = metrics?.balance.get(String(c._id));
          const mrr = metrics?.mrr.get(String(c._id)) || 0;
          return (
            <>
              <td className={`${cell} truncate font-bold text-slate-900`}>
                {c.clientCode || '—'}<SentTags smsAt={c.lastSmsAt} emailAt={c.lastEmailAt} />
              </td>
              <td className={`${cell} truncate`}>
                <span className="font-semibold text-slate-900">{c.name}</span>
                {c.tradingName && <span className="ml-1.5 font-normal text-slate-500">· {c.tradingName}</span>}
                {c.creditHold && <span className="ml-1.5 border border-red-200 bg-red-50 px-1 text-[9px] font-bold uppercase text-red-700" title={c.creditHoldReason}>Hold</span>}
              </td>
              <td className={`${cell} truncate font-mono text-[10px] uppercase text-slate-700`}>{c.taxPin || '—'}</td>
              <td className={`${cell} truncate text-slate-700`}>
                {contact?.name || c.email || '—'}
                {(contact?.phone || c.phone) && <span className="ml-1.5 text-slate-500">· {contact?.phone || c.phone}</span>}
              </td>
              <td className={numCell}>{mrr ? money(mrr) : '—'}</td>
              <td className={`${numCell} font-bold ${bal?.overdue > 0 ? 'text-red-600' : 'text-slate-900'}`} title={bal?.overdue > 0 ? `Overdue ${money(bal.overdue)}` : undefined}>
                {bal ? money(bal.total) : '0.00'}
              </td>
              <td className={cellLast}><StatusPill status={c.status} /></td>
            </>
          );
        }}
        renderActions={(c) => (
          <div className="flex justify-end gap-0.5">
            <button type="button" title="Open" className={iconBtn} onClick={() => openClient(c)}><FaEye size={12} /></button>
            {canEdit && <button type="button" title="Edit" className={iconBtn} onClick={() => navigate(`/clients/${c._id}/edit`, { state: { tabTitle: `Edit ${c.name}` } })}><FaEdit size={12} /></button>}
          </div>
        )}
      />

      <PaginationBar
        page={page}
        pages={pages}
        total={total}
        pageSize={limit}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
        loading={isFetching}
        label="clients"
      />
    </ClientsShell>
  );
};

export default ClientsList;
