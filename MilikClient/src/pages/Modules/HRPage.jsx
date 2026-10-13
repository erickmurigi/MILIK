import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaClipboardList, FaClock, FaCoins, FaHandshake, FaShieldAlt, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import MetricTile from "../../components/MetricTile";
import BrandPatternPanel from "../../components/BrandPatternPanel";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";

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

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management" },
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales" },
];

export default function HRPage() {
  useEffect(() => {
    const url = `${SITE}/human-resources`;
    setTitle("HR and Payroll Software Kenya — Employees, Leave & Appraisals | Milik");
    setDesc("Milik HR module for Kenya — manage employee records, process payroll, track leave days, run KPI appraisals and control staff permissions in one organised workspace.");
    setKeywords("HR software Kenya, payroll software Kenya, employee management system Kenya, leave management software Kenya, staff appraisal system Kenya, KPI tracking software Kenya, HR management system Nairobi, payroll processing software Kenya, human resource management Kenya, staff leave tracker Kenya");
    setCanonical(url);
    setOg("og:type", "website");
    setOg("og:site_name", "Milik");
    setOg("og:locale", "en_KE");
    setOg("og:title", "HR and Payroll Software Kenya | Milik");
    setOg("og:description", "Manage employee records, process payroll, track leave and run KPI appraisals for your Kenyan business — all in one workspace.");
    setOg("og:url", url);
    setOg("og:image", `${SITE}/og-image.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik HR and Payroll Software Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "HR and Payroll Software Kenya | Milik");
    setTw("twitter:description", "Employee records, payroll, leave management and staff appraisals for Kenyan businesses.");
    setTw("twitter:image", `${SITE}/og-image.png`);
    setSchema("page", {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE}/` },
            { "@type": "ListItem", "position": 2, "name": "HR and Payroll Software Kenya", "item": url }
          ]
        },
        {
          "@type": "WebPage",
          "@id": url,
          "name": "HR and Payroll Software Kenya — Employees, Leave & Appraisals | Milik",
          "description": "HR management software for Kenya — employee records, payroll processing, leave management, KPI tracking and staff appraisals in one organised workspace.",
          "url": url,
          "inLanguage": "en-KE",
          "isPartOf": { "@type": "WebSite", "url": SITE, "name": "Milik" }
        },
        {
          "@type": "SoftwareApplication",
          "name": "Milik Human Resources",
          "applicationCategory": "BusinessApplication",
          "applicationSubCategory": "HR and Payroll Software",
          "operatingSystem": "Web, Browser",
          "url": url,
          "description": "HR and payroll management software for Kenyan businesses — employee records, payroll cycles, leave management, KPI appraisals and HR reporting.",
          "featureList": [
            "Employee records and contract management",
            "Payroll processing with allowances and deductions",
            "Payslip generation per employee",
            "Leave requests, approvals and balance tracking",
            "KPI target setting and performance tracking",
            "Staff appraisal cycles with sign-off trail",
            "HR reports — headcount, payroll, leave, performance",
            "Role-based staff access control"
          ],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "KES",
            "description": "Contact Milik for HR module pricing"
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
                  Human Resources
                </div>
                <h1 className="mt-4 text-2xl font-extrabold leading-[1.15] tracking-tight text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                  Manage your team properly — payroll, leave, appraisals and records all in one place.
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Growing businesses lose too many HR hours to spreadsheets and WhatsApp threads. Milik gives your HR team a structured workspace — contracts, payroll cycles, leave approvals and performance reviews handled cleanly.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => openTrialModal("human_resources")}
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

              <BrandPatternPanel eyebrow="What Human Resources tracks · example workspace">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Employees" value="28" />
                  <MetricTile label="On leave today" value="2" />
                  <MetricTile label="Payroll this month" value="KSh 540K" big accent className="col-span-2" />
                  <MetricTile label="Leave requests pending" value="3" />
                  <MetricTile label="Appraisals due" value="5" />
                </div>
              </BrandPatternPanel>
            </div>
          </section>

          {/* Features */}
          <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the HR module handles — from onboarding to year-end appraisals.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Manage your full employee lifecycle in one place. No scattered spreadsheets, no shared drives, no missed leave balances.</p>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Works for any business that has people to manage.</h2>
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Property to manage? Stock to track? Car wash to run? Milik covers those too.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">HR is one module in a wider system. Activate what your business needs — every module shares the same accounting core and user management. One login, one system.</p>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Ready to manage your team properly?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Explore HR and payroll in the Milik demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/80">
                  Request a free demo and see employee records, payroll runs, leave management and KPI tracking in a guided demo environment.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("human_resources")}
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
