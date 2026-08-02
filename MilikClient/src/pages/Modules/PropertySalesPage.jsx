import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaCoins, FaHandshake, FaHome, FaUsers, FaUserTie, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";
import propertySalesImg from "../../assets/landing/PROPERTY SALE.png";

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

const stats = [
  { value: "Pipeline", label: "Offer to deal closed" },
  { value: "Auto", label: "Commission at close" },
  { value: "Full history", label: "Every buyer lead" },
];

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management", color: "text-[#0B3B2E]", bg: "bg-[#0B3B2E]/10" },
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash", color: "text-sky-700", bg: "bg-sky-50" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources", color: "text-violet-700", bg: "bg-violet-50" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos", color: "text-orange-700", bg: "bg-orange-50" },
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
    setOg("og:image", `${SITE}/logo.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Property Sales Management Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Property Sales Management Kenya | Milik");
    setTw("twitter:description", "Listings, buyer tracking, deal progression and agent commissions for Kenyan real estate agencies.");
    setTw("twitter:image", `${SITE}/logo.png`);
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
          <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-white lg:h-[calc(100vh-78px)]">
            <div className="mx-auto h-full max-w-7xl px-4 py-10 sm:px-6 lg:flex lg:items-center lg:px-8 lg:py-0">
              <div className="grid w-full gap-8 lg:h-full lg:grid-cols-2 lg:items-stretch lg:gap-10">
                <div className="lg:self-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-700 shadow-sm">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                      <FaHandshake className="text-[9px]" />
                    </span>
                    Property Sales
                  </div>
                  <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-[-0.02em] text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                    Property sales management — listings, buyers and agent commissions in one place.
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Milik gives real estate agencies and property developers a structured sales system — manage listings, track buyer leads, progress deals through stages, calculate commissions and report on pipeline performance.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-slate-200 py-3">
                    {stats.map((s) => (
                      <div key={s.label}>
                        <p className="text-base font-extrabold text-emerald-700">{s.value}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button type="button" onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800">
                      Request a Free Demo <FaArrowRight />
                    </button>
                    <Link to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-800 transition hover:border-emerald-700 hover:text-emerald-700">
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-[10px] text-emerald-700" />
                        <span className="text-xs font-semibold leading-4 text-slate-700">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="module-hero-img-shell lg:h-full">
                  <div className="module-hero-img-frame lg:h-full">
                    <img src={propertySalesImg} alt="Property sales agent using Milik" loading="eager" className="lg:h-full lg:object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-emerald-900/45 via-transparent to-transparent" />
                    <div className="module-hero-badge bg-emerald-700/90 text-white">
                      <div>
                        <p className="module-hero-badge-title">Property Sales</p>
                      </div>
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                        <FaHandshake />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Features */}
          <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">From listing to closed deal — what the property sales module handles.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Every tool your agency needs to manage the pipeline, assign agents, progress deals and calculate commissions — from one controlled workspace.</p>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-xl bg-emerald-50 p-2.5 text-xl text-emerald-700">{f.icon}</div>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{f.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Use cases */}
          <section className="bg-white py-10">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="max-w-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Who uses it</p>
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Real estate agencies, developers and independent brokers.</h2>
              </div>
              <div className="mt-7 grid gap-4 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-2xl border border-slate-200 bg-emerald-50/40 p-5 shadow-sm">
                    <h3 className="text-base font-extrabold text-slate-900">{uc.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{uc.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Other modules */}
          <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Other modules</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Also managing rentals, a team or a retail operation? Add those to your workspace.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Property Sales is one module. If your business also manages rental property, runs a car wash or needs HR, stack those on — same login, same accounting backbone, same system.</p>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {otherModules.map((mod) => (
                <Link
                  key={mod.href}
                  to={mod.href}
                  className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className={`inline-flex rounded-xl p-2.5 text-xl ${mod.bg} ${mod.color}`}>{mod.icon}</div>
                  <h3 className="mt-3 text-sm font-extrabold text-slate-900">{mod.title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">{mod.desc}</p>
                  <p className={`mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] ${mod.color}`}>
                    Learn more <FaArrowRight className="text-[9px]" />
                  </p>
                </Link>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
            <div className="rounded-2xl bg-gradient-to-r from-emerald-800 via-emerald-700 to-emerald-900 px-6 py-8 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-200">Ready to run a tighter sales operation?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Explore Property Sales in the Milik demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/85">
                  See listings, buyer pipelines, deal progression and agent commission flows with real sample data.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-50"
                  >
                    Request a Free Demo <FaArrowRight />
                  </button>
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-white/10"
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
