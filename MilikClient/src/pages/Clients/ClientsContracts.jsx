import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaFileContract, FaSearch, FaTimes } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(Number(n) || 0);

const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));

const STATUS_TABS = [
  { value: '',               label: 'All' },
  { value: 'active',         label: 'Active' },
  { value: 'draft',          label: 'Draft' },
  { value: 'pending_renewal',label: 'Pending Renewal' },
  { value: 'renewed',        label: 'Renewed' },
  { value: 'terminated',     label: 'Terminated' },
];

const statusBadge = (status) => {
  const map = {
    active:          'bg-emerald-50 text-emerald-700 border-emerald-200',
    draft:           'bg-slate-50 text-slate-600 border-slate-200',
    pending_renewal: 'bg-amber-50 text-amber-700 border-amber-200',
    renewed:         'bg-blue-50 text-blue-700 border-blue-200',
    terminated:      'bg-red-50 text-red-600 border-red-200',
  };
  return map[status] || 'bg-slate-50 text-slate-500 border-slate-200';
};

const daysColor = (days) => {
  if (days < 0)  return 'text-red-700 font-bold';
  if (days <= 30) return 'text-red-600 font-bold';
  if (days <= 60) return 'text-amber-600 font-semibold';
  return 'text-slate-500';
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const ClientsContracts = () => {
  const navigate  = useNavigate();
  const [contracts, setContracts]     = useState([]);
  const [pagination, setPagination]   = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [page, setPage]               = useState(1);
  const limit                         = 25;

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter)  params.status      = statusFilter;
      if (expiringOnly)  params.expiringDays = 60;
      const { data } = await clientsApi.listContracts(params);
      setContracts(data?.contracts || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, expiringOnly]);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);

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
        <div className="flex-shrink-0 border-b border-slate-200 px-3 py-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={expiringOnly}
                onChange={(e) => { setExpiringOnly(e.target.checked); setPage(1); }}
                className="rounded border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]"
              />
              Expiring in 60 days
            </label>
            <span className="text-[10px] text-slate-400 ml-auto">
              {pagination.total || 0} contract{(pagination.total || 0) !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex flex-wrap gap-0.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                className={`px-3 py-1 text-[11px] font-semibold rounded transition-colors ${
                  statusFilter === tab.value
                    ? 'bg-[#0B3B2E] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0B3B2E] text-white text-[10px]">
                {['Contract #', 'Client', 'Description', 'Period', 'Value (KES)', 'Billing', 'Expires', 'Status'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-black uppercase tracking-widest whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm text-slate-400">Loading contracts…</td>
                </tr>
              ) : !contracts.length ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <FaFileContract className="mx-auto mb-2 text-slate-300" size={24} />
                    <p className="text-sm font-semibold text-slate-500">No contracts found</p>
                  </td>
                </tr>
              ) : (
                contracts.map((c, idx) => {
                  const days = c.endDate ? daysUntil(c.endDate) : null;
                  return (
                    <tr
                      key={c._id}
                      className={`hover:bg-emerald-50/30 cursor-pointer transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
                      onClick={() => navigate(`/clients/${c.client?._id || c.client}`)}
                    >
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[#0B3B2E]">
                        {c.contractNumber || c._id?.slice(-6).toUpperCase()}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800">
                        {c.client?.name || '—'}
                      </td>
                      <td className="px-3 py-2.5 max-w-[160px] truncate text-slate-600">
                        {c.description || '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">
                        {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-700">
                        {fmtKES(c.currentValue || c.baseValue)}
                      </td>
                      <td className="px-3 py-2.5 capitalize text-slate-500">{c.billingCycle || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {c.status === 'active' && days !== null ? (
                          <span className={`tabular-nums text-[11px] ${daysColor(days)}`}>
                            {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadge(c.status)}`}>
                          {c.status?.replace('_', ' ') || '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex min-h-8 items-center justify-between border-t border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          <span className="normal-case text-slate-500 font-normal text-xs">{pagination.total || 0} total</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Previous
            </button>
            <span>Page {page} of {pages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(p + 1, pages))}
              disabled={page >= pages}
              className="border border-[#B7C9C0] bg-white px-3 py-1 text-[#0B3B2E] hover:bg-[#F1F6F3] disabled:cursor-not-allowed disabled:opacity-45"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </ClientsShell>
  );
};

export default ClientsContracts;
