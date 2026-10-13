import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaCoins, FaHandshake, FaHome, FaUsers, FaUserTie, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import MetricTile from "../../components/MetricTile";
import BrandPatternPanel from "../../components/BrandPatternPanel";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";

const SITE = "https://milikproperty.com";

const features = [
  {
    icon: <FaHome />,
    title: "Property listings management",
    description: "Create and manage listings with full property details, location, pricing, type, photos and current availability status.",
  },
  {
    icon: <FaUsers />,
    title: "Buyer management",
    description: "Track buyer leads, record requirements and follow-up history, and match buyers to suitable listings in your pipeline.",
  },
  {
    icon: <FaUserTie />,
    title: "Agent assignment and management",
    description: "Assign agents to listings, track their activity, monitor performance and manage territories across your sales team.",
  },
  {
    icon: <FaChartLine />,
    title: "Deal progression tracking",
    description: "Move deals through offer, negotiation, accepted and closed stages — full history at each stage for every transaction.",
  },
  {
    icon: <FaCoins />,
    title: "Agent commission calculation",
    description: "Commission rates are applied automatically at deal close — review, approve and record payouts from the same workflow.",
  },
  {
    icon: <FaHandshake />,
    title: "Sales performance reports",
    description: "View active pipeline, track revenue, compare agent rankings and monitor conversion rates across your sales operation.",
  },
];

const useCases = [
  {
    title: "Real estate agencies",
    description: "Manage your full property listing portfolio, track buyer leads, assign agents and generate commissions at close — all in one system.",
  },
  {
    title: "Property developers",
    description: "Track plot and unit sales from your development projects, manage buyers through multi-stage deals and report on revenue progress.",
  },
  {
    title: "Independent agents and brokers",
    description: "Maintain your listing portfolio, follow up buyer leads systematically and generate professional commission records for each closed deal.",
  },
];

const highlights = [
  "Listings managed with full property details",
  "Buyer leads tracked from first contact to close",
  "Deals progressed through defined pipeline stages",
  "Agent commissions calculated automatically at close",
  "Sales performance reports by agent and period",
  "Full accounting — revenue, commissions, reports",
];

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management" },
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos" },
];

export default function PropertySalesPage() {
  useEffect(() => {
    const url = `${SITE}/property-sales`;
    setTitle("Property Sales Management Kenya — Listings, Buyers & Agent Commissions | Milik");
    setDesc("Milik Property Sales module — manage property listings, track buyer leads, assign agents, record deal progression, calculate commissions and generate sales reports in Kenya.");
    setKeywords("property sales management Kenya, real estate agency software Kenya, agent commission software Kenya, buyer management system Kenya, property listing management Kenya, deal pipeline real estate Kenya, real estate CRM Kenya, property sales software Nairobi, real estate agent tracking Kenya, property developer software Kenya");
    setCanonical(url);
    setOg("og:type", "website");
    setOg("og:site_name", "Milik");
    setOg("og:locale", "en_KE");
    setOg("og:title", "Property Sales Management Kenya | Milik");
    setOg("og:description", "Manage property listings, track buyers, assign agents, progress deals and calculate commissions — all in one workspace built for Kenya.");
    setOg("og:url", url);
    setOg("og:image", `${SITE}/og-image.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Property Sales Management Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Property Sales Management Kenya | Milik");
    setTw("twitter:description", "Listings, buyer tracking, deal progression and agent commissions for Kenyan real estate agencies.");
    setTw("twitter:image", `${SITE}/og-image.png`);
    setSchema("page", {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE}/` },
            { "@type": "ListItem", "position": 2, "name": "Property Sales Management Kenya", "item": url }
          ]
        },
        {
          "@type": "WebPage",
          "@id": url,
          "name": "Property Sales Management Kenya — Listings, Buyers & Agent Commissions | Milik",
          "description": "Property sales management software for Kenya — listings, buyer lead tracking, deal pipeline, agent assignment and automatic commission calculation.",
          "url": url,
          "inLanguage": "en-KE",
          "isPartOf": { "@type": "WebSite", "url": SITE, "name": "Milik" }
        },
        {
          "@type": "SoftwareApplication",
          "name": "Milik Property Sales",
          "applicationCategory": "BusinessApplication",
          "applicationSubCategory": "Real Estate Sales Software",
          "operatingSystem": "Web, Browser",
          "url": url,
          "description": "Property sales management software for Kenyan real estate agencies and developers — listings, buyer pipelines, agent assignment, deal progression and commission calculation.",
          "featureList": [
            "Property listing management with full details and status",
            "Buyer lead tracking from first contact to close",
            "Agent assignment and performance tracking",
            "Deal pipeline — offer, negotiation, accepted, closed",
            "Agent commission calculation at deal close",
            "Sales pipeline and revenue reporting",
            "Buyer-to-listing matching",
            "Accounting integration — revenue, commissions, reports"
          ],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "KES",
            "description": "Contact Milik for property sales module pricing"
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
                  Property Sales
                </div>
                <h1 className="mt-4 text-2xl font-extrabold leading-[1.15] tracking-tight text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                  From listing to closed deal — track buyers, agents and commissions in one pipeline.
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Spreadsheets lose buyer leads and WhatsApp loses commission math. Milik keeps your listings, buyers, deal stages and agent payouts in one controlled pipeline from first enquiry to closed sale.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => openTrialModal("property_sales")}
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

              <BrandPatternPanel eyebrow="What Property Sales tracks · example workspace">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Active listings" value="18" />
                  <MetricTile label="Buyer leads" value="46" />
                  <MetricTile label="Commissions this month" value="KSh 210K" big accent className="col-span-2" />
                  <MetricTile label="Deals in pipeline" value="7" />
                  <MetricTile label="Closed this month" value="2" />
                </div>
              </BrandPatternPanel>
            </div>
          </section>

          {/* Features */}
          <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the property sales module handles — from enquiry to commission payout.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">One pipeline for every listing, buyer and agent — with commissions calculated automatically, not worked out by hand at month-end.</p>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">For agencies, developers and independent agents alike.</h2>
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Also managing rentals, staff or stock? Milik covers that too.</h2>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Ready to see your pipeline in one place?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Explore property sales in the Milik demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/80">
                  Request a free demo and see listings, buyer leads, deal stages and agent commissions with real sample data.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_sales")}
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
