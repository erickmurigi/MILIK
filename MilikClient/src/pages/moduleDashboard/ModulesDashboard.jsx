// pages/ModulesDashboard/ModulesDashboard.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { selectCurrentUser, selectCurrentCompany } from "../../redux/selectors";
import {
  FaChartLine,
  FaWarehouse,
  FaUsers,
  FaShieldAlt,
  FaHandshake,
  FaStore,
  FaArrowRight,
  FaLock,
  FaCar,
  FaBuilding,
  FaSearch,
  FaCity,
} from "react-icons/fa";
import { toast } from "react-toastify";
import {
  getCompanyOperatingModeLabel,
  hasCompanyModule,
  isSelfManagingLandlordCompany,
} from "../../utils/companyModules";
import StartMenu from "../../components/StartMenu/StartMenu";
import "./ModulesDashboard.css";

const CATEGORIES = ["All", "Core", "Finance", "Sales", "Operations", "People"];

const moduleRegistry = [
  {
    id: "milik",
    moduleKey: "propertyManagement",
    title: "MILIK",
    subtitle: "Property Management",
    status: "active",
    route: "/dashboard",
    icon: FaCity,
    color: "#0b3b2e",
    category: "Core",
  },
  {
    id: "accounts",
    moduleKey: "accounts",
    title: "Accounting",
    subtitle: "Finance & Reporting",
    status: "active",
    route: "/accounts/dashboard",
    icon: FaChartLine,
    color: "#b45309",
    category: "Finance",
  },
  {
    id: "inventory",
    moduleKey: "inventory",
    title: "Inventory",
    subtitle: "Stock & Warehousing",
    status: "active",
    route: "/inventory/dashboard",
    icon: FaWarehouse,
    color: "#0e7490",
    category: "Operations",
  },
  {
    id: "propertySale",
    moduleKey: "propertySale",
    title: "Property Sales",
    subtitle: "Listings & Deals",
    status: "active",
    route: "/sale/dashboard",
    icon: FaBuilding,
    color: "#0f766e",
    category: "Sales",
  },
  {
    id: "security",
    moduleKey: "securityServices",
    title: "Security",
    subtitle: "Access & Monitoring",
    status: "coming",
    icon: FaShieldAlt,
    color: "#374151",
    category: "Operations",
  },
  {
    id: "pos",
    moduleKey: "pos",
    title: "POS & Billing",
    subtitle: "Point of Sale",
    status: "coming",
    icon: FaStore,
    color: "#c2410c",
    category: "Sales",
  },
  {
    id: "carwash",
    moduleKey: "carwash",
    title: "Car Wash",
    subtitle: "Wash Jobs & Staff",
    status: "active",
    route: "/carwash/dashboard",
    icon: FaCar,
    color: "#0369a1",
    category: "Operations",
  },
  {
    id: "hr",
    moduleKey: "hr",
    title: "Human Resource",
    subtitle: "People & Payroll",
    status: "active",
    route: "/hr/dashboard",
    icon: FaUsers,
    color: "#7c3aed",
    category: "People",
  },
  {
    id: "vendoor",
    moduleKey: "procurement",
    title: "Ven-Door",
    subtitle: "Vendor Management",
    status: "coming",
    icon: FaHandshake,
    color: "#1d4ed8",
    category: "Operations",
  },
];

const ModulesDashboard = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const isFetchingCompany = useSelector((state) => state.company?.isFetching || false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);
  const operatingModeLabel = getCompanyOperatingModeLabel(activeCompanyContext?.companyMode);

  useEffect(() => {
    const name = String(activeCompanyContext?.companyName || activeCompanyContext?.name || "").trim();
    document.title = name ? `Apps | ${name} | Milik` : "Apps | Milik";
  }, [activeCompanyContext]);

  const visibleModules = useMemo(() => {
    if (!activeCompanyContext) return [];
    return moduleRegistry
      .map((m) => {
        if (m.id !== "milik") return m;
        return {
          ...m,
          subtitle: isLandlordMode ? "Landlord Workspace" : m.subtitle,
        };
      })
      .filter((m) => hasCompanyModule(activeCompanyContext, m.moduleKey));
  }, [activeCompanyContext, isLandlordMode]);

  const filteredModules = useMemo(() => {
    let list = visibleModules;
    if (activeCategory !== "All") list = list.filter((m) => m.category === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((m) => m.title.toLowerCase().includes(q) || m.subtitle.toLowerCase().includes(q) || m.category.toLowerCase().includes(q));
    return list;
  }, [visibleModules, activeCategory, search]);

  // only show categories that have at least one visible module
  const availableCategories = useMemo(() => {
    const cats = new Set(visibleModules.map((m) => m.category));
    return CATEGORIES.filter((c) => c === "All" || cats.has(c));
  }, [visibleModules]);

  const handleOpen = useCallback((m) => {
    if (m.status === "active" && m.route) {
      const recent = JSON.parse(localStorage.getItem("recentModules") || "[]");
      localStorage.setItem("recentModules", JSON.stringify([m.id, ...recent.filter((id) => id !== m.id)].slice(0, 5)));
      navigate(m.route);
      return;
    }
    if (m.status === "coming") {
      toast.info(`${m.title} is coming soon for this company.`);
      return;
    }
    toast.warning(`${m.title} is currently unavailable.`);
  }, [navigate]);

  return (
    <div className="odoo-page">
      {/* ── Subtle ambient layer ── */}
      <div className="odoo-bg" aria-hidden="true">
        <div className="odoo-orb odoo-orb-a" />
        <div className="odoo-orb odoo-orb-b" />
      </div>

      {/* ── Top bar ── */}
      <header className="odoo-topbar">
        <div className="odoo-topbar-left">
          <img
            src={activeCompanyContext?.logo || "/MILIK CUBES.png"}
            alt={activeCompanyContext?.companyName || "Milik"}
            className="odoo-topbar-logo"
          />
          <div className="odoo-topbar-company">
            <span className="odoo-topbar-name">{activeCompanyContext?.companyName || "Milik"}</span>
            {operatingModeLabel && <span className="odoo-topbar-mode">{operatingModeLabel}</span>}
          </div>
        </div>
        <div className="odoo-topbar-search">
          <FaSearch className="odoo-search-ico" size={13} />
          <input
            className="odoo-search-input"
            type="text"
            placeholder="Search apps…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setActiveCategory("All"); }}
          />
        </div>
      </header>

      {/* ── Category tab strip ── */}
      <div className="odoo-tabs-bar">
        <div className="odoo-tabs">
          {availableCategories.map((cat) => (
            <button
              key={cat}
              className={`odoo-tab ${activeCategory === cat ? "odoo-tab-active" : ""}`}
              onClick={() => { setActiveCategory(cat); setSearch(""); }}
            >
              {cat}
              {cat !== "All" && (
                <span className="odoo-tab-count">
                  {visibleModules.filter((m) => m.category === cat).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── App grid ── */}
      <main className="odoo-main">
        {isFetchingCompany && filteredModules.length === 0 ? (
          <div className="odoo-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="odoo-tile odoo-tile-skeleton" aria-hidden="true">
                <div className="odoo-icon-panel odoo-skeleton-block" />
                <div className="odoo-tile-body">
                  <div className="odoo-skeleton-line odoo-skeleton-line-title" />
                  <div className="odoo-skeleton-line odoo-skeleton-line-sub" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredModules.length > 0 ? (
          <div className="odoo-grid">
            {filteredModules.map((m, i) => (
              <button
                key={m.id}
                className={`odoo-tile ${m.status === "coming" ? "odoo-tile-soon" : ""}`}
                style={{ animationDelay: `${i * 55}ms` }}
                onClick={() => handleOpen(m)}
                aria-label={`${m.title} — ${m.subtitle}`}
              >
                {/* Status dot */}
                <span className={`odoo-dot ${m.status === "active" ? "odoo-dot-live" : "odoo-dot-soon"}`} title={m.status === "active" ? "Live" : "Coming soon"} />

                {/* Icon panel — top half of card */}
                <div className="odoo-icon-panel" style={{ background: m.color }}>
                  {m.icon ? (
                    <span className="odoo-icon"><m.icon /></span>
                  ) : (
                    <img src="/logo.png" alt="Milik" className="odoo-logo-img" />
                  )}
                </div>

                {/* Text panel — bottom half */}
                <div className="odoo-tile-body">
                  <div className="odoo-tile-name">{m.title}</div>
                  <div className="odoo-tile-sub">{m.subtitle}</div>
                </div>

                {/* Hover overlay — "Open" button */}
                <div className="odoo-hover-overlay">
                  <span className="odoo-open-btn">
                    {m.status === "active" ? "Open" : "Coming soon"}
                    {m.status === "active" && <FaArrowRight size={11} />}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="odoo-empty">
            <div className="odoo-empty-ico"><FaLock /></div>
            <p className="odoo-empty-title">{search ? "No apps match your search" : "No modules available"}</p>
            <p className="odoo-empty-sub">{search ? "Try searching something else" : "No business modules are assigned to this company."}</p>
          </div>
        )}
      </main>

      <StartMenu darkMode={false} />
    </div>
  );
};

export default ModulesDashboard;
