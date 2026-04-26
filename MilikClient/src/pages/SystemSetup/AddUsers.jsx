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
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="sticky top-0 z-20 mb-3 flex shrink-0 items-center justify-between rounded-2xl border border-emerald-100 bg-white/95 p-3 shadow-sm backdrop-blur">
          <div>
            <button onClick={() => navigate('/system-setup/users')} className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-emerald-700 hover:text-emerald-800"><FaArrowLeft /> Back to users</button>
            <h1 className="text-lg font-black text-slate-900">{isEditing ? 'Update User Access' : 'New User'}</h1>

          </div>
          <div className="rounded-2xl border border-white bg-white/90 px-4 py-3 shadow-sm">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-600">Milik Admin control</div>
            <div className="text-base font-extrabold text-slate-900">{isSystemAdmin ? 'Multi-company assignment enabled' : 'Single company access only'}</div>
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading user setup...</div>
        ) : (
          <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-slate-700">
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
                    ['surname', 'Surname *'],
                    ['otherNames', 'Other names *'],
                    ['idNumber', 'ID / Passport *'],
                    ['phoneNumber', 'Phone number *'],
                    ['email', 'Email *'],
                    ['postalAddress', 'Postal address'],
                  ].map(([field, label]) => (
                    <label key={field} className="text-sm font-semibold text-slate-700">
                      <span className="mb-1 block">{label}</span>
                      <input value={form[field]} onChange={(e) => updateForm(field, e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500" />
                    </label>
                  ))}
                  <label className="text-sm font-semibold text-slate-700">
                    <span className="mb-1 block">Gender</span>
                    <select value={form.gender} onChange={(e) => updateForm('gender', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500">
                      <option value="">Select gender</option>
                      <option>Male</option>
                      <option>Female</option>
                      <option>Other</option>
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
                    ['userControl', 'User control'],
                    ['adminAccess', 'Company admin access'],
                    ['setupAccess', 'Operational settings access'],
                    ['companySetupAccess', 'Company setup access'],
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

                {!isEditing && (
                  <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900"><FaKey className="text-emerald-700" /> First-time sign-in</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                        <input type="checkbox" checked={form.autoGeneratePassword} onChange={(e) => updateForm('autoGeneratePassword', e.target.checked)} /> Auto-generate temporary password
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                        <input type="checkbox" checked={form.sendOnboardingEmail} onChange={(e) => updateForm('sendOnboardingEmail', e.target.checked)} disabled={!form.autoGeneratePassword} /> Send onboarding email
                      </label>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2 text-slate-900"><FaBuilding className="text-emerald-700" /><h2 className="text-lg font-black">Company assignment</h2></div>
                <p className="mb-4 text-sm text-slate-600">Pick one or many companies, then define modules and exact action permissions for each company assignment.</p>
                <div className="space-y-3">
                  {availableCompanies.map((company) => {
                    const checked = form.accessibleCompanies.includes(company._id);
                    return (
                      <label key={company._id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 text-sm transition ${checked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                        <input type="checkbox" className="mt-1" checked={checked} onChange={() => toggleCompany(company)} />
                        <div className="min-w-0 flex-1">
                          <div className="font-black text-slate-900">{company.companyName}</div>
                          <div className="mt-1 text-xs text-slate-500">{company.companyCode || 'No code'} · {(company.enabledModules || []).length} module{(company.enabledModules || []).length === 1 ? '' : 's'} enabled</div>
                        </div>
                        {checked ? <FaCheckCircle className="mt-1 text-emerald-600" /> : null}
                      </label>
                    );
                  })}
                </div>

                <label className="mt-4 block text-sm font-semibold text-slate-700">
                  <span className="mb-1 block">Primary company *</span>
                  <select value={form.primaryCompany} onChange={(e) => updateForm('primaryCompany', e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500">
                    <option value="">Select primary company</option>
                    {form.accessibleCompanies.map((companyId) => {
                      const company = availableCompanies.find((item) => item._id === companyId);
                      return <option key={companyId} value={companyId}>{company?.companyName || companyId}</option>;
                    })}
                  </select>
                </label>

                <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Assignment summary</div>
                  <div className="mt-2 text-sm text-slate-700">{form.accessibleCompanies.length} compan{form.accessibleCompanies.length === 1 ? 'y' : 'ies'} selected</div>
                  <div className="mt-2 text-sm text-slate-700">Primary company: <span className="font-bold text-slate-900">{availableCompanies.find((item) => item._id === form.primaryCompany)?.companyName || '-'}</span></div>
                </div>
              </section>
            </div>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-slate-900"><FaShieldAlt className="text-emerald-700" /><h2 className="text-lg font-black">Modules & privileges per company</h2></div>
              <p className="mb-4 text-sm text-slate-600">Each company assignment owns its own module level and action rights. Route guards, menu visibility, and API enforcement use these saved values.</p>

              <div className="space-y-6">
                {form.companyAssignments.map((assignment) => {
                  const company = availableCompanies.find((item) => item._id === assignment.company);
                  const enabledModuleKeys = getEnabledCompanyModuleKeys(company);
                  return (
                    <div key={assignment.company} className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black text-slate-900">{company?.companyName || 'Company'}</h3>
                          <p className="mt-1 text-sm text-slate-600">Modules and action permissions are limited to what this company already has enabled.</p>
                        </div>
                        <div className="rounded-2xl border border-white bg-white px-4 py-3 text-sm font-bold text-slate-700">
                          {enabledModuleKeys.length} enabled module{enabledModuleKeys.length === 1 ? '' : 's'}
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                          <div className="mb-3 text-sm font-black text-slate-900">Module access levels</div>
                          <div className="space-y-3">
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
                                <div key={moduleKey} className="rounded-2xl border border-slate-200 p-3">
                                  <div className="mb-2 text-sm font-bold text-slate-900">{MODULE_LABELS[moduleKey] || moduleKey}</div>
                                  <select value={assignment.moduleAccess?.[mappedKey] || 'View only'} onChange={(e) => updateAssignment(assignment.company, (current) => ({ ...current, moduleAccess: { ...current.moduleAccess, [mappedKey]: e.target.value } }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-emerald-500">
                                    {ACCESS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-white p-4">
                          <div className="mb-3 text-sm font-black text-slate-900">Action permissions</div>
                          <div className="space-y-4">
                            {ACCESS_SECTIONS.map((section) => {
                              const enabledPermissions = section.permissions.filter((permission) => !permission.moduleKey || enabledModuleKeys.includes(permission.moduleKey));
                              if (!enabledPermissions.length) return null;
                              const granted = sectionPermissionCount(assignment.permissions, enabledPermissions);
                              return (
                                <div key={section.id} className="rounded-2xl border border-slate-200 p-4">
                                  <div className="mb-3 flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-black text-slate-900">{section.label}</div>
                                      <div className="mt-1 text-xs text-slate-500">{granted} of {enabledPermissions.length} enabled</div>
                                    </div>
                                    <div className="flex gap-2 text-xs font-bold">
                                      <button type="button" onClick={() => updateAssignment(assignment.company, (current) => ({ ...current, permissions: setPermissionGroupValue(current.permissions, enabledPermissions, true) }))} className="rounded-full border border-emerald-200 px-3 py-1 text-emerald-700">Enable all</button>
                                      <button type="button" onClick={() => updateAssignment(assignment.company, (current) => ({ ...current, permissions: setPermissionGroupValue(current.permissions, enabledPermissions, false) }))} className="rounded-full border border-slate-200 px-3 py-1 text-slate-600">Clear</button>
                                    </div>
                                  </div>
                                  <div className="grid gap-2 md:grid-cols-2">
                                    {enabledPermissions.map((permission) => (
                                      <label key={`${permission.resource}.${permission.action}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
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
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
                    Select at least one company to define modules and action permissions.
                  </div>
                )}
              </div>
            </section>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button type="button" onClick={() => navigate('/system-setup/users')} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={isSaving} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                <FaSave /> {isSaving ? 'Saving...' : (isEditing ? 'Update user access' : 'Create user')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
