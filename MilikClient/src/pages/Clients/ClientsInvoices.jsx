import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaFileInvoice } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(Number(n) || 0);

const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_TABS = [
  { value: '',          label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'paid',      label: 'Paid' },
  { value: 'overdue',   label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

const invoiceStatusBadge = (status) => {
  const map = {
    draft:     'bg-slate-50 text-slate-600 border-slate-200',
    sent:      'bg-blue-50 text-blue-700 border-blue-200',
    paid:      'bg-emerald-50 text-emerald-700 border-emerald-200',
    overdue:   'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-slate-50 text-slate-400 border-slate-200',
  };
  return map[status] || 'bg-slate-50 text-slate-500 border-slate-200';
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const ClientsInvoices = () => {
  const navigate   = useNavigate();
  const [invoices, setInvoices]       = useState([]);
  const [pagination, setPagination]   = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]               = useState(1);
  const [sending, setSending]         = useState({});
  const limit                         = 25;

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter) params.status = statusFilter;
      const { data } = await clientsApi.listInvoices(params);
      setInvoices(data?.invoices || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const handleSend = async (inv) => {
    setSending((p) => ({ ...p, [inv._id]: true }));
    try {
      await clientsApi.sendInvoice(inv._id);
      toast.success('Invoice sent');
      fetchInvoices();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to send invoice');
    } finally {
      setSending((p) => ({ ...p, [inv._id]: false }));
    }
  };

  const pages = pagination.pages || 1;

  return (
    <ClientsShell
      title="All Invoices"
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

        {/* ── Status tabs ─────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between">
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
            <span className="text-[10px] text-slate-400 ml-2">
              {pagination.total || 0} invoice{(pagination.total || 0) !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#0B3B2E] text-white text-[10px]">
                {['Invoice #', 'Client', 'Issue Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Status', 'Action'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-black uppercase tracking-widest whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-sm text-slate-400">Loading invoices…</td>
                </tr>
              ) : !invoices.length ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <FaFileInvoice className="mx-auto mb-2 text-slate-300" size={24} />
                    <p className="text-sm font-semibold text-slate-500">No invoices found</p>
                  </td>
                </tr>
              ) : (
                invoices.map((inv, idx) => {
                  const balance = (inv.total || 0) - (inv.paidAmount || 0);
                  return (
                    <tr
                      key={inv._id}
                      className={`hover:bg-emerald-50/30 cursor-pointer transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
                      onClick={() => navigate(`/clients/${inv.client?._id || inv.client}`)}
                    >
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[#0B3B2E]">
                        {inv.invoiceNumber || inv._id?.slice(-6).toUpperCase()}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800">
                        {inv.client?.name || '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(inv.issueDate)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{fmtDate(inv.dueDate)}</td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-700">
                        {fmtKES(inv.total)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-emerald-700">{fmtKES(inv.paidAmount || 0)}</td>
                      <td className={`px-3 py-2.5 tabular-nums font-semibold ${balance > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {fmtKES(balance)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${invoiceStatusBadge(inv.status)}`}>
                          {inv.status || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {(inv.status === 'draft' || inv.status === 'sent') && (
                          <button
                            type="button"
                            onClick={() => handleSend(inv)}
                            disabled={sending[inv._id]}
                            className="border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 px-2 py-0.5 rounded text-[10px] font-semibold disabled:opacity-50"
                          >
                            {sending[inv._id] ? '…' : 'Send'}
                          </button>
                        )}
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

export default ClientsInvoices;
