// Client invoices register — full page (pages/Clients/ClientsInvoices.jsx), embedded in a client's
// detail page (`clientId`) or in a contract's Invoices tab (`contractId`).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FaBan, FaCheck, FaEdit, FaEnvelope, FaEye, FaMinusCircle, FaMoneyBillWave, FaPlus, FaPlusCircle, FaPrint, FaSearch, FaSms, FaTimes,
} from 'react-icons/fa';
import MilikTable from '../../common/MilikTable';
import ListToolbar from '../../common/ListToolbar';
import AppSelect from '../../common/AppSelect';
import Modal from '../../common/Modal';
import PaginationBar from '../../PaginationBar';
import useDebounce from '../../../hooks/useDebounce';
import { fmtDate } from '../../../utils/dates';
import { hasCompanyPermission } from '../../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../../redux/selectors';
import { invoicesApi, apiError } from '../../../services/clientsBillingApi';
import { clientsApi } from '../../../services/clientsApi';
import NoteModal from './NoteModal';
import { Chip, EtimsIcon, ReasonModal, SentTags, StatusPill, cell, cellLast, numCell, iconBtn, iconBtnDanger, labelClass, textareaClass, footerBtn, footerPrimary } from './BillingUi';
import {
  INVOICE_STATUS_OPTIONS, PAGE_SIZES, invoiceDisplayStatus, money, invalidateList, useBillingClients, useClientContracts, useServerList,
} from './billingShared';

const OPEN = ['posted', 'sent', 'partial', 'partially_paid', 'overdue'];
const kpiCache = new Map();

const SmsModal = ({ invoice, onClose }) => {
  const client = invoice.client || {};
  const [body, setBody] = useState(() => `Dear ${client.name || 'client'}, invoice ${invoice.invoiceNumber} of ${invoice.currency || 'KES'} ${money(invoice.total)} is due on ${fmtDate(invoice.dueDate)}. Balance: ${invoice.currency || 'KES'} ${money(invoice.outstanding)}. Thank you.`);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await clientsApi.sendSms(client._id, { body: body.trim() });
      toast.success(res.data?.message || 'SMS sent');
      onClose();
    } catch (err) {
      toast.error(apiError(err, 'Could not send the SMS'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`SMS — ${invoice.invoiceNumber}`} size="sm" onClose={onClose} footer={(
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={send} disabled={busy || !body.trim()}>{busy ? 'Sending…' : 'Send SMS'}</button>
      </>
    )}>
      <p className="mb-2 text-xs text-slate-600">To {client.name} · {client.phone && client.phone !== '-' ? client.phone : 'no phone on file'}</p>
      <label className={labelClass}>Message</label>
      <textarea rows={4} className={textareaClass} value={body} onChange={(e) => setBody(e.target.value)} maxLength={480} />
      <p className="mt-1 text-right text-[10px] text-slate-500">{body.length} chars · {Math.ceil(body.length / 160) || 1} SMS</p>
    </Modal>
  );
};

const ClientInvoicesPanel = ({ clientId = '', contractId = '' }) => {
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canCreate = hasCompanyPermission(user, company, 'clients', 'create');
  const canEdit = hasCompanyPermission(user, company, 'clients', 'edit');
  const canDelete = hasCompanyPermission(user, company, 'clients', 'delete');
  const scoped = Boolean(clientId || contractId);
  const { options: clientOptions } = useBillingClients(clientId ? '' : businessId);

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput.trim(), 400);
  const [status, setStatus] = useState('');
  const [clientPick, setClientPick] = useState('');
  const [contractPick, setContractPick] = useState('');
  const client = clientId || clientPick;
  const contract = contractId || contractPick;
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [modal, setModal] = useState(null); // { kind, invoice }
  const contractOptions = useClientContracts(contractId ? null : client || undefined);

  // Any filter change goes back to page 1 (debounced search: the key below resets it too).
  const filterKey = `${search}|${status}|${client}|${contract}|${dateFrom}|${dateTo}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) { setLastFilterKey(filterKey); setPage(1); }

  const params = useMemo(() => {
    const p = { page, limit };
    if (search) p.search = search;
    if (status === 'overdue') p.overdue = 'true';
    else if (status) p.status = status === 'partially_paid' ? 'partial' : status;
    if (client) p.clientId = client;
    if (contract) p.contractId = contract;
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = `${dateTo}T23:59:59`;
    return p;
  }, [page, limit, search, status, client, contract, dateFrom, dateTo]);

  const pick = useCallback((res) => ({
    rows: res.data?.invoices || [],
    pagination: res.data?.pagination || { total: 0, page: 1, pages: 1 },
  }), []);
  const { rows, pagination, isFetching, error, reload } = useServerList(`invoices:${businessId}`, invoicesApi.list, params, pick);
  useEffect(() => { if (error) toast.error(error); }, [error]);

  // Header chips. Company-wide: the reports dashboard aggregate (one request). Scoped to a
  // client/contract: that client's invoices summed client-side (bounded set).
  const kpiKey = `${businessId}:${clientId}:${contractId}`;
  const [kpis, setKpis] = useState(() => kpiCache.get(kpiKey) || null);
  const loadKpis = useCallback(() => {
    if (!businessId) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const req = scoped
      ? invoicesApi.list({ ...(clientId ? { clientId } : {}), ...(contractId ? { contractId } : {}), limit: 200 }).then((res) => {
        const list = res.data?.invoices || [];
        const open = list.filter((i) => OPEN.includes(i.status));
        return {
          outstanding: open.reduce((s, i) => s + Number(i.outstanding || 0), 0),
          overdue: open.filter((i) => i.isOverdue).reduce((s, i) => s + Number(i.outstanding || 0), 0),
          overdueCount: open.filter((i) => i.isOverdue).length,
          billed: list.filter((i) => !['draft', 'cancelled'].includes(i.status) && new Date(i.issueDate) >= monthStart).reduce((s, i) => s + Number(i.total || 0), 0),
        };
      })
      : invoicesApi.kpis({ from: monthStart.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }).then((res) => {
        const d = res.data?.data || {};
        return { outstanding: d.receivables || 0, overdue: d.overdue?.total || 0, overdueCount: d.overdue?.invoices || 0, billed: d.billed?.total || 0 };
      });
    req.then((next) => { kpiCache.set(kpiKey, next); setKpis(next); }).catch(() => {});
  }, [businessId, scoped, clientId, contractId, kpiKey]);
  useEffect(() => { loadKpis(); }, [loadKpis]);

  const refreshAll = useCallback(() => { invalidateList(`invoices:${businessId}`); reload(); loadKpis(); }, [businessId, reload, loadKpis]);

  const openInvoice = useCallback((inv) => navigate(`/clients/invoices/${inv._id}`, { state: { tabTitle: inv.invoiceNumber || 'Invoice' } }), [navigate]);
  const newInvoice = () => {
    const q = new URLSearchParams();
    if (client) q.set('clientId', client);
    if (contract) q.set('contractId', contract);
    navigate(`/clients/invoices/new${q.toString() ? `?${q}` : ''}`, { state: { tabTitle: 'New Invoice' } });
  };
  const recordPayment = (inv) => navigate(`/clients/receipts/new?clientId=${inv.client?._id || inv.client}&invoiceId=${inv._id}`, { state: { tabTitle: 'New Receipt' } });

  const act = async (fn, okMsg) => {
    try {
      const res = await fn();
      toast.success(res?.data?.message || okMsg);
      refreshAll();
    } catch (err) {
      toast.error(apiError(err));
    }
  };
  const printPdf = async (inv) => {
    try { await invoicesApi.pdf(inv._id, { preview: true, number: inv.invoiceNumber }); } catch (err) { toast.error(apiError(err, 'Could not open the invoice PDF')); }
  };

  const resetFilters = () => {
    setSearchInput(''); setStatus(''); setDateFrom(''); setDateTo('');
    setClientPick('');
    setContractPick('');
  };

  const columns = useMemo(() => [
    { label: 'No.', width: '13%' },
    ...(clientId ? [] : [{ label: 'Client', width: '18%' }]),
    { label: 'Issue / Due', width: '13%' },
    { label: 'Period', width: '13%' },
    { label: 'Total', align: 'right', width: '11%' },
    { label: 'Outstanding', align: 'right', width: '11%' },
    { label: 'Status', width: '9%' },
    { label: 'eTIMS', align: 'center', width: '5%' },
  ], [clientId]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <ListToolbar>
        {kpis && (
          <>
            <Chip title="Open balance on posted invoices">Outstanding: KES {money(kpis.outstanding)}</Chip>
            <Chip onClick={() => setStatus(status === 'overdue' ? '' : 'overdue')} active={status === 'overdue'} title={`${kpis.overdueCount} overdue invoice(s)`}>Overdue: KES {money(kpis.overdue)}</Chip>
            <Chip title="Invoiced since the 1st of this month (excl. drafts)">This month: KES {money(kpis.billed)}</Chip>
            <ListToolbar.Divider />
          </>
        )}
        <div className="relative shrink-0">
          <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
          <ListToolbar.Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Invoice no. or PO…" width="w-40" className="pl-5 pr-5" />
          {searchInput && <button type="button" onClick={() => setSearchInput('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><FaTimes size={8} /></button>}
        </div>
        <div className="w-32 shrink-0"><AppSelect compact value={status} onChange={(v) => setStatus(v || '')} options={INVOICE_STATUS_OPTIONS} placeholder="All statuses" clearable /></div>
        {!clientId && !contractId && (
          <div className="w-44 shrink-0"><AppSelect compact value={client} onChange={(v) => { setClientPick(v || ''); setContractPick(''); }} options={clientOptions} placeholder="All clients" searchable clearable /></div>
        )}
        {!contractId && (
          <div className="w-36 shrink-0"><AppSelect compact value={contract} onChange={(v) => setContractPick(v || '')} options={contractOptions} placeholder="Any contract" searchable clearable /></div>
        )}
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="Issued from" className="h-[22px] w-[108px] shrink-0 border border-slate-200 px-1 text-[10px]" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Issued to" className="h-[22px] w-[108px] shrink-0 border border-slate-200 px-1 text-[10px]" />
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" onClick={resetFilters}>Reset</ListToolbar.Button>
        {canCreate && (
          <>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlus} onClick={newInvoice}>New Invoice</ListToolbar.Button>
          </>
        )}
      </ListToolbar>

      <MilikTable
        columns={columns}
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty={scoped ? 'No invoices yet.' : 'No invoices match these filters.'}
        tableFixed
        minWidth={1020}
        onRowClick={openInvoice}
        actionsWidth="190px"
        renderRow={(inv) => {
          const cur = inv.currency || 'KES';
          const shown = invoiceDisplayStatus(inv);
          return (
            <>
              <td className={cell}>
                <span className="font-bold text-[#0B3B2E]">{inv.invoiceNumber || '—'}</span>
                <SentTags emailAt={inv.sentAt} />
                {inv.poNumber && <span className="block truncate text-[10px] text-slate-500">PO {inv.poNumber}</span>}
              </td>
              {!clientId && <td className={cell}><span className="block truncate font-semibold text-slate-900">{inv.client?.name || '—'}</span></td>}
              <td className={`${cell} whitespace-nowrap text-slate-700`}>
                {fmtDate(inv.issueDate)}
                <span className={`block text-[10px] ${shown === 'overdue' ? 'font-bold text-red-600' : 'text-slate-500'}`}>Due {fmtDate(inv.dueDate)}</span>
              </td>
              <td className={`${cell} whitespace-nowrap text-slate-700`}>
                {inv.periodStart ? <>{fmtDate(inv.periodStart)}<span className="block text-[10px] text-slate-500">to {fmtDate(inv.periodEnd)}</span></> : <span className="text-slate-400">—</span>}
              </td>
              <td className={`${numCell} font-bold text-slate-900`}>{cur !== 'KES' && <span className="mr-1 text-[10px] font-normal text-slate-500">{cur}</span>}{money(inv.adjustedTotal ?? inv.total)}</td>
              <td className={`${numCell} ${Number(inv.outstanding) > 0.005 ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>{money(inv.outstanding)}</td>
              <td className={cell}><StatusPill status={shown} /></td>
              <td className={`${cellLast} text-center`}><EtimsIcon invoice={inv} /></td>
            </>
          );
        }}
        renderActions={(inv) => {
          const isDraft = inv.status === 'draft';
          const isOpen = OPEN.includes(inv.status);
          const live = !['draft', 'cancelled'].includes(inv.status);
          return (
            <div className="flex justify-end gap-0.5">
              <button type="button" className={iconBtn} title="View" onClick={() => openInvoice(inv)}><FaEye size={12} /></button>
              {isDraft && canEdit && <button type="button" className={iconBtn} title="Edit draft" onClick={() => navigate(`/clients/invoices/${inv._id}/edit`, { state: { tabTitle: `Edit ${inv.invoiceNumber}` } })}><FaEdit size={12} /></button>}
              <button type="button" className={iconBtn} title="Print / PDF" onClick={() => printPdf(inv)}><FaPrint size={12} /></button>
              {isDraft && canEdit && <button type="button" className={iconBtn} title="Post to ledger" onClick={() => setModal({ kind: 'post', invoice: inv })}><FaCheck size={12} /></button>}
              {inv.status !== 'cancelled' && <button type="button" className={iconBtn} title={isDraft ? 'Post & email' : 'Email invoice'} onClick={() => setModal({ kind: 'send', invoice: inv })}><FaEnvelope size={12} /></button>}
              {live && <button type="button" className={iconBtn} title="Send SMS" onClick={() => setModal({ kind: 'sms', invoice: inv })}><FaSms size={12} /></button>}
              {isOpen && <button type="button" className={iconBtn} title="Record payment" onClick={() => recordPayment(inv)}><FaMoneyBillWave size={12} /></button>}
              {live && inv.status !== 'credited' && canEdit && <button type="button" className={iconBtn} title="Credit note" onClick={() => setModal({ kind: 'credit', invoice: inv })}><FaMinusCircle size={12} /></button>}
              {live && canEdit && <button type="button" className={iconBtn} title="Debit note" onClick={() => setModal({ kind: 'debit', invoice: inv })}><FaPlusCircle size={12} /></button>}
              {canDelete && !['cancelled', 'paid', 'partial', 'partially_paid', 'credited'].includes(inv.status) && !(Number(inv.paidAmount) > 0) && (
                <button type="button" className={iconBtnDanger} title="Cancel invoice" onClick={() => setModal({ kind: 'cancel', invoice: inv })}><FaBan size={12} /></button>
              )}
            </div>
          );
        }}
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
        label="invoices"
      />

      {modal?.kind === 'post' && (
        <ReasonModal
          title={`Post ${modal.invoice.invoiceNumber}`}
          message={<>Post this draft to the ledger? Its amounts become final — later changes need a credit or debit note.</>}
          withReason={false}
          danger={false}
          confirmLabel="Post invoice"
          onClose={() => setModal(null)}
          onConfirm={async () => { await act(() => invoicesApi.post(modal.invoice._id), 'Invoice posted'); setModal(null); }}
        />
      )}
      {modal?.kind === 'send' && (
        <ReasonModal
          title={`Email ${modal.invoice.invoiceNumber}`}
          message={modal.invoice.status === 'draft'
            ? <>This draft will be <b>posted to the ledger</b> and emailed to {modal.invoice.client?.email || 'the client'}.</>
            : <>Email the invoice PDF to {modal.invoice.client?.email || 'the client'}?</>}
          withReason={false}
          danger={false}
          confirmLabel={modal.invoice.status === 'draft' ? 'Post & send' : 'Send'}
          onClose={() => setModal(null)}
          onConfirm={async () => { await act(() => invoicesApi.send(modal.invoice._id), 'Invoice sent'); setModal(null); }}
        />
      )}
      {modal?.kind === 'cancel' && (
        <ReasonModal
          title={`Cancel ${modal.invoice.invoiceNumber}`}
          message={modal.invoice.status === 'draft' ? 'The draft will be cancelled.' : 'The invoice will be cancelled and its ledger entries reversed. Contract periods it billed become billable again.'}
          confirmLabel="Cancel invoice"
          onClose={() => setModal(null)}
          onConfirm={async (reason) => { await act(() => invoicesApi.cancel(modal.invoice._id, reason), 'Invoice cancelled'); setModal(null); }}
        />
      )}
      {modal?.kind === 'sms' && <SmsModal invoice={modal.invoice} onClose={() => setModal(null)} />}
      {(modal?.kind === 'credit' || modal?.kind === 'debit') && (
        <NoteModal invoiceId={modal.invoice._id} type={modal.kind} onClose={() => setModal(null)} onDone={refreshAll} />
      )}
    </div>
  );
};

export default ClientInvoicesPanel;
