// Client receipts table (+ pagination, expandable allocations, row actions).
// Used by the Receipts page and the Receipts tab of the client detail page;
// the caller owns the filters and passes them in `params`.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { FaPrint, FaEnvelope, FaHandHoldingUsd, FaUndoAlt, FaBan, FaCheck, FaTimesCircle } from 'react-icons/fa';
import MilikTable from '../common/MilikTable';
import PaginationBar from '../PaginationBar';
import { clientsCollectionsApi, unwrap, apiError } from '../../services/clientsCollectionsApi';
import { fmtDate } from '../../utils/dates';
import { ReasonModal, SentTags, StatusPill } from './clientUi';
import { ApplyCreditModal, RefundModal } from './ClientReceiptModals';
import {
  money, methodLabel, createListCache, receiptDocSpec, printAfterFetch, useClientsAccess,
  cell, cellLast, numCell, iconBtn, iconBtnDanger,
} from './clientHelpers';

const cache = createListCache();

const ReceiptDetail = ({ receiptId, onChanged, canEdit }) => {
  const [detail, setDetail] = useState(null);
  const [reversing, setReversing] = useState(null);

  const load = useCallback(() => {
    clientsCollectionsApi.getReceipt(receiptId)
      .then((res) => setDetail(unwrap(res)))
      .catch((err) => toast.error(apiError(err, 'Failed to load receipt')));
  }, [receiptId]);
  useEffect(() => { load(); }, [load]);

  if (!detail) return <p className="text-xs text-slate-400">Loading allocations…</p>;
  const { receipt, refunds = [], certificates = [] } = detail;
  const list = (title, rows) => (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
      {rows}
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-3 normal-case md:grid-cols-3">
      {list('Allocations', (
        <table className="w-full text-[11px]">
          <tbody>
            {(receipt.allocations || []).length === 0 && <tr><td className="py-1 text-slate-400">Not allocated — held as client credit</td></tr>}
            {(receipt.allocations || []).map((a) => (
              <tr key={a._id} className={`border-b border-slate-200 ${a.status === 'reversed' ? 'text-slate-400 line-through' : ''}`}>
                <td className="py-1 font-semibold">{a.invoiceNumber}</td>
                <td className="py-1 text-slate-500">{a.kind === 'credit_application' ? `Credit · ${fmtDate(a.appliedAt)}` : 'Receipt'}</td>
                <td className="py-1 text-right tabular-nums">{money(a.amount)}</td>
                <td className="w-6 py-1 text-right">
                  {canEdit && a.kind === 'credit_application' && a.status === 'active' && receipt.status === 'posted' && (
                    <button type="button" title="Undo this credit application" className={iconBtnDanger} onClick={() => setReversing(a)}><FaUndoAlt size={10} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {list('Withholding', (
        <div className="space-y-0.5 text-[11px]">
          {!certificates.length && <p className="text-slate-400">No tax withheld</p>}
          {certificates.map((c) => (
            <p key={c._id} className="flex justify-between gap-2">
              <span>{c.type === 'vat' ? 'VAT 2%' : 'Income tax'} · {c.certificateNo || 'cert pending'}</span>
              <span className="tabular-nums">{money(c.amount)} <StatusPill status={c.status} /></span>
            </p>
          ))}
        </div>
      ))}
      {list('Refunds', (
        <div className="space-y-0.5 text-[11px]">
          {!refunds.length && <p className="text-slate-400">No refunds</p>}
          {refunds.map((r) => (
            <p key={r._id} className={`flex justify-between gap-2 ${r.status === 'reversed' ? 'text-slate-400 line-through' : ''}`}>
              <span>{r.refundNumber} · {fmtDate(r.refundDate)} · {methodLabel(r.method)}</span>
              <span className="tabular-nums">{money(r.amount)}</span>
            </p>
          ))}
          {receipt.status === 'reversed' && <p className="text-red-600">Reversed: {receipt.reversalReason}</p>}
        </div>
      ))}
      {reversing && (
        <ReasonModal
          title={`Undo credit application — ${reversing.invoiceNumber}`}
          message="Applications made together are undone together; the amount returns to unapplied credit."
          confirmLabel="Undo application"
          onClose={() => setReversing(null)}
          onConfirm={async (reason) => {
            try {
              await clientsCollectionsApi.reverseAllocation(receiptId, reversing._id, reason);
              toast.success('Credit application reversed');
              setReversing(null);
              load();
              onChanged?.();
            } catch (err) {
              toast.error(apiError(err, 'Failed to reverse'));
            }
          }}
        />
      )}
    </div>
  );
};

const ClientReceiptsTable = ({ params, reloadKey = 0, onTotals, showClient = true, onChanged }) => {
  const { businessId, company, canEdit } = useClientsAccess();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const query = { ...params, page, limit };
  const key = `${businessId}:${JSON.stringify(query)}`;
  const [data, setData] = useState(() => cache.peek(key) || { receipts: [], pagination: { total: 0, pages: 1 }, totals: null });
  const [isFetching, setIsFetching] = useState(false);
  const [modal, setModal] = useState(null); // { type, receipt }

  const paramsKey = JSON.stringify(params);
  useEffect(() => { setPage(1); }, [paramsKey]);

  const load = useCallback(async (force = false) => {
    if (!businessId) return;
    const hit = !force && cache.get(key);
    if (hit) { setData(hit); return; }
    setIsFetching(true);
    try {
      const d = unwrap(await clientsCollectionsApi.listReceipts(JSON.parse(key.slice(key.indexOf(':') + 1))));
      const next = { receipts: d?.receipts || [], pagination: d?.pagination || { total: 0, pages: 1 }, totals: d?.totals || null };
      cache.set(key, next);
      setData(next);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load receipts'));
    } finally {
      setIsFetching(false);
    }
  }, [businessId, key]);

  useEffect(() => { load(reloadKey > 0); }, [load, reloadKey]);
  useEffect(() => { onTotals?.(data.totals, data.pagination?.total || 0); }, [data, onTotals]);

  const changed = () => { cache.clear(); load(true); onChanged?.(); };
  const emailReceipt = async (r) => {
    try {
      const res = await clientsCollectionsApi.emailReceipt(r._id);
      toast.success(res.data?.message || 'Receipt emailed');
    } catch (err) {
      toast.error(apiError(err, 'Failed to email receipt'));
    }
  };
  const rows = data.receipts;

  const printReceipt = (r) => printAfterFetch(
    () => clientsCollectionsApi.getReceipt(r._id).then((res) => unwrap(res).receipt),
    (receipt) => receiptDocSpec(receipt, company),
  );

  const chequeAction = async (r, status) => {
    if (status === 'bounced') { setModal({ type: 'bounce', receipt: r }); return; }
    try {
      const res = await clientsCollectionsApi.chequeStatus(r._id, { status: 'cleared' });
      toast.success(res.data?.message || 'Cheque cleared');
      changed();
    } catch (err) {
      toast.error(apiError(err, 'Failed to update cheque'));
    }
  };

  const columns = [
    { label: 'Receipt', width: '12%' },
    ...(showClient ? [{ label: 'Client', width: '17%' }] : []),
    { label: 'Date', width: '8%' },
    { label: 'Method · Reference', width: showClient ? '15%' : '22%' },
    { label: 'Cash', align: 'right', width: '10%' },
    { label: 'WHT', align: 'right', width: '8%' },
    { label: 'Allocated', align: 'right', width: '10%' },
    { label: 'Unapplied', align: 'right', width: '9%' },
    { label: 'Status', width: '7%' },
  ];

  return (
    <>
      <MilikTable
        tableFixed
        columns={columns}
        actionsWidth="10%"
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty="No receipts found"
        renderExpanded={(r) => <ReceiptDetail receiptId={r._id} canEdit={canEdit} onChanged={changed} />}
        rowClassName={(r) => (r.status === 'reversed' ? 'opacity-60' : '')}
        renderRow={(r) => {
          const wht = Number(r.whtIncomeTax?.amount || 0) + Number(r.whtVat?.amount || 0);
          const allocated = (r.allocations || []).filter((a) => a.status === 'active').reduce((s, a) => s + a.amount, 0);
          return (
            <>
              <td className={`${cell} truncate font-bold text-slate-900`}>{r.receiptNumber}<SentTags smsAt={r.lastSmsAt} emailAt={r.lastEmailAt} /></td>
              {showClient && <td className={`${cell} truncate font-semibold text-slate-900`}>{r.client?.name || '—'}</td>}
              <td className={`${cell} whitespace-nowrap`}>{fmtDate(r.receiptDate)}</td>
              <td className={`${cell} truncate text-slate-700`}>
                {methodLabel(r.method)}
                {(r.reference || r.chequeNumber) && <span className="ml-1.5 text-slate-500">· {r.reference || r.chequeNumber}</span>}
                {r.method === 'cheque' && r.chequeStatus && <span className="ml-1.5"><StatusPill status={r.chequeStatus} /></span>}
              </td>
              <td className={`${numCell} font-bold`}>{money(r.amount)}</td>
              <td className={numCell}>{wht ? money(wht) : '—'}</td>
              <td className={numCell}>{money(allocated)}</td>
              <td className={`${numCell} ${r.unappliedAmount > 0 ? 'font-bold text-slate-900' : 'text-slate-400'}`}>{money(r.unappliedAmount)}</td>
              <td className={cellLast}><StatusPill status={r.status} /></td>
            </>
          );
        }}
        renderActions={(r) => {
          const live = r.status === 'posted';
          return (
            <div className="flex justify-end gap-0.5">
              <button type="button" title="Print receipt" className={iconBtn} onClick={() => printReceipt(r)}><FaPrint size={12} /></button>
              {live && <button type="button" title="Email receipt to client" className={iconBtn} onClick={() => emailReceipt(r)}><FaEnvelope size={12} /></button>}
              {canEdit && live && r.unappliedAmount > 0 && (
                <>
                  <button type="button" title="Apply credit to invoices" className={iconBtn} onClick={() => setModal({ type: 'apply', receipt: r })}><FaCheck size={12} /></button>
                  <button type="button" title="Refund credit" className={iconBtn} onClick={() => setModal({ type: 'refund', receipt: r })}><FaHandHoldingUsd size={12} /></button>
                </>
              )}
              {canEdit && live && r.method === 'cheque' && r.chequeStatus === 'pending' && (
                <>
                  <button type="button" title="Mark cheque cleared" className={iconBtn} onClick={() => chequeAction(r, 'cleared')}><FaCheck size={12} /></button>
                  <button type="button" title="Mark cheque bounced (reverses receipt)" className={iconBtnDanger} onClick={() => chequeAction(r, 'bounced')}><FaTimesCircle size={12} /></button>
                </>
              )}
              {canEdit && live && (
                <button type="button" title="Reverse receipt" className={iconBtnDanger} onClick={() => setModal({ type: 'reverse', receipt: r })}><FaBan size={12} /></button>
              )}
            </div>
          );
        }}
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
        label="receipts"
      />

      {modal?.type === 'apply' && <ApplyCreditModal receipt={modal.receipt} onClose={() => setModal(null)} onDone={changed} />}
      {modal?.type === 'refund' && <RefundModal receipt={modal.receipt} onClose={() => setModal(null)} onDone={changed} />}
      {(modal?.type === 'reverse' || modal?.type === 'bounce') && (
        <ReasonModal
          title={modal.type === 'bounce' ? `Cheque bounced — ${modal.receipt.receiptNumber}` : `Reverse receipt ${modal.receipt.receiptNumber}`}
          message={modal.type === 'bounce'
            ? 'The receipt is reversed and its invoices re-opened.'
            : 'Reverses the cash, WHT and every allocation; invoices re-open. This cannot be undone.'}
          confirmLabel={modal.type === 'bounce' ? 'Mark bounced' : 'Reverse receipt'}
          required={modal.type === 'reverse'}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              const res = modal.type === 'bounce'
                ? await clientsCollectionsApi.chequeStatus(modal.receipt._id, { status: 'bounced', reason })
                : await clientsCollectionsApi.reverseReceipt(modal.receipt._id, reason);
              toast.success(res.data?.message || 'Done');
              setModal(null);
              changed();
            } catch (err) {
              toast.error(apiError(err, 'Failed'));
            }
          }}
        />
      )}
    </>
  );
};

export default ClientReceiptsTable;
