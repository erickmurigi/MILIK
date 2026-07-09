import React from "react";
import { useDispatch } from "react-redux";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaArrowRight,
  FaBolt,
  FaBook,
  FaBuilding,
  FaCar,
  FaChartLine,
  FaCheckCircle,
  FaClipboardList,
  FaCoins,
  FaFileInvoice,
  FaHandshake,
  FaHeadset,
  FaHome,
  FaLayerGroup,
  FaMobileAlt,
  FaPhoneAlt,
  FaShieldAlt,
  FaUsers,
  FaUserFriends,
  FaWarehouse,
  FaWallet,
  FaWhatsapp,
} from "react-icons/fa";
import FreeTrialModal from "../../components/FreeTrialModal";
import { loginSuccess } from "../../redux/authSlice";
import { getCompanySuccess } from "../../redux/companiesRedux";
import landingPageImg from "../../assets/landing/LANDING PAGE.png";
import "./home.css";

const heroHighlights = [
  "PROPERTY — rent invoices, M-PESA matching and landlord statements",
  "CAR WASH — job queue, loyalty cards and staff commissions",
  "HR & PAYROLL — contracts, leave approvals and payslip cycles",
  "INVENTORY & POS — stock levels, purchase orders and till close",
  "ACCOUNTING — Chart of Accounts and Trial Balance in every module",
  "PROPERTY SALES — listings, buyers, deals and agent commissions",
];

const modules = [
  {
    icon: <FaBuilding />,
    title: "Property Management",
    description: "Tenant billing, M-PESA rent collection, landlord statements, Trial Balance and full financial reporting.",
    color: "text-[#0B3B2E]",
    bg: "bg-[#0B3B2E]/10",
    href: "/property-management",
  },
  {
    icon: <FaCar />,
    title: "Car Wash",
    description: "Job tracking, payments, staff commissions, customer loyalty program and branch management.",
    color: "text-sky-700",
    bg: "bg-sky-50",
    href: "/car-wash",
  },
  {
    icon: <FaUsers />,
    title: "Human Resources",
    description: "Employee records, leave management, payroll processing, KPI tracking and staff appraisals.",
    color: "text-violet-700",
    bg: "bg-violet-50",
    href: "/human-resources",
  },
  {
    icon: <FaWarehouse />,
    title: "Inventory & POS",
    description: "Stock management, purchase orders, supplier tracking, POS sessions and till reconciliation.",
    color: "text-orange-700",
    bg: "bg-orange-50",
    href: "/inventory-pos",
  },
  {
    icon: <FaHandshake />,
    title: "Property Sales",
    description: "Listings, buyer management, agent commissions, deal tracking and sales performance reports.",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    href: "/property-sales",
  },
];

const features = [
  {
    icon: <FaBuilding />,
    title: "Full property portfolio control",
    description: "Properties, units, occupancy and all your landlords in one place. No spreadsheets, no WhatsApp confusion.",
  },
  {
    icon: <FaFileInvoice />,
    title: "Automated tenant billing",
    description: "Rent invoices go out on schedule. When a tenant pays via M-PESA Paybill, the receipt and balance update automatically.",
  },
  {
    icon: <FaCoins />,
    title: "Landlord statements and remittances",
    description: "Generate per-landlord statements, deduct management fees and record remittances without manual calculations.",
  },
  {
    icon: <FaBook />,
    title: "Accounting built in, not bolted on",
    description: "Every transaction posts to a proper Chart of Accounts. Trial Balance and Income Statement are always up to date.",
  },
  {
    icon: <FaMobileAlt />,
    title: "Access from anywhere",
    description: "Browser-based and mobile-ready. Your team can work from the site office, on the road or at home — same system.",
  },
  {
    icon: <FaShieldAlt />,
    title: "Role-based user control",
    description: "Set who sees what. Managers, accountants and field agents each get the access level their role actually needs.",
  },
];

const steps = [
  {
    title: "1. Pick your role and get in",
    description: "Choose Property Manager or Landlord, fill a short form and the demo workspace opens immediately — no sales call required.",
  },
  {
    title: "2. Walk through the real system",
    description: "Properties, tenants, rent receipts, landlord statements, car wash jobs, payroll — all loaded with sample data so you can explore properly.",
  },
  {
    title: "3. Move to your live workspace",
    description: "When you're ready, we onboard your real data. Your live workspace is separate from the demo — nothing carries over that shouldn't.",
  },
];

const faqs = [
  {
    question: "What is Milik?",
    answer: "Milik is a business management system built specifically for Kenya. It handles property management, car wash operations, HR, inventory and property sales — all in one workspace, with a proper accounting layer underneath every module. 50+ businesses are already running on it.",
  },
  {
    question: "Which modules does Milik include?",
    answer: "Five modules: Property Management (tenant billing, M-PESA collections, landlord statements), Car Wash (job tracking, loyalty stamps, staff commissions), HR (payroll, leave, appraisals), Inventory & POS (stock, purchase orders, point of sale) and Property Sales (listings, buyers, agents, deal pipeline). You only activate what your business needs.",
  },
  {
    question: "Does Milik work with M-PESA for rent collection?",
    answer: "Yes — and it's one of the most-used features. Tenants pay rent to your M-PESA Paybill number. Milik picks up the payment, matches it to the right invoice and generates a receipt automatically. No manual entry, no chasing confirmations on WhatsApp.",
  },
  {
    question: "How much does Milik cost?",
    answer: "Property Management starts at KES 3,500/month for up to 60 units. The Growth plan (61–250 units) is KES 7,500/month and Portfolio Plus (251–800 units) is KES 9,000/month. Enterprise pricing is available for 800+ units. Car Wash, HR, Inventory and Property Sales are priced per business — contact us for a tailored quote.",
  },
  {
    question: "Can I manage multiple landlords and properties in one workspace?",
    answer: "Yes. There's no limit on landlords or properties. You can mix bedsitters, apartments, commercial units and mixed-use properties under one login. Each landlord gets their own statement, commission deduction and remittance record.",
  },
  {
    question: "Does the car wash module have a loyalty program?",
    answer: "Yes. Customers are tracked by vehicle plate. Stamps are awarded per job and when they hit your set threshold, the system marks the reward automatically and can send an SMS to the customer. The whole loyalty cycle runs without any manual tracking.",
  },
  {
    question: "What financial reports does Milik produce?",
    answer: "Trial Balance, Income Statement, Balance Sheet, landlord remittance statements, rental collection summaries, aged receivables, paid balance reports and MRI tax reports. They all come from the same accounting data — not separate exports.",
  },
  {
    question: "Does Milik handle bedsitters and mixed-use properties?",
    answer: "Yes. Bedsitters, single rooms, apartments, commercial units, gated estates — Milik handles all of them. You can set different charge structures per unit and include utility billing (water, electricity) per tenant.",
  },
  {
    question: "How many users can access the same Milik workspace?",
    answer: "As many as your plan supports. Each user gets their own login with a role — Administrator, Manager, Accountant, Agent or Viewer. Permissions are set per module, so users only see what their role requires.",
  },
  {
    question: "Can I use Milik during the demo to enter my own records?",
    answer: "The demo workspace is shared and read-only, so you can explore safely without anyone's data getting mixed in. Once you subscribe, you get your own separate live workspace with full write access from day one.",
  },
  {
    question: "How long does the demo last?",
    answer: "3 days from when it's activated. If you need more time before deciding, reach out on WhatsApp or email and we can extend it.",
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

const modulePricing = [
  {
    icon: <FaBuilding />,
    title: "Property Management",
    desc: "Tenant billing, M-PESA rent collection, landlord statements and full financial reporting.",
    price: "From KES 3,500",
    priceMeta: "/ month",
    note: "Tiered by rental unit count — see plans below",
    color: "text-[#0B3B2E]",
    bg: "bg-[#0B3B2E]/10",
    featured: true,
    contact: false,
    cta: "See plans ↓",
    href: "#pricing-pm",
  },
  {
    icon: <FaCar />,
    title: "Car Wash",
    desc: "Job tracking, vehicle plates, customer loyalty program and staff commission calculations.",
    price: "Tailored pricing",
    priceMeta: "",
    note: "Priced per business",
    color: "text-sky-700",
    bg: "bg-sky-50",
    featured: false,
    contact: true,
    cta: "Request quote",
  },
  {
    icon: <FaUsers />,
    title: "Human Resources",
    desc: "Employee records, payroll processing, leave management and KPI appraisals.",
    price: "Tailored pricing",
    priceMeta: "",
    note: "Priced per business",
    color: "text-violet-700",
    bg: "bg-violet-50",
    featured: false,
    contact: true,
    cta: "Request quote",
  },
  {
    icon: <FaWarehouse />,
    title: "Inventory & POS",
    desc: "Stock management, purchase orders, POS sessions and end-of-day till reconciliation.",
    price: "Tailored pricing",
    priceMeta: "",
    note: "Priced per business",
    color: "text-orange-700",
    bg: "bg-orange-50",
    featured: false,
    contact: true,
    cta: "Request quote",
  },
  {
    icon: <FaHandshake />,
    title: "Property Sales",
    desc: "Listings, buyer management, deal progression, agent commissions and pipeline reporting.",
    price: "Tailored pricing",
    priceMeta: "",
    note: "Priced per business",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    featured: false,
    contact: true,
    cta: "Request quote",
  },
];

const pricingTiers = [
  {
    label: "Launch",
    units: "Up to 60 units",
    price: "KES 3,500",
    meta: "/ month",
    helper: "An early-adopter price for smaller teams that need disciplined billing, receipts, landlord workflows and credible reports.",
    cta: "Get free trial",
    featured: false,
  },
  {
    label: "Growth",
    units: "61 to 250 units",
    price: "KES 7,500",
    meta: "/ month",
    helper: "Best starting commercial tier for active property managers who want an affordable but serious ERP step-up.",
    cta: "Request demo",
    featured: true,
  },
  {
    label: "Portfolio Plus",
    units: "251 to 800 units",
    price: "KES 9,000",
    meta: "/ month",
    helper: "Designed for firms with heavier monthly operations, more users, deeper reporting and landlord processing volume.",
    cta: "Talk to sales",
    featured: false,
  },
  {
    label: "Enterprise",
    units: "801+ units",
    price: "Custom",
    meta: "pricing",
    helper: "Use tailored commercial terms when onboarding needs, workflow complexity and support expectations are broader.",
    cta: "Request quote",
    featured: false,
  },
];

const statItems = [
  { target: 1500, suffix: "+", label: "Units managed" },
  { target: 50000, suffix: "+", label: "Receipts generated", formatK: true },
  { target: 200, suffix: "+", label: "Active businesses" },
  { target: 99, suffix: "%", label: "Platform uptime" },
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

const AnimatedNumber = React.memo(function AnimatedNumber({ target, suffix = "", formatK = false }) {
  const [val, setVal] = React.useState(0);
  const ref = React.useRef(null);
  const rafRef = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      ob.disconnect();
      const start = performance.now();
      const dur = 1600;
      const run = (now) => {
        const t = Math.min((now - start) / dur, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        setVal(Math.floor(ease * target));
        if (t < 1) rafRef.current = requestAnimationFrame(run);
        else setVal(target);
      };
      rafRef.current = requestAnimationFrame(run);
    }, { threshold: 0.5 });
    ob.observe(el);
    return () => {
      ob.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);
  const display = formatK && val >= 1000 ? `${Math.round(val / 1000)}K` : val.toLocaleString();
  return <span ref={ref}>{display}{suffix}</span>;
});

const HeroWorkspaceVisual = React.memo(function HeroWorkspaceVisual() {
  return (
    <div className="hero-person-shell" aria-hidden="true">
      {/* Floating stat chip — top left */}
      <div className="hero-float-stat">
        <span className="hero-float-stat-dot" />
        50+ Active businesses
      </div>

      {/* Main person photo */}
      <div className="hero-person-frame">
        <img
          src={landingPageImg}
          alt="Business professional using Milik"
          className="hero-person-img"
          loading="eager"
        />
        <div className="hero-person-overlay" />
      </div>

      {/* Floating software metrics card */}
      <div className="hero-float-software">
        <p className="hero-float-software-title">Live metrics</p>
        <div className="hero-float-software-row">
          <span className="hero-float-software-label">Collected</span>
          <span className="hero-float-software-value hero-float-software-value-green">KES 4.8M</span>
        </div>
        <div className="hero-float-software-row">
          <span className="hero-float-software-label">Units</span>
          <span className="hero-float-software-value">1,500+</span>
        </div>
        <div className="hero-float-software-row">
          <span className="hero-float-software-label">Receipts</span>
          <span className="hero-float-software-value">50K+</span>
        </div>
        <div className="hero-float-software-row">
          <span className="hero-float-software-label">Uptime</span>
          <span className="hero-float-software-value hero-float-software-value-green">99%</span>
        </div>
      </div>

      {/* Activity feed — bottom left, overlapping frame */}
      <div className="hero-person-activity">
        <p className="hero-activity-title">Live activity</p>
        <div className="hero-activity-item">
          <span className="hero-activity-dot hero-activity-dot-green" />
          <span className="hero-activity-text">KES 45,000 received — John K.</span>
          <span className="hero-activity-time">2m</span>
        </div>
        <div className="hero-activity-item">
          <span className="hero-activity-dot hero-activity-dot-blue" />
          <span className="hero-activity-text">Invoice #INV-034 generated</span>
          <span className="hero-activity-time">7m</span>
        </div>
        <div className="hero-activity-item">
          <span className="hero-activity-dot hero-activity-dot-amber" />
          <span className="hero-activity-text">Statement ready — ABRI REALTORS</span>
          <span className="hero-activity-time">18m</span>
        </div>
      </div>
    </div>
  );
});

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

    document.title = "Milik | Business Management Software Kenya — Property, Car Wash, HR & Inventory";
    setDocumentDescription(
      "Milik is Kenya's business management platform — property management, car wash operations, HR, inventory and property sales in one workspace. Start your free demo today."
    );
    setDocumentRobots(hasUtilityQuery ? "noindex,nofollow" : "index,follow");
    setCanonicalHref(canonicalUrl);
    setOpenGraphContent("og:type", "website");
    setOpenGraphContent("og:site_name", "Milik");
    setOpenGraphContent("og:locale", "en_KE");
    setOpenGraphContent("og:title", "Milik | Business Management Software Kenya");
    setOpenGraphContent(
      "og:description",
      "Kenya's business management platform — property management, car wash, HR, inventory and property sales in one professional workspace."
    );
    setOpenGraphContent("og:url", canonicalUrl);
    setOpenGraphContent("og:image", `${PUBLIC_SITE_URL}/logo.png`);
    setOpenGraphContent("og:image:width", "512");
    setOpenGraphContent("og:image:height", "512");
    setOpenGraphContent("og:image:alt", "Milik — Business Management Software Kenya");
    setTwitterContent("twitter:card", "summary_large_image");
    setTwitterContent("twitter:site", "@milikproperty");
    setTwitterContent("twitter:title", "Milik | Business Management Software Kenya");
    setTwitterContent(
      "twitter:description",
      "Property management, car wash, HR, inventory and property sales in one workspace. Built for Kenya."
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
        navigate(data.redirectTo || "/dashboard", {
          replace: true,
          state: { restoredFromDemoEmail: true, homeSearch: nextSearch ? `?${nextSearch}` : "" },
        });
      } catch (error) {
        if (cancelled) return;
        const message = error?.message || "Failed to restore demo access.";
        toast.error(message);
        params.delete("demoAccess");
        const nextSearch = params.toString();
        navigate(
          { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
          { replace: true }
        );
      } finally {
        if (!cancelled) setRestoringDemoAccess(false);
      }
    };

    restoreDemoAccess();
    return () => { cancelled = true; };
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
        { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" },
        { replace: true }
      );
    }
  }, [location.pathname, location.search, navigate]);

  React.useEffect(() => {
    const ob = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); ob.unobserve(e.target); }
      }),
      { threshold: 0.08, rootMargin: "0px 0px -44px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => ob.observe(el));
    return () => ob.disconnect();
  }, []);

  const dismissDemoExpiredNotice = () => {
    setDemoExpiredNotice("");
    try { sessionStorage.removeItem(DEMO_EXPIRED_NOTICE_KEY); } catch (_error) {}
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f8f7] text-slate-900">
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

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6 lg:px-8">
          <div className="relative">
            <img src="/logo.png" alt="Milik" className="h-9 w-auto object-contain" style={{ maxWidth: "140px" }} />
            <span className="nav-logo-live-dot" title="System live" />
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#modules" className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">Modules</a>
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

      {/* Hero */}
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(11,59,46,0.18),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(255,140,0,0.15),_transparent_26%),linear-gradient(135deg,#ffffff_0%,#f7fbf8_45%,#eef5f1_100%)] lg:h-[calc(100vh-48px)] lg:min-h-[500px]">
        <div className="hero-gridlines" aria-hidden="true" />
        <div className="hero-orb hero-orb-left" aria-hidden="true" />
        <div className="hero-orb hero-orb-right" aria-hidden="true" />
        <div className="mx-auto grid max-w-7xl gap-8 px-4 pt-6 pb-12 sm:px-6 lg:grid-cols-[0.94fr_1.06fr] lg:h-full lg:items-center lg:gap-0 xl:gap-10 lg:px-8 xl:px-10 lg:pt-0 lg:pb-0">
          <div className="relative z-10 max-w-[680px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#0B3B2E]/10 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0B3B2E] shadow-sm">
              <FaBolt className="text-[#FF8C00]" /> Business management suite
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-extrabold leading-[1.02] tracking-[-0.03em] text-slate-950 sm:text-4xl lg:text-[2.8rem] xl:text-[3.2rem]">
              Run your entire business from one system — property, car wash, HR and inventory.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 xl:text-base">
              Take the module your business needs today. Property management, car wash, HR, inventory or property sales — each one runs independently, each one ships with a full Chart of Accounts, Trial Balance and financial reports. No add-ons, no surprises.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openTrialModal("property_manager")}
                className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127]"
              >
                Get Free Trial
                <FaArrowRight />
              </button>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
              >
                Existing customer sign in
              </Link>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="tel:+254141455841"
                className="inline-flex items-center gap-2 rounded-full border border-[#0B3B2E]/15 bg-white/90 px-4 py-2 text-xs font-bold text-[#0B3B2E] shadow-sm transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"
              >
                <FaPhoneAlt />
                Call 0141 455 841
              </a>
              <a
                href="https://wa.me/254141455841?text=Hello%20Milik,%20I%20need%20help."
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[#18a06f]/20 bg-[#18a06f]/10 px-4 py-2 text-xs font-bold text-[#0B3B2E] shadow-sm transition hover:border-[#18a06f] hover:bg-[#18a06f] hover:text-white"
              >
                <FaWhatsapp className="text-base" />
                WhatsApp 0141 455 841
              </a>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {heroHighlights.map((highlight) => (
                <div key={highlight} className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 shadow-sm backdrop-blur">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0B3B2E]/10 text-[#0B3B2E]">
                    <FaCheckCircle className="text-[10px]" />
                  </span>
                  <span className="text-xs font-semibold text-slate-700">{highlight}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 lg:h-full lg:overflow-hidden">
            <div className="erp-hero-shell lg:h-full">
              <HeroWorkspaceVisual />
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-slate-200/80 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 lg:grid-cols-4 lg:divide-y-0">
            {statItems.map((s) => (
              <div key={s.label} className="stat-count-card px-4 py-5 text-center">
                <p className="stat-gradient-text text-3xl font-extrabold tracking-tight sm:text-4xl">
                  <AnimatedNumber target={s.target} suffix={s.suffix} formatK={s.formatK} />
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo entry cards */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm reveal reveal-d1">
            <FaBuilding className="text-xl text-[#0B3B2E]" />
            <h3 className="mt-3 text-base font-extrabold text-slate-900">Property Manager</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">Explore the guided demo workspace with properties, tenants, receipts, owner statements and finance reports.</p>
            <button
              type="button"
              onClick={() => openTrialModal("property_manager")}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0A3127]"
            >
              Enter Demo <FaArrowRight />
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm reveal reveal-d2">
            <FaUserFriends className="text-xl text-[#FF8C00]" />
            <h3 className="mt-3 text-base font-extrabold text-slate-900">Landlord</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">Explore the self-managing landlord demo workspace with statements, remittances, advancements and reporting flows.</p>
            <button
              type="button"
              onClick={() => openTrialModal("landlord")}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#0B3B2E] px-4 py-2 text-xs font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white"
            >
              Enter Demo <FaArrowRight />
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm reveal reveal-d3">
            <FaHeadset className="text-xl text-[#0B3B2E]" />
            <h3 className="mt-3 text-base font-extrabold text-slate-900">Existing User</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">Go straight to the live app login when your company has already been onboarded into MILIK.</p>
            <Link
              to="/login"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-xs font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
            >
              Open Login <FaArrowRight />
            </Link>
          </div>
        </div>
      </section>

      {/* ERP snapshots */}
      <section className="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-6 shadow-sm sm:px-7">
          <div className="max-w-2xl reveal">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What every module shares</p>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">One accounting layer under everything — not an optional extra.</h2>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {erpSnapshots.map((snapshot, index) => (
              <div key={snapshot.title} className={`erp-snapshot-card erp-snapshot-card-${index + 1} rounded-2xl border border-slate-200 p-5 shadow-sm reveal reveal-d${index + 1}`}>
                <div className={`inline-flex rounded-xl bg-slate-50 p-2.5 text-xl ${snapshot.accent}`}>{snapshot.icon}</div>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{snapshot.title}</p>
                <h3 className="mt-2 text-xl font-extrabold text-slate-900">{snapshot.value}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{snapshot.description}</p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="erp-snapshot-bar h-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules section */}
      <section id="modules" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="max-w-2xl reveal">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Choose your module</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Pick the module that fits your business. Accounting comes with it.</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">Take one module or stack multiple — property, car wash, HR, inventory, property sales. Each runs independently and each includes a full accounting layer: Chart of Accounts, journals, Trial Balance and financial reports. Standard.</p>
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 reveal">
          {modules.map((mod, idx) => (
            <Link
              key={mod.title}
              to={mod.href}
              className={`module-card group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition reveal reveal-d${idx + 1}`}
            >
              <div className={`inline-flex rounded-xl p-2.5 text-xl ${mod.bg} ${mod.color}`}>{mod.icon}</div>
              <h3 className="mt-3 text-sm font-extrabold text-slate-900">{mod.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{mod.description}</p>
              <p className={`mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] ${mod.color}`}>
                Explore module <FaArrowRight className="text-[9px]" />
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="max-w-2xl reveal">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What every module includes</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Every module ships with a full accounting backbone. It's not an add-on — it's built in.</h2>
        </div>
        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature, idx) => (
            <div key={feature.title} className={`feature-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm reveal reveal-d${idx + 1}`}>
              <div className="inline-flex rounded-xl bg-[#0B3B2E]/10 p-2.5 text-xl text-[#0B3B2E]">{feature.icon}</div>
              <h3 className="mt-4 text-base font-extrabold text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-white py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

          {/* Section header */}
          <div className="max-w-3xl reveal">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Pricing</p>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">One price per module. Accounting always included.</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">Choose the module your business needs. Every module activates independently and ships with a full accounting backbone — Chart of Accounts, Trial Balance and financial reports — at no extra cost.</p>
          </div>

          {/* Module pricing overview cards */}
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {modulePricing.map((mod, idx) => (
              <div
                key={mod.title}
                className={`flex flex-col rounded-2xl border p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl reveal reveal-d${idx + 1} ${
                  mod.featured
                    ? "border-[#0B3B2E] bg-[linear-gradient(180deg,rgba(11,59,46,0.06)_0%,#ffffff_100%)] ring-1 ring-[#0B3B2E]/10"
                    : "border-slate-200 bg-[#f8faf9]"
                }`}
              >
                <div className={`inline-flex rounded-xl p-2.5 text-xl ${mod.bg} ${mod.color}`}>{mod.icon}</div>
                <h3 className="mt-3 text-sm font-extrabold text-slate-900">{mod.title}</h3>
                <p className="mt-1.5 flex-1 text-xs leading-5 text-slate-600">{mod.desc}</p>
                <div className="mt-4">
                  <p className={`text-lg font-extrabold ${mod.featured ? "text-[#0B3B2E]" : "text-slate-800"}`}>{mod.price}</p>
                  {mod.priceMeta ? <p className="text-xs text-slate-500">{mod.priceMeta}</p> : null}
                  <p className="mt-0.5 text-xs text-slate-400">{mod.note}</p>
                </div>
                {mod.contact ? (
                  <a
                    href="mailto:miliksystem@gmail.com?subject=Milik%20Module%20Pricing%20Enquiry"
                    className={`mt-5 inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] transition ${mod.color} border-current hover:opacity-80`}
                  >
                    {mod.cta} <FaArrowRight className="text-[10px]" />
                  </a>
                ) : (
                  <a
                    href="#pricing-pm"
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-white transition hover:bg-[#0A3127]"
                  >
                    {mod.cta} <FaArrowRight className="text-[10px]" />
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* PM detailed tiers */}
          <div id="pricing-pm" className="mt-10 scroll-mt-24">
            <div className="mb-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-slate-200" />
              <p className="flex-shrink-0 rounded-full border border-[#0B3B2E]/20 bg-[#0B3B2E]/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#0B3B2E]">Property Management — Detailed Plans</p>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <p className="mb-6 max-w-2xl text-sm leading-7 text-slate-600">All plans include the full accounting backbone — Chart of Accounts, journals, Trial Balance and financial reports. Pricing is tiered by the number of rental units you manage.</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {pricingTiers.map((tier, idx) => (
                <div
                  key={tier.label}
                  className={`flex h-full flex-col rounded-2xl border p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl reveal reveal-d${idx + 1} ${
                    tier.featured
                      ? "pricing-featured border-[#0B3B2E] bg-[linear-gradient(180deg,rgba(11,59,46,0.06)_0%,#ffffff_100%)] ring-1 ring-[#0B3B2E]/10"
                      : "border-slate-200 bg-[#f8faf9]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#FF8C00]">{tier.label}</p>
                      <h3 className="mt-2 text-base font-extrabold text-slate-950">{tier.units}</h3>
                    </div>
                    {tier.featured ? (
                      <span className="rounded-full bg-[#0B3B2E] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-white">Popular</span>
                    ) : null}
                  </div>
                  <p className="mt-4 text-2xl font-extrabold text-slate-950">{tier.price}</p>
                  <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">{tier.helper}</p>
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className={`mt-5 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
                      tier.featured
                        ? "bg-[#0B3B2E] text-white hover:bg-[#0A3127]"
                        : "border border-slate-300 bg-white text-slate-800 hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                    }`}
                  >
                    {tier.cta} <FaArrowRight />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Other modules contact banner */}
          <div className="mt-8 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-[#0B3B2E] to-slate-900 px-6 py-8 text-white shadow-lg">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Car Wash · HR · Inventory &amp; POS · Property Sales</p>
                <h3 className="mt-2 text-lg font-extrabold sm:text-xl">Need pricing for another module? Talk to us.</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/80">Each module is priced per business based on size, usage and whether you're bundling multiple modules. Contact us for a tailored quote — same-day response.</p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-3">
                <a
                  href="mailto:miliksystem@gmail.com?subject=Milik%20Module%20Pricing%20Enquiry"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#0B3B2E] transition hover:bg-slate-100"
                >
                  Email us <FaArrowRight />
                </a>
                <a
                  href="https://wa.me/254141455841?text=Hello%20Milik,%20I%27d%20like%20a%20pricing%20quote."
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  <FaWhatsapp /> WhatsApp
                </a>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-white py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">How the demo works</p>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">From first look to live workspace — here's how it works.</h2>
          </div>
          <div className="mt-7 grid gap-4 lg:grid-cols-3">
            {steps.map((step) => (
              <div key={step.title} className="rounded-2xl border border-slate-200 bg-[#f7fbf8] p-5 shadow-sm">
                <h3 className="text-base font-extrabold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-gradient-to-r from-[#0B3B2E] via-[#104F3E] to-[#0A3127] px-6 py-8 text-white shadow-2xl">
          <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#F8C471]">Built to convert</p>
              <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">See the real system before you buy — not a slide deck.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85">
                The demo workspace has sample properties, tenants, receipts, landlord statements and finance reports — everything you'd actually use, so you can judge it honestly.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <FaChartLine className="text-xl text-[#F8C471]" />
                <p className="mt-3 text-base font-extrabold">Financial clarity</p>
                <p className="mt-1.5 text-sm text-white/80">Trial Balance and Income Statement reinforce reports.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <FaClipboardList className="text-xl text-[#F8C471]" />
                <p className="mt-3 text-base font-extrabold">Operational depth</p>
                <p className="mt-1.5 text-sm text-white/80">Properties, tenants, receipts and statements show real daily value.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-white py-12">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="reveal text-center">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">FAQ</p>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Questions prospects often ask before they buy.</h2>
          </div>
          <div className="mt-7 space-y-3">
            {faqs.map((faq, index) => {
              const isOpen = activeFaq === index;
              return (
                <div key={faq.question} className="overflow-hidden rounded-2xl border border-slate-200 bg-[#f8faf9] shadow-sm">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    onClick={() => setActiveFaq(isOpen ? null : index)}
                    aria-expanded={isOpen}
                  >
                    <span className="text-sm font-bold text-slate-900">{faq.question}</span>
                    <span className="text-lg font-bold text-[#0B3B2E]">{isOpen ? "−" : "+"}</span>
                  </button>
                  {isOpen && <div className="border-t border-slate-200 px-5 py-4 text-sm leading-6 text-slate-600">{faq.answer}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="px-4 pb-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm">
          <div className="grid gap-6 lg:grid-cols-[1fr_0.7fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Ready to explore?</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Open the guided demo and show your team what Milik feels like.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Start with the property manager workspace or the self-managing landlord workspace. Both demo experiences are available now.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <button
                type="button"
                onClick={() => openTrialModal("property_manager")}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127]"
              >
                Get Free Trial <FaArrowRight />
              </button>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
              >
                Existing customer sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-[#0B3B2E] text-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Milik" className="h-10 w-10 object-contain" />
                <div>
                  <p className="font-extrabold text-white">Milik Business Suite</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Property · Car Wash · HR · Inventory</p>
                </div>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-7 text-white/60">One platform for property, car wash, HR, inventory and property sales — with a full accounting layer built into every module.</p>
              <div className="mt-5 flex gap-3">
                <a href="tel:+254141455841" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-bold text-white/80 transition hover:border-white/50 hover:text-white">
                  <FaPhoneAlt className="text-[10px]" /> 0141 455 841
                </a>
                <a href="mailto:miliksystem@gmail.com" className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-bold text-white/80 transition hover:border-white/50 hover:text-white">
                  Email us
                </a>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/40">Modules</p>
              <ul className="mt-4 space-y-3">
                {[
                  { label: "Property Management", href: "/property-management" },
                  { label: "Car Wash", href: "/car-wash" },
                  { label: "Human Resources", href: "/human-resources" },
                  { label: "Inventory & POS", href: "/inventory-pos" },
                  { label: "Property Sales", href: "/property-sales" },
                ].map((l) => (
                  <li key={l.href}>
                    <Link to={l.href} className="text-sm font-semibold text-white/65 transition hover:text-white">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/40">Platform</p>
              <ul className="mt-4 space-y-3">
                {[
                  { label: "Pricing", href: "/#pricing" },
                  { label: "How it works", href: "/#how-it-works" },
                  { label: "FAQ", href: "/#faq" },
                  { label: "Get Free Trial", href: "/#" },
                  { label: "Sign In", href: "/login" },
                ].map((l) => (
                  <li key={l.label}>
                    <Link to={l.href} className="text-sm font-semibold text-white/65 transition hover:text-white">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/40">Contact</p>
              <ul className="mt-4 space-y-3 text-sm font-semibold text-white/65">
                <li>Nairobi, Kenya</li>
                <li><a href="tel:+254141455841" className="transition hover:text-white">+254 141 455 841</a></li>
                <li><a href="mailto:miliksystem@gmail.com" className="transition hover:text-white">miliksystem@gmail.com</a></li>
                <li>
                  <a href="https://wa.me/254141455841" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 transition hover:text-white">
                    <FaWhatsapp /> WhatsApp us
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-start gap-3 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-white/40">© {new Date().getFullYear()} Milik Business Suite. All rights reserved.</p>
            <p className="text-xs text-white/40">Property · Car Wash · HR · Inventory · Sales</p>
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
