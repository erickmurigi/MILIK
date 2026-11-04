// Billing run history (/clients/billing/runs) and one run's detail (/clients/billing/runs/:id).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaArrowLeft, FaEye, FaPlay } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import MilikTable from '../../components/common/MilikTable';
import Spinner from '../../components/common/Spinner';
import PaginationBar from '../../components/PaginationBar';
import { Chip, Metric, Section, StatusPill, EmptyNote, cell, cellLast, numCell, iconBtn } from '../../components/Clients/Billing/BillingUi';
import { PAGE_SIZES, fmtMonth, money, useBillingClients, useServerList, userName } from '../../components/Clients/Billing/billingShared';
import { billingApi, apiError } from '../../services/clientsBillingApi';
import { fmtDate, fmtDateTime } from '../../utils/dates';
import { selectCurrentCompany } from '../../redux/selectors';

const scopeLabel = (r) => (r.scope === 'all' ? 'All contracts' : r.scope === 'auto_bill' ? 'Auto-bill (scheduled)' : `One ${r.scope}`);

const RunDetail = ({ id }) => {
  const navigate = useNavigate();
  const company = useSelector(selectCurrentCompany);
  const { clients } = useBillingClients(company?._id || '');
  const clientMap = useMemo(() => new Map(clients.map((c) => [String(c._id), c.name])), [clients]);
  const [run, setRun] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    billingApi.getRun(id)
      .then((res) => { if (alive) setRun(res.data?.run || res.data?.data); })
      .catch((err) => { if (alive) setError(apiError(err, 'Could not load the billing run')); });
    return () => { alive = false; };
  }, [id]);

  if (!run) {
    return <div className="flex flex-1 items-center justify-center gap-2 text-slate-400">{error ? <span className="text-xs font-semibold text-red-600">{error}</span> : <><Spinner size="sm" /><span className="text-xs font-semibold">Loading run…</span></>}</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListToolbar>
        <ListToolbar.Button variant="outline" icon={FaArrowLeft} onClick={() => navigate('/clients/billing/runs')}>Run history</ListToolbar.Button>
        <ListToolbar.Divider />
        <Chip>{run.triggeredBy === 'cron' ? 'Scheduled run' : `Run by ${userName(run.runBy) || 'user'}`}</Chip>
        <Chip>{fmtDateTime(run.createdAt)}</Chip>
      </ListToolbar>
      <div className="flex-none border-b border-slate-200 bg-white px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-base font-black text-slate-900">Billing run · {fmtMonth(run.period)}</span>
          <StatusPill status={run.status} />
          {run.postAsDraft && <StatusPill status="draft" label="Drafts" />}
        </div>
        <div className="flex flex-wrap gap-y-1">
          <Metric label="Invoices" value={run.invoiceCount} />
          <Metric label="Periods billed" value={run.rowCount} />
          <Metric label="Net" value={`KES ${money(run.subtotal)}`} />
          <Metric label="Tax" value={`KES ${money(run.taxAmount)}`} />
          <Metric label="Total" value={`KES ${money(run.total)}`} />
          <Metric label="Scope" value={scopeLabel(run)} sub={`Grouped by ${run.groupBy} · billed to ${fmtDate(run.asOfDate)} · issued ${fmtDate(run.issueDate)}`} />
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {(run.failures || []).length > 0 && (
          <Section title={`Not invoiced (${run.failures.length})`} bodyClass="p-0">
            <table className="w-full text-[11px]">
              <tbody className="divide-y divide-slate-100">
                {run.failures.map((f, i) => (
                  <tr key={`${f.client}-${i}`}>
                    <td className="w-1/4 px-3 py-1.5 font-semibold text-slate-900">{clientMap.get(String(f.client)) || 'Client'}</td>
                    <td className="w-28 px-3 py-1.5"><StatusPill status={f.kind === 'credit_block' ? 'block' : 'failed'} label={f.kind === 'credit_block' ? 'Credit hold' : 'Error'} /></td>
                    <td className="px-3 py-1.5 text-slate-700">{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
        <Section title={`Invoices raised (${(run.invoices || []).length})`} bodyClass="p-0">
          {(run.invoices || []).length ? (
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-600">
                <tr><th className="px-3 py-1">Invoice</th><th className="px-3 py-1">Client</th><th className="px-3 py-1">Status</th><th className="px-3 py-1 text-right">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {run.invoices.map((inv) => (
                  <tr key={inv._id} className="cursor-pointer hover:bg-[#EBF5EF]" onClick={() => navigate(`/clients/invoices/${inv._id}`, { state: { tabTitle: inv.invoiceNumber } })}>
                    <td className="px-3 py-1.5 font-bold text-[#0B3B2E]">{inv.invoiceNumber}</td>
                    <td className="px-3 py-1.5 text-slate-900">{inv.client?.name || '—'}</td>
                    <td className="px-3 py-1.5"><StatusPill status={inv.status} /></td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{money(inv.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyNote>No invoices were raised by this run.</EmptyNote>}
        </Section>
      </div>
    </div>
  );
};

const RunList = () => {
  const navigate = useNavigate();
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const params = useMemo(() => ({ page, limit }), [page, limit]);
  const pick = useCallback((res) => ({ rows: res.data?.runs || [], pagination: res.data?.pagination || { total: 0, page: 1, pages: 1 } }), []);
  const { rows, pagination, isFetching, error } = useServerList(`billing-runs:${businessId}`, billingApi.runs, params, pick);
  useEffect(() => { if (error) toast.error(error); }, [error]);
  const open = (r) => navigate(`/clients/billing/runs/${r._id}`, { state: { tabTitle: `Run ${fmtMonth(r.period)}` } });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ListToolbar>
        <Chip>Runs: {pagination.total || 0}</Chip>
        <ListToolbar.Divider />
        <ListToolbar.Button icon={FaPlay} onClick={() => navigate('/clients/billing/run', { state: { tabTitle: 'Billing Run' } })}>New billing run</ListToolbar.Button>
      </ListToolbar>
      <MilikTable
        columns={[
          { label: 'Run', width: '16%' },
          { label: 'Period', width: '10%' },
          { label: 'Scope', width: '16%' },
          { label: 'By', width: '14%' },
          { label: 'Invoices', align: 'right', width: '8%' },
          { label: 'Total', align: 'right', width: '12%' },
          { label: 'Failures', align: 'right', width: '8%' },
          { label: 'Status', width: '12%' },
        ]}
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty="No billing runs yet."
        tableFixed
        minWidth={900}
        onRowClick={open}
        renderRow={(r) => (
          <>
            <td className={`${cell} whitespace-nowrap font-semibold text-slate-900`}>{fmtDateTime(r.createdAt)}</td>
            <td className={`${cell} text-slate-700`}>{fmtMonth(r.period)}</td>
            <td className={`${cell} text-slate-700`}>{scopeLabel(r)}<span className="block text-[10px] text-slate-500">per {r.groupBy}{r.postAsDraft ? ' · drafts' : ''}</span></td>
            <td className={`${cell} text-slate-700`}>{r.triggeredBy === 'cron' ? 'Scheduled' : userName(r.runBy) || '—'}</td>
            <td className={numCell}>{r.invoiceCount}</td>
            <td className={`${numCell} font-bold text-slate-900`}>{money(r.total)}</td>
            <td className={`${numCell} ${(r.failures || []).length ? 'font-bold text-red-600' : 'text-slate-400'}`}>{(r.failures || []).length}</td>
            <td className={cellLast}><StatusPill status={r.status} /></td>
          </>
        )}
        renderActions={(r) => <button type="button" className={iconBtn} title="Open run" onClick={() => open(r)}><FaEye size={12} /></button>}
        actionsWidth="60px"
      />
      <PaginationBar
        page={pagination.page || page}
        pages={pagination.pages || 1}
        total={pagination.total || 0}
        pageSize={limit}
        pageSizes={PAGE_SIZES}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
        loading={isFetching}
        label="runs"
      />
    </div>
  );
};

const BillingRunHistory = () => {
  const { id } = useParams();
  return <ClientsShell>{id ? <RunDetail key={id} id={id} /> : <RunList />}</ClientsShell>;
};

export default BillingRunHistory;
