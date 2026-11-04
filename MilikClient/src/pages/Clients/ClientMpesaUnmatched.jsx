import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { FaLink, FaSyncAlt } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import MilikTable from '../../components/common/MilikTable';
import PaginationBar from '../../components/PaginationBar';
import AppSelect from '../../components/common/AppSelect';
import Modal from '../../components/common/Modal';
import { Chip } from '../../components/Clients/clientUi';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDateTime } from '../../utils/dates';
import {
  money, createListCache, useCashbooks, useClientLookup, useClientsAccess,
  cell, cellLast, numCell, iconBtn, footerBtn, footerPrimary, labelClass,
} from '../../components/Clients/clientHelpers';

const cache = createListCache();

const MatchModal = ({ row, onClose, onDone }) => {
  const { businessId } = useClientsAccess();
  const { options: clientOptions } = useClientLookup(businessId);
  const { options: cashbookOptions } = useCashbooks(businessId);
  const [clientId, setClientId] = useState(row.suggestedClient?._id || '');
  const [invoiceId, setInvoiceId] = useState(row.suggestedClient?.invoiceId || '');
  const [cashbookAccountId, setCashbookAccountId] = useState('');
  const [sendSms, setSendSms] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!clientId) { setInvoices([]); return undefined; }
    let alive = true;
    clientsCollectionsApi.allocationSuggestions(clientId)
      .then((res) => { if (alive) setInvoices(unwrap(res)?.invoices || []); })
      .catch(() => { if (alive) setInvoices([]); });
    return () => { alive = false; };
  }, [clientId]);

  const submit = async () => {
    if (!clientId) { toast.error('Pick the client who paid'); return; }
    setSaving(true);
    try {
      const res = await clientsCollectionsApi.matchMpesa(row._id, { clientId, invoiceId: invoiceId || undefined, cashbookAccountId: cashbookAccountId || undefined, sendSms });
      toast.success(res.data?.message || 'Payment matched');
      onDone();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not match this payment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Match M-Pesa ${row.transactionCode}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={footerPrimary} onClick={submit} disabled={saving}>{saving ? 'Matching…' : 'Create receipt'}</button>
        </>
      )}
    >
      <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
        <div className="border border-slate-200 bg-slate-50 px-2 py-1"><p className="text-[10px] font-bold uppercase text-slate-500">Amount</p><p className="font-black tabular-nums">KES {money(row.amount)}</p></div>
        <div className="border border-slate-200 bg-slate-50 px-2 py-1"><p className="text-[10px] font-bold uppercase text-slate-500">Account ref</p><p className="truncate font-semibold">{row.accountReference || row.billRefNumber || '—'}</p></div>
        <div className="border border-slate-200 bg-slate-50 px-2 py-1"><p className="text-[10px] font-bold uppercase text-slate-500">Payer</p><p className="truncate font-semibold">{row.payerName || row.msisdn || '—'}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div className="col-span-2">
          <AppSelect size="sm" label="Client" required searchable value={clientId} onChange={(v) => { setClientId(v || ''); setInvoiceId(''); }} options={clientOptions} />
        </div>
        <AppSelect
          size="sm"
          label="Settle invoice (optional)"
          clearable
          value={invoiceId}
          onChange={(v) => setInvoiceId(v || '')}
          options={invoices.map((i) => ({ value: i._id, label: `${i.invoiceNumber} · ${money(i.outstanding)}`, description: i.disputed ? 'Disputed' : '' }))}
          placeholder="Oldest first"
        />
        <AppSelect size="sm" label="Cashbook (optional)" clearable searchable value={cashbookAccountId} onChange={(v) => setCashbookAccountId(v || '')} options={cashbookOptions} placeholder="Paybill default" />
        <label className="col-span-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-800">
          <input type="checkbox" className="accent-[#0B3B2E]" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} />
          Send the payer a receipt SMS
        </label>
      </div>
      {row.metadata?.clientMatchSkipReason && <p className={`${labelClass} mt-2 font-normal text-amber-700`}>Auto-match skipped: {row.metadata.clientMatchSkipReason}</p>}
    </Modal>
  );
};

const ClientMpesaUnmatched = () => {
  const { businessId, canEdit } = useClientsAccess();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const key = `${businessId}:${page}:${limit}`;
  const [data, setData] = useState(() => cache.peek(key) || { collections: [], pagination: { total: 0, pages: 1 } });
  const [isFetching, setIsFetching] = useState(false);
  const [matching, setMatching] = useState(null);

  const load = useCallback(async (force = false) => {
    if (!businessId) return;
    const hit = !force && cache.get(key);
    if (hit) { setData(hit); return; }
    setIsFetching(true);
    try {
      const d = unwrap(await clientsCollectionsApi.listUnmatchedMpesa({ page, limit }));
      const next = { collections: d?.collections || [], pagination: d?.pagination || { total: 0, pages: 1 } };
      cache.set(key, next);
      setData(next);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load M-Pesa payments'));
    } finally {
      setIsFetching(false);
    }
  }, [businessId, key, page, limit]);
  useEffect(() => { load(); }, [load]);

  const rows = data.collections;
  const pageTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const suggested = rows.filter((r) => r.suggestedClient).length;

  return (
    <ClientsShell>
      <ListToolbar>
        <Chip>Unmatched: {(data.pagination?.total || 0).toLocaleString()}</Chip>
        <Chip>This page: KES {money(pageTotal)}</Chip>
        <Chip>With suggestion: {suggested}</Chip>
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" icon={FaSyncAlt} onClick={() => { cache.clear(); load(true); }}>Refresh</ListToolbar.Button>
      </ListToolbar>
      <MilikTable
        tableFixed
        columns={[
          { label: 'Code', width: '12%' },
          { label: 'Received', width: '14%' },
          { label: 'Payer', width: '20%' },
          { label: 'Account ref', width: '14%' },
          { label: 'Amount', align: 'right', width: '11%' },
          { label: 'Suggested client', width: '24%' },
        ]}
        actionsWidth="5%"
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty="No unmatched paybill payments"
        onRowClick={canEdit ? setMatching : undefined}
        renderRow={(r) => (
          <>
            <td className={`${cell} font-bold text-slate-900`}>{r.transactionCode}</td>
            <td className={`${cell} whitespace-nowrap`}>{fmtDateTime(r.transactionDate)}</td>
            <td className={`${cell} truncate`}>
              <span className="font-semibold text-slate-900">{r.payerName || '—'}</span>
              {r.msisdn && <span className="ml-1.5 text-slate-500">· {r.msisdn}</span>}
            </td>
            <td className={`${cell} truncate font-mono text-[10px]`}>{r.accountReference || r.billRefNumber || '—'}</td>
            <td className={`${numCell} font-bold`}>{money(r.amount)}</td>
            <td className={`${cellLast} truncate`}>
              {r.suggestedClient
                ? <><span className="font-semibold text-slate-900">{r.suggestedClient.name}</span><span className="ml-1.5 text-slate-500">· by {r.suggestedClient.matchedBy}</span></>
                : <span className="text-slate-400">No match — pick manually</span>}
            </td>
          </>
        )}
        renderActions={(r) => (canEdit ? <button type="button" title="Match to client" className={iconBtn} onClick={() => setMatching(r)}><FaLink size={12} /></button> : null)}
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
        label="payments"
      />
      {matching && <MatchModal row={matching} onClose={() => setMatching(null)} onDone={() => { cache.clear(); load(true); }} />}
    </ClientsShell>
  );
};

export default ClientMpesaUnmatched;
