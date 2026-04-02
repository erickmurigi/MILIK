import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowRight,
  FaBolt,
  FaBook,
  FaBuilding,
  FaChartLine,
  FaCheckCircle,
  FaClipboardList,
  FaCoins,
  FaFileInvoice,
  FaHeadset,
  FaHome,
  FaLayerGroup,
  FaMobileAlt,
  FaShieldAlt,
  FaUserFriends,
  FaWallet,
} from "react-icons/fa";
import FreeTrialModal from "../../components/FreeTrialModal";
import "./home.css";

const heroHighlights = [
  "Tenant billing and receipting",
  "Owner statements and remittances",
  "Chart of Accounts, Trial Balance and Income Statement",
  "M-PESA and bank-ready collections workflow",
];

const features = [
  {
    icon: <FaBuilding />,
    title: "Portfolio control",
    description: "Manage properties, units, occupancy and owner relationships in one polished workspace.",
  },
  {
    icon: <FaFileInvoice />,
    title: "Tenant billing",
    description: "Create invoices, manage recurring charges, record receipts and keep tenant balances clean.",
  },
  {
    icon: <FaCoins />,
    title: "Owner reporting",
    description: "Prepare owner statements, commissions, remittances and reconciled reporting from one controlled flow.",
  },
  {
    icon: <FaBook />,
    title: "Finance backbone",
    description: "See ledgers, journals, Trial Balance and Income Statement from the same accounting source of truth.",
  },
  {
    icon: <FaMobileAlt />,
    title: "Anywhere access",
    description: "Use Milik from the office, in the field, or abroad with a responsive browser-based experience.",
  },
  {
    icon: <FaShieldAlt />,
    title: "Operational trust",
    description: "Clear roles, controlled workflows and professional reports that build confidence with clients and teams.",
  },
];

const steps = [
  {
    title: "1. Request demo access",
    description: "Fill the form, choose your role, and property managers enter the guided workspace instantly.",
  },
  {
    title: "2. Explore real workflows",
    description: "Inspect properties, tenants, billing, receipts, owner statements and accounting reports using sample data.",
  },
  {
    title: "3. Subscribe when ready",
    description: "Move from preview to your own live workspace once you are ready to onboard real company data.",
  },
];

const faqs = [
  {
    question: "Does the demo include accounting reports?",
    answer: "Yes. The demo showcases Chart of Accounts, Trial Balance and Income Statement so prospects can see the financial backbone clearly.",
  },
  {
    question: "Can prospects enter their own records during the trial?",
    answer: "No. The first version is read-only so visitors can explore safely without altering the shared demo workspace.",
  },
  {
    question: "How long does the demo last?",
    answer: "Property manager demo access lasts for 3 days from the moment the workspace is activated.",
  },
];

const erpSnapshots = [
  {
    title: "Portfolio map",
    description: "See every property, occupancy level and outstanding action from one cockpit.",
    value: "24 Properties",
    accent: "text-[#0B3B2E]",
    icon: <FaHome />,
  },
  {
    title: "Collections engine",
    description: "Invoices, receipts and balance movements stay visible in one operational flow.",
    value: "KES 4.8M Collected",
    accent: "text-[#C96F00]",
    icon: <FaWallet />,
  },
  {
    title: "Accounting layer",
    description: "Statements, ledgers and reports sit directly under the daily operations layer.",
    value: "Trial Balance Ready",
    accent: "text-[#0B3B2E]",
    icon: <FaLayerGroup />,
  },
];

const DEMO_EXPIRED_NOTICE_KEY = "milik_demo_expired_notice";
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";

function HeroWorkspaceVisual() {
  return (
    <div className="hero-workspace-visual" aria-hidden="true">
      <div className="hero-scene-glow hero-scene-glow-left" />
      <div className="hero-scene-glow hero-scene-glow-right" />
      <div className="hero-scene-shell">
        <div className="hero-scene-chip hero-scene-chip-top">
          <span className="hero-chip-dot" />
          Property manager in control
        </div>

        <div className="hero-scene-card hero-scene-card-collections">
          <div className="hero-scene-card-icon hero-card-green">
            <FaWallet />
          </div>
          <div>
            <p className="hero-scene-card-label">Monthly collections</p>
            <p className="hero-scene-card-value">KES 4.8M</p>
            <p className="hero-scene-card-meta">Tracked from invoices to reports</p>
          </div>
        </div>

        <div className="hero-scene-card hero-scene-card-reports">
          <div className="hero-scene-card-icon hero-card-amber">
            <FaClipboardList />
          </div>
          <div>
            <p className="hero-scene-card-label">Reporting status</p>
            <p className="hero-scene-card-value">24 statements processed</p>
            <p className="hero-scene-card-meta">Owner reporting and finance visibility</p>
          </div>
        </div>

        <div className="hero-scene-main">
          <div className="hero-scene-header">
            <div>
              <p className="hero-scene-kicker">Milik live workspace</p>
              <h2 className="hero-scene-title">Property operations guided by people, powered by ERP discipline.</h2>
            </div>
            <div className="hero-scene-status">
              <span className="hero-scene-status-dot" />
              Live overview
            </div>
          </div>

          <div className="hero-scene-canvas">
            <div className="hero-scene-metrics">
              <div className="hero-metric-card hero-metric-card-primary">
                <p className="hero-metric-label">Occupancy</p>
                <p className="hero-metric-value">92%</p>
                <div className="hero-metric-bar">
                  <span style={{ width: "92%" }} />
                </div>
              </div>
              <div className="hero-metric-grid">
                <div className="hero-metric-card">
                  <FaFileInvoice className="hero-metric-icon" />
                  <p className="hero-metric-label">Open invoices</p>
                  <p className="hero-metric-mini">318</p>
                </div>
                <div className="hero-metric-card">
                  <FaCoins className="hero-metric-icon" />
                  <p className="hero-metric-label">Receipts posted</p>
                  <p className="hero-metric-mini">211</p>
                </div>
              </div>
            </div>

            <div className="hero-person-stage">
              <div className="hero-building-skyline">
                <span className="hero-building-tower hero-building-tall" />
                <span className="hero-building-tower hero-building-mid" />
                <span className="hero-building-tower hero-building-short" />
                <span className="hero-building-tower hero-building-mid" />
              </div>

              <div className="hero-person-card">
                <div className="hero-person-badge">Portfolio desk</div>
                <svg viewBox="0 0 480 420" className="hero-person-svg" role="img" aria-label="Property manager using a laptop beside a building operations dashboard">
                  <defs>
                    <linearGradient id="deskGlow" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#EAF6F1" />
                      <stop offset="100%" stopColor="#FDF1E1" />
                    </linearGradient>
                    <linearGradient id="jacketTone" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#0B3B2E" />
                      <stop offset="100%" stopColor="#145744" />
                    </linearGradient>
                    <linearGradient id="screenTone" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#123C33" />
                      <stop offset="100%" stopColor="#1C6A54" />
                    </linearGradient>
                  </defs>

                  <rect x="40" y="32" width="400" height="276" rx="40" fill="url(#deskGlow)" />
                  <rect x="78" y="66" width="132" height="96" rx="22" fill="#FFFFFF" opacity="0.96" />
                  <rect x="96" y="88" width="74" height="14" rx="7" fill="#0B3B2E" opacity="0.18" />
                  <rect x="96" y="116" width="96" height="10" rx="5" fill="#0B3B2E" opacity="0.1" />
                  <rect x="96" y="136" width="84" height="10" rx="5" fill="#0B3B2E" opacity="0.1" />

                  <rect x="270" y="64" width="124" height="82" rx="24" fill="#FFFFFF" opacity="0.96" />
                  <rect x="290" y="86" width="84" height="12" rx="6" fill="#FFB347" opacity="0.55" />
                  <rect x="290" y="110" width="68" height="36" rx="18" fill="#0B3B2E" opacity="0.14" />

                  <rect x="102" y="280" width="290" height="24" rx="12" fill="#D8EADF" opacity="0.9" />
                  <rect x="176" y="188" width="132" height="78" rx="20" fill="#233B37" />
                  <rect x="188" y="200" width="108" height="54" rx="14" fill="url(#screenTone)" />
                  <rect x="196" y="210" width="40" height="8" rx="4" fill="#FFFFFF" opacity="0.34" />
                  <rect x="196" y="226" width="74" height="6" rx="3" fill="#FFFFFF" opacity="0.18" />
                  <rect x="196" y="239" width="62" height="6" rx="3" fill="#FFFFFF" opacity="0.18" />
                  <rect x="228" y="268" width="28" height="10" rx="5" fill="#233B37" />

                  <circle cx="240" cy="154" r="46" fill="#F4C39E" />
                  <path d="M197 142C204 108 229 92 258 99C280 104 294 122 292 146C280 132 262 123 236 126C220 128 208 134 197 142Z" fill="#0F172A" />
                  <circle cx="224" cy="154" r="4.4" fill="#1F2937" />
                  <circle cx="255" cy="154" r="4.4" fill="#1F2937" />
                  <path d="M225 176C234 186 247 186 256 176" fill="none" stroke="#A84B2C" strokeWidth="5" strokeLinecap="round" />
                  <path d="M209 204C221 191 258 190 272 204L286 250H194L209 204Z" fill="#FFFFFF" />
                  <path d="M182 224C194 204 208 194 240 194C270 194 286 205 299 224L324 286H156L182 224Z" fill="url(#jacketTone)" />
                  <rect x="166" y="280" width="148" height="18" rx="9" fill="#1B4E40" opacity="0.55" />
                  <rect x="151" y="300" width="180" height="16" rx="8" fill="#0B3B2E" opacity="0.12" />
                </svg>
              </div>
            </div>
          </div>

          <div className="hero-scene-footer">
            <div className="hero-footer-chip">Portfolio</div>
            <div className="hero-footer-chip">Tenant billing</div>
            <div className="hero-footer-chip">Owner statements</div>
            <div className="hero-footer-chip">Finance reports</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const [showTrialModal, setShowTrialModal] = React.useState(false);
  const [trialRole, setTrialRole] = React.useState("property_manager");
  const [activeFaq, setActiveFaq] = React.useState(null);
  const [demoExpiredNotice, setDemoExpiredNotice] = React.useState("");

  const openTrialModal = (role = "property_manager") => {
    setTrialRole(role);
    setShowTrialModal(true);
  };

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const queryRequestsExpiredNotice = params.get("demoExpired") === "1";

    let nextNotice = "";

    try {
      nextNotice = sessionStorage.getItem(DEMO_EXPIRED_NOTICE_KEY) || "";
      if (!nextNotice && queryRequestsExpiredNotice) {
        nextNotice = DEMO_EXPIRED_MESSAGE;
        sessionStorage.setItem(DEMO_EXPIRED_NOTICE_KEY, nextNotice);
      }
    } catch (_error) {
      nextNotice = queryRequestsExpiredNotice ? DEMO_EXPIRED_MESSAGE : "";
    }

    setDemoExpiredNotice(nextNotice);

    if (queryRequestsExpiredNotice) {
      params.delete("demoExpired");
      const nextSearch = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : "",
        },
        { replace: true }
      );
    }
  }, [location.pathname, location.search, navigate]);

  const dismissDemoExpiredNotice = () => {
    setDemoExpiredNotice("");
    try {
      sessionStorage.removeItem(DEMO_EXPIRED_NOTICE_KEY);
    } catch (_error) {
      // Ignore storage cleanup issues.
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-slate-900">
      {demoExpiredNotice ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:px-2">
            <div>
              <p className="font-extrabold uppercase tracking-[0.18em] text-amber-700">Demo access ended</p>
              <p className="mt-1 font-semibold">{demoExpiredNotice}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href="mailto:miliksystem@gmail.com?subject=Milik%20Activation%20Request"
                className="inline-flex items-center rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-[#0A3127]"
              >
                Contact MILIK
              </a>
              <button
                type="button"
                onClick={dismissDemoExpiredNotice}
                className="inline-flex items-center rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-amber-900 transition hover:bg-amber-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <nav className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Milik" className="h-11 w-11 object-contain" />
            <div>
              <p className="text-lg font-extrabold tracking-wide text-[#0B3B2E]">Milik</p>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Property Management System</p>
            </div>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">Features</a>
            <a href="#how-it-works" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">How it works</a>
            <a href="#faq" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">FAQ</a>
            <button
              type="button"
              onClick={() => openTrialModal("property_manager")}
              className="rounded-full bg-[#0B3B2E] px-5 py-2 text-sm font-bold text-white transition hover:bg-[#0A3127]"
            >
              Get Free Trial
            </button>
            <Link to="/login" className="rounded-full border border-[#0B3B2E] px-5 py-2 text-sm font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white">Sign in</Link>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => openTrialModal("property_manager")}
              className="rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0A3127]"
            >
              Trial
            </button>
            <Link to="/login" className="rounded-full border border-[#0B3B2E] px-4 py-2 text-xs font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white">Sign in</Link>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(11,59,46,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(255,140,0,0.15),_transparent_26%),linear-gradient(135deg,#ffffff_0%,#f7fbf8_45%,#eef5f1_100%)]">
        <div className="hero-gridlines" aria-hidden="true" />
        <div className="hero-orb hero-orb-left" aria-hidden="true" />
        <div className="hero-orb hero-orb-right" aria-hidden="true" />
        <div className="mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[0.98fr_1.02fr] lg:items-center lg:px-8 lg:py-24">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#0B3B2E]/10 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] text-[#0B3B2E] shadow-sm">
              <FaBolt className="text-[#FF8C00]" /> Built for confident property operations
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-extrabold leading-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Property Management System for managers who need control over portfolios, collections and reporting.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Milik gives property teams one serious workspace for portfolio control, tenant billing, owner reporting and finance execution without the confusion of scattered tools.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => openTrialModal("property_manager")}
                className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127]"
              >
                Get Free Trial
                <FaArrowRight />
              </button>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3.5 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
              >
                Existing customer sign in
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {heroHighlights.map((highlight) => (
                <div key={highlight} className="inline-flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#0B3B2E]/10 text-[#0B3B2E]">
                    <FaCheckCircle />
                  </span>
                  <span className="text-sm font-semibold text-slate-700">{highlight}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10">
            <div className="erp-hero-shell">
              <HeroWorkspaceVisual />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <FaBuilding className="text-2xl text-[#0B3B2E]" />
            <h3 className="mt-4 text-xl font-extrabold text-slate-900">Property Manager</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Explore the guided demo workspace with properties, tenants, receipts, owner statements and finance reports.</p>
            <button
              type="button"
              onClick={() => openTrialModal("property_manager")}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0A3127]"
            >
              Enter Demo
              <FaArrowRight />
            </button>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <FaUserFriends className="text-2xl text-[#FF8C00]" />
            <h3 className="mt-4 text-xl font-extrabold text-slate-900">Landlord</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Request a guided preview so you can inspect the statement quality and reporting experience you will receive.</p>
            <button
              type="button"
              onClick={() => openTrialModal("landlord")}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#0B3B2E] px-5 py-3 text-sm font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white"
            >
              Request Preview
              <FaArrowRight />
            </button>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <FaHeadset className="text-2xl text-[#0B3B2E]" />
            <h3 className="mt-4 text-xl font-extrabold text-slate-900">Existing User</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Go straight to the live app login when your company has already been onboarded into MILIK.</p>
            <Link
              to="/login"
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-3 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
            >
              Open Login
              <FaArrowRight />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="rounded-[34px] border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What makes it feel like ERP</p>
            <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A product view that connects buildings, tenants, cash and reports.</h2>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {erpSnapshots.map((snapshot, index) => (
              <div key={snapshot.title} className={`erp-snapshot-card erp-snapshot-card-${index + 1} rounded-[28px] border border-slate-200 p-6 shadow-sm`}>
                <div className={`inline-flex rounded-2xl bg-slate-50 p-3 text-2xl ${snapshot.accent}`}>{snapshot.icon}</div>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.22em] text-slate-500">{snapshot.title}</p>
                <h3 className="mt-3 text-2xl font-extrabold text-slate-900">{snapshot.value}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{snapshot.description}</p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="erp-snapshot-bar h-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Why teams choose Milik</p>
          <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A product built to feel operationally sharp and financially credible.</h2>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
              <div className="inline-flex rounded-2xl bg-[#0B3B2E]/10 p-3 text-2xl text-[#0B3B2E]">{feature.icon}</div>
              <h3 className="mt-5 text-xl font-extrabold text-slate-900">{feature.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">How the demo works</p>
            <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A simple path from curiosity to confident buying.</h2>
          </div>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {steps.map((step) => (
              <div key={step.title} className="rounded-[28px] border border-slate-200 bg-[#f7fbf8] p-6 shadow-sm">
                <h3 className="text-xl font-extrabold text-slate-900">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-[36px] bg-gradient-to-r from-[#0B3B2E] via-[#104F3E] to-[#0A3127] px-8 py-10 text-white shadow-2xl">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.8fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#F8C471]">Built to convert</p>
              <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Let prospects inspect the workflow, not just hear the pitch.</h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-white/85 sm:text-base">
                The guided demo workspace is designed to build trust fast: sample properties, tenant flows, owner statements and finance reports, all in one environment.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur">
                <FaChartLine className="text-2xl text-[#F8C471]" />
                <p className="mt-4 text-lg font-extrabold">Financial clarity</p>
                <p className="mt-2 text-sm text-white/80">Trial Balance and Income Statement reinforce product trust.</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur">
                <FaClipboardList className="text-2xl text-[#F8C471]" />
                <p className="mt-4 text-lg font-extrabold">Operational depth</p>
                <p className="mt-2 text-sm text-white/80">Properties, tenants, receipts and statements show real daily value.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="bg-white py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">FAQ</p>
            <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Questions prospects often ask before they buy.</h2>
          </div>
          <div className="mt-10 space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = activeFaq === index;
              return (
                <div key={faq.question} className="overflow-hidden rounded-[24px] border border-slate-200 bg-[#f8faf9] shadow-sm">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                    onClick={() => setActiveFaq(isOpen ? null : index)}
                  >
                    <span className="text-base font-bold text-slate-900">{faq.question}</span>
                    <span className="text-xl font-bold text-[#0B3B2E]">{isOpen ? "−" : "+"}</span>
                  </button>
                  {isOpen && <div className="border-t border-slate-200 px-6 py-5 text-sm leading-7 text-slate-600">{faq.answer}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[36px] border border-slate-200 bg-white px-8 py-10 shadow-sm">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.7fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Ready to explore?</p>
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Open the guided demo and show your team what Milik feels like.</h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                Start with the property manager workspace now. Landlord-specific access is already being prepared for the next phase.
              </p>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row lg:justify-end">
              <button
                type="button"
                onClick={() => openTrialModal("property_manager")}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0B3B2E] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127]"
              >
                Get Free Trial
                <FaArrowRight />
              </button>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-6 py-3.5 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
              >
                Existing customer sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-[#0B3B2E] py-8 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 text-sm text-white/80 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Milik" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-bold text-white">Milik Property Management System</p>
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">Operations • Landlords • Accounting</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
            <span>Professional demo workspace</span>
            <span>Read-only product preview</span>
            <span>Built for confidence</span>
          </div>
        </div>
      </footer>

      <FreeTrialModal
        isOpen={showTrialModal}
        initialRole={trialRole}
        onClose={() => setShowTrialModal(false)}
      />
    </div>
  );
}

export default Home;
