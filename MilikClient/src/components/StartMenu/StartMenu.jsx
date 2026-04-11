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
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { clearClientSessionStorage } from "../../utils/sessionCleanup";
import { getAccessibleCompanies, switchCompany } from "../../redux/apiCalls";
import { hasCompanyModule } from "../../utils/companyModules";

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
    label: "Milik Property Management System",
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
    id: "dms",
    moduleKey: "dms",
    label: "Document Management",
    icon: <FaFolderOpen />,
    status: "coming",
  },
];

const StartMenu = ({ darkMode = false }) => {
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
    return moduleRegistry.filter((item) => hasCompanyModule(activeCompanyContext, item.moduleKey));
  }, [activeCompanyContext]);

  const secondaryTop = useMemo(
    () => [
      { label: "SMS Manager", icon: <FaSms />, onClick: () => toast.info("SMS Manager is coming soon") },
      { label: "Email Manager", icon: <FaEnvelope />, onClick: () => toast.info("Email Manager is coming soon") },
      { label: "Sticky Notes", icon: <FaStickyNote />, onClick: () => toast.info("Sticky Notes are coming soon") },
      { label: "Calculator", icon: <FaCalculator />, onClick: () => window.open("https://www.google.com/search?q=calculator", "_blank", "noopener,noreferrer") },
      { label: "Help", icon: <FaQuestionCircle />, onClick: () => toast.info("Help is coming soon") },
    ],
    []
  );

  const openSwitchCompany = async ({ forceRefresh = false } = {}) => {
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
    ];

    if (isSystemAdmin) {
      items.push({
        label: "System Admin",
        icon: <FaUserShield />,
        onClick: () => {
          setOpen(false);
          navigate("/system-setup");
        },
      });
    }

    items.push({
      label: "Switch Company",
      icon: <FaBuilding />,
      onClick: async (e) => {
        e?.preventDefault?.();
        await openSwitchCompany();
      },
    });

    return items;
  }, [isSystemAdmin, navigate]);

  const filteredCompanies = useMemo(() => {
    const visibleCompanies = isDemoUser
      ? companies
      : companies.filter((company) => !company?.isDemoWorkspace);

    const term = search.trim().toLowerCase();
    if (!term) return visibleCompanies;

    return visibleCompanies.filter((company) =>
      [company?.companyName, company?.companyCode, company?.town, company?.country]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }, [companies, isDemoUser, search]);

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
      <div className="fixed bottom-12 left-1/2 z-[120] -translate-x-1/2">
        <button
          ref={anchorRef}
          onClick={() => setOpen((v) => !v)}
          className={[
            "group relative flex items-center gap-2 rounded-2xl border px-4 py-2 shadow-lg",
            "backdrop-blur-xl transition active:scale-[0.98]",
            darkMode
              ? "border-white/20 bg-white/25 text-white"
              : "border-emerald-100 bg-white/85 text-slate-900",
          ].join(" ")}
          aria-label="Open Start Menu"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white shadow-inner">
            <FaThLarge />
          </span>
          <span className="text-sm font-extrabold tracking-wide">MENU</span>
          <span className="absolute -inset-1 rounded-3xl bg-white/10 opacity-0 transition group-hover:opacity-100" />
        </button>

        {open && (
          <div ref={menuRef} className="absolute bottom-[60px] left-1/2 w-[92vw] max-w-[860px] -translate-x-1/2">
            <div
              className={[
                "overflow-hidden rounded-3xl border shadow-2xl backdrop-blur-2xl",
                darkMode ? "border-white/15 bg-black/30" : "border-white/40 bg-white/80",
              ].join(" ")}
            >
              <div className="flex items-center justify-between bg-gradient-to-r from-[#0A400C] via-[#0f766e] to-[#F97316] px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/15 text-white shadow-inner">
                    {companyLogo ? (
                      <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-extrabold">{initialsFromName(companyName)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-white font-extrabold">{userName}</div>
                    <div className="truncate text-xs text-white/80">{companyName}</div>
                  </div>
                </div>

                <button
                  onClick={() => setOpen(false)}
                  className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3">
                <div className={["p-4 md:col-span-2", darkMode ? "bg-white/5" : "bg-white/40"].join(" ")}>
                  <div className={darkMode ? "mb-3 text-xs font-bold text-white/80" : "mb-3 text-xs font-bold text-slate-700"}>
                    MODULES
                  </div>

                  {primary.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {primary.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handlePrimaryModuleClick(item)}
                          className={[
                            "flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition",
                            darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                          ].join(" ")}
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white">
                            {item.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{item.label}</div>
                            <div className={darkMode ? "text-[11px] text-white/60" : "text-[11px] text-slate-500"}>
                              {item.status === "active" ? "Live workspace" : "Enabled for company"}
                            </div>
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

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {secondaryBottom.map((item) => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className={[
                          "flex items-center gap-2 rounded-2xl border px-3 py-3 text-left transition",
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
                  <div className={darkMode ? "mb-3 text-xs font-bold text-white/80" : "mb-3 text-xs font-bold text-slate-700"}>TOOLS</div>
                  <div className="space-y-2">
                    {secondaryTop.map((item) => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className={[
                          "w-full flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
                          darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                        ].join(" ")}
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white">{item.icon}</span>
                        <div className="text-sm font-semibold">{item.label}</div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 h-px bg-black/10" />

                  <div className="mt-4 space-y-2">
                    <button
                      onClick={() => toast.info("My Account is coming soon")}
                      className={[
                        "w-full flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
                        darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                      ].join(" ")}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900/90 text-white"><FaUserCircle /></span>
                      <div className="text-sm font-semibold">My Account</div>
                    </button>

                    <button
                      onClick={onSignOut}
                      className={[
                        "w-full flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
                        darkMode ? "border-white/10 text-white hover:bg-white/10" : "border-slate-200 text-slate-900 hover:bg-white",
                      ].join(" ")}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-600/90 text-white"><FaSignOutAlt /></span>
                      <div className="text-sm font-semibold">Sign Out</div>
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute left-1/2 -bottom-2 h-4 w-4 -translate-x-1/2 rotate-45 border border-white/30 bg-white/70 backdrop-blur-xl" />
              </div>
            </div>
          </div>
        )}
      </div>

      {showSwitchModal && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-r from-[#0A400C] via-[#16A34A] to-[#F97316] px-6 py-4 text-white">
              <div>
                <div className="text-lg font-extrabold">Switch Company</div>
                <div className="text-xs text-white/80">Choose the company context you want to work in.</div>
              </div>
              <button onClick={() => setShowSwitchModal(false)} className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold hover:bg-white/10">Close</button>
            </div>

            <div className="p-5">
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <FaSearch className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search company by name, code, town or country"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200">
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
                        className="w-full border-b border-slate-200 px-4 py-4 text-left transition last:border-b-0 hover:bg-emerald-50 disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-[#F97316] to-[#16A34A] font-bold text-white">
                              {company?.logo ? (
                                <img src={company.logo} alt={company.companyName} className="h-full w-full object-cover" />
                              ) : (
                                initialsFromName(company?.companyName)
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-bold text-slate-900">{company?.companyName}</div>
                              <div className="truncate text-xs text-slate-500">{[company?.companyCode, company?.town, company?.country].filter(Boolean).join(" • ") || "Company workspace"}</div>
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
