import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBook, FaBuilding, FaCar, FaCheckCircle,
  FaCoins, FaFileInvoice, FaHandshake, FaMobileAlt, FaShieldAlt, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import MetricTile from "../../components/MetricTile";
import BrandPatternPanel from "../../components/BrandPatternPanel";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";

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
  "Rent invoices generated and sent automatically",
  "M-PESA payments matched to tenants instantly",
  "Landlord statements generated on demand",
  "Vacancy tracking across all your units",
  "Late payment penalties applied automatically",
  "Full accounting — trial balance, income statement",
];

const otherModules = [
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales" },
];

export default function PropertyPage() {
  useEffect(() => {
    const url = `${SITE}/property-management`;
    setTitle("Property Management Software Kenya — Tenant Billing & M-PESA | Milik");
    setDesc("Milik Property Management Software for Kenya — manage properties, tenants, M-PESA rent collection and landlord statements in one workspace. From KES 3,500/month.");
    setKeywords("property management software Kenya, tenant billing software Kenya, M-PESA rent collection, landlord statement software Kenya, property management system Nairobi, rental management software Kenya, bedsitter management software Kenya, apartment management system Kenya, property manager software, rent collection software Kenya");
    setCanonical(url);
    setOg("og:type", "website");
    setOg("og:site_name", "Milik");
    setOg("og:locale", "en_KE");
    setOg("og:title", "Property Management Software Kenya | Milik");
    setOg("og:description", "Manage properties, tenants, M-PESA rent collection and landlord statements in one workspace. Built for Kenyan property managers.");
    setOg("og:url", url);
    setOg("og:image", `${SITE}/og-image.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Property Management Software Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Property Management Software Kenya | Milik");
    setTw("twitter:description", "Manage properties, tenants, M-PESA rent collection and landlord statements in one workspace. Built for Kenya.");
    setTw("twitter:image", `${SITE}/og-image.png`);
    setSchema("page", {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE}/` },
            { "@type": "ListItem", "position": 2, "name": "Property Management Software Kenya", "item": url }
          ]
        },
        {
          "@type": "WebPage",
          "@id": url,
          "name": "Property Management Software Kenya — Tenant Billing & M-PESA | Milik",
          "description": "Cloud-based property management software for Kenya — automated tenant billing, M-PESA rent collection, landlord statements and full accounting reports.",
          "url": url,
          "inLanguage": "en-KE",
          "isPartOf": { "@type": "WebSite", "url": SITE, "name": "Milik" }
        },
        {
          "@type": "SoftwareApplication",
          "name": "Milik Property Management",
          "applicationCategory": "BusinessApplication",
          "applicationSubCategory": "Property Management Software",
          "operatingSystem": "Web, Browser",
          "url": url,
          "description": "Cloud-based property management software for Kenya — automated tenant billing, M-PESA rent collection, landlord statements and full financial reporting.",
          "featureList": [
            "Automated tenant invoicing and billing",
            "M-PESA Paybill rent collection with auto-reconciliation",
            "Landlord statements and management fee deductions",
            "Multi-property and multi-landlord portfolio management",
            "Vacancy tracking across all property units",
            "Automated late payment penalties",
            "Trial Balance, Income Statement and Balance Sheet",
            "Role-based access for property managers, accountants and agents"
          ],
          "offers": {
            "@type": "Offer",
            "price": "3500",
            "priceCurrency": "KES",
            "description": "From KES 3,500/month for up to 60 rental units"
          }
        }
      ]
    });
    return () => removeSchema("page");
  }, []);

  return (
    <ModulePageShell>
      {(openTrialModal) => (
        <>
          {/* Hero */}
          <section className="border-b border-slate-200 bg-[#f7faf8]">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-start lg:gap-14 lg:px-8 lg:py-16">
              <div>
                <div className="inline-flex items-center gap-2 border border-[#0B3B2E]/15 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-[#0B3B2E]">
                  Property Management
                </div>
                <h1 className="mt-4 text-2xl font-extrabold leading-[1.15] tracking-tight text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                  Property management that actually works — M-Pesa billing, landlord reports, all in one place.
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Most property managers are still chasing rent on WhatsApp and reconciling M-Pesa statements by hand. Milik fixes that — invoices go out on time, payments match automatically, landlord statements write themselves.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => openTrialModal("property_management")}
                    className="inline-flex items-center gap-2 border border-[#0B3B2E] bg-[#0B3B2E] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0A3127]">
                    Request a Free Demo <FaArrowRight />
                  </button>
                  <Link to="/#pricing"
                    className="inline-flex items-center gap-2 border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]">
                    View Pricing
                  </Link>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {highlights.map((h) => (
                    <div key={h} className="flex items-start gap-2 border border-slate-200 bg-white px-3 py-2">
                      <FaCheckCircle className="mt-0.5 shrink-0 text-[10px] text-[#0B3B2E]" />
                      <span className="text-xs font-semibold leading-4 text-slate-700">{h}</span>
                    </div>
                  ))}
                </div>
              </div>

              <BrandPatternPanel eyebrow="What Property Management tracks · example workspace">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Units managed" value="13" />
                  <MetricTile label="Occupancy" value="46.2%" />
                  <MetricTile label="Collected this month" value="KSh 41.0K" big accent className="col-span-2" />
                  <MetricTile label="Collection rate" value="17.9%" />
                  <MetricTile label="Open invoices" value="2" />
                </div>
              </BrandPatternPanel>
            </div>
          </section>

          {/* Features */}
          <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the system actually handles — from unit to landlord statement.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Everything in one workspace, with a proper accounting layer running underneath. No separate tools, no exports to Excel.</p>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="border border-slate-200 bg-white p-5">
                  <div className="inline-flex border border-slate-200 bg-slate-50 p-2.5 text-lg text-[#0B3B2E]">{f.icon}</div>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{f.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Use cases */}
          <section className="border-y border-slate-200 bg-white py-14">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="max-w-2xl">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Who uses it</p>
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Whether you manage 5 units or 500, it works the same way.</h2>
              </div>
              <div className="mt-8 grid gap-4 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="border border-slate-200 bg-[#f7faf8] p-5">
                    <h3 className="text-base font-extrabold text-slate-900">{uc.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{uc.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Other modules */}
          <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Other modules</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">If you also run a car wash, manage staff or track stock — Milik covers that too.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Every Milik module uses the same workspace and the same accounting layer. Add more when your business needs it — no migration, no new system to learn.</p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {otherModules.map((mod) => (
                <Link
                  key={mod.href}
                  to={mod.href}
                  className="group border border-slate-200 bg-white p-5 transition hover:border-[#0B3B2E]"
                >
                  <div className="inline-flex border border-slate-200 bg-slate-50 p-2.5 text-lg text-[#0B3B2E]">{mod.icon}</div>
                  <h3 className="mt-3 text-sm font-extrabold text-slate-900">{mod.title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">{mod.desc}</p>
                  <p className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0B3B2E]">
                    Learn more <FaArrowRight className="text-[9px] transition group-hover:translate-x-0.5" />
                  </p>
                </Link>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
            <div className="border border-slate-800 bg-slate-900 p-6 text-white sm:p-8">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Ready to see it in action?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Open the property management demo and see how it works.</h2>
                <p className="mt-3 text-sm leading-6 text-white/80">
                  Request a free demo and our team will walk you through a guided workspace with sample properties, tenant flows, owner statements and financial reports.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_management")}
                    className="inline-flex items-center gap-2 border border-white bg-white px-5 py-2.5 text-sm font-bold text-[#0B3B2E] transition hover:bg-slate-100"
                  >
                    Request a Free Demo <FaArrowRight />
                  </button>
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 border border-white/30 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
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
