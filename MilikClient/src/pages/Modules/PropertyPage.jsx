import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBook, FaBuilding, FaCar, FaCheckCircle,
  FaCoins, FaFileInvoice, FaHandshake, FaMobileAlt, FaShieldAlt, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
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

const stats = [
  { value: "Auto", label: "M-PESA reconciliation" },
  { value: "Instant", label: "Landlord statements" },
  { value: "Zero", label: "Manual data entry" },
];

const otherModules = [
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash", color: "text-sky-700", bg: "bg-sky-50" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources", color: "text-violet-700", bg: "bg-violet-50" },
  { icon: <FaWarehouse />, title: "Inventory & POS", desc: "Stock management, purchase orders and point of sale.", href: "/inventory-pos", color: "text-orange-700", bg: "bg-orange-50" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales", color: "text-emerald-700", bg: "bg-emerald-50" },
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
    setOg("og:image", `${SITE}/logo.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Property Management Software Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Property Management Software Kenya | Milik");
    setTw("twitter:description", "Manage properties, tenants, M-PESA rent collection and landlord statements in one workspace. Built for Kenya.");
    setTw("twitter:image", `${SITE}/logo.png`);
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
          <section className="relative overflow-hidden bg-gradient-to-br from-[#ECF6F1] via-white to-white lg:h-[calc(100vh-78px)]">
            <div className="mx-auto h-full max-w-7xl px-4 py-10 sm:px-6 lg:flex lg:items-center lg:px-8 lg:py-0">
              <div className="grid w-full gap-8 lg:h-full lg:grid-cols-2 lg:items-stretch lg:gap-10">
                <div className="lg:self-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#0B3B2E]/15 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-[#0B3B2E] shadow-sm">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0B3B2E]/10 text-[#0B3B2E]">
                      <FaBuilding className="text-[9px]" />
                    </span>
                    Property Management
                  </div>
                  <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-[-0.02em] text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                    Property management that actually works — M-PESA billing, landlord reports, all in one place.
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Most property managers are still chasing rent on WhatsApp and reconciling M-PESA statements by hand. Milik fixes that — invoices go out on time, payments match automatically, landlord statements write themselves.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-slate-200 py-3">
                    {stats.map((s) => (
                      <div key={s.label}>
                        <p className="text-base font-extrabold text-[#0B3B2E]">{s.value}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button type="button" onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-[#0B3B2E] px-5 py-2 text-xs font-bold text-white shadow-lg shadow-[#0B3B2E]/20 transition hover:bg-[#0A3127]">
                      Request a Free Demo <FaArrowRight />
                    </button>
                    <Link to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-800 transition hover:border-[#0B3B2E] hover:text-[#0B3B2E]">
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-[10px] text-[#0B3B2E]" />
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
                          <linearGradient id="pSky" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#e8f5ef" />
                            <stop offset="100%" stopColor="#cde8da" />
                          </linearGradient>
                          <linearGradient id="pBldg" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#0e4535" />
                            <stop offset="100%" stopColor="#0B3B2E" />
                          </linearGradient>
                          <linearGradient id="pGround" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#b8dfc8" />
                            <stop offset="100%" stopColor="#9ecdb4" />
                          </linearGradient>
                          <linearGradient id="pLitWin" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ffffff" />
                            <stop offset="100%" stopColor="#dff5ea" />
                          </linearGradient>
                        </defs>

                        <rect width="380" height="480" fill="url(#pSky)" />

                        <circle cx="344" cy="42" r="28" fill="#fff9cc" opacity="0.55" />
                        <circle cx="344" cy="42" r="17" fill="#ffe566" opacity="0.42" />

                        <ellipse cx="68" cy="56" rx="38" ry="18" fill="white" opacity="0.7" />
                        <ellipse cx="98" cy="47" rx="28" ry="14" fill="white" opacity="0.7" />
                        <ellipse cx="46" cy="63" rx="23" ry="12" fill="white" opacity="0.7" />
                        <ellipse cx="288" cy="38" rx="30" ry="13" fill="white" opacity="0.48" />
                        <ellipse cx="312" cy="30" rx="21" ry="11" fill="white" opacity="0.48" />

                        <rect x="6" y="290" width="50" height="150" rx="4" fill="#0B3B2E" opacity="0.11" />
                        <rect x="324" y="300" width="50" height="140" rx="4" fill="#0B3B2E" opacity="0.1" />
                        <rect x="18" y="300" width="10" height="12" rx="2" fill="white" opacity="0.2" />
                        <rect x="34" y="300" width="10" height="12" rx="2" fill="white" opacity="0.2" />
                        <rect x="18" y="322" width="10" height="12" rx="2" fill="white" opacity="0.2" />
                        <rect x="34" y="322" width="10" height="12" rx="2" fill="white" opacity="0.2" />
                        <rect x="334" y="312" width="30" height="10" rx="2" fill="white" opacity="0.15" />
                        <rect x="334" y="332" width="30" height="10" rx="2" fill="white" opacity="0.15" />

                        <rect x="0" y="418" width="380" height="62" fill="url(#pGround)" />
                        <rect x="0" y="416" width="380" height="5" fill="#8ecbaa" opacity="0.65" />

                        <rect x="148" y="418" width="84" height="62" rx="3" fill="#c5e6d2" opacity="0.8" />
                        <rect x="162" y="426" width="56" height="3" rx="1" fill="white" opacity="0.4" />
                        <rect x="162" y="436" width="56" height="3" rx="1" fill="white" opacity="0.32" />
                        <rect x="162" y="446" width="56" height="3" rx="1" fill="white" opacity="0.28" />

                        <rect x="66" y="420" width="248" height="10" rx="5" fill="#0B3B2E" opacity="0.11" />

                        <rect x="70" y="90" width="240" height="332" rx="8" fill="url(#pBldg)" />

                        <rect x="62" y="82" width="256" height="14" rx="6" fill="#073029" />
                        <rect x="78" y="66" width="224" height="20" rx="5" fill="#082d22" />

                        <rect x="164" y="48" width="52" height="20" rx="4" fill="#051e14" />
                        <ellipse cx="190" cy="48" rx="26" ry="11" fill="#073328" />
                        <rect x="166" y="36" width="48" height="14" rx="5" fill="#082d22" />
                        <rect x="186" y="58" width="5" height="10" rx="2" fill="#051e14" />
                        <rect x="194" y="58" width="5" height="10" rx="2" fill="#051e14" />

                        <rect x="189" y="12" width="3" height="26" fill="#062820" />
                        <polygon points="192,12 208,18 192,24" fill="#C96F00" />

                        <rect x="70" y="170" width="240" height="5" rx="1" fill="#062820" />
                        <rect x="70" y="250" width="240" height="5" rx="1" fill="#062820" />
                        <rect x="70" y="330" width="240" height="5" rx="1" fill="#062820" />

                        <rect x="84" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="86" y="102" width="34" height="56" rx="3" fill="url(#pLitWin)" />
                        <rect x="86" y="102" width="14" height="56" rx="2" fill="white" opacity="0.28" />
                        <rect x="132" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.25" />
                        <rect x="134" y="102" width="34" height="56" rx="3" fill="#0d4f38" opacity="0.82" />
                        <rect x="180" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="182" y="102" width="34" height="56" rx="3" fill="url(#pLitWin)" />
                        <rect x="182" y="102" width="14" height="56" rx="2" fill="white" opacity="0.28" />
                        <rect x="228" y="100" width="38" height="60" rx="4" fill="#18a06f" opacity="0.28" />
                        <rect x="230" y="102" width="34" height="56" rx="3" fill="#dff5ea" opacity="0.55" />

                        <rect x="76" y="157" width="228" height="5" rx="2" fill="#C96F00" opacity="0.78" />
                        <rect x="78" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
                        <rect x="122" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
                        <rect x="168" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
                        <rect x="214" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />
                        <rect x="298" y="143" width="3" height="18" fill="#C96F00" opacity="0.52" />

                        <rect x="84" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.25" />
                        <rect x="86" y="182" width="34" height="56" rx="3" fill="#0d4f38" opacity="0.78" />
                        <rect x="132" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="134" y="182" width="34" height="56" rx="3" fill="url(#pLitWin)" />
                        <rect x="134" y="182" width="14" height="56" rx="2" fill="white" opacity="0.25" />
                        <rect x="180" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="182" y="182" width="34" height="56" rx="3" fill="#dff5ea" opacity="0.88" />
                        <rect x="182" y="182" width="34" height="16" rx="2" fill="white" opacity="0.32" />
                        <rect x="228" y="180" width="38" height="60" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="230" y="182" width="34" height="56" rx="3" fill="url(#pLitWin)" />

                        <rect x="76" y="237" width="228" height="5" rx="2" fill="#C96F00" opacity="0.72" />
                        <rect x="78" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="122" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="168" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="214" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="298" y="223" width="3" height="18" fill="#C96F00" opacity="0.5" />

                        <rect x="84" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="86" y="261" width="34" height="57" rx="3" fill="url(#pLitWin)" />
                        <rect x="132" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="134" y="261" width="34" height="57" rx="3" fill="#dff5ea" opacity="0.88" />
                        <rect x="134" y="261" width="34" height="16" rx="2" fill="white" opacity="0.3" />
                        <rect x="134" y="277" width="14" height="41" rx="2" fill="#c8eeda" opacity="0.55" />
                        <rect x="180" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.25" />
                        <rect x="182" y="261" width="34" height="57" rx="3" fill="#0d4f38" opacity="0.78" />
                        <rect x="228" y="259" width="38" height="61" rx="4" fill="#18a06f" opacity="0.35" />
                        <rect x="230" y="261" width="34" height="57" rx="3" fill="url(#pLitWin)" />
                        <rect x="230" y="261" width="13" height="57" rx="2" fill="white" opacity="0.28" />

                        <rect x="76" y="317" width="228" height="5" rx="2" fill="#C96F00" opacity="0.72" />
                        <rect x="78" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="122" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="168" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="214" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />
                        <rect x="298" y="303" width="3" height="18" fill="#C96F00" opacity="0.5" />

                        <rect x="84" y="339" width="54" height="79" rx="4" fill="#082d22" />
                        <rect x="86" y="354" width="50" height="36" rx="3" fill="#0d4f38" opacity="0.72" />
                        <rect x="90" y="341" width="42" height="11" rx="3" fill="#C96F00" opacity="0.82" />

                        <rect x="148" y="335" width="84" height="83" rx="6" fill="#062820" />
                        <rect x="150" y="337" width="80" height="17" rx="4" fill="#0B3B2E" opacity="0.5" />
                        <rect x="150" y="354" width="38" height="64" rx="4" fill="#18a06f" opacity="0.48" />
                        <rect x="192" y="354" width="38" height="64" rx="4" fill="#18a06f" opacity="0.48" />
                        <rect x="159" y="358" width="14" height="14" rx="2" fill="#ccf0e2" opacity="0.68" />
                        <rect x="207" y="358" width="14" height="14" rx="2" fill="#ccf0e2" opacity="0.68" />
                        <circle cx="188" cy="388" r="3" fill="#C96F00" />
                        <circle cx="192" cy="388" r="3" fill="#C96F00" />

                        <rect x="242" y="339" width="54" height="79" rx="4" fill="#082d22" />
                        <rect x="244" y="354" width="50" height="36" rx="3" fill="#0d4f38" opacity="0.72" />
                        <rect x="248" y="341" width="42" height="11" rx="3" fill="#18a06f" opacity="0.58" />

                        <rect x="140" y="334" width="100" height="17" rx="4" fill="#062820" />
                        <rect x="143" y="337" width="94" height="11" rx="3" fill="#C96F00" opacity="0.22" />

                        <rect x="140" y="414" width="100" height="6" rx="2" fill="#062820" opacity="0.38" />
                        <rect x="148" y="419" width="84" height="4" rx="2" fill="#062820" opacity="0.22" />

                        <circle cx="76" cy="92" r="4" fill="#C96F00" opacity="0.88" />
                        <circle cx="304" cy="92" r="4" fill="#C96F00" opacity="0.88" />
                        <circle cx="190" cy="86" r="5" fill="#C96F00" opacity="0.82" />

                        <rect x="26" y="375" width="12" height="48" rx="4" fill="#062820" />
                        <circle cx="32" cy="355" r="30" fill="#18a06f" opacity="0.78" />
                        <circle cx="14" cy="369" r="18" fill="#18a06f" opacity="0.68" />
                        <circle cx="50" cy="367" r="20" fill="#18a06f" opacity="0.72" />
                        <circle cx="26" cy="343" r="12" fill="#28c98a" opacity="0.28" />

                        <rect x="342" y="382" width="10" height="42" rx="3" fill="#062820" />
                        <circle cx="347" cy="366" r="24" fill="#18a06f" opacity="0.74" />
                        <circle cx="332" cy="378" r="14" fill="#18a06f" opacity="0.64" />
                        <circle cx="360" cy="376" r="16" fill="#18a06f" opacity="0.68" />

                        <circle cx="74" cy="420" r="11" fill="#18a06f" opacity="0.58" />
                        <circle cx="62" cy="424" r="8" fill="#18a06f" opacity="0.48" />
                        <circle cx="306" cy="420" r="11" fill="#18a06f" opacity="0.58" />
                        <circle cx="318" cy="424" r="8" fill="#18a06f" opacity="0.48" />
                      </svg>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0B3B2E]/40 via-transparent to-transparent" />
                    <div className="module-hero-badge bg-[#0B3B2E]/90 text-white">
                      <div>
                        <p className="module-hero-badge-title">Property Management</p>
                      </div>
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                        <FaBuilding />
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the system actually handles — from unit to landlord statement.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Everything in one workspace, with a proper accounting layer running underneath. No separate tools, no exports to Excel.</p>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-xl bg-[#0B3B2E]/10 p-2.5 text-xl text-[#0B3B2E]">{f.icon}</div>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Whether you manage 5 units or 500, it works the same way.</h2>
              </div>
              <div className="mt-7 grid gap-4 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-2xl border border-slate-200 bg-[#f7fbf8] p-5 shadow-sm">
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">If you also run a car wash, manage staff or track stock — Milik covers that too.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Every Milik module uses the same workspace and the same accounting layer. Add more when your business needs it — no migration, no new system to learn.</p>
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
            <div className="rounded-2xl bg-gradient-to-r from-[#0B3B2E] via-[#104F3E] to-[#0A3127] px-6 py-8 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#F8C471]">Ready to see it in action?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Open the property management demo and see how it works.</h2>
                <p className="mt-3 text-sm leading-6 text-white/85">
                  Get 3-day access to a guided workspace with sample properties, tenant flows, owner statements and financial reports.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-[#0B3B2E] transition hover:bg-slate-100"
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
