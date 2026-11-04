// Quotes & proformas: list, send, accept/decline, convert to a contract or an invoice.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import {
  FaCheck, FaEdit, FaEye, FaFileContract, FaFileInvoice, FaPaperPlane, FaPlus, FaPrint, FaSearch, FaTimes, FaTimesCircle,
} from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import MilikTable from '../../components/common/MilikTable';
import PaginationBar from '../../components/PaginationBar';
import useDebounce from '../../hooks/useDebounce';
import { ConvertToContractModal, ConvertToInvoiceModal } from '../../components/Clients/Billing/QuoteModals';
import { Chip, ReasonModal, SentTags, StatusPill, cell, cellLast, numCell, iconBtn, iconBtnDanger } from '../../components/Clients/Billing/BillingUi';
import { PAGE_SIZES, QUOTE_STATUS_OPTIONS, daysUntil, invalidateList, money, useBillingClients, useBillingSettings, useServerList } from '../../components/Clients/Billing/billingShared';
import { quotesApi, apiError } from '../../services/clientsBillingApi';
import { fmtDate } from '../../utils/dates';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';

const Quotes = () => {
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canCreate = hasCompanyPermission(user, company, 'clients', 'create');
  const canEdit = hasCompanyPermission(user, company, 'clients', 'edit');
  const { options: clientOptions } = useBillingClients(businessId);
  const { settings } = useBillingSettings();

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput.trim(), 400);
  const [status, setStatus] = useState('');
  const [clientId, setClientId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [modal, setModal] = useState(null);

  const filterKey = `${search}|${status}|${clientId}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) { setLastFilterKey(filterKey); setPage(1); }

  const params = useMemo(() => {
    const p = { page, limit };
    if (search) p.search = search;
    if (status) p.status = status;
    if (clientId) p.clientId = clientId;
    return p;
  }, [page, limit, search, status, clientId]);
  const pick = useCallback((res) => ({ rows: res.data?.quotes || [], pagination: res.data?.pagination || { total: 0, page: 1, pages: 1 } }), []);
  const { rows, pagination, isFetching, error, reload } = useServerList(`client-quotes:${businessId}`, quotesApi.list, params, pick);
  useEffect(() => { if (error) toast.error(error); }, [error]);
  const refresh = useCallback(() => { invalidateList(`client-quotes:${businessId}`); reload(); }, [businessId, reload]);

  const openQuote = (q) => navigate(`/clients/quotes/${q._id}/edit`, { state: { tabTitle: q.quoteNumber } });
  const act = async (fn, ok) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (err) {
      toast.error(apiError(err));
    }
  };
  const print = async (q) => {
    try { await quotesApi.pdf(q._id, { preview: true, number: q.quoteNumber }); } catch (err) { toast.error(apiError(err, 'Could not open the quote')); }
  };
  const openValue = useMemo(() => rows.filter((q) => ['draft', 'sent'].includes(q.status)).reduce((s, q) => s + Number(q.total || 0), 0), [rows]);
  const terms = Number(settings?.defaultPaymentTermsDays ?? 30);

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <ListToolbar>
          <Chip title="Draft and sent quotes on this page">Open: KES {money(openValue)}</Chip>
          <ListToolbar.Divider />
          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
            <ListToolbar.Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Quote no. or title…" width="w-40" className="pl-5 pr-5" />
            {searchInput && <button type="button" onClick={() => setSearchInput('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400"><FaTimes size={8} /></button>}
          </div>
          <div className="w-32 shrink-0"><AppSelect compact value={status} onChange={(v) => setStatus(v || '')} options={QUOTE_STATUS_OPTIONS} placeholder="All statuses" clearable /></div>
          <div className="w-44 shrink-0"><AppSelect compact value={clientId} onChange={(v) => setClientId(v || '')} options={clientOptions} placeholder="All clients" searchable clearable /></div>
          <ListToolbar.Divider />
          <ListToolbar.Button variant="outline" onClick={() => { setSearchInput(''); setStatus(''); setClientId(''); }}>Reset</ListToolbar.Button>
          {canCreate && (
            <>
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaPlus} onClick={() => navigate('/clients/quotes/new', { state: { tabTitle: 'New Quote' } })}>New Quote</ListToolbar.Button>
            </>
          )}
        </ListToolbar>

        <MilikTable
          columns={[
            { label: 'No.', width: '13%' },
            { label: 'Client', width: '18%' },
            { label: 'Title', width: '19%' },
            { label: 'Issued / Valid', width: '13%' },
            { label: 'Total', align: 'right', width: '11%' },
            { label: 'Monthly', align: 'right', width: '9%' },
            { label: 'Status', width: '10%' },
          ]}
          rows={rows}
          loading={isFetching && rows.length === 0}
          empty="No quotes yet."
          tableFixed
          minWidth={980}
          onRowClick={openQuote}
          actionsWidth="170px"
          renderRow={(q) => {
            const left = daysUntil(q.validUntil);
            const open = ['draft', 'sent'].includes(q.status);
            return (
              <>
                <td className={cell}>
                  <span className="font-bold text-[#0B3B2E]">{q.quoteNumber}</span><SentTags emailAt={q.sentAt} />
                  <span className="block text-[10px] font-semibold uppercase text-slate-500">{q.kind === 'proforma' ? 'Proforma' : 'Quote'}</span>
                </td>
                <td className={cell}><span className="block truncate font-semibold text-slate-900">{q.client?.name || '—'}</span></td>
                <td className={cell}><span className="block truncate text-slate-700">{q.title || '—'}</span><span className="block text-[10px] text-slate-500">{(q.lines || []).length} line(s)</span></td>
                <td className={`${cell} whitespace-nowrap text-slate-700`}>
                  {fmtDate(q.issueDate)}
                  <span className={`block text-[10px] ${open && left != null && left < 0 ? 'font-bold text-red-600' : open && left != null && left <= 7 ? 'font-bold text-amber-600' : 'text-slate-500'}`}>
                    Valid to {fmtDate(q.validUntil)}
                  </span>
                </td>
                <td className={`${numCell} font-bold text-slate-900`}>{money(q.total)}</td>
                <td className={numCell}>{Number(q.recurringMonthly) > 0 ? money(q.recurringMonthly) : '—'}</td>
                <td className={cellLast}>
                  <StatusPill status={q.status} />
                  {(q.convertedContract || q.convertedInvoice) && <span className="block text-[10px] text-slate-500">{q.convertedContract ? 'Contract' : ''}{q.convertedContract && q.convertedInvoice ? ' + ' : ''}{q.convertedInvoice ? 'Invoice' : ''} raised</span>}
                </td>
              </>
            );
          }}
          renderActions={(q) => {
            const open = ['draft', 'sent'].includes(q.status);
            const convertible = ['draft', 'sent', 'accepted'].includes(q.status);
            return (
              <div className="flex justify-end gap-0.5">
                <button type="button" className={iconBtn} title={open && canEdit ? 'Edit' : 'View'} onClick={() => openQuote(q)}>{open && canEdit ? <FaEdit size={12} /> : <FaEye size={12} />}</button>
                <button type="button" className={iconBtn} title="Print / PDF" onClick={() => print(q)}><FaPrint size={12} /></button>
                {open && canEdit && <button type="button" className={iconBtn} title="Mark sent" onClick={() => act(() => quotesApi.send(q._id), `${q.quoteNumber} marked sent`)}><FaPaperPlane size={12} /></button>}
                {open && canEdit && <button type="button" className={iconBtn} title="Accept" onClick={() => act(() => quotesApi.accept(q._id), `${q.quoteNumber} accepted`)}><FaCheck size={12} /></button>}
                {convertible && canCreate && !q.convertedContract && <button type="button" className={iconBtn} title="Convert to contract" onClick={() => setModal({ kind: 'contract', quote: q })}><FaFileContract size={12} /></button>}
                {convertible && canCreate && !q.convertedInvoice && <button type="button" className={iconBtn} title="Convert to invoice" onClick={() => setModal({ kind: 'invoice', quote: q })}><FaFileInvoice size={12} /></button>}
                {open && canEdit && <button type="button" className={iconBtnDanger} title="Decline" onClick={() => setModal({ kind: 'decline', quote: q })}><FaTimesCircle size={12} /></button>}
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
          onPageSizeChange={(v) => { setLimit(v); setPage(1); }}
          loading={isFetching}
          label="quotes"
        />
      </div>

      {modal?.kind === 'decline' && (
        <ReasonModal title={`Decline ${modal.quote.quoteNumber}`} message="Record why the client declined." confirmLabel="Mark declined"
          onClose={() => setModal(null)} onConfirm={async (reason) => { await act(() => quotesApi.decline(modal.quote._id, reason), 'Quote declined'); setModal(null); }} />
      )}
      {modal?.kind === 'contract' && <ConvertToContractModal quote={modal.quote} defaultTermsDays={terms} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.kind === 'invoice' && <ConvertToInvoiceModal quote={modal.quote} defaultTermsDays={terms} onClose={() => setModal(null)} onDone={refresh} />}
    </ClientsShell>
  );
};

export default Quotes;
