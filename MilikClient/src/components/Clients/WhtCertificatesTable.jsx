// Withholding-tax certificates (expected / received) with "mark received".
// Reads the wht-certificates report (rows + totals in one call).
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { FaCheck } from 'react-icons/fa';
import MilikTable from '../common/MilikTable';
import PaginationBar from '../PaginationBar';
import Modal from '../common/Modal';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDate, todayISO } from '../../utils/dates';
import { Required, StatusPill, UploadButton } from './clientUi';
import { money, createListCache, useClientsAccess, cell, cellLast, numCell, iconBtn, inputClass, labelClass, footerBtn, footerPrimary } from './clientHelpers';

const cache = createListCache();

export const MarkReceivedModal = ({ cert, onClose, onDone }) => {
  const [form, setForm] = useState({ certificateNo: cert.certificateNo || '', certificateDate: todayISO(), fileUrl: cert.fileUrl || '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.certificateNo.trim()) { toast.error('Certificate number is required'); return; }
    setSaving(true);
    try {
      const res = await clientsCollectionsApi.updateWhtCertificate(cert._id, form);
      toast.success(res.data?.message || 'Certificate recorded');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Failed to record certificate'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title={`${cert.type === 'vat' ? 'VAT' : 'Income tax'} WHT certificate — ${cert.receiptNumber}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={footerBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className={footerPrimary} onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Mark received'}</button>
        </>
      )}
    >
      <p className="mb-2 text-xs text-slate-600">{cert.client?.name} · withheld {fmtDate(cert.withheldDate)} · <b className="tabular-nums">KES {money(cert.amount)}</b></p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <label className={labelClass}>Certificate no.<Required /></label>
          <input autoFocus className={inputClass} value={form.certificateNo} onChange={(e) => set('certificateNo', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Certificate date</label>
          <input type="date" className={inputClass} value={form.certificateDate} onChange={(e) => set('certificateDate', e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Certificate file</label>
          <div className="flex items-center gap-2">
            <input className={inputClass} value={form.fileUrl} onChange={(e) => set('fileUrl', e.target.value)} placeholder="Upload, or paste a link" />
            <UploadButton className="shrink-0" label="Upload" onUploaded={(doc) => set('fileUrl', doc.url)} />
          </div>
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Notes</label>
          <input className={inputClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

const WhtCertificatesTable = ({ status = 'expected', type = '', clientId = '', showClient = true, reloadKey = 0, onTotals }) => {
  const { businessId, canEdit } = useClientsAccess();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const query = JSON.stringify({ status, type: type || undefined, clientId: clientId || undefined, page, limit });
  const key = `${businessId}:${query}`;
  const [data, setData] = useState(() => cache.peek(key) || { rows: [], totals: null, pagination: { total: 0, pages: 1 } });
  const [isFetching, setIsFetching] = useState(false);
  const [marking, setMarking] = useState(null);

  const load = useCallback(async (force = false) => {
    if (!businessId) return;
    const hit = !force && cache.get(key);
    if (hit) { setData(hit); return; }
    setIsFetching(true);
    try {
      const d = unwrap(await clientsCollectionsApi.report('wht-certificates', JSON.parse(query)));
      const next = { rows: d?.rows || [], totals: d?.totals || null, byClient: d?.byClient || [], pagination: d?.pagination || { total: 0, pages: 1 } };
      cache.set(key, next);
      setData(next);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load WHT certificates'));
    } finally {
      setIsFetching(false);
    }
  }, [businessId, key, query]);

  useEffect(() => { load(reloadKey > 0); }, [load, reloadKey]);
  useEffect(() => { onTotals?.(data); }, [data, onTotals]);

  const rows = data.rows;
  return (
    <>
      <MilikTable
        tableFixed
        columns={[
          { label: 'Receipt', width: '12%' },
          ...(showClient ? [{ label: 'Client', width: '22%' }] : []),
          { label: 'Type', width: '10%' },
          { label: 'Withheld', width: '10%' },
          { label: 'Amount', align: 'right', width: '11%' },
          { label: 'Certificate', width: '15%' },
          { label: 'Age', align: 'right', width: '7%' },
          { label: 'Status', width: '8%' },
        ]}
        actionsWidth="5%"
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty={status === 'expected' ? 'No outstanding certificates' : 'No certificates'}
        renderRow={(c) => (
          <>
            <td className={`${cell} font-bold text-slate-900`}>{c.receiptNumber}</td>
            {showClient && (
              <td className={`${cell} truncate font-semibold text-slate-900`}>
                {c.client?.name || '—'}{c.client?.taxPin && <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-500">· {c.client.taxPin}</span>}
              </td>
            )}
            <td className={cell}>{c.type === 'vat' ? 'VAT 2%' : 'Income tax'}</td>
            <td className={`${cell} whitespace-nowrap`}>{fmtDate(c.withheldDate)}</td>
            <td className={`${numCell} font-bold`}>{money(c.amount)}</td>
            <td className={`${cell} truncate`}>
              {c.certificateNo || <span className="text-slate-400">—</span>}
              {c.certificateDate && <span className="ml-1.5 text-slate-500">· {fmtDate(c.certificateDate)}</span>}
              {c.fileUrl && <a href={c.fileUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1.5 text-[#0B3B2E] underline">file</a>}
            </td>
            <td className={`${numCell} ${c.daysOutstanding > 60 ? 'font-bold text-red-600' : ''}`}>{c.daysOutstanding != null ? `${c.daysOutstanding}d` : '—'}</td>
            <td className={cellLast}><StatusPill status={c.status} /></td>
          </>
        )}
        renderActions={(c) => (canEdit && c.status !== 'cancelled' ? (
          <button type="button" title={c.status === 'received' ? 'Update certificate' : 'Mark received'} className={iconBtn} onClick={() => setMarking(c)}><FaCheck size={12} /></button>
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
        label="certificates"
      />
      {marking && <MarkReceivedModal cert={marking} onClose={() => setMarking(null)} onDone={() => { cache.clear(); load(true); }} />}
    </>
  );
};

export default WhtCertificatesTable;
