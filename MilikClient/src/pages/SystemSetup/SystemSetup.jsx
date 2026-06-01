import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaBoxOpen,
  FaBuilding,
  FaChartBar,
  FaCheckCircle,
  FaCog,
  FaEdit,
  FaEnvelope,
  FaExclamationTriangle,
  FaEye,
  FaGlobeAfrica,
  FaHistory,
  FaKey,
  FaLock,
  FaLockOpen,
  FaMapMarkerAlt,
  FaPlus,
  FaRedoAlt,
  FaSearch,
  FaShieldAlt,
  FaStore,
  FaTrash,
  FaUserCog,
  FaUserPlus,
  FaUsers,
  FaChevronDown,
  FaTimes,
  FaCheckDouble,
} from "react-icons/fa";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import MilikConfirmDialog from "../../components/Modals/MilikConfirmDialog";
import {
  deleteCompany,
  deleteUser,
  getCompanies,
  getUsers,
  resetUserPassword,
  switchCompany,
  toggleCompanyLock,
  toggleUserLock,
} from "../../redux/apiCalls";
import {
  getCompanyOperatingModeLabel,
  getEnabledCompanyModuleKeys,
} from "../../utils/companyModules";
import { selectCurrentUser } from "../../redux/selectors";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;
const SECTION_ALIASES = { rights: "users", database: "overview", sessions: "trials" };
const VALID_SECTIONS = ["overview", "companies", "users", "trials", "audit"];

const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const initialsFromName = (value = "") =>
  String(value || "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join("") || "M";

const formatDate = (value, opts = { year: "numeric", month: "short", day: "numeric" }) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("en-KE", opts);
};

const normalizeText = (value) => String(value ?? "").trim().toLowerCase();

const isCompanyActive = (company = {}) => {
  if (company?.locked) return false;
  const s = normalizeText(company?.accountStatus);
  if (["inactive", "disabled", "suspended", "archived"].includes(s)) return false;
  if (typeof company?.isActive === "boolean") return company.isActive;
  return s !== "inactive";
};

const getCompanyStatusLabel = (company = {}) => {
  if (company?.locked) return "Locked";
  if (company?.isDemoWorkspace) return "Demo";
  if (!isCompanyActive(company)) return "Inactive";
  return company?.accountStatus || "Active";
};

const getStatusTone = (status = "") => {
  const s = normalizeText(status);
  if (["active", "live"].includes(s)) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (["demo", "trial"].includes(s)) return "bg-violet-100 text-violet-700 border-violet-200";
  if (s === "locked") return "bg-rose-100 text-rose-700 border-rose-200";
  if (["inactive", "suspended", "disabled", "archived"].includes(s)) return "bg-slate-100 text-slate-500 border-slate-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
};

const getReadinessTone = (score) => {
  if (score >= 80) return "text-emerald-700";
  if (score >= 50) return "text-amber-600";
  return "text-rose-600";
};

const getReadinessBarColor = (score) => {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-400";
  return "bg-rose-500";
};

const getUserAssignedCompanyIds = (user = {}) => {
  const ids = new Set();
  (Array.isArray(user?.companyAssignments) ? user.companyAssignments : []).forEach((a) => {
    const id = normalizeId(a?.company || a);
    if (id) ids.add(id);
  });
  (Array.isArray(user?.accessibleCompanies) ? user.accessibleCompanies : []).forEach((c) => {
    const id = normalizeId(c);
    if (id) ids.add(id);
  });
  [user?.primaryCompany, user?.company].forEach((c) => {
    const id = normalizeId(c);
    if (id) ids.add(id);
  });
  return Array.from(ids);
};

const getPrimaryCompanyName = (user = {}, companyMap = new Map()) => {
  const primaryId = normalizeId(user?.primaryCompany || user?.company);
  if (primaryId && companyMap.has(primaryId)) return companyMap.get(primaryId)?.companyName || "-";
  if (typeof user?.company === "object" && user?.company?.companyName) return user.company.companyName;
  if (typeof user?.primaryCompany === "object" && user?.primaryCompany?.companyName) return user.primaryCompany.companyName;
  return "-";
};

const getUserRoleLabel = (user = {}) => {
  if (user?.superAdminAccess || user?.isSystemAdmin) return "Milik Admin";
  if (user?.adminAccess) return "Company Admin";
  if (user?.setupAccess || user?.companySetupAccess) return "Setup Access";
  if (user?.profile) return user.profile;
  return "User";
};

const getRoleColors = (user = {}) => {
  if (user?.superAdminAccess || user?.isSystemAdmin) return "bg-emerald-700 text-white";
  if (user?.adminAccess) return "bg-blue-600 text-white";
  if (user?.setupAccess || user?.companySetupAccess) return "bg-violet-600 text-white";
  return "bg-slate-500 text-white";
};

const getRoleBadgeColors = (user = {}) => {
  if (user?.superAdminAccess || user?.isSystemAdmin) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (user?.adminAccess) return "bg-blue-100 text-blue-700 border-blue-200";
  if (user?.setupAccess || user?.companySetupAccess) return "bg-violet-100 text-violet-700 border-violet-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
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
    { key: "profile", label: "Company profile", ok: Boolean(company?.companyName && (company?.email || company?.phoneNo) && company?.postalAddress) },
    { key: "mode", label: "Operating model", ok: Boolean(company?.companyMode) },
    { key: "modules", label: "Module assignment", ok: enabledModules.length > 0 },
    { key: "payments", label: "Payments", ok: hasPaymentSetup },
    { key: "communications", label: "Email/SMS", ok: emailProfiles.length > 0 || smsProfiles.length > 0 },
    { key: "users", label: "Users assigned", ok: userCount > 0 },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  const label = score >= 80 ? "Ready" : score >= 50 ? "In Progress" : "Needs Attention";
  return { score, label, missing, enabledModules, hasPaymentSetup, hasCommunicationSetup: emailProfiles.length > 0 || smsProfiles.length > 0 };
};

// ─── Shared sub-components ────────────────────────────────────────────────────
const CompanyAvatar = ({ company, size = "md" }) => {
  const logo = company?.logo;
  const name = company?.companyName || "Company";
  const dim = size === "lg" ? "h-9 w-9 rounded-xl text-xs" : "h-7 w-7 rounded-lg text-[10px]";
  if (logo) return <img src={logo} alt={name} className={`${dim} border border-slate-200 bg-white object-cover shrink-0`} />;
  return (
    <div className={`flex ${dim} items-center justify-center bg-gradient-to-br from-emerald-700 to-emerald-900 font-black text-white shrink-0`}>
      {initialsFromName(name)}
    </div>
  );
};

const UserAvatar = ({ user, size = "md" }) => {
  const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
  const colorClass = getRoleColors(user);
  const dim = size === "lg" ? "h-9 w-9 rounded-xl text-xs" : "h-7 w-7 rounded-lg text-[10px]";
  return (
    <div className={`flex ${dim} items-center justify-center ${colorClass} font-black shrink-0`}>
      {initialsFromName(name)}
    </div>
  );
};

const ReadinessBar = ({ score, showLabel = false }) => (
  <div className="flex items-center gap-2">
    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full transition-all ${getReadinessBarColor(score)}`} style={{ width: `${score}%` }} />
    </div>
    <span className={`text-[11px] font-black ${getReadinessTone(score)}`}>{score}%</span>
    {showLabel && score >= 80 && <FaCheckDouble className="text-[10px] text-emerald-600" />}
  </div>
);

const StatusBadge = ({ label }) => (
  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${getStatusTone(label)}`}>{label}</span>
);

const StatCard = ({ label, value, icon: Icon, accent = "emerald", sub }) => {
  const accents = {
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-700", border: "border-emerald-100", val: "text-slate-900" },
    green:   { bg: "bg-green-50",   icon: "text-green-700",   border: "border-green-100",   val: "text-slate-900" },
    violet:  { bg: "bg-violet-50",  icon: "text-violet-700",  border: "border-violet-100",  val: "text-slate-900" },
    orange:  { bg: "bg-orange-50",  icon: "text-orange-700",  border: "border-orange-100",  val: "text-slate-900" },
    rose:    { bg: "bg-rose-50",    icon: "text-rose-700",    border: "border-rose-100",    val: "text-rose-700"  },
  };
  const c = accents[accent] || accents.emerald;
  return (
    <div className={`flex items-center gap-3 rounded-xl border ${c.border} bg-white px-4 py-3 shadow-sm`}>
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${c.bg} shrink-0`}>
        <Icon className={`text-base ${c.icon}`} />
      </div>
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <div className={`text-2xl font-black leading-none ${c.val}`}>{value}</div>
        {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );
};

const Pagination = ({ page, totalPages, total, pageSize, onPage, onPageSize }) => {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-600">
      <span className="font-semibold">
        Showing <span className="font-bold text-slate-900">{start}</span> to <span className="font-bold text-slate-900">{end}</span> of <span className="font-bold text-slate-900">{total}</span>
      </span>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-slate-500">Per page:</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="h-7 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-700 focus:border-emerald-400 focus:outline-none transition"
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => onPage(page - 1)} disabled={page === 1} className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition">Previous</button>
            <span className="font-semibold text-slate-700">Page {page} of {totalPages}</span>
            <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition">Next</button>
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyState = ({ icon: Icon, title, body }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
    <Icon className="text-3xl text-slate-300" />
    <div className="text-sm font-black text-slate-500">{title}</div>
    {body && <div className="text-xs text-slate-400">{body}</div>}
  </div>
);

// ─── Inline action dropdown ───────────────────────────────────────────────────
const ActionMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition"
      >
        Actions <FaChevronDown className="text-[9px] opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {items.map((item, i) =>
              item.separator ? (
                <div key={i} className="my-1 border-t border-slate-100" />
              ) : (
                <button
                  key={i}
                  onClick={() => { setOpen(false); item.onClick(); }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs font-semibold transition hover:bg-slate-50 ${item.danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700"}`}
                >
                  {item.icon && <item.icon className="text-[11px] shrink-0 opacity-70" />}
                  {item.label}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ─── Overview Panel ────────────────────────────────────────────────────────────
const OverviewPanel = ({ companies, users, companyReadiness, companyUserCounts, onAddCompany, onAddUser, onOpenCompanySetup, onOpenWorkspace }) => {
  const activeCompanies = companies.filter((c) => isCompanyActive(c) && !c?.isDemoWorkspace);
  const demoCompanies = companies.filter((c) => c?.isDemoWorkspace);
  const attentionCompanies = companies.filter((c) => (companyReadiness.get(normalizeId(c))?.score || 0) < 80).slice(0, 6);
  const recentCompanies = [...companies].sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)).slice(0, 6);
  const recentUsers = [...users].sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)).slice(0, 6);

  return (
    <div className="p-4 space-y-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <StatCard label="Companies" value={companies.length} icon={FaBuilding} accent="emerald" />
        <StatCard label="Active" value={activeCompanies.length} icon={FaCheckCircle} accent="green" />
        <StatCard label="Demo" value={demoCompanies.length} icon={FaStore} accent="violet" />
        <StatCard label="Users" value={users.length} icon={FaUsers} accent="orange" />
        <StatCard label="Needs Attention" value={attentionCompanies.length} icon={FaExclamationTriangle} accent="rose" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Attention Queue */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-slate-100 bg-rose-50/60 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full bg-rose-500 shrink-0" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-600">Attention Queue</div>
              <div className="text-xs font-black text-slate-800 mt-0.5">Companies needing setup</div>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {attentionCompanies.length ? attentionCompanies.map((company) => {
              const readiness = companyReadiness.get(normalizeId(company));
              const userCount = companyUserCounts.get(normalizeId(company)) || 0;
              return (
                <div key={company._id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/80 transition">
                  <CompanyAvatar company={company} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs font-black text-slate-900">{company.companyName}</div>
                    <ReadinessBar score={readiness?.score || 0} />
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-400">{userCount} user{userCount !== 1 ? "s" : ""}</div>
                    <button onClick={() => onOpenCompanySetup(company)} className="text-[11px] font-bold text-emerald-700 hover:underline">Setup →</button>
                  </div>
                </div>
              );
            }) : (
              <div className="flex flex-col items-center gap-1 py-8 text-center">
                <FaCheckDouble className="text-xl text-emerald-400" />
                <div className="text-xs font-bold text-emerald-600">All companies are ready</div>
              </div>
            )}
          </div>
        </div>

        {/* Recent Onboarding */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-slate-100 bg-emerald-50/60 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Recent Onboarding</div>
              <div className="text-xs font-black text-slate-800 mt-0.5">Latest companies</div>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {recentCompanies.map((company) => (
              <div key={company._id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/80 transition">
                <CompanyAvatar company={company} />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs font-black text-slate-900">{company.companyName}</div>
                  <div className="text-[11px] text-slate-400">{formatDate(company.createdAt)}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <StatusBadge label={getCompanyStatusLabel(company)} />
                  <button onClick={() => onOpenWorkspace(company)} className="text-[11px] font-bold text-emerald-700 hover:underline">Open →</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Users */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-slate-100 bg-orange-50/60 px-4 py-2.5">
            <div className="h-2 w-2 rounded-full bg-orange-500 shrink-0" />
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Recent User Access</div>
              <div className="text-xs font-black text-slate-800 mt-0.5">Latest users</div>
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {recentUsers.map((user) => {
              const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
              return (
                <div key={user._id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/80 transition">
                  <UserAvatar user={user} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-xs font-black text-slate-900">{name}</div>
                    <div className="text-[11px] text-slate-400">{formatDate(user?.createdAt)}</div>
                  </div>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${getRoleBadgeColors(user)}`}>{getUserRoleLabel(user)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <div className="text-xs font-black text-slate-800">Quick Actions</div>
        </div>
        <div className="flex flex-wrap gap-3 p-4">
          <button onClick={onAddCompany} className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#0A3127] transition shadow-sm">
            <FaPlus /> Register Company
          </button>
          <button onClick={onAddUser} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-orange-600 transition shadow-sm">
            <FaUserPlus /> Add User
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Companies Panel ───────────────────────────────────────────────────────────
const CompaniesPanel = ({ companies, companyReadiness, companyUserCounts, onAddCompany, onEditCompany, onDeleteCompany, onToggleCompanyLock, onOpenCompanySetup, onOpenOperationalSettings, onOpenWorkspace, onManageUsers }) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const filtered = useMemo(() => {
    return companies.filter((company) => {
      const readiness = companyReadiness.get(normalizeId(company));
      const status = getCompanyStatusLabel(company);
      const modeLabel = getCompanyOperatingModeLabel(company?.companyMode);
      const haystack = [company?.companyName, company?.companyCode, company?.registrationNo, company?.email, company?.town, company?.country].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || (statusFilter === "attention" && (readiness?.score || 0) < 80) || normalizeText(status) === normalizeText(statusFilter);
      const matchesMode = modeFilter === "all" || normalizeText(modeLabel) === normalizeText(modeFilter);
      return matchesSearch && matchesStatus && matchesMode;
    });
  }, [companies, companyReadiness, modeFilter, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => { setPage(1); }, [search, statusFilter, modeFilter, pageSize]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Filters bar */}
      <div className="flex-shrink-0 border-b border-slate-100 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, code, email, town..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-800 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 transition" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 focus:border-emerald-400 focus:outline-none transition">
            <option value="all">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Locked">Locked</option>
            <option value="Demo">Demo</option>
            <option value="attention">Needs attention</option>
          </select>
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 focus:border-emerald-400 focus:outline-none transition">
            <option value="all">All operating models</option>
            <option value="property manager">Property Manager</option>
            <option value="self-managing landlord">Self-Managing Landlord</option>
            <option value="other">Other</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            <button onClick={onAddCompany} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127] transition">
              <FaPlus className="text-[9px]" /> Register Company
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900 text-white">
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Company</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Mode</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Status</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Readiness</th>
              <th className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-[0.18em]">Users</th>
              <th className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-[0.18em]">Modules</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Contact</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Updated</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-[0.18em]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.length === 0 ? (
              <tr><td colSpan={9}><EmptyState icon={FaBuilding} title="No companies match" body="Try adjusting your search or filter criteria" /></td></tr>
            ) : pageRows.map((company) => {
              const companyId = normalizeId(company);
              const readiness = companyReadiness.get(companyId) || evaluateCompanySetup(company, 0);
              const userCount = companyUserCounts.get(companyId) || 0;
              const statusLabel = getCompanyStatusLabel(company);
              return (
                <tr key={companyId} className="group bg-white hover:bg-slate-50/80 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <CompanyAvatar company={company} />
                      <div>
                        <div className="font-black text-slate-900 leading-tight">{company.companyName}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{company.companyCode || company.registrationNo || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-600">{getCompanyOperatingModeLabel(company?.companyMode)}</td>
                  <td className="px-4 py-3"><StatusBadge label={statusLabel} /></td>
                  <td className="px-4 py-3">
                    <ReadinessBar score={readiness.score} />
                    {readiness.missing.length > 0 && (
                      <div className="mt-1 text-[10px] text-rose-500 leading-tight">Missing: {readiness.missing.slice(0, 2).join(", ")}{readiness.missing.length > 2 ? ` +${readiness.missing.length - 2}` : ""}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-700">{userCount}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-700">{readiness.enabledModules.length}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                      <FaEnvelope className="shrink-0 text-emerald-600 text-[10px]" />
                      <span className="truncate max-w-[130px]">{company.email || "—"}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-500">
                      <FaMapMarkerAlt className="shrink-0 text-emerald-600 text-[10px]" />
                      <span>{[company.town, company.country].filter(Boolean).join(", ") || "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{formatDate(company.updatedAt || company.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <ActionMenu items={[
                      { label: "Setup", icon: FaCog, onClick: () => onOpenCompanySetup(company) },
                      { label: "Operational Settings", icon: FaGlobeAfrica, onClick: () => onOpenOperationalSettings(company) },
                      { label: "Open Workspace", icon: FaEye, onClick: () => onOpenWorkspace(company) },
                      { label: "Manage Users", icon: FaUsers, onClick: () => onManageUsers(company) },
                      { separator: true },
                      { label: "Edit", icon: FaEdit, onClick: () => onEditCompany(company) },
                      { label: company?.locked ? "Unlock" : "Lock", icon: company?.locked ? FaLockOpen : FaLock, onClick: () => onToggleCompanyLock(company) },
                      { label: "Delete", icon: FaTrash, onClick: () => onDeleteCompany(company), danger: true },
                    ]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
};

// ─── Users Panel ───────────────────────────────────────────────────────────────
const UsersPanel = ({ users, companies, companyMap, selectedCompanyId, onSelectedCompanyIdChange, onAddUser, onEditUser, onToggleUserLock, onDeleteUser, onResetPassword }) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const filtered = useMemo(() => {
    return users.filter((user) => {
      const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim();
      const haystack = [name, user?.email, user?.phoneNumber, getUserRoleLabel(user)].filter(Boolean).join(" ").toLowerCase();
      const assignedCompanyIds = getUserAssignedCompanyIds(user);
      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      const matchesCompany = !selectedCompanyId || assignedCompanyIds.includes(selectedCompanyId);
      const lockState = user?.locked ? "locked" : user?.isActive === false ? "inactive" : "active";
      const matchesStatus = statusFilter === "all" || lockState === statusFilter;
      return matchesSearch && matchesCompany && matchesStatus;
    });
  }, [search, selectedCompanyId, statusFilter, users]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => { setPage(1); }, [search, statusFilter, selectedCompanyId, pageSize]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-shrink-0 border-b border-slate-100 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, email, phone, role..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-800 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 transition" />
          </div>
          <select value={selectedCompanyId} onChange={(e) => onSelectedCompanyIdChange(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 focus:border-emerald-400 focus:outline-none transition">
            <option value="">All companies</option>
            {companies.map((c) => <option key={c._id} value={c._id}>{c.companyName}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 focus:border-emerald-400 focus:outline-none transition">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="locked">Locked</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            <button onClick={onAddUser} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-[11px] font-bold text-white hover:bg-orange-600 transition">
              <FaUserPlus className="text-[9px]" /> Add User
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900 text-white">
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">User</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Email</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Role</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Primary Company</th>
              <th className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-[0.18em]">Companies</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Status</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Created</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-[0.18em]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon={FaUsers} title="No users match" body="Try adjusting your search or filter criteria" /></td></tr>
            ) : pageRows.map((user) => {
              const userId = normalizeId(user);
              const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
              const assignedCompanyIds = getUserAssignedCompanyIds(user);
              const lockState = user?.locked ? "Locked" : user?.isActive === false ? "Inactive" : "Active";
              return (
                <tr key={userId} className="group bg-white hover:bg-slate-50/80 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <UserAvatar user={user} />
                      <span className="font-black text-slate-900">{name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500">{user?.email || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${getRoleBadgeColors(user)}`}>{getUserRoleLabel(user)}</span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-600">{getPrimaryCompanyName(user, companyMap)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-700">{assignedCompanyIds.length}</span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge label={lockState} /></td>
                  <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{formatDate(user?.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <ActionMenu items={[
                      { label: "Edit", icon: FaEdit, onClick: () => onEditUser(user) },
                      { label: user?.locked ? "Unlock" : "Lock", icon: user?.locked ? FaLockOpen : FaLock, onClick: () => onToggleUserLock(user) },
                      { label: "Reset Password", icon: FaKey, onClick: () => onResetPassword(user) },
                      { separator: true },
                      { label: "Delete", icon: FaTrash, onClick: () => onDeleteUser(user), danger: true },
                    ]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
};

// ─── Trials Panel ──────────────────────────────────────────────────────────────
const TrialsPanel = ({ companies, companyReadiness, companyUserCounts, onOpenWorkspace, onOpenCompanySetup }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const spotlightCompanies = useMemo(() => {
    const demoCompanies = companies.filter((c) => c?.isDemoWorkspace);
    const inactiveCompanies = companies.filter((c) => !c?.isDemoWorkspace && !isCompanyActive(c));
    const attentionCompanies = companies.filter((c) => (companyReadiness.get(normalizeId(c))?.score || 0) < 80);
    return [...new Map([...demoCompanies, ...inactiveCompanies, ...attentionCompanies].map((c) => [normalizeId(c), c])).values()];
  }, [companies, companyReadiness]);

  const totalPages = Math.max(1, Math.ceil(spotlightCompanies.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = spotlightCompanies.slice((safePage - 1) * pageSize, safePage * pageSize);

  const demoCount = companies.filter((c) => c?.isDemoWorkspace).length;
  const inactiveCount = companies.filter((c) => !c?.isDemoWorkspace && !isCompanyActive(c)).length;
  const attentionCount = companies.filter((c) => (companyReadiness.get(normalizeId(c))?.score || 0) < 80).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-shrink-0 border-b border-slate-100 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-bold text-violet-700">
            <FaStore className="text-[10px]" /> {demoCount} Demo workspace{demoCount !== 1 ? "s" : ""}
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">
            <FaLock className="text-[10px]" /> {inactiveCount} Inactive
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700">
            <FaExclamationTriangle className="text-[10px]" /> {attentionCount} Needs activation work
          </div>
          <div className="ml-auto text-[11px] font-semibold text-slate-400">{spotlightCompanies.length} total</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900 text-white">
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Company</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Type</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Mode</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Readiness</th>
              <th className="px-4 py-2.5 text-center text-[10px] font-black uppercase tracking-[0.18em]">Users</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Missing Setup</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Updated</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-[0.18em]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon={FaCheckDouble} title="No spotlight companies" body="All companies are active and fully set up" /></td></tr>
            ) : pageRows.map((company) => {
              const companyId = normalizeId(company);
              const readiness = companyReadiness.get(companyId) || evaluateCompanySetup(company, 0);
              const userCount = companyUserCounts.get(companyId) || 0;
              const spotlightLabel = company?.isDemoWorkspace ? "Demo" : !isCompanyActive(company) ? "Inactive" : "Needs Attention";
              return (
                <tr key={companyId} className="group bg-white hover:bg-slate-50/80 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <CompanyAvatar company={company} />
                      <div className="font-black text-slate-900 leading-tight">{company.companyName}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge label={spotlightLabel} /></td>
                  <td className="px-4 py-3 text-[11px] text-slate-600">{getCompanyOperatingModeLabel(company.companyMode)}</td>
                  <td className="px-4 py-3"><ReadinessBar score={readiness.score} showLabel /></td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-700">{userCount}</span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500">
                    {readiness.missing.length ? readiness.missing.slice(0, 3).join(", ") + (readiness.missing.length > 3 ? ` +${readiness.missing.length - 3}` : "") : <span className="text-emerald-600 font-semibold">No gaps</span>}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{formatDate(company.updatedAt || company.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => onOpenWorkspace(company)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition">
                        <FaEye className="text-[10px]" /> Workspace
                      </button>
                      <button onClick={() => onOpenCompanySetup(company)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition">
                        <FaCog className="text-[10px]" /> Setup
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={spotlightCompanies.length} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
};

// ─── Audit Panel ───────────────────────────────────────────────────────────────
const AuditPanel = ({ companies, users, companyMap }) => {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const allEvents = useMemo(() => {
    const rows = [];
    companies.forEach((company) => {
      if (company?.createdAt) rows.push({ id: `company-created-${company._id}`, timestamp: company.createdAt, title: `${company.companyName} created`, detail: `${getCompanyOperatingModeLabel(company.companyMode)} · ${getCompanyStatusLabel(company)}`, type: "Company" });
      if (company?.updatedAt && company?.updatedAt !== company?.createdAt) rows.push({ id: `company-updated-${company._id}`, timestamp: company.updatedAt, title: `${company.companyName} updated`, detail: `${company.email || "No email"} · ${[company.town, company.country].filter(Boolean).join(", ") || "No location"}`, type: "Company" });
    });
    users.forEach((user) => {
      const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
      const primaryCompany = getPrimaryCompanyName(user, companyMap);
      if (user?.createdAt) rows.push({ id: `user-created-${user._id}`, timestamp: user.createdAt, title: `${name} added`, detail: `${getUserRoleLabel(user)} · ${primaryCompany}`, type: "User" });
      if (user?.updatedAt && user?.updatedAt !== user?.createdAt) rows.push({ id: `user-updated-${user._id}`, timestamp: user.updatedAt, title: `${name} updated`, detail: `${user?.locked ? "Locked" : user?.isActive === false ? "Inactive" : "Active"} · ${primaryCompany}`, type: "User" });
    });
    return rows.filter((e) => e.timestamp).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [companies, users, companyMap]);

  const filtered = useMemo(() => {
    return allEvents.filter((e) => {
      const matchesType = typeFilter === "all" || e.type === typeFilter;
      const matchesSearch = !search || `${e.title} ${e.detail}`.toLowerCase().includes(search.toLowerCase());
      return matchesType && matchesSearch;
    });
  }, [allEvents, typeFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => { setPage(1); }, [search, typeFilter, pageSize]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-shrink-0 border-b border-slate-100 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-800 focus:border-emerald-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-200 transition" />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 focus:border-emerald-400 focus:outline-none transition">
            <option value="all">All types</option>
            <option value="Company">Company</option>
            <option value="User">User</option>
          </select>
          <span className="ml-auto text-[11px] font-semibold text-slate-400">{filtered.length} event{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-900 text-white">
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Date</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Event</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Type</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-[0.18em]">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.length === 0 ? (
              <tr><td colSpan={4}><EmptyState icon={FaHistory} title="No platform activity found" body="Events will appear here as the system is used" /></td></tr>
            ) : pageRows.map((event) => (
              <tr key={event.id} className="group bg-white hover:bg-slate-50/80 transition">
                <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">{formatDate(event.timestamp)}</td>
                <td className="px-4 py-3 font-black text-slate-900">{event.title}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${event.type === "Company" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-orange-100 text-orange-700 border-orange-200"}`}>
                    {event.type === "Company" ? <FaBuilding className="mr-1 text-[9px]" /> : <FaUsers className="mr-1 text-[9px]" />}
                    {event.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-[11px] text-slate-500">{event.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </div>
  );
};

// ─── Page root ─────────────────────────────────────────────────────────────────
export default function SystemSetupPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const { companies, isFetching: companiesFetching, currentCompany } = useSelector((state) => state.company || {});
  const { users, isFetching: usersFetching } = useSelector((state) => state.user || {});
  const currentUser = useSelector(selectCurrentUser);

  const rawSection = location.pathname.split("/")[2] || "overview";
  const activeSection = SECTION_ALIASES[rawSection] || rawSection;
  const companyFilterFromQuery = new URLSearchParams(location.search).get("company") || "";
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyFilterFromQuery);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: "", message: "", isDangerous: false, confirmText: "Confirm", onConfirm: null });

  const companyList = Array.isArray(companies) ? companies : [];
  const userList = Array.isArray(users) ? users : [];
  const companyMap = useMemo(() => new Map(companyList.map((c) => [normalizeId(c), c])), [companyList]);

  const companyUserCounts = useMemo(() => {
    const counts = new Map();
    userList.forEach((user) => {
      getUserAssignedCompanyIds(user).forEach((cid) => counts.set(cid, (counts.get(cid) || 0) + 1));
    });
    return counts;
  }, [userList]);

  const companyReadiness = useMemo(() => {
    const readiness = new Map();
    companyList.forEach((c) => readiness.set(normalizeId(c), evaluateCompanySetup(c, companyUserCounts.get(normalizeId(c)) || 0)));
    return readiness;
  }, [companyList, companyUserCounts]);

  useEffect(() => {
    if (!VALID_SECTIONS.includes(activeSection)) navigate("/system-setup/overview", { replace: true });
  }, [activeSection, navigate]);

  // Pass high limits so system admin always sees all records, not the default 10
  useEffect(() => { dispatch(getCompanies({ includeDemo: true, limit: 200 })); }, [dispatch]);
  useEffect(() => { dispatch(getUsers(selectedCompanyId || undefined, { limit: 500 })); }, [dispatch, selectedCompanyId]);
  useEffect(() => { setSelectedCompanyId(companyFilterFromQuery); }, [companyFilterFromQuery]);

  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);

  const goToSection = (section, nextQuery = "") => navigate(`/system-setup/${section}${nextQuery}`);

  const handleCompanyFilterChange = (companyId) => {
    setSelectedCompanyId(companyId);
    navigate(`/system-setup/users${companyId ? `?company=${companyId}` : ""}`, { replace: true });
  };

  const handleSwitchAndNavigate = async (company, route, successMessage) => {
    const companyId = normalizeId(company);
    if (!companyId) { toast.error("The selected company is missing a valid identifier."); return; }
    try {
      await dispatch(switchCompany(companyId));
      navigate(route, { state: { tabTitle: company?.companyName || "Company" } });
      if (successMessage) toast.success(successMessage);
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to switch company context.");
    }
  };

  const handleOpenCompanySetup = (company) => handleSwitchAndNavigate(company, "/company-setup", `Opened ${company?.companyName || "company"} in Company Setup`);
  const handleOpenOperationalSettings = (company) => handleSwitchAndNavigate(company, "/settings", `Opened ${company?.companyName || "company"} in Operational Settings`);
  const handleOpenWorkspace = (company) => handleSwitchAndNavigate(company, "/dashboard", `Opened ${company?.companyName || "company"} workspace`);
  const handleManageUsers = (company) => { const id = normalizeId(company); if (!id) return; handleCompanyFilterChange(id); goToSection("users", `?company=${id}`); };
  const handleEditCompany = (company) => { const id = normalizeId(company); if (!id) { toast.error("Unable to open this company record."); return; } navigate(`/add-company/${id}`, { state: { tabTitle: company?.companyName || "Company" } }); };

  const handleToggleCompanyLock = (company) => {
    const id = normalizeId(company);
    if (!id) return;
    const isLocked = Boolean(company?.locked);
    setConfirmDialog({
      isOpen: true,
      title: isLocked ? "Unlock company" : "Lock company",
      message: isLocked
        ? `Unlock ${company?.companyName || "this company"}? Users will be able to log in again.`
        : `Lock ${company?.companyName || "this company"}? All users of this company will be blocked from logging in.`,
      isDangerous: !isLocked,
      confirmText: isLocked ? "Unlock" : "Lock",
      onConfirm: async () => {
        try {
          await dispatch(toggleCompanyLock(id));
          toast.success(isLocked ? "Company unlocked successfully." : "Company locked successfully.");
        } catch (error) {
          toast.error(error?.response?.data?.message || error?.message || "Failed to update company lock status.");
        } finally {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        }
      },
    });
  };

  const handleDeleteCompany = (company) => {
    const id = normalizeId(company);
    if (!id) return;
    setConfirmDialog({
      isOpen: true, title: "Delete company",
      message: `Delete ${company?.companyName || "this company"}? This action cannot be undone.`,
      isDangerous: true, confirmText: "Delete",
      onConfirm: async () => {
        try { await dispatch(deleteCompany(id)); toast.success("Company deleted successfully."); }
        catch (error) { toast.error(error?.response?.data?.message || error?.message || "Failed to delete company."); }
        finally { setConfirmDialog((prev) => ({ ...prev, isOpen: false })); }
      },
    });
  };

  const handleEditUser = (user) => { const id = normalizeId(user); if (!id) return; navigate(`/add-user/${id}`, { state: { tabTitle: "User Access" } }); };

  const handleToggleUserLock = (user) => {
    const id = normalizeId(user);
    if (!id) return;
    dispatch(toggleUserLock(id))
      .then(() => toast.success(user?.locked ? "User unlocked successfully." : "User locked successfully."))
      .catch((error) => toast.error(error?.response?.data?.message || error?.message || "Failed to update user lock status."));
  };

  const handleDeleteUser = (user) => {
    const id = normalizeId(user);
    const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "this user";
    if (!id) return;
    setConfirmDialog({
      isOpen: true, title: "Delete user",
      message: `Delete ${name}? This action cannot be undone.`,
      isDangerous: true, confirmText: "Delete",
      onConfirm: async () => {
        try { await dispatch(deleteUser(id)); toast.success("User deleted successfully."); }
        catch (error) { toast.error(error?.response?.data?.message || error?.message || "Failed to delete user."); }
        finally { setConfirmDialog((prev) => ({ ...prev, isOpen: false })); }
      },
    });
  };

  const handleResetPassword = (user) => {
    const id = normalizeId(user);
    if (!id) return;
    setConfirmDialog({
      isOpen: true, title: "Reset password",
      message: `Send a new temporary password to ${user?.email}?`,
      isDangerous: false, confirmText: "Reset & Send",
      onConfirm: async () => {
        try { await dispatch(resetUserPassword(id)); toast.success("New password sent to " + user.email); }
        catch (error) { toast.error(error?.response?.data?.message || error?.message || "Failed to reset password."); }
        finally { setConfirmDialog((prev) => ({ ...prev, isOpen: false })); }
      },
    });
  };

  const handleRefresh = () => {
    dispatch(getCompanies({ includeDemo: true, limit: 200 }));
    dispatch(getUsers(selectedCompanyId || undefined, { limit: 500 }));
  };

  const sections = [
    { key: "overview",   label: "Overview",   icon: FaChartBar },
    { key: "companies",  label: "Companies",  icon: FaBuilding },
    { key: "users",      label: "Users",      icon: FaUsers },
    { key: "trials",     label: "Trials",     icon: FaBoxOpen },
    { key: "audit",      label: "Audit Log",  icon: FaHistory },
  ];

  const isLoading = companiesFetching && !companyList.length;

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100/60 p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

          {/* ── Sticky header ─────────────────────────────────────────────── */}
          <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">System Administration</div>
                <h1 className="text-sm font-black text-slate-900 leading-none mt-0.5">Control Centre</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                  <FaBuilding className="text-emerald-600 text-[10px]" />
                  {companyList.length} companies
                </div>
                <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-black text-slate-700">
                  <FaUsers className="text-orange-500 text-[10px]" />
                  {userList.length} users
                </div>
                <button
                  onClick={handleRefresh}
                  disabled={companiesFetching || usersFetching}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                >
                  <FaRedoAlt className={`text-[9px] ${(companiesFetching || usersFetching) ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-1.5">
              {sections.map((section) => (
                <button
                  key={section.key}
                  onClick={() => goToSection(section.key, section.key === "users" && selectedCompanyId ? `?company=${selectedCompanyId}` : "")}
                  className={`relative inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                    activeSection === section.key
                      ? "bg-emerald-900 text-white shadow-sm"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  <section.icon className="text-[11px]" />
                  {section.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Non-admin warning ─────────────────────────────────────────── */}
          {!isSystemAdmin && (
            <div className="p-6">
              <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                <FaShieldAlt className="shrink-0 text-xl text-amber-500" />
                <div>
                  <div className="font-black">Access Restricted</div>
                  <div className="mt-0.5 text-xs">System Administration is restricted to Milik Admin users only.</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Loading state ─────────────────────────────────────────────── */}
          {isSystemAdmin && isLoading && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
              <FaRedoAlt className="animate-spin text-2xl text-emerald-600" />
              <div className="text-sm font-semibold">Loading system data...</div>
            </div>
          )}

          {/* ── Panel content ─────────────────────────────────────────────── */}
          {isSystemAdmin && !isLoading && (
            <>
              {activeSection === "overview" && (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <OverviewPanel
                    companies={companyList}
                    users={userList}
                    companyReadiness={companyReadiness}
                    companyUserCounts={companyUserCounts}
                    onAddCompany={() => navigate("/add-company", { state: { tabTitle: "New Company" } })}
                    onAddUser={() => navigate("/add-user", { state: { tabTitle: "New User" } })}
                    onOpenCompanySetup={handleOpenCompanySetup}
                    onOpenWorkspace={handleOpenWorkspace}
                  />
                </div>
              )}

              {activeSection === "companies" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <CompaniesPanel
                    companies={companyList}
                    companyReadiness={companyReadiness}
                    companyUserCounts={companyUserCounts}
                    onAddCompany={() => navigate("/add-company", { state: { tabTitle: "New Company" } })}
                    onEditCompany={handleEditCompany}
                    onDeleteCompany={handleDeleteCompany}
                    onToggleCompanyLock={handleToggleCompanyLock}
                    onOpenCompanySetup={handleOpenCompanySetup}
                    onOpenOperationalSettings={handleOpenOperationalSettings}
                    onOpenWorkspace={handleOpenWorkspace}
                    onManageUsers={handleManageUsers}
                  />
                </div>
              )}

              {activeSection === "users" && (
                <div className="flex min-h-0 flex-1 flex-col">
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
                    onResetPassword={handleResetPassword}
                  />
                </div>
              )}

              {activeSection === "trials" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <TrialsPanel
                    companies={companyList}
                    companyReadiness={companyReadiness}
                    companyUserCounts={companyUserCounts}
                    onOpenWorkspace={handleOpenWorkspace}
                    onOpenCompanySetup={handleOpenCompanySetup}
                  />
                </div>
              )}

              {activeSection === "audit" && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <AuditPanel companies={companyList} users={userList} companyMap={companyMap} />
                </div>
              )}
            </>
          )}

        </div>
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
