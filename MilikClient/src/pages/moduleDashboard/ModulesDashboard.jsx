// pages/ModulesDashboard/ModulesDashboard.jsx
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaChartLine,
  FaWarehouse,
  FaUsers,
  FaShieldAlt,
  FaHandshake,
  FaStore,
  FaArrowRight,
} from "react-icons/fa";
import { toast } from "react-toastify";
import "./ModulesDashboard.css";

const ModulesDashboard = () => {
  const navigate = useNavigate();

  const modules = useMemo(
    () => [
      {
        id: "milik",
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
        title: "Accounts & Finance",
        subtitle: "Financial management and accounting",
        description: "Track income, expenses, analytics and accounting operations with clear financial visibility.",
        status: "active",
        route: "/financial/chart-of-accounts",
        icon: <FaChartLine />,
        tint: "milik-icon-gold",
      },
      {
        id: "inventory",
        title: "Inventory",
        subtitle: "Stock management and warehousing",
        description: "Monitor stock movement, automate replenishment and keep warehouse operations synchronized.",
        status: "active",
        route: "/inventory",
        icon: <FaWarehouse />,
        tint: "milik-icon-cyan",
      },
      {
        id: "crm",
        title: "CRM",
        subtitle: "Customer relationship management",
        description: "Manage customer pipelines, interactions and growth opportunities with actionable insights.",
        status: "active",
        route: "/crm",
        icon: <FaUsers />,
        tint: "milik-icon-teal",
      },
      {
        id: "security",
        title: "Security",
        subtitle: "Access control and monitoring",
        description: "Protect operations with role controls, security workflows and real-time monitoring tools.",
        status: "active",
        route: "/security",
        icon: <FaShieldAlt />,
        tint: "milik-icon-charcoal",
      },
      {
        id: "pos",
        title: "POS & Billing",
        subtitle: "Point of sale system",
        description: "Process payments, issue receipts and manage checkout operations with inventory sync.",
        status: "active",
        route: "/pos",
        icon: <FaStore />,
        tint: "milik-icon-orange",
      },
      {
        id: "vendoor",
        title: "Ven-Door",
        subtitle: "Vendor management portal",
        description: "Centralize supplier workflows, purchase coordination and vendor performance.",
        status: "active",
        route: "/ven-door",
        icon: <FaHandshake />,
        tint: "milik-icon-indigo",
      },
    ],
    []
  );

  const handleOpen = (m) => {
    if (m.status === "active" && m.route) {
      const recent = JSON.parse(localStorage.getItem("recentModules") || "[]");
      const updated = [m.id, ...recent.filter((id) => id !== m.id)].slice(0, 5);
      localStorage.setItem("recentModules", JSON.stringify(updated));
      navigate(m.route);
      return;
    }
    if (m.status === "coming") {
      toast.info(`${m.title} is coming soon in your Milik workspace.`);
      return;
    }
    toast.warning(`${m.title} is currently unavailable for your account.`);
  };

  const StatusPill = ({ status }) => {
    const base = "milik-status-pill";
    if (status === "active") return <span className={`${base} active`}>Live</span>;
    if (status === "coming") return <span className={`${base} coming`}>Soon</span>;
    return <span className={`${base} locked`}>Locked</span>;
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
          <h1>
            Choose a Module
          </h1>
          <p>
            A cleaner, sharper control center for every Milik business line.
          </p>
        </header>

        <section className="milik-module-grid" aria-label="Milik modules">
          <div className="milik-module-grid-inner">
            {modules.map((m, index) => (
              <button
                key={m.id}
                onClick={() => handleOpen(m)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpen(m);
                  }
                }}
                className={`milik-module-tile ${m.id === 'milik' ? 'milik-featured-tile' : ''}`}
                style={{ animationDelay: `${(index + 1) * 90}ms` }}
                aria-label={`${m.title} - ${m.subtitle}${m.status === 'active' ? '' : ' (Coming soon)'}`}
                tabIndex={0}
              >
                <div className="milik-module-overlay" aria-hidden="true" />
                <div className="milik-module-content">
                  <div className="milik-module-head">
                    <StatusPill status={m.status} />
                  </div>

                  <div className={`milik-icon-shell ${m.tint} ${m.id === "milik" ? "milik-logo-shell" : ""}`}>
                    <span className="milik-icon-wrap">{m.icon}</span>
                  </div>

                  <h3>{m.title}</h3>
                  <p className="milik-subtitle">{m.subtitle}</p>

                  <div className="milik-tile-action">
                    <span>{m.status === "active" ? "Open Module" : "Preview"}</span>
                    <div className="milik-arrow-wrap">
                      <FaArrowRight />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>

      {/* Empty State */}
      </div>
    );
};

export default ModulesDashboard;
