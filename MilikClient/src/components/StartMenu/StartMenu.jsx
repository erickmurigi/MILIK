import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaAddressBook, FaBoxes, FaFolderOpen,
  FaEnvelope, FaSms, FaUserCircle, FaSignOutAlt, FaThLarge,
  FaBuilding, FaCheckCircle, FaSearch, FaUserShield,
  FaStore, FaChartLine, FaBriefcase, FaLock, FaCog, FaCar,
  FaUserTie, FaCity, FaChevronRight, FaSync, FaTimes,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import { selectCurrentUser, selectCurrentCompany } from "../../redux/selectors";
import { toast } from "react-toastify";
import { clearClientSessionStorage } from "../../utils/sessionCleanup";
import { clearAllTabCache } from "../../hooks/useTabState";
import { getAccessibleCompanies, switchCompany } from "../../redux/apiCalls";
import { setCurrentCompany } from "../../redux/companiesRedux";
import {
  getCompanyOperatingModeLabel, hasCompanyModule, hasAnyCompanyModule,
  GL_ACCESS_MODULES, isSelfManagingLandlordCompany,
} from "../../utils/companyModules";
import { useTermPresetLabel, useTerm } from "../../hooks/useTerm";

const initials = (value = "") =>
  String(value || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase()).join("") || "M";

// Tile icon chip colour per module
const MODULE_ACCENT = {
  milik:       "bg-emerald-700",
  accounts:    "bg-blue-700",
  inventory:   "bg-violet-700",
  propertySale:"bg-amber-600",
  carwash:     "bg-cyan-700",
  hr:          "bg-rose-700",
  clients:     "bg-[#0B3B2E]",
  procurement: "bg-slate-500",
  pos:         "bg-orange-600",
  dms:         "bg-teal-700",
};

const moduleRegistry = [
  { id: "milik",        moduleKey: "propertyManagement", label: "Property Management", icon: <FaCity />,        to: "/dashboard",          status: "active" },
  { id: "accounts",     moduleKey: "accounts",           label: "Financial Accounts",  icon: <FaChartLine />,   to: "/accounts/dashboard", status: "active" },
  { id: "inventory",    moduleKey: "inventory",          label: "Inventory & POS",     icon: <FaBoxes />,       to: "/inventory/dashboard",status: "active" },
  { id: "propertySale", moduleKey: "propertySale",       label: "Property Sales",      icon: <FaBuilding />,    to: "/sale/dashboard",     status: "active" },
  { id: "carwash",      moduleKey: "carwash",            label: "MILIK Car Wash",      icon: <FaCar />,         to: "/carwash/dashboard",  status: "active" },
  { id: "hr",           moduleKey: "hr",                 label: "Human Resources",     icon: <FaUserTie />,     to: "/hr/dashboard",       status: "active" },
  { id: "clients",      moduleKey: "clients",            label: "Contract Management", icon: <FaAddressBook />, to: "/clients/dashboard",  status: "active" },
  { id: "procurement",  moduleKey: "procurement",        label: "Ven-Door",            icon: <FaBriefcase />,                              status: "coming" },
  { id: "pos",          moduleKey: "pos",                label: "POS & Billing",       icon: <FaStore />,                                  status: "coming" },
  { id: "dms",          moduleKey: "dms",                label: "Document Management", icon: <FaFolderOpen />,                             status: "coming" },
];

const SectionLabel = ({ children }) => (
  <div className="mb-2 flex items-center gap-2">
    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{children}</span>
    <span className="h-px flex-1 bg-slate-200" />
  </div>
);

const MenuTile = ({ icon, label, chipClass, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="group flex items-center gap-2.5 border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-[#0B3B2E]/40 hover:bg-[#0B3B2E]/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B3B2E]/30"
  >
    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center text-[13px] text-white ${chipClass}`}>{icon}</span>
    <span className="min-w-0 flex-1 text-[11px] font-bold leading-tight text-slate-800 group-hover:text-[#0B3B2E]">{label}</span>
    <FaChevronRight className="text-[8px] text-[#0B3B2E] opacity-0 transition group-hover:opacity-100" />
  </button>
);

const StartMenu = ({ variant = "floating" }) => {
  const dispatch     = useDispatch();
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const currentUser    = useSelector(selectCurrentUser);
  const currentCompany = useSelector(selectCurrentCompany);
  const isCompanySwitching = useSelector((state) => state.company?.isSwitching);

  const [open, setOpen]                         = useState(false);
  const [showSwitchModal, setShowSwitchModal]   = useState(false);
  const [companies, setCompanies]               = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [switchingId, setSwitchingId]           = useState(null);
  const [search, setSearch]                     = useState("");

  const anchorRef = useRef(null);
  const menuRef   = useRef(null);

  const isSystemAdmin     = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);
  const userName          = [currentUser?.surname, currentUser?.otherNames].filter(Boolean).join(" ") || "Milik User";
  const userRole          = currentUser?.role || "";
  const companyName       = currentCompany?.companyName || currentUser?.company?.companyName || "No active company";
  const companyLogo       = currentCompany?.logo || currentUser?.company?.logo || "";
  const activeCompanyCtx  = currentCompany || currentUser?.company || null;
  const isLandlordMode    = isSelfManagingLandlordCompany(activeCompanyCtx);
  const operatingMode     = getCompanyOperatingModeLabel(activeCompanyCtx?.companyMode);
  const presetLabel       = useTermPresetLabel();
  const saleModuleName    = useTerm("saleModule");
  // The header-bar variant sits in the dark top bar; the floating variant is the company-setup wizard's launcher.
  const isBar             = variant !== "floating";

  // Close on a click outside the menu and its trigger
  useEffect(() => {
    const onDown = (e) => {
      if (!open) return;
      if (menuRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Prefetch the company list so the Switch Company dialog opens instantly
  useEffect(() => {
    if (open) getAccessibleCompanies().catch(() => {});
  }, [open]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); setShowSwitchModal(false); } };
    if (open || showSwitchModal) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, showSwitchModal]);

  const activeModules = useMemo(() => {
    if (!activeCompanyCtx) return [];
    return moduleRegistry
      .map((item) => item.id !== "milik" ? item : { ...item, label: isLandlordMode ? "MILIK Landlord" : item.label })
      .map((item) => item.id !== "propertySale" ? item : { ...item, label: saleModuleName })
      .filter((item) => item.id === "accounts"
        ? hasAnyCompanyModule(activeCompanyCtx, GL_ACCESS_MODULES)
        : hasCompanyModule(activeCompanyCtx, item.moduleKey)
      );
  }, [activeCompanyCtx, isLandlordMode, saleModuleName]);

  const configItems = useMemo(() => {
    const items = [
      { label: "Company Setup",        icon: <FaBuilding />, path: "/company-setup" },
      { label: "Operational Settings", icon: <FaCog />,      path: "/settings" },
    ];
    if (isSystemAdmin) items.push({ label: "System Administration", icon: <FaUserShield />, path: "/system-setup" });
    return items;
  }, [isSystemAdmin]);

  const openSwitchCompany = useCallback(async ({ forceRefresh = false } = {}) => {
    setOpen(false);
    setSearch("");
    setShowSwitchModal(true);
    setLoadingCompanies(true);
    try {
      const items = await getAccessibleCompanies({ forceRefresh });
      setCompanies(Array.isArray(items) ? items : []);
    } catch (err) {
      setCompanies([]);
      toast.error(err?.response?.data?.message || err?.message || "Failed to load companies");
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  const filteredCompanies = useMemo(() => {
    const activeId = String(currentCompany?._id || currentUser?.company?._id || "");
    const list = companies.slice();
    list.sort((a, b) => {
      const aA = String(a?._id || "") === activeId ? 1 : 0;
      const bA = String(b?._id || "") === activeId ? 1 : 0;
      if (aA !== bA) return bA - aA;
      return String(a?.companyName || "").localeCompare(String(b?.companyName || ""));
    });
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((c) =>
      [c?.companyName, c?.companyCode, c?.town, c?.country].filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [companies, currentCompany?._id, currentUser?.company?._id, search]);

  const go = useCallback((path) => { setOpen(false); navigate(path); }, [navigate]);

  const onSignOut = () => { clearClientSessionStorage(); setOpen(false); window.location.replace("/login"); };

  const handleModuleClick = useCallback((item) => {
    setOpen(false);
    if (item?.status === "active" && item?.to) {
      const recent = JSON.parse(localStorage.getItem("recentModules") || "[]");
      localStorage.setItem("recentModules", JSON.stringify([item.id, ...recent.filter((id) => id !== item.id)].slice(0, 5)));
      navigate(item.to);
    } else {
      toast.info(`${item?.label || "This module"} is not yet live.`);
    }
  }, [navigate]);

  const handleSwitchCompany = useCallback(async (company) => {
    if (!company?._id) return;
    const activeId = String(currentCompany?._id || currentUser?.company?._id || "");
    if (String(company._id) === activeId) {
      setShowSwitchModal(false); setOpen(false);
      navigate("/moduleDashboard", { replace: true });
      return;
    }
    if (isCompanySwitching || switchingId) return;

    // Keep the previous company so a failed switch can roll back
    const prevCompany = currentCompany || null;

    // Optimistic switch: set the company from the list already in memory, clear caches so the
    // new company sees only its own data, then navigate. The API call finishes in the background.
    dispatch(setCurrentCompany(company));
    clearAllTabCache();
    queryClient.clear();
    setSwitchingId(company._id);
    setShowSwitchModal(false);
    setOpen(false);
    navigate("/moduleDashboard", { replace: true });

    try {
      await dispatch(switchCompany(company._id));
    } catch (err) {
      if (prevCompany) {
        dispatch(setCurrentCompany(prevCompany));
        queryClient.clear();
      }
      toast.error(err?.response?.data?.message || err?.message || "Failed to switch company");
    } finally {
      setSwitchingId(null);
    }
  }, [currentCompany, currentUser?.company?._id, isCompanySwitching, switchingId, dispatch, navigate, queryClient]);

  const isBusy = isCompanySwitching;

  // ── Trigger ───────────────────────────────────────────────────────────────────
  const triggerBtn = (
    <button
      ref={anchorRef}
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Open menu"
      className={isBar
        ? "group flex h-full items-center gap-2 border-r border-white/10 px-3 text-white transition hover:bg-white/10 active:bg-white/20"
        : "group flex items-center gap-2 rounded-2xl border border-emerald-100 bg-white/85 px-4 py-2 shadow-lg backdrop-blur-xl transition hover:shadow-xl active:scale-[0.98]"}
    >
      <span className={`flex items-center justify-center rounded-lg text-white ${isBar ? "h-[22px] w-[22px] bg-white/15 text-[11px]" : "h-8 w-8 bg-gradient-to-br from-[#F97316] to-[#16A34A] text-sm shadow"}`}>
        <FaThLarge />
      </span>
      <span className={`font-black tracking-widest ${isBar ? "hidden text-[11px] sm:inline" : "text-[13px] text-slate-900"}`}>MENU</span>
    </button>
  );

  // ── Menu panel ────────────────────────────────────────────────────────────────
  const menuPanel = open && (
    <div
      ref={menuRef}
      role="menu"
      className={isBar
        ? "absolute left-0 top-full z-[130] mt-px w-[min(96vw,820px)] border border-slate-200 bg-white shadow-[0_24px_48px_-12px_rgba(2,44,34,0.35)]"
        : "absolute bottom-[60px] left-1/2 z-[130] w-[min(96vw,820px)] -translate-x-1/2 border border-slate-200 bg-white shadow-[0_24px_48px_-12px_rgba(2,44,34,0.35)]"}
    >
      {/* Identity strip */}
      <div className="flex items-center gap-3 bg-[#0B3B2E] px-4 py-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden border border-white/20 bg-white/10 text-white">
          {companyLogo
            ? <img src={companyLogo} alt={companyName} className="h-full w-full object-contain p-1" />
            : <span className="text-sm font-black">{initials(companyName)}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-black uppercase tracking-wide text-white">{companyName}</div>
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-emerald-300">{presetLabel || operatingMode}</div>
        </div>
        <div className="hidden flex-shrink-0 text-right sm:block">
          <div className="text-[11px] font-bold text-white">{userName}</div>
          {userRole && <div className="text-[9px] font-semibold uppercase tracking-widest text-white/50">{userRole}</div>}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center border border-white/20 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <FaTimes className="text-[11px]" />
        </button>
      </div>

      <div className="grid max-h-[70vh] grid-cols-1 md:grid-cols-[1fr_220px]">
        {/* Modules and configuration */}
        <div className="min-h-0 overflow-y-auto p-4">
          <SectionLabel>Modules</SectionLabel>
          {activeModules.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {activeModules.map((item) => (
                <MenuTile
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  chipClass={MODULE_ACCENT[item.id] || "bg-slate-600"}
                  onClick={() => handleModuleClick(item)}
                />
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-slate-300 px-4 py-6 text-center text-[11px] text-slate-400">
              No modules are enabled for this company.
            </div>
          )}

          <div className="mt-4">
            <SectionLabel>Configuration</SectionLabel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {configItems.map((item) => (
                <MenuTile key={item.label} icon={item.icon} label={item.label} chipClass="bg-slate-700" onClick={() => go(item.path)} />
              ))}
              <MenuTile icon={<FaSync />} label="Switch Company" chipClass="bg-[#FF8C00]" onClick={() => openSwitchCompany()} />
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-t border-slate-200 bg-slate-50 p-4 md:border-l md:border-t-0">
          <SectionLabel>Account</SectionLabel>
          <div className="flex items-center gap-3 border border-slate-200 bg-white p-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center bg-[#0B3B2E] text-sm font-black text-white">
              {initials(userName)}
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-black leading-tight text-slate-800">{userName}</div>
              {userRole && <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">{userRole}</div>}
            </div>
          </div>

          <div className="grid gap-2">
            <MenuTile icon={<FaUserCircle />} label="My Account"    chipClass="bg-slate-700" onClick={() => go("/my-account")} />
            <div className="border border-slate-200 bg-white">
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center bg-teal-600 text-[13px] text-white"><FaSms /></span>
                <span className="text-[11px] font-bold text-slate-800">Communications</span>
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-200 border-t border-slate-200">
                <button type="button" onClick={() => go("/communications/sms")} className="flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 transition hover:bg-slate-50 hover:text-[#0B3B2E]">
                  <FaSms /> SMS
                </button>
                <button type="button" onClick={() => go("/communications/email")} className="flex items-center justify-center gap-1.5 px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 transition hover:bg-slate-50 hover:text-[#0B3B2E]">
                  <FaEnvelope /> Email
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-2.5 border border-rose-200 bg-white px-3 py-2.5 text-[11px] font-black uppercase tracking-wide text-rose-700 transition hover:bg-rose-50"
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center bg-rose-600 text-white"><FaSignOutAlt className="text-[13px]" /></span>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className={isBar
        ? "relative z-[120] flex min-h-[34px] items-center border-r border-white/10"
        : "fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 sm:bottom-12"
      }>
        {triggerBtn}
        {menuPanel}
      </div>

      {/* Switch company dialog. Portalled to <body> so a header or transformed wrapper can't clip it. */}
      {showSwitchModal && createPortal(
        <div
          className="fixed inset-0 z-[140] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-10 backdrop-blur-[2px] sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSwitchModal(false); }}
        >
          <div className="flex max-h-[80vh] w-full max-w-[460px] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            {/* Header */}
            <div className="flex flex-shrink-0 items-center justify-between gap-3 bg-[#0B3B2E] px-4 py-3 text-white">
              <h2 className="text-sm font-black uppercase tracking-wide">Switch company</h2>
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-1 text-[10px] font-bold tabular-nums text-white/70">
                  {filteredCompanies.length} / {companies.length}
                </span>
                <button
                  type="button"
                  onClick={() => openSwitchCompany({ forceRefresh: true })}
                  disabled={loadingCompanies}
                  title="Refresh list"
                  aria-label="Refresh list"
                  className="flex h-7 w-7 items-center justify-center text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <FaSync className={`text-[10px] ${loadingCompanies ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowSwitchModal(false)}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <FaTimes className="text-[11px]" />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="flex-shrink-0 border-b border-slate-200 p-3">
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, code or town"
                  autoFocus
                  className="w-full border border-slate-300 py-2 pl-8 pr-3 text-xs shadow-sm outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-[#0B3B2E]/10"
                />
              </div>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingCompanies ? (
                <div className="flex flex-col items-center justify-center gap-3 py-14">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-100 border-t-[#0B3B2E]" />
                  <span className="text-[11px] text-slate-400">Loading companies…</span>
                </div>
              ) : filteredCompanies.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-14">
                  <FaBuilding className="text-2xl text-slate-200" />
                  <div className="text-[12px] font-semibold text-slate-400">No companies found</div>
                  {search && <div className="text-[11px] text-slate-400">Try a different search term</div>}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredCompanies.map((company) => {
                    const activeId    = String(currentCompany?._id || currentUser?.company?._id || "");
                    const active      = String(company?._id) === activeId;
                    const isLocked    = Boolean(company?.locked);
                    const isSwitching = switchingId === company._id;
                    const clickable   = !isBusy && !isLocked && !switchingId;
                    const modCount    = Array.isArray(company?.enabledModules) ? company.enabledModules.length : 0;
                    const modeLabel   = getCompanyOperatingModeLabel(company?.companyMode);
                    const meta        = [company?.companyCode, company?.town].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={company._id}
                        type="button"
                        onClick={() => clickable && handleSwitchCompany(company)}
                        disabled={!clickable}
                        className={[
                          "group relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                          active ? "bg-[#0B3B2E]/[0.04]" : isLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-[#FF8C00]" />}

                        <div className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden border text-[11px] font-black ${
                          active ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-slate-100 text-slate-600"
                        }`}>
                          {company?.logo
                            ? <img src={company.logo} alt={company.companyName} className="h-full w-full object-contain p-0.5" />
                            : <span>{initials(company?.companyName)}</span>}
                          {isLocked && (
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/55">
                              <FaLock className="text-[8px] text-white" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`truncate text-[12px] font-bold leading-none ${active ? "text-[#0B3B2E]" : "text-slate-900"}`}>
                              {company?.companyName}
                            </span>
                            {active && (
                              <span className="inline-flex items-center gap-1 bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black uppercase leading-none tracking-wide text-emerald-700">
                                <FaCheckCircle className="text-[7px]" /> Active
                              </span>
                            )}
                            {isLocked && (
                              <span className="inline-flex items-center gap-1 bg-rose-100 px-1.5 py-0.5 text-[9px] font-black uppercase leading-none tracking-wide text-rose-700">
                                <FaLock className="text-[7px]" /> Locked
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 overflow-hidden">
                            {meta && <span className="shrink-0 text-[10px] text-slate-400">{meta}</span>}
                            {meta && <span className="h-2.5 w-px flex-shrink-0 bg-slate-200" />}
                            <span className="shrink-0 bg-slate-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">
                              {active ? (presetLabel || modeLabel) : modeLabel}
                            </span>
                            {modCount > 0 && (
                              <span className="shrink-0 bg-slate-100 px-1 py-px text-[9px] text-slate-400">
                                {modCount} module{modCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>

                        {isSwitching ? (
                          <div className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-[#0B3B2E]" />
                        ) : (
                          !isLocked && <FaChevronRight className={`flex-shrink-0 text-[9px] transition-colors ${active ? "text-[#0B3B2E]" : "text-slate-300 group-hover:text-slate-500"}`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="text-[10px] text-slate-400">
                Active: <span className="font-bold text-slate-700">{companyName}</span>
              </div>
              {isBusy
                ? <span className="text-[10px] font-semibold text-[#0B3B2E]">Switching workspace…</span>
                : (
                  <button
                    type="button"
                    onClick={() => setShowSwitchModal(false)}
                    className="border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default StartMenu;
