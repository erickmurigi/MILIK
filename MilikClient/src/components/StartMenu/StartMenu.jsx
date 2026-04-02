import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FaHome,
  FaKey,
  FaBoxes,
  FaUsers,
  FaFolderOpen,
  FaCogs,
  FaExchangeAlt,
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
} from "react-icons/fa";
import { Link, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
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

  const activeCompanyContext = currentCompany || currentUser?.company || null;

  const primary = useMemo(() => {
    const items = [
      hasCompanyModule(activeCompanyContext, "propertyManagement")
        ? { label: "Milik Property Management System", icon: <FaHome />, to: "/dashboard" }
        : null,
      hasCompanyModule(activeCompanyContext, "accounts")
        ? { label: "Financial Accounts", icon: <FaUsers />, to: "/financial/chart-of-accounts" }
        : null,
      hasCompanyModule(activeCompanyContext, "procurement")
        ? { label: "Ven-Door", icon: <FaKey />, to: "/vendors" }
        : null,
      hasCompanyModule(activeCompanyContext, "inventory")
        ? { label: "Inventory Management", icon: <FaBoxes />, to: "/inventory" }
        : null,
      hasCompanyModule(activeCompanyContext, "dms")
        ? { label: "Document Management", icon: <FaFolderOpen />, to: "/documents" }
        : null,
    ].filter(Boolean);

    return items.length > 0 ? items : [{ label: "Milik Property Management System", icon: <FaHome />, to: "/dashboard" }];
  }, [activeCompanyContext]);

  const secondaryTop = useMemo(
    () => [
      { label: "SMS Manager", icon: <FaSms />, onClick: () => alert("SMS Manager coming soon") },
      { label: "Email Manager", icon: <FaEnvelope />, onClick: () => alert("Email Manager coming soon") },
      { label: "Sticky Notes", icon: <FaStickyNote />, onClick: () => alert("Sticky Notes coming soon") },
      { label: "Calculator", icon: <FaCalculator />, onClick: () => window.open("https://www.google.com/search?q=calculator", "_blank") },
      { label: "Help", icon: <FaQuestionCircle />, onClick: () => alert("Help coming soon") },
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
    } finally {
      setLoadingCompanies(false);
    }
  };

  const secondaryBottom = useMemo(() => {
    const items = [
      {
        label: "Company Setup",
        to: "/company-setup",
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
        to: "/system-setup",
        icon: <FaUserShield />,
        onClick: () => {
          setOpen(false);
          navigate("/system-setup");
        },
      });
    }

    items.push({
      label: "Switch Company",
      icon: <FaExchangeAlt />,
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

  const handleSwitchCompany = async (company) => {
    if (!company?._id) return;

    const activeCompanyId = String(currentCompany?._id || currentUser?.company?._id || "");
    if (String(company._id) === activeCompanyId) {
      setShowSwitchModal(false);
      setOpen(false);
      return;
    }

    if (isCompanySwitching) return;

    setSwitchLoading(true);
    try {
      await dispatch(switchCompany(company._id));
      setShowSwitchModal(false);
      setOpen(false);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      console.error("Failed to switch company:", error);
      alert(error?.response?.data?.message || error?.message || "Failed to switch company");
    } finally {
      setSwitchLoading(false);
    }
  };

  const isBusySwitching = switchLoading || isCompanySwitching;

  return (
    <>
      <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[120]">
        <button
          ref={anchorRef}
          onClick={() => setOpen((v) => !v)}
          className={[
            "group relative flex items-center gap-2 rounded-2xl px-4 py-2 shadow-lg border",
            "backdrop-blur-xl transition active:scale-[0.98]",
            darkMode
              ? "bg-white/25 border-white/20 text-white"
              : "bg-white/85 border-emerald-100 text-slate-900",
          ].join(" ")}
          aria-label="Open Start Menu"
        >
          <span className="h-10 w-10 rounded-2xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white flex items-center justify-center shadow-inner">
            <FaThLarge />
          </span>
          <span className="text-sm font-extrabold tracking-wide">MENU</span>
          <span className="absolute -inset-1 rounded-3xl opacity-0 group-hover:opacity-100 transition bg-white/10" />
        </button>

        {open && (
          <div ref={menuRef} className="absolute left-1/2 -translate-x-1/2 bottom-[60px] w-[92vw] max-w-[860px]">
            <div
              className={[
                "rounded-3xl border shadow-2xl overflow-hidden",
                "backdrop-blur-2xl",
                darkMode ? "border-white/15 bg-black/30" : "border-white/40 bg-white/80",
              ].join(" ")}
            >
              <div className="px-5 py-4 flex items-center justify-between bg-gradient-to-r from-[#0A400C] via-[#0f766e] to-[#F97316]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-12 w-12 rounded-2xl bg-white/15 border border-white/20 text-white overflow-hidden flex items-center justify-center shadow-inner">
                    {companyLogo ? (
                      <img src={companyLogo} alt={companyName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-extrabold">{initialsFromName(companyName)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-extrabold truncate">{userName}</div>
                    <div className="text-white/80 text-xs truncate">{companyName}</div>
                  </div>
                </div>

                <button
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-3 py-2 text-xs font-semibold border border-white/20 text-white hover:bg-white/10 transition"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3">
                <div className={["md:col-span-2 p-4", darkMode ? "bg-white/5" : "bg-white/40"].join(" ")}>
                  <div className={darkMode ? "text-white/80 text-xs font-bold mb-3" : "text-slate-700 text-xs font-bold mb-3"}>MODULES</div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {primary.map((item) => (
                      <Link
                        key={item.label}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className={[
                          "flex items-center gap-3 rounded-2xl px-3 py-3 border transition",
                          darkMode ? "border-white/10 hover:bg-white/10 text-white" : "border-slate-200 hover:bg-white text-slate-900",
                        ].join(" ")}
                      >
                        <span className="h-10 w-10 rounded-2xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white flex items-center justify-center">
                          {item.icon}
                        </span>
                        <div className="text-sm font-semibold">{item.label}</div>
                      </Link>
                    ))}
                  </div>

                  <div className="mt-4 h-px bg-black/10" />

                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {secondaryBottom.map((item) => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className={[
                          "flex items-center gap-2 rounded-2xl px-3 py-3 border text-left transition",
                          darkMode ? "border-white/10 hover:bg-white/10 text-white" : "border-slate-200 hover:bg-white text-slate-900",
                        ].join(" ")}
                      >
                        <span className="h-9 w-9 rounded-2xl bg-slate-900/90 text-white flex items-center justify-center">{item.icon}</span>
                        <span className="text-xs font-bold">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={["p-4", darkMode ? "bg-black/10" : "bg-white/55"].join(" ")}>
                  <div className={darkMode ? "text-white/80 text-xs font-bold mb-3" : "text-slate-700 text-xs font-bold mb-3"}>TOOLS</div>
                  <div className="space-y-2">
                    {secondaryTop.map((item) => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className={[
                          "w-full flex items-center gap-3 rounded-2xl px-3 py-3 border transition",
                          darkMode ? "border-white/10 hover:bg-white/10 text-white" : "border-slate-200 hover:bg-white text-slate-900",
                        ].join(" ")}
                      >
                        <span className="h-10 w-10 rounded-2xl bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white flex items-center justify-center">{item.icon}</span>
                        <div className="text-sm font-semibold">{item.label}</div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 h-px bg-black/10" />

                  <div className="mt-4 space-y-2">
                    <button
                      onClick={() => alert("My Account coming soon")}
                      className={[
                        "w-full flex items-center gap-3 rounded-2xl px-3 py-3 border transition",
                        darkMode ? "border-white/10 hover:bg-white/10 text-white" : "border-slate-200 hover:bg-white text-slate-900",
                      ].join(" ")}
                    >
                      <span className="h-10 w-10 rounded-2xl bg-slate-900/90 text-white flex items-center justify-center"><FaUserCircle /></span>
                      <div className="text-sm font-semibold">My Account</div>
                    </button>

                    <button
                      onClick={onSignOut}
                      className={[
                        "w-full flex items-center gap-3 rounded-2xl px-3 py-3 border transition",
                        darkMode ? "border-white/10 hover:bg-white/10 text-white" : "border-slate-200 hover:bg-white text-slate-900",
                      ].join(" ")}
                    >
                      <span className="h-10 w-10 rounded-2xl bg-red-600/90 text-white flex items-center justify-center"><FaSignOutAlt /></span>
                      <div className="text-sm font-semibold">Sign Out</div>
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative">
                <div className="absolute left-1/2 -translate-x-1/2 -bottom-2 h-4 w-4 rotate-45 border border-white/30 bg-white/70 backdrop-blur-xl" />
              </div>
            </div>
          </div>
        )}
      </div>

      {showSwitchModal && (
        <div className="fixed inset-0 z-[140] bg-slate-950/35 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-2xl rounded-[28px] border border-emerald-100 bg-white shadow-2xl overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0A400C] via-[#16A34A] to-[#F97316] text-white flex items-center justify-between">
              <div>
                <div className="text-lg font-extrabold">Switch Company</div>
                <div className="text-xs text-white/80">Choose the company context you want to work in.</div>
              </div>
              <button onClick={() => setShowSwitchModal(false)} className="rounded-xl border border-white/20 px-3 py-2 text-xs font-semibold hover:bg-white/10">Close</button>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 mb-4">
                <FaSearch className="text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search company by name, code, town or country"
                  className="w-full bg-transparent outline-none text-sm"
                />
              </div>

              <div className="rounded-2xl border border-slate-200 overflow-hidden">
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
                        className="w-full flex items-center justify-between gap-4 px-4 py-4 border-b last:border-b-0 border-slate-200 hover:bg-emerald-50 text-left transition disabled:opacity-60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-12 w-12 rounded-2xl overflow-hidden bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white flex items-center justify-center font-bold shrink-0">
                            {company?.logo ? (
                              <img src={company.logo} alt={company.companyName} className="h-full w-full object-cover" />
                            ) : (
                              initialsFromName(company?.companyName)
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 truncate">{company?.companyName}</div>
                            <div className="text-xs text-slate-500 truncate">{[company?.companyCode, company?.town, company?.country].filter(Boolean).join(" • ") || "Company workspace"}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {active ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><FaCheckCircle /> Active</span> : null}
                          <FaChevronRight className="text-slate-400" />
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
