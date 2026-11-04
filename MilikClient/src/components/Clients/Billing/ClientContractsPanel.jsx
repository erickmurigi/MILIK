// Contracts register — used full-page (pages/Clients/ClientsContracts.jsx) and embedded in a
// client's detail page (`clientId` set: client filter/column hidden, New Contract pre-selects the client).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { FaEye, FaEdit, FaFilePdf, FaPlus, FaSearch, FaTimes } from 'react-icons/fa';
import MilikTable from '../../common/MilikTable';
import ListToolbar from '../../common/ListToolbar';
import AppSelect from '../../common/AppSelect';
import PaginationBar from '../../PaginationBar';
import useDebounce from '../../../hooks/useDebounce';
import { fmtDate } from '../../../utils/dates';
import { hasCompanyPermission } from '../../../utils/permissions';
import { selectCurrentCompany, selectCurrentUser } from '../../../redux/selectors';
import { contractsApi, apiError } from '../../../services/clientsBillingApi';
import { Chip, StatusPill, cell, cellLast, numCell, iconBtn } from './BillingUi';
import {
  CONTRACT_STATUS_OPTIONS, CONTRACT_TYPE_OPTIONS, FREQUENCY_MONTHS, PAGE_SIZES, RENEWAL_STAGES,
  addMonthsIso, daysUntil, money, optionLabel, todayIso, useBillingClients, useBillingUsers, useServerList,
} from './billingShared';

const EXPIRING_OPTIONS = [
  { value: '30', label: 'Expiring ≤ 30d' },
  { value: '60', label: 'Expiring ≤ 60d' },
  { value: '90', label: 'Expiring ≤ 90d' },
];

// The list endpoint carries no schedule data, so the next billing date is estimated from the
// contract's shortest billing cycle (anchor = billing day or start date). The detail page's
// billing schedule tab is authoritative.
const estimateNextBill = (c) => {
  if (!['active', 'pending_renewal'].includes(c.status) || !c.startDate) return null;
  const months = Math.min(...(c.lines?.length ? c.lines : [{ billingFrequency: 'monthly' }])
    .map((l) => FREQUENCY_MONTHS[l.billingFrequency] || 0).filter(Boolean));
  if (!Number.isFinite(months)) return null;
  let anchor = String(c.startDate).slice(0, 10);
  if (c.billingDay) anchor = `${anchor.slice(0, 8)}${String(c.billingDay).padStart(2, '0')}`;
  const today = todayIso();
  let next = anchor;
  for (let i = 0; next < today && i < 600; i += 1) next = addMonthsIso(anchor, months * (i + 1));
  const end = c.openEnded || !c.endDate ? null : String(c.endDate).slice(0, 10);
  return end && next > end ? null : next;
};

const renewalLabel = (stage) => RENEWAL_STAGES.find((s) => s.value === stage)?.label || '';

const summaryCache = new Map();

const ClientContractsPanel = ({ clientId = '', embedded = false }) => {
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const company = useSelector(selectCurrentCompany);
  const businessId = company?._id || '';
  const canCreate = hasCompanyPermission(user, company, 'clients', 'create');
  const canEdit = hasCompanyPermission(user, company, 'clients', 'edit');
  const { options: clientOptions } = useBillingClients(embedded ? '' : businessId);
  const ownerOptions = useBillingUsers(businessId);

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput.trim(), 400);
  const [status, setStatus] = useState('');
  const [contractType, setContractType] = useState('');
  const [clientPick, setClientPick] = useState('');
  const client = clientId || clientPick;
  const [owner, setOwner] = useState('');
  const [expiring, setExpiring] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Any filter change goes back to page 1.
  const filterKey = `${search}|${status}|${contractType}|${client}|${owner}|${expiring}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) { setLastFilterKey(filterKey); setPage(1); }

  const params = useMemo(() => {
    const p = { page, limit };
    if (search) p.search = search;
    if (status) p.status = status;
    if (contractType) p.contractType = contractType;
    if (client) p.clientId = client;
    if (owner) p.owner = owner;
    if (expiring) p.expiringDays = expiring;
    return p;
  }, [page, limit, search, status, contractType, client, owner, expiring]);

  const pick = useCallback((res) => ({
    rows: res.data?.contracts || [],
    pagination: res.data?.pagination || { total: 0, page: 1, pages: 1 },
  }), []);
  const { rows, pagination, isFetching, error } = useServerList(`contracts:${businessId}`, contractsApi.list, params, pick);
  useEffect(() => { if (error) toast.error(error); }, [error]);

  // Header chips: three light count/sum queries, cached per business+client.
  const summaryKey = `${businessId}:${clientId}`;
  const [summary, setSummary] = useState(() => summaryCache.get(summaryKey) || null);
  useEffect(() => {
    if (!businessId) return;
    let alive = true;
    const base = clientId ? { clientId } : {};
    Promise.all([
      contractsApi.list({ ...base, status: 'active', limit: 200 }),
      contractsApi.list({ ...base, expiringDays: 60, limit: 1 }),
      contractsApi.list({ ...base, status: 'pending_approval', limit: 1 }),
    ]).then(([active, expiringRes, pending]) => {
      if (!alive) return;
      const activeRows = active.data?.contracts || [];
      const next = {
        active: active.data?.pagination?.total ?? activeRows.length,
        mrr: activeRows.reduce((s, c) => s + Number(c.mrr || 0), 0),
        renewals: expiringRes.data?.pagination?.total || 0,
        pending: pending.data?.pagination?.total || 0,
      };
      summaryCache.set(summaryKey, next);
      setSummary(next);
    }).catch(() => {});
    return () => { alive = false; };
  }, [businessId, clientId, summaryKey]);

  const openContract = useCallback((c) => navigate(`/clients/contracts/${c._id}`, { state: { tabTitle: c.contractNumber || 'Contract' } }), [navigate]);
  const newContract = () => navigate(`/clients/contracts/new${clientId ? `?clientId=${clientId}` : ''}`, { state: { tabTitle: 'New Contract' } });
  const resetFilters = () => {
    setSearchInput(''); setStatus(''); setContractType(''); setOwner(''); setExpiring('');
    setClientPick('');
  };
  const downloadPdf = async (c) => {
    try { await contractsApi.pdf(c._id, { number: c.contractNumber }); } catch (err) { toast.error(apiError(err, 'Could not download the contract PDF')); }
  };

  const columns = useMemo(() => [
    { label: 'No.', width: '12%' },
    ...(embedded ? [] : [{ label: 'Client', width: '17%' }]),
    { label: 'Type', width: '9%' },
    { label: 'Start – End', width: embedded ? '18%' : '15%' },
    { label: 'MRR', align: 'right', width: '9%' },
    { label: 'TCV', align: 'right', width: '10%' },
    { label: 'Next bill', width: '9%' },
    { label: 'Status', width: '10%' },
    { label: 'Renewal', width: '9%' },
  ], [embedded]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <ListToolbar>
        {summary && (
          <>
            <Chip onClick={() => setStatus(status === 'active' ? '' : 'active')} active={status === 'active'} title="Active contracts">Active: {summary.active}</Chip>
            <Chip title="Monthly recurring revenue of active contracts (net of tax)">MRR: KES {money(summary.mrr)}</Chip>
            <Chip onClick={() => setExpiring(expiring === '60' ? '' : '60')} active={expiring === '60'} title="Active contracts ending within 60 days">Renewals ≤60d: {summary.renewals}</Chip>
            <Chip onClick={() => setStatus(status === 'pending_approval' ? '' : 'pending_approval')} active={status === 'pending_approval'} title="Awaiting approval">Pending approval: {summary.pending}</Chip>
            <ListToolbar.Divider />
          </>
        )}
        <div className="relative shrink-0">
          <FaSearch className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] text-slate-400" />
          <ListToolbar.Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Contract no., description, PO…" width="w-48" className="pl-5 pr-5" />
          {searchInput && (
            <button type="button" onClick={() => setSearchInput('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><FaTimes size={8} /></button>
          )}
        </div>
        <div className="w-32 shrink-0"><AppSelect compact value={status} onChange={(v) => setStatus(v || '')} options={CONTRACT_STATUS_OPTIONS} placeholder="All statuses" clearable /></div>
        <div className="w-32 shrink-0"><AppSelect compact value={contractType} onChange={(v) => setContractType(v || '')} options={CONTRACT_TYPE_OPTIONS} placeholder="All types" clearable /></div>
        {!embedded && (
          <div className="w-44 shrink-0"><AppSelect compact value={client} onChange={(v) => setClientPick(v || '')} options={clientOptions} placeholder="All clients" searchable clearable /></div>
        )}
        <div className="w-32 shrink-0"><AppSelect compact value={owner} onChange={(v) => setOwner(v || '')} options={ownerOptions} placeholder="Any owner" searchable clearable /></div>
        <div className="w-32 shrink-0"><AppSelect compact value={expiring} onChange={(v) => setExpiring(v || '')} options={EXPIRING_OPTIONS} placeholder="Any end date" clearable /></div>
        <ListToolbar.Divider />
        <ListToolbar.Button variant="outline" onClick={resetFilters}>Reset</ListToolbar.Button>
        {canCreate && (
          <>
            <ListToolbar.Divider />
            <ListToolbar.Button icon={FaPlus} onClick={newContract}>New Contract</ListToolbar.Button>
          </>
        )}
      </ListToolbar>

      <MilikTable
        columns={columns}
        rows={rows}
        loading={isFetching && rows.length === 0}
        empty={embedded ? 'No contracts for this client yet.' : 'No contracts match these filters.'}
        tableFixed
        minWidth={980}
        onRowClick={openContract}
        actionsWidth="80px"
        renderRow={(c) => {
          const days = c.openEnded ? null : daysUntil(c.endDate);
          const nextBill = estimateNextBill(c);
          return (
            <>
              <td className={cell}>
                <span className="font-bold text-[#0B3B2E]">{c.contractNumber || '—'}</span>
                {c.version > 1 && <span className="ml-1 text-[10px] font-semibold text-slate-500">v{c.version}</span>}
                {c.description && <span className="block truncate text-[10px] text-slate-500">{c.description}</span>}
              </td>
              {!embedded && (
                <td className={cell}>
                  <span className="block truncate font-semibold text-slate-900">{c.client?.name || '—'}</span>
                  {c.owner && <span className="block truncate text-[10px] text-slate-500">{[c.owner.surname, c.owner.otherNames].filter(Boolean).join(' ')}</span>}
                </td>
              )}
              <td className={`${cell} text-slate-700`}>{optionLabel(CONTRACT_TYPE_OPTIONS, c.contractType)}</td>
              <td className={`${cell} whitespace-nowrap text-slate-700`}>
                {fmtDate(c.startDate)} – {c.openEnded || !c.endDate ? <span className="font-semibold text-slate-900">Open-ended</span> : fmtDate(c.endDate)}
                {days != null && days >= 0 && days <= 60 && ['active', 'pending_renewal'].includes(c.status) && (
                  <span className={`block text-[10px] font-bold ${days <= 30 ? 'text-red-600' : 'text-amber-600'}`}>{days}d left</span>
                )}
              </td>
              <td className={numCell}>{money(c.mrr)}</td>
              <td className={`${numCell} font-bold text-slate-900`}>{money(c.tcv)}</td>
              <td className={`${cell} whitespace-nowrap text-slate-700`} title="Estimated from the billing cycle — see the contract's billing schedule">{nextBill ? fmtDate(nextBill) : '—'}</td>
              <td className={cell}><StatusPill status={c.status} /></td>
              <td className={cellLast}>{c.renewalStage ? <StatusPill status={c.renewalStage === 'lost' ? 'rejected' : c.renewalStage === 'renewed' ? 'renewed' : 'pending'} label={renewalLabel(c.renewalStage)} /> : <span className="text-slate-400">—</span>}</td>
            </>
          );
        }}
        renderActions={(c) => (
          <div className="flex justify-end gap-0.5">
            <button type="button" className={iconBtn} title="Open contract" onClick={() => openContract(c)}><FaEye size={12} /></button>
            {canEdit && ['draft', 'pending_approval'].includes(c.status) && (
              <button type="button" className={iconBtn} title="Edit draft" onClick={() => navigate(`/clients/contracts/${c._id}/edit`, { state: { tabTitle: `Edit ${c.contractNumber}` } })}><FaEdit size={12} /></button>
            )}
            <button type="button" className={iconBtn} title="Download PDF" onClick={() => downloadPdf(c)}><FaFilePdf size={12} /></button>
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
        onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
        loading={isFetching}
        label="contracts"
      />
    </div>
  );
};

export default ClientContractsPanel;
