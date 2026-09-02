import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBook, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaClipboardList, FaClock, FaCoins, FaHandshake, FaShieldAlt, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
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
    setOg("og:image", `${SITE}/logo.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik HR and Payroll Software Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "HR and Payroll Software Kenya | Milik");
    setTw("twitter:description", "Employee records, payroll, leave management and staff appraisals for Kenyan businesses.");
    setTw("twitter:image", `${SITE}/logo.png`);
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
          <section className="relative overflow-hidden bg-gradient-to-br from-violet-50 via-white to-white lg:h-[calc(100vh-78px)]">
            <div className="mx-auto h-full max-w-7xl px-4 py-10 sm:px-6 lg:flex lg:items-center lg:px-8 lg:py-0">
              <div className="grid w-full gap-8 lg:h-full lg:grid-cols-2 lg:items-stretch lg:gap-10">
                <div className="lg:self-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-violet-700 shadow-sm">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-50 text-violet-700">
                      <FaUsers className="text-[9px]" />
                    </span>
                    Human Resources
                  </div>
                  <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-[-0.02em] text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                    Manage your team properly — payroll, leave, appraisals and records all in one place.
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Growing businesses lose too many HR hours to spreadsheets and WhatsApp threads. Milik gives your HR team a structured workspace — contracts, payroll cycles, leave approvals and performance reviews handled cleanly.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-slate-200 py-3">
                    {stats.map((s) => (
                      <div key={s.label}>
                        <p className="text-base font-extrabold text-violet-700">{s.value}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button type="button" onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-violet-700 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-violet-700/20 transition hover:bg-violet-800">
                      Request a Free Demo <FaArrowRight />
                    </button>
                    <Link to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-800 transition hover:border-violet-700 hover:text-violet-700">
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-[10px] text-violet-700" />
                        <span className="text-xs font-semibold leading-4 text-slate-700">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="module-hero-img-shell lg:h-full">
                  <div className="module-hero-img-frame lg:h-full">
                    <div className="module-hero-visual">
                      <svg viewBox="0 0 380 480" fill="none" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                        <defs>
                          <linearGradient id="hrWall" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ede9fe" />
                            <stop offset="100%" stopColor="#ddd6fe" />
                          </linearGradient>
                          <linearGradient id="hrWindow" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#c4b5fd" />
                            <stop offset="100%" stopColor="#7c3aed" />
                          </linearGradient>
                          <linearGradient id="hrDesk" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#5b21b6" />
                            <stop offset="100%" stopColor="#4c1d95" />
                          </linearGradient>
                          <linearGradient id="hrScreen" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f5f3ff" />
                            <stop offset="100%" stopColor="#ddd6fe" />
                          </linearGradient>
                          <linearGradient id="hrFloor" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#c4b5fd" />
                            <stop offset="100%" stopColor="#a78bfa" />
                          </linearGradient>
                        </defs>

                        <rect width="380" height="480" fill="url(#hrWall)" />

                        <rect x="46" y="40" width="120" height="150" rx="10" fill="url(#hrWindow)" opacity="0.85" />
                        <rect x="46" y="40" width="120" height="150" rx="10" fill="none" stroke="#4c1d95" strokeWidth="6" opacity="0.5" />
                        <rect x="104" y="40" width="6" height="150" fill="#4c1d95" opacity="0.4" />
                        <rect x="46" y="112" width="120" height="6" fill="#4c1d95" opacity="0.4" />
                        <circle cx="128" cy="76" r="20" fill="#fff9cc" opacity="0.5" />
                        <ellipse cx="80" cy="150" rx="26" ry="12" fill="white" opacity="0.35" />

                        <rect x="220" y="60" width="100" height="70" rx="10" fill="white" opacity="0.5" />
                        <rect x="234" y="74" width="30" height="6" rx="3" fill="#7c3aed" opacity="0.55" />
                        <rect x="234" y="86" width="52" height="5" rx="2.5" fill="#a78bfa" opacity="0.5" />
                        <rect x="234" y="98" width="40" height="5" rx="2.5" fill="#a78bfa" opacity="0.4" />
                        <rect x="234" y="110" width="46" height="5" rx="2.5" fill="#a78bfa" opacity="0.4" />

                        <rect x="0" y="392" width="380" height="88" fill="url(#hrFloor)" />
                        <rect x="0" y="390" width="380" height="5" fill="#8b5cf6" opacity="0.5" />
                        <ellipse cx="190" cy="424" rx="150" ry="18" fill="#4c1d95" opacity="0.15" />

                        <rect x="52" y="248" width="276" height="18" rx="6" fill="url(#hrDesk)" />
                        <rect x="60" y="266" width="14" height="120" rx="4" fill="#4c1d95" opacity="0.75" />
                        <rect x="306" y="266" width="14" height="120" rx="4" fill="#4c1d95" opacity="0.75" />

                        <rect x="140" y="196" width="100" height="60" rx="6" fill="#3b0764" />
                        <rect x="146" y="200" width="88" height="48" rx="4" fill="url(#hrScreen)" />
                        <rect x="154" y="208" width="40" height="6" rx="3" fill="#8b5cf6" opacity="0.7" />
                        <rect x="154" y="220" width="72" height="4" rx="2" fill="#c4b5fd" />
                        <rect x="154" y="228" width="60" height="4" rx="2" fill="#c4b5fd" opacity="0.8" />
                        <rect x="154" y="236" width="66" height="4" rx="2" fill="#c4b5fd" opacity="0.6" />
                        <rect x="176" y="256" width="28" height="10" fill="#2e1065" />
                        <rect x="164" y="264" width="52" height="6" rx="3" fill="#1e0a45" />

                        <rect x="86" y="212" width="34" height="6" rx="3" fill="#3b0764" />
                        <rect x="86" y="220" width="34" height="34" rx="4" fill="#f5f3ff" />
                        <rect x="90" y="226" width="26" height="3" rx="1.5" fill="#7c3aed" />
                        <rect x="90" y="232" width="20" height="3" rx="1.5" fill="#a78bfa" />
                        <rect x="90" y="238" width="24" height="3" rx="1.5" fill="#a78bfa" />
                        <path d="M92 246 l4 4 l8 -9" stroke="#7c3aed" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />

                        <circle cx="258" cy="228" r="10" fill="#f5f3ff" />
                        <rect x="250" y="224" width="16" height="10" rx="2" fill="#c4b5fd" />
                        <rect x="253" y="238" width="10" height="14" rx="3" fill="#7c3aed" />

                        <g>
                          <rect x="150" y="298" width="34" height="88" rx="14" fill="#6d28d9" />
                          <circle cx="167" cy="288" r="18" fill="#fcd9b8" />
                          <path d="M149 284 q18 -26 36 0 l-4 10 q-14 -16 -28 0 z" fill="#3b0764" />
                          <rect x="140" y="386" width="54" height="10" rx="5" fill="#4c1d95" />
                        </g>

                        <g>
                          <rect x="212" y="292" width="30" height="94" rx="13" fill="#8b5cf6" />
                          <circle cx="227" cy="280" r="16" fill="#fcd9b8" />
                          <path d="M212 278 q15 -22 30 0 l-3 8 q-12 -13 -24 0 z" fill="#2e1065" />
                          <rect x="204" y="386" width="50" height="10" rx="5" fill="#4c1d95" />
                        </g>

                        <rect x="290" y="330" width="16" height="56" rx="8" fill="#7c3aed" opacity="0.85" />
                        <ellipse cx="298" cy="322" rx="20" ry="14" fill="#a78bfa" opacity="0.8" />
                        <ellipse cx="286" cy="314" rx="12" ry="9" fill="#8b5cf6" opacity="0.7" />
                        <ellipse cx="308" cy="316" rx="12" ry="9" fill="#8b5cf6" opacity="0.7" />

                        <circle cx="88" cy="176" r="18" fill="white" opacity="0.9" />
                        <path d="M80 176 l6 6 l12 -13" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    </div>
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
          <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the HR module handles — from onboarding to year-end appraisals.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Manage your full employee lifecycle in one place. No scattered spreadsheets, no shared drives, no missed leave balances.</p>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-xl bg-violet-50 p-2.5 text-xl text-violet-700">{f.icon}</div>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Works for any business that has people to manage.</h2>
              </div>
              <div className="mt-7 grid gap-4 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-2xl border border-slate-200 bg-violet-50/40 p-5 shadow-sm">
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Property to manage? Stock to track? Car wash to run? Milik covers those too.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">HR is one module in a wider system. Activate what your business needs — every module shares the same accounting core and user management. One login, one system.</p>
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
            <div className="rounded-2xl bg-gradient-to-r from-violet-800 via-violet-700 to-violet-900 px-6 py-8 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-200">Ready to manage your team properly?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Explore HR and payroll in the Milik demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/85">
                  See employee records, payroll runs, leave management and KPI tracking in a guided demo environment.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-violet-800 transition hover:bg-violet-50"
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
