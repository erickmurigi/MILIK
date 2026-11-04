// Credit & debit notes register: filter, print, reverse (with reason), and raise late-payment
// interest debit notes. Notes themselves are raised from an invoice (NoteModal).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaFileInvoice, FaPercent, FaPrint, FaSearch, FaTimes, FaUndo } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import MilikTable from '../../components/common/MilikTable';
import Modal from '../../components/common/Modal';
import PaginationBar from '../../components/PaginationBar';
import useDebounce from '../../hooks/useDebounce';
import { Chip, ReasonModal, StatusPill, Required, cell, cellLast, numCell, iconBtn, iconBtnDanger, labelClass, inputClass, footerBtn, footerPrimary } from '../../components/Clients/Billing/BillingUi';
import { PAGE_SIZES, invalidateList, money, todayIso, useBillingClients, useServerList } from '../../components/Clients/Billing/billingShared';
import { notesApi, apiError } from '../../services/clientsBillingApi';
import { fmtDate } from '../../utils/dates';
import { hasCompanyPermission } from '../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../redux/selectors';

const TYPE_OPTIONS = [
  { value: 'CREDIT_NOTE', label: 'Credit notes' },
  { value: 'DEBIT_NOTE', label: 'Debit notes' },
];

const LateInterestModal = ({ clientOptions, onClose, onDone }) => {
  const [asOf, setAsOf] = useState(todayIso());
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      const res = await notesApi.lateInterest({ asOf, ...(clientId ? { clientId } : {}) });
      const data = res.data?.data || res.data;
      setResult(data);
      toast.success(`${(data.raised || []).length} late-interest debit note(s) raised`);
      onDone();
    } catch (err) {
      toast.error(apiError(err, 'Could not raise late interest'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Late payment interest" size="md" onClose={busy ? () => {} : onClose} footer={result ? <button type="button" className={footerPrimary} onClick={onClose}>Done</button> : (
      <>
        <button type="button" className={footerBtn} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={footerPrimary} onClick={run} disabled={busy}>{busy ? 'Raising…' : 'Raise debit notes'}</button>
      </>
    )}>
      {result ? (
        <div className="space-y-1 text-xs text-slate-700">
          <p><b>{(result.raised || []).length}</b> debit note(s) raised · total <b className="tabular-nums">KES {money(result.total)}</b></p>
          <ul className="max-h-60 space-y-0.5 overflow-y-auto">
            {(result.raised || []).map((n, i) => <li key={n.noteNumber || i}>{n.noteNumber || 'Note'} · <span className="tabular-nums">KES {money(n.total)}</span></li>)}
          </ul>
          {(result.failures || []).length > 0 && <p className="text-red-700">{result.failures.length} invoice(s) failed: {result.failures.map((f) => f.message || f.error).filter(Boolean).slice(0, 3).join('; ')}</p>}
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-600">Charges each contract's late-payment interest (rate, basis and grace days from the contract) on overdue invoices, as posted debit notes. Interest already charged for a period is not charged twice.</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Interest up to<Required /></label>
              <input type="date" className={inputClass} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Client</label>
              <AppSelect size="sm" value={clientId} onChange={(v) => setClientId(v || '')} options={clientOptions} placeholder="All clients" searchable clearable />
            </div>
          </div>
        </>
      )}
    </Modal>
  );
};

const CreditNotes = () => {
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canReverse = hasCompanyPermission(user, company, 'clients', 'reverse');
  const canCreate = hasCompanyPermission(user, company, 'clients', 'create');
  const { clients, options: clientOptions } = useBillingClients(businessId);

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput.trim(), 400);
  const [noteType, setNoteType] = useState('');
  const [clientId, setClientId] = useState('');
  const [includeReversed, setIncludeReversed] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [modal, setModal] = useState(null);

  const filterKey = `${search}|${noteType}|${clientId}|${includeReversed}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) { setLastFilterKey(filterKey); setPage(1); }

  const params = useMemo(() => {
    const p = { page, limit };
    if (search) p.search = search;
    if (noteType) p.noteType = noteType;
    if (clientId) p.clientId = clientId;
    if (includeReversed) p.includeReversed = 'true';
    return p;
  }, [page, limit, search, noteType, clientId, includeReversed]);
  const pick = useCallback((res) => ({ rows: res.data?.notes || [], pagination: res.data?.pagination || { total: 0, page: 1, pages: 1 } }), []);
  const { rows, pagination, isFetching, error, reload } = useServerList(`client-notes:${businessId}`, notesApi.list, params, pick);
  useEffect(() => { if (error) toast.error(error); }, [error]);
  const refresh = useCallback(() => { invalidateList(`client-notes:${businessId}`); invalidateList(`invoices:${businessId}`); reload(); }, [businessId, reload]);

  const pageTotals = useMemo(() => rows.filter((n) => n.status === 'posted').reduce((acc, n) => {
    if (n.noteType === 'CREDIT_NOTE') acc.credit += Number(n.total || 0); else acc.debit += Number(n.total || 0);
    return acc;
  }, { credit: 0, debit: 0 }), [rows]);

  const print = async (n) => {
    try { await notesApi.pdf(n._id, { preview: true, number: n.noteNumber }); } catch (err) { toast.error(apiError(err, 'Could not open the note')); }
  };
  const clientName = (n) => n.client?.name || clients.find((c) => c._id === (n.client?._id || n.client))?.name || '—';

  return (
    <ClientsShell>
      <div className="flex h-full min-h-0 flex-col">
        <ListToolbar>
          <Chip title="Posted notes on this page">Credits: KES {money(pageTotals.credit)}</Chip>
          <Chip title="Posted notes on this page">Debits: KES {money(pageTotals.debit)}</Chip>
          <ListToolbar.Divider />
          <div className="relative shrink-0">
            <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
            <ListToolbar.Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Note number…" width="w-36" className="pl-5 pr-5" />
            {searchInput && <button type="button" onClick={() => setSearchInput('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400"><FaTimes size={8} /></button>}
          </div>
          <div className="w-32 shrink-0"><AppSelect compact value={noteType} onChange={(v) => setNoteType(v || '')} options={TYPE_OPTIONS} placeholder="Credit & debit" clearable /></div>
          <div className="w-44 shrink-0"><AppSelect compact value={clientId} onChange={(v) => setClientId(v || '')} options={clientOptions} placeholder="All clients" searchable clearable /></div>
          <label className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] font-semibold text-slate-700">
            <input type="checkbox" className="accent-[#0B3B2E]" checked={includeReversed} onChange={(e) => setIncludeReversed(e.target.checked)} /> Show reversed
          </label>
          <ListToolbar.Divider />
          <ListToolbar.Button variant="outline" onClick={() => { setSearchInput(''); setNoteType(''); setClientId(''); setIncludeReversed(false); }}>Reset</ListToolbar.Button>
          {canCreate && (
            <>
              <ListToolbar.Divider />
              <ListToolbar.Button icon={FaPercent} onClick={() => setModal({ kind: 'interest' })}>Late interest</ListToolbar.Button>
            </>
          )}
        </ListToolbar>

        <MilikTable
          columns={[
            { label: 'No.', width: '12%' },
            { label: 'Client', width: '17%' },
            { label: 'Invoice', width: '11%' },
            { label: 'Date', width: '9%' },
            { label: 'Reason', width: '19%' },
            { label: 'Net', align: 'right', width: '9%' },
            { label: 'Tax', align: 'right', width: '8%' },
            { label: 'Total', align: 'right', width: '10%' },
            { label: 'Status', width: '8%' },
          ]}
          rows={rows}
          loading={isFetching && rows.length === 0}
          empty="No credit or debit notes."
          tableFixed
          minWidth={1000}
          actionsWidth="90px"
          renderRow={(n) => (
            <>
              <td className={cell}>
                <span className="font-bold text-[#0B3B2E]">{n.noteNumber}</span>
                <span className="block text-[10px] font-bold text-slate-600">{n.noteType === 'CREDIT_NOTE' ? 'Credit note' : 'Debit note'}{n.isFullCredit ? ' · full' : ''}</span>
              </td>
              <td className={cell}><span className="block truncate font-semibold text-slate-900">{clientName(n)}</span></td>
              <td className={cell}>
                <button type="button" className="font-semibold text-[#0B3B2E] hover:underline" onClick={() => navigate(`/clients/invoices/${n.invoice}`, { state: { tabTitle: n.invoiceNumber } })}>{n.invoiceNumber || 'Invoice'}</button>
              </td>
              <td className={`${cell} whitespace-nowrap text-slate-700`}>{fmtDate(n.noteDate)}</td>
              <td className={cell} title={n.reason}><span className="block truncate text-slate-700">{n.reason || '—'}</span>{n.status === 'reversed' && n.reversalReason && <span className="block truncate text-[10px] text-red-600">Reversed: {n.reversalReason}</span>}</td>
              <td className={numCell}>{n.noteType === 'CREDIT_NOTE' ? '−' : ''}{money(n.subtotal)}</td>
              <td className={numCell}>{money(n.taxAmount)}</td>
              <td className={`${numCell} font-bold text-slate-900`}>{n.noteType === 'CREDIT_NOTE' ? '−' : '+'}{money(n.total)}</td>
              <td className={cellLast}><StatusPill status={n.status} /></td>
            </>
          )}
          renderActions={(n) => (
            <div className="flex justify-end gap-0.5">
              <button type="button" className={iconBtn} title="Print / PDF" onClick={() => print(n)}><FaPrint size={12} /></button>
              <button type="button" className={iconBtn} title="Open invoice" onClick={() => navigate(`/clients/invoices/${n.invoice}`, { state: { tabTitle: n.invoiceNumber } })}><FaFileInvoice size={12} /></button>
              {canReverse && n.status === 'posted' && <button type="button" className={iconBtnDanger} title="Reverse" onClick={() => setModal({ kind: 'reverse', note: n })}><FaUndo size={12} /></button>}
            </div>
          )}
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
          label="notes"
        />
      </div>

      {modal?.kind === 'reverse' && (
        <ReasonModal
          title={`Reverse ${modal.note.noteNumber}`}
          message={`Reverses the note's ledger entries and restores invoice ${modal.note.invoiceNumber}'s balance.`}
          confirmLabel="Reverse note"
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            try {
              await notesApi.reverse(modal.note._id, reason);
              toast.success(`${modal.note.noteNumber} reversed`);
              setModal(null);
              refresh();
            } catch (err) {
              toast.error(apiError(err, 'Could not reverse the note'));
            }
          }}
        />
      )}
      {modal?.kind === 'interest' && <LateInterestModal clientOptions={clientOptions} onClose={() => setModal(null)} onDone={refresh} />}
    </ClientsShell>
  );
};

export default CreditNotes;
