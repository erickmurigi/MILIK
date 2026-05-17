import React, { useCallback, useEffect, useState } from 'react';
import {
  FaTag, FaPlus, FaEdit, FaTrash, FaToggleOn, FaToggleOff,
  FaRedoAlt, FaCheck, FaTimes, FaSearch,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const BLANK = {
  name: '', code: '', description: '', daysPerYear: 21, maxCarryover: 5,
  isPaid: true, requiresApproval: true,
  applicableTo: 'All', genderRestriction: 'None', minServiceDays: 0,
};

function LeaveTypeForm({ initial = BLANK, onSave, onCancel, saving }) {
  const [f, setF] = useState({ ...BLANK, ...initial });
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setF((p) => ({ ...p, [k]: v }));
  };

  const inputCls = 'h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Name *</label>
          <input value={f.name} onChange={set('name')} className={inputCls} placeholder="e.g. Annual Leave" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Code</label>
          <input value={f.code} onChange={set('code')} className={inputCls} placeholder="AL" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Days / Year</label>
          <input type="number" min="0" value={f.daysPerYear} onChange={set('daysPerYear')} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Max Carry-Over (days)</label>
          <input type="number" min="0" value={f.maxCarryover} onChange={set('maxCarryover')} className={inputCls} />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Applicable To</label>
          <select value={f.applicableTo} onChange={set('applicableTo')} className={inputCls}>
            <option>All</option><option>Permanent</option><option>Contract</option>
            <option>Casual</option><option>Intern</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Gender Restriction</label>
          <select value={f.genderRestriction} onChange={set('genderRestriction')} className={inputCls}>
            <option>None</option><option>Male</option><option>Female</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Min. Service (days)</label>
          <input type="number" min="0" value={f.minServiceDays} onChange={set('minServiceDays')} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Description</label>
          <input value={f.description} onChange={set('description')} className={inputCls} placeholder="Optional" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
          <input type="checkbox" checked={f.isPaid} onChange={set('isPaid')} className="rounded" />
          Paid Leave
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
          <input type="checkbox" checked={f.requiresApproval} onChange={set('requiresApproval')} className="rounded" />
          Requires Approval
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} type="button" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <FaTimes size={9} /> Cancel
        </button>
        <button onClick={() => onSave(f)} type="button" disabled={saving || !f.name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50">
          <FaCheck size={9} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function LeaveTypes() {
  const [types, setTypes]       = useState([]);
  const [search, setSearch]     = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [formMode, setFormMode] = useState(null); // null | 'new' | { editing: lt }
  const [confirm, setConfirm]   = useState({ isOpen: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminRequests.get('/hr/leave-types', {
        params: { search: search || undefined, includeInactive: showInactive ? 'true' : undefined },
      });
      setTypes(res.data || []);
    } catch { toast.error('Failed to load leave types'); }
    finally  { setLoading(false); }
  }, [search, showInactive]);

  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    setSaving(true);
    try {
      if (formMode?.editing) {
        await adminRequests.put(`/hr/leave-types/${formMode.editing._id}`, form);
        toast.success('Leave type updated');
      } else {
        await adminRequests.post('/hr/leave-types', form);
        toast.success('Leave type created');
      }
      setFormMode(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (lt) => {
    try {
      await adminRequests.put(`/hr/leave-types/${lt._id}`, { isActive: !lt.isActive });
      toast.success(lt.isActive ? 'Deactivated' : 'Activated');
      load();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
  };

  const deleteType = (lt) => {
    setConfirm({
      isOpen: true, title: 'Delete Leave Type',
      message: `Delete "${lt.name}"? This cannot be undone.`,
      isDangerous: true, confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await adminRequests.delete(`/hr/leave-types/${lt._id}`);
          toast.success('Leave type deleted');
          load();
        } catch (e) { toast.error(e?.response?.data?.message || 'Cannot delete — applications exist for this type'); }
        finally    { setConfirm((p) => ({ ...p, isOpen: false })); }
      },
    });
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource · Leave</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Leave Types</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowInactive((p) => !p)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${showInactive ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                {showInactive ? <FaToggleOn size={10} /> : <FaToggleOff size={10} />}
                {showInactive ? 'Showing Inactive' : 'Active Only'}
              </button>
              <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} />
              </button>
              <button onClick={() => setFormMode('new')} className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00]">
                <FaPlus size={10} /> New Leave Type
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-3">

            {/* Search */}
            <div className="relative">
              <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leave types..."
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
            </div>

            {/* New form */}
            {formMode === 'new' && (
              <LeaveTypeForm onSave={save} onCancel={() => setFormMode(null)} saving={saving} />
            )}

            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-slate-400">Loading...</div>
            ) : types.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-300">
                <FaTag size={28} />
                <p className="text-sm font-semibold text-slate-400">No leave types yet</p>
                <p className="text-xs text-slate-400">Click "New Leave Type" to create one</p>
              </div>
            ) : (
              <div className="space-y-2">
                {types.map((lt) => (
                  <div key={lt._id}>
                    {formMode?.editing?._id === lt._id ? (
                      <LeaveTypeForm
                        initial={lt}
                        onSave={save}
                        onCancel={() => setFormMode(null)}
                        saving={saving}
                      />
                    ) : (
                      <div className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-opacity ${!lt.isActive ? 'opacity-50' : ''}`}>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                          <FaTag size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-slate-900">{lt.name}</span>
                            {lt.code && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">{lt.code}</span>}
                            {!lt.isActive && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-600">Inactive</span>}
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${lt.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                              {lt.isPaid ? 'Paid' : 'Unpaid'}
                            </span>
                            {lt.requiresApproval && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-black text-blue-600">Requires Approval</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                            <span><strong className="text-slate-700">{lt.daysPerYear}</strong> days/year</span>
                            <span>Max carry-over: <strong className="text-slate-700">{lt.maxCarryover}</strong> days</span>
                            <span>For: <strong className="text-slate-700">{lt.applicableTo}</strong></span>
                            {lt.genderRestriction !== 'None' && <span>Gender: <strong className="text-slate-700">{lt.genderRestriction}</strong></span>}
                            {lt.minServiceDays > 0 && <span>Min. service: <strong className="text-slate-700">{lt.minServiceDays}</strong> days</span>}
                          </div>
                          {lt.description && <p className="mt-0.5 text-[11px] text-slate-400">{lt.description}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button onClick={() => setFormMode({ editing: lt })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><FaEdit size={10} /></button>
                          <button onClick={() => toggleActive(lt)} className={`rounded p-1.5 ${lt.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-400 hover:bg-amber-50'}`} title={lt.isActive ? 'Deactivate' : 'Activate'}>
                            {lt.isActive ? <FaToggleOn size={12} /> : <FaToggleOff size={12} />}
                          </button>
                          <button onClick={() => deleteType(lt)} className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500" title="Delete"><FaTrash size={10} /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}
