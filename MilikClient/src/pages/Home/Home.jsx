import React from "react";
import { useDispatch } from "react-redux";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
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
  FaPhoneAlt,
  FaShieldAlt,
  FaUserFriends,
  FaWallet,
  FaWhatsapp,
} from "react-icons/fa";
import FreeTrialModal from "../../components/FreeTrialModal";
import { loginSuccess } from "../../redux/authSlice";
import { getCompanySuccess } from "../../redux/companiesRedux";
import heroDashboardImage from "../../assets/landing/hero-dashboard.webp";
import heroStatementImage from "../../assets/landing/hero-landlord-statement.webp";
import "./home.css";

const heroHighlights = [
  "AUTOMATED Tenant billing and receipting",
  "LANDLORD statements and remittances",
  "Chart of Accounts, Trial Balance and Income Statement",
  "M-PESA INTEGRATION and bank-ready collections workflow",
];

const features = [
  {
    icon: <FaBuilding />,
    title: "Portfolio control",
    description: "Manage properties, units, occupancy and owner relationships in one polished workspace.",
  },
  {
    icon: <FaFileInvoice />,
    title: "AUTOMATED Tenant billing",
    description: "Create invoices, manage recurring charges, record receipts and keep tenant balances clean.",
  },
  {
    icon: <FaCoins />,
    title: "LANDLORD reporting",
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
    description: "Fill the form, choose your role, and enter the guided workspace instantly.",
  },
  {
    title: "2. Explore real workflows",
    description: "Inspect properties, tenants, billing, receipts, owner statements and accounting reports using sample data.",
  },
  {
    title: "3. Subscribe when ready",
    description: "Move from DEMO preview workspace to your own live workspace once you are ready to onboard real company data.",
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
    answer: "Demo access lasts for 3 days from the moment the workspace is activated.",
  },
];

const erpSnapshots = [
  {
    title: "Portfolio map",
    description: "See every property, occupancy level and outstanding action from one cockpit.",
    value: "300+ Properties",
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

const pricingTiers = [
  {
    label: "Launch",
    units: "Up to 60 units",
    price: "KES 3,500",
    meta: "/ month",
    helper:
      "An early-adopter price for smaller teams that need disciplined billing, receipts, landlord workflows and credible reports.",
    cta: "Get free trial",
    featured: false,
  },
  {
    label: "Growth",
    units: "61 to 250 units",
    price: "KES 7,500",
    meta: "/ month",
    helper:
      "Best starting commercial tier for active property managers who want an affordable but serious ERP step-up.",
    cta: "Request demo",
    featured: true,
  },
  {
    label: "Portfolio Plus",
    units: "251 to 800 units",
    price: "KES 9,000",
    meta: "/ month",
    helper:
      "Designed for firms with heavier monthly operations, more users, deeper reporting and landlord processing volume.",
    cta: "Talk to sales",
    featured: false,
  },
  {
    label: "Enterprise",
    units: "801+ units",
    price: "Custom",
    meta: "pricing",
    helper:
      "Use tailored commercial terms when onboarding needs, workflow complexity and support expectations are broader.",
    cta: "Request quote",
    featured: false,
  },
];

const DEMO_EXPIRED_NOTICE_KEY = "milik_demo_expired_notice";
const DEMO_EXPIRED_MESSAGE = "Your demo period has ended. Contact MILIK for activation.";
const API_BASE = String(import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

const PUBLIC_SITE_URL = "https://milikproperty.com";

const ensureHeadElement = (selector, tagName, attributes = {}) => {
  let element = document.head.querySelector(selector);

  if (!element) {
    element = document.createElement(tagName);
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    document.head.appendChild(element);
  }

  return element;
};

const setDocumentDescription = (content) => {
  ensureHeadElement('meta[name="description"]', "meta", { name: "description" }).setAttribute("content", content);
};

const setDocumentRobots = (content) => {
  ensureHeadElement('meta[name="robots"]', "meta", { name: "robots" }).setAttribute("content", content);
};

const setCanonicalHref = (href) => {
  ensureHeadElement('link[rel="canonical"]', "link", { rel: "canonical" }).setAttribute("href", href);
};

const setOpenGraphContent = (property, content) => {
  ensureHeadElement(`meta[property="${property}"]`, "meta", { property }).setAttribute("content", content);
};

const setTwitterContent = (name, content) => {
  ensureHeadElement(`meta[name="${name}"]`, "meta", { name }).setAttribute("content", content);
};

function HeroWorkspaceVisual() {
  return (
    <div className="hero-workspace-visual" aria-hidden="true">
      <div className="hero-scene-glow hero-scene-glow-left" />
      <div className="hero-scene-glow hero-scene-glow-right" />

      <div className="hero-device-stage">
        <div className="hero-device-badge">
          <span className="hero-device-badge-dot" />
          Live dashboard and landlord statement
        </div>

        <div className="hero-visual-grid">
          <div className="hero-device-column">
            <div className="hero-proof-chip hero-proof-chip-top">Desktop workspace</div>

            <div className="hero-device-shell">
              <div className="hero-device-frame">
                <div className="hero-device-topbar">
                  <div className="hero-device-controls">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="hero-device-title">MILIK operations desk</div>
                </div>

                <div className="hero-device-screen">
                  <img
                    src={heroDashboardImage}
                    alt="Milik dashboard preview"
                    className="hero-device-screen-image"
                    loading="eager"
                  />
                </div>
              </div>

              <div className="hero-device-base">
                <span className="hero-device-base-strip" />
              </div>
            </div>

            <div className="hero-proof-chip hero-proof-chip-bottom">Dashboard, collections and statements</div>
          </div>

          <div className="hero-proof-column">
            <div className="hero-proof-card">
              <div className="hero-proof-card-header">
                <div>
                  <p className="hero-proof-eyebrow">Landlord reporting proof</p>
                  <h3 className="hero-proof-title">Statement ready for review and remittance</h3>
                </div>
                <div className="hero-proof-status">Live sample</div>
              </div>

              <div className="hero-proof-paper">
                <img
                  src={heroStatementImage}
                  alt="Landlord statement preview"
                  className="hero-proof-paper-image"
                  loading="eager"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const dispatch = useDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const [showTrialModal, setShowTrialModal] = React.useState(false);
  const [trialRole, setTrialRole] = React.useState("property_manager");
  const [activeFaq, setActiveFaq] = React.useState(null);
  const [demoExpiredNotice, setDemoExpiredNotice] = React.useState("");
  const [restoringDemoAccess, setRestoringDemoAccess] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const hasUtilityQuery = params.has("demoAccess") || params.has("token");
    const canonicalUrl = `${PUBLIC_SITE_URL}/`;

    document.title = "Milik Property Management System | Property, Billing, Statements and Reports";
    setDocumentDescription(
      "Milik helps property managers control properties, tenant billing, receipts, landlord statements, Trial Balance, Balance Sheet and Income Statement in one workspace."
    );
    setDocumentRobots(hasUtilityQuery ? "noindex,nofollow" : "index,follow");
    setCanonicalHref(canonicalUrl);
    setOpenGraphContent("og:type", "website");
    setOpenGraphContent("og:site_name", "Milik");
    setOpenGraphContent("og:title", "Milik Property Management System");
    setOpenGraphContent(
      "og:description",
      "Control properties, collections, landlord statements and accounting reports in one workspace."
    );
    setOpenGraphContent("og:url", canonicalUrl);
    setOpenGraphContent("og:image", `${PUBLIC_SITE_URL}/logo.png`);
    setTwitterContent("twitter:card", "summary_large_image");
    setTwitterContent("twitter:title", "Milik Property Management System");
    setTwitterContent(
      "twitter:description",
      "Control properties, collections, landlord statements and accounting reports in one workspace."
    );
    setTwitterContent("twitter:image", `${PUBLIC_SITE_URL}/logo.png`);
  }, [location.search]);

  const openTrialModal = (role = "property_manager") => {
    setTrialRole(role);
    setShowTrialModal(true);
  };

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    const demoAccessToken = params.get("demoAccess");

    if (!demoAccessToken) return undefined;

    let cancelled = false;
    setRestoringDemoAccess(true);

    const restoreDemoAccess = async () => {
      try {
        const response = await fetch(`${API_BASE}/trial/access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: demoAccessToken }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data?.success || !data?.demoAvailable || !data?.token || !data?.user) {
          throw new Error(data?.message || "Failed to restore demo access.");
        }

        if (cancelled) return;

        dispatch(loginSuccess({ token: data.token, user: data.user }));

        if (data.user?.company?._id) {
          dispatch(getCompanySuccess(data.user.company));
          localStorage.setItem("milik_active_company_id", data.user.company._id);
        }

        toast.success(data?.message || "Welcome back. Resuming your remaining demo time.");

        params.delete("demoAccess");
        const nextSearch = params.toString();
        navigate(data.redirectTo || "/dashboard", { replace: true, state: { restoredFromDemoEmail: true, homeSearch: nextSearch ? `?${nextSearch}` : "" } });
      } catch (error) {
        if (cancelled) return;
        const message = error?.message || "Failed to restore demo access.";
        toast.error(message);
        params.delete("demoAccess");
        const nextSearch = params.toString();
        navigate(
          {
            pathname: location.pathname,
            search: nextSearch ? `?${nextSearch}` : "",
          },
          { replace: true }
        );
      } finally {
        if (!cancelled) {
          setRestoringDemoAccess(false);
        }
      }
    };

    restoreDemoAccess();

    return () => {
      cancelled = true;
    };
  }, [dispatch, location.pathname, location.search, navigate]);

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
      {restoringDemoAccess ? (
        <div className="border-b border-[#0B3B2E]/10 bg-[#ECF6F1] px-4 py-3 text-sm text-[#0B3B2E]">
          <div className="mx-auto max-w-7xl font-semibold sm:px-2">Opening your MILIK demo workspace...</div>
        </div>
      ) : null}
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
            <a href="#pricing" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">Pricing</a>
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
        <div className="mx-auto grid max-w-[1720px] gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[0.94fr_1.06fr] lg:items-center xl:gap-16 2xl:gap-20 lg:px-8 xl:px-10 2xl:px-14 lg:py-20">
          <div className="relative z-10 max-w-[760px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#0B3B2E]/10 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] text-[#0B3B2E] shadow-sm">
              <FaBolt className="text-[#FF8C00]" /> Built for managers and landlords
            </div>
            <h1 className="mt-6 max-w-4xl text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-[4.7rem] xl:text-[5.2rem]">
              Property management ERP for teams that need control over portfolios, landlords, collections and reporting.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600 xl:text-[1.15rem]">
              Milik gives property managers and self-managing landlords one serious workspace for portfolio control, billing, receipting, statements and finance execution without the confusion of scattered tools.
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

            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="tel:+254797281781"
                className="inline-flex items-center gap-2 rounded-full border border-[#0B3B2E]/15 bg-white/90 px-5 py-3 text-sm font-bold text-[#0B3B2E] shadow-sm transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"
              >
                <FaPhoneAlt />
                Call 0797281781
              </a>
              <a
                href="https://wa.me/254797281781?text=Hello%20Milik,%20I%20need%20help."
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[#18a06f]/20 bg-[#18a06f]/10 px-5 py-3 text-sm font-bold text-[#0B3B2E] shadow-sm transition hover:border-[#18a06f] hover:bg-[#18a06f] hover:text-white"
              >
                <FaWhatsapp className="text-base" />
                WhatsApp 0797281781
              </a>
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
            <p className="mt-2 text-sm leading-6 text-slate-600">Explore the self-managing landlord demo workspace with statements, remittances, advancements and reporting flows.</p>
            <button
              type="button"
              onClick={() => openTrialModal("landlord")}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#0B3B2E] px-5 py-3 text-sm font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white"
            >
              Enter Demo
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
            <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A SYSTEM that connects properties, Landlords, tenants, cash and reports.</h2>
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
          <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A system built to feel operationally sharp and financially credible.</h2>
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

      <section id="pricing" className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Pricing</p>
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Simple portfolio-based pricing.</h2>
            </div>
          </div>

          <div className="mt-10 grid gap-5 xl:grid-cols-5 md:grid-cols-2">
            {pricingTiers.map((tier) => (
              <div
                key={tier.label}
                className={`flex h-full flex-col rounded-[28px] border p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl ${
                  tier.featured
                    ? "border-[#0B3B2E] bg-[linear-gradient(180deg,rgba(11,59,46,0.06)_0%,#ffffff_100%)] ring-1 ring-[#0B3B2E]/10"
                    : "border-slate-200 bg-[#f8faf9]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#FF8C00]">{tier.label}</p>
                    <h3 className="mt-3 text-lg font-extrabold text-slate-950">{tier.units}</h3>
                  </div>
                  {tier.featured ? (
                    <span className="rounded-full bg-[#0B3B2E] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white">
                      Popular
                    </span>
                  ) : null}
                </div>
                <p className="mt-5 text-3xl font-extrabold text-slate-950">{tier.price}</p>
                <p className="mt-4 flex-1 text-sm leading-7 text-slate-600">{tier.helper}</p>
                <button
                  type="button"
                  onClick={() => openTrialModal("property_manager")}
                  className={`mt-6 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition ${
                    tier.featured
                      ? "bg-[#0B3B2E] text-white hover:bg-[#0A3127]"
                      : "border border-slate-300 bg-white text-slate-800 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                  }`}
                >
                  {tier.cta}
                  <FaArrowRight />
                </button>
              </div>
            ))}
          </div>
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
                <p className="mt-2 text-sm text-white/80">Trial Balance and Income Statement reinforce Reports.</p>
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
                Start with the property manager workspace or the self-managing landlord workspace. Both demo experiences are available now.
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
            <span>Read-only Demo preview</span>
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