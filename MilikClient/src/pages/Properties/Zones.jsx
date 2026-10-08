import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import {
  FaPlus, FaEdit, FaTrash, FaSearch, FaRedoAlt,
  FaTimes, FaSave, FaToggleOn, FaToggleOff,
} from 'react-icons/fa';
import { toast } from "react-toastify";
import DashboardLayout from '../../components/Layout/DashboardLayout';
import ListToolbar from '../../components/common/ListToolbar';
import AppSelect from '../../components/common/AppSelect';
import MilikTable from '../../components/common/MilikTable';
import { adminRequests } from '../../utils/requestMethods';
import PaginationBar from '../../components/PaginationBar';
import { useTerm } from '../../hooks/useTerm';

// ── constants ────────────────────────────────────────────────────────────────
const ZONE_COLORS = [
  '#0B3B2E', '#1D6A4E', '#2D9CDB', '#F2994A', '#EB5757',
  '#9B51E0', '#F2C94C', '#219653', '#56CCF2', '#E67E00',
];

const TYPE_OPTIONS = [
  { value: 'geographic',  label: 'Geographic'  },
  { value: 'performance', label: 'Performance' },
  { value: 'portfolio',   label: 'Portfolio'   },
  { value: 'other',       label: 'Other'       },
];

const TYPE_BADGE = {
  geographic:  'bg-blue-100 text-blue-700 border-blue-200',
  performance: 'bg-amber-100 text-amber-700 border-amber-200',
  portfolio:   'bg-purple-100 text-purple-700 border-purple-200',
  other:       'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_OPTIONS = [
  { value: 'active',   label: 'Active'   },
  { value: 'inactive', label: 'Inactive' },
];

// The officers dropdown (zone supervisors) is reference data unrelated to the zones
// grid's own filters/pagination — it was being refetched from scratch on every visit
// to this tab. A small module-level cache (survives the tab remount) keeps a revisit
// within the window instant instead of waiting on another round trip.
const OFFICERS_STALE_MS = 30_000;
let officersCache = { officers: [], loadedAt: 0 };

const EMPTY_FORM = {
  name: '', code: '', description: '', type: 'geographic',
  color: '#0B3B2E', fieldOfficers: [], supervisors: [],
};

// ── helpers ──────────────────────────────────────────────────────────────────
const userName = (u) => `${u?.surname || ''} ${u?.otherNames || ''}`.trim() || u?.email || 'User';

// ── ColorPicker ───────────────────────────────────────────────────────────────
const ColorPicker = ({ value, onChange }) => (
  <div className="flex flex-wrap gap-2 mt-1">
    {ZONE_COLORS.map((c) => (
      <button
        key={c}
        type="button"
        onClick={() => onChange(c)}
        className={`h-6 w-6 rounded-full border-2 transition ${value === c ? 'border-slate-800 scale-110' : 'border-transparent'}`}
        style={{ backgroundColor: c }}
      />
    ))}
  </div>
);

// ── OfficerMultiSelect ────────────────────────────────────────────────────────
const OfficerMultiSelect = ({ label, value, options, onChange }) => {
  const selected = useMemo(() => options.filter((o) => value.includes(o._id)), [options, value]);
  const available = useMemo(() => options.filter((o) => !value.includes(o._id)), [options, value]);
  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
        {label}
      </label>
      <AppSelect
        value=""
        onChange={(id) => id && !value.includes(id) && onChange([...value, id])}
        options={available.map((u) => ({ value: u._id, label: userName(u) }))}
        placeholder={`Add ${label.toLowerCase()}…`}
        searchable
        size="sm"
      />
      {selected.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {selected.map((u) => (
            <span
              key={u._id}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
            >
              {userName(u)}
              <button
                type="button"
                onClick={() => onChange(value.filter((id) => id !== u._id))}
                className="text-slate-400 hover:text-red-500"
              >
                <FaTimes size={8} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ── ZoneFormModal ─────────────────────────────────────────────────────────────
const ZoneFormModal = ({ zone, officers, onClose, onSaved }) => {
  const isEditing = Boolean(zone?._id);
  const [form, setForm] = useState(() => {
    if (!zone) return { ...EMPTY_FORM };
    return {
      name:          zone.name          || '',
      code:          zone.code          || '',
      description:   zone.description   || '',
      type:          zone.type          || 'geographic',
      color:         zone.color         || '#0B3B2E',
      fieldOfficers: (zone.fieldOfficers || []).map((u) => u._id || u),
      supervisors:   (zone.supervisors   || []).map((u) => u._id || u),
    };
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Zone name is required'); return; }
    setSaving(true);
    try {
      if (isEditing) {
        await adminRequests.put(`/zones/${zone._id}`, form);
        toast.success('Zone updated');
      } else {
        await adminRequests.post('/zones', form);
        toast.success('Zone created');
      }
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save zone');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
        {/* Modal header */}
        <div className="flex-shrink-0 flex items-center justify-between gap-3 border-b border-[#0a3127] bg-[#0B3B2E] px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full border border-white/30 flex-shrink-0"
              style={{ backgroundColor: form.color }}
            />
            <h2 className="text-sm font-black uppercase tracking-wide">
              {isEditing ? 'Edit Zone' : 'New Zone'}
            </h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <FaTimes size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Name + Code */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
                  Zone Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Nairobi West"
                  className="h-8 w-full border border-slate-300 px-3 text-xs focus:outline-none focus:border-[#0B3B2E]"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">
                  Code <span className="text-slate-400 font-normal normal-case">(auto if blank)</span>
                </label>
                <input
                  value={form.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                  placeholder="ZN-001"
                  className="h-8 w-full border border-slate-300 px-3 text-xs font-mono focus:outline-none focus:border-[#0B3B2E]"
                />
              </div>
            </div>

            {/* Type */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Type</label>
              <AppSelect
                value={form.type}
                onChange={(v) => set('type', v ?? 'geographic')}
                options={TYPE_OPTIONS}
                size="sm"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={2}
                placeholder="Optional notes about this zone…"
                className="w-full border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:border-[#0B3B2E] resize-none"
              />
            </div>

            {/* Color */}
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-slate-600 mb-1">Zone Colour</label>
              <ColorPicker value={form.color} onChange={(c) => set('color', c)} />
            </div>

            {/* People */}
            <div className="border border-slate-200 bg-slate-50/60 p-3 space-y-3">
              <OfficerMultiSelect
                label="Field Officers"
                value={form.fieldOfficers}
                options={officers}
                onChange={(v) => set('fieldOfficers', v)}
              />
              <OfficerMultiSelect
                label="Supervisors"
                value={form.supervisors}
                options={officers}
                onChange={(v) => set('supervisors', v)}
              />
            </div>
          </div>

          {/* Modal footer */}
          <div className="flex-shrink-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60"
            >
              <FaSave size={10} />
              {saving ? 'Saving…' : isEditing ? 'Update Zone' : 'Create Zone'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Zones() {
  const confirm = useConfirm();
  const termProperties = useTerm("properties");
  const [zones,    setZones]    = useState([]);
  const [total,    setTotal]    = useState(0);
  const [pages,    setPages]    = useState(1);
  const [officers, setOfficers] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [modalZone, setModalZone] = useState(null); // null=closed, false=new, obj=edit

  // draft filters
  const [draftSearch, setDraftSearch] = useState('');
  const [draftType,   setDraftType]   = useState('');
  const [draftStatus, setDraftStatus] = useState('');

  // applied filters
  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const loadZones = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (search)       params.search   = search;
      if (typeFilter)   params.type     = typeFilter;
      if (statusFilter) params.isActive = statusFilter === 'active' ? 'true' : 'false';
      const res = await adminRequests.get('/zones', { params });
      setZones(res.data?.zones || []);
      setTotal(res.data?.total || 0);
      setPages(res.data?.pages || 1);
    } catch {
      toast.error('Failed to load zones');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, typeFilter, statusFilter]);

  const loadOfficers = useCallback(async () => {
    if (Date.now() - officersCache.loadedAt < OFFICERS_STALE_MS) {
      setOfficers(officersCache.officers);
      return;
    }
    try {
      const res = await adminRequests.get('/zones/officers', { params: { limit: 500 } });
      const users = res.data?.users || [];
      setOfficers(users);
      officersCache = { officers: users, loadedAt: Date.now() };
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadZones(); },   [loadZones]);
  useEffect(() => { loadOfficers(); }, [loadOfficers]);

  const applyFilters = () => {
    setSearch(draftSearch);
    setTypeFilter(draftType);
    setStatusFilter(draftStatus);
    setPage(1);
  };

  const resetFilters = () => {
    setDraftSearch(''); setDraftType(''); setDraftStatus('');
    setSearch('');      setTypeFilter(''); setStatusFilter('');
    setPage(1);
  };

  const onEnter = (e) => { if (e.key === 'Enter') applyFilters(); };

  const handleToggle = async (zone) => {
    try {
      await adminRequests.put(`/zones/${zone._id}`, { isActive: !zone.isActive });
      toast.success(`Zone ${zone.isActive ? 'deactivated' : 'activated'}`);
      loadZones();
    } catch {
      toast.error('Failed to update zone');
    }
  };

  const handleDelete = async (zone) => {
    if (!await confirm({ message: `Delete zone "${zone.name}"? This cannot be undone.`, confirmText: "Delete", isDangerous: true })) return;
    setDeleting(zone._id);
    try {
      await adminRequests.delete(`/zones/${zone._id}`);
      toast.success('Zone deleted');
      loadZones();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete zone');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex flex-col h-full min-h-0 p-0 bg-white overflow-hidden">

        {/* Toolbar */}
        <ListToolbar>
          <ListToolbar.Input
            width="w-40"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            onKeyDown={onEnter}
            placeholder="Name or code…"
          />
          <AppSelect
            value={draftType}
            onChange={(v) => setDraftType(v ?? '')}
            options={TYPE_OPTIONS}
            placeholder="All Types"
            clearable
            compact
          />
          <AppSelect
            value={draftStatus}
            onChange={(v) => setDraftStatus(v ?? '')}
            options={STATUS_OPTIONS}
            placeholder="All Status"
            clearable
            compact
          />
          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaSearch} variant="accent" onClick={applyFilters}>
            Search
          </ListToolbar.Button>
          <ListToolbar.Button icon={FaRedoAlt} onClick={resetFilters}>
            Reset
          </ListToolbar.Button>
          <ListToolbar.Divider />
          <ListToolbar.Button icon={FaPlus} onClick={() => setModalZone(false)}>
            Add Zone
          </ListToolbar.Button>
        </ListToolbar>

        {/* Table card */}
        <div className="flex-1 min-h-0 px-2 pb-2 overflow-hidden">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm h-full flex flex-col overflow-hidden">

            <MilikTable
              tableFixed
              columns={[
                { label: '#', align: 'center', width: '36px' },
                { label: 'Clr', align: 'center', width: '36px' },
                { label: 'Name / Code' },
                { label: 'Type', width: '110px' },
                { label: termProperties, align: 'center', width: '80px' },
                { label: 'Officers', align: 'center', width: '76px' },
                { label: 'Supervisors', align: 'center', width: '80px' },
                { label: 'Status', align: 'center', width: '76px' },
              ]}
              rows={zones}
              rowKey="_id"
              loading={loading}
              empty={search || typeFilter || statusFilter ? 'No zones match your filters' : 'No zones yet — create your first zone to start grouping properties'}
              actionsWidth="86px"
              renderActions={(zone) => (
                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => setModalZone(zone)}
                    title="Edit"
                    className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-500 hover:border-[#0B3B2E] hover:text-[#0B3B2E] transition-colors"
                  >
                    <FaEdit size={9} />
                  </button>
                  <button
                    onClick={() => handleToggle(zone)}
                    title={zone.isActive ? 'Deactivate' : 'Activate'}
                    className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${zone.isActive ? 'border-amber-200 text-amber-500 hover:border-amber-500 hover:text-amber-700' : 'border-emerald-200 text-emerald-500 hover:border-emerald-600 hover:text-emerald-700'}`}
                  >
                    {zone.isActive ? <FaToggleOff size={9} /> : <FaToggleOn size={9} />}
                  </button>
                  <button
                    onClick={() => handleDelete(zone)}
                    disabled={deleting === zone._id}
                    title="Delete"
                    className="flex h-6 w-6 items-center justify-center rounded border border-red-200 text-red-400 hover:border-red-500 hover:text-red-600 transition-colors disabled:opacity-40"
                  >
                    <FaTrash size={9} />
                  </button>
                </div>
              )}
              renderRow={(zone, idx) => (
                <>
                  <td className="px-3 py-1.5 text-center text-slate-400 font-mono border-r border-gray-100">
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100">
                    <span
                      className="inline-block h-4 w-4 rounded-full"
                      style={{ backgroundColor: zone.color || '#0B3B2E' }}
                    />
                  </td>
                  <td className="px-3 py-1 border-r border-gray-100 overflow-hidden">
                    <span className="font-semibold text-slate-900 truncate block">{zone.name}</span>
                    <span className="font-mono text-[10px] text-slate-400 tracking-wide">{zone.code}</span>
                  </td>
                  <td className="px-3 py-1.5 border-r border-gray-100">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${TYPE_BADGE[zone.type] || TYPE_BADGE.other}`}>
                      {TYPE_OPTIONS.find((t) => t.value === zone.type)?.label || zone.type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100 font-semibold text-slate-700">
                    {zone.propertyCount || 0}
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100 font-semibold text-slate-700">
                    {(zone.fieldOfficers || []).length}
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100 font-semibold text-slate-700">
                    {(zone.supervisors || []).length}
                  </td>
                  <td className="px-3 py-1.5 text-center border-r border-gray-100">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${zone.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {zone.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </>
              )}
            />

            {/* Pagination footer */}
            <PaginationBar
              page={page}
              pages={pages}
              total={total}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              loading={loading}
              label="zones"
            />
          </div>
        </div>
      </div>

      {/* Add / Edit modal */}
      {modalZone !== null && (
        <ZoneFormModal
          zone={modalZone || null}
          officers={officers}
          onClose={() => setModalZone(null)}
          onSaved={() => { setModalZone(null); loadZones(); }}
        />
      )}
    </DashboardLayout>
  );
}
