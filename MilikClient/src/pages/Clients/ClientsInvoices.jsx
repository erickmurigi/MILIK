import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaFileInvoice, FaSearch, FaTimes } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';
import { fmtDate } from '../../utils/dates';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/PaginationBar';
import MilikTable from '../../components/common/MilikTable';
import RecordClientPaymentModal from '../../components/Modals/RecordClientPaymentModal';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtKES = (n) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 2 }).format(Number(n) || 0);

const STATUS_TABS = [
  { value: '',          label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'partial',   label: 'Partial' },
  { value: 'paid',      label: 'Paid' },
  { value: 'overdue',   label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
];

const invoiceStatusBadge = (status) => {
  const map = {
    draft:     'bg-slate-50 text-slate-600 border-slate-200',
    sent:      'bg-blue-50 text-blue-700 border-blue-200',
    partial:   'bg-amber-50 text-amber-700 border-amber-200',
    paid:      'bg-emerald-50 text-emerald-700 border-emerald-200',
    overdue:   'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-slate-50 text-slate-400 border-slate-200',
  };
  return map[status] || 'bg-slate-50 text-slate-500 border-slate-200';
};


// ─── Main ─────────────────────────────────────────────────────────────────────

const ClientsInvoices = () => {
  const navigate  = useNavigate();
  const confirm   = useConfirm();
  const [invoices, setInvoices]         = useState([]);
  const [pagination, setPagination]     = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');
  const [searchInput, setSearchInput]   = useState('');
  const [page, setPage]                 = useState(1);
  const [limit, setLimit]               = useState(25);
  const [sending, setSending]           = useState({});
  const [cancelling, setCancelling]     = useState({});
  const [markPaidTarget, setMarkPaidTarget] = useState(null);
  const searchTimerRef                  = useRef(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (statusFilter) params.status = statusFilter;
      if (search)       params.search = search;
      const { data } = await clientsApi.listInvoices(params);
      setInvoices(data?.invoices || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, search]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

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

  const handleCancel = async (inv) => {
    if (!(await confirm({ title: 'Cancel Invoice', message: 'Cancel this invoice? This cannot be undone.', confirmText: 'Cancel Invoice', isDangerous: true }))) return;
    setCancelling((p) => ({ ...p, [inv._id]: true }));
    try {
      await clientsApi.cancelInvoice(inv._id);
      toast.success('Invoice cancelled');
      fetchInvoices();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to cancel invoice');
    } finally {
      setCancelling((p) => ({ ...p, [inv._id]: false }));
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

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-2 py-1.5">
          <div className="filter-bar flex items-center gap-1.5 overflow-x-auto">
            <div className="relative w-52 shrink-0">
              <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder="Search invoice #…"
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

            <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-400">
              {pagination.total || 0} invoice{(pagination.total || 0) !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────────────────────── */}
        <MilikTable
          columns={[
            { label: 'Invoice #' },
            { label: 'Client' },
            { label: 'Issue Date' },
            { label: 'Due Date' },
            { label: 'Total' },
            { label: 'Paid' },
            { label: 'Balance' },
            { label: 'Status' },
          ]}
          rows={invoices}
          loading={loading}
          empty="No invoices found"
          renderRow={(inv) => {
            const balance = (inv.total || 0) - (inv.paidAmount || 0);
            return (
              <>
                <td className="px-3 py-2.5 font-mono text-[11px] text-[#0B3B2E]">
                  {inv.invoiceNumber || inv._id?.slice(-6).toUpperCase()}
                </td>
                <td
                  className="px-3 py-2.5 font-semibold text-slate-800 cursor-pointer hover:text-[#0B3B2E]"
                  onClick={() => navigate(`/clients/${inv.client?._id || inv.client}`, { state: { tabTitle: inv.client?.name } })}
                >
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
              </>
            );
          }}
          renderActions={(inv) => (
            <div className="flex flex-wrap items-center gap-1">
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
              {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                <button
                  type="button"
                  onClick={() => setMarkPaidTarget(inv)}
                  className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 px-2 py-0.5 rounded text-[10px] font-semibold"
                >
                  Record Payment
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate(`/clients/invoices/${inv._id}/print`)}
                className="border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 px-2 py-0.5 rounded text-[10px] font-semibold"
              >
                Print
              </button>
              {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                <button
                  type="button"
                  onClick={() => handleCancel(inv)}
                  disabled={cancelling[inv._id]}
                  className="border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 px-2 py-0.5 rounded text-[10px] font-semibold disabled:opacity-50"
                >
                  {cancelling[inv._id] ? '…' : 'Cancel'}
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
          label="invoices"
        />
      </div>

      {markPaidTarget && (
        <RecordClientPaymentModal
          invoice={markPaidTarget}
          onClose={() => setMarkPaidTarget(null)}
          onRecorded={fetchInvoices}
        />
      )}
    </ClientsShell>
  );
};

export default ClientsInvoices;
