import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FaPlus, FaRedoAlt, FaEdit, FaTrash, FaLock, FaUnlock,
  FaTimes, FaCheck, FaCalendarAlt,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const DEFAULT_PAGE_SIZE = 25;
const PERIOD_TYPES = ['Annual', 'Semi-Annual', 'Quarterly', 'Custom'];
const STATUS_PILL = {
  Draft:  'border-slate-300 bg-slate-50 text-slate-600',
  Open:   'border-emerald-300 bg-emerald-50 text-emerald-700',
  Closed: 'border-rose-200 bg-rose-50 text-rose-600',
};
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => currentYear - 2 + i);
const EMPTY = { name: '', year: currentYear, periodType: 'Annual', startDate: '', endDate: '', notes: '', kpis: [] };
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const F  = 'h-7 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';
const FW = `${F} w-full`;

function WeightBar({ total }) {
  const pct   = Math.min(total, 100);
  const ok    = Math.abs(total - 100) <= 0.01;
  const color = ok ? 'bg-emerald-500' : total > 100 ? 'bg-rose-500' : 'bg-amber-400';
  const text  = ok ? 'text-emerald-600' : total > 100 ? 'text-rose-600' : 'text-amber-600';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-bold tabular-nums ${text}`}>{total.toFixed(1)}% / 100%</span>
    </div>
  );
}

export default function AppraisalCycles() {
  const queryClient = useQueryClient();
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [pageSize, setPageSize]      = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage]             = useState(1);
  const [modal, setModal]           = useState(null);
  const [form, setForm]             = useState(EMPTY);
  const [saving, setSaving]         = useState(false);
  const [acting, setActing]         = useState(null);

  const { data: cycles = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['hr-appraisal-cycles', yearFilter, statusFilter],
    queryFn: async () => {
      const params = {};
      if (yearFilter)   params.year   = yearFilter;
      if (statusFilter) params.status = statusFilter;
      const res = await adminRequests.get('/hr/appraisal-cycles', { params });
      return res.data || [];
    },
  });

  const { data: kpiLib = [] } = useQuery({
    queryKey: ['hr-kpis-ref'],
    queryFn: () => adminRequests.get('/hr/kpis', { params: { isActive: 'true' } }).then((r) => r.data || []),
    staleTime: 5 * 60_000,
  });

  useEffect(() => { if (error) toast.error('Failed to load cycles'); }, [error]);
  useEffect(() => { setPage(1); }, [yearFilter, statusFilter, pageSize]);

  const openCreate = () => { setForm(EMPTY); setModal('create'); };
  const openEdit   = (c) => {
    setForm({ name: c.name, year: c.year, periodType: c.periodType,
      startDate: c.startDate?.slice(0, 10) || '', endDate: c.endDate?.slice(0, 10) || '',
      notes: c.notes || '', kpis: c.kpis.map((ck) => ({ kpi: ck.kpi?._id || ck.kpi, weight: ck.weight })) });
    setModal(c);
  };
  const closeModal = () => { setModal(null); setSaving(false); };

  const weightTotal = form.kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const toggleKpi   = (id) => setForm((f) => {
    const has = f.kpis.find((k) => k.kpi === id);
    return { ...f, kpis: has ? f.kpis.filter((k) => k.kpi !== id) : [...f.kpis, { kpi: id, weight: 0 }] };
  });
  const setWeight = (id, w) => setForm((f) => ({ ...f, kpis: f.kpis.map((k) => k.kpi === id ? { ...k, weight: Number(w) } : k) }));

  const handleSave = async () => {
    if (!form.name?.trim()) return toast.error('Cycle name is required');
    if (!form.startDate || !form.endDate) return toast.error('Start and end dates are required');
    if (form.kpis.length && Math.abs(weightTotal - 100) > 0.01)
      return toast.error(`KPI weights must sum to 100% (${weightTotal.toFixed(1)}% now)`);
    setSaving(true);
    try {
      modal === 'create'
        ? await adminRequests.post('/hr/appraisal-cycles', form)
        : await adminRequests.put(`/hr/appraisal-cycles/${modal._id}`, form);
      toast.success(modal === 'create' ? 'Cycle created' : 'Cycle updated');
      closeModal(); queryClient.invalidateQueries({ queryKey: ['hr-appraisal-cycles'] });
    } catch (err) { toast.error(err.response?.data?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  const doOpen = async (c) => {
    if (!window.confirm(`Open "${c.name}"? Appraisals will be generated for all active employees.`)) return;
    setActing(c._id);
    try { const r = await adminRequests.post(`/hr/appraisal-cycles/${c._id}/open`); toast.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['hr-appraisal-cycles'] }); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActing(null); }
  };
  const doClose = async (c) => {
    if (!window.confirm(`Close "${c.name}"? Further scoring will be locked.`)) return;
    setActing(c._id);
    try { await adminRequests.post(`/hr/appraisal-cycles/${c._id}/close`); toast.success('Cycle closed'); queryClient.invalidateQueries({ queryKey: ['hr-appraisal-cycles'] }); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setActing(null); }
  };
  const doDelete = async (c) => {
    if (!window.confirm(`Delete "${c.name}"? All related appraisals will be removed.`)) return;
    setActing(c._id);
    try { await adminRequests.delete(`/hr/appraisal-cycles/${c._id}`); toast.success('Cycle deleted'); setCycles((p) => p.filter((x) => x._id !== c._id)); }
    catch (err) { toast.error(err.response?.data?.message || 'Delete failed'); }
    finally { setActing(null); }
  };

  const nDraft = cycles.filter((c) => c.status === 'Draft').length;
  const nOpen  = cycles.filter((c) => c.status === 'Open').length;
  const nClosed= cycles.filter((c) => c.status === 'Closed').length;

  const totalPages   = Math.ceil(cycles.length / pageSize) || 1;
  const pagedCycles  = cycles.slice((page - 1) * pageSize, page * pageSize);
  const fromRow      = cycles.length ? (page - 1) * pageSize + 1 : 0;
  const toRow        = Math.min(page * pageSize, cycles.length);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full flex-col overflow-hidden">

        {/* ── Top bar ── */}
        <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
          <div>
            <h1 className="text-[11px] font-extrabold uppercase tracking-widest text-[#0B3B2E]">Appraisal Cycles</h1>
            <p className="text-[10px] text-slate-400 leading-tight">Manage performance review periods, assign KPIs and generate employee appraisals</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={refetch} className="flex h-7 items-center gap-1 rounded border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
              <FaRedoAlt size={9} /> Refresh
            </button>
            <button onClick={openCreate} className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0a3127]">
              <FaPlus size={9} /> New Cycle
            </button>
          </div>
        </div>

        {/* ── Filter + stat bar ── */}
        <div className="flex flex-none items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5">
          <span className="text-[11px] font-bold text-slate-600 tabular-nums whitespace-nowrap">{cycles.length} <span className="font-normal text-slate-400">total</span></span>
          <span className="text-[11px] font-bold text-slate-500 tabular-nums whitespace-nowrap">{nDraft} <span className="font-normal text-slate-400">draft</span></span>
          <span className="text-[11px] font-bold text-emerald-600 tabular-nums whitespace-nowrap">{nOpen} <span className="font-normal text-slate-400">open</span></span>
          <span className="text-[11px] font-bold text-rose-500 tabular-nums whitespace-nowrap">{nClosed} <span className="font-normal text-slate-400">closed</span></span>
          <div className="h-4 w-px bg-slate-300 mx-0.5" />
          <select className={`${F} w-28 appearance-none`} value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">All years</option>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className={`${F} w-30 appearance-none`} value={statusFilter} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="Draft">Draft</option>
            <option value="Open">Open</option>
            <option value="Closed">Closed</option>
          </select>
          {(yearFilter || statusFilter) && (
            <button onClick={() => { setYearFilter(''); setStatus(''); }} className="flex h-7 items-center gap-0.5 rounded border border-slate-200 bg-white px-2 text-[10px] text-slate-400 hover:text-slate-600">
              <FaTimes size={8} /> Clear
            </button>
          )}
          <span className="ml-auto text-[10px] text-slate-400 whitespace-nowrap tabular-nums">{cycles.length} cycle{cycles.length !== 1 ? 's' : ''}</span>
        </div>

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 z-10 shadow-sm">
              <tr className="border-b border-slate-200 bg-[#f0f4f2] text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-1.5 text-left w-8">#</th>
                <th className="px-3 py-1.5 text-left">Cycle Name</th>
                <th className="px-3 py-1.5 text-left w-36">Period</th>
                <th className="px-3 py-1.5 text-left w-52">Date Range</th>
                <th className="px-3 py-1.5 text-left">KPI Assignments</th>
                <th className="px-3 py-1.5 text-center w-20">Employees</th>
                <th className="px-3 py-1.5 text-center w-20">Status</th>
                <th className="px-3 py-1.5 text-right w-36">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading && <tr><td colSpan={8} className="py-8 text-center text-[11px] text-slate-400">Loading…</td></tr>}
              {!loading && !cycles.length && (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <FaCalendarAlt size={22} className="mx-auto mb-2 text-slate-200" />
                    <p className="text-[11px] text-slate-400">No appraisal cycles found — click "+ New Cycle" to create one.</p>
                  </td>
                </tr>
              )}
              {!loading && pagedCycles.map((c, idx) => (
                <tr key={c._id} className="hover:bg-[#0B3B2E]/[0.03]">
                  <td className="px-3 py-1.5 text-slate-400 tabular-nums">{(page - 1) * pageSize + idx + 1}</td>
                  <td className="px-3 py-1.5">
                    <span className="font-semibold text-slate-800">{c.name}</span>
                    {c.notes && <span className="ml-2 text-[10px] text-slate-400 italic">{c.notes}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 tabular-nums">{c.year} · {c.periodType}</td>
                  <td className="px-3 py-1.5 text-slate-500 tabular-nums text-[11px]">
                    {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {c.kpis?.length
                        ? c.kpis.map((ck) => (
                            <span key={ck.kpi?._id || ck.kpi} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 whitespace-nowrap">
                              {ck.kpi?.name || '—'} <span className="font-bold text-[#0B3B2E]">{ck.weight}%</span>
                            </span>
                          ))
                        : <span className="text-[10px] text-slate-300">No KPIs assigned</span>
                      }
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-center font-semibold tabular-nums text-slate-700">{c.employeeCount || 0}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${STATUS_PILL[c.status]}`}>{c.status}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === 'Draft' && (
                        <>
                          <button onClick={() => openEdit(c)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><FaEdit size={11} /></button>
                          <button onClick={() => doOpen(c)} disabled={acting === c._id}
                            className="flex items-center gap-0.5 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 whitespace-nowrap">
                            <FaUnlock size={9} /> Open
                          </button>
                          <button onClick={() => doDelete(c)} disabled={acting === c._id} className="rounded p-1 text-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40" title="Delete"><FaTrash size={11} /></button>
                        </>
                      )}
                      {c.status === 'Open' && (
                        <button onClick={() => doClose(c)} disabled={acting === c._id}
                          className="flex items-center gap-0.5 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap">
                          <FaLock size={9} /> Close
                        </button>
                      )}
                      {c.status === 'Closed' && <span className="text-[10px] text-slate-300 pr-1">Closed</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div className="flex flex-none items-center justify-between border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-500">
          <span>Showing {fromRow}–{toRow} of {cycles.length} cycle{cycles.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-slate-500 text-[10px]">Per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="h-6 rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition"
              >
                {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <button disabled={page === 1} onClick={() => setPage(1)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:opacity-30">«</button>
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:opacity-30">‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce((acc, p, i, arr) => { if (i > 0 && p - arr[i - 1] > 1) acc.push('…'); acc.push(p); return acc; }, [])
              .map((p, i) => p === '…'
                ? <span key={`e${i}`} className="px-0.5 text-slate-300">…</span>
                : <button key={p} onClick={() => setPage(p)} className={`h-5 w-5 rounded text-[10px] font-semibold ${page === p ? 'bg-[#0B3B2E] text-white' : 'border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{p}</button>
              )
            }
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:opacity-30">›</button>
            <button disabled={page === totalPages} onClick={() => setPage(totalPages)} className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] hover:bg-slate-50 disabled:opacity-30">»</button>
          </div>
        </div>
      </div>

      {/* ── Modal ── */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-[11px] font-black uppercase tracking-widest text-[#0B3B2E]">
                {modal === 'create' ? 'New Appraisal Cycle' : 'Edit Cycle'}
              </h2>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-700"><FaTimes size={14} /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Cycle Name *</label>
                  <input className={FW} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Annual Review 2025" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Year *</label>
                  <select className={`${FW} appearance-none`} value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: Number(e.target.value) }))}>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Period Type</label>
                  <select className={`${FW} appearance-none`} value={form.periodType} onChange={(e) => setForm((f) => ({ ...f, periodType: e.target.value }))}>
                    {PERIOD_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Notes</label>
                  <input className={FW} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional…" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Start Date *</label>
                  <input type="date" className={FW} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">End Date *</label>
                  <input type="date" className={FW} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    KPI Assignments {form.kpis.length > 0 && `— ${form.kpis.length} selected`}
                  </label>
                  {form.kpis.length > 0 && <WeightBar total={weightTotal} />}
                </div>
                {!kpiLib.length
                  ? <p className="text-[11px] text-slate-400">No active KPIs in library. Add KPIs first via the KPI Library page.</p>
                  : (
                    <div className="max-h-48 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-50">
                      {kpiLib.map((kpi) => {
                        const picked = form.kpis.find((k) => k.kpi === kpi._id);
                        return (
                          <div key={kpi._id} className={`flex items-center gap-3 px-3 py-1.5 ${picked ? 'bg-emerald-50/40' : 'hover:bg-slate-50/60'}`}>
                            <input type="checkbox" checked={!!picked} onChange={() => toggleKpi(kpi._id)} className="h-3.5 w-3.5 accent-[#0B3B2E] flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-semibold text-slate-700">{kpi.name}</span>
                              <span className="ml-2 text-[10px] text-slate-400">{kpi.category} · Max {kpi.maxScore}</span>
                            </div>
                            {picked && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <input type="number" min={0} max={100} step={5}
                                  className="h-6 w-14 rounded border border-slate-200 px-1.5 text-center text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                                  value={picked.weight} onChange={(e) => setWeight(kpi._id, e.target.value)} />
                                <span className="text-[10px] text-slate-400">%</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                }
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button onClick={closeModal} className="h-7 rounded border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex h-7 items-center gap-1 rounded bg-[#0B3B2E] px-4 text-[11px] font-bold text-white hover:bg-[#0a3127] disabled:opacity-50">
                <FaCheck size={9} /> {saving ? 'Saving…' : 'Save Cycle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
