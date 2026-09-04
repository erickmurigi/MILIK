import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaFileContract, FaSearch, FaTimes } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';
import { fmtDate } from '../../utils/dates';
import StatusBadge from '../../components/common/StatusBadge';
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(Number(n) || 0);

const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));

const STATUS_TABS = [
  { value: '',               label: 'All' },
  { value: 'active',         label: 'Active' },
  { value: 'draft',          label: 'Draft' },
  { value: 'pending_renewal',label: 'Pending Renewal' },
  { value: 'renewed',        label: 'Renewed' },
  { value: 'terminated',     label: 'Terminated' },
];

const CONTRACT_STATUS_MAP = {
  active:          'border-emerald-200 bg-emerald-50 text-emerald-700',
  draft:           'border-slate-200 bg-slate-50 text-slate-600',
  pending_renewal: 'border-amber-200 bg-amber-50 text-amber-700',
  renewed:         'border-blue-200 bg-blue-50 text-blue-700',
  terminated:      'border-red-200 bg-red-50 text-red-600',
};

const daysColor = (days) => {
  if (days < 0)   return 'text-red-700 font-bold';
  if (days <= 30) return 'text-red-600 font-bold';
  if (days <= 60) return 'text-amber-600 font-semibold';
  return 'text-slate-500';
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const ClientsContracts = () => {
  const navigate  = useNavigate();
  const [contracts, setContracts]         = useState([]);
  const [pagination, setPagination]       = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]             = useState(true);
  const [statusFilter, setStatusFilter]   = useState('');
  const [expiringOnly, setExpiringOnly]   = useState(false);
  const [search, setSearch]               = useState('');
  const [searchInput, setSearchInput]     = useState('');
  const [page, setPage]                   = useState(1);
  const [limit, setLimit]                 = useState(25);
  const [activating, setActivating]       = useState({});
  const [terminating, setTerminating]     = useState({});
  const searchTimerRef                    = useRef(null);

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter)  params.status      = statusFilter;
      if (expiringOnly)  params.expiringDays = 60;
      if (search)        params.search       = search;
      const { data } = await clientsApi.listContracts(params);
      setContracts(data?.contracts || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, expiringOnly, search]);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);

  const handleSearchInput = (v) => {
    setSearchInput(v);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearch(v);
      setPage(1);
    }, 400);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  const handleActivate = async (c) => {
    setActivating((p) => ({ ...p, [c._id]: true }));
    try {
      await clientsApi.activateContract(c._id);
      toast.success('Contract activated');
      fetchContracts();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to activate contract');
    } finally {
      setActivating((p) => ({ ...p, [c._id]: false }));
    }
  };

  const handleTerminate = async (c) => {
    const reason = window.prompt(`Reason for terminating contract ${c.contractNumber || ''}? (optional)`);
    if (reason === null) return; // user cancelled the prompt
    setTerminating((p) => ({ ...p, [c._id]: true }));
    try {
      await clientsApi.terminateContract(c._id, { lostReason: reason.trim() });
      toast.success('Contract terminated');
      fetchContracts();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to terminate contract');
    } finally {
      setTerminating((p) => ({ ...p, [c._id]: false }));
    }
  };

  const pages = pagination.pages || 1;

  return (
    <ClientsShell
      title="All Contracts"
      action={
        <button
          type="button"
          onClick={() => navigate('/clients')}
          className="inline-flex h-7 items-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 px-3 text-xs font-semibold rounded"
        >
          ← Clients
        </button>
      }
    >
      <div className="flex flex-col h-full bg-white">

        {/* ── Filters ──────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-1.5">
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto">
            <div className="relative w-52 shrink-0">
              <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Search contract # or description…"
                className="h-7 w-full rounded border border-slate-200 pl-7 pr-6 text-xs focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/30"
              />
              {searchInput && (
                <button type="button" onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <FaTimes size={9} />
                </button>
              )}
            </div>

            <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />

            <div className="flex shrink-0 items-center gap-1">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                  className={`h-7 shrink-0 rounded px-2.5 text-[11px] font-semibold transition-colors ${
                    statusFilter === tab.value
                      ? 'bg-[#0B3B2E] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-200" />

            <label className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={expiringOnly}
                onChange={(e) => { setExpiringOnly(e.target.checked); setPage(1); }}
                className="rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
              />
              Expiring in 60 days
            </label>

            <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-400">
              {pagination.total || 0} contract{(pagination.total || 0) !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        <MilikTable
          columns={[
            { label: 'Contract #' },
            { label: 'Client' },
            { label: 'Description' },
            { label: 'Period' },
            { label: 'Value (KES)' },
            { label: 'Billing' },
            { label: 'Expires' },
            { label: 'Status' },
          ]}
          rows={contracts}
          loading={loading}
          empty="No contracts found"
          renderRow={(c) => {
            const days = c.endDate ? daysUntil(c.endDate) : null;
            return (
              <>
                <td className="px-3 py-2.5 font-mono text-[11px] text-[#0B3B2E]">
                  {c.contractNumber || c._id?.slice(-6).toUpperCase()}
                </td>
                <td
                  className="px-3 py-2.5 font-semibold text-slate-800 cursor-pointer hover:text-[#0B3B2E]"
                  onClick={() => navigate(`/clients/${c.client?._id || c.client}`, { state: { tabTitle: c.client?.name } })}
                >
                  {c.client?.name || '—'}
                </td>
                <td className="px-3 py-2.5 max-w-[160px] truncate text-slate-600">
                  {c.description || '—'}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">
                  {fmtDate(c.startDate)} –{' '}
                  {c.openEnded || !c.endDate
                    ? <span className="font-semibold text-emerald-700">Ongoing</span>
                    : fmtDate(c.endDate)}
                </td>
                <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-700">
                  {fmtKES(c.currentValue || c.baseValue)}
                </td>
                <td className="px-3 py-2.5 capitalize text-slate-500">{c.billingCycle || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {(c.status === 'active' || c.status === 'pending_renewal') && days !== null ? (
                    <span className={`tabular-nums text-[11px] ${daysColor(days)}`}>
                      {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={c.status} map={CONTRACT_STATUS_MAP} />
                </td>
              </>
            );
          }}
          renderActions={(c) => (
            <div className="flex flex-wrap items-center gap-1">
              {c.status === 'draft' && (
                <button
                  type="button"
                  onClick={() => handleActivate(c)}
                  disabled={activating[c._id]}
                  className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-0.5 rounded text-[10px] font-semibold disabled:opacity-50"
                >
                  {activating[c._id] ? '…' : 'Activate'}
                </button>
              )}
              {(c.status === 'active' || c.status === 'draft' || c.status === 'pending_renewal') && (
                <button
                  type="button"
                  onClick={() => navigate(`/clients/${c.client?._id || c.client}`, { state: { tabTitle: c.client?.name } })}
                  className="border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded text-[10px] font-semibold"
                >
                  View
                </button>
              )}
              {(c.status === 'active' || c.status === 'draft' || c.status === 'pending_renewal') && (
                <button
                  type="button"
                  onClick={() => handleTerminate(c)}
                  disabled={terminating[c._id]}
                  className="border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 px-2 py-0.5 rounded text-[10px] font-semibold disabled:opacity-50"
                >
                  {terminating[c._id] ? '…' : 'Terminate'}
                </button>
              )}
            </div>
          )}
        />

        {/* ── Pagination ─────────────────────────────────────────────────────── */}
        <PaginationBar
          page={page}
          pages={pages}
          total={pagination.total || 0}
          pageSize={limit}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setLimit(n); setPage(1); }}
          loading={loading}
          label="contracts"
        />
      </div>
    </ClientsShell>
  );
};

export default ClientsContracts;
