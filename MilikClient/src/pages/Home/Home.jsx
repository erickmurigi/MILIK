import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FaArrowRight,
  FaBook,
  FaBuilding,
  FaCar,
  FaCheckCircle,
  FaChevronDown,
  FaClipboardList,
  FaHandshake,
  FaMobileAlt,
  FaPhoneAlt,
  FaShieldAlt,
  FaUsers,
  FaWarehouse,
  FaWhatsapp,
} from "react-icons/fa";
import FreeTrialModal from "../../components/FreeTrialModal";
import MetricTile from "../../components/MetricTile";
import BrandPatternPanel from "../../components/BrandPatternPanel";
import "./home.css";

// The standalone Milik Listings site (separate deployable) — linked from
// the Public Listings section below.
const LISTINGS_SITE_URL = import.meta.env.VITE_LISTINGS_URL || "https://miliklisting.vercel.app";

const PHONE_DISPLAY = "0141 455 841";
const PHONE_TEL = "+254141455841";
const WHATSAPP_URL = "https://wa.me/254141455841?text=Hello%20Milik,%20I%27d%20like%20to%20know%20more.";
const EMAIL = "miliksystem@gmail.com";

const NAV_LINKS = [
  { label: "Modules", href: "#modules" },
  { label: "Pricing", href: "#pricing" },
  { label: "How it works", href: "#how-it-works" },
  { label: "FAQ", href: "#faq" },
];

const CAPABILITIES = [
  {
    icon: <FaMobileAlt />,
    title: "M-Pesa, matched automatically",
    description: "Payments land, match the right invoice and generate a receipt — no manual entry, no chasing confirmations.",
  },
  {
    icon: <FaBook />,
    title: "A real Chart of Accounts, always on",
    description: "Trial Balance, Income Statement and Balance Sheet update from the same transactions your team enters daily.",
  },
  {
    icon: <FaUsers />,
    title: "Role-based access, team-wide",
    description: "Managers, accountants, agents and field staff each see exactly what their role needs. Nothing more.",
  },
  {
    icon: <FaShieldAlt />,
    title: "Reports built for Kenya",
    description: "Landlord remittance statements, aged receivables and rental tax reports, ready whenever an owner or KRA asks.",
  },
];

const MODULES = [
  {
    icon: <FaBuilding />,
    title: "Property Management",
    description: "Tenant billing, M-Pesa rent collection, landlord statements and full financial reporting.",
    href: "/property-management",
  },
  {
    icon: <FaCar />,
    title: "Car Wash",
    description: "Job tracking, vehicle plates, staff commissions and a loyalty program that runs itself.",
    href: "/car-wash",
  },
  {
    icon: <FaUsers />,
    title: "Human Resources",
    description: "Employee records, leave approvals, payroll runs and KPI appraisals, in one place.",
    href: "/human-resources",
  },
  {
    icon: <FaWarehouse />,
    title: "Inventory & POS",
    description: "Stock levels, purchase orders, supplier tracking and till reconciliation at point of sale.",
    href: "/inventory-pos",
  },
  {
    icon: <FaHandshake />,
    title: "Property Sales",
    description: "Listings, buyers, deal pipeline and agent commissions, tracked start to close.",
    href: "/property-sales",
  },
];

const ACCOUNTING_POINTS = [
  "Every receipt, invoice and payroll run posts to the Chart of Accounts the moment it happens.",
  "Landlord statements calculate management fees and remittances automatically — no spreadsheet math.",
  "Trial Balance, Income Statement and Balance Sheet are always current, never a month-end scramble.",
];

const MODULE_PRICING = [
  {
    icon: <FaBuilding />,
    title: "Property Management",
    moduleKey: "property_management",
    description: "Tenant billing, M-Pesa collection, landlord statements and full financial reporting.",
    price: "From KES 3,500",
    priceMeta: "/ month",
    note: "Tiered by rental unit count — talk to us for your bracket",
    featured: true,
    cta: "Request a Free Demo",
  },
  {
    icon: <FaCar />,
    title: "Car Wash",
    moduleKey: "car_wash",
    description: "Job tracking, vehicle plates, loyalty program and staff commissions.",
    price: "Tailored pricing",
    note: "Priced per business",
    cta: "Request quote",
  },
  {
    icon: <FaUsers />,
    title: "Human Resources",
    moduleKey: "human_resources",
    description: "Employee records, payroll processing, leave and KPI appraisals.",
    price: "Tailored pricing",
    note: "Priced per business",
    cta: "Request quote",
  },
  {
    icon: <FaWarehouse />,
    title: "Inventory & POS",
    moduleKey: "inventory_pos",
    description: "Stock management, purchase orders, POS and till reconciliation.",
    price: "Tailored pricing",
    note: "Priced per business",
    cta: "Request quote",
  },
  {
    icon: <FaHandshake />,
    title: "Property Sales",
    moduleKey: "property_sales",
    description: "Listings, buyer management, deal pipeline and commissions.",
    price: "Tailored pricing",
    note: "Priced per business",
    cta: "Request quote",
  },
];

const STEPS = [
  {
    num: "01",
    icon: <FaClipboardList />,
    title: "Request your free demo",
    description: "Tell us which modules your business needs. No sales call required to get started.",
  },
  {
    num: "02",
    icon: <FaHandshake />,
    title: "We reach out personally",
    description: "Our team contacts you within 24 hours to walk you through the system and set up your workspace.",
  },
  {
    num: "03",
    icon: <FaCheckCircle />,
    title: "Start in your live workspace",
    description: "Your data, your settings, your team — ready from day one, no generic sandbox to migrate out of later.",
  },
];

const LISTING_SAMPLES = [
  { title: "2 Bedroom · Kilimani, Nairobi", price: "KES 45,000 / mo" },
  { title: "Studio · Westlands, Nairobi", price: "KES 22,000 / mo" },
  { title: "3 Bedroom · Ruaka, Kiambu", price: "KES 65,000 / mo" },
  { title: "Bedsitter · Kasarani, Nairobi", price: "KES 12,000 / mo" },
  { title: "1 Bedroom · Nyali, Mombasa", price: "KES 28,000 / mo" },
];

const FAQS = [
  {
    question: "What is Milik?",
    answer: "A business management system built for Kenya — property management, car wash, HR, inventory and property sales, each with a proper accounting layer underneath.",
  },
  {
    question: "Which modules does Milik include?",
    answer: "Property Management (tenant billing, M-Pesa collections, landlord statements), Car Wash (job tracking, loyalty, commissions), HR (payroll, leave, appraisals), Inventory & POS (stock, purchase orders, point of sale) and Property Sales (listings, buyers, agents, deal pipeline). You only activate what your business needs.",
  },
  {
    question: "Does Milik work with M-Pesa for rent collection?",
    answer: "Yes — it's one of the most-used features. Tenants pay rent to your M-Pesa Paybill number, Milik matches the payment to the right invoice and generates a receipt automatically.",
  },
  {
    question: "How much does Milik cost?",
    answer: "Property Management starts at KES 3,500/month and scales with the number of units you manage, up through larger portfolios — request a free demo and we'll quote your exact bracket. Car Wash, HR, Inventory and Property Sales are priced per business — contact us for a quote.",
  },
  {
    question: "Can I manage multiple landlords and properties in one workspace?",
    answer: "Yes, with no limit on landlords or properties. Bedsitters, apartments, commercial and mixed-use can sit under one login, and each landlord gets their own statement, commission deduction and remittance record.",
  },
  {
    question: "Does the car wash module have a loyalty program?",
    answer: "Yes. Customers are tracked by vehicle plate, stamps are awarded per job, and the reward is applied automatically once they hit your set threshold — with an SMS sent to the customer.",
  },
  {
    question: "What financial reports does Milik produce?",
    answer: "Trial Balance, Income Statement, Balance Sheet, landlord remittance statements, rental collection summaries, aged receivables and rental tax (MRI) reports — all from the same accounting data.",
  },
  {
    question: "How many users can access the same Milik workspace?",
    answer: "As many as your plan supports. Each user gets their own login with a role — Administrator, Manager, Accountant, Agent or Viewer — and permissions are set per module.",
  },
];

/** Section eyebrow label — small bold orange uppercase tag used above every section heading. */
function Eyebrow({ children }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">{children}</p>;
}

/** Hero's "see what Milik tracks" panel — built, not screenshotted. */
function HeroVisual() {
  return (
    <BrandPatternPanel eyebrow="What Milik tracks for you · example workspace">
      <div className="grid grid-cols-2 gap-3">
        <MetricTile label="Units managed" value="13" />
        <MetricTile label="Occupancy" value="46.2%" />
        <MetricTile label="Collected this month" value="KSh 41.0K" big accent className="col-span-2" />
        <MetricTile label="Collection rate" value="17.9%" />
        <MetricTile label="Open invoices" value="2" />
      </div>
    </BrandPatternPanel>
  );
}

/** Coded landlord-statement preview for the accounting-proof section — same
 * reasoning as HeroVisual: built, not screenshotted, so it can't go stale. */
function StatementPreview() {
  return (
    <div className="border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <img src="/milik-icon-white.png" alt="" className="h-8 w-8 flex-shrink-0 object-contain" />
          <div>
            <p className="text-sm font-extrabold">Sunset Apartments</p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/60">Property account statement</p>
          </div>
        </div>
        <p className="hidden flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60 sm:block">Example statement</p>
      </div>
      <div className="grid grid-cols-2 gap-3 p-5">
        <MetricTile label="Property" value="Sunset Apts" />
        <MetricTile label="Landlord" value="J. Mwangi" />
        <MetricTile label="Statement no." value="STMT-0042" />
        <MetricTile label="Settlement due" value="KSh 82,400" accent />
      </div>
    </div>
  );
}

function Home() {
  const location = useLocation();
  const [showTrialModal, setShowTrialModal] = React.useState(false);
  const [trialModules, setTrialModules] = React.useState([]);
  const [cameFromListings, setCameFromListings] = React.useState(false);
  const [openFaq, setOpenFaq] = React.useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  // Opens the demo modal, optionally pre-selecting a module (e.g. clicking
  // "Request quote" on the Car Wash pricing card should land step 1 with
  // Car Wash already checked, not a blank module picker).
  const openTrialModal = (moduleKeys = []) => {
    setTrialModules(moduleKeys);
    setShowTrialModal(true);
  };

  // Deep link from Milik Listings' "List with Milik" button (?trial=1)
  // straight into the demo request form, instead of making prospects hunt
  // for the CTA.
  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("trial") === "1") {
      setCameFromListings(true);
      openTrialModal(["property_management"]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="relative inline-flex items-center">
            <img src="/logo.png" alt="Milik" className="h-8 w-auto object-contain" width="130" height="32" />
            <span className="milik-live-dot ml-2 h-2 w-2 rounded-full bg-[#18a06f]" title="System live" />
          </div>

          <div className="hidden items-center gap-7 md:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-semibold text-slate-600 transition hover:text-[#0B3B2E]">
                {l.label}
              </a>
            ))}
            <Link to="/login" className="border border-[#0B3B2E] px-4 py-2 text-sm font-bold text-[#0B3B2E] transition hover:bg-[#0B3B2E] hover:text-white">
              Sign in
            </Link>
            <button
              type="button"
              onClick={() => openTrialModal()}
              className="border border-[#0B3B2E] bg-[#0B3B2E] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#0A3127]"
            >
              Request a Free Demo
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((o) => !o)}
            className="flex h-9 w-9 items-center justify-center border border-slate-300 bg-white text-slate-700 md:hidden"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen
              ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 1l14 14M15 1L1 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect y="2" width="16" height="2" fill="currentColor" /><rect y="7" width="16" height="2" fill="currentColor" /><rect y="12" width="16" height="2" fill="currentColor" /></svg>}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 pb-4 md:hidden">
            <div className="flex flex-col gap-1 pt-3">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#0B3B2E]"
                >
                  {l.label}
                </a>
              ))}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setMobileMenuOpen(false); openTrialModal(); }}
                  className="flex-1 border border-[#0B3B2E] bg-[#0B3B2E] px-4 py-2.5 text-sm font-bold text-white"
                >
                  Request a Free Demo
                </button>
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 border border-[#0B3B2E] px-4 py-2.5 text-center text-sm font-bold text-[#0B3B2E]"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {cameFromListings && (
        <div className="border-b border-[#FF8C00]/30 bg-[#FF8C00]/10">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-3 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8">
            <p className="text-sm font-bold text-[#0B3B2E]">
              Coming from Milik Listings — tell us about your properties below and we'll set you up to list vacant units.
            </p>
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      <section className="border-b border-slate-200 bg-[#f7faf8]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-start lg:gap-14 lg:px-8 lg:py-16">
          <div>
            <div className="inline-flex items-center gap-2 border border-[#0B3B2E]/15 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-[#0B3B2E]">
              Business management software · Kenya
            </div>
            <h1 className="mt-4 text-3xl font-extrabold leading-[1.1] tracking-tight text-slate-950 sm:text-4xl lg:text-[2.75rem]">
              Collect rent by M-Pesa. Run payroll, stock and sales. One system, one set of books.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
              Milik matches every M-Pesa payment to the right invoice automatically and posts it straight to a proper Chart of Accounts. Property, car wash, HR, inventory, sales — one login, real financial reports, no spreadsheets stitched together at month-end.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openTrialModal()}
                className="inline-flex items-center gap-2 border border-[#0B3B2E] bg-[#0B3B2E] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0A3127]"
              >
                Request a Free Demo <FaArrowRight />
              </button>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
              >
                Existing customer sign in
              </Link>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`tel:${PHONE_TEL}`} className="inline-flex items-center gap-2 border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]">
                <FaPhoneAlt className="text-[11px]" /> Call {PHONE_DISPLAY}
              </a>
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-[#18a06f]/30 bg-[#18a06f]/10 px-3.5 py-2 text-xs font-bold text-[#0B3B2E] transition hover:bg-[#18a06f] hover:text-white">
                <FaWhatsapp className="text-sm" /> WhatsApp {PHONE_DISPLAY}
              </a>
            </div>
          </div>

          <HeroVisual />
        </div>
      </section>

      {/* ── Capability strip ── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((cap) => (
            <div key={cap.title} className="bg-white p-6">
              <div className="inline-flex border border-slate-200 bg-slate-50 p-2.5 text-lg text-[#0B3B2E]">{cap.icon}</div>
              <h3 className="mt-3 text-sm font-extrabold text-slate-900">{cap.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Modules ── */}
      <section id="modules" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <Eyebrow>Choose your module</Eyebrow>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Pick the module that fits your business. Accounting comes with it.</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            Take one module or stack several. Each runs independently and every one includes a full accounting layer — Chart of Accounts, journals, Trial Balance and financial reports.
          </p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {MODULES.map((mod) => (
            <Link
              key={mod.title}
              to={mod.href}
              className="group border border-slate-200 bg-white p-5 transition hover:border-[#0B3B2E]"
            >
              <div className="inline-flex border border-slate-200 bg-slate-50 p-2.5 text-lg text-[#0B3B2E]">{mod.icon}</div>
              <h3 className="mt-3 text-sm font-extrabold text-slate-900">{mod.title}</h3>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{mod.description}</p>
              <p className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">
                Explore module <FaArrowRight className="text-[9px] transition group-hover:translate-x-0.5" />
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Accounting proof ── */}
      <section className="border-y border-slate-200 bg-[#f7faf8]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
          <div>
            <Eyebrow>Not an add-on</Eyebrow>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Every receipt becomes a journal entry. Automatically.</h2>
            <ul className="mt-5 space-y-3">
              {ACCOUNTING_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm leading-6 text-slate-700">
                  <FaCheckCircle className="mt-1 flex-shrink-0 text-[#0B3B2E]" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <StatementPreview />
        </div>
      </section>

      {/* ── Listings cross-promo ── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-8 border border-[#0B3B2E] bg-[#0B3B2E] p-8 text-white lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:p-12">
          <div>
            <p className="inline-flex items-center gap-2 border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">
              Included with Property Management
            </p>
            <h2 className="mt-4 text-2xl font-extrabold leading-tight sm:text-3xl">Your vacant units, seen by renters searching right now.</h2>
            <p className="mt-3 text-sm leading-7 text-white/75">
              Every property manager and landlord on Milik can publish vacant units to Milik Listings — a dedicated rental search site — at no extra cost. More people search for a place to rent every day than search for property management software, so your units get found without extra marketing spend.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-white/85">
              <li className="flex items-center gap-2"><FaCheckCircle className="flex-shrink-0 text-[#FF8C00]" /> Toggle a unit public and it's live — no separate setup</li>
              <li className="flex items-center gap-2"><FaCheckCircle className="flex-shrink-0 text-[#FF8C00]" /> Inquiries land as leads in your dashboard, not lost DMs</li>
              <li className="flex items-center gap-2"><FaCheckCircle className="flex-shrink-0 text-[#FF8C00]" /> A verified badge builds renter trust over informal listings</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={LISTINGS_SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border border-[#FF8C00] bg-[#FF8C00] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#e67e00]"
              >
                Browse Live Listings <FaArrowRight />
              </a>
              <button
                type="button"
                onClick={() => openTrialModal(["property_management"])}
                className="inline-flex items-center gap-2 border border-white/40 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
              >
                List My Properties
              </button>
            </div>
          </div>

          <div className="flex flex-col divide-y divide-white/10 border border-white/15 bg-white/5">
            {LISTING_SAMPLES.map((row) => (
              <div key={row.title} className="flex items-center justify-between gap-3 px-4 py-3.5">
                <span className="text-xs font-semibold text-white/90">{row.title}</span>
                <span className="text-xs font-extrabold text-[#FF8C00]">{row.price}</span>
              </div>
            ))}
            <div className="px-4 py-3.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              + live units from Milik customers
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="border-y border-slate-200 bg-white py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">One price per module. Accounting always included.</h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Choose the module your business needs. Every module activates independently and ships with a full accounting backbone — Chart of Accounts, Trial Balance and financial reports — at no extra cost.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {MODULE_PRICING.map((mod) => (
              <div
                key={mod.title}
                className={`flex flex-col border p-5 ${mod.featured ? "border-[#0B3B2E] bg-[#0B3B2E]/[0.03]" : "border-slate-200 bg-white"}`}
              >
                <div className="inline-flex border border-slate-200 bg-slate-50 p-2.5 text-lg text-[#0B3B2E]">{mod.icon}</div>
                <h3 className="mt-3 text-sm font-extrabold text-slate-900">{mod.title}</h3>
                <p className="mt-1.5 flex-1 text-xs leading-5 text-slate-600">{mod.description}</p>
                <div className="mt-4">
                  <p className="text-lg font-extrabold text-slate-900">{mod.price}</p>
                  {mod.priceMeta ? <p className="text-xs text-slate-500">{mod.priceMeta}</p> : null}
                  <p className="mt-0.5 text-xs text-slate-400">{mod.note}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openTrialModal([mod.moduleKey])}
                  className={`mt-4 inline-flex items-center justify-center gap-2 border border-[#0B3B2E] px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                    mod.featured ? "bg-[#0B3B2E] text-white hover:bg-[#0A3127]" : "text-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"
                  }`}
                >
                  {mod.cta} <FaArrowRight className="text-[10px]" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-10 border border-slate-800 bg-slate-900 p-6 text-white sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Car Wash · HR · Inventory & POS · Property Sales</p>
                <h3 className="mt-2 text-lg font-extrabold sm:text-xl">Need pricing for another module? Talk to us.</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Each module is priced per business based on size, usage and whether you're bundling multiple modules — same-day response.</p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-3">
                <a href={`mailto:${EMAIL}?subject=Milik%20Module%20Pricing%20Enquiry`} className="inline-flex items-center gap-2 border border-white bg-white px-5 py-2.5 text-sm font-bold text-[#0B3B2E] transition hover:bg-slate-100">
                  Email us <FaArrowRight />
                </a>
                <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 border border-white/40 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/10">
                  <FaWhatsapp /> WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">From your first request to a live workspace.</h2>
        </div>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className="relative border border-slate-200 bg-[#f7faf8] p-6">
              <span className="absolute right-4 top-3 select-none text-5xl font-extrabold leading-none text-[#0B3B2E]/[0.06]">{step.num}</span>
              <div className="inline-flex h-10 w-10 items-center justify-center border border-[#0B3B2E] bg-[#0B3B2E] text-base text-white">
                {step.icon}
              </div>
              <h3 className="mt-4 text-base font-extrabold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="border-t border-slate-200 bg-[#f7faf8] py-14">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Questions prospects often ask before they buy.</h2>
          </div>
          <div className="mt-8 divide-y divide-slate-200 border border-slate-200 bg-white">
            {FAQS.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={faq.question}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    aria-expanded={isOpen}
                  >
                    <span className="text-sm font-bold text-slate-900">{faq.question}</span>
                    <FaChevronDown className={`flex-shrink-0 text-xs text-[#0B3B2E] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && <div className="border-t border-slate-100 px-5 pb-4 text-sm leading-6 text-slate-600">{faq.answer}</div>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-6 border border-slate-200 bg-white p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <Eyebrow>Ready to explore?</Eyebrow>
            <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Ready to see Milik in action? We'll set it up for you.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              Request a free demo and our team will reach out personally to get you started — no automated signup, no waiting around.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => openTrialModal()}
              className="inline-flex items-center justify-center gap-2 border border-[#0B3B2E] bg-[#0B3B2E] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0A3127]"
            >
              Request a Free Demo <FaArrowRight />
            </button>
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 border border-slate-300 px-5 py-3 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
            >
              Existing customer sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 bg-[#0B3B2E] text-white">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-3">
                <img src="/milik-icon-white.png" alt="Milik" className="h-10 w-10 object-contain" width="40" height="40" />
                <div>
                  <p className="font-extrabold text-white">Milik Business Suite</p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">Property · Car Wash · HR · Inventory</p>
                </div>
              </div>
              <p className="mt-4 max-w-xs text-sm leading-7 text-white/60">
                One platform for property, car wash, HR, inventory and property sales — with a full accounting layer built into every module.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <a href={`tel:${PHONE_TEL}`} className="inline-flex items-center gap-2 border border-white/25 px-3.5 py-2 text-xs font-bold text-white/80 transition hover:border-white hover:text-white">
                  <FaPhoneAlt className="text-[10px]" /> {PHONE_DISPLAY}
                </a>
                <a href={`mailto:${EMAIL}`} className="inline-flex items-center gap-2 border border-white/25 px-3.5 py-2 text-xs font-bold text-white/80 transition hover:border-white hover:text-white">
                  Email us
                </a>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Modules</p>
              <ul className="mt-4 space-y-3">
                {MODULES.map((m) => (
                  <li key={m.href}>
                    <Link to={m.href} className="text-sm font-semibold text-white/65 transition hover:text-white">{m.title}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Platform</p>
              <ul className="mt-4 space-y-3">
                <li><a href="#pricing" className="text-sm font-semibold text-white/65 transition hover:text-white">Pricing</a></li>
                <li><a href="#how-it-works" className="text-sm font-semibold text-white/65 transition hover:text-white">How it works</a></li>
                <li><a href="#faq" className="text-sm font-semibold text-white/65 transition hover:text-white">FAQ</a></li>
                <li>
                  <button type="button" onClick={() => openTrialModal()} className="text-left text-sm font-semibold text-white/65 transition hover:text-white">
                    Request a Free Demo
                  </button>
                </li>
                <li><Link to="/login" className="text-sm font-semibold text-white/65 transition hover:text-white">Sign In</Link></li>
              </ul>
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">Contact</p>
              <ul className="mt-4 space-y-3 text-sm font-semibold text-white/65">
                <li>Nairobi, Kenya</li>
                <li><a href={`tel:${PHONE_TEL}`} className="transition hover:text-white">+254 141 455 841</a></li>
                <li><a href={`mailto:${EMAIL}`} className="transition hover:text-white">{EMAIL}</a></li>
                <li>
                  <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 transition hover:text-white">
                    <FaWhatsapp /> WhatsApp us
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-start gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-white/40">© {new Date().getFullYear()} Milik Business Suite. All rights reserved.</p>
            <p className="text-xs text-white/40">Property · Car Wash · HR · Inventory · Sales</p>
          </div>
        </div>
      </footer>

      <FreeTrialModal isOpen={showTrialModal} onClose={() => setShowTrialModal(false)} initialModules={trialModules} />
    </div>
  );
}

export default Home;
