// pages/ModulesDashboard/ModulesDashboard.jsx
import React, { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  FaChartLine,
  FaWarehouse,
  FaUsers,
  FaShieldAlt,
  FaHandshake,
  FaStore,
  FaArrowRight,
  FaEnvelope,
  FaHome,
  FaLock,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getCompanyOperatingModeLabel, hasCompanyModule, isSelfManagingLandlordCompany } from "../../utils/companyModules";
import StartMenu from "../../components/StartMenu/StartMenu";
import "./ModulesDashboard.css";

const moduleRegistry = [
  {
    id: "milik",
    moduleKey: "propertyManagement",
    title: "MILIK",
    subtitle: "Milik Property Management System",
    description: "Launch Milik core workspace for properties, tenants, leases and rent operations.",
    status: "active",
    route: "/dashboard",
    icon: <img src="/logo.png" alt="Milik logo" className="h-9 w-9 object-contain milik-logo-mark" />,
    tint: "milik-icon-light",
  },
  {
    id: "accounts",
    moduleKey: "accounts",
    title: "Accounts & Finance",
    subtitle: "Financial management and accounting",
    description: "Track income, expenses, analytics and accounting operations with clear financial visibility.",
    status: "active",
    route: "/financial/chart-of-accounts",
    icon: <FaChartLine />,
    tint: "milik-icon-gold",
  },
  {
    id: "billing",
    moduleKey: "billing",
    title: "Billing",
    subtitle: "Invoice and billing workspace",
    description: "Prepare billing-focused workflows for future activation under the company module set.",
    status: "coming",
    icon: <FaEnvelope />,
    tint: "milik-icon-gold",
  },
  {
    id: "inventory",
    moduleKey: "inventory",
    title: "Inventory",
    subtitle: "Stock management and warehousing",
    description: "Monitor stock movement, automate replenishment and keep warehouse operations synchronized.",
    status: "coming",
    icon: <FaWarehouse />,
    tint: "milik-icon-cyan",
  },
  {
    id: "hr",
    moduleKey: "hr",
    title: "Human Resource",
    subtitle: "People and staffing operations",
    description: "Manage staffing, people administration and HR workflows once the workspace is enabled.",
    status: "coming",
    icon: <FaUsers />,
    tint: "milik-icon-teal",
  },
  {
    id: "security",
    moduleKey: "securityServices",
    title: "Security",
    subtitle: "Access control and monitoring",
    description: "Protect operations with role controls, security workflows and monitoring tools.",
    status: "coming",
    icon: <FaShieldAlt />,
    tint: "milik-icon-charcoal",
  },
  {
    id: "pos",
    moduleKey: "pos",
    title: "POS & Billing",
    subtitle: "Point of sale system",
    description: "Process payments, issue receipts and manage checkout operations with inventory sync.",
    status: "coming",
    icon: <FaStore />,
    tint: "milik-icon-orange",
  },
  {
    id: "vendoor",
    moduleKey: "procurement",
    title: "Ven-Door",
    subtitle: "Vendor management portal",
    description: "Centralize supplier workflows, purchase coordination and vendor performance.",
    status: "coming",
    icon: <FaHandshake />,
    tint: "milik-icon-indigo",
  },
];

const ModulesDashboard = () => {
  const navigate = useNavigate();
  const currentCompany = useSelector((state) => state.company?.currentCompany || null);
  const currentUser = useSelector((state) => state.auth?.currentUser || state.auth?.user || null);

  const activeCompanyContext = currentCompany || currentUser?.company || null;
  const isLandlordMode = isSelfManagingLandlordCompany(activeCompanyContext);
  const operatingModeLabel = getCompanyOperatingModeLabel(activeCompanyContext?.companyMode);

  useEffect(() => {
    const companyName = String(activeCompanyContext?.companyName || activeCompanyContext?.name || '').trim();
    document.title = companyName
      ? `Choose Module | ${companyName} | Milik`
      : 'Choose Module | Milik';
  }, [activeCompanyContext]);
  const visibleModules = useMemo(() => {
    if (!activeCompanyContext) return [];
    return moduleRegistry
      .map((moduleItem) => {
        if (moduleItem.id !== "milik") return moduleItem;
        return {
          ...moduleItem,
          subtitle: isLandlordMode ? "Self-managing landlord workspace" : moduleItem.subtitle,
          description: isLandlordMode
            ? "Launch a landlord-focused workspace for your own properties, tenants, receipts, expenses and reports."
            : moduleItem.description,
        };
      })
      .filter((moduleItem) => hasCompanyModule(activeCompanyContext, moduleItem.moduleKey));
  }, [activeCompanyContext, isLandlordMode]);

  const handleOpen = (moduleItem) => {
    if (moduleItem.status === "active" && moduleItem.route) {
      const recent = JSON.parse(localStorage.getItem("recentModules") || "[]");
      const updated = [moduleItem.id, ...recent.filter((id) => id !== moduleItem.id)].slice(0, 5);
      localStorage.setItem("recentModules", JSON.stringify(updated));
      navigate(moduleItem.route);
      return;
    }

    if (moduleItem.status === "coming") {
      toast.info(`${moduleItem.title} is enabled for this company and its workspace is coming soon.`);
      return;
    }

    toast.warning(`${moduleItem.title} is currently unavailable for your account.`);
  };

  const StatusPill = ({ status }) => {
    const base = "milik-status-pill";
    if (status === "active") return <span className={`${base} active`}>Live</span>;
    if (status === "coming") return <span className={`${base} coming`}>Soon</span>;
    return <span className={`${base} locked`}>Locked</span>;
  };

  const emptyState = !activeCompanyContext
    ? {
        title: "No active company selected",
        subtitle: "Switch to a company workspace first, then the enabled modules for that company will appear here.",
      }
    : {
        title: "No modules enabled",
        subtitle: "No business modules are currently assigned to this company.",
      };

  return (
    <div className="milik-modules-page">
      <div className="milik-atmosphere" aria-hidden="true">
        <div className="milik-orb orb-1" />
        <div className="milik-orb orb-2" />
        <div className="milik-orb orb-3" />
        <div className="milik-grid-sheen" />
      </div>

      <main className="milik-modules-main">
        <header className="milik-header-panel">
          <div className="milik-header-chip">
            <img src="/logo.png" alt="Milik" className="h-9 w-9 object-contain" />
            <span>Milik Smart Workbench</span>
          </div>
          <h1>Choose a Module</h1>
          <p>
            {activeCompanyContext?.companyName
              ? `Only the modules enabled for ${activeCompanyContext.companyName} are shown here. Operating mode: ${operatingModeLabel}.`
              : "A cleaner, sharper control center for every Milik business line."}
          </p>
        </header>

        <section className="milik-module-grid" aria-label="Milik modules">
          <div className="milik-module-grid-inner">
            {visibleModules.map((moduleItem, index) => (
              <button
                key={moduleItem.id}
                onClick={() => handleOpen(moduleItem)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleOpen(moduleItem);
                  }
                }}
                className={`milik-module-tile ${moduleItem.id === "milik" ? "milik-featured-tile" : ""}`}
                style={{ animationDelay: `${(index + 1) * 90}ms` }}
                aria-label={`${moduleItem.title} - ${moduleItem.subtitle}${moduleItem.status === "active" ? "" : " (Coming soon)"}`}
                tabIndex={0}
              >
                <div className="milik-module-overlay" aria-hidden="true" />
                <div className="milik-module-content">
                  <div className="milik-module-head">
                    <StatusPill status={moduleItem.status} />
                  </div>

                  <div className={`milik-icon-shell ${moduleItem.tint} ${moduleItem.id === "milik" ? "milik-logo-shell" : ""}`}>
                    <span className="milik-icon-wrap">{moduleItem.icon}</span>
                  </div>

                  <h3>{moduleItem.title}</h3>
                  <p className="milik-subtitle">{moduleItem.subtitle}</p>

                  <div className="milik-tile-action">
                    <span>{moduleItem.status === "active" ? "Open Module" : "Preview"}</span>
                    <div className="milik-arrow-wrap">
                      <FaArrowRight />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {!visibleModules.length && (
          <section className="milik-module-grid" aria-label="No enabled modules">
            <div className="milik-module-grid-inner">
              <div className="milik-module-tile milik-featured-tile" style={{ cursor: "default" }}>
                <div className="milik-module-overlay" aria-hidden="true" />
                <div className="milik-module-content">
                  <div className="milik-module-head">
                    <span className="milik-status-pill locked">Unavailable</span>
                  </div>
                  <div className="milik-icon-shell milik-icon-charcoal">
                    <span className="milik-icon-wrap">
                      <FaLock />
                    </span>
                  </div>
                  <h3>{emptyState.title}</h3>
                  <p className="milik-subtitle">{emptyState.subtitle}</p>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <StartMenu darkMode={false} />
    </div>
  );
};

export default ModulesDashboard;
