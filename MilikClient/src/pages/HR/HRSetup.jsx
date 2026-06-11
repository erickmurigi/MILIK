import React, { useEffect, useState, useCallback } from 'react';
import {
  FaBuilding, FaTag, FaPlus, FaEdit, FaTrash, FaRedoAlt,
  FaToggleOn, FaToggleOff, FaSearch, FaCheck, FaTimes,
  FaUserTie, FaFileAlt, FaMoneyBillWave, FaPercent,
  FaStar, FaUndo, FaInfoCircle,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import MilikConfirmDialog from '../../components/Modals/MilikConfirmDialog';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

// ── Constants ─────────────────────────────────────────────────────────────────
const LETTER_TYPE_LABELS = {
  offer: 'Offer Letter', appointment: 'Appointment', confirmation: 'Confirmation',
  increment: 'Salary Increment', promotion: 'Promotion',
  warning_1: '1st Warning', warning_2: '2nd Warning', final_warning: 'Final Warning',
  termination: 'Termination', reference: 'Reference Letter',
  suspension: 'Suspension', reinstatement: 'Reinstatement',
  redundancy: 'Redundancy', custom: 'Custom Letter',
};
const LETTER_TYPES = Object.keys(LETTER_TYPE_LABELS);

const PLACEHOLDERS = [
  ['{{employee.fullName}}',    'Employee full name'],
  ['{{employee.surname}}',     'Surname only'],
  ['{{employee.otherNames}}',  'Other names'],
  ['{{employee.number}}',      'Employee number'],
  ['{{employee.designation}}', 'Designation title'],
  ['{{employee.department}}',  'Department name'],
  ['{{employee.email}}',       'Email address'],
  ['{{employee.phone}}',       'Phone number'],
  ['{{company.name}}',         'Company name'],
  ['{{today}}',                "Today's date"],
  ['{{meta.FIELD}}',           'Any letter field (e.g. meta.salary, meta.position)'],
];

const pct = (v) => (v != null ? (Number(v) * 100).toFixed(2) : '');
const dec = (v) => parseFloat(v) / 100;

// ── Shared tiny label ─────────────────────────────────────────────────────────
const Label = ({ children }) => (
  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-0.5">
    {children}
  </label>
);
const inp = 'h-8 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]';

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — Existing Dept / Desig forms
// ─────────────────────────────────────────────────────────────────────────────
const DEPT_BLANK  = { name: '', code: '', description: '' };
const DESIG_BLANK = { name: '', gradeLevel: '', description: '' };

function DeptForm({ initial = DEPT_BLANK, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Name *</Label><input value={f.name} onChange={set('name')} className={inp} placeholder="e.g. Finance" /></div>
        <div><Label>Code</Label><input value={f.code} onChange={set('code')} className={inp} placeholder="e.g. FIN" /></div>
      </div>
      <div><Label>Description</Label><input value={f.description} onChange={set('description')} className={inp} placeholder="Optional" /></div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><FaTimes size={9}/> Cancel</button>
        <button onClick={() => onSave(f)} disabled={saving || !f.name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-3 py-1.5 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50"><FaCheck size={9}/> {saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function DesigForm({ initial = DESIG_BLANK, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Name *</Label><input value={f.name} onChange={set('name')} className={inp} placeholder="e.g. Senior Accountant" /></div>
        <div><Label>Grade / Level</Label><input value={f.gradeLevel} onChange={set('gradeLevel')} className={inp} placeholder="e.g. G5" /></div>
      </div>
      <div><Label>Description</Label><input value={f.description} onChange={set('description')} className={inp} placeholder="Optional" /></div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><FaTimes size={9}/> Cancel</button>
        <button onClick={() => onSave(f)} disabled={saving || !f.name.trim()} className="inline-flex items-center gap-1 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-black text-white hover:bg-[#e67e00] disabled:opacity-50"><FaCheck size={9}/> {saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — Signatories inline form
// ─────────────────────────────────────────────────────────────────────────────
const SIG_BLANK = { name: '', title: '', department: '', isDefault: false, letterTypes: [] };

function SignatoryForm({ initial = SIG_BLANK, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const toggleType = (t) => setF((p) => ({
    ...p,
    letterTypes: p.letterTypes.includes(t) ? p.letterTypes.filter((x) => x !== t) : [...p.letterTypes, t],
  }));
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Full Name *</Label><input value={f.name} onChange={set('name')} className={inp} placeholder="e.g. John Kamau" /></div>
        <div><Label>Title / Role *</Label><input value={f.title} onChange={set('title')} className={inp} placeholder="e.g. HR Manager" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Department (optional)</Label><input value={f.department} onChange={set('department')} className={inp} placeholder="e.g. Human Resources" /></div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!f.isDefault} onChange={(e) => setF((p) => ({ ...p, isDefault: e.target.checked }))} className="rounded" />
            <span className="text-[11px] font-black text-indigo-700">Set as Default Signatory</span>
          </label>
        </div>
      </div>
      <div>
        <Label>Signs these letter types (leave empty to use as default only)</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {LETTER_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => toggleType(t)}
              className={`rounded-full px-2 py-0.5 text-[9px] font-black border transition-colors ${f.letterTypes.includes(t) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-400'}`}>
              {LETTER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><FaTimes size={9}/> Cancel</button>
        <button onClick={() => onSave(f)} disabled={saving || !f.name.trim() || !f.title.trim()} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"><FaCheck size={9}/> {saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — Pay Component inline form
// ─────────────────────────────────────────────────────────────────────────────
const COMP_BLANK = { name: '', code: '', isTaxable: false, isStatutory: false };

function PayCompForm({ type, initial = COMP_BLANK, onSave, onCancel, saving }) {
  const [f, setF] = useState(initial);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const color = type === 'allowance' ? 'emerald' : 'rose';
  return (
    <div className={`rounded-lg border border-${color}-200 bg-${color}-50/60 p-3 space-y-2`}>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Name *</Label><input value={f.name} onChange={set('name')} className={inp} placeholder={type === 'allowance' ? 'e.g. House Allowance' : 'e.g. SACCO Deduction'} /></div>
        <div><Label>Code *</Label><input value={f.code} onChange={set('code')} className={inp} placeholder="e.g. HOUSE" /></div>
      </div>
      <div className="flex gap-4">
        {type === 'allowance' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!f.isTaxable} onChange={(e) => setF((p) => ({ ...p, isTaxable: e.target.checked }))} className="rounded" />
            <span className="text-[11px] font-black text-slate-600">Taxable (attracts PAYE)</span>
          </label>
        )}
        {type === 'deduction' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!f.isStatutory} onChange={(e) => setF((p) => ({ ...p, isStatutory: e.target.checked }))} className="rounded" />
            <span className="text-[11px] font-black text-slate-600">Statutory / Government-mandated</span>
          </label>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><FaTimes size={9}/> Cancel</button>
        <button onClick={() => onSave({ ...f, type })} disabled={saving || !f.name.trim() || !f.code.trim()} className={`inline-flex items-center gap-1 rounded-lg bg-${color}-600 px-3 py-1.5 text-xs font-black text-white hover:bg-${color}-700 disabled:opacity-50`}><FaCheck size={9}/> {saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function HRSetup() {
  const [tab, setTab] = useState('org');
  const [confirm, setConfirm] = useState({ isOpen: false });

  // ── Tab 1 state ─────────────────────────────────────────────────────────────
  const [departments,  setDepartments]  = useState([]);
  const [designations, setDesignations] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [deptSearch,   setDeptSearch]   = useState('');
  const [desigSearch,  setDesigSearch]  = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingDesigs,setLoadingDesigs]= useState(false);
  const [saving,       setSaving]       = useState(false);
  const [deptFormMode, setDeptFormMode] = useState(null);
  const [desigFormMode,setDesigFormMode]= useState(null);

  // ── Tab 2 state ─────────────────────────────────────────────────────────────
  const [signatories,    setSignatories]    = useState([]);
  const [sigFormMode,    setSigFormMode]    = useState(null);
  const [sigSaving,      setSigSaving]      = useState(false);
  const [templates,      setTemplates]      = useState([]);    // customised templates
  const [selLetterType,  setSelLetterType]  = useState('offer');
  const [tplBody,        setTplBody]        = useState('');
  const [tplSignatory,   setTplSignatory]   = useState('');
  const [tplNotes,       setTplNotes]       = useState('');
  const [tplLoading,     setTplLoading]     = useState(false);
  const [tplSaving,      setTplSaving]      = useState(false);
  const [tplIsCustom,    setTplIsCustom]    = useState(false);

  // ── Tab 3 state ─────────────────────────────────────────────────────────────
  const [allowances,  setAllowances]  = useState([]);
  const [deductions,  setDeductions]  = useState([]);
  const [compFormMode,setCompFormMode]= useState(null); // null | { type, editing? }
  const [compSaving,  setCompSaving]  = useState(false);

  // ── Tab 4 state ─────────────────────────────────────────────────────────────
  const [statutory,    setStatutory]    = useState(null);
  const [payeBands,    setPayeBands]    = useState([]);
  const [statSaving,   setStatSaving]   = useState(false);
  const [statForm,     setStatForm]     = useState({ personalRelief: '', shaRate: '', shaMin: '', nssfLower: '', nssfUpper: '', nssfRate: '', ahlRate: '' });

  // ── Load Departments / Designations ─────────────────────────────────────────
  const loadDepts = useCallback(async () => {
    setLoadingDepts(true);
    try {
      const res = await adminRequests.get('/hr/departments', { params: { search: deptSearch || undefined, includeInactive: showInactive ? 'true' : undefined } });
      setDepartments(res.data || []);
    } catch { toast.error('Failed to load departments'); }
    finally { setLoadingDepts(false); }
  }, [deptSearch, showInactive]);

  const loadDesigs = useCallback(async () => {
    if (!selectedDept) { setDesignations([]); return; }
    setLoadingDesigs(true);
    try {
      const res = await adminRequests.get('/hr/designations', { params: { department: selectedDept._id, search: desigSearch || undefined, includeInactive: showInactive ? 'true' : undefined } });
      setDesignations(res.data || []);
    } catch { toast.error('Failed to load designations'); }
    finally { setLoadingDesigs(false); }
  }, [selectedDept, desigSearch, showInactive]);

  useEffect(() => { if (tab === 'org') loadDepts(); }, [loadDepts, tab]);
  useEffect(() => { if (tab === 'org') loadDesigs(); }, [loadDesigs, tab]);

  // ── Load Signatories + Templates ─────────────────────────────────────────────
  const loadSignatories = useCallback(async () => {
    try {
      const res = await adminRequests.get('/hr/signatories');
      setSignatories(res.data || []);
    } catch { toast.error('Failed to load signatories'); }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await adminRequests.get('/hr/letter-templates');
      setTemplates(res.data || []);
    } catch {}
  }, []);

  useEffect(() => { if (tab === 'docs') { loadSignatories(); loadTemplates(); } }, [tab, loadSignatories, loadTemplates]);

  // Load template when letter type changes
  useEffect(() => {
    if (tab !== 'docs') return;
    setTplLoading(true);
    adminRequests.get(`/hr/letter-templates/${selLetterType}`)
      .then((res) => {
        if (res.data) {
          setTplBody(res.data.bodyHtml || '');
          setTplSignatory(res.data.signatory?._id || '');
          setTplNotes(res.data.notes || '');
          setTplIsCustom(true);
        } else {
          return adminRequests.get(`/hr/letter-templates/${selLetterType}/default`).then((dr) => {
            setTplBody(dr.data?.bodyHtml || '');
            setTplSignatory('');
            setTplNotes('');
            setTplIsCustom(false);
          });
        }
      })
      .catch(() => {})
      .finally(() => setTplLoading(false));
  }, [selLetterType, tab]);

  // ── Load Pay Components ────────────────────────────────────────────────────
  const loadComponents = useCallback(async () => {
    try {
      const [aRes, dRes] = await Promise.all([
        adminRequests.get('/hr/pay-components', { params: { type: 'allowance' } }),
        adminRequests.get('/hr/pay-components', { params: { type: 'deduction' } }),
      ]);
      setAllowances(aRes.data || []);
      setDeductions(dRes.data || []);
    } catch { toast.error('Failed to load pay components'); }
  }, []);

  useEffect(() => { if (tab === 'payroll') loadComponents(); }, [tab, loadComponents]);

  // ── Load Statutory ─────────────────────────────────────────────────────────
  const loadStatutory = useCallback(async () => {
    try {
      const res = await adminRequests.get('/hr/statutory-config');
      const d = res.data;
      setStatutory(d);
      setStatForm({
        personalRelief: d.personalRelief ?? 2400,
        shaRate:   pct(d.shaRate),
        shaMin:    d.shaMin ?? 500,
        nssfLower: d.nssfLower ?? 7000,
        nssfUpper: d.nssfUpper ?? 36000,
        nssfRate:  pct(d.nssfRate),
        ahlRate:   pct(d.ahlRate),
      });
      setPayeBands((d.payeBands || []).map((b) => ({ upTo: b.upTo ?? '', rate: pct(b.rate) })));
    } catch { toast.error('Failed to load statutory config'); }
  }, []);

  useEffect(() => { if (tab === 'statutory') loadStatutory(); }, [tab, loadStatutory]);

  // ─────────────────────────────────────────────────────────────────────────
  // Dept / Desig CRUD (unchanged from original)
  // ─────────────────────────────────────────────────────────────────────────
  const saveDept = async (form) => {
    setSaving(true);
    try {
      if (deptFormMode?.editing) await adminRequests.put(`/hr/departments/${deptFormMode.editing._id}`, form);
      else await adminRequests.post('/hr/departments', form);
      toast.success(deptFormMode?.editing ? 'Department updated' : 'Department created');
      setDeptFormMode(null); await loadDepts();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };
  const toggleDeptActive = async (dept) => {
    try { await adminRequests.put(`/hr/departments/${dept._id}`, { isActive: !dept.isActive }); toast.success('Updated'); loadDepts(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
  };
  const deleteDept = (dept) => setConfirm({ isOpen: true, title: 'Delete Department', message: `Delete "${dept.name}"?`, isDangerous: true, confirmText: 'Delete', onConfirm: async () => {
    try { await adminRequests.delete(`/hr/departments/${dept._id}`); toast.success('Deleted'); if (selectedDept?._id === dept._id) { setSelectedDept(null); setDesignations([]); } loadDepts(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Cannot delete'); }
    finally { setConfirm((p) => ({ ...p, isOpen: false })); }
  }});
  const saveDesig = async (form) => {
    if (!selectedDept) return;
    setSaving(true);
    try {
      if (desigFormMode?.editing) await adminRequests.put(`/hr/designations/${desigFormMode.editing._id}`, { ...form, department: selectedDept._id });
      else await adminRequests.post('/hr/designations', { ...form, department: selectedDept._id });
      toast.success(desigFormMode?.editing ? 'Designation updated' : 'Designation created');
      setDesigFormMode(null); await loadDesigs();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };
  const toggleDesigActive = async (desig) => {
    try { await adminRequests.put(`/hr/designations/${desig._id}`, { isActive: !desig.isActive }); toast.success('Updated'); loadDesigs(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
  };
  const deleteDesig = (desig) => setConfirm({ isOpen: true, title: 'Delete Designation', message: `Delete "${desig.name}"?`, isDangerous: true, confirmText: 'Delete', onConfirm: async () => {
    try { await adminRequests.delete(`/hr/designations/${desig._id}`); toast.success('Deleted'); loadDesigs(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Cannot delete'); }
    finally { setConfirm((p) => ({ ...p, isOpen: false })); }
  }});

  // ─────────────────────────────────────────────────────────────────────────
  // Signatory CRUD
  // ─────────────────────────────────────────────────────────────────────────
  const saveSig = async (form) => {
    setSigSaving(true);
    try {
      if (sigFormMode?.editing) await adminRequests.put(`/hr/signatories/${sigFormMode.editing._id}`, form);
      else await adminRequests.post('/hr/signatories', form);
      toast.success(sigFormMode?.editing ? 'Signatory updated' : 'Signatory added');
      setSigFormMode(null); await loadSignatories();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to save'); }
    finally { setSigSaving(false); }
  };
  const deleteSig = (sig) => setConfirm({ isOpen: true, title: 'Delete Signatory', message: `Delete "${sig.name}"?`, isDangerous: true, confirmText: 'Delete', onConfirm: async () => {
    try { await adminRequests.delete(`/hr/signatories/${sig._id}`); toast.success('Deleted'); loadSignatories(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setConfirm((p) => ({ ...p, isOpen: false })); }
  }});

  // ─────────────────────────────────────────────────────────────────────────
  // Letter Template save / reset
  // ─────────────────────────────────────────────────────────────────────────
  const saveTpl = async () => {
    setTplSaving(true);
    try {
      await adminRequests.put(`/hr/letter-templates/${selLetterType}`, { bodyHtml: tplBody, signatory: tplSignatory || null, notes: tplNotes });
      toast.success('Template saved');
      setTplIsCustom(true); await loadTemplates();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to save'); }
    finally { setTplSaving(false); }
  };
  const resetTpl = () => setConfirm({ isOpen: true, title: 'Reset to Default', message: `This will remove the custom template for "${LETTER_TYPE_LABELS[selLetterType]}" and revert to the system default. Continue?`, isDangerous: true, confirmText: 'Reset', onConfirm: async () => {
    try {
      await adminRequests.delete(`/hr/letter-templates/${selLetterType}`);
      toast.success('Reverted to default');
      setTplIsCustom(false); await loadTemplates();
      const dr = await adminRequests.get(`/hr/letter-templates/${selLetterType}/default`);
      setTplBody(dr.data?.bodyHtml || '');
      setTplSignatory(''); setTplNotes('');
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setConfirm((p) => ({ ...p, isOpen: false })); }
  }});

  // ─────────────────────────────────────────────────────────────────────────
  // Pay Component CRUD
  // ─────────────────────────────────────────────────────────────────────────
  const saveComp = async (form) => {
    setCompSaving(true);
    try {
      if (compFormMode?.editing) await adminRequests.put(`/hr/pay-components/${compFormMode.editing._id}`, form);
      else await adminRequests.post('/hr/pay-components', form);
      toast.success(compFormMode?.editing ? 'Updated' : 'Added');
      setCompFormMode(null); await loadComponents();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to save'); }
    finally { setCompSaving(false); }
  };
  const toggleComp = async (comp) => {
    try { await adminRequests.put(`/hr/pay-components/${comp._id}`, { isActive: !comp.isActive }); toast.success('Updated'); loadComponents(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
  };
  const deleteComp = (comp) => setConfirm({ isOpen: true, title: `Delete ${comp.type === 'allowance' ? 'Allowance' : 'Deduction'}`, message: `Delete "${comp.name}"?`, isDangerous: true, confirmText: 'Delete', onConfirm: async () => {
    try { await adminRequests.delete(`/hr/pay-components/${comp._id}`); toast.success('Deleted'); loadComponents(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setConfirm((p) => ({ ...p, isOpen: false })); }
  }});

  // ─────────────────────────────────────────────────────────────────────────
  // Statutory save
  // ─────────────────────────────────────────────────────────────────────────
  const saveStatutory = async () => {
    setStatSaving(true);
    try {
      const bands = payeBands.map((b, i) => ({
        upTo: i === payeBands.length - 1 ? null : (Number(b.upTo) || null),
        rate: dec(b.rate),
      }));
      await adminRequests.put('/hr/statutory-config', {
        personalRelief: Number(statForm.personalRelief),
        payeBands: bands,
        shaRate:   dec(statForm.shaRate),
        shaMin:    Number(statForm.shaMin),
        nssfLower: Number(statForm.nssfLower),
        nssfUpper: Number(statForm.nssfUpper),
        nssfRate:  dec(statForm.nssfRate),
        ahlRate:   dec(statForm.ahlRate),
      });
      toast.success('Statutory rates saved');
      await loadStatutory();
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to save'); }
    finally { setStatSaving(false); }
  };
  const resetStatutory = () => setConfirm({ isOpen: true, title: 'Reset to Kenya Defaults', message: 'This will reset all statutory rates to the current Kenya defaults. Continue?', isDangerous: true, confirmText: 'Reset', onConfirm: async () => {
    try { await adminRequests.delete('/hr/statutory-config'); toast.success('Reset to defaults'); await loadStatutory(); }
    catch (e) { toast.error(e?.response?.data?.message || 'Failed'); }
    finally { setConfirm((p) => ({ ...p, isOpen: false })); }
  }});

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'org',      label: 'Organization',      icon: FaBuilding },
    { id: 'docs',     label: 'Documents',          icon: FaFileAlt  },
    { id: 'payroll',  label: 'Payroll Components', icon: FaMoneyBillWave },
    { id: 'statutory',label: 'Statutory Rates',    icon: FaPercent  },
  ];

  const compList = (items, type) => (
    <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
      {items.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-xs text-slate-400">No {type === 'allowance' ? 'allowances' : 'deductions'} yet</div>
      ) : items.map((c) => (
        <div key={c._id} className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black text-slate-800">{c.name}</span>
              <span className="rounded bg-slate-100 px-1.5 text-[9px] font-black text-slate-500">{c.code}</span>
              {type === 'allowance' && c.isTaxable   && <span className="rounded bg-amber-100 px-1.5 text-[9px] font-black text-amber-700">Taxable</span>}
              {type === 'deduction' && c.isStatutory && <span className="rounded bg-blue-100 px-1.5 text-[9px] font-black text-blue-700">Statutory</span>}
              {!c.isActive && <span className="rounded bg-rose-50 px-1.5 text-[9px] font-black text-rose-500">Inactive</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button onClick={() => setCompFormMode({ type, editing: c })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit"><FaEdit size={9}/></button>
            <button onClick={() => toggleComp(c)} className={`rounded p-1.5 ${c.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-400 hover:bg-amber-50'}`} title={c.isActive ? 'Deactivate' : 'Activate'}>{c.isActive ? <FaToggleOn size={11}/> : <FaToggleOff size={11}/>}</button>
            <button onClick={() => deleteComp(c)} className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500" title="Delete"><FaTrash size={9}/></button>
          </div>
        </div>
      ))}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
              <h1 className="text-sm font-black text-slate-900 leading-tight">HR Setup & Configuration</h1>
            </div>
            {tab === 'org' && (
              <div className="flex items-center gap-2">
                <button onClick={() => setShowInactive((p) => !p)} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold ${showInactive ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                  {showInactive ? <FaToggleOn size={10}/> : <FaToggleOff size={10}/>} {showInactive ? 'Showing Inactive' : 'Active Only'}
                </button>
                <button onClick={loadDepts} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"><FaRedoAlt size={10}/> Refresh</button>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="mt-3 flex gap-1 border-b border-slate-100 pb-0">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-black rounded-t-lg border-b-2 transition-colors ${tab === id ? 'border-[#0B3B2E] text-[#0B3B2E] bg-emerald-50/60' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
                <Icon size={9}/> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="min-h-0 flex-1 overflow-hidden">

          {/* ── TAB 1: Organization ─────────────────────────────────────────── */}
          {tab === 'org' && (
            <div className="flex h-full divide-x divide-slate-200">

              {/* Departments */}
              <div className="flex w-[340px] flex-shrink-0 flex-col bg-white">
                <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <FaBuilding size={11} className="text-emerald-700"/>
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Departments</span>
                      <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{departments.length}</span>
                    </div>
                    <button onClick={() => setDeptFormMode('new')} className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#0a2e23]"><FaPlus size={8}/> New</button>
                  </div>
                  <div className="relative mt-2">
                    <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400"/>
                    <input value={deptSearch} onChange={(e) => setDeptSearch(e.target.value)} placeholder="Search departments..." className="h-7 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"/>
                  </div>
                </div>
                {deptFormMode === 'new' && <div className="flex-shrink-0 border-b border-slate-100 p-3"><DeptForm onSave={saveDept} onCancel={() => setDeptFormMode(null)} saving={saving}/></div>}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {loadingDepts ? <div className="flex h-24 items-center justify-center text-xs text-slate-400">Loading…</div>
                  : departments.length === 0 ? <div className="flex h-24 items-center justify-center text-xs text-slate-400">No departments yet</div>
                  : departments.map((dept) => (
                    <div key={dept._id}>
                      <div className={`flex cursor-pointer items-center justify-between px-4 py-2.5 hover:bg-slate-50 ${selectedDept?._id === dept._id ? 'bg-emerald-50 border-l-2 border-emerald-600' : ''}`} onClick={() => { setSelectedDept(dept); setDesigFormMode(null); }}>
                        {deptFormMode?.editing?._id === dept._id ? (
                          <div className="flex-1 p-1"><DeptForm initial={{ name: dept.name, code: dept.code || '', description: dept.description || '' }} onSave={saveDept} onCancel={() => setDeptFormMode(null)} saving={saving}/></div>
                        ) : (
                          <>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-black text-slate-800">{dept.name}</span>
                                {dept.code && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">{dept.code}</span>}
                                {!dept.isActive && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-black text-rose-500">Inactive</span>}
                              </div>
                              {dept.description && <p className="mt-0.5 text-[10px] text-slate-400 truncate max-w-[200px]">{dept.description}</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button onClick={(e) => { e.stopPropagation(); setDeptFormMode({ editing: dept }); }} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><FaEdit size={9}/></button>
                              <button onClick={(e) => { e.stopPropagation(); toggleDeptActive(dept); }} className={`rounded p-1.5 ${dept.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-400 hover:bg-amber-50'}`}>{dept.isActive ? <FaToggleOn size={11}/> : <FaToggleOff size={11}/>}</button>
                              <button onClick={(e) => { e.stopPropagation(); deleteDept(dept); }} className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><FaTrash size={9}/></button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Designations */}
              <div className="flex min-w-0 flex-1 flex-col bg-white">
                <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <FaTag size={10} className="text-orange-500"/>
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Designations</span>
                      {selectedDept && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{designations.length}</span>}
                    </div>
                    {selectedDept && <button onClick={() => setDesigFormMode('new')} className="inline-flex items-center gap-1 rounded-lg bg-[#FF8C00] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#e67e00]"><FaPlus size={8}/> New</button>}
                  </div>
                  {selectedDept && (
                    <div className="relative mt-2">
                      <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400"/>
                      <input value={desigSearch} onChange={(e) => setDesigSearch(e.target.value)} placeholder="Search designations..." className="h-7 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-3 text-[11px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"/>
                    </div>
                  )}
                </div>
                {!selectedDept ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-400">Select a department to manage its designations</div>
                ) : (
                  <>
                    {desigFormMode === 'new' && <div className="flex-shrink-0 border-b border-slate-100 p-3"><DesigForm onSave={saveDesig} onCancel={() => setDesigFormMode(null)} saving={saving}/></div>}
                    <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                      {loadingDesigs ? <div className="flex h-24 items-center justify-center text-xs text-slate-400">Loading…</div>
                      : designations.length === 0 ? <div className="flex h-24 items-center justify-center text-xs text-slate-400">No designations in this department</div>
                      : designations.map((desig) => (
                        <div key={desig._id} className="px-4 py-2.5 hover:bg-slate-50">
                          {desigFormMode?.editing?._id === desig._id ? (
                            <DesigForm initial={{ name: desig.name, gradeLevel: desig.gradeLevel || '', description: desig.description || '' }} onSave={saveDesig} onCancel={() => setDesigFormMode(null)} saving={saving}/>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-black text-slate-800">{desig.name}</span>
                                  {desig.gradeLevel && <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black text-indigo-600">{desig.gradeLevel}</span>}
                                  {!desig.isActive && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-black text-rose-500">Inactive</span>}
                                </div>
                                {desig.description && <p className="mt-0.5 text-[10px] text-slate-400">{desig.description}</p>}
                              </div>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <button onClick={() => setDesigFormMode({ editing: desig })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><FaEdit size={9}/></button>
                                <button onClick={() => toggleDesigActive(desig)} className={`rounded p-1.5 ${desig.isActive ? 'text-emerald-500 hover:bg-emerald-50' : 'text-amber-400 hover:bg-amber-50'}`}>{desig.isActive ? <FaToggleOn size={11}/> : <FaToggleOff size={11}/>}</button>
                                <button onClick={() => deleteDesig(desig)} className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><FaTrash size={9}/></button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 2: Documents ────────────────────────────────────────────── */}
          {tab === 'docs' && (
            <div className="flex h-full divide-x divide-slate-200">

              {/* Signatories panel */}
              <div className="flex w-[280px] flex-shrink-0 flex-col bg-white">
                <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <FaUserTie size={10} className="text-indigo-600"/>
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Signatories</span>
                    </div>
                    <button onClick={() => setSigFormMode('new')} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-indigo-700"><FaPlus size={8}/> Add</button>
                  </div>
                </div>
                {sigFormMode === 'new' && <div className="flex-shrink-0 border-b border-slate-100 p-3"><SignatoryForm onSave={saveSig} onCancel={() => setSigFormMode(null)} saving={sigSaving}/></div>}
                <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                  {signatories.length === 0 ? (
                    <div className="flex h-32 flex-col items-center justify-center gap-1.5 text-slate-300">
                      <FaUserTie size={18}/>
                      <p className="text-[11px] font-black">No signatories yet</p>
                      <p className="text-[10px] text-slate-400 text-center px-4">Add at least one signatory to personalise letter sign-offs</p>
                    </div>
                  ) : signatories.map((sig) => (
                    <div key={sig._id}>
                      {sigFormMode?.editing?._id === sig._id ? (
                        <div className="p-3"><SignatoryForm initial={{ name: sig.name, title: sig.title, department: sig.department || '', isDefault: sig.isDefault, letterTypes: sig.letterTypes || [] }} onSave={saveSig} onCancel={() => setSigFormMode(null)} saving={sigSaving}/></div>
                      ) : (
                        <div className="px-3 py-2.5 hover:bg-slate-50">
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-black text-slate-900 truncate">{sig.name}</span>
                                {sig.isDefault && <FaStar size={9} className="text-amber-400 shrink-0" title="Default signatory"/>}
                              </div>
                              <div className="text-[10px] text-slate-500">{sig.title}</div>
                              {sig.department && <div className="text-[10px] text-slate-400">{sig.department}</div>}
                              {sig.letterTypes?.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-0.5">
                                  {sig.letterTypes.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-indigo-50 px-1.5 text-[9px] font-black text-indigo-600">{LETTER_TYPE_LABELS[t]}</span>)}
                                  {sig.letterTypes.length > 3 && <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-black text-slate-500">+{sig.letterTypes.length - 3}</span>}
                                </div>
                              )}
                            </div>
                            <div className="flex shrink-0 gap-0.5">
                              <button onClick={() => setSigFormMode({ editing: sig })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><FaEdit size={9}/></button>
                              <button onClick={() => deleteSig(sig)} className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><FaTrash size={9}/></button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Letter Templates panel */}
              <div className="flex min-w-0 flex-1 flex-col bg-white">
                <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <FaFileAlt size={10} className="text-emerald-700"/>
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Letter Templates</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {tplIsCustom && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700">Custom Active</span>}
                      {tplIsCustom && <button onClick={resetTpl} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:bg-slate-50"><FaUndo size={8}/> Reset Default</button>}
                      <button onClick={saveTpl} disabled={tplSaving} className="inline-flex items-center gap-1 rounded-lg bg-[#0B3B2E] px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-[#0a2e23] disabled:opacity-50"><FaCheck size={8}/> {tplSaving ? 'Saving…' : 'Save Template'}</button>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 flex overflow-hidden">
                  {/* Type selector */}
                  <div className="flex-shrink-0 w-44 border-r border-slate-100 overflow-y-auto">
                    {LETTER_TYPES.map((t) => {
                      const hasCustom = templates.some((tpl) => tpl.letterType === t);
                      return (
                        <button key={t} onClick={() => setSelLetterType(t)}
                          className={`w-full text-left px-3 py-2 text-[11px] font-semibold flex items-center justify-between gap-1 hover:bg-slate-50 transition-colors ${selLetterType === t ? 'bg-emerald-50 text-emerald-800 font-black border-l-2 border-emerald-600' : 'text-slate-600'}`}>
                          <span className="truncate">{LETTER_TYPE_LABELS[t]}</span>
                          {hasCustom && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500" title="Custom template"/>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Editor */}
                  <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    {tplLoading ? (
                      <div className="flex h-full items-center justify-center text-xs text-slate-400">Loading template…</div>
                    ) : (
                      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{LETTER_TYPE_LABELS[selLetterType]} — Body HTML</span>
                          </div>
                          {/* Signatory selector */}
                          <div className="mb-2">
                            <Label>Signatory for this letter type</Label>
                            <select value={tplSignatory} onChange={(e) => setTplSignatory(e.target.value)} className="h-7 w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                              <option value="">— Use type-assigned or default signatory —</option>
                              {signatories.map((s) => <option key={s._id} value={s._id}>{s.name} — {s.title}</option>)}
                            </select>
                          </div>
                          <textarea value={tplBody} onChange={(e) => setTplBody(e.target.value)} className="flex-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E] resize-none" placeholder="Enter HTML body with {{placeholders}}…" spellCheck={false}/>
                          <div className="mt-2">
                            <Label>Internal Notes (not printed)</Label>
                            <input value={tplNotes} onChange={(e) => setTplNotes(e.target.value)} className={inp} placeholder="e.g. Updated per legal review May 2026"/>
                          </div>
                        </div>
                        {/* Placeholder reference */}
                        <div className="w-52 flex-shrink-0 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
                          <div className="flex items-center gap-1 mb-2">
                            <FaInfoCircle size={9} className="text-slate-400"/>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Placeholders</span>
                          </div>
                          <div className="space-y-1.5">
                            {PLACEHOLDERS.map(([tag, desc]) => (
                              <div key={tag}>
                                <code className="block text-[10px] font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{tag}</code>
                                <span className="text-[9px] text-slate-500">{desc}</span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 pt-3 border-t border-slate-200">
                            <p className="text-[9px] text-slate-400 leading-relaxed">The header (date, ref, employee address) and footer (sign block) are always auto-generated. Only edit the body between salutation and sign-off.</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 3: Payroll Components ────────────────────────────────────── */}
          {tab === 'payroll' && (
            <div className="flex h-full divide-x divide-slate-200">

              {/* Allowances */}
              <div className="flex w-1/2 flex-col bg-white">
                <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <FaMoneyBillWave size={10} className="text-emerald-600"/>
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Allowances</span>
                      <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{allowances.length}</span>
                    </div>
                    <button onClick={() => setCompFormMode({ type: 'allowance' })} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-emerald-700"><FaPlus size={8}/> Add</button>
                  </div>
                </div>
                {compFormMode?.type === 'allowance' && !compFormMode.editing && (
                  <div className="flex-shrink-0 border-b border-slate-100 p-3"><PayCompForm type="allowance" onSave={saveComp} onCancel={() => setCompFormMode(null)} saving={compSaving}/></div>
                )}
                {compFormMode?.type === 'allowance' && compFormMode.editing && (
                  <div className="flex-shrink-0 border-b border-slate-100 p-3"><PayCompForm type="allowance" initial={compFormMode.editing} onSave={saveComp} onCancel={() => setCompFormMode(null)} saving={compSaving}/></div>
                )}
                {compList(allowances, 'allowance')}
              </div>

              {/* Deductions */}
              <div className="flex w-1/2 flex-col bg-white">
                <div className="flex-shrink-0 border-b border-slate-100 px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <FaMoneyBillWave size={10} className="text-rose-500"/>
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">Deductions</span>
                      <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">{deductions.length}</span>
                    </div>
                    <button onClick={() => setCompFormMode({ type: 'deduction' })} className="inline-flex items-center gap-1 rounded-lg bg-rose-500 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-rose-600"><FaPlus size={8}/> Add</button>
                  </div>
                </div>
                {compFormMode?.type === 'deduction' && !compFormMode.editing && (
                  <div className="flex-shrink-0 border-b border-slate-100 p-3"><PayCompForm type="deduction" onSave={saveComp} onCancel={() => setCompFormMode(null)} saving={compSaving}/></div>
                )}
                {compFormMode?.type === 'deduction' && compFormMode.editing && (
                  <div className="flex-shrink-0 border-b border-slate-100 p-3"><PayCompForm type="deduction" initial={compFormMode.editing} onSave={saveComp} onCancel={() => setCompFormMode(null)} saving={compSaving}/></div>
                )}
                {compList(deductions, 'deduction')}
              </div>
            </div>
          )}

          {/* ── TAB 4: Statutory Rates ───────────────────────────────────────── */}
          {tab === 'statutory' && (
            <div className="h-full overflow-y-auto p-5">
              <div className="mx-auto max-w-2xl space-y-5">

                {/* Relief + other rates */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <FaPercent size={11} className="text-emerald-700"/>
                    <span className="text-xs font-black uppercase tracking-widest text-slate-700">Rates & Relief</span>
                    {statutory?._isDefault && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-700">Kenya Defaults</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Personal Relief (KES / month)</Label><input type="number" value={statForm.personalRelief} onChange={(e) => setStatForm((p) => ({ ...p, personalRelief: e.target.value }))} className={inp}/></div>
                    <div><Label>SHA / NHIF Rate (%)</Label><input type="number" step="0.01" value={statForm.shaRate} onChange={(e) => setStatForm((p) => ({ ...p, shaRate: e.target.value }))} className={inp}/></div>
                    <div><Label>SHA Minimum Contribution (KES)</Label><input type="number" value={statForm.shaMin} onChange={(e) => setStatForm((p) => ({ ...p, shaMin: e.target.value }))} className={inp}/></div>
                    <div><Label>NSSF Tier I Upper Limit (KES)</Label><input type="number" value={statForm.nssfLower} onChange={(e) => setStatForm((p) => ({ ...p, nssfLower: e.target.value }))} className={inp}/></div>
                    <div><Label>NSSF Tier II Upper Limit (KES)</Label><input type="number" value={statForm.nssfUpper} onChange={(e) => setStatForm((p) => ({ ...p, nssfUpper: e.target.value }))} className={inp}/></div>
                    <div><Label>NSSF Contribution Rate (%)</Label><input type="number" step="0.01" value={statForm.nssfRate} onChange={(e) => setStatForm((p) => ({ ...p, nssfRate: e.target.value }))} className={inp}/></div>
                    <div><Label>AHL Levy Rate (%)</Label><input type="number" step="0.01" value={statForm.ahlRate} onChange={(e) => setStatForm((p) => ({ ...p, ahlRate: e.target.value }))} className={inp}/></div>
                  </div>
                </div>

                {/* PAYE bands */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FaPercent size={11} className="text-emerald-700"/>
                      <span className="text-xs font-black uppercase tracking-widest text-slate-700">PAYE Tax Bands</span>
                    </div>
                    <button onClick={() => setPayeBands((p) => [...p.slice(0, -1), { upTo: '', rate: '' }, { upTo: '', rate: p[p.length - 1]?.rate || '' }])} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black text-slate-600 hover:bg-slate-50"><FaPlus size={8}/> Add Band</button>
                  </div>
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
                      <span>Income Up To (KES)</span><span>Rate (%)</span><span></span>
                    </div>
                    {payeBands.map((band, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                        <input type="number" value={i === payeBands.length - 1 ? '' : band.upTo} disabled={i === payeBands.length - 1} onChange={(e) => setPayeBands((p) => p.map((b, j) => j === i ? { ...b, upTo: e.target.value } : b))} className={`${inp} ${i === payeBands.length - 1 ? 'bg-slate-100 text-slate-400' : ''}`} placeholder={i === payeBands.length - 1 ? 'Top band (no limit)' : 'e.g. 24000'}/>
                        <div className="relative"><input type="number" step="0.01" value={band.rate} onChange={(e) => setPayeBands((p) => p.map((b, j) => j === i ? { ...b, rate: e.target.value } : b))} className={inp} placeholder="e.g. 10"/><span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">%</span></div>
                        {payeBands.length > 1 ? <button onClick={() => setPayeBands((p) => p.filter((_, j) => j !== i))} className="rounded p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><FaTrash size={9}/></button> : <div className="w-7"/>}
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-slate-400">Bands are applied progressively. The last band (no upper limit) applies to all income above the previous band.</p>
                </div>

                {/* Actions */}
                <div className="flex justify-between">
                  <button onClick={resetStatutory} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"><FaUndo size={10}/> Reset to Kenya Defaults</button>
                  <button onClick={saveStatutory} disabled={statSaving} className="inline-flex items-center gap-1.5 rounded-xl bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0a2e23] disabled:opacity-50"><FaCheck size={10}/> {statSaving ? 'Saving…' : 'Save Rates'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <MilikConfirmDialog {...confirm} onClose={() => setConfirm((p) => ({ ...p, isOpen: false }))}/>
    </DashboardLayout>
  );
}
