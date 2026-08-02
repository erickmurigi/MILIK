import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FaArrowLeft,
  FaBan,
  FaBuilding,
  FaCheckCircle,
  FaChevronDown,
  FaChevronUp,
  FaEye,
  FaEyeSlash,
  FaKey,
  FaSave,
  FaShieldAlt,
  FaUnlockAlt,
  FaUserPlus,
} from 'react-icons/fa';
import DashboardLayout from '../../components/Layout/DashboardLayout';
import AppSelect from '../../components/common/AppSelect';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { selectCurrentUser, selectCurrentCompany } from '../../redux/selectors';
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
import { MODULE_ROLE_PRESETS, applyModuleRole, detectModuleRole } from '../../utils/moduleRolePresets';

const PROFILE_OPTIONS = [
  { value: 'Administrator',  label: 'Administrator',  description: 'Full access across all modules — can manage users, settings & all operations' },
  { value: 'Manager',        label: 'Manager',        description: 'Manage properties, collections, approvals & reports across all enabled modules' },
  { value: 'Accountant',     label: 'Accountant',     description: 'Accounts: journals, vouchers, reconciliation & financial reports' },
  { value: 'Property Agent', label: 'Property Agent', description: 'View & manage tenants, leases, receipts & maintenance requests' },
  { value: 'Field Officer',  label: 'Field Officer',  description: 'On-site: log inspections, close maintenance jobs, submit meter readings & view tenant balances' },
  { value: 'Sales Agent',    label: 'Sales Agent',    description: 'Property sales: listings, buyers, offers, deals & commissions' },
  { value: 'HR Officer',     label: 'HR Officer',     description: 'Employee management, leave applications & payroll viewing' },
  { value: 'Viewer',         label: 'Viewer',         description: 'Read-only access across all assigned modules — no create or edit actions' },
];

const PROFILE_MODULE_ROLES = {
  'Administrator':  { propertyManagement: 'admin',           accounts: 'admin',         propertySale: 'admin',        hr: 'admin',      inventory: 'admin',           carwash: 'admin'   },
  'Manager':        { propertyManagement: 'propertyManager', accounts: 'financeManager', propertySale: 'salesManager', hr: 'hrManager',  inventory: 'inventoryManager', carwash: 'manager' },
  'Accountant':     { propertyManagement: 'agent',           accounts: 'accountant',    propertySale: null,           hr: null,         inventory: null,              carwash: null      },
  'Property Agent': { propertyManagement: 'agent',           accounts: 'clerk',         propertySale: null,           hr: null,         inventory: null,              carwash: null      },
  'Field Officer':  { propertyManagement: 'fieldOfficer',    accounts: null,            propertySale: null,           hr: null,         inventory: null,              carwash: null      },
  'Sales Agent':    { propertyManagement: null,              accounts: null,            propertySale: 'salesAgent',   hr: null,         inventory: null,              carwash: null      },
  'HR Officer':     { propertyManagement: null,              accounts: null,            propertySale: null,           hr: 'hrOfficer',  inventory: null,              carwash: null      },
  'Viewer':         {},
  // Legacy backward-compat
  'Agent':          { propertyManagement: 'agent',           accounts: 'clerk',         propertySale: null,           hr: null,         inventory: null,              carwash: null      },
};

const emptyPermissionMap = () => buildEmptyPermissionMap();

const MODULE_KEY_MAP = {
  propertyManagement: 'propertyMgmt',
  accounts:           'accounts',
  inventory:          'inventory',
  procurement:        'procurement',
  hr:                 'humanResource',
  propertySale:       'propertySale',
  facilityManagement: 'facilityManagement',
  hotelManagement:    'hotelManagement',
  telcoDealership:    'telcoDealership',
  dms:                'dms',
  academics:          'academics',
  projectManagement:  'projectManagement',
  assetValuation:     'assetValuation',
  revenueRecognition: 'revenueRecognition',
  crm:                'crm',
  incidentManagement: 'incidentManagement',
  sacco:              'sacco',
  securityServices:   'securityServices',
  billing:            'billing',
  pos:                'inventory',
};

const SECTION_META = {
  workspace:      { bar: 'bg-indigo-500'  },
  users:          { bar: 'bg-purple-500'  },
  property:       { bar: 'bg-emerald-600' },
  leases:         { bar: 'bg-green-500'   },
  collections:    { bar: 'bg-orange-500'  },
  accounts:       { bar: 'bg-teal-600'    },
  pmReports:      { bar: 'bg-cyan-600'    },
  operations:     { bar: 'bg-amber-500'   },
  propertySale:   { bar: 'bg-blue-600'    },
  humanResource:  { bar: 'bg-rose-500'    },
  carwash:        { bar: 'bg-sky-500'     },
  inventory:      { bar: 'bg-lime-600'    },
  pos:            { bar: 'bg-yellow-500'  },
  communications: { bar: 'bg-violet-500'  },
};

const DANGER_ACTIONS = new Set(['delete', 'reverse', 'lock', 'approve', 'pay', 'process']);

const PROFILE_SELECT_OPTIONS = PROFILE_OPTIONS.map(({ value, label }) => ({ value, label }));

const makeDefaultAssignment = (company) => {
  const moduleAccess = {};
  getEnabledCompanyModuleKeys(company).forEach((key) => {
    const accessKey = MODULE_KEY_MAP[key] || key;
    moduleAccess[accessKey] = 'View only';
  });
  return {
    company: company?._id,
    moduleAccess,
    permissions: emptyPermissionMap(),
    rights: [],
    carwashBranch: null,
  };
};

const applyProfileToAssignment = (profile, assignment, company) => {
  const roleMap = PROFILE_MODULE_ROLES[profile] || {};
  const enabledModuleKeys = getEnabledCompanyModuleKeys(company);
  let newPermissions = emptyPermissionMap();
  const newModuleAccess = {};
  for (const moduleKey of enabledModuleKeys) {
    const accessKey = MODULE_KEY_MAP[moduleKey] || moduleKey;
    const roleKey = roleMap[moduleKey];
    if (roleKey) {
      newModuleAccess[accessKey] = 'Full access';
      newPermissions = applyModuleRole(newPermissions, moduleKey, roleKey);
    } else {
      newModuleAccess[accessKey] = 'View only';
    }
  }
  return { ...assignment, permissions: newPermissions, moduleAccess: newModuleAccess };
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
        carwashBranch: assignment?.carwashBranch || null,
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
    profile: user?.profile === 'Agent' ? 'Property Agent' : (user?.profile || 'Property Agent'),
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

const applyPreset = (preset, enabledModuleKeys, assignment) => {
  const allPerms = ACCESS_SECTIONS.flatMap((s) =>
    s.permissions.filter((p) => !p.moduleKey || enabledModuleKeys.includes(p.moduleKey))
  );
  if (preset === 'full') return setPermissionGroupValue(assignment.permissions, allPerms, true);
  if (preset === 'none') return setPermissionGroupValue(assignment.permissions, allPerms, false);
  const viewPerms = allPerms.filter((p) => p.action === 'view');
  const cleared = setPermissionGroupValue(assignment.permissions, allPerms, false);
  return setPermissionGroupValue(cleared, viewPerms, true);
};

export default function AddUserPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { state: locationState } = useLocation();
  const returnTo = locationState?.returnTo || '/system-setup/users';
  const dispatch = useDispatch();
  const currentUser = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const isEditing = Boolean(id);
  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);

  const [companies, setCompanies] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [branchesByCompany, setBranchesByCompany] = useState({});
  const [openSections, setOpenSections] = useState(() => new Set(ACCESS_SECTIONS.map((s) => s.id)));
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);

  const toggleSection = (sectionId) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(sectionId) ? next.delete(sectionId) : next.add(sectionId);
      return next;
    });

  const [form, setForm] = useState({
    surname: '',
    otherNames: '',
    idNumber: '',
    gender: '',
    postalAddress: '',
    phoneNumber: '',
    email: '',
    profile: 'Property Agent',
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
        const [companyRes, userRes] = await Promise.all([
          adminRequests.get('/companies', { params: { limit: 500 } }),
          isEditing ? adminRequests.get(`/users/${id}`) : Promise.resolve(null),
        ]);
        const companyList = Array.isArray(companyRes?.data?.companies)
          ? companyRes.data.companies
          : Array.isArray(companyRes?.data)
            ? companyRes.data
            : [];
        setCompanies(companyList);

        if (isEditing) {
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

  const loadedBranchCompanies = useRef(new Set());
  useEffect(() => {
    const carwashCompanyIds = form.companyAssignments
      .filter((a) => {
        const company = companies.find((c) => c._id === a.company);
        const keys = getEnabledCompanyModuleKeys(company);
        return keys.includes('carwash') && !loadedBranchCompanies.current.has(a.company);
      })
      .map((a) => a.company);

    carwashCompanyIds.forEach((companyId) => {
      loadedBranchCompanies.current.add(companyId);
      adminRequests
        .get('/carwash/branches', { params: { company: companyId, active: true, limit: 100 } })
        .then((res) => {
          const list = Array.isArray(res?.data?.branches)
            ? res.data.branches
            : Array.isArray(res?.data?.data?.branches)
              ? res.data.data.branches
              : [];
          setBranchesByCompany((prev) => ({ ...prev, [companyId]: list }));
        })
        .catch(() => setBranchesByCompany((prev) => ({ ...prev, [companyId]: [] })));
    });
  }, [form.companyAssignments, companies]);

  const availableCompanies = useMemo(() => {
    if (isSystemAdmin) return companies;
    return companies.filter((company) => company._id === currentCompany?._id);
  }, [companies, isSystemAdmin, currentCompany?._id]);

  const enabledModuleKeysByCompany = useMemo(() => {
    const m = {};
    availableCompanies.forEach((c) => { m[c._id] = getEnabledCompanyModuleKeys(c); });
    return m;
  }, [availableCompanies]);

  const profileDesc = useMemo(
    () => PROFILE_OPTIONS.find((p) => p.value === form.profile)?.description,
    [form.profile]
  );

  const primaryCompanyOptions = useMemo(
    () => form.accessibleCompanies.map((id) => {
      const c = availableCompanies.find((x) => x._id === id);
      return { value: id, label: c?.companyName || id };
    }),
    [form.accessibleCompanies, availableCompanies]
  );

  const primaryCompanyName = useMemo(
    () => availableCompanies.find((c) => c._id === form.primaryCompany)?.companyName || '—',
    [availableCompanies, form.primaryCompany]
  );

  const updateForm = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const updateAssignment = (companyId, updater) =>
    setForm((prev) => ({
      ...prev,
      companyAssignments: prev.companyAssignments.map((item) =>
        item.company === companyId ? updater(item) : item
      ),
    }));

  const handleProfileChange = (profile) => {
    if (!profile) return;
    setForm((prev) => ({
      ...prev,
      profile,
      companyAssignments: prev.companyAssignments.map((assignment) => {
        const company = companies.find((c) => c._id === assignment.company);
        if (!company) return assignment;
        return applyProfileToAssignment(profile, assignment, company);
      }),
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
        : [...prev.companyAssignments, applyProfileToAssignment(prev.profile, makeDefaultAssignment(company), company)];
      const primaryCompany = accessibleCompanies.includes(prev.primaryCompany)
        ? prev.primaryCompany
        : accessibleCompanies[0] || '';
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
    if (!form.autoGeneratePassword && form.password && form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (isEditing && form.password && form.password.length < 8) {
      toast.error('New password must be at least 8 characters');
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
          if (onboardingEmail?.sent) toast.success('User created and onboarding email sent successfully');
          else if (generatedAccess?.temporaryPassword) toast.success(`User created. Temporary password: ${generatedAccess.temporaryPassword}`);
          else toast.success('User created successfully');
        } else {
          toast.success('User created successfully');
        }
      }
      navigate(returnTo);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || 'Failed to save user');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">

        {/* Dark green sticky header */}
        <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(returnTo)}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#B7C9C0] hover:text-white transition"
              >
                <FaArrowLeft /> Back
              </button>
              <div className="h-4 w-px bg-[#2A5C4A]" />
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#B7C9C0]">
                  System Administration
                </div>
                <h1 className="text-sm font-black text-white leading-none">
                  {isEditing ? 'Update User Access' : 'New User'}
                </h1>
              </div>
            </div>
            <span className="rounded-lg border border-[#2A5C4A] bg-[#0A3127] px-2.5 py-1 text-[10px] font-bold text-[#B7C9C0]">
              {isSystemAdmin ? 'Multi-company enabled' : 'Single company'}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            Loading user setup...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">

            {/* Scrollable content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid gap-3 lg:grid-cols-[1.1fr,0.9fr]">

                {/* User details card */}
                <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center gap-2 bg-[#0B3B2E] px-3 py-2">
                    <FaUserPlus className="shrink-0 text-xs text-[#B7C9C0]" />
                    <h2 className="text-[11px] font-bold uppercase tracking-wide text-white">User Details</h2>
                  </div>
                  <div className="p-3">
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {[
                        ['surname',       'Surname *'],
                        ['otherNames',    'Other names *'],
                        ['idNumber',      'ID / Passport *'],
                        ['phoneNumber',   'Phone number *'],
                        ['email',         'Email *'],
                        ['postalAddress', 'Postal address'],
                      ].map(([field, label]) => (
                        <label key={field} className="text-xs font-semibold text-slate-700">
                          <span className="mb-0.5 block">{label}</span>
                          <input
                            value={form[field]}
                            onChange={(e) => updateForm(field, e.target.value)}
                            className="h-8 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                          />
                        </label>
                      ))}
                      <AppSelect
                        label="Gender"
                        value={form.gender}
                        onChange={(v) => updateForm('gender', v ?? '')}
                        options={[
                          { value: 'Male', label: 'Male' },
                          { value: 'Female', label: 'Female' },
                          { value: 'Other', label: 'Other' },
                        ]}
                        placeholder="Select gender"
                        size="md"
                      />
                      <div>
                        <AppSelect
                          label="Profile *"
                          value={form.profile}
                          onChange={(v) => handleProfileChange(v ?? 'Property Agent')}
                          options={PROFILE_SELECT_OPTIONS}
                          size="md"
                        />
                        {profileDesc && (
                          <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
                            {profileDesc}
                          </p>
                        )}
                      </div>
                      {(isEditing || !form.autoGeneratePassword) && (
                        <>
                          <div className="text-xs font-semibold text-slate-700">
                            <span className="mb-0.5 block">Password {isEditing ? '(optional)' : '*'}</span>
                            <div className="relative">
                              <input
                                type={showPw ? 'text' : 'password'}
                                value={form.password}
                                onChange={(e) => updateForm('password', e.target.value)}
                                className="h-8 w-full rounded-lg border border-slate-200 px-3 pr-8 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                              />
                              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                {showPw ? <FaEyeSlash size={10} /> : <FaEye size={10} />}
                              </button>
                            </div>
                          </div>
                          <div className="text-xs font-semibold text-slate-700">
                            <span className="mb-0.5 block">Confirm password</span>
                            <div className="relative">
                              <input
                                type={showCpw ? 'text' : 'password'}
                                value={form.confirmPassword}
                                onChange={(e) => updateForm('confirmPassword', e.target.value)}
                                className="h-8 w-full rounded-lg border border-slate-200 px-3 pr-8 text-xs outline-none focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                              />
                              <button type="button" onClick={() => setShowCpw(!showCpw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                {showCpw ? <FaEyeSlash size={10} /> : <FaEye size={10} />}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Access toggles */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        ['userControl',        'User control'],
                        ['adminAccess',        'Company admin'],
                        ['setupAccess',        'Operational settings'],
                        ['companySetupAccess', 'Company setup'],
                      ].map(([field, label]) => (
                        <label
                          key={field}
                          className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(form[field])}
                            onChange={(e) => updateForm(field, e.target.checked)}
                            className="accent-[#0B3B2E]"
                          />
                          {label}
                        </label>
                      ))}
                      {isSystemAdmin && (
                        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1.5 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(form.superAdminAccess)}
                            onChange={(e) => updateForm('superAdminAccess', e.target.checked)}
                            className="accent-[#FF8C00]"
                          />
                          Milik super admin
                        </label>
                      )}
                    </div>

                    {/* First-time sign-in options */}
                    {!isEditing && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-[#0B3B2E]">
                          <FaKey size={9} /> First-time sign-in:
                        </span>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.autoGeneratePassword}
                            onChange={(e) => updateForm('autoGeneratePassword', e.target.checked)}
                            className="accent-[#0B3B2E]"
                          />
                          Auto-generate password
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={form.sendOnboardingEmail}
                            onChange={(e) => updateForm('sendOnboardingEmail', e.target.checked)}
                            disabled={!form.autoGeneratePassword}
                            className="accent-[#0B3B2E]"
                          />
                          Send onboarding email
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                {/* Company assignment card */}
                <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center gap-2 bg-[#0B3B2E] px-3 py-2">
                    <FaBuilding className="shrink-0 text-xs text-[#B7C9C0]" />
                    <h2 className="text-[11px] font-bold uppercase tracking-wide text-white">Company Assignment</h2>
                  </div>
                  <div className="p-3">
                    <div className="space-y-1.5">
                      {availableCompanies.map((company) => {
                        const checked = form.accessibleCompanies.includes(company._id);
                        return (
                          <label
                            key={company._id}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
                              checked
                                ? 'border-[#0B3B2E]/30 bg-[#EDF5F1]'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCompany(company)}
                              className="accent-[#0B3B2E]"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-black text-slate-900">{company.companyName}</div>
                              <div className="text-[10px] text-slate-500">{company.companyCode || 'No code'}</div>
                            </div>
                            {checked && <FaCheckCircle className="shrink-0 text-[#0B3B2E]" size={11} />}
                          </label>
                        );
                      })}
                    </div>

                    <AppSelect
                      label="Primary company *"
                      value={form.primaryCompany}
                      onChange={(v) => updateForm('primaryCompany', v ?? '')}
                      options={primaryCompanyOptions}
                      placeholder="Select primary company"
                      searchable
                      size="md"
                      className="mt-2"
                    />

                    <div className="mt-2 flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <span>
                        <span className="font-black text-slate-900">{form.accessibleCompanies.length}</span>{' '}
                        compan{form.accessibleCompanies.length === 1 ? 'y' : 'ies'} selected
                      </span>
                      <span>
                        Primary:{' '}
                        <span className="font-bold text-slate-900">
                          {primaryCompanyName}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modules & Privileges */}
              <div className="mt-3 overflow-hidden border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 bg-[#0B3B2E] px-3 py-2">
                  <FaShieldAlt className="shrink-0 text-xs text-[#B7C9C0]" />
                  <h2 className="flex-1 text-[11px] font-bold uppercase tracking-wide text-white">
                    Modules &amp; Action Privileges
                  </h2>
                  <p className="text-[10px] text-[#B7C9C0]">
                    Configure per-company access level and granular permissions
                  </p>
                </div>

                <div className="divide-y divide-slate-100">
                  {form.companyAssignments.map((assignment) => {
                    const company = availableCompanies.find((item) => item._id === assignment.company);
                    const enabledModuleKeys = enabledModuleKeysByCompany[assignment.company] || [];

                    const allEnabledPerms = ACCESS_SECTIONS.flatMap((s) =>
                      s.permissions.filter((p) => !p.moduleKey || enabledModuleKeys.includes(p.moduleKey))
                    );
                    const totalGranted = sectionPermissionCount(assignment.permissions, allEnabledPerms);

                    return (
                      <div key={assignment.company} className="p-4">
                        {/* Company row */}
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <FaBuilding className="text-[10px] text-slate-400" />
                            <span className="text-xs font-black text-slate-900">
                              {company?.companyName || 'Company'}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                              {enabledModuleKeys.length} modules
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-slate-400">
                              {totalGranted} permission{totalGranted !== 1 ? 's' : ''} granted
                            </span>
                            <div className="h-3 w-px bg-slate-200" />
                            <span className="text-[10px] font-bold text-slate-500">Quick set:</span>
                            {[
                              { key: 'none',     label: 'None',      cls: 'border-red-200 text-red-600 hover:bg-red-50'             },
                              { key: 'readonly', label: 'Read Only', cls: 'border-blue-200 text-blue-600 hover:bg-blue-50'          },
                              { key: 'full',     label: 'Full',      cls: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' },
                            ].map(({ key, label, cls }) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() =>
                                  updateAssignment(assignment.company, (current) => ({
                                    ...current,
                                    permissions: applyPreset(key, enabledModuleKeys, current),
                                  }))
                                }
                                className={`rounded border px-2 py-0.5 text-[10px] font-extrabold transition-colors ${cls}`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Module access levels */}
                        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                          <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                            Module Access Levels
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {enabledModuleKeys.map((moduleKey) => {
                              const mappedKey = MODULE_KEY_MAP[moduleKey] || moduleKey;
                              const currentAccess = assignment.moduleAccess?.[mappedKey] || 'View only';
                              const setAccess = (val) =>
                                updateAssignment(assignment.company, (current) => ({
                                  ...current,
                                  moduleAccess: { ...current.moduleAccess, [mappedKey]: val },
                                }));
                              const cardClass =
                                currentAccess === 'Not allowed'
                                  ? 'border-red-200 bg-white'
                                  : currentAccess === 'Full access'
                                    ? 'border-emerald-300 bg-emerald-50/50'
                                    : 'border-blue-200 bg-blue-50/30';
                              const dotClass =
                                currentAccess === 'Not allowed'
                                  ? 'bg-red-400'
                                  : currentAccess === 'Full access'
                                    ? 'bg-emerald-500'
                                    : 'bg-blue-400';

                              return (
                                <div key={moduleKey} className={`rounded-lg border p-2.5 transition-all ${cardClass}`}>
                                  <div className="mb-2 flex items-center gap-1.5">
                                    <span className={`h-2 w-2 rounded-full ${dotClass}`} />
                                    <span className="text-[11px] font-black text-slate-800">
                                      {MODULE_LABELS[moduleKey] || moduleKey}
                                    </span>
                                  </div>
                                  <div className="flex overflow-hidden rounded-md border border-slate-200 bg-white text-[10px] font-bold shadow-sm">
                                    {[
                                      { val: 'Not allowed', icon: <FaBan size={8} />,       label: 'None',  active: 'bg-red-500 text-white',     idle: 'text-slate-400 hover:bg-slate-50' },
                                      { val: 'View only',   icon: <FaEye size={8} />,       label: 'View',  active: 'bg-blue-500 text-white',    idle: 'text-slate-400 hover:bg-slate-50' },
                                      { val: 'Full access', icon: <FaUnlockAlt size={8} />, label: 'Full',  active: 'bg-emerald-500 text-white', idle: 'text-slate-400 hover:bg-slate-50' },
                                    ].map(({ val, icon, label, active, idle }) => (
                                      <button
                                        key={val}
                                        type="button"
                                        onClick={() => setAccess(val)}
                                        title={val}
                                        className={`flex flex-1 items-center justify-center gap-1 px-1.5 py-1.5 transition-colors ${
                                          currentAccess === val ? active : idle
                                        }`}
                                      >
                                        {icon}
                                        <span>{label}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Carwash branch lock */}
                          {enabledModuleKeys.includes('carwash') && assignment.moduleAccess?.carwash !== 'Not allowed' && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                              <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-amber-700">
                                Car Wash Branch Restriction
                              </div>
                              <AppSelect
                                value={assignment.carwashBranch || ''}
                                onChange={(v) =>
                                  updateAssignment(assignment.company, (current) => ({
                                    ...current,
                                    carwashBranch: v || null,
                                  }))
                                }
                                options={(branchesByCompany[assignment.company] || []).map((b) => ({
                                  value: b._id,
                                  label: b.name,
                                }))}
                                placeholder="All branches (admin — no restriction)"
                                clearable
                                size="sm"
                              />
                              <p className="mt-1 text-[10px] text-amber-700/70">
                                Blank = full multi-branch access. Select a branch to lock this user to it only.
                              </p>
                            </div>
                          )}

                          {/* Module role presets — one block per enabled module */}
                          {Object.entries(MODULE_ROLE_PRESETS)
                            .filter(([moduleKey]) => {
                              const accessKey = MODULE_KEY_MAP[moduleKey] ?? moduleKey;
                              return (
                                enabledModuleKeys.includes(moduleKey) &&
                                assignment.moduleAccess?.[accessKey] !== 'Not allowed'
                              );
                            })
                            .map(([moduleKey, preset]) => {
                              const currentRole = detectModuleRole(assignment.permissions, moduleKey);
                              return (
                                <div key={moduleKey} className={`mt-3 rounded-lg border p-2.5 ${preset.blockCls}`}>
                                  <div className={`mb-2 text-[10px] font-extrabold uppercase tracking-[0.14em] ${preset.titleCls}`}>
                                    {preset.label}
                                  </div>
                                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                    {Object.entries(preset.roles).map(([key, role]) => {
                                      const active = currentRole === key;
                                      return (
                                        <button
                                          key={key}
                                          type="button"
                                          onClick={() =>
                                            updateAssignment(assignment.company, (current) => ({
                                              ...current,
                                              permissions: applyModuleRole(current.permissions, moduleKey, key),
                                            }))
                                          }
                                          className={`rounded border px-2.5 py-2 text-left transition-colors ${
                                            active ? preset.activeCls : preset.inactiveCls
                                          }`}
                                        >
                                          <p className="text-[11px] font-extrabold">{role.label}</p>
                                          <p className={`mt-0.5 text-[10px] leading-tight ${active ? preset.activeDescCls : 'text-slate-400'}`}>
                                            {role.description}
                                          </p>
                                        </button>
                                      );
                                    })}
                                    {currentRole === 'custom' && (
                                      <div className="rounded border border-slate-300 bg-slate-100 px-2.5 py-2">
                                        <p className="text-[11px] font-extrabold text-slate-600">Custom</p>
                                        <p className="mt-0.5 text-[10px] leading-tight text-slate-400">
                                          Permissions set manually below
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                  <p className={`mt-2 text-[10px] ${preset.hintCls}`}>
                                    Selecting a role overwrites the {preset.label.replace(' Role', '')} section of granular permissions below.
                                  </p>
                                </div>
                              );
                            })
                          }
                        </div>

                        {/* Granular action permissions */}
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="border-b border-slate-100 px-3 py-2">
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                              Granular Action Permissions
                            </p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {ACCESS_SECTIONS.map((section) => {
                              const enabledPermissions = section.permissions.filter(
                                (p) => !p.moduleKey || enabledModuleKeys.includes(p.moduleKey)
                              );
                              if (!enabledPermissions.length) return null;
                              const granted = sectionPermissionCount(assignment.permissions, enabledPermissions);
                              const isOpen = openSections.has(section.id);
                              const meta = SECTION_META[section.id] || { bar: 'bg-slate-400' };
                              const allGranted = granted === enabledPermissions.length;

                              return (
                                <div key={section.id}>
                                  <button
                                    type="button"
                                    onClick={() => toggleSection(section.id)}
                                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                                  >
                                    <span className={`h-2.5 w-1 shrink-0 rounded-full ${meta.bar}`} />
                                    <span className="flex-1 text-[11px] font-black text-slate-800">
                                      {section.label}
                                    </span>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ${
                                        allGranted
                                          ? 'bg-emerald-100 text-emerald-700'
                                          : granted > 0
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'bg-slate-100 text-slate-500'
                                      }`}
                                    >
                                      {granted}/{enabledPermissions.length}
                                    </span>
                                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          updateAssignment(assignment.company, (current) => ({
                                            ...current,
                                            permissions: setPermissionGroupValue(
                                              current.permissions,
                                              enabledPermissions,
                                              true
                                            ),
                                          }))
                                        }
                                        className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-700 hover:bg-emerald-100"
                                      >
                                        All
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          updateAssignment(assignment.company, (current) => ({
                                            ...current,
                                            permissions: setPermissionGroupValue(
                                              current.permissions,
                                              enabledPermissions,
                                              false
                                            ),
                                          }))
                                        }
                                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-extrabold text-slate-500 hover:bg-slate-50"
                                      >
                                        Clear
                                      </button>
                                    </div>
                                    {isOpen ? (
                                      <FaChevronUp className="shrink-0 text-[10px] text-slate-400" />
                                    ) : (
                                      <FaChevronDown className="shrink-0 text-[10px] text-slate-400" />
                                    )}
                                  </button>

                                  {isOpen && (
                                    <div className="grid gap-1.5 border-t border-slate-100 bg-slate-50/40 px-3 py-2.5 sm:grid-cols-2 xl:grid-cols-3">
                                      {enabledPermissions.map((permission) => {
                                        const checked = Boolean(
                                          assignment.permissions?.[permission.resource]?.[permission.action]
                                        );
                                        const isDanger = DANGER_ACTIONS.has(permission.action);
                                        return (
                                          <label
                                            key={`${permission.resource}.${permission.action}`}
                                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all ${
                                              checked
                                                ? isDanger
                                                  ? 'border-red-200 bg-red-50 text-red-800'
                                                  : 'border-[#0B3B2E]/20 bg-[#EDF5F1] text-[#0B3B2E]'
                                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={(e) =>
                                                updateAssignment(assignment.company, (current) => {
                                                  const perms = normalizePermissionMap(current.permissions || {});
                                                  return {
                                                    ...current,
                                                    permissions: {
                                                      ...perms,
                                                      [permission.resource]: {
                                                        ...perms[permission.resource],
                                                        [permission.action]: e.target.checked,
                                                      },
                                                    },
                                                  };
                                                })
                                              }
                                              className="accent-[#0B3B2E]"
                                            />
                                            <span className="leading-tight">{permission.label}</span>
                                            {isDanger && checked && (
                                              <span className="ml-auto rounded bg-red-100 px-1 text-[8px] font-extrabold uppercase text-red-600">
                                                sensitive
                                              </span>
                                            )}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {!form.companyAssignments.length && (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-xs text-slate-500">
                      Select at least one company above to configure modules and action permissions.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-[#F6FAF8] px-4 py-2.5">
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => navigate(returnTo)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-black text-white hover:bg-[#0A3127] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FaSave />
                  {isSaving ? 'Saving...' : isEditing ? 'Update user access' : 'Create user'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
