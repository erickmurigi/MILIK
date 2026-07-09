import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBolt, FaBuilding, FaCar, FaCheckCircle,
  FaClipboardList, FaCoins, FaHandshake, FaLayerGroup, FaUsers, FaWarehouse, FaWallet,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";
import carWashImg from "../../assets/landing/CAR WASH.png";

const SITE = "https://milikproperty.com";

const features = [
  {
    icon: <FaCar />,
    title: "Job tracking by vehicle plate",
    description: "Create jobs by plate number, assign services and staff, and track each vehicle through the wash process in real time.",
  },
  {
    icon: <FaClipboardList />,
    title: "Flexible service catalog",
    description: "Define your services, set prices per type, build bundles and manage a full job history for every vehicle and customer.",
  },
  {
    icon: <FaBolt />,
    title: "Customer loyalty program",
    description: "Auto-enrol customers by plate, track loyalty stamps per service, set reward thresholds and send automated SMS notifications.",
  },
  {
    icon: <FaCoins />,
    title: "Staff commissions",
    description: "Track per-job commissions for each staff member automatically and manage payout cycles from the cashbook.",
  },
  {
    icon: <FaWallet />,
    title: "Daily cashbook and deposits",
    description: "Record cash takings, manage float, log deposits and reconcile daily shift income against expected totals.",
  },
  {
    icon: <FaLayerGroup />,
    title: "Multi-branch support",
    description: "Run multiple car wash locations from a single workspace with branch-level reporting and user access control.",
  },
];

const useCases = [
  {
    title: "Car wash businesses",
    description: "Track every job from arrival to payment, manage staff commissions, run a loyalty program and keep cashbooks clean — all in one system.",
  },
  {
    title: "Auto-detailing and specialty services",
    description: "Build a detailed service catalog, record premium job types and track customer history by vehicle plate for personalised service.",
  },
  {
    title: "Multi-branch car wash chains",
    description: "Manage operations across multiple locations with branch-level reporting, shared staff management and centralised cashbook visibility.",
  },
];

const highlights = [
  "Job queue — real-time status on every vehicle",
  "Loyalty stamps auto-tracked per plate number",
  "Staff commission per job, calculated automatically",
  "SMS alerts to customers when their car is ready",
  "Daily till close and shift cashbook reconciliation",
  "Full accounting included — income, expenses, reports",
];

const stats = [
  { value: "Real-time", label: "Job queue updates" },
  { value: "Auto", label: "Commission calculation" },
  { value: "Instant", label: "Customer SMS alerts" },
];

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management", color: "text-[#0B3B2E]", bg: "bg-[#0B3B2E]/10" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources", color: "text-violet-700", bg: "bg-violet-50" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos", color: "text-orange-700", bg: "bg-orange-50" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales", color: "text-emerald-700", bg: "bg-emerald-50" },
];

export default function CarWashPage() {
  useEffect(() => {
    const url = `${SITE}/car-wash`;
    setTitle("Car Wash Management System Kenya — Jobs, Loyalty & Commissions | Milik");
    setDesc("Milik Car Wash Management System — track jobs by vehicle plate, manage payments, run customer loyalty programs and calculate staff commissions for your car wash business in Kenya.");
    setKeywords("car wash management system Kenya, car wash software Kenya, car wash job tracking, car wash loyalty program Kenya, vehicle plate tracking car wash, staff commission car wash Kenya, car wash cashbook Kenya, car wash POS Kenya, car wash management Nairobi, car wash billing system");
    setCanonical(url);
    setOg("og:type", "website");
    setOg("og:site_name", "Milik");
    setOg("og:locale", "en_KE");
    setOg("og:title", "Car Wash Management System Kenya | Milik");
    setOg("og:description", "Track car wash jobs by plate, manage payments, run customer loyalty and calculate staff commissions — all in one system built for Kenya.");
    setOg("og:url", url);
    setOg("og:image", `${SITE}/logo.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Car Wash Management System Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Car Wash Management System Kenya | Milik");
    setTw("twitter:description", "Track jobs by plate, manage loyalty programs and staff commissions for your car wash business.");
    setTw("twitter:image", `${SITE}/logo.png`);
    setSchema("page", {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE}/` },
            { "@type": "ListItem", "position": 2, "name": "Car Wash Management System Kenya", "item": url }
          ]
        },
        {
          "@type": "WebPage",
          "@id": url,
          "name": "Car Wash Management System Kenya — Jobs, Loyalty & Commissions | Milik",
          "description": "Track car wash jobs by vehicle plate, run loyalty programs, calculate staff commissions and manage daily cashbooks for your car wash business in Kenya.",
          "url": url,
          "inLanguage": "en-KE",
          "isPartOf": { "@type": "WebSite", "url": SITE, "name": "Milik" }
        },
        {
          "@type": "SoftwareApplication",
          "name": "Milik Car Wash Management",
          "applicationCategory": "BusinessApplication",
          "applicationSubCategory": "Car Wash Management Software",
          "operatingSystem": "Web, Browser",
          "url": url,
          "description": "Car wash management software for Kenya — job tracking by vehicle plate, customer loyalty stamps, staff commission calculation and daily cashbook reconciliation.",
          "featureList": [
            "Job tracking by vehicle plate number",
            "Customer loyalty stamp program with SMS alerts",
            "Staff commission calculation per job",
            "Daily cashbook and till reconciliation",
            "Flexible service catalog and pricing",
            "Multi-branch car wash management",
            "M-PESA payment integration",
            "Real-time job queue monitoring"
          ],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "KES",
            "description": "Contact Milik for car wash module pricing"
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
          <section className="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-white lg:h-[calc(100vh-78px)]">
            <div className="mx-auto h-full max-w-7xl px-4 py-10 sm:px-6 lg:flex lg:items-center lg:px-8 lg:py-0">
              <div className="grid w-full gap-8 lg:h-full lg:grid-cols-2 lg:items-stretch lg:gap-10">
                <div className="lg:self-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-sky-700 shadow-sm">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                      <FaCar className="text-[9px]" />
                    </span>
                    Car Wash Management
                  </div>
                  <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-[-0.02em] text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                    Track every job, reward loyal customers and pay your staff fairly — all in one system.
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    No more paper job cards, manual stamp counting or guessing who's owed what at end of month. Milik tracks everything from the moment a car pulls in to when the till closes.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-slate-200 py-3">
                    {stats.map((s) => (
                      <div key={s.label}>
                        <p className="text-base font-extrabold text-sky-700">{s.value}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button
                      type="button"
                      onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-sky-700 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-sky-700/20 transition hover:bg-sky-800"
                    >
                      Get Free Trial <FaArrowRight />
                    </button>
                    <Link
                      to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-800 transition hover:border-sky-700 hover:text-sky-700"
                    >
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-[10px] text-sky-700" />
                        <span className="text-xs font-semibold leading-4 text-slate-700">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="module-hero-img-shell lg:h-full">
                  <div className="module-hero-img-frame lg:h-full">
                    <img src={carWashImg} alt="Car wash staff using Milik management system" loading="eager" className="lg:h-full lg:object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-sky-900/45 via-transparent to-transparent" />
                    <div className="module-hero-badge bg-sky-700/90 text-white">
                      <div>
                        <p className="module-hero-badge-title">Car Wash</p>
                      </div>
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                        <FaCar />
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the car wash module handles — from first job to end-of-day close.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">The tools your team actually needs, without the ones they don't. Straightforward to learn, reliable in daily use.</p>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-xl bg-sky-50 p-2.5 text-xl text-sky-700">{f.icon}</div>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Right for single locations and multi-branch operators alike.</h2>
              </div>
              <div className="mt-7 grid gap-4 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-2xl border border-slate-200 bg-sky-50/40 p-5 shadow-sm">
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Also managing property, staff or stock? Milik handles those too.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Milik modules stack onto each other. Add property management, payroll, inventory or property sales to the same workspace — same login, same accounting, no extra setup.</p>
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
            <div className="rounded-2xl bg-gradient-to-r from-sky-800 via-sky-700 to-sky-900 px-6 py-8 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-sky-200">Ready to streamline your car wash?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">See the car wash module in the guided demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/85">
                  Explore job flows, loyalty programs, cashbooks and staff commissions with real sample data.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-sky-800 transition hover:bg-sky-50"
                  >
                    Get Free Trial <FaArrowRight />
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
