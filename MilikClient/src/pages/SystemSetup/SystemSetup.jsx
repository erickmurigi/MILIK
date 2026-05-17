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
  toggleUserLock,
} from "../../redux/apiCalls";
import {
  getCompanyOperatingModeLabel,
  getEnabledCompanyModuleKeys,
} from "../../utils/companyModules";

const ITEMS_PER_PAGE = 25;
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
  const s = normalizeText(company?.accountStatus);
  if (["inactive", "disabled", "suspended", "archived"].includes(s)) return false;
  if (typeof company?.isActive === "boolean") return company.isActive;
  return s !== "inactive";
};

const getCompanyStatusLabel = (company = {}) => {
  if (company?.isDemoWorkspace) return "Demo";
  if (!isCompanyActive(company)) return "Inactive";
  return company?.accountStatus || "Active";
};

const getStatusTone = (status = "") => {
  const s = normalizeText(status);
  if (["active", "live"].includes(s)) return "bg-emerald-100 text-emerald-700";
  if (["demo", "trial"].includes(s)) return "bg-violet-100 text-violet-700";
  if (["inactive", "suspended", "disabled", "archived"].includes(s)) return "bg-slate-100 text-slate-600";
  return "bg-amber-100 text-amber-700";
};

const getReadinessTone = (score) => {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 50) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
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

const CompanyAvatar = ({ company }) => {
  const logo = company?.logo;
  const name = company?.companyName || "Company";
  if (logo) return <img src={logo} alt={name} className="h-7 w-7 rounded-lg border border-slate-200 bg-white object-cover" />;
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-[10px] font-black text-emerald-700 shrink-0">
      {initialsFromName(name)}
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm flex items-center gap-3">
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 shrink-0"><Icon className="text-sm" /></div>
    <div>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="text-xl font-black text-slate-900 leading-none mt-0.5">{value}</div>
    </div>
  </div>
);

const Pagination = ({ page, totalPages, total, pageSize, onPage }) => {
  if (totalPages <= 1) return null;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <span className="font-semibold">
        Showing <span className="font-black text-slate-900">{start}</span>–<span className="font-black text-slate-900">{end}</span> of <span className="font-black text-slate-900">{total}</span>
      </span>
      <div className="flex items-center gap-2">
        <button onClick={() => onPage(page - 1)} disabled={page === 1} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
        <span className="font-semibold text-slate-700">Page {page} of {totalPages}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
      </div>
    </div>
  );
};

// ─── Overview Panel ────────────────────────────────────────────────────────────
const OverviewPanel = ({ companies, users, companyReadiness, companyUserCounts, onAddCompany, onAddUser, onOpenCompanySetup, onOpenWorkspace }) => {
  const activeCompanies = companies.filter((c) => isCompanyActive(c) && !c?.isDemoWorkspace);
  const demoCompanies = companies.filter((c) => c?.isDemoWorkspace);
  const attentionCompanies = companies.filter((c) => (companyReadiness.get(normalizeId(c))?.score || 0) < 80).slice(0, 5);
  const recentCompanies = [...companies].sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)).slice(0, 6);
  const recentUsers = [...users].sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)).slice(0, 6);

  return (
    <div className="p-3 space-y-3">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <StatCard label="Companies" value={companies.length} icon={FaBuilding} />
        <StatCard label="Active" value={activeCompanies.length} icon={FaCheckCircle} />
        <StatCard label="Demo" value={demoCompanies.length} icon={FaStore} />
        <StatCard label="Users" value={users.length} icon={FaUsers} />
        <StatCard label="Needs Attention" value={attentionCompanies.length} icon={FaExclamationTriangle} />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-600">Attention Queue</div>
            <div className="text-sm font-black text-slate-900 mt-0.5">Companies needing setup</div>
          </div>
          <div className="divide-y divide-slate-100">
            {attentionCompanies.length ? attentionCompanies.map((company) => {
              const readiness = companyReadiness.get(normalizeId(company));
              const userCount = companyUserCounts.get(normalizeId(company)) || 0;
              return (
                <div key={company._id} className="flex items-center gap-3 px-3 py-2">
                  <CompanyAvatar company={company} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-black text-slate-900 truncate">{company.companyName}</div>
                    <div className="text-[11px] text-slate-500">{userCount} users · {readiness?.score || 0}% ready</div>
                  </div>
                  <button onClick={() => onOpenCompanySetup(company)} className="shrink-0 text-[11px] font-bold text-emerald-700 hover:underline">Setup</button>
                </div>
              );
            }) : (
              <div className="px-3 py-4 text-xs text-emerald-700 text-center">All companies are ready</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Recent Onboarding</div>
            <div className="text-sm font-black text-slate-900 mt-0.5">Latest companies</div>
          </div>
          <div className="divide-y divide-slate-100">
            {recentCompanies.map((company) => (
              <div key={company._id} className="flex items-center gap-3 px-3 py-2">
                <CompanyAvatar company={company} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-black text-slate-900 truncate">{company.companyName}</div>
                  <div className="text-[11px] text-slate-500">{formatDate(company.createdAt)}</div>
                </div>
                <button onClick={() => onOpenWorkspace(company)} className="shrink-0 text-[11px] font-bold text-emerald-700 hover:underline">Open</button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-600">Recent User Access</div>
            <div className="text-sm font-black text-slate-900 mt-0.5">Latest users</div>
          </div>
          <div className="divide-y divide-slate-100">
            {recentUsers.map((user) => {
              const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
              return (
                <div key={user._id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-[10px] font-black text-orange-700 shrink-0">{initialsFromName(name)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-black text-slate-900 truncate">{name}</div>
                    <div className="text-[11px] text-slate-500">{getUserRoleLabel(user)} · {formatDate(user?.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2">
          <div className="text-sm font-black text-slate-900">Quick actions</div>
        </div>
        <div className="flex flex-wrap gap-3 p-3">
          <button onClick={onAddCompany} className="inline-flex items-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white hover:bg-[#0A3127]"><FaPlus /> Register Company</button>
          <button onClick={onAddUser} className="inline-flex items-center gap-2 rounded-lg bg-[#FF8C00] px-4 py-2 text-xs font-bold text-white hover:bg-[#e67e00]"><FaUserPlus /> Add User</button>
        </div>
      </div>
    </div>
  );
};

// ─── Companies Panel ───────────────────────────────────────────────────────────
const CompaniesPanel = ({ companies, companyReadiness, companyUserCounts, onAddCompany, onEditCompany, onDeleteCompany, onOpenCompanySetup, onOpenOperationalSettings, onOpenWorkspace, onManageUsers }) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, statusFilter, modeFilter]);

  return (
    <>
      <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company, code, email, town..." className="h-8 w-full rounded border border-gray-300 bg-[#DDEFE1] pl-9 pr-3 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded border border-orange-300 bg-orange-50 px-3 text-xs font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#FF8C00]">
            <option value="all">All statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Demo">Demo</option>
            <option value="attention">Needs attention</option>
          </select>
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className="h-8 rounded border border-orange-300 bg-orange-50 px-3 text-xs font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#FF8C00]">
            <option value="all">All operating models</option>
            <option value="property manager">Property Manager</option>
            <option value="self-managing landlord">Self-Managing Landlord</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            <button onClick={onAddCompany} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#0B3B2E] px-3 text-[11px] font-bold text-white hover:bg-[#0A3127]"><FaPlus /> Register Company</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0B3B2E] text-white">
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Company</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Mode</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Status</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Readiness</th>
              <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Users</th>
              <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Modules</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Contact</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Updated</th>
              <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No companies match the current filters.</td></tr>
            ) : pageRows.map((company, idx) => {
              const companyId = normalizeId(company);
              const readiness = companyReadiness.get(companyId) || evaluateCompanySetup(company, 0);
              const userCount = companyUserCounts.get(companyId) || 0;
              const statusLabel = getCompanyStatusLabel(company);
              return (
                <tr key={companyId} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CompanyAvatar company={company} />
                      <div>
                        <div className="font-black text-slate-900">{company.companyName}</div>
                        <div className="text-[11px] text-slate-500">{company.companyCode || company.registrationNo || "-"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{getCompanyOperatingModeLabel(company?.companyMode)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${getStatusTone(statusLabel)}`}>{statusLabel}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${readiness.score >= 80 ? "bg-emerald-600" : readiness.score >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${readiness.score}%` }} />
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${getReadinessTone(readiness.score)}`}>{readiness.score}%</span>
                    </div>
                    {readiness.missing.length > 0 && (
                      <div className="mt-1 text-[10px] text-rose-600 leading-tight">Missing: {readiness.missing.slice(0, 2).join(", ")}{readiness.missing.length > 2 ? ` +${readiness.missing.length - 2}` : ""}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-slate-900">{userCount}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-900">{readiness.enabledModules.length}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 text-slate-500"><FaEnvelope className="shrink-0 text-emerald-700" /><span className="truncate max-w-[140px]">{company.email || "—"}</span></div>
                    <div className="flex items-center gap-1 text-slate-500 mt-0.5"><FaMapMarkerAlt className="shrink-0 text-emerald-700" /><span>{[company.town, company.country].filter(Boolean).join(", ") || "—"}</span></div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDate(company.updatedAt || company.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button onClick={() => onOpenCompanySetup(company)} className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-100"><FaCog size={9} /> Setup</button>
                      <button onClick={() => onOpenOperationalSettings(company)} className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700 hover:bg-blue-100"><FaGlobeAfrica size={9} /> Settings</button>
                      <button onClick={() => onOpenWorkspace(company)} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-100"><FaEye size={9} /> Workspace</button>
                      <button onClick={() => onManageUsers(company)} className="inline-flex items-center gap-1 rounded border border-orange-300 bg-orange-50 px-2 py-1 text-[10px] font-black text-orange-700 hover:bg-orange-100"><FaUsers size={9} /> Users</button>
                      <button onClick={() => onEditCompany(company)} className="inline-flex items-center gap-1 rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100"><FaEdit size={9} /> Edit</button>
                      <button onClick={() => onDeleteCompany(company)} className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700 hover:bg-rose-100"><FaTrash size={9} /> Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={ITEMS_PER_PAGE} onPage={setPage} />
    </>
  );
};

// ─── Users Panel ───────────────────────────────────────────────────────────────
const UsersPanel = ({ users, companies, companyMap, selectedCompanyId, onSelectedCompanyIdChange, onAddUser, onEditUser, onToggleUserLock, onDeleteUser, onResetPassword }) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, statusFilter, selectedCompanyId]);

  return (
    <>
      <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, email, phone, role..." className="h-8 w-full rounded border border-gray-300 bg-[#DDEFE1] pl-9 pr-3 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
          </div>
          <select value={selectedCompanyId} onChange={(e) => onSelectedCompanyIdChange(e.target.value)} className="h-8 rounded border border-orange-300 bg-orange-50 px-3 text-xs font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#FF8C00]">
            <option value="">All companies</option>
            {companies.map((c) => <option key={c._id} value={c._id}>{c.companyName}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded border border-orange-300 bg-orange-50 px-3 text-xs font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#FF8C00]">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="locked">Locked</option>
            <option value="inactive">Inactive</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
            <button onClick={onAddUser} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#FF8C00] px-3 text-[11px] font-bold text-white hover:bg-[#e67e00]"><FaUserPlus /> Add User</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0B3B2E] text-white">
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">User</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Email</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Role</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Primary Company</th>
              <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Companies</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Status</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Created</th>
              <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No users match the current filters.</td></tr>
            ) : pageRows.map((user, idx) => {
              const userId = normalizeId(user);
              const name = `${user?.surname || ""} ${user?.otherNames || ""}`.trim() || user?.email || "User";
              const assignedCompanyIds = getUserAssignedCompanyIds(user);
              const lockState = user?.locked ? "Locked" : user?.isActive === false ? "Inactive" : "Active";
              return (
                <tr key={userId} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-[10px] font-black text-orange-700 shrink-0">{initialsFromName(name)}</div>
                      <span className="font-black text-slate-900">{name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{user?.email || "—"}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-700">{getUserRoleLabel(user)}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{getPrimaryCompanyName(user, companyMap)}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-900">{assignedCompanyIds.length}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${getStatusTone(lockState)}`}>{lockState}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDate(user?.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button onClick={() => onEditUser(user)} className="inline-flex items-center gap-1 rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-[10px] font-black text-indigo-700 hover:bg-indigo-100"><FaEdit size={9} /> Edit</button>
                      <button onClick={() => onToggleUserLock(user)} className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-black hover:opacity-90 ${user?.locked ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
                        {user?.locked ? <><FaLockOpen size={9} /> Unlock</> : <><FaLock size={9} /> Lock</>}
                      </button>
                      <button onClick={() => onResetPassword(user)} className="inline-flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-black text-violet-700 hover:bg-violet-100"><FaKey size={9} /> Reset Password</button>
                      <button onClick={() => onDeleteUser(user)} className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-700 hover:bg-rose-100"><FaTrash size={9} /> Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={ITEMS_PER_PAGE} onPage={setPage} />
    </>
  );
};

// ─── Trials Panel ──────────────────────────────────────────────────────────────
const TrialsPanel = ({ companies, companyReadiness, companyUserCounts, onOpenWorkspace, onOpenCompanySetup }) => {
  const [page, setPage] = useState(1);

  const spotlightCompanies = useMemo(() => {
    const demoCompanies = companies.filter((c) => c?.isDemoWorkspace);
    const inactiveCompanies = companies.filter((c) => !c?.isDemoWorkspace && !isCompanyActive(c));
    const attentionCompanies = companies.filter((c) => (companyReadiness.get(normalizeId(c))?.score || 0) < 80);
    return [...new Map([...demoCompanies, ...inactiveCompanies, ...attentionCompanies].map((c) => [normalizeId(c), c])).values()];
  }, [companies, companyReadiness]);

  const totalPages = Math.max(1, Math.ceil(spotlightCompanies.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = spotlightCompanies.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const demoCount = companies.filter((c) => c?.isDemoWorkspace).length;
  const inactiveCount = companies.filter((c) => !c?.isDemoWorkspace && !isCompanyActive(c)).length;
  const attentionCount = companies.filter((c) => (companyReadiness.get(normalizeId(c))?.score || 0) < 80).length;

  return (
    <>
      <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700"><FaStore size={10} /> {demoCount} Demo workspaces</div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700"><FaLock size={10} /> {inactiveCount} Inactive companies</div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700"><FaExclamationTriangle size={10} /> {attentionCount} Needs activation work</div>
          <div className="ml-auto text-[11px] font-semibold text-slate-500">{spotlightCompanies.length} total</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0B3B2E] text-white">
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Company</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Type</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Mode</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Readiness</th>
              <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Users</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Missing setup</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Updated</th>
              <th className="px-3 py-2 text-right text-[11px] font-black uppercase tracking-[0.16em]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No demo or activation-watch companies found.</td></tr>
            ) : pageRows.map((company, idx) => {
              const companyId = normalizeId(company);
              const readiness = companyReadiness.get(companyId) || evaluateCompanySetup(company, 0);
              const userCount = companyUserCounts.get(companyId) || 0;
              const spotlightLabel = company?.isDemoWorkspace ? "Demo" : !isCompanyActive(company) ? "Inactive" : "Needs Attention";
              return (
                <tr key={companyId} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CompanyAvatar company={company} />
                      <div className="font-black text-slate-900">{company.companyName}</div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${getStatusTone(spotlightLabel)}`}>{spotlightLabel}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{getCompanyOperatingModeLabel(company.companyMode)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${readiness.score >= 80 ? "bg-emerald-600" : readiness.score >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${readiness.score}%` }} />
                      </div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${getReadinessTone(readiness.score)}`}>{readiness.score}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-slate-900">{userCount}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {readiness.missing.length ? readiness.missing.slice(0, 3).join(", ") + (readiness.missing.length > 3 ? ` +${readiness.missing.length - 3}` : "") : <span className="text-emerald-600">No gaps</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDate(company.updatedAt || company.createdAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button onClick={() => onOpenWorkspace(company)} className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700 hover:bg-emerald-100"><FaEye size={9} /> Workspace</button>
                      <button onClick={() => onOpenCompanySetup(company)} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-100"><FaCog size={9} /> Setup</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={spotlightCompanies.length} pageSize={ITEMS_PER_PAGE} onPage={setPage} />
    </>
  );
};

// ─── Audit Panel ───────────────────────────────────────────────────────────────
const AuditPanel = ({ companies, users, companyMap }) => {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  useEffect(() => { setPage(1); }, [search, typeFilter]);

  return (
    <>
      <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/95 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events..." className="h-8 w-full rounded border border-gray-300 bg-[#DDEFE1] pl-9 pr-3 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="h-8 rounded border border-orange-300 bg-orange-50 px-3 text-xs font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-1 focus:ring-[#FF8C00]">
            <option value="all">All types</option>
            <option value="Company">Company</option>
            <option value="User">User</option>
          </select>
          <span className="ml-auto text-[11px] font-semibold text-slate-500">{filtered.length} event{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0B3B2E] text-white">
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Date</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Event</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Type</th>
              <th className="px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em]">Detail</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">No recent platform activity found.</td></tr>
            ) : pageRows.map((event, idx) => (
              <tr key={event.id} className={`border-t border-slate-100 hover:bg-slate-50 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{formatDate(event.timestamp)}</td>
                <td className="px-3 py-2 font-black text-slate-900">{event.title}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ${event.type === "Company" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>{event.type}</span>
                </td>
                <td className="px-3 py-2 text-slate-600">{event.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={safePage} totalPages={totalPages} total={filtered.length} pageSize={ITEMS_PER_PAGE} onPage={setPage} />
    </>
  );
};

// ─── Page root ─────────────────────────────────────────────────────────────────
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

  useEffect(() => { dispatch(getCompanies({ includeDemo: true })); }, [dispatch]);
  useEffect(() => { dispatch(getUsers(selectedCompanyId || undefined)); }, [dispatch, selectedCompanyId]);
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50 p-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

          {/* ── Sticky header ─────────────────────────────────────────────── */}
          <div className="sticky top-0 z-20 flex-shrink-0 border-b border-slate-200 bg-slate-50/95 shadow-sm backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">System Administration</div>
                <h1 className="text-sm font-black text-slate-900 leading-none mt-0.5">Control Centre</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-700">
                <span className="rounded border border-slate-200 bg-white px-2 py-0.5">{companyList.length} companies</span>
                <span className="rounded border border-slate-200 bg-white px-2 py-0.5">{userList.length} users</span>
                <button onClick={() => { dispatch(getCompanies({ includeDemo: true })); dispatch(getUsers(selectedCompanyId || undefined)); }} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-100"><FaRedoAlt size={9} /> Refresh</button>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex items-center gap-0 border-t border-slate-200 px-3">
              {sections.map((section) => (
                <button
                  key={section.key}
                  onClick={() => goToSection(section.key, section.key === "users" && selectedCompanyId ? `?company=${selectedCompanyId}` : "")}
                  className={`relative inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
                    activeSection === section.key
                      ? "border-b-2 border-[#0B3B2E] text-[#0B3B2E]"
                      : "text-slate-500 hover:text-slate-700"
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
            <div className="p-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                System Administration is restricted to Milik Admin users.
              </div>
            </div>
          )}

          {/* ── Loading state ─────────────────────────────────────────────── */}
          {isSystemAdmin && isLoading && (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading companies...</div>
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
              )}

              {activeSection === "users" && (
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
              )}

              {activeSection === "trials" && (
                <TrialsPanel
                  companies={companyList}
                  companyReadiness={companyReadiness}
                  companyUserCounts={companyUserCounts}
                  onOpenWorkspace={handleOpenWorkspace}
                  onOpenCompanySetup={handleOpenCompanySetup}
                />
              )}

              {activeSection === "audit" && (
                <AuditPanel companies={companyList} users={userList} companyMap={companyMap} />
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
