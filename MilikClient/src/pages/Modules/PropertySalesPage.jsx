import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaCoins, FaHandshake, FaHome, FaUsers, FaUserTie, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setCanonical, setOg, setTw } from "../../utils/pageMeta";
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
  "Deal pipeline from offer to closed",
  "Agent commissions auto-calculated at close",
  "Buyer matching and follow-up tracking",
];

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management", color: "text-[#0B3B2E]", bg: "bg-[#0B3B2E]/10" },
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash", color: "text-sky-700", bg: "bg-sky-50" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources", color: "text-violet-700", bg: "bg-violet-50" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos", color: "text-orange-700", bg: "bg-orange-50" },
];

export default function PropertySalesPage() {
  useEffect(() => {
    setTitle("Property Sales Management Kenya — Listings, Buyers & Agent Commissions | Milik");
    setDesc("Milik Property Sales module — manage property listings, track buyer leads, assign agents, record deal progression, calculate commissions and generate sales reports in Kenya.");
    setCanonical(`${SITE}/property-sales`);
    setOg("og:title", "Property Sales Management Kenya | Milik");
    setOg("og:description", "Manage property listings, track buyers, assign agents, progress deals and calculate commissions — all in one workspace built for Kenya.");
    setOg("og:url", `${SITE}/property-sales`);
    setOg("og:type", "website");
    setOg("og:image", `${SITE}/logo.png`);
    setTw("twitter:title", "Property Sales Management Kenya | Milik");
    setTw("twitter:description", "Listings, buyer tracking, deal progression and agent commissions for Kenyan real estate agencies.");
    setTw("twitter:image", `${SITE}/logo.png`);
  }, []);

  return (
    <ModulePageShell>
      {(openTrialModal) => (
        <>
          {/* Hero */}
          <section className="relative overflow-hidden bg-gradient-to-br from-emerald-50 via-white to-white">
            <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
              <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
                <div>
                  <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-emerald-700 shadow-sm">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                      <FaHandshake className="text-[10px]" />
                    </span>
                    Property Sales
                  </div>
                  <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-[-0.03em] text-slate-950 sm:text-5xl lg:text-[3.5rem]">
                    Property sales management — listings, buyers and agent commissions in one place.
                  </h1>
                  <p className="mt-5 text-lg leading-8 text-slate-600">
                    Milik gives real estate agencies and property developers a structured sales system — manage listings, track buyer leads, progress deals through stages, calculate agent commissions and report on pipeline performance.
                  </p>
                  <div className="mt-8 flex flex-wrap gap-4">
                    <button
                      type="button"
                      onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-800"
                    >
                      Get Free Trial <FaArrowRight />
                    </button>
                    <Link
                      to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3.5 text-sm font-bold text-slate-800 transition hover:border-emerald-700 hover:text-emerald-700"
                    >
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-8 grid gap-3 sm:grid-cols-3">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-emerald-700" />
                        <span className="text-sm font-semibold text-slate-700">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="module-hero-img-shell">
                  <div className="module-hero-img-frame">
                    <img src={propertySalesImg} alt="Property sales agent using Milik" loading="eager" />
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
          <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A complete property sales system — from listing to closed deal.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">Every tool a Kenyan property agency needs to manage deals, agents and buyers professionally from one controlled workspace.</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-2xl bg-emerald-50 p-3 text-2xl text-emerald-700">{f.icon}</div>
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
                <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Built for Kenyan property sales professionals.</h2>
              </div>
              <div className="mt-10 grid gap-6 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-[28px] border border-slate-200 bg-emerald-50/40 p-6 shadow-sm">
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
            <div className="rounded-[36px] bg-gradient-to-r from-emerald-800 via-emerald-700 to-emerald-900 px-8 py-12 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-200">Ready to run a tighter sales operation?</p>
                <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Explore Property Sales in the Milik demo workspace.</h2>
                <p className="mt-4 text-sm leading-7 text-white/85">
                  See listings, buyer pipelines, deal progression and agent commission flows with real sample data.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-50"
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
