import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FaHome,
  FaKey,
  FaBoxes,
  FaUsers,
  FaFolderOpen,
  FaCalculator,
  FaStickyNote,
  FaEnvelope,
  FaSms,
  FaQuestionCircle,
  FaUserCircle,
  FaSignOutAlt,
  FaThLarge,
  FaBuilding,
  FaCheckCircle,
  FaChevronRight,
  FaSearch,
  FaUserShield,
  FaShieldAlt,
  FaStore,
  FaChartLine,
  FaBriefcase,
  FaLock,
  FaCog,
  FaCar,
  FaUserTie,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { clearClientSessionStorage } from "../../utils/sessionCleanup";
import { getAccessibleCompanies, switchCompany } from "../../redux/apiCalls";
import { getCompanyOperatingModeLabel, hasCompanyModule, hasAnyCompanyModule, GL_ACCESS_MODULES, isSelfManagingLandlordCompany } from "../../utils/companyModules";

const initialsFromName = (value = "") =>
  String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "M";

const moduleRegistry = [
  {
    id: "milik",
    moduleKey: "propertyManagement",
    label: "Property Management",
    icon: <FaHome />,
    to: "/dashboard",
    status: "active",
  },
  {
    id: "accounts",
    moduleKey: "accounts",
    label: "Financial Accounts",
    icon: <FaChartLine />,
    to: "/accounts/dashboard",
    status: "active",
  },
  {
    id: "billing",
    moduleKey: "billing",
    label: "Billing",
    icon: <FaEnvelope />,
    status: "coming",
  },
  {
    id: "inventory",
    moduleKey: "inventory",
    label: "Inventory Management",
    icon: <FaBoxes />,
    status: "coming",
  },
  {
    id: "procurement",
    moduleKey: "procurement",
    label: "Ven-Door",
    icon: <FaBriefcase />,
    status: "coming",
  },
  {
    id: "propertySale",
    moduleKey: "propertySale",
    label: "Property Sales",
    icon: <FaBuilding />,
    to: "/sale/dashboard",
    status: "active",
  },
  {
    id: "pos",
    moduleKey: "pos",
    label: "POS & Billing",
    icon: <FaStore />,
    status: "coming",
  },
  {
    id: "securityServices",
    moduleKey: "securityServices",
    label: "Security",
    icon: <FaShieldAlt />,
    status: "coming",
  },
  {
    id: "carwash",
    moduleKey: "carwash",
    label: "MILIK Car Wash",
    icon: <FaCar />,
    to: "/carwash/dashboard",
    status: "active",
  },
  {
    id: "hr",
    moduleKey: "hr",
    label: "Human Resources",
    icon: <FaUserTie />,
    to: "/hr/dashboard",
    status: "active",
  },
  {
    id: "dms",
    moduleKey: "dms",
    label: "Document Management",
    icon: <FaFolderOpen />,
    status: "coming",
  },
];

const StartMenu = ({ darkMode = false, variant = "floating" }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentUser } = useSelector((state) => state.auth || {});
  const { currentCompany, isSwitching: isCompanySwitching } = useSelector((state) => state.company || {});
  const [open, setOpen] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companiesLoadedAt, setCompaniesLoadedAt] = useState(0);
  const [search, setSearch] = useState("");
  const anchorRef = useRef(null);
  const menuRef = useRef(null);

  const businessId = currentCompany?._id ||
    (typeof currentUser?.company === "string" ? currentUser.company : currentUser?.company?._id) || "";

  const isSystemAdmin = Boolean(currentUser?.isSystemAdmin || currentUser?.superAdminAccess);
  const isDemoUser = Boolean(currentUser?.isDemoUser);
  const userName = [currentUser?.surname, currentUser?.otherNames].filter(Boolean).join(" ") || "Milik User";
  const companyName = currentCompany?.companyName || currentUser?.company?.companyName || "No active company";
  const companyLogo = currentCompany?.logo || currentUser?.company?.logo || "";
  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);
  const operatingModeLabel = getCompanyOperatingModeLabel(activeCompanyContext?.companyMode);
  const isHeaderVariant = variant === "header";

  useEffect(() => {
    const onDown = (e) => {
      if (!open) return;
      const a = anchorRef.current;
      const m = menuRef.current;
      if (m && m.contains(e.target)) return;
      if (a && a.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setShowSwitchModal(false);
      }
    };
    if (open || showSwitchModal) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, showSwitchModal]);

  const primary = useMemo(() => {
    if (!activeCompanyContext) return [];
    return moduleRegistry
      .map((item) => {
        if (item.id !== "milik") return item;
        return {
          ...item,
          label: isLandlordMode ? "MILIK Landlord Workspace" : item.label,
        };
      })
      .filter((item) => {
        // Accounts entry is visible to any company with a GL-posting module enabled,
        // not just companies with the dedicated "accounts" module.
        if (item.id === "accounts") {
          return hasAnyCompanyModule(activeCompanyContext, GL_ACCESS_MODULES);
        }
        return hasCompanyModule(activeCompanyContext, item.moduleKey);
      });
  }, [activeCompanyContext, isLandlordMode]);

  const secondaryTop = useMemo(() => [], []);

  const openSwitchCompany = async ({ forceRefresh = false } = {}) => {
    setSearch("");
    setShowSwitchModal(true);

    const cacheIsFresh = companies.length > 0 && Date.now() - companiesLoadedAt < 60 * 1000;
    if (!forceRefresh && cacheIsFresh) {
      return;
    }

    setLoadingCompanies(true);
    try {
      const items = await getAccessibleCompanies({ forceRefresh });
      setCompanies(Array.isArray(items) ? items : []);
      setCompaniesLoadedAt(Date.now());
    } catch (error) {
      console.error("Failed to load accessible companies:", error);
      setCompanies([]);
      setCompaniesLoadedAt(0);
      toast.error(error?.response?.data?.message || error?.message || "Failed to load companies");
    } finally {
      setLoadingCompanies(false);
    }
  };

  const secondaryBottom = useMemo(() => {
    const items = [
      {
        label: "Company Setup",
        icon: <FaBuilding />,
        onClick: () => {
          setOpen(false);
          navigate("/company-setup");
        },
      },
      {
        label: "Operational Settings",
        icon: <FaCog />,
        onClick: () => {
          setOpen(false);
          navigate("/settings");
        },
      },
    ];

    if (isSystemAdmin) {
      items.push({
        label: "System Administration",
        icon: <FaUserShield />,
        onClick: () => {
          setOpen(false);
          navigate("/system-setup");
        },
      });
    }

    items.push({
      label: "Switch Active Company",
      icon: <FaBuilding />,
      onClick: async (e) => {
        e?.preventDefault?.();
        await openSwitchCompany();
      },
    });

    return items;
  }, [isSystemAdmin, navigate]);

  const filteredCompanies = useMemo(() => {
    const activeCompanyId = String(currentCompany?._id || currentUser?.company?._id || "");
    const visibleCompanies = (isDemoUser
      ? companies
      : companies.filter((company) => !company?.isDemoWorkspace)
    ).slice();

    visibleCompanies.sort((a, b) => {
      const aActive = String(a?._id || "") === activeCompanyId ? 1 : 0;
      const bActive = String(b?._id || "") === activeCompanyId ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return String(a?.companyName || "").localeCompare(String(b?.companyName || ""));
    });

    const term = search.trim().toLowerCase();
    if (!term) return visibleCompanies;

    return visibleCompanies.filter((company) =>
      [company?.companyName, company?.companyCode, company?.town, company?.country]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [companies, currentCompany?._id, currentUser?.company?._id, isDemoUser, search]);

  const onSignOut = () => {
    clearClientSessionStorage();
    setOpen(false);
    window.location.replace("/login");
  };

  const handlePrimaryModuleClick = (item) => {
    setOpen(false);

    if (item?.status === "active" && item?.to) {
      const recent = JSON.parse(localStorage.getItem("recentModules") || "[]");
      const updated = [item.id, ...recent.filter((id) => id !== item.id)].slice(0, 5);
      localStorage.setItem("recentModules", JSON.stringify(updated));
      navigate(item.to);
      return;
    }

    toast.info(`${item?.label || "This module"} is enabled for this company but its workspace is not yet live.`);
  };

  const handleSwitchCompany = async (company) => {
    if (!company?._id) return;

    const activeCompanyId = String(currentCompany?._id || currentUser?.company?._id || "");
    if (String(company._id) === activeCompanyId) {
      setShowSwitchModal(false);
      setOpen(false);
      navigate("/moduleDashboard", { replace: true });
      return;
    }

    if (isCompanySwitching) return;

    setSwitchLoading(true);
    try {
      await dispatch(switchCompany(company._id));
      setShowSwitchModal(false);
      setOpen(false);
      navigate("/moduleDashboard", { replace: true });
    } catch (error) {
      console.error("Failed to switch company:", error);
      toast.error(error?.response?.data?.message || error?.message || "Failed to switch company");
    } finally {
      setSwitchLoading(false);
    }
  };

  const isBusySwitching = switchLoading || isCompanySwitching;

  return (
    <>
      <div className={isHeaderVariant ? "relative z-[120] flex min-h-[34px] items-center border-r border-white/10" : "fixed bottom-4 left-1/2 z-[120] -translate-x-1/2 sm:bottom-12"}>
        <button
          ref={anchorRef}
          onClick={() => setOpen((v) => !v)}
          className={[
            isHeaderVariant
              ? "group relative flex h-full items-center gap-2 border-0 border-r border-white/10 px-2.5 py-1 text-white transition hover:bg-white/10"
              : "group relative flex items-center gap-2 rounded-2xl border px-4 py-2 shadow-lg",
            "backdrop-blur-xl transition active:scale-[0.98]",
            isHeaderVariant
              ? "bg-transparent text-white"
              : darkMode
                ? "border-white/20 bg-white/25 text-white"
                : "border-emerald-100 bg-white/85 text-slate-900",
          ].join(" " )}
          aria-label="Open Start Menu"
        >
          <span className={isHeaderVariant ? "flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 text-white text-xs" : "flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white shadow-inner"}>
            <FaThLarge />
          </span>
          <span className={isHeaderVariant ? "hidden text-xs font-extrabold tracking-wide sm:inline" : "text-sm font-extrabold tracking-wide"}>MENU</span>
          <span className="absolute -inset-1 rounded-3xl bg-white/10 opacity-0 transition group-hover:opacity-100" />
        </button>

        {open && (
          <div ref={menuRef} className={isHeaderVariant ? "absolute left-0 top-full w-[94vw] max-w-[720px]" : "absolute bottom-[60px] left-1/2 w-[94vw] max-w-[720px] -translate-x-1/2"}>
            <div
              className={[
                "overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-2xl",
                darkMode ? "border-white/15 bg-black/30" : "border-white/40 bg-white/80",
              ].join(" ")}
            >
              <div className="flex items-center justify-between bg-gradient-to-r from-[#0A400C] via-[#0f766e] to-[#0A400C] px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/20 bg-white/15 text-white shadow-inner">
                    {companyLogo ? (
                      <img src={companyLogo} alt={companyName} className="h-full w-full object-contain p-1.5" />
                    ) : (
                      <span className="font-extrabold">{initialsFromName(companyName)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-white font-extrabold">{companyName}</div>
                    <div className="truncate text-xs text-white/80">{operatingModeLabel}</div>
                    <div className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">{userName}</div>
                  </div>
                </div>

                <button
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[76vh] overflow-y-auto"><div className="grid grid-cols-1 md:grid-cols-[1fr_220px]">
                <div className={["p-4", darkMode ? "bg-white/5" : "bg-white/40"].join(" ")}>
                  <div className={darkMode ? "mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/75" : "mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600"}>Modules</div>

                  {primary.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {primary.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handlePrimaryModuleClick(item)}
                          className={[
                            "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                            darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                          ].join(" ")}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white">
                            {item.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{item.label}</div>
                            
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={[
                      "rounded-2xl border px-4 py-4 text-sm",
                      darkMode ? "border-white/10 bg-white/5 text-white/80" : "border-slate-200 bg-slate-50 text-slate-600",
                    ].join(" ")}>
                      No active modules are currently enabled for this company.
                    </div>
                  )}

                  <div className="mt-4 h-px bg-black/10" />

                  <div className={darkMode ? "mt-4 mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/75" : "mt-4 mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600"}>Configuration</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {secondaryBottom.map((item) => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className={[
                          "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition",
                          darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                        ].join(" ")}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900/90 text-white">{item.icon}</span>
                        <span className="text-xs font-bold">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={["p-4", darkMode ? "bg-black/10" : "bg-white/55"].join(" ")}>
                  <div className={darkMode ? "mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-white/75" : "mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600"}>Account</div>
                  <div className="space-y-2">
                    <button
                      onClick={() => { setOpen(false); navigate("/my-account"); }}
                      className={[
                        "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition",
                        darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                      ].join(" ")}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900/90 text-white"><FaUserCircle /></span>
                      <div className="text-sm font-semibold">My Account</div>
                    </button>

                    <button
                      onClick={onSignOut}
                      className={[
                        "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition",
                        darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                      ].join(" ")}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600/90 text-white"><FaSignOutAlt /></span>
                      <div className="text-sm font-semibold">Sign Out</div>
                    </button>

                    <div className={["h-px my-1", darkMode ? "bg-white/10" : "bg-slate-200"].join(" ")} />

                    <button
                      onClick={() => { setOpen(false); navigate("/communications/sms"); }}
                      className={[
                        "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition",
                        darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                      ].join(" ")}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600/90 text-white"><FaSms /></span>
                      <div className="text-sm font-semibold">SMS Manager</div>
                    </button>

                    <button
                      onClick={() => { setOpen(false); navigate("/communications/email"); }}
                      className={[
                        "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 transition",
                        darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                      ].join(" ")}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/90 text-white"><FaEnvelope /></span>
                      <div className="text-sm font-semibold">Email Manager</div>
                    </button>
                  </div>
                </div>
              </div>

              </div>

              {!isHeaderVariant ? (
                <div className="relative">
                  <div className="absolute left-1/2 -bottom-2 h-4 w-4 -translate-x-1/2 rotate-45 border border-white/30 bg-white/70 backdrop-blur-xl" />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {showSwitchModal && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setShowSwitchModal(false); }}>
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10">

            {/* Header */}
            <div className="flex-shrink-0 bg-[#0B3B2E] px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Workspace</div>
                  <div className="mt-0.5 text-base font-black text-white">Switch Company</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80">
                    {filteredCompanies.length} of {companies.filter((c) => isDemoUser || !c?.isDemoWorkspace).length}
                  </span>
                  <button
                    onClick={() => openSwitchCompany({ forceRefresh: true })}
                    disabled={loadingCompanies}
                    title="Refresh list"
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition disabled:opacity-40"
                  >
                    <svg className={`h-3 w-3 ${loadingCompanies ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  </button>
                  <button
                    onClick={() => setShowSwitchModal(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                <FaSearch className="shrink-0 text-[11px] text-white/50" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, code, town or country…"
                  className="w-full bg-transparent text-xs text-white placeholder-white/40 outline-none"
                  autoFocus
                />
                {search && (
                  <button onClick={() => setSearch("")} className="shrink-0 text-white/50 hover:text-white transition">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            </div>

            {/* Company list */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingCompanies ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600" />
                  <span className="text-xs text-slate-400">Loading companies…</span>
                </div>
              ) : filteredCompanies.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16">
                  <FaBuilding className="text-2xl text-slate-200" />
                  <div className="text-sm font-semibold text-slate-400">No companies found</div>
                  {search && <div className="text-xs text-slate-400">Try a different search term</div>}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {filteredCompanies.map((company) => {
                    const active = String(company?._id) === String(currentCompany?._id || currentUser?.company?._id || "");
                    const isLocked = Boolean(company?.locked);
                    const isClickable = !isBusySwitching && !isLocked;
                    const moduleCount = Array.isArray(company?.enabledModules) ? company.enabledModules.length : 0;

                    return (
                      <button
                        key={company._id}
                        onClick={() => isClickable && handleSwitchCompany(company)}
                        disabled={!isClickable}
                        className={[
                          "group w-full px-5 py-3.5 text-left transition",
                          active ? "bg-emerald-50" : isLocked ? "cursor-not-allowed opacity-60 bg-slate-50" : "hover:bg-slate-50 cursor-pointer",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div className={`relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border text-sm font-black shadow-sm ${active ? "border-emerald-300 bg-emerald-700 text-white" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
                            {company?.logo ? (
                              <img src={company.logo} alt={company.companyName} className="h-full w-full object-contain p-1" />
                            ) : (
                              <span>{initialsFromName(company?.companyName)}</span>
                            )}
                            {isLocked && (
                              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/60">
                                <FaLock className="text-[10px] text-white" />
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`truncate text-sm font-bold ${active ? "text-emerald-800" : "text-slate-900"}`}>
                                {company?.companyName}
                              </span>
                              {active && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                  <FaCheckCircle className="text-[8px]" /> Active
                                </span>
                              )}
                              {isLocked && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-700">
                                  <FaLock className="text-[8px]" /> Locked
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-400">
                              {[company?.companyCode, company?.town, company?.country].filter(Boolean).join(" · ") || "—"}
                            </div>
                            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">
                                {getCompanyOperatingModeLabel(company?.companyMode)}
                              </span>
                              {moduleCount > 0 && (
                                <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                  {moduleCount} module{moduleCount !== 1 ? "s" : ""}
                                </span>
                              )}
                              {company?.isDemoWorkspace && (
                                <span className="inline-flex items-center rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">Demo</span>
                              )}
                            </div>
                          </div>

                          {/* Chevron */}
                          {!isLocked && (
                            <FaChevronRight className={`shrink-0 text-[11px] transition ${active ? "text-emerald-500" : "text-slate-300 group-hover:text-slate-500"}`} />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50 px-5 py-2.5">
              <div className="text-[11px] text-slate-400">
                Currently in <span className="font-bold text-slate-600">{companyName}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StartMenu;
