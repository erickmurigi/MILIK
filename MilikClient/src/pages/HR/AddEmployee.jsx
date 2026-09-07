import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FaArrowLeft, FaSave, FaUser, FaBriefcase, FaMoneyBillWave,
  FaHeartbeat, FaPlus, FaTrash,
} from 'react-icons/fa';
import AppSelect from "../../components/common/AppSelect";
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { adminRequests } from '../../utils/requestMethods';
import { toast } from 'react-toastify';

const TABS = [
  { key: 'personal',      label: 'Personal',        icon: FaUser },
  { key: 'employment',    label: 'Employment',       icon: FaBriefcase },
  { key: 'compensation',  label: 'Compensation',     icon: FaMoneyBillWave },
  { key: 'emergency',     label: 'Emergency Contact',icon: FaHeartbeat },
];

const EMPTY_FORM = {
  surname: '', otherNames: '', gender: '', dateOfBirth: '',
  nationalId: '', kraPin: '', nhifNo: '', nssfNo: '', helbNo: '',
  phoneNumber: '', email: '', physicalAddress: '', postalAddress: '',
  nextOfKinName: '', nextOfKinRelationship: '', nextOfKinPhone: '',
  department: '', designation: '', reportsTo: '', employmentType: '',
  dateJoined: '', contractStartDate: '', contractEndDate: '', probationEndDate: '',
  basicSalary: '', paymentMethod: 'Bank Transfer',
  bankName: '', bankAccountNumber: '', bankBranch: '', mpesaNumber: '',
  salaryComponents: [],
};

const Field = ({ label, required, children, span }) => (
  <label className={`flex flex-col gap-0.5 text-xs font-semibold text-slate-700 ${span === 2 ? 'sm:col-span-2' : ''}`}>
    <span>{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</span>
    {children}
  </label>
);

const Input = (props) => (
  <input {...props} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20" />
);


export default function AddEmployee() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id) && id !== 'new';

  const [tab, setTab] = useState('personal');
  const [form, setForm] = useState(EMPTY_FORM);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [payComponents, setPayComponents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (field, value) => setForm((p) => ({ ...p, [field]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deptRes, empRes, compRes] = await Promise.all([
        adminRequests.get('/hr/departments'),
        adminRequests.get('/hr/employees', { params: { limit: 200 } }),
        adminRequests.get('/hr/pay-components', { params: { active: true } }),
      ]);
      setDepartments(deptRes.data || []);
      setEmployees((empRes.data?.employees || []).filter((e) => e._id !== id));
      setPayComponents(compRes.data || []);

      if (isEditing) {
        const res = await adminRequests.get(`/hr/employees/${id}`);
        const e = res.data;
        setForm({
          surname: e.surname || '', otherNames: e.otherNames || '',
          gender: e.gender || '', dateOfBirth: e.dateOfBirth ? e.dateOfBirth.split('T')[0] : '',
          nationalId: e.nationalId || '', kraPin: e.kraPin || '',
          nhifNo: e.nhifNo || '', nssfNo: e.nssfNo || '', helbNo: e.helbNo || '',
          phoneNumber: e.phoneNumber || '', email: e.email || '',
          physicalAddress: e.physicalAddress || '', postalAddress: e.postalAddress || '',
          nextOfKinName: e.nextOfKinName || '', nextOfKinRelationship: e.nextOfKinRelationship || '',
          nextOfKinPhone: e.nextOfKinPhone || '',
          department: e.department?._id || e.department || '',
          designation: e.designation?._id || e.designation || '',
          reportsTo: e.reportsTo?._id || e.reportsTo || '',
          employmentType: e.employmentType || '',
          dateJoined: e.dateJoined ? e.dateJoined.split('T')[0] : '',
          contractStartDate: e.contractStartDate ? e.contractStartDate.split('T')[0] : '',
          contractEndDate: e.contractEndDate ? e.contractEndDate.split('T')[0] : '',
          probationEndDate: e.probationEndDate ? e.probationEndDate.split('T')[0] : '',
          basicSalary: e.basicSalary ?? '', paymentMethod: e.paymentMethod || 'Bank Transfer',
          bankName: e.bankName || '', bankAccountNumber: e.bankAccountNumber || '',
          bankBranch: e.bankBranch || '', mpesaNumber: e.mpesaNumber || '',
          salaryComponents: (e.salaryComponents || []).map((c) => ({ ...c, _isCustom: false })),
        });
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [id, isEditing]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!form.department) { setDesignations([]); return; }
    adminRequests.get('/hr/designations', { params: { department: form.department } })
      .then((r) => setDesignations(r.data || []))
      .catch(() => setDesignations([]));
  }, [form.department]);

  const addComponent = () => setForm((p) => ({
    ...p, salaryComponents: [...p.salaryComponents, { name: '', type: 'Allowance', amount: '', isPercentage: false, percentageBase: 'Basic', _isCustom: false }],
  }));

  const updateComponent = (idx, field, value) => setForm((p) => ({
    ...p,
    salaryComponents: p.salaryComponents.map((c, i) => i === idx ? { ...c, [field]: value } : c),
  }));

  const removeComponent = (idx) => setForm((p) => ({
    ...p, salaryComponents: p.salaryComponents.filter((_, i) => i !== idx),
  }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.surname.trim()) { toast.error('Surname is required'); setTab('personal'); return; }
    if (!form.otherNames.trim()) { toast.error('Other names are required'); setTab('personal'); return; }
    if (!form.phoneNumber.trim()) { toast.error('Phone number is required'); setTab('personal'); return; }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error('Enter a valid email address'); setTab('personal'); return;
    }
    if (form.dateOfBirth && new Date(form.dateOfBirth) > new Date()) {
      toast.error('Date of birth cannot be in the future'); setTab('personal'); return;
    }
    if (!form.employmentType) { toast.error('Employment type is required'); setTab('employment'); return; }
    if (!form.dateJoined) { toast.error('Date joined is required'); setTab('employment'); return; }
    if (form.basicSalary !== '' && (isNaN(Number(form.basicSalary)) || Number(form.basicSalary) < 0)) {
      toast.error('Basic salary must be a positive number'); setTab('compensation'); return;
    }
    const badComp = form.salaryComponents.find((c) => !c.name?.trim());
    if (badComp) { toast.error('All salary components must have a name'); setTab('compensation'); return; }

    const payload = {
      ...form,
      basicSalary: form.basicSalary !== '' ? Number(form.basicSalary) : 0,
      salaryComponents: form.salaryComponents.map(({ _isCustom: _, ...c }) => ({ ...c, amount: Number(c.amount) || 0 })),
      department: form.department || null,
      designation: form.designation || null,
      reportsTo: form.reportsTo || null,
    };
    ['dateOfBirth', 'dateJoined', 'contractStartDate', 'contractEndDate', 'probationEndDate'].forEach((f) => {
      if (!payload[f]) payload[f] = null;
    });

    setSaving(true);
    try {
      if (isEditing) {
        await adminRequests.put(`/hr/employees/${id}`, payload);
        toast.success('Employee updated successfully');
      } else {
        await adminRequests.post('/hr/employees', payload);
        toast.success('Employee created successfully');
      }
      navigate('/hr/employees');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  };

  const compAllowances = useMemo(() => payComponents.filter((c) => c.type === 'allowance'), [payComponents]);
  const compDeductions = useMemo(() => payComponents.filter((c) => c.type === 'deduction'), [payComponents]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3 py-1.5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/hr/employees')} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline">
                <FaArrowLeft size={10} /> Back
              </button>
              <div className="h-4 w-px bg-slate-300" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Human Resource</div>
                <h1 className="text-sm font-black text-slate-900 leading-tight">{isEditing ? 'Edit Employee' : 'New Employee'}</h1>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading...</div>
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">

            {/* Tab nav */}
            <div className="flex-shrink-0 border-b border-slate-200 bg-white px-3 py-1.5">
              <div className="flex items-center gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`h-[20px] shrink-0 inline-flex items-center gap-0.5 px-1.5 text-[9px] font-bold whitespace-nowrap ${
                      tab === t.key
                        ? 'bg-[#0B3B2E] text-white'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <t.icon size={7} /> {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">

              {/* ── Personal ─────────────────────────────────────── */}
              {tab === 'personal' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Basic Information</div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Surname" required><Input value={form.surname} onChange={(e) => set('surname', e.target.value)} /></Field>
                      <Field label="Other Names" required><Input value={form.otherNames} onChange={(e) => set('otherNames', e.target.value)} /></Field>
                      <Field label="Gender">
                        <AppSelect
                          value={form.gender}
                          onChange={(v) => set('gender', v ?? '')}
                          options={[
                            { value: 'Male', label: 'Male' },
                            { value: 'Female', label: 'Female' },
                            { value: 'Other', label: 'Other' },
                          ]}
                          placeholder="Select gender"
                          clearable
                          size="md"
                        />
                      </Field>
                      <Field label="Date of Birth"><Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
                      <Field label="National ID / Passport"><Input value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} /></Field>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Kenya Statutory Numbers</div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="KRA PIN"><Input value={form.kraPin} onChange={(e) => set('kraPin', e.target.value.toUpperCase())} placeholder="A000000000A" /></Field>
                      <Field label="NHIF No."><Input value={form.nhifNo} onChange={(e) => set('nhifNo', e.target.value)} /></Field>
                      <Field label="NSSF No."><Input value={form.nssfNo} onChange={(e) => set('nssfNo', e.target.value)} /></Field>
                      <Field label="HELB No."><Input value={form.helbNo} onChange={(e) => set('helbNo', e.target.value)} /></Field>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Contact Details</div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Phone Number" required><Input value={form.phoneNumber} onChange={(e) => set('phoneNumber', e.target.value)} placeholder="07XXXXXXXX" /></Field>
                      <Field label="Email Address"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
                      <Field label="Physical Address"><Input value={form.physicalAddress} onChange={(e) => set('physicalAddress', e.target.value)} /></Field>
                      <Field label="Postal Address"><Input value={form.postalAddress} onChange={(e) => set('postalAddress', e.target.value)} /></Field>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Employment ───────────────────────────────────── */}
              {tab === 'employment' && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Department">
                      <AppSelect
                        value={form.department}
                        onChange={(v) => { set('department', v ?? ''); set('designation', ''); }}
                        options={departments.map((d) => ({ value: d._id, label: d.name }))}
                        placeholder="Select department"
                        searchable
                        clearable
                        size="md"
                      />
                    </Field>
                    <Field label="Designation">
                      <AppSelect
                        value={form.designation}
                        onChange={(v) => set('designation', v ?? '')}
                        options={designations.map((d) => ({ value: d._id, label: d.name }))}
                        placeholder="Select designation"
                        disabled={!form.department}
                        size="md"
                      />
                    </Field>
                    <Field label="Reports To">
                      <AppSelect
                        value={form.reportsTo}
                        onChange={(v) => set('reportsTo', v ?? '')}
                        options={employees.map((e) => ({ value: e._id, label: `${e.surname} ${e.otherNames} (${e.employeeNumber})` }))}
                        placeholder="Select supervisor"
                        searchable
                        clearable
                        size="md"
                      />
                    </Field>
                    <Field label="Employment Type" required>
                      <AppSelect
                        value={form.employmentType}
                        onChange={(v) => set('employmentType', v ?? '')}
                        options={[
                          { value: 'Permanent', label: 'Permanent' },
                          { value: 'Contract', label: 'Contract' },
                          { value: 'Casual', label: 'Casual' },
                          { value: 'Intern', label: 'Intern' },
                        ]}
                        placeholder="Select type"
                        size="md"
                      />
                    </Field>
                    <Field label="Date Joined" required><Input type="date" value={form.dateJoined} onChange={(e) => set('dateJoined', e.target.value)} /></Field>
                    <Field label="Probation End Date"><Input type="date" value={form.probationEndDate} onChange={(e) => set('probationEndDate', e.target.value)} /></Field>
                    <Field label="Contract Start Date"><Input type="date" value={form.contractStartDate} onChange={(e) => set('contractStartDate', e.target.value)} /></Field>
                    <Field label="Contract End Date"><Input type="date" value={form.contractEndDate} onChange={(e) => set('contractEndDate', e.target.value)} /></Field>
                  </div>
                </div>
              )}

              {/* ── Compensation ─────────────────────────────────── */}
              {tab === 'compensation' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Salary</div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Basic Salary (KES)">
                        <Input type="number" min="0" value={form.basicSalary} onChange={(e) => set('basicSalary', e.target.value)} placeholder="0.00" />
                      </Field>
                      <Field label="Payment Method">
                        <AppSelect
                          value={form.paymentMethod}
                          onChange={(v) => set('paymentMethod', v ?? 'Bank Transfer')}
                          options={[
                            { value: 'Bank Transfer', label: 'Bank Transfer' },
                            { value: 'Cash', label: 'Cash' },
                            { value: 'M-Pesa', label: 'M-Pesa' },
                          ]}
                          size="md"
                        />
                      </Field>
                    </div>
                    {form.paymentMethod === 'Bank Transfer' && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <Field label="Bank Name"><Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} /></Field>
                        <Field label="Account Number"><Input value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} /></Field>
                        <Field label="Branch"><Input value={form.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} /></Field>
                      </div>
                    )}
                    {form.paymentMethod === 'M-Pesa' && (
                      <div className="mt-3 max-w-xs">
                        <Field label="M-Pesa Number"><Input value={form.mpesaNumber} onChange={(e) => set('mpesaNumber', e.target.value)} placeholder="07XXXXXXXX" /></Field>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Allowances & Deductions</span>
                      <button type="button" onClick={addComponent} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700 hover:bg-emerald-100">
                        <FaPlus size={8} /> Add Component
                      </button>
                    </div>
                    {form.salaryComponents.length === 0 ? (
                      <p className="text-xs text-slate-400">No additional components. Basic salary only.</p>
                    ) : (
                      <div className="space-y-2">
                        {form.salaryComponents.map((comp, idx) => {
                          const allowances = compAllowances;
                          const deductions = compDeductions;
                          return (
                          <div key={idx} className="grid gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-5">
                            <div className="sm:col-span-2">
                              <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Name</label>
                              {!comp._isCustom ? (
                                <AppSelect
                                  value={comp.name}
                                  onChange={(v) => {
                                    if (v === '__custom__') {
                                      updateComponent(idx, '_isCustom', true);
                                      updateComponent(idx, 'name', '');
                                    } else {
                                      const found = payComponents.find((c) => c.name === v);
                                      updateComponent(idx, 'name', v ?? '');
                                      if (found) updateComponent(idx, 'type', found.type === 'allowance' ? 'Allowance' : 'Deduction');
                                    }
                                  }}
                                  options={[
                                    ...(allowances.length > 0 ? [
                                      { value: '__h_allowances__', label: 'Allowances', disabled: true },
                                      ...allowances.map((c) => ({ value: c.name, label: c.name })),
                                    ] : []),
                                    ...(deductions.length > 0 ? [
                                      { value: '__h_deductions__', label: 'Deductions', disabled: true },
                                      ...deductions.map((c) => ({ value: c.name, label: c.name })),
                                    ] : []),
                                    { value: '__custom__', label: 'Other (custom name…)' },
                                  ]}
                                  placeholder="— Select component —"
                                  size="md"
                                />
                              ) : (
                                <div className="flex gap-1">
                                  <Input
                                    value={comp.name}
                                    onChange={(e) => updateComponent(idx, 'name', e.target.value)}
                                    placeholder="Enter component name"
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    title="Back to list"
                                    onClick={() => { updateComponent(idx, '_isCustom', false); updateComponent(idx, 'name', ''); }}
                                    className="shrink-0 rounded border border-slate-200 bg-slate-50 px-2 text-[10px] text-slate-500 hover:bg-slate-100"
                                  >↩</button>
                                </div>
                              )}
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">Type</label>
                              <AppSelect
                                value={comp.type}
                                onChange={(v) => updateComponent(idx, 'type', v ?? 'Allowance')}
                                options={[
                                  { value: 'Allowance', label: 'Allowance' },
                                  { value: 'Deduction', label: 'Deduction' },
                                ]}
                                size="md"
                              />
                            </div>
                            <div>
                              <label className="mb-0.5 block text-[10px] font-semibold text-slate-500">
                                {comp.isPercentage ? 'Rate (%)' : 'Amount (KES)'}
                              </label>
                              <Input type="number" min="0" value={comp.amount} onChange={(e) => updateComponent(idx, 'amount', e.target.value)} />
                            </div>
                            <div className="flex items-end gap-2">
                              <label className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600">
                                <input type="checkbox" checked={comp.isPercentage} onChange={(e) => updateComponent(idx, 'isPercentage', e.target.checked)} />
                                % of {comp.isPercentage ? (
                                  <AppSelect
                                    value={comp.percentageBase}
                                    onChange={(v) => updateComponent(idx, 'percentageBase', v ?? 'Basic')}
                                    options={[
                                      { value: 'Basic', label: 'Basic' },
                                      { value: 'Gross', label: 'Gross' },
                                    ]}
                                    size="sm"
                                  />
                                ) : 'basic'}
                              </label>
                              <button type="button" onClick={() => removeComponent(idx)} className="ml-auto rounded border border-rose-200 bg-rose-50 p-1 text-rose-600 hover:bg-rose-100">
                                <FaTrash size={9} />
                              </button>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Emergency Contact ────────────────────────────── */}
              {tab === 'emergency' && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-500">Next of Kin / Emergency Contact</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Full Name"><Input value={form.nextOfKinName} onChange={(e) => set('nextOfKinName', e.target.value)} /></Field>
                    <Field label="Relationship"><Input value={form.nextOfKinRelationship} onChange={(e) => set('nextOfKinRelationship', e.target.value)} placeholder="e.g. Spouse, Parent" /></Field>
                    <Field label="Phone Number"><Input value={form.nextOfKinPhone} onChange={(e) => set('nextOfKinPhone', e.target.value)} placeholder="07XXXXXXXX" /></Field>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky footer */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-1.5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-1">
                  {TABS.map((t, i) => (
                    <button key={t.key} type="button" onClick={() => setTab(t.key)}
                      className={`h-1.5 w-6 rounded-full transition-colors ${tab === t.key ? 'bg-emerald-600' : 'bg-slate-200'}`}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => navigate('/hr/employees')} className="inline-flex h-7 items-center rounded border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="inline-flex h-7 items-center gap-1.5 rounded bg-[#0B3B2E] px-3 text-xs font-black text-white hover:bg-[#0A3127] disabled:opacity-60">
                    <FaSave size={10} /> {saving ? 'Saving...' : (isEditing ? 'Update Employee' : 'Create Employee')}
                  </button>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
