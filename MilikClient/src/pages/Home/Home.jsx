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
import "./home.css";

// The standalone Milik Listings site (separate deployable) — linked from the
// Public Listings spotlight section below.
const LISTINGS_SITE_URL = import.meta.env.VITE_LISTINGS_URL || "https://miliklisting.vercel.app";

const LISTING_PREVIEW_CARDS = [
  { title: "2 Bedroom, Kilimani", location: "Nairobi", price: "KES 45,000", gradient: "from-[#18A06F]/40 to-[#0B3B2E]/60" },
  { title: "Studio, Westlands", location: "Nairobi", price: "KES 22,000", gradient: "from-[#FF8C00]/40 to-[#0B3B2E]/60" },
  { title: "1 Bedroom, Kasarani", location: "Nairobi", price: "KES 18,000", gradient: "from-[#0B3B2E]/50 to-[#18A06F]/30" },
  { title: "3 Bedroom, Ruaka", location: "Kiambu", price: "KES 65,000", gradient: "from-[#FF8C00]/30 to-[#18A06F]/40" },
];

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
    num: "01",
    icon: <FaClipboardList />,
    title: "Request your free trial",
    description: "Fill a short form — your name, email, phone and the module you need. No sales call, no commitment required.",
  },
  {
    num: "02",
    icon: <FaHandshake />,
    title: "We reach out personally",
    description: "Our team contacts you within 24 hours to walk you through the system and set up your workspace with your actual configuration.",
  },
  {
    num: "03",
    icon: <FaBolt />,
    title: "Start working in your live workspace",
    description: "Once onboarded, you get your own dedicated workspace. Your data, your settings, your team — ready from day one.",
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
    cta: "Request a Free Demo",
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

const PropertyIllustration = React.memo(function PropertyIllustration() {
  return (
    <div className="hero-person-shell" aria-hidden="true">
      <div className="hero-float-stat">
        <span className="hero-float-stat-dot" />
        50+ Active businesses
      </div>

      <div className="hero-person-frame">
        <svg viewBox="0 0 380 480" fill="none" width="100%" height="100%" style={{ display: "block" }}>
          <defs>
            <linearGradient id="hSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8f5ef" />
              <stop offset="100%" stopColor="#cde8da" />
            </linearGradient>
            <linearGradient id="hBldg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#0e4535" />
              <stop offset="100%" stopColor="#0B3B2E" />
            </linearGradient>
            <linearGradient id="hGround" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b8dfc8" />
              <stop offset="100%" stopColor="#9ecdb4" />
            </linearGradient>
            <linearGradient id="hLitWin" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#dff5ea" />
            </linearGradient>
          </defs>

          {/* Sky */}
          <rect width="380" height="480" fill="url(#hSky)" />

          {/* Sun */}
          <circle cx="344" cy="42" r="28" fill="#fff9cc" opacity="0.55" />
          <circle cx="344" cy="42" r="17" fill="#ffe566" opacity="0.42" />

          {/* Clouds */}
          <ellipse cx="68" cy="56" rx="38" ry="18" fill="white" opacity="0.7" />
          <ellipse cx="98" cy="47" rx="28" ry="14" fill="white" opacity="0.7" />
          <ellipse cx="46" cy="63" rx="23" ry="12" fill="white" opacity="0.7" />
          <ellipse cx="288" cy="38" rx="30" ry="13" fill="white" opacity="0.48" />
          <ellipse cx="312" cy="30" rx="21" ry="11" fill="white" opacity="0.48" />

          {/* Background small buildings */}
          <rect x="6" y="290" width="50" height="150" rx="4" fill="#0B3B2E" opacity="0.11" />
          <rect x="324" y="300" width="50" height="140" rx="4" fill="#0B3B2E" opacity="0.1" />
          <rect x="18" y="300" width="10" height="12" rx="2" fill="white" opacity="0.2" />
          <rect x="34" y="300" width="10" height="12" rx="2" fill="white" opacity="0.2" />
          <rect x="18" y="322" width="10" height="12" rx="2" fill="white" opacity="0.2" />
          <rect x="34" y="322" width="10" height="12" rx="2" fill="white" opacity="0.2" />
          <rect x="334" y="312" width="30" height="10" rx="2" fill="white" opacity="0.15" />
          <rect x="334" y="332" width="30" height="10" rx="2" fill="white" opacity="0.15" />

          {/* Ground */}
          <rect x="0" y="418" width="380" height="62" fill="url(#hGround)" />
          <rect x="0" y="416" width="380" height="5" fill="#8ecbaa" opacity="0.65" />

          {/* Pathway */}
          <rect x="148" y="418" width="84" height="62" rx="3" fill="#c5e6d2" opacity="0.8" />
          <rect x="162" y="426" width="56" height="3" rx="1" fill="white" opacity="0.4" />
          <rect x="162" y="436" width="56" height="3" rx="1" fill="white" opacity="0.32" />
          <rect x="162" y="446" width="56" height="3" rx="1" fill="white" opacity="0.28" />

          {/* Building base shadow */}
          <rect x="66" y="420" width="248" height="10" rx="5" fill="#0B3B2E" opacity="0.11" />

          {/* ── MAIN BUILDING ── */}
          <rect x="70" y="90" width="240" height="332" rx="8" fill="url(#hBldg)" />

          {/* Roof */}
          <rect x="62" y="82" width="256" height="14" rx="6" fill="#073029" />
          <rect x="78" y="66" width="224" height="20" rx="5" fill="#082d22" />

          {/* Water tank */}
          <rect x="164" y="48" width="52" height="20" rx="4" fill="#051e14" />
          <ellipse cx="190" cy="48" rx="26" ry="11" fill="#073328" />
          <rect x="166" y="36" width="48" height="14" rx="5" fill="#082d22" />
          <rect x="186" y="58" width="5" height="10" rx="2" fill="#051e14" />
          <rect x="194" y="58" width="5" height="10" rx="2" fill="#051e14" />

          {/* Flag */}
          <rect x="189" y="12" width="3" height="26" fill="#062820" />
          <polygon points="192,12 208,18 192,24" fill="#C96F00" />

          {/* Floor dividers */}
          <rect x="70" y="170" width="240" height="5" rx="1" fill="#062820" />
          <rect x="70" y="250" width="240" height="5" rx="1" fill="#062820" />
          <rect x="70" y="330" width="240" height="5" rx="1" fill="#062820" />

          {/* ── FLOOR 4 (y 95–167) ── */}
          {/* 4-A lit */}
          <rect x="84" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="86" y="102" width="34" height="56" rx="3" fill="url(#hLitWin)" />
          <rect x="86" y="102" width="14" height="56" rx="2" fill="white" opacity="0.28" />
          {/* 4-B unlit */}
          <rect x="132" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.25" />
          <rect x="134" y="102" width="34" height="56" rx="3" fill="#0d4f38" opacity="0.82" />
          {/* 4-C lit */}
          <rect x="180" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="182" y="102" width="34" height="56" rx="3" fill="url(#hLitWin)" />
          <rect x="182" y="102" width="14" height="56" rx="2" fill="white" opacity="0.28" />
          {/* 4-D dim */}
          <rect x="228" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.28" />
          <rect x="230" y="102" width="34" height="56" rx="3" fill="#dff5ea" opacity="0.55" />

          {/* Balcony F4 */}
          <rect x="76" y="157" width="228" height="5" rx="2" fill="#C96F00" opacity="0.78" />
          <rect x="78" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
          <rect x="122" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
          <rect x="168" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
          <rect x="214" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
          <rect x="298" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />

          {/* ── FLOOR 3 (y 175–247) ── */}
          {/* 3-A unlit */}
          <rect x="84" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.25" />
          <rect x="86" y="182" width="34" height="56" rx="3" fill="#0d4f38" opacity="0.78" />
          {/* 3-B lit */}
          <rect x="132" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="134" y="182" width="34" height="56" rx="3" fill="url(#hLitWin)" />
          <rect x="134" y="182" width="14" height="56" rx="2" fill="white" opacity="0.25" />
          {/* 3-C lit */}
          <rect x="180" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="182" y="182" width="34" height="56" rx="3" fill="#dff5ea" opacity="0.88" />
          <rect x="182" y="182" width="34" height="16" rx="2" fill="white" opacity="0.32" />
          {/* 3-D lit */}
          <rect x="228" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="230" y="182" width="34" height="56" rx="3" fill="url(#hLitWin)" />

          {/* Balcony F3 */}
          <rect x="76" y="237" width="228" height="5" rx="2" fill="#C96F00" opacity="0.72" />
          <rect x="78" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="122" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="168" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="214" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="298" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />

          {/* ── FLOOR 2 (y 255–327) ── */}
          {/* 2-A lit */}
          <rect x="84" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="86" y="261" width="34" height="57" rx="3" fill="url(#hLitWin)" />
          {/* 2-B lit */}
          <rect x="132" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="134" y="261" width="34" height="57" rx="3" fill="#dff5ea" opacity="0.88" />
          <rect x="134" y="261" width="34" height="16" rx="2" fill="white" opacity="0.3" />
          <rect x="134" y="277" width="14" height="41" rx="2" fill="#c8eeda" opacity="0.55" />
          {/* 2-C unlit */}
          <rect x="180" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.25" />
          <rect x="182" y="261" width="34" height="57" rx="3" fill="#0d4f38" opacity="0.78" />
          {/* 2-D lit */}
          <rect x="228" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.35" />
          <rect x="230" y="261" width="34" height="57" rx="3" fill="url(#hLitWin)" />
          <rect x="230" y="261" width="13" height="57" rx="2" fill="white" opacity="0.28" />

          {/* Balcony F2 */}
          <rect x="76" y="317" width="228" height="5" rx="2" fill="#C96F00" opacity="0.72" />
          <rect x="78" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="122" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="168" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="214" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
          <rect x="298" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />

          {/* ── GROUND FLOOR (y 335–418) ── */}
          {/* Left shop */}
          <rect x="84" y="339" width="54" height="79" rx="4" fill="#082d22" />
          <rect x="86" y="354" width="50" height="36" rx="3" fill="#0d4f38" opacity="0.72" />
          <rect x="90" y="341" width="42" height="11" rx="3" fill="#C96F00" opacity="0.82" />

          {/* Main entrance */}
          <rect x="148" y="335" width="84" height="83" rx="6" fill="#062820" />
          <rect x="150" y="337" width="80" height="17" rx="4" fill="#0B3B2E" opacity="0.5" />
          {/* Left door */}
          <rect x="150" y="354" width="38" height="64" rx="4" fill="#18a06f" opacity="0.48" />
          {/* Right door */}
          <rect x="192" y="354" width="38" height="64" rx="4" fill="#18a06f" opacity="0.48" />
          {/* Door windows */}
          <rect x="159" y="358" width="14" height="14" rx="2" fill="#ccf0e2" opacity="0.68" />
          <rect x="207" y="358" width="14" height="14" rx="2" fill="#ccf0e2" opacity="0.68" />
          {/* Door handles */}
          <circle cx="188" cy="388" r="3" fill="#C96F00" />
          <circle cx="192" cy="388" r="3" fill="#C96F00" />

          {/* Right shop */}
          <rect x="242" y="339" width="54" height="79" rx="4" fill="#082d22" />
          <rect x="244" y="354" width="50" height="36" rx="3" fill="#0d4f38" opacity="0.72" />
          <rect x="248" y="341" width="42" height="11" rx="3" fill="#18a06f" opacity="0.58" />

          {/* Name plate */}
          <rect x="140" y="334" width="100" height="17" rx="4" fill="#062820" />
          <rect x="143" y="337" width="94" height="11" rx="3" fill="#C96F00" opacity="0.22" />

          {/* Steps */}
          <rect x="140" y="414" width="100" height="6" rx="2" fill="#062820" opacity="0.38" />
          <rect x="148" y="419" width="84" height="4" rx="2" fill="#062820" opacity="0.22" />

          {/* Corner accent dots */}
          <circle cx="76" cy="92" r="4" fill="#C96F00" opacity="0.88" />
          <circle cx="304" cy="92" r="4" fill="#C96F00" opacity="0.88" />
          <circle cx="190" cy="86" r="5" fill="#C96F00" opacity="0.82" />

          {/* ── TREES ── */}
          {/* Left tree */}
          <rect x="26" y="375" width="12" height="48" rx="4" fill="#062820" />
          <circle cx="32" cy="355" r="30" fill="#18a06f" opacity="0.78" />
          <circle cx="14" cy="369" r="18" fill="#18a06f" opacity="0.68" />
          <circle cx="50" cy="367" r="20" fill="#18a06f" opacity="0.72" />
          <circle cx="26" cy="343" r="12" fill="#28c98a" opacity="0.28" />

          {/* Right tree */}
          <rect x="342" y="382" width="10" height="42" rx="3" fill="#062820" />
          <circle cx="347" cy="366" r="24" fill="#18a06f" opacity="0.74" />
          <circle cx="332" cy="378" r="14" fill="#18a06f" opacity="0.64" />
          <circle cx="360" cy="376" r="16" fill="#18a06f" opacity="0.68" />

          {/* Base shrubs */}
          <circle cx="74" cy="420" r="11" fill="#18a06f" opacity="0.58" />
          <circle cx="62" cy="424" r="8" fill="#18a06f" opacity="0.48" />
          <circle cx="306" cy="420" r="11" fill="#18a06f" opacity="0.58" />
          <circle cx="318" cy="424" r="8" fill="#18a06f" opacity="0.48" />
        </svg>
      </div>

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
  const [cameFromListings, setCameFromListings] = React.useState(false);
  const [activeFaq, setActiveFaq] = React.useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);


  const openTrialModal = (role = "property_manager") => {
    setTrialRole(role);
    setShowTrialModal(true);
  };

  // Deep link from Milik Listings' "List with Milik" button
  // (?trial=1&role=property_manager|landlord) straight into the trial form,
  // instead of landing on the homepage and making them hunt for the CTA.
  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("trial") === "1") {
      const role = params.get("role") === "landlord" ? "landlord" : "property_manager";
      setCameFromListings(true);
      openTrialModal(role);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f8f7] text-slate-900">

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6 lg:px-8">
          <div className="relative">
            <img src="/logo.png" alt="Milik" className="h-9 w-auto object-contain" width="140" height="36" />
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
              Request a Free Demo
            </button>
            <Link to="/login" className="rounded-full border border-[#0B3B2E] px-5 py-2 text-sm font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white">Sign in</Link>
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => openTrialModal("property_manager")}
              className="rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0A3127]"
            >
              Free Trial
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(o => !o)}
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen
                ? <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                : <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect y="3" width="18" height="2" rx="1" fill="currentColor"/><rect y="8" width="18" height="2" rx="1" fill="currentColor"/><rect y="13" width="18" height="2" rx="1" fill="currentColor"/></svg>
              }
            </button>
          </div>
        </div>
        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
            <div className="flex flex-col gap-1 pt-3">
              {[
                { label: "Modules", href: "#modules" },
                { label: "Features", href: "#features" },
                { label: "Pricing", href: "#pricing" },
                { label: "How it works", href: "#how-it-works" },
                { label: "FAQ", href: "#faq" },
              ].map(l => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#0B3B2E]/5 hover:text-[#0B3B2E]"
                >
                  {l.label}
                </a>
              ))}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setMobileMenuOpen(false); openTrialModal("property_manager"); }}
                  className="flex-1 rounded-full bg-[#0B3B2E] px-4 py-2.5 text-sm font-bold text-white"
                >
                  Request Free Demo
                </button>
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 rounded-full border border-[#0B3B2E] px-4 py-2.5 text-center text-sm font-bold text-[#0B3B2E]"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {cameFromListings && (
        <div className="border-b border-[#FF8C00]/20 bg-[#FF8C00]/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row sm:px-6 lg:px-8">
            <p className="text-center text-sm font-bold text-[#0B3B2E] sm:text-left">
              👋 Coming from Milik Listings — list your vacant units and get seen by renters searching right now.
            </p>
            <button
              type="button"
              onClick={() => openTrialModal(trialRole)}
              className="inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#0A3127]"
            >
              List My Properties
              <FaArrowRight />
            </button>
          </div>
        </div>
      )}

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
                Request a Free Demo
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
              <PropertyIllustration />
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

      {/* Entry cards */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm reveal reveal-d1">
            <FaBuilding className="text-xl text-[#0B3B2E]" />
            <h3 className="mt-3 text-base font-extrabold text-slate-900">Property Manager</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">Manage properties, tenants, rent receipts, owner statements and finance reports — we set up your workspace and walk you through it.</p>
            <button
              type="button"
              onClick={() => openTrialModal("property_manager")}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0A3127]"
            >
              Request a Free Demo <FaArrowRight />
            </button>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm reveal reveal-d2">
            <FaUserFriends className="text-xl text-[#FF8C00]" />
            <h3 className="mt-3 text-base font-extrabold text-slate-900">Landlord</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">Self-manage your properties with statements, remittances, advancements and reporting — your own workspace, configured for you.</p>
            <button
              type="button"
              onClick={() => openTrialModal("landlord")}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#0B3B2E] px-4 py-2 text-xs font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white"
            >
              Request a Free Demo <FaArrowRight />
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

      {/* Public Listings */}
      <section id="listings" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="reveal grid grid-cols-1 items-center gap-8 overflow-hidden rounded-3xl bg-[#0B3B2E] p-8 text-white lg:grid-cols-2 lg:p-12">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-[#FF8C00]">
              <FaBolt /> Included with Property Management
            </p>
            <h2 className="mt-4 text-2xl font-extrabold leading-tight sm:text-3xl">
              Your vacant units, seen by renters searching right now
            </h2>
            <p className="mt-3 text-sm leading-7 text-white/70">
              Every property manager and landlord on Milik can publish vacant units to Milik Listings — a
              dedicated rental search site — at no extra cost while it&apos;s new. More people search for a
              place to rent every day than ever search for property management software, so your units get
              found without you spending anything extra on marketing.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-white/80">
              <li className="flex items-center gap-2"><FaCheckCircle className="flex-shrink-0 text-[#FF8C00]" /> Toggle a unit public and it&apos;s live — no separate setup</li>
              <li className="flex items-center gap-2"><FaCheckCircle className="flex-shrink-0 text-[#FF8C00]" /> Inquiries land as leads in your dashboard, not lost DMs</li>
              <li className="flex items-center gap-2"><FaCheckCircle className="flex-shrink-0 text-[#FF8C00]" /> A verified badge builds renter trust over informal listings</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={LISTINGS_SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[#FF8C00] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-orange-600"
              >
                Browse Live Listings <FaArrowRight />
              </a>
              <button
                type="button"
                onClick={() => openTrialModal("property_manager")}
                className="inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
              >
                List My Properties
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {LISTING_PREVIEW_CARDS.map((card) => (
              <div key={card.title} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className={`h-20 rounded-xl bg-gradient-to-br ${card.gradient}`} />
                <p className="mt-3 text-xs font-bold text-white">{card.title}</p>
                <p className="text-[11px] text-white/60">{card.location}</p>
                <p className="mt-1.5 text-sm font-extrabold text-[#FF8C00]">{card.price}<span className="text-[10px] font-medium text-white/50">/mo</span></p>
              </div>
            ))}
          </div>
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
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">How it works</p>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">From your first request to a live workspace — here's how we get you started.</h2>
          </div>
          <div className="mt-7 grid gap-4 lg:grid-cols-3">
            {steps.map((step, idx) => (
              <div key={step.title} className="relative rounded-2xl border border-slate-200 bg-[#f7fbf8] p-6 shadow-sm overflow-hidden reveal reveal-d1">
                {/* Step number watermark */}
                <span className="absolute top-3 right-4 text-6xl font-extrabold text-[#0B3B2E]/5 select-none leading-none">{step.num}</span>
                {/* Icon */}
                <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#0B3B2E] text-white text-lg mb-4">
                  {step.icon}
                </div>
                {/* Connector line on desktop */}
                {idx < steps.length - 1 && (
                  <span className="hidden lg:block absolute top-[34px] -right-3 w-6 h-0.5 bg-[#0B3B2E]/20 z-10" />
                )}
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
              <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">We show you the real system — not a slide deck.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85">
                Request a free trial and our team will walk you through the system personally — properties, tenants, receipts, landlord statements and finance reports, everything you'd actually use.
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Ready to see Milik in action? We'll set it up for you.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Request a free trial and our team will reach out to get you started — no automated signup, no waiting around.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <button
                type="button"
                onClick={() => openTrialModal("property_manager")}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127]"
              >
                Request a Free Demo <FaArrowRight />
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
                <img src="/logo.png" alt="Milik" className="h-10 w-10 object-contain" width="40" height="40" />
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
                  { label: "Request a Free Demo", href: "/#" },
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
