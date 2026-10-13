import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBolt, FaBuilding, FaCar, FaCheckCircle,
  FaClipboardList, FaCoins, FaHandshake, FaLayerGroup, FaUsers, FaWallet, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import MetricTile from "../../components/MetricTile";
import BrandPatternPanel from "../../components/BrandPatternPanel";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";

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

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales" },
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
    setOg("og:image", `${SITE}/og-image.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Car Wash Management System Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Car Wash Management System Kenya | Milik");
    setTw("twitter:description", "Track jobs by plate, manage loyalty programs and staff commissions for your car wash business.");
    setTw("twitter:image", `${SITE}/og-image.png`);
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
          <section className="border-b border-slate-200 bg-[#f7faf8]">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-start lg:gap-14 lg:px-8 lg:py-16">
              <div>
                <div className="inline-flex items-center gap-2 border border-[#0B3B2E]/15 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-[#0B3B2E]">
                  Car Wash Management
                </div>
                <h1 className="mt-4 text-2xl font-extrabold leading-[1.15] tracking-tight text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                  Track every job, reward loyal customers and pay your staff fairly — all in one system.
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  No more paper job cards, manual stamp counting or guessing who's owed what at end of month. Milik tracks everything from the moment a car pulls in to when the till closes.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("car_wash")}
                    className="inline-flex items-center gap-2 border border-[#0B3B2E] bg-[#0B3B2E] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0A3127]"
                  >
                    Request a Free Demo <FaArrowRight />
                  </button>
                  <Link
                    to="/#pricing"
                    className="inline-flex items-center gap-2 border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]"
                  >
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

              <BrandPatternPanel eyebrow="What Car Wash tracks · example workspace">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Jobs today" value="24" />
                  <MetricTile label="Loyalty members" value="140" />
                  <MetricTile label="Collected today" value="KSh 18.2K" big accent className="col-span-2" />
                  <MetricTile label="Avg. commission" value="KSh 350" />
                  <MetricTile label="Jobs in queue" value="3" />
                </div>
              </BrandPatternPanel>
            </div>
          </section>

          {/* Features */}
          <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the car wash module handles — from first job to end-of-day close.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">The tools your team actually needs, without the ones they don't. Straightforward to learn, reliable in daily use.</p>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Right for single locations and multi-branch operators alike.</h2>
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Also managing property, staff or stock? Milik handles those too.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Milik modules stack onto each other. Add property management, payroll, inventory or property sales to the same workspace — same login, same accounting, no extra setup.</p>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Ready to streamline your car wash?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">See the car wash module in the guided demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/80">
                  Request a free demo and explore job flows, loyalty programs, cashbooks and staff commissions with real sample data.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("car_wash")}
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
