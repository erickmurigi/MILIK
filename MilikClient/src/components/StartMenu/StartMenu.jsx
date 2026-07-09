import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaBoxes, FaFolderOpen,
  FaEnvelope, FaSms, FaUserCircle, FaSignOutAlt, FaThLarge,
  FaBuilding, FaCheckCircle, FaSearch, FaUserShield, FaShieldAlt,
  FaStore, FaChartLine, FaBriefcase, FaLock, FaCog, FaCar,
  FaUserTie, FaCity, FaChevronRight, FaSync,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { selectCurrentUser, selectCurrentCompany } from "../../redux/selectors";
import { toast } from "react-toastify";
import { clearClientSessionStorage } from "../../utils/sessionCleanup";
import { getAccessibleCompanies, switchCompany } from "../../redux/apiCalls";
import { setCurrentCompany } from "../../redux/companiesRedux";
import {
  getCompanyOperatingModeLabel, hasCompanyModule, hasAnyCompanyModule,
  GL_ACCESS_MODULES, isSelfManagingLandlordCompany,
} from "../../utils/companyModules";

const initials = (value = "") =>
  String(value || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase()).join("") || "M";

// Module colour accent: bg + text classes for the icon badge
const MODULE_ACCENT = {
  milik:       { bg: "bg-emerald-700",  text: "text-white" },
  accounts:    { bg: "bg-blue-700",     text: "text-white" },
  inventory:   { bg: "bg-violet-700",   text: "text-white" },
  propertySale:{ bg: "bg-amber-600",    text: "text-white" },
  carwash:     { bg: "bg-cyan-700",     text: "text-white" },
  hr:          { bg: "bg-rose-700",     text: "text-white" },
  procurement: { bg: "bg-slate-500",    text: "text-white" },
  pos:         { bg: "bg-orange-600",   text: "text-white" },
  securityServices: { bg: "bg-gray-700", text: "text-white" },
  dms:         { bg: "bg-teal-700",     text: "text-white" },
};

const moduleRegistry = [
  { id: "milik",        moduleKey: "propertyManagement", label: "Property Management", icon: <FaCity />,       to: "/dashboard",         status: "active" },
  { id: "accounts",     moduleKey: "accounts",           label: "Financial Accounts",  icon: <FaChartLine />,  to: "/accounts/dashboard", status: "active" },
  { id: "inventory",    moduleKey: "inventory",          label: "Inventory & POS",     icon: <FaBoxes />,      to: "/inventory/dashboard",status: "active" },
  { id: "propertySale", moduleKey: "propertySale",       label: "Property Sales",      icon: <FaBuilding />,   to: "/sale/dashboard",     status: "active" },
  { id: "carwash",      moduleKey: "carwash",            label: "MILIK Car Wash",      icon: <FaCar />,        to: "/carwash/dashboard",  status: "active" },
  { id: "hr",           moduleKey: "hr",                 label: "Human Resources",     icon: <FaUserTie />,    to: "/hr/dashboard",       status: "active" },
  { id: "procurement",  moduleKey: "procurement",        label: "Ven-Door",            icon: <FaBriefcase />,                             status: "coming" },
  { id: "pos",          moduleKey: "pos",                label: "POS & Billing",       icon: <FaStore />,                                 status: "coming" },
  { id: "securityServices", moduleKey: "securityServices", label: "Security",          icon: <FaShieldAlt />,                             status: "coming" },
  { id: "dms",          moduleKey: "dms",                label: "Document Management", icon: <FaFolderOpen />,                            status: "coming" },
];

// ─────────────────────────────────────────────────────────────────────────────

const StartMenu = ({ darkMode = false, variant = "floating" }) => {
  const dispatch   = useDispatch();
  const navigate   = useNavigate();
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

  const businessId        = currentCompany?._id || (typeof currentUser?.company === "string" ? currentUser.company : currentUser?.company?._id) || "";
  const isSystemAdmin     = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);
  const isDemoUser        = Boolean(currentUser?.isDemoUser);
  const userName          = [currentUser?.surname, currentUser?.otherNames].filter(Boolean).join(" ") || "Milik User";
  const userRole          = currentUser?.role || "";
  const companyName       = currentCompany?.companyName || currentUser?.company?.companyName || "No active company";
  const companyLogo       = currentCompany?.logo || currentUser?.company?.logo || "";
  const activeCompanyCtx  = currentCompany || currentUser?.company || null;
  const isLandlordMode    = isSelfManagingLandlordCompany(activeCompanyCtx);
  const operatingMode     = getCompanyOperatingModeLabel(activeCompanyCtx?.companyMode);
  const isHeader          = variant === "header";

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

  // Prefetch companies list when menu opens so "Switch Company" modal appears instantly
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
      .filter((item) => item.id === "accounts"
        ? hasAnyCompanyModule(activeCompanyCtx, GL_ACCESS_MODULES)
        : hasCompanyModule(activeCompanyCtx, item.moduleKey)
      );
  }, [activeCompanyCtx, isLandlordMode]);

  const configItems = useMemo(() => {
    const items = [
      { label: "Company Setup",          icon: <FaBuilding />, path: "/company-setup" },
      { label: "Operational Settings",   icon: <FaCog />,      path: "/settings" },
    ];
    if (isSystemAdmin) items.push({ label: "System Administration", icon: <FaUserShield />, path: "/system-setup" });
    return items;
  }, [isSystemAdmin]);

  const openSwitchCompany = useCallback(async ({ forceRefresh = false } = {}) => {
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
    const list = (isDemoUser ? companies : companies.filter((c) => !c?.isDemoWorkspace)).slice();
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
  }, [companies, currentCompany?._id, currentUser?.company?._id, isDemoUser, search]);

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

    // Capture previous company for rollback if the API call fails
    const prevCompany = currentCompany || null;

    // Optimistic: set the new company instantly from the already-fetched list data,
    // close the modal, and navigate — user sees new modules with zero wait
    dispatch(setCurrentCompany(company));
    setSwitchingId(company._id);
    setShowSwitchModal(false);
    setOpen(false);
    navigate("/moduleDashboard", { replace: true });

    try {
      await dispatch(switchCompany(company._id));
    } catch (err) {
      if (prevCompany) dispatch(setCurrentCompany(prevCompany));
      toast.error(err?.response?.data?.message || err?.message || "Failed to switch company");
    } finally {
      setSwitchingId(null);
    }
  }, [currentCompany, currentUser?.company?._id, isCompanySwitching, switchingId, dispatch, navigate]);

  const isBusy = isCompanySwitching;

  // ── Trigger button ──────────────────────────────────────────────────────────
  const triggerBtn = (
    <button
      ref={anchorRef}
      onClick={() => setOpen((v) => !v)}
      className={[
        isHeader
          ? "group flex h-full items-center gap-2 border-r border-white/10 px-3 text-white transition hover:bg-white/10 active:bg-white/20"
          : "group flex items-center gap-2 rounded-2xl border border-emerald-100 bg-white/85 px-4 py-2 shadow-lg backdrop-blur-xl transition hover:shadow-xl active:scale-[0.98]",
      ].join(" ")}
      aria-label="Open Menu"
    >
      <span className={`flex items-center justify-center rounded-lg text-white ${isHeader ? "h-[22px] w-[22px] bg-white/15 text-[11px]" : "h-8 w-8 bg-gradient-to-br from-[#F97316] to-[#16A34A] text-sm shadow"}`}>
        <FaThLarge />
      </span>
      <span className={`font-black tracking-widest ${isHeader ? "hidden text-[11px] sm:inline" : "text-[13px] text-slate-900"}`}>MENU</span>
    </button>
  );

  // ── Menu panel ──────────────────────────────────────────────────────────────
  const menuPanel = open && (
    <div
      ref={menuRef}
      className={
        isHeader
          ? "absolute left-0 top-full z-[130] w-[min(96vw,780px)]"
          : "absolute bottom-[56px] left-1/2 z-[130] w-[min(96vw,780px)] -translate-x-1/2"
      }
    >
      {/* Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.18)]">

        {/* ── Header strip ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 bg-[#0B3B2E] px-4 py-3">
          {/* Logo / initials */}
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-white/20 bg-white/10 text-white">
            {companyLogo
              ? <img src={companyLogo} alt={companyName} className="h-full w-full object-contain p-1" />
              : <span className="text-sm font-black">{initials(companyName)}</span>}
          </div>
          {/* Company info */}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-black text-white">{companyName}</div>
            <div className="truncate text-[10px] font-semibold text-emerald-300">{operatingMode}</div>
          </div>
          {/* User chip */}
          <div className="hidden flex-shrink-0 flex-col items-end sm:flex">
            <span className="text-[11px] font-bold text-white/90">{userName}</span>
            {userRole && <span className="text-[9px] font-semibold uppercase tracking-widest text-white/50">{userRole}</span>}
          </div>
          {/* Close */}
          <button
            onClick={() => setOpen(false)}
            className="ml-1 flex-shrink-0 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-bold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] max-h-[72vh] overflow-hidden">

          {/* Left: Modules + Config */}
          <div className="overflow-y-auto border-r border-slate-100 p-4">

            {/* Modules section */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Modules</span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>

            {activeModules.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {activeModules.map((item) => {
                  const accent = MODULE_ACCENT[item.id] || { bg: "bg-slate-600", text: "text-white" };
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleModuleClick(item)}
                      className="group flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm active:scale-[0.97]"
                    >
                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-[15px] ${accent.bg} ${accent.text} shadow-sm`}>
                        {item.icon}
                      </div>
                      <span className="text-[11px] font-extrabold leading-tight text-slate-800 group-hover:text-[#0B3B2E]">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-[11px] text-slate-400">
                No active modules are enabled for this company.
              </div>
            )}

            {/* Config section */}
            <div className="mb-1 mt-4 flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Configuration</span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {configItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => { setOpen(false); navigate(item.path); }}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
                >
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 text-[11px] text-white">{item.icon}</span>
                  <span className="text-[11px] font-bold text-slate-700">{item.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={async (e) => { e.preventDefault(); await openSwitchCompany(); }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50 hover:shadow-sm"
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 text-[11px] text-white"><FaSync /></span>
                <span className="text-[11px] font-bold text-slate-700">Switch Company</span>
              </button>
            </div>
          </div>

          {/* Right: Account panel */}
          <div className="overflow-y-auto bg-slate-50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Account</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            {/* User card */}
            <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0B3B2E] text-sm font-black text-white">
                {initials(userName)}
              </div>
              <div className="mt-2">
                <div className="text-[12px] font-black text-slate-800">{userName}</div>
                {userRole && <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{userRole}</div>}
              </div>
            </div>

            <div className="space-y-1.5">
              <button
                onClick={() => { setOpen(false); navigate("/my-account"); }}
                className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:bg-white hover:shadow-sm"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 text-white text-[13px]"><FaUserCircle /></span>
                <span className="text-[11px] font-bold text-slate-700">My Account</span>
              </button>

              <div className="h-px bg-slate-200" />

              <button
                onClick={() => { setOpen(false); navigate("/communications/sms"); }}
                className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:bg-white hover:shadow-sm"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white text-[13px]"><FaSms /></span>
                <span className="text-[11px] font-bold text-slate-700">SMS Manager</span>
              </button>

              <button
                onClick={() => { setOpen(false); navigate("/communications/email"); }}
                className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:bg-white hover:shadow-sm"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white text-[13px]"><FaEnvelope /></span>
                <span className="text-[11px] font-bold text-slate-700">Email Manager</span>
              </button>

              <div className="h-px bg-slate-200" />

              <button
                onClick={onSignOut}
                className="flex w-full items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 transition hover:bg-rose-100"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white text-[13px]"><FaSignOutAlt /></span>
                <span className="text-[11px] font-extrabold text-rose-700">Sign Out</span>
              </button>
            </div>
          </div>
        </div>

        {/* Bottom pointer arrow (floating variant) */}
        {!isHeader && (
          <div className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b border-r border-slate-200 bg-white" />
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className={isHeader
        ? "relative z-[120] flex min-h-[34px] items-center border-r border-white/10"
        : "fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 sm:bottom-12"
      }>
        {triggerBtn}
        {menuPanel}
      </div>

      {/* ── Company switch modal ───────────────────────────────────────────── */}
      {showSwitchModal && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSwitchModal(false); }}
        >
          <div className="flex max-h-[88vh] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">

            {/* Header */}
            <div className="flex-shrink-0 bg-[#0B3B2E] px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-400">Workspace</div>
                  <div className="text-[15px] font-black leading-tight text-white">Switch Company</div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold tabular-nums text-white/70">
                    {filteredCompanies.length} / {companies.filter((c) => isDemoUser || !c?.isDemoWorkspace).length}
                  </span>
                  <button
                    onClick={() => openSwitchCompany({ forceRefresh: true })}
                    disabled={loadingCompanies}
                    title="Refresh list"
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white disabled:opacity-40"
                  >
                    <FaSync className={`text-[10px] ${loadingCompanies ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    onClick={() => setShowSwitchModal(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
              {/* Search */}
              <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5">
                <FaSearch className="flex-shrink-0 text-[10px] text-white/45" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, code, town…"
                  className="w-full bg-transparent text-[12px] text-white placeholder-white/35 outline-none"
                  autoFocus
                />
                {search && (
                  <button onClick={() => setSearch("")} className="text-white/45 transition hover:text-white">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingCompanies ? (
                <div className="flex flex-col items-center justify-center gap-3 py-14">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-100 border-t-emerald-600" />
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
                    const activeId   = String(currentCompany?._id || currentUser?.company?._id || "");
                    const active     = String(company?._id) === activeId;
                    const isLocked   = Boolean(company?.locked);
                    const isSwitching = switchingId === company._id;
                    const clickable  = !isBusy && !isLocked && !switchingId;
                    const modCount   = Array.isArray(company?.enabledModules) ? company.enabledModules.length : 0;
                    const modeLabel  = getCompanyOperatingModeLabel(company?.companyMode);
                    const meta       = [company?.companyCode, company?.town].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={company._id}
                        onClick={() => clickable && handleSwitchCompany(company)}
                        disabled={!clickable}
                        className={[
                          "group relative w-full text-left transition-colors",
                          active
                            ? "bg-emerald-50"
                            : isLocked
                            ? "cursor-not-allowed opacity-50"
                            : isSwitching
                            ? "bg-slate-50"
                            : "cursor-pointer hover:bg-slate-50/80",
                        ].join(" ")}
                      >
                        {/* Left accent bar for active company */}
                        {active && <span className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-emerald-500" />}

                        <div className="flex items-center gap-3 px-4 py-2.5 pl-[18px]">
                          {/* Avatar */}
                          <div className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border text-[11px] font-black ${
                            active ? "border-emerald-300 bg-emerald-700 text-white" : "border-slate-200 bg-slate-100 text-slate-600"
                          }`}>
                            {company?.logo
                              ? <img src={company.logo} alt={company.companyName} className="h-full w-full object-contain p-0.5" />
                              : <span>{initials(company?.companyName)}</span>}
                            {isLocked && (
                              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-900/55">
                                <FaLock className="text-[8px] text-white" />
                              </div>
                            )}
                          </div>

                          {/* Text block */}
                          <div className="min-w-0 flex-1">
                            {/* Row 1: name + badges */}
                            <div className="flex flex-wrap items-center gap-1">
                              <span className={`truncate text-[12px] font-bold leading-none ${active ? "text-emerald-800" : "text-slate-900"}`}>
                                {company?.companyName}
                              </span>
                              {active && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black leading-none text-emerald-700">
                                  <FaCheckCircle className="text-[7px]" /> Active
                                </span>
                              )}
                              {isLocked && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-black leading-none text-rose-700">
                                  <FaLock className="text-[7px]" /> Locked
                                </span>
                              )}
                              {company?.isDemoWorkspace && (
                                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold leading-none text-violet-700">Demo</span>
                              )}
                            </div>
                            {/* Row 2: meta + mode + modules */}
                            <div className="mt-0.5 flex items-center gap-1.5 overflow-hidden">
                              {meta && <span className="shrink-0 text-[10px] text-slate-400">{meta}</span>}
                              {meta && <span className="h-2.5 w-px flex-shrink-0 bg-slate-200" />}
                              <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">{modeLabel}</span>
                              {modCount > 0 && (
                                <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] text-slate-400">
                                  {modCount} module{modCount !== 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Right side: spinner or chevron */}
                          {isSwitching ? (
                            <div className="h-3.5 w-3.5 flex-shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
                          ) : (
                            !isLocked && (
                              <FaChevronRight className={`flex-shrink-0 text-[9px] transition-colors ${active ? "text-emerald-400" : "text-slate-200 group-hover:text-slate-400"}`} />
                            )
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-100 bg-slate-50/80 px-4 py-2">
              <div className="text-[10px] text-slate-400">
                Active: <span className="font-bold text-slate-700">{companyName}</span>
              </div>
              {isBusy && (
                <span className="text-[10px] font-semibold text-emerald-700">Switching workspace…</span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StartMenu;
