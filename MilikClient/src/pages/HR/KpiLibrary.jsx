import React, { useCallback, useEffect, useState } from 'react';
import {
  FaPlus, FaRedoAlt, FaEdit, FaTrash, FaToggleOn, FaToggleOff,
  FaTimes, FaCheck,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const CATEGORIES = ['Performance', 'Attendance', 'Skills', 'Leadership', 'Financial', 'Customer', 'Other'];
const UNITS      = ['Percentage', 'Score', 'Count', 'KES', 'Custom'];
const CAT_COLORS = {
  Performance: 'bg-blue-50 text-blue-700 border-blue-200',
  Attendance:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  Skills:      'bg-purple-50 text-purple-700 border-purple-200',
  Leadership:  'bg-amber-50 text-amber-700 border-amber-200',
  Financial:   'bg-rose-50 text-rose-700 border-rose-200',
  Customer:    'bg-cyan-50 text-cyan-700 border-cyan-200',
  Other:       'bg-slate-50 text-slate-600 border-slate-200',
};
const PAGE_SIZE = 25;
const EMPTY = { name: '', description: '', category: 'Performance', unit: 'Score', maxScore: 100, isActive: true };
// base field style — no w-full so explicit widths always win
const F  = 'h-7 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';
const FW = `${F} w-full`;

export default function KpiLibrary() {
  const [kpis, setKpis]             = useState([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [catFilter, setCatFilter]   = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage]             = useState(1);
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(EMPTY);
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search)     params.search   = search;
      if (catFilter)  params.category = catFilter;
      if (activeOnly) params.isActive = 'true';
      const res = await adminRequests.get('/hr/kpis', { params });
      setKpis(res.data || []);
      setPage(1);
    } catch { toast.error('Failed to load KPIs'); }
    finally { setLoading(false); }
  }, [search, catFilter, activeOnly]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY); setModal('create'); };
  const openEdit   = (k)  => { setForm({ ...k }); setModal(k); };
  const closeModal = () => { setModal(null); setSaving(false); };

  const handleSave = async () => {
    if (!form.name?.trim()) return toast.error('KPI name is required');
    setSaving(true);
    try {
      modal === 'create'
        ? await adminRequests.post('/hr/kpis', form)
        : await adminRequests.put(`/hr/kpis/${modal._id}`, form);
      toast.success(modal === 'create' ? 'KPI created' : 'KPI updated');
      closeModal(); load();
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (kpi) => {
    try {
      await adminRequests.put(`/hr/kpis/${kpi._id}`, { isActive: !kpi.isActive });
      setKpis((p) => p.map((k) => k._id === kpi._id ? { ...k, isActive: !k.isActive } : k));
    } catch { toast.error('Update failed'); }
  };

  const handleDelete = async (kpi) => {
    setDeleting(kpi._id);
    try {
      await adminRequests.delete(`/hr/kpis/${kpi._id}`);
      toast.success('Deleted');
      setKpis((p) => p.filter((k) => k._id !== kpi._id));
    } catch (err) { toast.error(err.response?.data?.message || 'Delete failed'); }
    finally { setDeleting(null); }
  };

  const totalPages = Math.max(1, Math.ceil(kpis.length / PAGE_SIZE));
  const pageKpis   = kpis.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const nActive    = kpis.filter((k) => k.isActive).length;
  const from       = kpis.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to         = Math.min(page * PAGE_SIZE, kpis.length);

  return (
    <DashboardLayout lockContentScroll>
      {/* Full-height flex column that fills the constrained content area */}
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Top bar ── */}
        <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
          <div>
            <h1 className="text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">KPI Library</h1>
            <p className="text-[10px] leading-tight text-slate-400">Key performance indicators used across appraisal cycles</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={load} className="flex h-7 items-center gap-1 rounded border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
              <FaRedoAlt size={9} /> Refresh
            </button>
            <button onClick={openCreate} className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0a3127]">
              <FaPlus size={9} /> New KPI
            </button>
          </div>
        </div>

        {/* ── Stat + filter row ── */}
        <div className="flex flex-none items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
          <span className="whitespace-nowrap text-[11px] font-bold tabular-nums text-slate-600">
            {kpis.length} <span className="font-normal text-slate-400">total</span>
          </span>
          <span className="whitespace-nowrap text-[11px] font-bold tabular-nums text-emerald-600">
            {nActive} <span className="font-normal text-slate-400">active</span>
          </span>
          <span className="whitespace-nowrap text-[11px] font-bold tabular-nums text-rose-500">
            {kpis.length - nActive} <span className="font-normal text-slate-400">inactive</span>
          </span>
          <div className="mx-0.5 h-4 w-px bg-slate-300" />
          <input
            className={`${F} w-40`}
            placeholder="Search KPIs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className={`${F} w-36 appearance-none`} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={() => setActiveOnly((v) => !v)}
            className={`flex h-7 items-center gap-1 whitespace-nowrap rounded border px-2.5 text-[11px] font-semibold transition-colors ${
              activeOnly ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {activeOnly ? <FaToggleOn size={12} /> : <FaToggleOff size={12} />} Active only
          </button>
          {(search || catFilter || activeOnly) && (
            <button onClick={() => { setSearch(''); setCatFilter(''); setActiveOnly(false); }}
              className="flex h-7 items-center gap-0.5 rounded border border-slate-200 bg-white px-2 text-[10px] text-slate-400 hover:text-slate-600">
              <FaTimes size={8} /> Clear
            </button>
          )}
        </div>

        {/* ── Scrollable table area ── */}
        <div className="flex-1 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="border-b border-slate-200 bg-[#f0f4f2] text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="w-8 px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">KPI Name</th>
                <th className="w-32 px-3 py-2 text-left">Category</th>
                <th className="w-24 px-3 py-2 text-left">Unit</th>
                <th className="w-24 px-3 py-2 text-center">Max Score</th>
                <th className="w-24 px-3 py-2 text-center">Status</th>
                <th className="w-20 px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && <tr><td colSpan={7} className="py-10 text-center text-[11px] text-slate-400">Loading…</td></tr>}
              {!loading && !pageKpis.length && (
                <tr><td colSpan={7} className="py-10 text-center text-[11px] text-slate-400">
                  {kpis.length ? 'No KPIs match the current filters.' : 'No KPIs yet — click "+ New KPI" to get started.'}
                </td></tr>
              )}
              {!loading && pageKpis.map((kpi, idx) => (
                <tr key={kpi._id} className="hover:bg-[#0B3B2E]/[0.03]">
                  <td className="px-3 py-1.5 tabular-nums text-slate-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-3 py-1.5">
                    <span className="font-semibold text-slate-800">{kpi.name}</span>
                    {kpi.description && <span className="ml-2 text-[10px] text-slate-400">{kpi.description}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${CAT_COLORS[kpi.category] || CAT_COLORS.Other}`}>
                      {kpi.category}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{kpi.unit}</td>
                  <td className="px-3 py-1.5 text-center font-semibold tabular-nums text-slate-700">{kpi.maxScore}</td>
                  <td className="px-3 py-1.5 text-center">
                    <button onClick={() => toggleActive(kpi)}>
                      {kpi.isActive
                        ? <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"><FaToggleOn size={10} /> Active</span>
                        : <span className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-500"><FaToggleOff size={10} /> Inactive</span>
                      }
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(kpi)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><FaEdit size={11} /></button>
                      <button onClick={() => { if (window.confirm(`Delete "${kpi.name}"?`)) handleDelete(kpi); }}
                        disabled={deleting === kpi._id}
                        className="rounded p-1 text-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" title="Delete">
                        <FaTrash size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination footer — always visible ── */}
        <div className="flex flex-none items-center justify-between border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-500">
          <span className="tabular-nums">
            {kpis.length === 0 ? 'No records' : `Showing ${from}–${to} of ${kpis.length} KPI${kpis.length !== 1 ? 's' : ''}`}
          </span>
          <div className="flex items-center gap-1">
            <button disabled={page === 1} onClick={() => setPage(1)}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">«</button>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce((acc, p, i, arr) => { if (i > 0 && p - arr[i - 1] > 1) acc.push('…'); acc.push(p); return acc; }, [])
              .map((p, i) => p === '…'
                ? <span key={`e${i}`} className="px-0.5 text-slate-300">…</span>
                : <button key={p} onClick={() => setPage(p)}
                    className={`h-5 min-w-[20px] rounded px-1 text-[10px] font-semibold ${page === p ? 'bg-[#0B3B2E] text-white' : 'border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                    {p}
                  </button>
              )
            }
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">›</button>
            <button disabled={page === totalPages} onClick={() => setPage(totalPages)}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30">»</button>
          </div>
        </div>
      </div>

      {/* ── Modal ── */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-[11px] font-black uppercase tracking-widest text-[#0B3B2E]">
                {modal === 'create' ? 'New KPI' : 'Edit KPI'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700"><FaTimes size={14} /></button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Name *</label>
                <input className={FW} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Sales Revenue Target" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Description</label>
                <textarea rows={2} className="w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Category</label>
                  <select className={`${FW} appearance-none`} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Unit</label>
                  <select className={`${FW} appearance-none`} value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 items-end gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Max Score</label>
                  <input type="number" min={1} className={FW} value={form.maxScore}
                    onChange={(e) => setForm((f) => ({ ...f, maxScore: Number(e.target.value) }))} />
                </div>
                <label className="flex cursor-pointer items-center gap-2 pb-0.5">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="accent-[#0B3B2E]" />
                  <span className="text-xs font-semibold text-slate-700">Active</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button onClick={closeModal} className="h-7 rounded border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-4 text-[11px] font-bold text-white hover:bg-[#0a3127] disabled:opacity-50">
                <FaCheck size={9} /> {saving ? 'Saving…' : 'Save KPI'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
