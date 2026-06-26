import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBook, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaClipboardList, FaClock, FaCoins, FaHandshake, FaShieldAlt, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setCanonical, setOg, setTw } from "../../utils/pageMeta";
import hrImg from "../../assets/landing/HR.png";

const SITE = "https://milikproperty.com";

const features = [
  {
    icon: <FaUsers />,
    title: "Employee records management",
    description: "Maintain full employee profiles — departments, roles, contract history, emergency contacts and personal details in one place.",
  },
  {
    icon: <FaCoins />,
    title: "Payroll processing",
    description: "Run salary cycles, apply allowances and deductions, generate payslips and maintain a clean payroll history per employee.",
  },
  {
    icon: <FaClock />,
    title: "Leave management",
    description: "Employees apply for leave, managers approve online, balances update automatically — full leave history per staff member.",
  },
  {
    icon: <FaChartLine />,
    title: "KPI tracking",
    description: "Set performance targets per role or individual, record actuals and generate KPI scores to guide performance conversations.",
  },
  {
    icon: <FaClipboardList />,
    title: "Staff appraisals",
    description: "Conduct periodic performance reviews, record ratings, note improvement plans and maintain a sign-off trail for each appraisal.",
  },
  {
    icon: <FaShieldAlt />,
    title: "HR reporting",
    description: "Access headcount summaries, payroll reports, leave usage analysis and performance dashboards across departments.",
  },
];

const useCases = [
  {
    title: "SMEs and growing businesses",
    description: "Manage your staff properly from the start — employee records, payroll and leave in one workspace without spreadsheets or shared drives.",
  },
  {
    title: "Multi-department organisations",
    description: "Assign employees to departments, run separate payroll cycles and generate reports by team, branch or company-wide.",
  },
  {
    title: "Performance-driven teams",
    description: "Set KPI targets, track actuals and run formal appraisal cycles to build a performance culture with proper documentation.",
  },
];

const highlights = [
  "Payroll processed accurately every pay cycle",
  "Payslips generated and ready for distribution",
  "Leave requests approved or declined in the system",
  "Leave balances tracked per employee automatically",
  "KPI targets, actuals and appraisal records logged",
  "Full accounting — payroll expenses, reports",
];

const stats = [
  { value: "Accurate", label: "Payroll every cycle" },
  { value: "Structured", label: "Leave management" },
  { value: "Tracked", label: "KPI appraisals" },
];

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management", color: "text-[#0B3B2E]", bg: "bg-[#0B3B2E]/10" },
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash", color: "text-sky-700", bg: "bg-sky-50" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos", color: "text-orange-700", bg: "bg-orange-50" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales", color: "text-emerald-700", bg: "bg-emerald-50" },
];

export default function HRPage() {
  useEffect(() => {
    setTitle("HR and Payroll Software Kenya — Employees, Leave & Appraisals | Milik");
    setDesc("Milik HR module for Kenya — manage employee records, process payroll, track leave days, run KPI appraisals and control staff permissions in one organised workspace.");
    setCanonical(`${SITE}/human-resources`);
    setOg("og:title", "HR and Payroll Software Kenya | Milik");
    setOg("og:description", "Manage employee records, process payroll, track leave and run KPI appraisals for your Kenyan business — all in one workspace.");
    setOg("og:url", `${SITE}/human-resources`);
    setOg("og:type", "website");
    setOg("og:image", `${SITE}/logo.png`);
    setTw("twitter:title", "HR and Payroll Software Kenya | Milik");
    setTw("twitter:description", "Employee records, payroll, leave management and staff appraisals for Kenyan businesses.");
    setTw("twitter:image", `${SITE}/logo.png`);
  }, []);

  return (
    <ModulePageShell>
      {(openTrialModal) => (
        <>
          {/* Hero */}
          <section className="relative overflow-hidden bg-gradient-to-br from-violet-50 via-white to-white lg:h-[calc(100vh-92px)]">
            <div className="mx-auto h-full max-w-[1700px] px-4 py-16 sm:px-6 lg:flex lg:items-center lg:px-8 lg:py-0">
              <div className="grid w-full gap-12 lg:h-full lg:grid-cols-2 lg:items-stretch lg:gap-16">
                <div className="lg:self-center">
                  <div className="inline-flex items-center gap-3 rounded-full border border-violet-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-violet-700 shadow-sm">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-50 text-violet-700">
                      <FaUsers className="text-[10px]" />
                    </span>
                    Human Resources
                  </div>
                  <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-[-0.03em] text-slate-950 sm:text-5xl lg:text-[3.25rem]">
                    Manage your team properly — payroll, leave, appraisals and records all in one place.
                  </h1>
                  <p className="mt-4 text-base leading-7 text-slate-600">
                    Growing businesses lose too many HR hours to spreadsheets and WhatsApp threads. Milik gives your HR team a structured workspace — contracts, payroll cycles, leave approvals and performance reviews handled cleanly.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 border-y border-slate-200 py-4">
                    {stats.map((s) => (
                      <div key={s.label}>
                        <p className="text-xl font-extrabold text-violet-700">{s.value}</p>
                        <p className="mt-0.5 text-xs font-semibold text-slate-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button type="button" onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-violet-700 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-violet-700/20 transition hover:bg-violet-800">
                      Get Free Trial <FaArrowRight />
                    </button>
                    <Link to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 transition hover:border-violet-700 hover:text-violet-700">
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-violet-700" />
                        <span className="text-xs font-semibold leading-5 text-slate-700">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="module-hero-img-shell lg:h-full">
                  <div className="module-hero-img-frame lg:h-full">
                    <img src={hrImg} alt="HR manager using Milik payroll software" loading="eager" className="lg:h-full lg:object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-violet-900/45 via-transparent to-transparent" />
                    <div className="module-hero-badge bg-violet-700/90 text-white">
                      <div>
                        <p className="module-hero-badge-title">Human Resources</p>
                      </div>
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                        <FaUsers />
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
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">What the HR module handles — from onboarding to year-end appraisals.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">Manage your full employee lifecycle in one place. No scattered spreadsheets, no shared drives, no missed leave balances.</p>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-2xl bg-violet-50 p-3 text-2xl text-violet-700">{f.icon}</div>
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
                <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Works for any business that has people to manage.</h2>
              </div>
              <div className="mt-10 grid gap-6 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-[28px] border border-slate-200 bg-violet-50/40 p-6 shadow-sm">
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
              <h2 className="mt-3 text-3xl font-extrabold text-slate-950 sm:text-4xl">Property to manage? Stock to track? Car wash to run? Milik covers those too.</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">HR is one module in a wider system. Activate what your business needs — every module shares the same accounting core and user management. One login, one system.</p>
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
            <div className="rounded-[36px] bg-gradient-to-r from-violet-800 via-violet-700 to-violet-900 px-8 py-12 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-sm font-bold uppercase tracking-[0.24em] text-violet-200">Ready to manage your team properly?</p>
                <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">Explore HR and payroll in the Milik demo workspace.</h2>
                <p className="mt-4 text-sm leading-7 text-white/85">
                  See employee records, payroll runs, leave management and KPI tracking in a guided demo environment.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-violet-800 transition hover:bg-violet-50"
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
