import React, { useEffect, useMemo, useState } from 'react';
import {
  FaArrowLeft,
  FaBuilding,
  FaCheckCircle,
  FaKey,
  FaLock,
  FaSave,
  FaShieldAlt,
  FaUserPlus,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { adminRequests } from '../../utils/requestMethods';
import { createUser, updateUser } from '../../redux/apiCalls';
import { getEnabledCompanyModuleKeys, MODULE_LABELS } from '../../utils/companyModules';
import {
  ACCESS_SECTIONS,
  buildEmptyPermissionMap,
  normalizePermissionMap,
  setPermissionGroupValue,
} from '../../utils/accessMatrix';

const PROFILE_OPTIONS = ['Administrator', 'Manager', 'Accountant', 'Agent', 'Viewer'];
const ACCESS_OPTIONS = ['Not allowed', 'View only', 'Full access'];

const emptyPermissionMap = () => buildEmptyPermissionMap();

const makeDefaultAssignment = (company) => {
  const moduleAccess = {};
  getEnabledCompanyModuleKeys(company).forEach((key) => {
    const accessKey = {
      propertyManagement: 'propertyMgmt',
      accounts: 'accounts',
      inventory: 'inventory',
      procurement: 'procurement',
      hr: 'humanResource',
      propertySale: 'propertySale',
      facilityManagement: 'facilityManagement',
      hotelManagement: 'hotelManagement',
      telcoDealership: 'telcoDealership',
      dms: 'dms',
      academics: 'academics',
      projectManagement: 'projectManagement',
      assetValuation: 'assetValuation',
      revenueRecognition: 'revenueRecognition',
      crm: 'crm',
      incidentManagement: 'incidentManagement',
      sacco: 'sacco',
      pos: 'inventory',
    }[key] || key;
    moduleAccess[accessKey] = 'View only';
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

  const assignments = (Array.isArray(user?.companyAssignments) && user.companyAssignments.length > 0
    ? user.companyAssignments
    : selectedCompanies.map((companyId) => ({ company: companyId })))
    .map((assignment) => {
      const companyId = assignment?.company?._id || assignment?.company;
      const company = companies.find((item) => item._id === companyId);
      const defaults = makeDefaultAssignment(company);
      return {
        ...defaults,
        ...assignment,
        company: companyId,
        moduleAccess: { ...defaults.moduleAccess, ...(assignment?.moduleAccess || {}) },
        permissions: normalizePermissionMap(assignment?.permissions || {}),
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

const sectionPermissionCount = (permissions = {}, items = []) =>
  items.reduce((count, item) => count + (permissions?.[item.resource]?.[item.action] ? 1 : 0), 0);

export default function AddUserPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const dispatch = useDispatch();
  const { currentUser } = useSelector((state) => state.auth);
  const { currentCompany } = useSelector((state) => state.company);
  const isEditing = Boolean(id);
  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);

  const [companies, setCompanies] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    surname: '',
    otherNames: '',
    idNumber: '',
    gender: '',
    postalAddress: '',
    phoneNumber: '',
    email: '',
    profile: 'Agent',
    userControl: true,
    superAdminAccess: false,
    adminAccess: false,
    setupAccess: false,
    companySetupAccess: false,
    password: '',
    confirmPassword: '',
    autoGeneratePassword: true,
    sendOnboardingEmail: true,
    primaryCompany: '',
    accessibleCompanies: [],
    companyAssignments: [],
  });

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const companyRes = await adminRequests.get('/companies', { params: { limit: 500 } });
        const companyList = Array.isArray(companyRes?.data?.companies)
          ? companyRes.data.companies
          : Array.isArray(companyRes?.data)
            ? companyRes.data
            : [];
        setCompanies(companyList);

        if (isEditing) {
          const userRes = await adminRequests.get(`/users/${id}`);
          setForm(normalizeUserToForm(userRes.data, companyList));
        } else if (isSystemAdmin) {
          const defaultCompanyId = currentCompany?._id || companyList[0]?._id || '';
          const defaultCompany = companyList.find((item) => item._id === defaultCompanyId);
          setForm((prev) => ({
            ...prev,
            primaryCompany: defaultCompanyId,
            accessibleCompanies: defaultCompanyId ? [defaultCompanyId] : [],
            companyAssignments: defaultCompany ? [makeDefaultAssignment(defaultCompany)] : [],
          }));
        } else if (currentCompany?._id) {
          setForm((prev) => ({
            ...prev,
            primaryCompany: currentCompany._id,
            accessibleCompanies: [currentCompany._id],
            companyAssignments: [makeDefaultAssignment(currentCompany)],
          }));
        }
      } catch (error) {
        toast.error(error?.response?.data?.message || 'Failed to load user setup');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id, isEditing, isSystemAdmin, currentCompany?._id]);

  const availableCompanies = useMemo(() => {
    if (isSystemAdmin) return companies;
    return companies.filter((company) => company._id === currentCompany?._id);
  }, [companies, isSystemAdmin, currentCompany?._id]);

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const updateAssignment = (companyId, updater) => {
    setForm((prev) => ({
      ...prev,
      companyAssignments: prev.companyAssignments.map((item) => (item.company === companyId ? updater(item) : item)),
    }));
  };

  const toggleCompany = (company) => {
    setForm((prev) => {
      const exists = prev.accessibleCompanies.includes(company._id);
      const accessibleCompanies = exists
        ? prev.accessibleCompanies.filter((entryId) => entryId !== company._id)
        : [...prev.accessibleCompanies, company._id];
      const companyAssignments = exists
        ? prev.companyAssignments.filter((item) => item.company !== company._id)
        : [...prev.companyAssignments, makeDefaultAssignment(company)];
      const primaryCompany = accessibleCompanies.includes(prev.primaryCompany)
        ? prev.primaryCompany
        : (accessibleCompanies[0] || '');
      return { ...prev, accessibleCompanies, companyAssignments, primaryCompany };
    });
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
      companyAssignments: form.companyAssignments.map((assignment) => ({
        ...assignment,
        permissions: normalizePermissionMap(assignment.permissions || {}),
      })),
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
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* ── Sticky header ─────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/system-setup/users')} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3B2E] hover:underline"><FaArrowLeft /> Back</button>
              <div className="h-4 w-px bg-slate-300" />
              <h1 className="text-sm font-black text-slate-900">{isEditing ? 'Update User Access' : 'New User'}</h1>
            </div>
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500">{isSystemAdmin ? 'Multi-company enabled' : 'Single company'}</span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading user setup...</div>
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">

            {/* ── Scrollable content ────────────────────────────────── */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid gap-3 lg:grid-cols-[1.1fr,0.9fr]">

                {/* Left: User details */}
                <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 text-slate-900"><FaUserPlus className="text-emerald-700 text-xs" /><h2 className="text-xs font-black uppercase tracking-wide">User details</h2></div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {[
                      ['surname', 'Surname *'],
                      ['otherNames', 'Other names *'],
                      ['idNumber', 'ID / Passport *'],
                      ['phoneNumber', 'Phone number *'],
                      ['email', 'Email *'],
                      ['postalAddress', 'Postal address'],
                    ].map(([field, label]) => (
                      <label key={field} className="text-xs font-semibold text-slate-700">
                        <span className="mb-0.5 block">{label}</span>
                        <input value={form[field]} onChange={(e) => updateForm(field, e.target.value)} className="h-8 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-emerald-500" />
                      </label>
                    ))}
                    <label className="text-xs font-semibold text-slate-700">
                      <span className="mb-0.5 block">Gender</span>
                      <select value={form.gender} onChange={(e) => updateForm('gender', e.target.value)} className="h-8 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-emerald-500">
                        <option value="">Select gender</option>
                        <option>Male</option>
                        <option>Female</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-slate-700">
                      <span className="mb-0.5 block">Profile *</span>
                      <select value={form.profile} onChange={(e) => updateForm('profile', e.target.value)} className="h-8 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-emerald-500">
                        {PROFILE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    {(isEditing || !form.autoGeneratePassword) && (
                      <>
                        <label className="text-xs font-semibold text-slate-700">
                          <span className="mb-0.5 block">Password {isEditing ? '(optional)' : '*'}</span>
                          <input type="password" value={form.password} onChange={(e) => updateForm('password', e.target.value)} className="h-8 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-emerald-500" />
                        </label>
                        <label className="text-xs font-semibold text-slate-700">
                          <span className="mb-0.5 block">Confirm password</span>
                          <input type="password" value={form.confirmPassword} onChange={(e) => updateForm('confirmPassword', e.target.value)} className="h-8 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-emerald-500" />
                        </label>
                      </>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      ['userControl', 'User control'],
                      ['adminAccess', 'Company admin'],
                      ['setupAccess', 'Operational settings'],
                      ['companySetupAccess', 'Company setup'],
                    ].map(([field, label]) => (
                      <label key={field} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={Boolean(form[field])} onChange={(e) => updateForm(field, e.target.checked)} /> {label}
                      </label>
                    ))}
                    {isSystemAdmin && (
                      <label className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1.5 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={Boolean(form.superAdminAccess)} onChange={(e) => updateForm('superAdminAccess', e.target.checked)} /> Milik super admin
                      </label>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-emerald-700"><FaKey size={9} /> First-time sign-in:</span>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={form.autoGeneratePassword} onChange={(e) => updateForm('autoGeneratePassword', e.target.checked)} /> Auto-generate password
                      </label>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={form.sendOnboardingEmail} onChange={(e) => updateForm('sendOnboardingEmail', e.target.checked)} disabled={!form.autoGeneratePassword} /> Send onboarding email
                      </label>
                    </div>
                  )}
                </section>

                {/* Right: Company assignment */}
                <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 text-slate-900"><FaBuilding className="text-emerald-700 text-xs" /><h2 className="text-xs font-black uppercase tracking-wide">Company assignment</h2></div>
                  <div className="space-y-1.5">
                    {availableCompanies.map((company) => {
                      const checked = form.accessibleCompanies.includes(company._id);
                      return (
                        <label key={company._id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${checked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleCompany(company)} />
                          <div className="min-w-0 flex-1">
                            <div className="font-black text-slate-900">{company.companyName}</div>
                            <div className="text-[10px] text-slate-500">{company.companyCode || 'No code'}</div>
                          </div>
                          {checked && <FaCheckCircle className="shrink-0 text-emerald-600" size={11} />}
                        </label>
                      );
                    })}
                  </div>

                  <label className="mt-2 block text-xs font-semibold text-slate-700">
                    <span className="mb-0.5 block">Primary company *</span>
                    <select value={form.primaryCompany} onChange={(e) => updateForm('primaryCompany', e.target.value)} className="h-8 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-emerald-500">
                      <option value="">Select primary company</option>
                      {form.accessibleCompanies.map((companyId) => {
                        const company = availableCompanies.find((item) => item._id === companyId);
                        return <option key={companyId} value={companyId}>{company?.companyName || companyId}</option>;
                      })}
                    </select>
                  </label>

                  <div className="mt-2 flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <span><span className="font-black text-slate-900">{form.accessibleCompanies.length}</span> compan{form.accessibleCompanies.length === 1 ? 'y' : 'ies'} selected</span>
                    <span>Primary: <span className="font-bold text-slate-900">{availableCompanies.find((item) => item._id === form.primaryCompany)?.companyName || '—'}</span></span>
                  </div>
                </section>
              </div>

              {/* Modules & privileges */}
              <section className="mt-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-slate-900"><FaShieldAlt className="text-emerald-700 text-xs" /><h2 className="text-xs font-black uppercase tracking-wide">Modules & privileges per company</h2></div>

                <div className="space-y-3">
                  {form.companyAssignments.map((assignment) => {
                    const company = availableCompanies.find((item) => item._id === assignment.company);
                    const enabledModuleKeys = getEnabledCompanyModuleKeys(company);
                    return (
                      <div key={assignment.company} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-xs font-black text-slate-900">{company?.companyName || 'Company'}</h3>
                          <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600">{enabledModuleKeys.length} modules</span>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[0.95fr,1.05fr]">
                          {/* Module access */}
                          <div className="rounded-lg border border-slate-200 bg-white p-2">
                            <div className="mb-1.5 text-[11px] font-black text-slate-900">Module access levels</div>
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              {enabledModuleKeys.map((moduleKey) => {
                                const mappedKey = {
                                  propertyManagement: 'propertyMgmt',
                                  accounts: 'accounts',
                                  inventory: 'inventory',
                                  procurement: 'procurement',
                                  hr: 'humanResource',
                                  propertySale: 'propertySale',
                                  facilityManagement: 'facilityManagement',
                                  hotelManagement: 'hotelManagement',
                                  telcoDealership: 'telcoDealership',
                                  dms: 'dms',
                                  academics: 'academics',
                                  projectManagement: 'projectManagement',
                                  assetValuation: 'assetValuation',
                                  revenueRecognition: 'revenueRecognition',
                                  crm: 'crm',
                                  incidentManagement: 'incidentManagement',
                                  sacco: 'sacco',
                                  pos: 'inventory',
                                }[moduleKey] || moduleKey;
                                return (
                                  <div key={moduleKey} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5">
                                    <span className="flex-1 text-[11px] font-semibold text-slate-800">{MODULE_LABELS[moduleKey] || moduleKey}</span>
                                    <select value={assignment.moduleAccess?.[mappedKey] || 'View only'} onChange={(e) => updateAssignment(assignment.company, (current) => ({ ...current, moduleAccess: { ...current.moduleAccess, [mappedKey]: e.target.value } }))} className="h-6 rounded border border-slate-200 px-1 text-[10px] outline-none focus:border-emerald-500">
                                      {ACCESS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                    </select>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Action permissions */}
                          <div className="rounded-lg border border-slate-200 bg-white p-2">
                            <div className="mb-1.5 text-[11px] font-black text-slate-900">Action permissions</div>
                            <div className="space-y-2">
                              {ACCESS_SECTIONS.map((section) => {
                                const enabledPermissions = section.permissions.filter((permission) => !permission.moduleKey || enabledModuleKeys.includes(permission.moduleKey));
                                if (!enabledPermissions.length) return null;
                                const granted = sectionPermissionCount(assignment.permissions, enabledPermissions);
                                return (
                                  <div key={section.id} className="rounded border border-slate-200 p-2">
                                    <div className="mb-1.5 flex items-center justify-between gap-2">
                                      <div>
                                        <span className="text-[11px] font-black text-slate-900">{section.label}</span>
                                        <span className="ml-1.5 text-[10px] text-slate-500">{granted}/{enabledPermissions.length}</span>
                                      </div>
                                      <div className="flex gap-1 text-[10px] font-bold">
                                        <button type="button" onClick={() => updateAssignment(assignment.company, (current) => ({ ...current, permissions: setPermissionGroupValue(current.permissions, enabledPermissions, true) }))} className="rounded border border-emerald-200 px-2 py-0.5 text-emerald-700">All</button>
                                        <button type="button" onClick={() => updateAssignment(assignment.company, (current) => ({ ...current, permissions: setPermissionGroupValue(current.permissions, enabledPermissions, false) }))} className="rounded border border-slate-200 px-2 py-0.5 text-slate-600">Clear</button>
                                      </div>
                                    </div>
                                    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                                      {enabledPermissions.map((permission) => (
                                        <label key={`${permission.resource}.${permission.action}`} className="flex items-center gap-1.5 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(assignment.permissions?.[permission.resource]?.[permission.action])}
                                            onChange={(e) => updateAssignment(assignment.company, (current) => ({
                                              ...current,
                                              permissions: {
                                                ...normalizePermissionMap(current.permissions || {}),
                                                [permission.resource]: {
                                                  ...normalizePermissionMap(current.permissions || {})[permission.resource],
                                                  [permission.action]: e.target.checked,
                                                },
                                              },
                                            }))}
                                          />
                                          {permission.label}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!form.companyAssignments.length && (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-xs text-slate-500">
                      Select at least one company to define modules and action permissions.
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* ── Sticky footer ─────────────────────────────────────── */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-2 shadow-sm">
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => navigate('/system-setup/users')} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={isSaving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                  <FaSave /> {isSaving ? 'Saving...' : (isEditing ? 'Update user access' : 'Create user')}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
