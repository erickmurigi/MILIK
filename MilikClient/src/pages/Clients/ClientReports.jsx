// Contract Management reports — one house-standard list page per report,
// driven by the REPORTS config below (/clients/reports/:report).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPrint, FaFileExcel, FaSyncAlt, FaSearch } from 'react-icons/fa';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import MilikTable from '../../components/common/MilikTable';
import PaginationBar from '../../components/PaginationBar';
import AppSelect from '../../components/common/AppSelect';
import { Chip, StatusPill } from '../../components/Clients/clientUi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDate, todayISO } from '../../utils/dates';
import { money, humanize, createListCache, useClientsAccess, printReport, exportExcel, cell, numCell } from '../../components/Clients/clientHelpers';

const cache = createListCache();
const monthStart = () => `${todayISO().slice(0, 8)}01`;
const yearStart = () => `${todayISO().slice(0, 4)}-01-01`;
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const num = (key, label, opts = {}) => ({ label, align: 'right', value: (r) => money(r[key]), raw: (r) => r[key], key, ...opts });
const clientCol = { label: 'Client', value: (r) => r.clientName || r.client?.name || '', sub: (r) => r.clientCode || r.client?.clientCode || '' };

const REPORTS = {
  'ar-aging': {
    title: 'AR Aging',
    defaults: () => ({ asOf: todayISO(), groupBy: 'client' }),
    filters: ['asOf', 'groupBy'],
    groupOptions: [{ value: 'client', label: 'By client' }, { value: 'owner', label: 'By account manager' }],
    columns: (f) => [
      f.groupBy === 'owner'
        ? { label: 'Account manager', value: (r) => r.ownerName, sub: (r) => `${r.clientCount} client(s)`, width: '20%' }
        : { ...clientCol, width: '20%' },
      num('current', 'Current'), num('d1_30', '1–30'), num('d31_60', '31–60'), num('d61_90', '61–90'), num('d90_plus', '90+'),
      num('total', 'Total', { bold: true }), num('unapplied', 'Credit'), num('net', 'Net', { bold: true }),
    ],
    totalsRow: (d, cols) => cols.map((c, i) => (i === 0 ? 'Total' : money(d?.totals?.[c.key] || 0))),
    chips: (d) => d?.totals ? [`Receivables: KES ${money(d.totals.total)}`, `Overdue: KES ${money((d.totals.total || 0) - (d.totals.current || 0))}`, `90+: KES ${money(d.totals.d90_plus)}`, `Invoices: ${d.totals.invoiceCount}`] : [],
    subtitle: (f) => `As at ${fmtDate(f.asOf)}`,
    drill: (r, f) => (f.groupBy === 'client' ? r.clientId : null),
  },
  revenue: {
    title: 'Revenue',
    defaults: () => ({ from: yearStart(), to: todayISO(), groupBy: 'client' }),
    filters: ['from', 'to', 'groupBy'],
    groupOptions: [{ value: 'client', label: 'By client' }, { value: 'service', label: 'By service' }, { value: 'owner', label: 'By account manager' }],
    columns: (f) => [
      f.groupBy === 'service' ? { label: 'Service', value: (r) => r.service, width: '34%' }
        : f.groupBy === 'owner' ? { label: 'Account manager', value: (r) => r.ownerName, sub: (r) => `${r.clients} client(s)`, width: '34%' }
          : { ...clientCol, width: '34%' },
      ...(f.groupBy === 'client' ? [{ label: 'Manager', value: (r) => r.ownerName || '' }] : []),
      { label: 'Invoices', align: 'right', value: (r) => String(r.invoices || 0), raw: (r) => r.invoices },
      num('invoiced', 'Invoiced (net)'), num('adjustments', 'Notes adj.'), num('revenue', 'Revenue', { bold: true }),
    ],
    chips: (d) => [`Revenue: KES ${money(d?.total)}`],
    footnote: (d) => d?.basis,
    subtitle: (f) => `${fmtDate(f.from)} – ${fmtDate(f.to)}`,
    drill: (r, f) => (f.groupBy === 'client' ? r.clientId : null),
  },
  'billing-forecast': {
    title: 'Billing Forecast',
    defaults: () => ({ months: '12' }),
    filters: ['months'],
    rowsOf: (d) => d?.months || [],
    rowKey: 'month',
    columns: () => [
      { label: 'Month', value: (r) => monthLabel(r.month), width: '40%' },
      { label: 'Contracts billing', align: 'right', value: (r) => String(r.contracts), raw: (r) => r.contracts },
      num('amount', 'Expected billing (net of VAT)', { bold: true }),
    ],
    chips: (d) => [`Next ${d?.months?.length || 0} months: KES ${money(d?.total)}`],
    chart: true,
    subtitle: () => 'From active contract schedules, net of VAT; already-billed periods excluded',
  },
  'contract-register': {
    title: 'Contract Register',
    defaults: () => ({ status: '', search: '' }),
    filters: ['status', 'search'],
    statusOptions: ['draft', 'active', 'pending_renewal', 'suspended', 'expired', 'terminated', 'renewed'].map((s) => ({ value: s, label: humanize(s) })),
    columns: () => [
      { label: 'Contract', value: (r) => r.contractNumber, sub: (r) => r.description || '', width: '18%' },
      { label: 'Client', value: (r) => r.client?.name || '', width: '18%' },
      { label: 'Start', value: (r) => fmtDate(r.startDate) },
      { label: 'End', value: (r) => (r.openEnded ? 'Open-ended' : fmtDate(r.endDate)) },
      { label: 'Billing', value: (r) => humanize(r.billingCycle) },
      num('mrr', 'MRR', { bold: true }), num('tcv', 'TCV'),
      { label: 'Status', value: (r) => humanize(r.status), pill: (r) => r.status },
    ],
    chips: (d) => (d?.byStatus || []).filter((s) => s.count).map((s) => `${humanize(s.status)}: ${s.count}`),
    drill: (r) => r.client?._id,
  },
  renewals: {
    title: 'Renewals & Expiries',
    defaults: () => ({ days: '90', pastDays: '30' }),
    filters: ['days'],
    dayOptions: [{ value: '30', label: 'Next 30 days' }, { value: '60', label: 'Next 60 days' }, { value: '90', label: 'Next 90 days' }, { value: '180', label: 'Next 180 days' }],
    columns: () => [
      { label: 'Contract', value: (r) => r.contractNumber, sub: (r) => r.description || '', width: '18%' },
      { label: 'Client', value: (r) => r.client?.name || '', width: '20%' },
      { label: 'Ends', value: (r) => fmtDate(r.endDate) },
      { label: 'Days', align: 'right', value: (r) => (r.expired ? `${-r.daysToEnd}d ago` : `${r.daysToEnd}d`), tone: (r) => (r.expired || r.daysToEnd <= 30 ? 'text-red-600 font-bold' : r.daysToEnd <= 60 ? 'text-amber-700 font-semibold' : '') },
      { label: 'Notice by', value: (r) => fmtDate(r.noticeDeadline), tone: (r) => (r.noticePassed ? 'text-red-600' : '') },
      { label: 'Auto-renew', value: (r) => (r.autoRenew ? 'Yes' : 'No') },
      { label: 'Stage', value: (r) => humanize(r.renewalStage || '—') },
      num('mrr', 'MRR', { bold: true }),
    ],
    chips: (d) => d?.summary ? [`≤30d: ${d.summary.d30}`, `≤60d: ${d.summary.d60}`, `≤90d: ${d.summary.d90}`, `Expired, not renewed: ${d.summary.expiredNotRenewed}`, `MRR at risk: KES ${money(d.summary.mrrAtRisk)}`] : [],
    drill: (r) => r.client?._id,
  },
  'sales-vat': {
    title: 'Sales VAT',
    defaults: () => ({ from: monthStart(), to: todayISO() }),
    filters: ['from', 'to'],
    rowKey: 'documentId',
    columns: () => [
      { label: 'Date', value: (r) => fmtDate(r.date) },
      { label: 'Document', value: (r) => r.documentNumber, sub: (r) => (r.documentType === 'invoice' ? (r.etimsCuInvoiceNumber ? `CU ${r.etimsCuInvoiceNumber}` : '') : `${humanize(r.documentType)}${r.relatedInvoice ? ` · ${r.relatedInvoice}` : ''}`), width: '15%' },
      { label: 'Client', value: (r) => r.clientName, width: '20%' },
      { label: 'Client PIN', value: (r) => r.clientPin || 'MISSING', tone: (r) => (r.clientPin ? 'font-mono' : 'font-bold text-red-600') },
      num('standardRated', 'Standard rated'), num('zeroOrExempt', 'Zero / exempt'), num('vat', 'VAT', { bold: true }), num('total', 'Total'),
    ],
    totalsRow: (d, cols) => cols.map((c, i) => (i === 0 ? 'Total' : c.key && d?.totals?.[c.key] != null ? money(d.totals[c.key]) : '')),
    chips: (d) => d?.totals ? [`Output VAT: KES ${money(d.totals.vat)}`, `Standard rated: KES ${money(d.totals.standardRated)}`, ...(d.totals.missingPin ? [`Missing PIN: ${d.totals.missingPin}`] : [])] : [],
    subtitle: (f) => `${fmtDate(f.from)} – ${fmtDate(f.to)}`,
    limit: 100,
  },
  'wht-by-client': {
    title: 'WHT Certificates by Client',
    endpoint: 'wht-certificates',
    defaults: () => ({ status: 'expected' }),
    filters: ['whtStatus'],
    rowsOf: (d) => d?.byClient || [],
    rowKey: 'clientId',
    columns: () => [
      { ...clientCol, width: '30%' },
      { label: 'Certificates', align: 'right', value: (r) => String(r.count), raw: (r) => r.count },
      { label: 'Oldest', value: (r) => fmtDate(r.oldest) },
      num('incomeTax', 'Income tax'), num('vat', 'VAT'), num('total', 'Total', { bold: true }),
    ],
    chips: (d) => d?.totals ? [`Income tax: KES ${money(d.totals.incomeTax)}`, `VAT: KES ${money(d.totals.vat)}`, `Certificates: ${d.totals.count}`] : [],
    drill: (r) => r.clientId,
    clientPaged: true,
  },
};

const ClientReportPage = ({ reportKey }) => {
  const navigate = useNavigate();
  const { businessId } = useClientsAccess();
  const cfg = REPORTS[reportKey] || REPORTS['ar-aging'];
  const [filters, setFilters] = useState(cfg.defaults);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(cfg.limit || 50);
  const [isFetching, setIsFetching] = useState(false);

  const params = useMemo(() => {
    const p = { ...filters };
    Object.keys(p).forEach((k) => { if (p[k] === '' || p[k] == null) delete p[k]; });
    return cfg.clientPaged ? p : { ...p, page, limit };
  }, [filters, page, limit, cfg.clientPaged]);
  const endpoint = cfg.endpoint || reportKey;
  const key = `${businessId}:${endpoint}:${JSON.stringify(params)}`;
  const [data, setData] = useState(() => cache.peek(key));

  const load = useCallback(async (force = false) => {
    if (!businessId) return;
    const hit = !force && cache.get(key);
    if (hit) { setData(hit); return; }
    setIsFetching(true);
    try {
      const d = unwrap(await clientsCollectionsApi.report(endpoint, params));
      cache.set(key, d);
      setData(d);
    } catch (err) {
      toast.error(apiError(err, `Failed to load ${cfg.title}`));
    } finally {
      setIsFetching(false);
    }
  }, [businessId, key, endpoint, params, cfg.title]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const columns = useMemo(() => cfg.columns(filters), [cfg, filters]);
  const rows = useMemo(() => (cfg.rowsOf ? cfg.rowsOf(data) : data?.rows || []), [cfg, data]);
  const chips = cfg.chips ? cfg.chips(data) : [];
  const subtitle = cfg.subtitle ? cfg.subtitle(filters) : '';
  const pagination = data?.pagination;

  const fetchAll = async () => {
    if (cfg.clientPaged || !pagination || pagination.total <= rows.length) return { data, rows };
    const d = unwrap(await clientsCollectionsApi.report(endpoint, { ...params, page: 1, limit: 200 }));
    return { data: d, rows: cfg.rowsOf ? cfg.rowsOf(d) : d?.rows || [] };
  };
  const doPrint = async () => {
    const all = await fetchAll().catch(() => ({ data, rows }));
    printReport({
      title: cfg.title,
      subtitle,
      columns: columns.map((c) => ({ ...c, value: (r) => `${c.value(r)}${c.sub && c.sub(r) ? ` · ${c.sub(r)}` : ''}` })),
      rows: all.rows,
      summaryItems: chips.slice(0, 5).map((ch) => { const [a, ...b] = ch.split(': '); return [a, b.join(': ')]; }),
      totalsRow: cfg.totalsRow ? cfg.totalsRow(all.data, columns) : null,
    });
  };
  const doExport = async () => {
    const all = await fetchAll().catch(() => ({ data, rows }));
    exportExcel(columns, all.rows, `client-${reportKey}`);
  };

  const drill = cfg.drill ? (r) => { const id = cfg.drill(r, filters); if (id) navigate(`/clients/${id}`, { state: { tabTitle: r.clientName || r.client?.name } }); } : undefined;
  const chartRows = useMemo(() => (cfg.chart ? rows.map((r) => ({ name: monthLabel(r.month), amount: r.amount })) : []), [cfg.chart, rows]);

  return (
    <ClientsShell>
      <ListToolbar>
        {chips.map((c) => <Chip key={c}>{c}</Chip>)}
        {chips.length > 0 && <ListToolbar.Divider />}
        {cfg.filters.includes('asOf') && <ListToolbar.Input type="date" value={filters.asOf} onChange={(e) => setFilter('asOf', e.target.value)} width="w-28" title="As at" />}
        {cfg.filters.includes('from') && <ListToolbar.Input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} width="w-28" title="From" />}
        {cfg.filters.includes('to') && <ListToolbar.Input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} width="w-28" title="To" />}
        {cfg.filters.includes('groupBy') && <AppSelect compact value={filters.groupBy} onChange={(v) => setFilter('groupBy', v || 'client')} options={cfg.groupOptions} />}
        {cfg.filters.includes('months') && <AppSelect compact value={filters.months} onChange={(v) => setFilter('months', v || '12')} options={['3', '6', '12', '18', '24'].map((m) => ({ value: m, label: `${m} months` }))} />}
        {cfg.filters.includes('days') && <AppSelect compact value={filters.days} onChange={(v) => setFilter('days', v || '90')} options={cfg.dayOptions} />}
        {cfg.filters.includes('status') && <AppSelect compact clearable placeholder="All statuses" value={filters.status} onChange={(v) => setFilter('status', v || '')} options={cfg.statusOptions} />}
        {cfg.filters.includes('whtStatus') && <AppSelect compact value={filters.status} onChange={(v) => setFilter('status', v || 'expected')} options={[{ value: 'expected', label: 'Outstanding' }, { value: 'received', label: 'Received' }, { value: 'all', label: 'All' }]} />}
        {cfg.filters.includes('search') && (
          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
            <ListToolbar.Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setFilter('search', search.trim()); }} onBlur={() => setFilter('search', search.trim())} placeholder="Contract no / description" width="w-44" className="pl-5" />
          </div>
        )}
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" onClick={() => { setFilters(cfg.defaults()); setSearch(''); setPage(1); }}>Reset</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={() => load(true)}>Refresh</ListToolbar.Button>
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" icon={FaPrint} onClick={doPrint}>Print</ListToolbar.Button>
        <ListToolbar.Button variant="outline" icon={FaFileExcel} onClick={doExport}>Export</ListToolbar.Button>
      </ListToolbar>

      {cfg.chart && rows.length > 0 && (
        <div className="h-48 flex-none border-b border-slate-200 bg-white px-2 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}K` : v)} width={44} />
              <Tooltip formatter={(v) => [`KES ${money(v)}`, 'Billing']} cursor={{ fill: '#EBF5EF' }} />
              <Bar dataKey="amount" fill="#0B3B2E" maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <MilikTable
        tableFixed
        rowKey={cfg.rowKey || '_id'}
        columns={columns.map((c) => ({ label: c.label, align: c.align, width: c.width }))}
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty="No data for these filters"
        onRowClick={drill}
        renderRow={(r) => columns.map((c, i) => {
          const last = i === columns.length - 1;
          const base = c.align === 'right' ? numCell : cell;
          return (
            <td key={c.label} className={`${base} ${last ? 'border-r-0' : ''} ${c.bold ? 'font-bold text-slate-900' : ''} ${c.tone ? c.tone(r) : ''} ${i === 0 ? 'truncate font-semibold text-slate-900' : 'truncate'}`}>
              {c.pill ? <StatusPill status={c.pill(r)} /> : c.value(r)}
              {c.sub && c.sub(r) && <span className="ml-1.5 font-normal text-slate-500">· {c.sub(r)}</span>}
            </td>
          );
        })}
        renderFooter={cfg.totalsRow ? () => cfg.totalsRow(data, columns).map((v, i) => (
          <td key={i} className={`px-3 py-1.5 text-[11px] ${i === 0 ? 'text-left' : 'text-right tabular-nums'}`}>{v}</td>
        )) : undefined}
      />
      {cfg.footnote && data && <p className="flex-none border-t border-slate-200 bg-white px-3 py-1 text-[10px] text-slate-500">Basis: {cfg.footnote(data)}</p>}
      {!cfg.clientPaged && pagination && (
        <PaginationBar
          page={page}
          pages={pagination.pages || 1}
          total={pagination.total || 0}
          pageSize={limit}
          pageSizes={[25, 50, 100, 200]}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
          loading={isFetching}
          label="rows"
        />
      )}
    </ClientsShell>
  );
};

// Keyed by report so switching reports starts from that report's own defaults.
const ClientReports = () => {
  const { report } = useParams();
  const reportKey = REPORTS[report] ? report : 'ar-aging';
  return <ClientReportPage key={reportKey} reportKey={reportKey} />;
};

export default ClientReports;
