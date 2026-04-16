import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowRight,
  FaBoxOpen,
  FaBuilding,
  FaChartBar,
  FaCheckCircle,
  FaChevronRight,
  FaCog,
  FaEdit,
  FaEnvelope,
  FaExclamationTriangle,
  FaEye,
  FaGlobeAfrica,
  FaHistory,
  FaLock,
  FaLockOpen,
  FaMapMarkerAlt,
  FaPlus,
  FaSearch,
  FaShieldAlt,
  FaStore,
  FaTrash,
  FaUserCog,
  FaUserPlus,
  FaUsers,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import {
  deleteCompany,
  deleteUser,
  getCompanies,
  getUsers,
  switchCompany,
  toggleUserLock,
} from "../../redux/apiCalls";
import {
  getCompanyOperatingModeLabel,
  getEnabledCompanyModuleKeys,
} from "../../utils/companyModules";

const MILIK_GREEN = "#0B3B2E";
const SECTION_ALIASES = {
  rights: "users",
  database: "overview",
  sessions: "trials",
};
const VALID_SECTIONS = ["overview", "companies", "users", "trials", "audit"];

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const initialsFromName = (value = "") =>
  String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "M";

const formatDate = (value, options = { year: "numeric", month: "short", day: "numeric" }) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-KE", options);
};

const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

const isCompanyActive = (company = {}) => {
  const accountStatus = normalizeText(company?.accountStatus);
  if (["inactive", "disabled", "suspended", "archived"].includes(accountStatus)) {
    return false;
  }
  if (typeof company?.isActive === "boolean") return company.isActive;
  return accountStatus !== "inactive";
};

const getCompanyStatusLabel = (company = {}) => {
  if (company?.isDemoWorkspace) return "Demo";
  if (!isCompanyActive(company)) return "Inactive";
  return company?.accountStatus || "Active";
};

const getStatusTone = (status = "") => {
  const normalized = normalizeText(status);
  if (["active", "live"].includes(normalized)) {
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  }
  if (["demo", "trial"].includes(normalized)) {
    return "bg-violet-50 text-violet-700 border border-violet-200";
  }
  if (["inactive", "suspended", "disabled", "archived"].includes(normalized)) {
    return "bg-slate-100 text-slate-700 border border-slate-200";
  }
  return "bg-amber-50 text-amber-700 border border-amber-200";
};

const getReadinessTone = (score) => {
  if (score >= 80) return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (score >= 50) return "bg-amber-50 text-amber-700 border border-amber-200";
  return "bg-rose-50 text-rose-700 border border-rose-200";
};

const getUserAssignedCompanyIds = (user = {}) => {
  const directAssignments = Array.isArray(user?.companyAssignments) ? user.companyAssignments : [];
  const accessibleCompanies = Array.isArray(user?.accessibleCompanies) ? user.accessibleCompanies : [];
  const primaryCandidates = [user?.primaryCompany, user?.company];

  const ids = new Set();
  directAssignments.forEach((assignment) => {
    const companyId = normalizeId(assignment?.company || assignment);
    if (companyId) ids.add(companyId);
  });
  accessibleCompanies.forEach((company) => {
    const companyId = normalizeId(company);
    if (companyId) ids.add(companyId);
  });
  primaryCandidates.forEach((company) => {
    const companyId = normalizeId(company);
    if (companyId) ids.add(companyId);
  });

  return Array.from(ids);
};

const getPrimaryCompanyName = (user = {}, companyMap = new Map()) => {
  const primaryId = normalizeId(user?.primaryCompany || user?.company);
  if (primaryId && companyMap.has(primaryId)) {
    return companyMap.get(primaryId)?.companyName || "-";
  }
  if (typeof user?.company === "object" && user?.company?.companyName) {
    return user.company.companyName;
  }
  if (typeof user?.primaryCompany === "object" && user?.primaryCompany?.companyName) {
    return user.primaryCompany.companyName;
  }
  return "-";
};

const getUserRoleLabel = (user = {}) => {
  if (user?.superAdminAccess || user?.isSystemAdmin) return "Milik Admin";
  if (user?.adminAccess) return "Company Admin";
  if (user?.setupAccess || user?.companySetupAccess) return "Setup Access";
  if (user?.profile) return user.profile;
  return "User";
};

const evaluateCompanySetup = (company = {}, userCount = 0) => {
  const enabledModules = getEnabledCompanyModuleKeys(company);
  const emailProfiles = company?.communication?.emailProfiles || [];
  const smsProfiles = company?.communication?.smsProfiles || [];
  const hasPaymentSetup = Boolean(
    company?.paymentIntegration?.mpesaPaybill ||
      (Array.isArray(company?.paymentIntegration?.mpesaPaybills) && company.paymentIntegration.mpesaPaybills.length > 0)
  );

  const checks = [
    {
      key: "profile",
      label: "Company profile",
      ok: Boolean(company?.companyName && (company?.email || company?.phoneNo) && company?.postalAddress),
    },
    {
      key: "mode",
      label: "Operating model",
      ok: Boolean(company?.companyMode),
    },
    {
      key: "modules",
      label: "Modules",
      ok: enabledModules.length > 0,
    },
    {
      key: "payments",
      label: "Payments & collections",
      ok: hasPaymentSetup,
    },
    {
      key: "communications",
      label: "Communications",
      ok: emailProfiles.length > 0 || smsProfiles.length > 0,
    },
    {
      key: "users",
      label: "Users assigned",
      ok: userCount > 0,
    },
  ];

  const passed = checks.filter((item) => item.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const missing = checks.filter((item) => !item.ok).map((item) => item.label);
  const label = score >= 80 ? "Ready" : score >= 50 ? "In Progress" : "Needs Attention";

  return {
    score,
    label,
    missing,
    enabledModules,
    hasPaymentSetup,
    hasCommunicationSetup: emailProfiles.length > 0 || smsProfiles.length > 0,
  };
};

const StatCard = ({ label, value, icon: Icon, hint }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
        {hint ? <div className="mt-1 text-sm text-slate-500">{hint}</div> : null}
      </div>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
        <Icon className="text-lg" />
      </div>
    </div>
  </div>
);

const SectionButton = ({ active, label, icon: Icon, onClick }) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-black transition ${
      active
        ? "bg-emerald-700 text-white shadow-sm"
        : "border border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:text-emerald-700"
    }`}
  >
    <Icon className="text-sm" />
    {label}
  </button>
);

const ActionLink = ({ icon: Icon, label, onClick, tone = "default" }) => {
  const tones = {
    default: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    primary: "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800",
    subtle: "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    danger: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
  };

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-bold transition ${tones[tone]}`}
    >
      <Icon className="text-xs" />
      {label}
    </button>
  );
};

const SearchInput = ({ value, onChange, placeholder = "Search..." }) => (
  <label className="relative block min-w-[220px] flex-1">
    <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
    />
  </label>
);

const FilterSelect = ({ value, onChange, children }) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className="min-w-[170px] rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
  >
    {children}
  </select>
);

const CompanyAvatar = ({ company }) => {
  const logo = company?.logo;
  const name = company?.companyName || "Company";
  if (logo) {
    return <img src={logo} alt={name} className="h-12 w-12 rounded-2xl border border-slate-200 bg-white object-cover" />;
  }
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-sm font-black text-emerald-700">
      {initialsFromName(name)}
    </div>
  );
};

const OverviewPanel = ({
  companies,
  users,
  companyReadiness,
  companyUserCounts,
  onAddCompany,
  onAddUser,
  onOpenCompanySetup,
  onOpenOperationalSettings,
  onOpenWorkspace,
  onManageUsers,
}) => {
  const activeCompanies = companies.filter((company) => isCompanyActive(company) && !company?.isDemoWorkspace);
  const demoCompanies = companies.filter((company) => company?.isDemoWorkspace);
  const attentionCompanies = companies
    .filter((company) => (companyReadiness.get(normalizeId(company))?.score || 0) < 80)
    .slice(0, 5);
  const recentCompanies = [...companies]
    .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
    .slice(0, 5);
  const recentUsers = [...users]
    .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Companies" value={companies.length} icon={FaBuilding} hint="Platform tenants on MILIK" />
        <StatCard label="Active companies" value={activeCompanies.length} icon={FaCheckCircle} hint="Live operational companies" />
        <StatCard label="Demo workspaces" value={demoCompanies.length} icon={FaStore} hint="Demo or showcase environments" />
        <StatCard label="Users" value={users.length} icon={FaUsers} hint="All users across companies" />
        <StatCard label="Needs attention" value={attentionCompanies.length} icon={FaExclamationTriangle} hint="Companies below setup readiness" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Quick actions</div>
              <h2 className="mt-1 text-xl font-black text-slate-900">Run MILIK Admin from one control center</h2>
              <p className="mt-1 text-sm text-slate-500">
                Company setup stays company-facing. System Admin should create, assign, monitor, and hand off into the right workspace.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <button onClick={onAddCompany} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:bg-emerald-100">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-700 text-white"><FaPlus /></div>
              <div className="mt-3 text-base font-black text-slate-900">Add company</div>
              <div className="mt-1 text-sm text-slate-600">Create a new company record, then continue configuration in Company Setup.</div>
            </button>
            <button onClick={onAddUser} className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-200 hover:bg-slate-50">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-100 text-orange-700"><FaUserPlus /></div>
              <div className="mt-3 text-base font-black text-slate-900">Add user</div>
              <div className="mt-1 text-sm text-slate-600">Create a company-aware user and assign access per company.</div>
            </button>
            {companies[0] ? (
              <button
                onClick={() => onOpenCompanySetup(companies[0])}
                className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-200 hover:bg-slate-50"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700"><FaCog /></div>
                <div className="mt-3 text-base font-black text-slate-900">Open company setup</div>
                <div className="mt-1 text-sm text-slate-600">Switch into the selected company and continue company-facing configuration.</div>
              </button>
            ) : null}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-orange-50 p-5 shadow-sm">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Structure</div>
          <h2 className="mt-1 text-xl font-black text-slate-900">System Admin boundary</h2>
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <div className="rounded-2xl border border-white/70 bg-white/80 p-3">
              <div className="font-black text-slate-900">System Admin owns</div>
              <div className="mt-1">Companies, users, assignments, workspace access, demo oversight, and platform control.</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 p-3">
              <div className="font-black text-slate-900">Company users own</div>
              <div className="mt-1">Company Setup, Operational Settings, and day-to-day property management rules.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-600">Attention queue</div>
              <h3 className="mt-1 text-lg font-black text-slate-900">Companies needing setup follow-through</h3>
            </div>
            <div className="rounded-2xl bg-rose-50 px-3 py-1 text-xs font-black text-rose-700">{attentionCompanies.length} open</div>
          </div>
          <div className="mt-4 space-y-3">
            {attentionCompanies.length ? (
              attentionCompanies.map((company) => {
                const readiness = companyReadiness.get(normalizeId(company));
                const userCount = companyUserCounts.get(normalizeId(company)) || 0;
                return (
                  <div key={company._id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <CompanyAvatar company={company} />
                        <div>
                          <div className="text-base font-black text-slate-900">{company.companyName}</div>
                          <div className="text-sm text-slate-500">{getCompanyOperatingModeLabel(company?.companyMode)} · {userCount} user{userCount === 1 ? "" : "s"}</div>
                        </div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${getReadinessTone(readiness?.score || 0)}`}>
                        {readiness?.label || "Needs Attention"}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(readiness?.missing || []).slice(0, 3).map((item) => (
                        <span key={item} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                          Missing {item}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <ActionLink icon={FaCog} label="Company Setup" onClick={() => onOpenCompanySetup(company)} tone="subtle" />
                      <ActionLink icon={FaGlobeAfrica} label="Operational Settings" onClick={() => onOpenOperationalSettings(company)} />
                      <ActionLink icon={FaUsers} label="Manage Users" onClick={() => onManageUsers(company)} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-700">
                All current companies are in a strong readiness position.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Recent onboarding</div>
            <div className="mt-3 space-y-3">
              {recentCompanies.map((company) => (
                <button
                  key={company._id}
                  onClick={() => onOpenWorkspace(company)}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-emerald-200 hover:bg-slate-50"
                >
                  <div>
                    <div className="font-black text-slate-900">{company.companyName}</div>
                    <div className="text-sm text-slate-500">Created {formatDate(company.createdAt)} · {getCompanyOperatingModeLabel(company.companyMode)}</div>
                  </div>
                  <FaChevronRight className="text-slate-400" />
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">Recent user access</div>
            <div className="mt-3 space-y-3">
              {recentUsers.map((user) => (
                <div key={user._id} className="rounded-2xl border border-slate-200 px-4 py-3">
                  <div className="font-black text-slate-900">{`${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User"}</div>
                  <div className="text-sm text-slate-500">{getUserRoleLabel(user)} · Added {formatDate(user?.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const CompaniesPanel = ({
  companies,
  companyReadiness,
  companyUserCounts,
  onAddCompany,
  onEditCompany,
  onDeleteCompany,
  onOpenCompanySetup,
  onOpenOperationalSettings,
  onOpenWorkspace,
  onManageUsers,
}) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");

  const filteredCompanies = useMemo(() => {
    return companies.filter((company) => {
      const readiness = companyReadiness.get(normalizeId(company));
      const status = getCompanyStatusLabel(company);
      const modeLabel = getCompanyOperatingModeLabel(company?.companyMode);
      const searchHaystack = [
        company?.companyName,
        company?.companyCode,
        company?.registrationNo,
        company?.email,
        company?.town,
        company?.country,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !search || searchHaystack.includes(search.toLowerCase());
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "attention" && (readiness?.score || 0) < 80) ||
        normalizeText(status) === normalizeText(statusFilter);
      const matchesMode = modeFilter === "all" || normalizeText(modeLabel) === normalizeText(modeFilter);

      return matchesSearch && matchesStatus && matchesMode;
    });
  }, [companies, companyReadiness, modeFilter, search, statusFilter]);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Companies</div>
            <h2 className="mt-1 text-xl font-black text-slate-900">Platform companies and onboarding readiness</h2>
            <p className="mt-1 text-sm text-slate-500">Create companies here, then hand off into Company Setup and Operational Settings inside the selected company context.</p>
          </div>
          <ActionLink icon={FaPlus} label="Add company" onClick={onAddCompany} tone="primary" />
        </div>
        <div className="mt-4 flex flex-col gap-3 xl:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Search company, code, email, town..." />
          <FilterSelect value={statusFilter} onChange={setStatusFilter}>
            <option value="all">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Demo">Demo</option>
            <option value="attention">Needs attention</option>
          </FilterSelect>
          <FilterSelect value={modeFilter} onChange={setModeFilter}>
            <option value="all">All operating models</option>
            <option value="property manager">Property Manager</option>
            <option value="self-managing landlord">Self-Managing Landlord</option>
          </FilterSelect>
        </div>
      </div>

      <div className="space-y-4">
        {filteredCompanies.map((company) => {
          const companyId = normalizeId(company);
          const readiness = companyReadiness.get(companyId) || evaluateCompanySetup(company, 0);
          const userCount = companyUserCounts.get(companyId) || 0;
          const enabledModules = readiness.enabledModules || [];
          const statusLabel = getCompanyStatusLabel(company);

          return (
            <div key={companyId} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-start gap-4">
                  <CompanyAvatar company={company} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black text-slate-900">{company.companyName}</h3>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${getStatusTone(statusLabel)}`}>{statusLabel}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${getReadinessTone(readiness.score)}`}>{readiness.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-2"><FaShieldAlt className="text-emerald-700" /> {getCompanyOperatingModeLabel(company.companyMode)}</span>
                      <span className="inline-flex items-center gap-2"><FaEnvelope className="text-emerald-700" /> {company.email || "No email"}</span>
                      <span className="inline-flex items-center gap-2"><FaMapMarkerAlt className="text-emerald-700" /> {[company.town, company.country].filter(Boolean).join(", ") || "Location not set"}</span>
                    </div>
                  </div>
                </div>
                <div className="grid min-w-[240px] gap-3 rounded-3xl border border-slate-100 bg-slate-50 p-4 sm:grid-cols-3 xl:grid-cols-1">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Users</div>
                    <div className="mt-1 text-xl font-black text-slate-900">{userCount}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Enabled modules</div>
                    <div className="mt-1 text-xl font-black text-slate-900">{enabledModules.length}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Updated</div>
                    <div className="mt-1 text-sm font-bold text-slate-900">{formatDate(company.updatedAt || company.createdAt)}</div>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-slate-900">Setup readiness</div>
                    <div className="text-sm font-black text-slate-900">{readiness.score}%</div>
                  </div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-700" style={{ width: `${readiness.score}%` }} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {readiness.missing.length ? (
                      readiness.missing.map((item) => (
                        <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 border border-slate-200">
                          Missing {item}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">All key setup areas are covered</span>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-100 bg-white p-4">
                  <div className="text-sm font-black text-slate-900">Modules</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {enabledModules.length ? (
                      enabledModules.map((moduleKey) => (
                        <span key={moduleKey} className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          {moduleKey}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">No modules enabled yet</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <ActionLink icon={FaCog} label="Company Setup" onClick={() => onOpenCompanySetup(company)} tone="primary" />
                <ActionLink icon={FaGlobeAfrica} label="Operational Settings" onClick={() => onOpenOperationalSettings(company)} tone="subtle" />
                <ActionLink icon={FaUsers} label="Manage Users" onClick={() => onManageUsers(company)} />
                <ActionLink icon={FaEye} label="Open Workspace" onClick={() => onOpenWorkspace(company)} />
                <ActionLink icon={FaEdit} label="Edit Record" onClick={() => onEditCompany(company)} />
                <ActionLink icon={FaTrash} label="Delete" onClick={() => onDeleteCompany(company)} tone="danger" />
              </div>
            </div>
          );
        })}

        {!filteredCompanies.length ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No companies match the current filters.
          </div>
        ) : null}
      </div>
    </div>
  );
};

const UsersPanel = ({
  users,
  companies,
  companyMap,
  selectedCompanyId,
  onSelectedCompanyIdChange,
  onAddUser,
  onEditUser,
  onToggleUserLock,
  onDeleteUser,
}) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim();
      const haystack = [name, user?.email, user?.phoneNumber, getUserRoleLabel(user)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const assignedCompanyIds = getUserAssignedCompanyIds(user);
      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      const matchesCompany = !selectedCompanyId || assignedCompanyIds.includes(selectedCompanyId);
      const lockState = user?.locked ? "locked" : user?.isActive === false ? "inactive" : "active";
      const matchesStatus = statusFilter === "all" || lockState === statusFilter;
      return matchesSearch && matchesCompany && matchesStatus;
    });
  }, [search, selectedCompanyId, statusFilter, users]);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Users & access</div>
            <h2 className="mt-1 text-xl font-black text-slate-900">Company-aware user access</h2>
            <p className="mt-1 text-sm text-slate-500">Assign users to one or many companies, then govern what they can access inside each company workspace.</p>
          </div>
          <ActionLink icon={FaUserPlus} label="Add user" onClick={onAddUser} tone="primary" />
        </div>
        <div className="mt-4 flex flex-col gap-3 xl:flex-row">
          <SearchInput value={search} onChange={setSearch} placeholder="Search user, email, phone, role..." />
          <FilterSelect value={selectedCompanyId} onChange={onSelectedCompanyIdChange}>
            <option value="">All companies</option>
            {companies.map((company) => (
              <option key={company._id} value={company._id}>{company.companyName}</option>
            ))}
          </FilterSelect>
          <FilterSelect value={statusFilter} onChange={setStatusFilter}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="locked">Locked</option>
            <option value="inactive">Inactive</option>
          </FilterSelect>
        </div>
      </div>

      <div className="space-y-4">
        {filteredUsers.map((user) => {
          const userId = normalizeId(user);
          const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
          const assignedCompanyIds = getUserAssignedCompanyIds(user);
          const lockState = user?.locked ? "Locked" : user?.isActive === false ? "Inactive" : "Active";
          return (
            <div key={userId} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-sm font-black text-orange-700">
                    {initialsFromName(name)}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black text-slate-900">{name}</h3>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${getStatusTone(lockState)}`}>{lockState}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-500">
                      <span className="inline-flex items-center gap-2"><FaEnvelope className="text-emerald-700" /> {user?.email || "No email"}</span>
                      <span className="inline-flex items-center gap-2"><FaUserCog className="text-emerald-700" /> {getUserRoleLabel(user)}</span>
                      <span className="inline-flex items-center gap-2"><FaBuilding className="text-emerald-700" /> {assignedCompanyIds.length} compan{assignedCompanyIds.length === 1 ? "y" : "ies"}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Primary company</div>
                  <div className="mt-1 text-sm font-bold text-slate-900">{getPrimaryCompanyName(user, companyMap)}</div>
                  <div className="mt-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Created</div>
                  <div className="mt-1 text-sm font-bold text-slate-900">{formatDate(user?.createdAt)}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {assignedCompanyIds.length ? (
                  assignedCompanyIds.map((companyId) => (
                    <span key={companyId} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                      {companyMap.get(companyId)?.companyName || companyId}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">No company assigned</span>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <ActionLink icon={FaEdit} label="Edit user" onClick={() => onEditUser(user)} tone="primary" />
                <ActionLink
                  icon={user?.locked ? FaLockOpen : FaLock}
                  label={user?.locked ? "Unlock" : "Lock"}
                  onClick={() => onToggleUserLock(user)}
                />
                <ActionLink icon={FaTrash} label="Delete" onClick={() => onDeleteUser(user)} tone="danger" />
              </div>
            </div>
          );
        })}

        {!filteredUsers.length ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No users match the current filters.
          </div>
        ) : null}
      </div>
    </div>
  );
};

const TrialsPanel = ({ companies, companyReadiness, companyUserCounts, onOpenWorkspace, onOpenCompanySetup }) => {
  const demoCompanies = companies.filter((company) => company?.isDemoWorkspace);
  const inactiveCompanies = companies.filter((company) => !company?.isDemoWorkspace && !isCompanyActive(company));
  const attentionCompanies = companies.filter((company) => (companyReadiness.get(normalizeId(company))?.score || 0) < 80);

  const spotlightCompanies = [...new Set([...demoCompanies, ...inactiveCompanies, ...attentionCompanies])];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Demo workspaces" value={demoCompanies.length} icon={FaStore} hint="Demo or seeded showcase companies" />
        <StatCard label="Inactive companies" value={inactiveCompanies.length} icon={FaLock} hint="Companies not currently marked active" />
        <StatCard label="Needs activation work" value={attentionCompanies.length} icon={FaExclamationTriangle} hint="Companies with setup gaps to close" />
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Trials & demo</div>
        <h2 className="mt-1 text-xl font-black text-slate-900">Demo oversight and activation readiness</h2>
        <p className="mt-1 text-sm text-slate-500">This area keeps MILIK Admin focused on demo workspaces, inactive companies, and companies that still need setup work before being treated as fully ready.</p>
      </div>

      <div className="space-y-4">
        {spotlightCompanies.map((company) => {
          const companyId = normalizeId(company);
          const readiness = companyReadiness.get(companyId) || evaluateCompanySetup(company, 0);
          const userCount = companyUserCounts.get(companyId) || 0;
          const spotlightLabel = company?.isDemoWorkspace ? "Demo workspace" : !isCompanyActive(company) ? "Inactive company" : "Needs activation work";
          return (
            <div key={companyId} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-start gap-4">
                  <CompanyAvatar company={company} />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-black text-slate-900">{company.companyName}</div>
                      <span className={`rounded-full px-3 py-1 text-xs font-black ${getStatusTone(spotlightLabel)}`}>{spotlightLabel}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-500">{getCompanyOperatingModeLabel(company.companyMode)} · {userCount} user{userCount === 1 ? "" : "s"} · Updated {formatDate(company.updatedAt || company.createdAt)}</div>
                  </div>
                </div>
                <div className="rounded-3xl border border-slate-100 bg-slate-50 px-4 py-3 text-right">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Readiness</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{readiness.score}%</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {readiness.missing.length ? readiness.missing.map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">Missing {item}</span>
                )) : <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">No major setup gaps</span>}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <ActionLink icon={FaEye} label="Open workspace" onClick={() => onOpenWorkspace(company)} tone="primary" />
                <ActionLink icon={FaCog} label="Company Setup" onClick={() => onOpenCompanySetup(company)} tone="subtle" />
              </div>
            </div>
          );
        })}

        {!spotlightCompanies.length ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            No demo or activation-watch companies were found in the current data.
          </div>
        ) : null}
      </div>
    </div>
  );
};

const AuditPanel = ({ companies, users, companyMap }) => {
  const events = useMemo(() => {
    const rows = [];

    companies.forEach((company) => {
      if (company?.createdAt) {
        rows.push({
          id: `company-created-${company._id}`,
          timestamp: company.createdAt,
          title: `${company.companyName} created`,
          detail: `${getCompanyOperatingModeLabel(company.companyMode)} · ${getCompanyStatusLabel(company)}`,
          type: "Company",
        });
      }
      if (company?.updatedAt && company?.updatedAt !== company?.createdAt) {
        rows.push({
          id: `company-updated-${company._id}`,
          timestamp: company.updatedAt,
          title: `${company.companyName} updated`,
          detail: `${company.email || "No email"} · ${[company.town, company.country].filter(Boolean).join(", ") || "No location"}`,
          type: "Company",
        });
      }
    });

    users.forEach((user) => {
      const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
      const primaryCompany = getPrimaryCompanyName(user, companyMap);
      if (user?.createdAt) {
        rows.push({
          id: `user-created-${user._id}`,
          timestamp: user.createdAt,
          title: `${name} added`,
          detail: `${getUserRoleLabel(user)} · ${primaryCompany}`,
          type: "User",
        });
      }
      if (user?.updatedAt && user?.updatedAt !== user?.createdAt) {
        rows.push({
          id: `user-updated-${user._id}`,
          timestamp: user.updatedAt,
          title: `${name} updated`,
          detail: `${user?.locked ? "Locked" : user?.isActive === false ? "Inactive" : "Active"} · ${primaryCompany}`,
          type: "User",
        });
      }
    });

    return rows
      .filter((item) => item.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 40);
  }, [companies, users, companyMap]);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Audit view</div>
        <h2 className="mt-1 text-xl font-black text-slate-900">Recent platform activity snapshot</h2>
        <p className="mt-1 text-sm text-slate-500">This view is built from saved company and user records so Milik Admin can quickly see the most recent platform-level movement in one place.</p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="flex gap-4 rounded-2xl border border-slate-200 p-4">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                {event.type === "Company" ? <FaBuilding /> : <FaUsers />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-black text-slate-900">{event.title}</div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">{event.type}</span>
                </div>
                <div className="mt-1 text-sm text-slate-600">{event.detail}</div>
              </div>
              <div className="shrink-0 text-right text-xs font-semibold text-slate-500">
                <div>{formatDate(event.timestamp)}</div>
              </div>
            </div>
          ))}

          {!events.length ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
              No recent platform activity was found.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default function SystemSetupPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const { companies, isFetching: companiesFetching, currentCompany } = useSelector((state) => state.company || {});
  const { users, isFetching: usersFetching } = useSelector((state) => state.user || {});
  const { currentUser } = useSelector((state) => state.auth || {});

  const rawSection = location.pathname.split("/")[2] || "overview";
  const activeSection = SECTION_ALIASES[rawSection] || rawSection;
  const companyFilterFromQuery = new URLSearchParams(location.search).get("company") || "";
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyFilterFromQuery);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    isDangerous: false,
    confirmText: "Confirm",
    onConfirm: null,
  });

  const companyList = Array.isArray(companies) ? companies : [];
  const userList = Array.isArray(users) ? users : [];
  const companyMap = useMemo(() => new Map(companyList.map((company) => [normalizeId(company), company])), [companyList]);

  const companyUserCounts = useMemo(() => {
    const counts = new Map();
    userList.forEach((user) => {
      getUserAssignedCompanyIds(user).forEach((companyId) => {
        counts.set(companyId, (counts.get(companyId) || 0) + 1);
      });
    });
    return counts;
  }, [userList]);

  const companyReadiness = useMemo(() => {
    const readiness = new Map();
    companyList.forEach((company) => {
      readiness.set(normalizeId(company), evaluateCompanySetup(company, companyUserCounts.get(normalizeId(company)) || 0));
    });
    return readiness;
  }, [companyList, companyUserCounts]);

  useEffect(() => {
    if (!VALID_SECTIONS.includes(activeSection)) {
      navigate("/system-setup/overview", { replace: true });
    }
  }, [activeSection, navigate]);

  useEffect(() => {
    dispatch(getCompanies({ includeDemo: true }));
  }, [dispatch]);

  useEffect(() => {
    dispatch(getUsers(selectedCompanyId || undefined));
  }, [dispatch, selectedCompanyId]);

  useEffect(() => {
    setSelectedCompanyId(companyFilterFromQuery);
  }, [companyFilterFromQuery]);

  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);
  const activeCompanyName = currentCompany?.companyName || currentUser?.company?.companyName || "No active company";

  const goToSection = (section, nextQuery = "") => {
    navigate(`/system-setup/${section}${nextQuery}`);
  };

  const handleCompanyFilterChange = (companyId) => {
    setSelectedCompanyId(companyId);
    const query = companyId ? `?company=${companyId}` : "";
    navigate(`/system-setup/users${query}`, { replace: true });
  };

  const handleSwitchAndNavigate = async (company, route, successMessage) => {
    const companyId = normalizeId(company);
    if (!companyId) {
      toast.error("The selected company is missing a valid identifier.");
      return;
    }

    try {
      await dispatch(switchCompany(companyId));
      navigate(route, { state: { tabTitle: company?.companyName || "Company" } });
      if (successMessage) {
        toast.success(successMessage);
      }
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to switch company context.");
    }
  };

  const handleOpenCompanySetup = (company) =>
    handleSwitchAndNavigate(company, "/company-setup", `Opened ${company?.companyName || "company"} in Company Setup`);

  const handleOpenOperationalSettings = (company) =>
    handleSwitchAndNavigate(company, "/settings", `Opened ${company?.companyName || "company"} in Operational Settings`);

  const handleOpenWorkspace = (company) =>
    handleSwitchAndNavigate(company, "/dashboard", `Opened ${company?.companyName || "company"} workspace`);

  const handleManageUsers = (company) => {
    const companyId = normalizeId(company);
    if (!companyId) return;
    handleCompanyFilterChange(companyId);
  };

  const handleEditCompany = (company) => {
    const companyId = normalizeId(company);
    if (!companyId) {
      toast.error("Unable to open this company record.");
      return;
    }
    navigate(`/add-company/${companyId}`, { state: { tabTitle: company?.companyName || "Company" } });
  };

  const handleDeleteCompany = (company) => {
    const companyId = normalizeId(company);
    if (!companyId) return;
    setConfirmDialog({
      isOpen: true,
      title: "Delete company",
      message: `Delete ${company?.companyName || "this company"}? This action cannot be undone.`,
      isDangerous: true,
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          await dispatch(deleteCompany(companyId));
          toast.success("Company deleted successfully.");
        } catch (error) {
          toast.error(error?.response?.data?.message || error?.message || "Failed to delete company.");
        } finally {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const handleEditUser = (user) => {
    const userId = normalizeId(user);
    if (!userId) return;
    navigate(`/add-user/${userId}`, { state: { tabTitle: "User Access" } });
  };

  const handleToggleUserLock = (user) => {
    const userId = normalizeId(user);
    if (!userId) return;
    dispatch(toggleUserLock(userId))
      .then(() => {
        toast.success(user?.locked ? "User unlocked successfully." : "User locked successfully.");
      })
      .catch((error) => {
        toast.error(error?.response?.data?.message || error?.message || "Failed to update user lock status.");
      });
  };

  const handleDeleteUser = (user) => {
    const userId = normalizeId(user);
    const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "this user";
    if (!userId) return;
    setConfirmDialog({
      isOpen: true,
      title: "Delete user",
      message: `Delete ${name}? This action cannot be undone.`,
      isDangerous: true,
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          await dispatch(deleteUser(userId));
          toast.success("User deleted successfully.");
        } catch (error) {
          toast.error(error?.response?.data?.message || error?.message || "Failed to delete user.");
        } finally {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const sections = [
    { key: "overview", label: "Overview", icon: FaChartBar },
    { key: "companies", label: "Companies", icon: FaBuilding },
    { key: "users", label: "Users & Access", icon: FaUsers },
    { key: "trials", label: "Trials & Demo", icon: FaBoxOpen },
    { key: "audit", label: "Audit Log", icon: FaHistory },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-5">
        {!isSystemAdmin ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            System Admin is reserved for MILIK Admin only.
          </div>
        ) : (
          <>
            <div className="rounded-[28px] border border-slate-200 bg-gradient-to-r from-emerald-50 via-white to-orange-50 p-5 shadow-sm">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">System Admin</div>
                  <h1 className="mt-1 text-2xl font-black text-slate-900">MILIK platform control center</h1>
                  <p className="mt-2 max-w-3xl text-sm text-slate-600">
                    System Admin manages companies, user access, demo oversight, and workspace handoff. Company Setup and Operational Settings remain company-facing and should be reached from the selected company context.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl border border-white bg-white/90 px-4 py-3 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Active company context</div>
                    <div className="mt-1 text-base font-black text-slate-900">{activeCompanyName}</div>
                  </div>
                  <div className="rounded-3xl border border-white bg-white/90 px-4 py-3 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Platform scope</div>
                    <div className="mt-1 text-base font-black text-slate-900">{companyList.length} companies · {userList.length} users</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              {sections.map((section) => (
                <SectionButton
                  key={section.key}
                  active={activeSection === section.key}
                  label={section.label}
                  icon={section.icon}
                  onClick={() => goToSection(section.key, section.key === "users" && selectedCompanyId ? `?company=${selectedCompanyId}` : "")}
                />
              ))}
            </div>

            <div className="mt-5">
              {companiesFetching && !companyList.length ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading companies...</div>
              ) : null}

              {!companiesFetching || companyList.length ? (
                <>
                  {activeSection === "overview" ? (
                    <OverviewPanel
                      companies={companyList}
                      users={userList}
                      companyReadiness={companyReadiness}
                      companyUserCounts={companyUserCounts}
                      onAddCompany={() => navigate("/add-company", { state: { tabTitle: "New Company" } })}
                      onAddUser={() => navigate("/add-user", { state: { tabTitle: "New User" } })}
                      onOpenCompanySetup={handleOpenCompanySetup}
                      onOpenOperationalSettings={handleOpenOperationalSettings}
                      onOpenWorkspace={handleOpenWorkspace}
                      onManageUsers={handleManageUsers}
                    />
                  ) : null}

                  {activeSection === "companies" ? (
                    <CompaniesPanel
                      companies={companyList}
                      companyReadiness={companyReadiness}
                      companyUserCounts={companyUserCounts}
                      onAddCompany={() => navigate("/add-company", { state: { tabTitle: "New Company" } })}
                      onEditCompany={handleEditCompany}
                      onDeleteCompany={handleDeleteCompany}
                      onOpenCompanySetup={handleOpenCompanySetup}
                      onOpenOperationalSettings={handleOpenOperationalSettings}
                      onOpenWorkspace={handleOpenWorkspace}
                      onManageUsers={handleManageUsers}
                    />
                  ) : null}

                  {activeSection === "users" ? (
                    <UsersPanel
                      users={userList}
                      companies={companyList}
                      companyMap={companyMap}
                      selectedCompanyId={selectedCompanyId}
                      onSelectedCompanyIdChange={handleCompanyFilterChange}
                      onAddUser={() => navigate("/add-user", { state: { tabTitle: "New User" } })}
                      onEditUser={handleEditUser}
                      onToggleUserLock={handleToggleUserLock}
                      onDeleteUser={handleDeleteUser}
                    />
                  ) : null}

                  {activeSection === "trials" ? (
                    <TrialsPanel
                      companies={companyList}
                      companyReadiness={companyReadiness}
                      companyUserCounts={companyUserCounts}
                      onOpenWorkspace={handleOpenWorkspace}
                      onOpenCompanySetup={handleOpenCompanySetup}
                    />
                  ) : null}

                  {activeSection === "audit" ? (
                    <AuditPanel companies={companyList} users={userList} companyMap={companyMap} />
                  ) : null}
                </>
              ) : null}

              {usersFetching && activeSection === "users" ? (
                <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">Refreshing users...</div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <MilikConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmText={confirmDialog.confirmText}
        cancelText="Cancel"
        isDangerous={confirmDialog.isDangerous}
        onConfirm={() => confirmDialog.onConfirm?.()}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, isOpen: false }))}
      />
    </DashboardLayout>
  );
}