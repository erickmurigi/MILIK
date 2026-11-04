import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPlus, FaSearch, FaPrint, FaFileExcel, FaSyncAlt } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import ClientReceiptsTable from '../../components/Clients/ClientReceiptsTable';
import { Chip } from '../../components/Clients/clientUi';
import {
  RECEIPT_METHOD_OPTIONS, money, methodLabel, useClientLookup, useClientsAccess, printAfterFetch, exportExcel,
} from '../../components/Clients/clientHelpers';
import { clientsCollectionsApi, unwrap } from '../../services/clientsCollectionsApi';
import { fmtDate } from '../../utils/dates';

const VIEW_OPTIONS = [
  { value: 'unapplied', label: 'With unapplied credit' },
  { value: 'reversed', label: 'Reversed only' },
  { value: 'all', label: 'Include reversed' },
];

const exportColumns = [
  { label: 'Receipt', value: (r) => r.receiptNumber },
  { label: 'Client', value: (r) => r.client?.name || '' },
  { label: 'Date', value: (r) => fmtDate(r.receiptDate) },
  { label: 'Method', value: (r) => methodLabel(r.method) },
  { label: 'Reference', value: (r) => r.reference || r.chequeNumber || '' },
  { label: 'Cash', align: 'right', value: (r) => money(r.amount), raw: (r) => r.amount },
  { label: 'WHT', align: 'right', value: (r) => money((r.whtIncomeTax?.amount || 0) + (r.whtVat?.amount || 0)), raw: (r) => (r.whtIncomeTax?.amount || 0) + (r.whtVat?.amount || 0) },
  { label: 'Unapplied', align: 'right', value: (r) => money(r.unappliedAmount), raw: (r) => r.unappliedAmount },
  { label: 'Status', value: (r) => r.status },
];

const ClientReceipts = () => {
  const navigate = useNavigate();
  const { businessId, canCreate } = useClientsAccess();
  const { options: clientOptions } = useClientLookup(businessId);
  const debounceRef = useRef(null);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [clientId, setClientId] = useState('');
  const [method, setMethod] = useState('');
  const [view, setView] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [summary, setSummary] = useState({ totals: null, count: 0 });

  const params = useMemo(() => {
    const p = {};
    if (query) p.search = query;
    if (clientId) p.clientId = clientId;
    if (method) p.method = method;
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    if (view === 'unapplied') p.unappliedOnly = 'true';
    if (view === 'reversed') p.status = 'reversed';
    if (view === 'all') p.includeReversed = 'true';
    return p;
  }, [query, clientId, method, dateFrom, dateTo, view]);

  const onTotals = useCallback((totals, count) => setSummary({ totals, count }), []);
  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(v.trim()), 350);
  };
  const reset = () => { setSearch(''); setQuery(''); setClientId(''); setMethod(''); setView(''); setDateFrom(''); setDateTo(''); };
  const filtered = Object.keys(params).length > 0;
  const t = summary.totals;

  const fetchAll = () => clientsCollectionsApi.listReceipts({ ...params, limit: 200 }).then((res) => unwrap(res)?.receipts || []);

  return (
    <ClientsShell>
      <ListToolbar>
        <Chip>Receipts: {summary.count.toLocaleString()}</Chip>
        {t && <Chip>Cash: KES {money(t.amount)}</Chip>}
        {t && (t.whtIncomeTax + t.whtVat) > 0 && <Chip>WHT: KES {money(t.whtIncomeTax + t.whtVat)}</Chip>}
        {t && <Chip>Unapplied: KES {money(t.unapplied)}</Chip>}
        <ListToolbar.Divider />
        <div className="relative shrink-0">
          <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
          <ListToolbar.Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Receipt no, reference, invoice…" width="w-48" className="pl-5" />
        </div>
        <AppSelect compact clearable searchable placeholder="All clients" value={clientId} onChange={(v) => setClientId(v || '')} options={clientOptions} />
        <AppSelect compact clearable placeholder="All methods" value={method} onChange={(v) => setMethod(v || '')} options={RECEIPT_METHOD_OPTIONS} />
        <AppSelect compact clearable placeholder="Posted receipts" value={view} onChange={(v) => setView(v || '')} options={VIEW_OPTIONS} />
        <ListToolbar.Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} width="w-28" title="From" />
        <ListToolbar.Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} width="w-28" title="To" />
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" onClick={reset} disabled={!filtered}>Reset</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={() => setReloadKey((k) => k + 1)}>Refresh</ListToolbar.Button>
        <ListToolbar.Divider />
        <ListToolbar.Button
          variant="outline"
          icon={FaPrint}
          onClick={() => printAfterFetch(fetchAll, (rows) => ({
            title: 'Client Receipts',
            subtitle: [dateFrom && `From ${fmtDate(dateFrom)}`, dateTo && `To ${fmtDate(dateTo)}`].filter(Boolean).join(' · '),
            columns: exportColumns,
            rows,
            summaryItems: t ? [['Cash', `KES ${money(t.amount)}`], ['WHT', `KES ${money(t.whtIncomeTax + t.whtVat)}`], ['Unapplied', `KES ${money(t.unapplied)}`]] : [],
          }))}
        >Print</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaFileExcel} onClick={async () => exportExcel(exportColumns, await fetchAll(), 'client-receipts')}>Export</ListToolbar.Button>
        <ListToolbar.Divider />
        {canCreate && <ListToolbar.Button icon={FaPlus} onClick={() => navigate('/clients/receipts/new')}>Record Receipt</ListToolbar.Button>}
      </ListToolbar>
      <ClientReceiptsTable params={params} reloadKey={reloadKey} onTotals={onTotals} />
    </ClientsShell>
  );
};

export default ClientReceipts;
