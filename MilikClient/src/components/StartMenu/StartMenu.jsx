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
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { clearClientSessionStorage } from "../../utils/sessionCleanup";
import { getAccessibleCompanies, switchCompany } from "../../redux/apiCalls";
import { getCompanyOperatingModeLabel, hasCompanyModule, isSelfManagingLandlordCompany } from "../../utils/companyModules";

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
    to: "/financial/chart-of-accounts",
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
    id: "hr",
    moduleKey: "hr",
    label: "Human Resource",
    icon: <FaUsers />,
    status: "coming",
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
      .filter((item) => hasCompanyModule(activeCompanyContext, item.moduleKey));
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
                      onClick={() => toast.info("My Account is coming soon")}
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
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-[#0A400C] via-[#16A34A] to-[#F97316] px-6 py-4 text-white">
              <div>
                <div className="text-lg font-extrabold">Switch Active Company</div>
              </div>
              <button onClick={() => setShowSwitchModal(false)} className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold hover:bg-white/10">Close</button>
            </div>

            <div className="overflow-y-auto p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <FaSearch className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search company by name, code, town or country"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>

              <div className="max-h-[56vh] overflow-y-auto rounded-2xl border border-slate-200">
                {loadingCompanies ? (
                  <div className="p-6 text-sm text-slate-500">Loading companies...</div>
                ) : filteredCompanies.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No companies available for this user.</div>
                ) : (
                  filteredCompanies.map((company) => {
                    const active = String(company?._id) === String(currentCompany?._id || currentUser?.company?._id || "");
                    return (
                      <button
                        key={company._id}
                        onClick={() => handleSwitchCompany(company)}
                        disabled={isBusySwitching}
                        className={`w-full border-b border-slate-200 px-4 py-4 text-left transition last:border-b-0 disabled:opacity-60 ${
                          active ? "bg-emerald-50/70" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                              {company?.logo ? (
                                <img src={company.logo} alt={company.companyName} className="h-full w-full object-contain p-1.5" />
                              ) : (
                                <span className="font-bold text-slate-700">{initialsFromName(company?.companyName)}</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-bold text-slate-900">{company?.companyName}</div>
                              <div className="truncate text-xs text-slate-500">{[company?.companyCode, company?.town, company?.country].filter(Boolean).join(" • ") || "Company workspace"}</div>
                              <div className="mt-1 inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
                                {getCompanyOperatingModeLabel(company?.companyMode)}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            {active ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><FaCheckCircle /> Active</span> : null}
                            <FaChevronRight className="text-slate-400" />
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StartMenu;
