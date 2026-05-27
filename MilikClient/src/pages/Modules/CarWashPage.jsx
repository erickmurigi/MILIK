import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBolt, FaBuilding, FaCar, FaCheckCircle,
  FaClipboardList, FaCoins, FaHandshake, FaLayerGroup, FaUsers, FaWarehouse, FaWallet,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setCanonical, setOg, setTw } from "../../utils/pageMeta";
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
  "Loyalty stamps auto-tracked per plate",
  "Staff commission per job, auto-calculated",
  "SMS notifications for rewards and jobs",
];

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management", color: "text-[#0B3B2E]", bg: "bg-[#0B3B2E]/10" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources", color: "text-violet-700", bg: "bg-violet-50" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos", color: "text-orange-700", bg: "bg-orange-50" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales", color: "text-emerald-700", bg: "bg-emerald-50" },
];

export default function CarWashPage() {
  useEffect(() => {
    setTitle("Car Wash Management System Kenya — Jobs, Loyalty & Commissions | Milik");
    setDesc("Milik Car Wash Management System — track jobs by vehicle plate, manage payments, run customer loyalty programs and calculate staff commissions for your car wash business in Kenya.");
    setCanonical(`${SITE}/car-wash`);
    setOg("og:title", "Car Wash Management System Kenya | Milik");
    setOg("og:description", "Track car wash jobs by plate, manage payments, run customer loyalty and calculate staff commissions — all in one system built for Kenya.");
    setOg("og:url", `${SITE}/car-wash`);
    setOg("og:type", "website");
    setOg("og:image", `${SITE}/logo.png`);
    setTw("twitter:title", "Car Wash Management System Kenya | Milik");
    setTw("twitter:description", "Track jobs by plate, manage loyalty programs and staff commissions for your car wash business.");
    setTw("twitter:image", `${SITE}/logo.png`);
  }, []);

  return (
    <ModulePageShell>
      {(openTrialModal) => (
        <>
          {/* Hero */}
          <section className="relative overflow-hidden bg-gradient-to-br from-sky-50 via-white to-white">
            <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
              <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
                <div>
                  <div className="inline-flex items-center gap-3 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-sky-700 shadow-sm">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                      <FaCar className="text-[10px]" />
                    </span>
                    Car Wash
                  </div>
                  <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-[-0.03em] text-slate-950 sm:text-5xl lg:text-[3.5rem]">
                    Car wash management system — jobs, loyalty programs and staff commissions in one place.
                  </h1>
                  <p className="mt-5 text-lg leading-8 text-slate-600">
                    Milik gives car wash businesses a complete operational system — track every job by vehicle plate, auto-enrol customers in your loyalty program, calculate staff commissions and manage daily cashbooks without spreadsheets.
                  </p>
                  <div className="mt-8 flex flex-wrap gap-4">
                    <button
                      type="button"
                      onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-sky-700 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-sky-700/20 transition hover:bg-sky-800"
                    >
                      Get Free Trial <FaArrowRight />
                    </button>
                    <Link
                      to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3.5 text-sm font-bold text-slate-800 transition hover:border-sky-700 hover:text-sky-700"
                    >
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-8 grid gap-3 sm:grid-cols-3">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-sky-700" />
                        <span className="text-sm font-semibold text-slate-700">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="module-hero-img-shell">
                  <div className="module-hero-img-frame">
                    <img src={carWashImg} alt="Car wash staff using Milik management system" loading="eager" />
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
          <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">A complete car wash management system — from job to cashbook.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">Every tool a car wash owner needs to run efficiently, retain customers and pay staff fairly.</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-2xl bg-sky-50 p-3 text-2xl text-sky-700">{f.icon}</div>
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
                <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Built for Kenyan car wash operators.</h2>
              </div>
              <div className="mt-10 grid gap-6 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-[28px] border border-slate-200 bg-sky-50/40 p-6 shadow-sm">
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
            <div className="rounded-[36px] bg-gradient-to-r from-sky-800 via-sky-700 to-sky-900 px-8 py-12 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-sm font-bold uppercase tracking-[0.24em] text-sky-200">Ready to streamline your car wash?</p>
                <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">See the car wash module in the guided demo workspace.</h2>
                <p className="mt-4 text-sm leading-7 text-white/85">
                  Explore job flows, loyalty programs, cashbooks and staff commissions with real sample data.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-sky-800 transition hover:bg-sky-50"
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
