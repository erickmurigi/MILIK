import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBook, FaBuilding, FaCar, FaCheckCircle,
  FaCoins, FaFileInvoice, FaHandshake, FaMobileAlt, FaShieldAlt, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setCanonical, setOg, setTw } from "../../utils/pageMeta";
import propertyImg from "../../assets/landing/PROPERTY MANAGEMENT.png";

const SITE = "https://milikproperty.com";

const features = [
  {
    icon: <FaBuilding />,
    title: "Multi-property portfolio control",
    description: "Manage multiple properties, unit types, occupancy levels and owner relationships in one organised workspace.",
  },
  {
    icon: <FaFileInvoice />,
    title: "Automated tenant billing",
    description: "Generate invoices, apply recurring charges, record receipts and maintain accurate tenant balances without manual entry.",
  },
  {
    icon: <FaMobileAlt />,
    title: "M-PESA rent collection",
    description: "Tenants pay rent via your Paybill number and collections are automatically matched to invoices — receipts generated instantly.",
  },
  {
    icon: <FaCoins />,
    title: "Landlord statements and remittances",
    description: "Prepare owner statements, management fee deductions and remittance records from a single controlled reporting flow.",
  },
  {
    icon: <FaBook />,
    title: "Full financial reporting",
    description: "Access Trial Balance, Income Statement and Balance Sheet generated directly from your daily property operations.",
  },
  {
    icon: <FaShieldAlt />,
    title: "Role-based access control",
    description: "Assign Property Manager, Accountant, Agent and Viewer roles to each staff member with fine-grained permissions.",
  },
];

const useCases = [
  {
    title: "Property management companies",
    description: "Run multiple landlord portfolios, produce monthly statements, manage agents and maintain an accurate accounting ledger — all from one controlled workspace.",
  },
  {
    title: "Individual and self-managing landlords",
    description: "Manage bedsitters, apartments or commercial units yourself — track tenants, collect rent via M-PESA and produce owner-ready financial reports.",
  },
  {
    title: "Mixed-use and commercial property managers",
    description: "Handle residential, commercial and mixed-use units under one workspace with utility billing and variable charge structures per unit.",
  },
];

const highlights = [
  "M-PESA Paybill rent collection, auto-matched",
  "Per-landlord statements and remittances",
  "Trial Balance and Income Statement built in",
];

const otherModules = [
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash", color: "text-sky-700", bg: "bg-sky-50" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources", color: "text-violet-700", bg: "bg-violet-50" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos", color: "text-orange-700", bg: "bg-orange-50" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales", color: "text-emerald-700", bg: "bg-emerald-50" },
];

export default function PropertyPage() {
  useEffect(() => {
    setTitle("Property Management Software Kenya — Tenant Billing & M-PESA | Milik");
    setDesc("Milik Property Management Software for Kenya — manage properties, tenants, M-PESA rent collection and landlord statements in one workspace. From KES 3,500/month.");
    setCanonical(`${SITE}/property-management`);
    setOg("og:title", "Property Management Software Kenya | Milik");
    setOg("og:description", "Manage properties, tenants, M-PESA rent collection and landlord statements in one workspace. Built for Kenyan property managers.");
    setOg("og:url", `${SITE}/property-management`);
    setOg("og:type", "website");
    setOg("og:image", `${SITE}/logo.png`);
    setTw("twitter:title", "Property Management Software Kenya | Milik");
    setTw("twitter:description", "Manage properties, tenants, M-PESA rent collection and landlord statements in one workspace. Built for Kenya.");
    setTw("twitter:image", `${SITE}/logo.png`);
  }, []);

  return (
    <ModulePageShell>
      {(openTrialModal) => (
        <>
          {/* Hero */}
          <section className="relative overflow-hidden bg-gradient-to-br from-[#ECF6F1] via-white to-white">
            <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
              <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
                <div>
                  <div className="inline-flex items-center gap-3 rounded-full border border-[#0B3B2E]/15 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-[#0B3B2E] shadow-sm">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#0B3B2E]/10 text-[#0B3B2E]">
                      <FaBuilding className="text-[10px]" />
                    </span>
                    Property Management
                  </div>
                  <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-[-0.03em] text-slate-950 sm:text-5xl lg:text-[3.5rem]">
                    Property management software built for Kenya — billing, M-PESA and landlord reporting in one place.
                  </h1>
                  <p className="mt-5 text-lg leading-8 text-slate-600">
                    Milik gives property managers and landlords the tools to run a tight, professional operation — tenant invoicing, M-PESA Paybill integration, landlord statements and full financial reporting, all from one login.
                  </p>
                  <div className="mt-8 flex flex-wrap gap-4">
                    <button
                      type="button"
                      onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127]"
                    >
                      Get Free Trial <FaArrowRight />
                    </button>
                    <Link
                      to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3.5 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                    >
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-8 grid gap-3 sm:grid-cols-3">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-[#0B3B2E]" />
                        <span className="text-sm font-semibold text-slate-700">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="module-hero-img-shell">
                  <div className="module-hero-img-frame">
                    <img src={propertyImg} alt="Property manager using Milik software" loading="eager" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0B3B2E]/40 via-transparent to-transparent" />
                    <div className="module-hero-badge bg-[#0B3B2E]/90 text-white">
                      <div>
                        <p className="module-hero-badge-title">Property Management</p>
                      </div>
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                        <FaBuilding />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Features */}
          <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A full property management system — from unit to landlord statement.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">Everything a property manager needs to run a professional operation, in one workspace with a full accounting layer underneath.</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-2xl bg-[#0B3B2E]/10 p-3 text-2xl text-[#0B3B2E]">{f.icon}</div>
                  <h3 className="mt-5 text-lg font-extrabold text-slate-900">{f.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{f.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Use cases */}
          <section className="bg-white py-20">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="max-w-2xl">
                <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Who uses it</p>
                <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Built for Kenyan property professionals.</h2>
              </div>
              <div className="mt-10 grid gap-6 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-[28px] border border-slate-200 bg-[#f7fbf8] p-6 shadow-sm">
                    <h3 className="text-lg font-extrabold text-slate-900">{uc.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{uc.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Other modules */}
          <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Other modules</p>
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Each module activates independently — accounting always included.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">Take any module your business needs today. Every module comes with the full accounting backbone — Chart of Accounts, Trial Balance and financial reports — at no extra cost.</p>
            </div>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {otherModules.map((mod) => (
                <Link
                  key={mod.href}
                  to={mod.href}
                  className="group rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className={`inline-flex rounded-2xl p-3 text-2xl ${mod.bg} ${mod.color}`}>{mod.icon}</div>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900">{mod.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{mod.desc}</p>
                  <p className={`mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.16em] ${mod.color}`}>
                    Learn more <FaArrowRight className="text-[10px]" />
                  </p>
                </Link>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
            <div className="rounded-[36px] bg-gradient-to-r from-[#0B3B2E] via-[#104F3E] to-[#0A3127] px-8 py-12 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#F8C471]">Ready to see it in action?</p>
                <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Open the property management demo and see how it works.</h2>
                <p className="mt-4 text-sm leading-7 text-white/85">
                  Get 3-day access to a guided workspace with sample properties, tenant flows, owner statements and financial reports.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-[#0B3B2E] transition hover:bg-slate-100"
                  >
                    Get Free Trial <FaArrowRight />
                  </button>
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3.5 text-sm font-bold text-white transition hover:bg-white/10"
                  >
                    Existing customer sign in
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </ModulePageShell>
  );
}
