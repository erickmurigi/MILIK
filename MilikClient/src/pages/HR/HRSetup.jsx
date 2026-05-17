import React, { useEffect, useState, useCallback } from 'react';
import {
  FaBuilding, FaTag, FaPlus, FaEdit, FaTrash, FaRedoAlt,
  FaToggleOn, FaToggleOff, FaSearch, FaCheck, FaTimes,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

// ─── Inline form for departments ─────────────────────────────────────────────
const DEPT_BLANK = { name: '', code: '', description: '' };

function DeptForm({ initial = DEPT_BLANK, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Name *</label>
          <input value={f.name} onChange={set('name')} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" placeholder="e.g. Finance" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Code</label>
          <input value={f.code} onChange={set('code')} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" placeholder="e.g. FIN" />
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Description</label>
        <input value={f.description} onChange={set('description')} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" placeholder="Optional" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <FaTimes size={9} /> Cancel
        </button>
        <button onClick={() => onSave(f)} disabled={saving || !f.name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50">
          <FaCheck size={9} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Inline form for designations ────────────────────────────────────────────
const DESIG_BLANK = { name: '', gradeLevel: '', description: '' };

function DesigForm({ initial = DESIG_BLANK, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Name *</label>
          <input value={f.name} onChange={set('name')} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" placeholder="e.g. Senior Accountant" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Grade / Level</label>
          <input value={f.gradeLevel} onChange={set('gradeLevel')} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" placeholder="e.g. G5" />
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">Description</label>
        <input value={f.description} onChange={set('description')} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" placeholder="Optional" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
          <FaTimes size={9} /> Cancel
        </button>
        <button onClick={() => onSave(f)} disabled={saving || !f.name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00] disabled:opacity-50">
          <FaCheck size={9} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function HRSetup() {
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [deptSearch, setDeptSearch] = useState('');
  const [desigSearch, setDesigSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingDesigs, setLoadingDesigs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deptFormMode, setDeptFormMode] = useState(null); // null | 'new' | { editing: dept }
  const [desigFormMode, setDesigFormMode] = useState(null); // null | 'new' | { editing: desig }
  const [confirm, setConfirm] = useState({ isOpen: false });

  // ── Load departments ────────────────────────────────────────────────────────
  const loadDepts = useCallback(async () => {
    setLoadingDepts(true);
    try {
      const res = await adminRequests.get('/hr/departments', {
        params: { search: deptSearch || undefined, includeInactive: showInactive ? 'true' : undefined },
      });
      setDepartments(res.data || []);
    } catch {
      toast.error('Failed to load departments');
    } finally {
      setLoadingDepts(false);
    }
  }, [deptSearch, showInactive]);

  // ── Load designations for selected department ───────────────────────────────
  const loadDesigs = useCallback(async () => {
    if (!selectedDept) { setDesignations([]); return; }
    setLoadingDesigs(true);
    try {
      const res = await adminRequests.get('/hr/designations', {
        params: {
          department: selectedDept._id,
          search: desigSearch || undefined,
          includeInactive: showInactive ? 'true' : undefined,
        },
      });
      setDesignations(res.data || []);
    } catch {
      toast.error('Failed to load designations');
    } finally {
      setLoadingDesigs(false);
    }
  }, [selectedDept, desigSearch, showInactive]);

  useEffect(() => { loadDepts(); }, [loadDepts]);
  useEffect(() => { loadDesigs(); }, [loadDesigs]);

  // ── Department CRUD ─────────────────────────────────────────────────────────
  const saveDept = async (form) => {
    setSaving(true);
    try {
      if (deptFormMode?.editing) {
        await adminRequests.put(`/hr/departments/${deptFormMode.editing._id}`, form);
        toast.success('Department updated');
      } else {
        await adminRequests.post('/hr/departments', form);
        toast.success('Department created');
      }
      setDeptFormMode(null);
      await loadDepts();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save department');
    } finally {
      setSaving(false);
    }
  };

  const toggleDeptActive = async (dept) => {
    try {
      await adminRequests.put(`/hr/departments/${dept._id}`, { isActive: !dept.isActive });
      toast.success(dept.isActive ? 'Department deactivated' : 'Department activated');
      loadDepts();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update department');
    }
  };

  const deleteDept = (dept) => {
    setConfirm({
      isOpen: true,
      title: 'Delete Department',
      message: `Delete "${dept.name}"? This cannot be undone. Employees assigned to this department will need to be reassigned.`,
      isDangerous: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await adminRequests.delete(`/hr/departments/${dept._id}`);
          toast.success('Department deleted');
          if (selectedDept?._id === dept._id) { setSelectedDept(null); setDesignations([]); }
          loadDepts();
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Cannot delete — employees are assigned to this department');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
      },
    });
  };

  // ── Designation CRUD ────────────────────────────────────────────────────────
  const saveDesig = async (form) => {
    if (!selectedDept) return;
    setSaving(true);
    try {
      if (desigFormMode?.editing) {
        await adminRequests.put(`/hr/designations/${desigFormMode.editing._id}`, { ...form, department: selectedDept._id });
        toast.success('Designation updated');
      } else {
        await adminRequests.post('/hr/designations', { ...form, department: selectedDept._id });
        toast.success('Designation created');
      }
      setDesigFormMode(null);
      await loadDesigs();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save designation');
    } finally {
      setSaving(false);
    }
  };

  const toggleDesigActive = async (desig) => {
    try {
      await adminRequests.put(`/hr/designations/${desig._id}`, { isActive: !desig.isActive });
      toast.success(desig.isActive ? 'Designation deactivated' : 'Designation activated');
      loadDesigs();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update designation');
    }
  };

  const deleteDesig = (desig) => {
    setConfirm({
      isOpen: true,
      title: 'Delete Designation',
      message: `Delete "${desig.name}"? Employees with this designation will need to be updated.`,
      isDangerous: true,
      confirmText: 'Delete',
      onConfirm: async () => {
        try {
          await adminRequests.delete(`/hr/designations/${desig._id}`);
          toast.success('Designation deleted');
          loadDesigs();
        } catch (e) {
          toast.error(e?.response?.data?.message || 'Cannot delete — employees hold this designation');
        } finally {
          setConfirm((p) => ({ ...p, isOpen: false }));
        }
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
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">Departments & Designations</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowInactive((p) => !p)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${showInactive ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {showInactive ? <FaToggleOn size={10} /> : <FaToggleOff size={10} />}
                {showInactive ? 'Showing Inactive' : 'Active Only'}
              </button>
              <button onClick={loadDepts} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <FaRedoAlt size={10} /> Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Split panel */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full divide-x divide-slate-200">

            {/* ── LEFT: Departments ─────────────────────────────────────── */}
            <div className="flex w-[340px] flex-shrink-0 flex-col bg-white">
              <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <FaBuilding size={11} className="text-emerald-700" />
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Departments</span>
                    <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{departments.length}</span>
                  </div>
                  <button
                    onClick={() => { setDeptFormMode('new'); }}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#0a2e23]"
                  >
                    <FaPlus size={8} /> New
                  </button>
                </div>
                <div className="relative mt-2">
                  <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                  <input
                    value={deptSearch}
                    onChange={(e) => setDeptSearch(e.target.value)}
                    placeholder="Search departments..."
                    className="h-7 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  />
                </div>
              </div>

              {/* New dept form */}
              {deptFormMode === 'new' && (
                <div className="flex-shrink-0 border-b border-slate-100 p-3">
                  <DeptForm onSave={saveDept} onCancel={() => setDeptFormMode(null)} saving={saving} />
                </div>
              )}

              {/* Dept list */}
              <div className="flex-1 overflow-y-auto">
                {loadingDepts ? (
                  <div className="flex h-24 items-center justify-center text-xs text-slate-400">Loading…</div>
                ) : departments.length === 0 ? (
                  <div className="flex h-24 flex-col items-center justify-center gap-1 text-slate-400">
                    <FaBuilding size={18} />
                    <p className="text-[11px] font-semibold">No departments yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {departments.map((dept) => (
                      <div key={dept._id}>
                        {/* Edit form inline */}
                        {deptFormMode?.editing?._id === dept._id ? (
                          <div className="p-3">
                            <DeptForm
                              initial={{ name: dept.name, code: dept.code || '', description: dept.description || '' }}
                              onSave={saveDept}
                              onCancel={() => setDeptFormMode(null)}
                              saving={saving}
                            />
                          </div>
                        ) : (
                          <div
                            onClick={() => { setSelectedDept(dept); setDesigFormMode(null); setDesigSearch(''); }}
                            className={`flex cursor-pointer items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-slate-50 ${selectedDept?._id === dept._id ? 'bg-emerald-50 border-l-2 border-emerald-600' : ''} ${!dept.isActive ? 'opacity-50' : ''}`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                              <FaBuilding size={11} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-black text-slate-900">{dept.name}</span>
                                {dept.code && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">{dept.code}</span>}
                                {!dept.isActive && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-600">Inactive</span>}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {dept.employeeCount != null ? `${dept.employeeCount} employee${dept.employeeCount !== 1 ? 's' : ''}` : ''}
                                {dept.description ? (dept.employeeCount != null ? ` · ` : '') + dept.description : ''}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => setDeptFormMode({ editing: dept })}
                                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                title="Edit"
                              >
                                <FaEdit size={9} />
                              </button>
                              <button
                                onClick={() => toggleDeptActive(dept)}
                                className={`rounded p-1.5 ${dept.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-400 hover:bg-amber-50'}`}
                                title={dept.isActive ? 'Deactivate' : 'Activate'}
                              >
                                {dept.isActive ? <FaToggleOn size={11} /> : <FaToggleOff size={11} />}
                              </button>
                              <button
                                onClick={() => deleteDept(dept)}
                                className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                                title="Delete"
                              >
                                <FaTrash size={9} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT: Designations ───────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col bg-slate-50">
              {!selectedDept ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-300">
                  <FaTag size={36} />
                  <p className="text-sm font-black">Select a department</p>
                  <p className="text-xs text-slate-400">Designations for the selected department will appear here</p>
                </div>
              ) : (
                <>
                  <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <FaTag size={10} className="text-[#FF8C00]" />
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">
                          {selectedDept.name} — Designations
                        </span>
                        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{designations.length}</span>
                      </div>
                      <button
                        onClick={() => setDesigFormMode('new')}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#FF8C00] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#e67e00]"
                      >
                        <FaPlus size={8} /> New Designation
                      </button>
                    </div>
                    <div className="relative mt-2">
                      <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                      <input
                        value={desigSearch}
                        onChange={(e) => setDesigSearch(e.target.value)}
                        placeholder="Search designations..."
                        className="h-7 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                      />
                    </div>
                  </div>

                  {/* New desig form */}
                  {desigFormMode === 'new' && (
                    <div className="flex-shrink-0 border-b border-slate-100 bg-white p-3">
                      <DesigForm onSave={saveDesig} onCancel={() => setDesigFormMode(null)} saving={saving} />
                    </div>
                  )}

                  {/* Desig list */}
                  <div className="flex-1 overflow-y-auto">
                    {loadingDesigs ? (
                      <div className="flex h-24 items-center justify-center text-xs text-slate-400">Loading…</div>
                    ) : designations.length === 0 ? (
                      <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-300">
                        <FaTag size={24} />
                        <p className="text-xs font-semibold">No designations for this department</p>
                        <p className="text-[11px] text-slate-400">Click "New Designation" to add one</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 bg-white">
                        {designations.map((desig) => (
                          <div key={desig._id}>
                            {desigFormMode?.editing?._id === desig._id ? (
                              <div className="p-3">
                                <DesigForm
                                  initial={{ name: desig.name, gradeLevel: desig.gradeLevel || '', description: desig.description || '' }}
                                  onSave={saveDesig}
                                  onCancel={() => setDesigFormMode(null)}
                                  saving={saving}
                                />
                              </div>
                            ) : (
                              <div className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors ${!desig.isActive ? 'opacity-50' : ''}`}>
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-[#FF8C00]">
                                  <FaTag size={10} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate text-xs font-black text-slate-900">{desig.name}</span>
                                    {desig.gradeLevel && (
                                      <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black text-indigo-600">{desig.gradeLevel}</span>
                                    )}
                                    {!desig.isActive && (
                                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-600">Inactive</span>
                                    )}
                                  </div>
                                  {desig.description && (
                                    <div className="text-[10px] text-slate-400 truncate">{desig.description}</div>
                                  )}
                                </div>
                                <div className="flex shrink-0 items-center gap-0.5">
                                  <button
                                    onClick={() => setDesigFormMode({ editing: desig })}
                                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                    title="Edit"
                                  >
                                    <FaEdit size={9} />
                                  </button>
                                  <button
                                    onClick={() => toggleDesigActive(desig)}
                                    className={`rounded p-1.5 ${desig.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-400 hover:bg-amber-50'}`}
                                    title={desig.isActive ? 'Deactivate' : 'Activate'}
                                  >
                                    {desig.isActive ? <FaToggleOn size={11} /> : <FaToggleOff size={11} />}
                                  </button>
                                  <button
                                    onClick={() => deleteDesig(desig)}
                                    className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                                    title="Delete"
                                  >
                                    <FaTrash size={9} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))} />
    </DashboardLayout>
  );
}
