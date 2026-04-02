import React, { useEffect, useMemo, useState } from 'react';
import { FaArrowLeft, FaBuilding, FaCheckCircle, FaKey, FaSave, FaShieldAlt, FaUserPlus, FaUsers } from 'react-icons/fa';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminRequests } from '../../utils/requestMethods';
import { createUser, updateUser } from '../../redux/apiCalls';
import { getEnabledCompanyModuleKeys, MODULE_LABELS } from '../../utils/companyModules';

const PROFILE_OPTIONS = ['Administrator', 'Manager', 'Accountant', 'Agent', 'Viewer'];
const ACCESS_OPTIONS = ['Not allowed', 'View only', 'Full access'];
const PERMISSION_GROUPS = {
  dashboard: ['view_dashboard'],
  tenants: ['view_tenants', 'create_tenant', 'update_tenant', 'delete_tenant'],
  invoicing: ['view_invoices', 'create_invoice', 'update_invoice', 'delete_invoice', 'create_debit_note', 'create_credit_note'],
  receipts: ['view_receipts', 'record_receipt', 'reverse_receipt', 'delete_receipt'],
  accounting: ['view_reports', 'view_chart_of_accounts', 'post_journal', 'reverse_journal'],
  statements: ['view_statements', 'create_statement', 'approve_statement', 'pay_landlord'],
  admin: ['view_users', 'create_user', 'update_user', 'lock_user'],
};

const PERMISSION_LABELS = {
  view_dashboard: 'View dashboard',
  view_tenants: 'View tenants',
  create_tenant: 'Create tenant',
  update_tenant: 'Update tenant',
  delete_tenant: 'Delete tenant',
  view_invoices: 'View invoices',
  create_invoice: 'Create invoice',
  update_invoice: 'Update invoice',
  delete_invoice: 'Delete invoice',
  create_debit_note: 'Create debit notes',
  create_credit_note: 'Create credit notes',
  view_receipts: 'View receipts',
  record_receipt: 'Record receipts',
  reverse_receipt: 'Reverse receipts',
  delete_receipt: 'Delete receipts',
  view_reports: 'View reports',
  view_chart_of_accounts: 'View chart of accounts',
  post_journal: 'Post journals',
  reverse_journal: 'Reverse journals',
  view_statements: 'View statements',
  create_statement: 'Create statements',
  approve_statement: 'Approve statements',
  pay_landlord: 'Pay landlord',
  view_users: 'View users',
  create_user: 'Create users',
  update_user: 'Update users',
  lock_user: 'Lock or unlock users',
};

const emptyPermissionMap = () => Object.values(PERMISSION_GROUPS).flat().reduce((acc, key) => ({ ...acc, [key]: false }), {});

const makeDefaultAssignment = (company) => {
  const moduleAccess = {};
  getEnabledCompanyModuleKeys(company).forEach((key) => {
    moduleAccess[key] = 'View only';
  });
  return {
    company: company?._id,
    moduleAccess,
    permissions: emptyPermissionMap(),
    rights: [],
  };
};

const normalizeUserToForm = (user, companies) => {
  const selectedCompanies = Array.isArray(user?.accessibleCompanies) && user.accessibleCompanies.length > 0
    ? user.accessibleCompanies.map((item) => item?._id || item)
    : [user?.primaryCompany?._id || user?.company?._id || user?.company].filter(Boolean);

  const assignments = (Array.isArray(user?.companyAssignments) ? user.companyAssignments : selectedCompanies.map((companyId) => ({ company: companyId }))).map((assignment) => {
    const companyId = assignment?.company?._id || assignment?.company;
    const company = companies.find((item) => item._id === companyId);
    return {
      ...makeDefaultAssignment(company),
      ...assignment,
      company: companyId,
      moduleAccess: { ...makeDefaultAssignment(company).moduleAccess, ...(assignment?.moduleAccess || {}) },
      permissions: { ...emptyPermissionMap(), ...(assignment?.permissions || {}) },
      rights: Array.isArray(assignment?.rights) ? assignment.rights : [],
    };
  });

  return {
    surname: user?.surname || '',
    otherNames: user?.otherNames || '',
    idNumber: user?.idNumber || '',
    gender: user?.gender || '',
    postalAddress: user?.postalAddress || '',
    phoneNumber: user?.phoneNumber || '',
    email: user?.email || '',
    profile: user?.profile || 'Agent',
    userControl: user?.userControl ?? true,
    superAdminAccess: user?.superAdminAccess ?? false,
    adminAccess: user?.adminAccess ?? false,
    setupAccess: user?.setupAccess ?? false,
    companySetupAccess: user?.companySetupAccess ?? false,
    password: '',
    confirmPassword: '',
    autoGeneratePassword: false,
    sendOnboardingEmail: false,
    primaryCompany: user?.primaryCompany?._id || user?.company?._id || user?.company || selectedCompanies[0] || '',
    accessibleCompanies: selectedCompanies,
    companyAssignments: assignments,
  };
};

export default function AddUserPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const dispatch = useDispatch();
  const { currentUser, token } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const isEditing = Boolean(id);
  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);

  const [companies, setCompanies] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    surname: '', otherNames: '', idNumber: '', gender: '', postalAddress: '', phoneNumber: '', email: '', profile: 'Agent',
    userControl: true, superAdminAccess: false, adminAccess: false, setupAccess: false, companySetupAccess: false,
    password: '', confirmPassword: '', autoGeneratePassword: true, sendOnboardingEmail: true, primaryCompany: '', accessibleCompanies: [], companyAssignments: [],
  });

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const companyRes = await adminRequests.get('/companies', { params: { limit: 500 } });
        const companyList = Array.isArray(companyRes?.data?.companies) ? companyRes.data.companies : (Array.isArray(companyRes?.data) ? companyRes.data : []);
        setCompanies(companyList);

        if (isEditing) {
          const userRes = await adminRequests.get(`/users/${id}`);
          setForm(normalizeUserToForm(userRes.data, companyList));
        } else if (isSystemAdmin) {
          const defaultCompanyId = currentCompany?._id || companyList[0]?._id || '';
          const defaultCompany = companyList.find((item) => item._id === defaultCompanyId);
          setForm((prev) => ({ ...prev, primaryCompany: defaultCompanyId, accessibleCompanies: defaultCompanyId ? [defaultCompanyId] : [], companyAssignments: defaultCompany ? [makeDefaultAssignment(defaultCompany)] : [] }));
        } else if (currentCompany?._id) {
          setForm((prev) => ({ ...prev, primaryCompany: currentCompany._id, accessibleCompanies: [currentCompany._id], companyAssignments: [makeDefaultAssignment(currentCompany)] }));
        }
      } catch (error) {
        toast.error(error?.response?.data?.message || 'Failed to load user setup');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id, isEditing, isSystemAdmin, currentCompany?._id, token]);

  const availableCompanies = useMemo(() => {
    if (isSystemAdmin) return companies;
    return companies.filter((company) => company._id === currentCompany?._id);
  }, [companies, isSystemAdmin, currentCompany?._id]);

  const selectedCompanyObjects = useMemo(() => availableCompanies.filter((company) => form.accessibleCompanies.includes(company._id)), [availableCompanies, form.accessibleCompanies]);

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const toggleCompany = (company) => {
    setForm((prev) => {
      const exists = prev.accessibleCompanies.includes(company._id);
      const accessibleCompanies = exists ? prev.accessibleCompanies.filter((id) => id !== company._id) : [...prev.accessibleCompanies, company._id];
      const companyAssignments = exists
        ? prev.companyAssignments.filter((item) => item.company !== company._id)
        : [...prev.companyAssignments, makeDefaultAssignment(company)];
      const primaryCompany = accessibleCompanies.includes(prev.primaryCompany) ? prev.primaryCompany : (accessibleCompanies[0] || '');
      return { ...prev, accessibleCompanies, companyAssignments, primaryCompany };
    });
  };

  const updateAssignment = (companyId, updater) => {
    setForm((prev) => ({
      ...prev,
      companyAssignments: prev.companyAssignments.map((item) => item.company === companyId ? updater(item) : item),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.surname || !form.otherNames || !form.idNumber || !form.phoneNumber || !form.email || !form.profile) {
      toast.error('Fill all required user details first');
      return;
    }
    if (!form.primaryCompany || form.accessibleCompanies.length === 0) {
      toast.error('Select at least one company');
      return;
    }
    if (!isEditing && !form.autoGeneratePassword && !form.password) {
      toast.error('Password is required when automatic first-time access is off');
      return;
    }
    if (!form.autoGeneratePassword && form.password && form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    const payload = {
      surname: form.surname,
      otherNames: form.otherNames,
      idNumber: form.idNumber,
      gender: form.gender,
      postalAddress: form.postalAddress,
      phoneNumber: form.phoneNumber,
      email: form.email,
      profile: form.profile,
      userControl: form.userControl,
      superAdminAccess: form.superAdminAccess,
      adminAccess: form.adminAccess,
      setupAccess: form.setupAccess,
      companySetupAccess: form.companySetupAccess,
      company: form.primaryCompany,
      primaryCompany: form.primaryCompany,
      accessibleCompanies: form.accessibleCompanies,
      companyAssignments: form.companyAssignments,
      permissions: form.companyAssignments.reduce((acc, item) => ({ ...acc, [item.company]: item.permissions }), {}),
    };
    if (!isEditing) {
      payload.autoGeneratePassword = form.autoGeneratePassword;
      payload.sendOnboardingEmail = form.autoGeneratePassword ? form.sendOnboardingEmail : false;
      payload.mustChangePassword = form.autoGeneratePassword;
    }
    if (!form.autoGeneratePassword && form.password) payload.password = form.password;

    setIsSaving(true);
    try {
      if (isEditing) {
        await dispatch(updateUser(id, payload));
        toast.success('User updated successfully');
      } else {
        const response = await dispatch(createUser(payload));
        const onboardingEmail = response?.onboardingEmail || null;
        const generatedAccess = response?.generatedAccess || null;

        if (form.autoGeneratePassword) {
          if (onboardingEmail?.sent) {
            toast.success('User created and onboarding email sent successfully');
          } else if (generatedAccess?.temporaryPassword) {
            toast.success(`User created. Temporary password: ${generatedAccess.temporaryPassword}`);
          } else {
            toast.success('User created successfully');
          }
        } else {
          toast.success('User created successfully');
        }
      }
      navigate('/system-setup/users');
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Failed to save user');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between rounded-3xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-orange-50 p-5 shadow-sm">
          <div>
            <button onClick={() => navigate('/system-setup/users')} className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:text-emerald-800"><FaArrowLeft /> Back to users</button>
            <h1 className="text-2xl font-black text-slate-900">{isEditing ? 'Update User Access' : 'New User'}</h1>
            <p className="mt-1 text-sm text-slate-600">Create company-aware users, assign modules that the company already owns, then define action permissions per company.</p>
          </div>
          <div className="rounded-2xl border border-white bg-white/90 px-4 py-3 shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-600">Milik Admin control</div>
            <div className="text-base font-extrabold text-slate-900">{isSystemAdmin ? 'Multi-company assignment enabled' : 'Single company access only'}</div>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading user setup...</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="mb-4 rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700">Access delivery</p>
                  <p className="mt-1 font-semibold">Onboarded users sign in through the MILIK app URL after company setup is complete.</p>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-extrabold text-emerald-800">
                  App URL: /login
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 text-slate-900"><FaUserPlus className="text-emerald-700" /><h2 className="text-lg font-black">User details</h2></div>
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    ['surname', 'Surname *'], ['otherNames', 'Other names *'], ['idNumber', 'ID / Passport *'], ['phoneNumber', 'Phone number *'], ['email', 'Email *'], ['postalAddress', 'Postal address']
                  ].map(([field, label]) => (
                    <label key={field} className="text-sm font-semibold text-slate-700">
                      <span className="mb-1 block">{label}</span>
                      <input value={form[field]} onChange={(e) => updateForm(field, e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500" />
                    </label>
                  ))}
                  <label className="text-sm font-semibold text-slate-700">
                    <span className="mb-1 block">Gender</span>
                    <select value={form.gender} onChange={(e) => updateForm('gender', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500">
                      <option value="">Select gender</option><option>Male</option><option>Female</option><option>Other</option>
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    <span className="mb-1 block">Profile *</span>
                    <select value={form.profile} onChange={(e) => updateForm('profile', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500">
                      {PROFILE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    <span className="mb-1 block">Password {isEditing ? '(optional)' : '*'}</span>
                    <input type="password" value={form.password} onChange={(e) => updateForm('password', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500" />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    <span className="mb-1 block">Confirm password</span>
                    <input type="password" value={form.confirmPassword} onChange={(e) => updateForm('confirmPassword', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500" />
                  </label>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['userControl', 'User control'], ['adminAccess', 'Company admin access'], ['setupAccess', 'Setup access'], ['companySetupAccess', 'Company setup access']
                  ].map(([field, label]) => (
                    <label key={field} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={Boolean(form[field])} onChange={(e) => updateForm(field, e.target.checked)} /> {label}
                    </label>
                  ))}
                  {isSystemAdmin && (
                    <label className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={Boolean(form.superAdminAccess)} onChange={(e) => updateForm('superAdminAccess', e.target.checked)} /> Milik admin / super admin access
                    </label>
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 text-slate-900"><FaBuilding className="text-emerald-700" /><h2 className="text-lg font-black">Company assignment</h2></div>
                <p className="mb-4 text-sm text-slate-600">Only Milik Admin can assign a user to more than one company. A company becomes switchable only when assigned here.</p>
                <div className="space-y-3">
                  {availableCompanies.map((company) => {
                    const enabledCount = getEnabledCompanyModuleKeys(company).length;
                    const checked = form.accessibleCompanies.includes(company._id);
                    return (
                      <label key={company._id} className={`flex cursor-pointer items-start justify-between rounded-2xl border px-4 py-3 transition ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                        <div>
                          <div className="font-bold text-slate-900">{company.companyName}</div>
                          <div className="text-xs text-slate-500">{enabledCount} enabled module{enabledCount === 1 ? '' : 's'}</div>
                        </div>
                        <input type="checkbox" checked={checked} disabled={!isSystemAdmin && company._id !== currentCompany?._id} onChange={() => toggleCompany(company)} />
                      </label>
                    );
                  })}
                </div>
                <div className="mt-4">
                  <label className="text-sm font-semibold text-slate-700">
                    <span className="mb-1 block">Primary company context</span>
                    <select value={form.primaryCompany} onChange={(e) => updateForm('primaryCompany', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500">
                      {selectedCompanyObjects.map((company) => <option key={company._id} value={company._id}>{company.companyName}</option>)}
                    </select>
                  </label>
                </div>
              </section>
            </div>

            {form.companyAssignments.map((assignment) => {
              const company = companies.find((item) => item._id === assignment.company);
              const enabledModules = getEnabledCompanyModuleKeys(company || {});
              return (
                <section key={assignment.company} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-black text-slate-900">{company?.companyName || 'Assigned company'}</h3>
                      <p className="text-sm text-slate-600">Modules and action permissions are limited to what this company already has enabled.</p>
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-emerald-700">{enabledModules.length} modules</span>
                  </div>
                  <div className="grid gap-5 xl:grid-cols-[0.9fr,1.1fr]">
                    <div>
                      <div className="mb-3 flex items-center gap-2 text-slate-800"><FaUsers className="text-orange-600" /> <span className="font-black">Assigned modules</span></div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {enabledModules.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">No enabled modules on this company yet.</div>
                        ) : enabledModules.map((moduleKey) => (
                          <label key={moduleKey} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
                            <span className="mb-1 block">{MODULE_LABELS[moduleKey] || moduleKey}</span>
                            <select value={assignment.moduleAccess?.[moduleKey] || 'View only'} onChange={(e) => updateAssignment(assignment.company, (current) => ({ ...current, moduleAccess: { ...current.moduleAccess, [moduleKey]: e.target.value } }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-500">
                              {ACCESS_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-3 flex items-center gap-2 text-slate-800"><FaKey className="text-orange-600" /> <span className="font-black">Permissions & privileges</span></div>
                      <div className="space-y-4">
                        {Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
                          <div key={group} className="rounded-2xl border border-slate-200 p-4">
                            <div className="mb-3 flex items-center justify-between">
                              <div className="font-black capitalize text-slate-900">{group.replace('_', ' ')}</div>
                              <button type="button" onClick={() => updateAssignment(assignment.company, (current) => ({ ...current, permissions: permissions.reduce((acc, key) => ({ ...acc, [key]: true }), { ...current.permissions }) }))} className="text-xs font-bold text-emerald-700">Enable all</button>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2">
                              {permissions.map((permission) => (
                                <label key={permission} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                                  <input type="checkbox" checked={Boolean(assignment.permissions?.[permission])} onChange={(e) => updateAssignment(assignment.company, (current) => ({ ...current, permissions: { ...current.permissions, [permission]: e.target.checked } }))} />
                                  {PERMISSION_LABELS[permission] || permission}
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}

            <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm text-slate-600"><FaCheckCircle className="mr-2 inline text-emerald-600" />The saved user will only be able to switch into assigned companies. Normal users never see System Admin.</div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => navigate('/system-setup/users')} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700">Cancel</button>
                <button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60"><FaSave /> {isSaving ? 'Saving...' : isEditing ? 'Update user' : 'Save user'}</button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
