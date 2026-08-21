import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaPlus, FaSearch, FaTimes, FaUser } from 'react-icons/fa';
import ClientsShell from './ClientsShell';
import { clientsApi } from '../../services/clientsApi';
import AppSelect from '../../components/common/AppSelect';
import PaginationBar from '../../components/PaginationBar';
import Modal from '../../components/common/Modal';
import { inputClass, labelClass } from '../../utils/formStyles';
import StatusBadge from '../../components/common/StatusBadge';
import MilikTable from '../../components/common/MilikTable';

const STATUS_TABS = [
  { value: 'all',      label: 'All' },
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'churned',  label: 'Churned' },
];

const CATEGORIES = ['enterprise', 'sme', 'individual'];

const SOURCES = ['referral', 'direct', 'online', 'other'];

const CLIENT_STATUS_MAP = {
  active:   'border-emerald-200 bg-emerald-50 text-emerald-700',
  inactive: 'border-amber-200 bg-amber-50 text-amber-700',
  churned:  'border-red-200 bg-red-50 text-red-600',
};


// ─── Add Client Modal ─────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  category: '',
  source: '',
  taxPin: '',
  companyRegistration: '',
  'address.line1': '',
  'address.city': '',
  notes: '',
};

const AddClientModal = ({ onClose, onCreated }) => {
  const [form, setForm]       = useState(EMPTY_FORM);
  const [saving, setSaving]   = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name:                form.name.trim(),
        email:               form.email.trim() || undefined,
        phone:               form.phone.trim() || undefined,
        category:            form.category || undefined,
        source:              form.source || undefined,
        taxPin:              form.taxPin.trim() || undefined,
        companyRegistration: form.companyRegistration.trim() || undefined,
        address: {
          line1: form['address.line1'].trim() || undefined,
          city:  form['address.city'].trim() || undefined,
        },
        notes: form.notes.trim() || undefined,
      };
      await clientsApi.create(payload);
      toast.success('Client created successfully');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Add Client"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="border border-slate-200 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-md text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="bg-[#0B3B2E] text-white hover:bg-[#027333] px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create Client'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelClass}>Name *</label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Client / company name"
            />
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <AppSelect
              size="md"
              clearable
              placeholder="Select…"
              value={form.category}
              onChange={(v) => set('category', v ?? '')}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <div>
            <label className={labelClass}>Source</label>
            <AppSelect
              size="md"
              clearable
              placeholder="Select…"
              value={form.source}
              onChange={(v) => set('source', v ?? '')}
              options={SOURCES.map((s) => ({ value: s, label: s }))}
            />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" className={inputClass} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="email@example.com" />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <input className={inputClass} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+254 7XX XXX XXX" />
          </div>
          <div>
            <label className={labelClass}>Tax PIN</label>
            <input className={inputClass} value={form.taxPin} onChange={(e) => set('taxPin', e.target.value)} placeholder="P0000000000A" />
          </div>
          <div>
            <label className={labelClass}>Company Reg #</label>
            <input className={inputClass} value={form.companyRegistration} onChange={(e) => set('companyRegistration', e.target.value)} placeholder="CPR/2024/000000" />
          </div>
          <div>
            <label className={labelClass}>Address Line 1</label>
            <input className={inputClass} value={form['address.line1']} onChange={(e) => set('address.line1', e.target.value)} placeholder="Street / P.O. Box" />
          </div>
          <div>
            <label className={labelClass}>City</label>
            <input className={inputClass} value={form['address.city']} onChange={(e) => set('address.city', e.target.value)} placeholder="Nairobi" />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Notes</label>
            <textarea
              className={`${inputClass} resize-none`}
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Any additional notes…"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const ClientsList = () => {
  const navigate     = useNavigate();
  const debounceRef  = useRef(null);

  const [clients, setClients]       = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage]             = useState(1);
  const [limit, setLimit]           = useState(20);
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (categoryFilter) params.category = categoryFilter;
      const { data } = await clientsApi.list(params);
      setClients(data?.clients || data?.data || []);
      setPagination(data?.pagination || { total: 0, page: 1, pages: 1 });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, [page, limit, debouncedSearch, statusFilter, categoryFilter]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(val);
    }, 400);
  };

  const pages = pagination.pages || Math.max(Math.ceil((pagination.total || 0) / limit), 1);

  return (
    <ClientsShell
      title="Clients"
      action={
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex h-7 items-center gap-1.5 bg-[#0B3B2E] px-3 text-xs font-bold text-white hover:bg-[#027333]"
        >
          <FaPlus size={9} /> Add Client
        </button>
      }
    >
      <div className="flex flex-col h-full bg-white">

        {/* ── Filter row ──────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 px-3 py-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={10} />
              <input
                type="text"
                placeholder="Search name, email, phone, code…"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="h-8 w-56 rounded-md border border-slate-200 bg-white pl-7 pr-7 text-xs focus:border-[#0B3B2E] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => handleSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <FaTimes size={9} />
                </button>
              )}
            </div>

            {/* Category filter */}
            <AppSelect
              size="sm"
              clearable
              placeholder="All Categories"
              value={categoryFilter}
              onChange={(v) => { setCategoryFilter(v ?? ''); setPage(1); }}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
            />

            <span className="text-[10px] text-slate-400 ml-auto">
              {pagination.total || 0} client{(pagination.total || 0) !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Status tabs */}
          <div className="flex gap-0.5">
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
        <MilikTable
          columns={[
            { label: 'Code' },
            { label: 'Name' },
            { label: 'Category' },
            { label: 'Email' },
            { label: 'Phone' },
            { label: 'Status' },
          ]}
          rows={clients}
          loading={loading}
          empty={debouncedSearch ? 'No clients match your search' : 'No clients yet'}
          onRowClick={(cl) => navigate(`/clients/${cl._id}`)}
          renderRow={(cl) => (
            <>
              <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">
                {cl.clientCode || '—'}
              </td>
              <td className="px-3 py-2.5">
                <p className="font-semibold text-slate-800">{cl.name}</p>
                {cl.companyRegistration && (
                  <p className="text-[10px] text-slate-400">{cl.companyRegistration}</p>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-600">{cl.category || '—'}</td>
              <td className="px-3 py-2.5 text-slate-600">{cl.email || '—'}</td>
              <td className="px-3 py-2.5 text-slate-600">{cl.phone || '—'}</td>
              <td className="px-3 py-2.5">
                <StatusBadge status={cl.status} map={CLIENT_STATUS_MAP} />
              </td>
            </>
          )}
          renderActions={(cl) => (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`/clients/${cl._id}`); }}
              className="border border-slate-200 text-slate-700 hover:bg-slate-50 px-2.5 py-1 rounded text-[11px] font-semibold"
            >
              View
            </button>
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
          label="clients"
        />
      </div>

      {showAddModal && (
        <AddClientModal
          onClose={() => setShowAddModal(false)}
          onCreated={fetchClients}
        />
      )}
    </ClientsShell>
  );
};

export default ClientsList;
