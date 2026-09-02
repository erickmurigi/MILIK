import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaCoins, FaFileInvoice, FaHandshake, FaHome, FaLayerGroup, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";

const SITE = "https://milikproperty.com";

const features = [
  {
    icon: <FaLayerGroup />,
    title: "Stock item catalog",
    description: "Manage your full product catalog — item codes, categories, units of measure, reorder levels and stock quantities in real time.",
  },
  {
    icon: <FaFileInvoice />,
    title: "Purchase orders",
    description: "Raise purchase orders, send to suppliers, receive stock against orders and watch inventory update automatically on receipt.",
  },
  {
    icon: <FaWarehouse />,
    title: "Supplier management",
    description: "Maintain supplier contacts, track order history, manage outstanding balances and build a reliable procurement record.",
  },
  {
    icon: <FaHome />,
    title: "Point of sale sessions",
    description: "Run counter sales, issue receipts, manage multiple cashiers and track all POS transactions against your stock levels.",
  },
  {
    icon: <FaCoins />,
    title: "Till reconciliation",
    description: "Close the till at end of shift — compare expected vs actual cash, record the variance and maintain a clean daily summary.",
  },
  {
    icon: <FaChartLine />,
    title: "Stock movement reports",
    description: "Track all inflows, outflows, adjustments and current stock value — full audit trail from purchase order to sale.",
  },
];

const useCases = [
  {
    title: "Retail shops and supermarkets",
    description: "Manage a full product catalog, process customer sales at the counter and reconcile tills at end of day with full stock visibility.",
  },
  {
    title: "Wholesale and distribution businesses",
    description: "Raise purchase orders, receive stock from suppliers, manage large catalogs and track stock movements across your operation.",
  },
  {
    title: "Service businesses with physical stock",
    description: "Manage consumables, spare parts or retail add-ons alongside your service operation — all in one Milik workspace.",
  },
];

const highlights = [
  "Stock levels updated on every purchase receipt",
  "Purchase orders tracked from creation to delivery",
  "POS sessions linked directly to live inventory",
  "Till reconciliation at end of every shift",
  "Reorder alerts when stock hits minimum level",
  "Full accounting — COGS, margins, financial reports",
];

const stats = [
  { value: "Real-time", label: "Stock level updates" },
  { value: "Auto", label: "POS to accounting" },
  { value: "Full audit", label: "Stock movement trail" },
];

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management", color: "text-[#0B3B2E]", bg: "bg-[#0B3B2E]/10" },
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash", color: "text-sky-700", bg: "bg-sky-50" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources", color: "text-violet-700", bg: "bg-violet-50" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales", color: "text-emerald-700", bg: "bg-emerald-50" },
];

export default function InventoryPage() {
  useEffect(() => {
    const url = `${SITE}/inventory-pos`;
    setTitle("Inventory and POS Management Kenya — Stock, Orders & Point of Sale | Milik");
    setDesc("Milik Inventory & POS — manage stock items, create purchase orders, receive from suppliers, run POS sessions and reconcile tills for your Kenyan business.");
    setKeywords("inventory management software Kenya, stock management system Kenya, point of sale system Kenya, POS software Kenya, purchase order management Kenya, stock tracking software Kenya, retail management system Kenya, inventory control software Kenya, till reconciliation software, warehouse management Kenya");
    setCanonical(url);
    setOg("og:type", "website");
    setOg("og:site_name", "Milik");
    setOg("og:locale", "en_KE");
    setOg("og:title", "Inventory and POS Management Kenya | Milik");
    setOg("og:description", "Manage stock items, purchase orders, supplier deliveries, POS sessions and till reconciliation for your Kenyan business.");
    setOg("og:url", url);
    setOg("og:image", `${SITE}/logo.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Inventory and POS Management Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Inventory and POS Management Kenya | Milik");
    setTw("twitter:description", "Stock management, purchase orders, POS sessions and till reconciliation for Kenyan businesses.");
    setTw("twitter:image", `${SITE}/logo.png`);
    setSchema("page", {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE}/` },
            { "@type": "ListItem", "position": 2, "name": "Inventory and POS Management Kenya", "item": url }
          ]
        },
        {
          "@type": "WebPage",
          "@id": url,
          "name": "Inventory and POS Management Kenya — Stock, Orders & Point of Sale | Milik",
          "description": "Stock management and point of sale software for Kenya — purchase orders, supplier management, POS sessions and till reconciliation in one system.",
          "url": url,
          "inLanguage": "en-KE",
          "isPartOf": { "@type": "WebSite", "url": SITE, "name": "Milik" }
        },
        {
          "@type": "SoftwareApplication",
          "name": "Milik Inventory and POS",
          "applicationCategory": "BusinessApplication",
          "applicationSubCategory": "Inventory Management Software",
          "operatingSystem": "Web, Browser",
          "url": url,
          "description": "Inventory and point of sale management software for Kenyan businesses — stock catalog, purchase orders, supplier management, POS sessions and daily till reconciliation.",
          "featureList": [
            "Full stock item catalog with reorder levels",
            "Purchase order creation and supplier management",
            "Stock receipt against purchase orders",
            "Point of sale sessions with multiple cashiers",
            "Daily till close and shift reconciliation",
            "Stock movement and audit trail reports",
            "Low-stock alerts and reorder notifications",
            "Accounting integration — COGS, margins, financial reports"
          ],
          "offers": {
            "@type": "Offer",
            "priceCurrency": "KES",
            "description": "Contact Milik for inventory and POS module pricing"
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
          <section className="relative overflow-hidden bg-gradient-to-br from-orange-50 via-white to-white lg:h-[calc(100vh-78px)]">
            <div className="mx-auto h-full max-w-7xl px-4 py-10 sm:px-6 lg:flex lg:items-center lg:px-8 lg:py-0">
              <div className="grid w-full gap-8 lg:h-full lg:grid-cols-2 lg:items-stretch lg:gap-10">
                <div className="lg:self-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-orange-700 shadow-sm">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-50 text-orange-700">
                      <FaWarehouse className="text-[9px]" />
                    </span>
                    Inventory & POS
                  </div>
                  <h1 className="mt-4 text-2xl font-extrabold leading-tight tracking-[-0.02em] text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                    Stock management and point of sale — from purchase order to till close, all in one system.
                  </h1>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Milik gives retail and wholesale businesses a complete inventory system — manage stock, raise purchase orders, receive from suppliers, run POS sessions and reconcile tills at end of day.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-slate-200 py-3">
                    {stats.map((s) => (
                      <div key={s.label}>
                        <p className="text-base font-extrabold text-orange-700">{s.value}</p>
                        <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <button type="button" onClick={() => openTrialModal("property_manager")}
                      className="inline-flex items-center gap-2 rounded-full bg-orange-700 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-orange-700/20 transition hover:bg-orange-800">
                      Request a Free Demo <FaArrowRight />
                    </button>
                    <Link to="/#pricing"
                      className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-800 transition hover:border-orange-700 hover:text-orange-700">
                      View Pricing
                    </Link>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {highlights.map((h) => (
                      <div key={h} className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <FaCheckCircle className="mt-0.5 shrink-0 text-[10px] text-orange-700" />
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
                          <linearGradient id="ivWall" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ffedd5" />
                            <stop offset="100%" stopColor="#fed7aa" />
                          </linearGradient>
                          <linearGradient id="ivShelf" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#9a3412" />
                            <stop offset="100%" stopColor="#7c2d12" />
                          </linearGradient>
                          <linearGradient id="ivFloor" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fdba74" />
                            <stop offset="100%" stopColor="#fb923c" />
                          </linearGradient>
                          <linearGradient id="ivCounter" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#c2410c" />
                            <stop offset="100%" stopColor="#9a3412" />
                          </linearGradient>
                          <linearGradient id="ivScreen" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#fff7ed" />
                            <stop offset="100%" stopColor="#fed7aa" />
                          </linearGradient>
                        </defs>

                        <rect width="380" height="480" fill="url(#ivWall)" />

                        <ellipse cx="100" cy="60" rx="46" ry="10" fill="white" opacity="0.4" />
                        <polygon points="100,52 130,86 70,86" fill="#fed7aa" opacity="0.55" />

                        <rect x="0" y="404" width="380" height="76" fill="url(#ivFloor)" />
                        <rect x="0" y="402" width="380" height="5" fill="#f97316" opacity="0.5" />
                        <rect x="10" y="420" width="360" height="3" fill="#c2410c" opacity="0.25" />
                        <rect x="10" y="440" width="360" height="3" fill="#c2410c" opacity="0.2" />
                        <rect x="10" y="460" width="360" height="3" fill="#c2410c" opacity="0.18" />

                        <rect x="30" y="86" width="150" height="16" rx="3" fill="url(#ivShelf)" />
                        <rect x="30" y="150" width="150" height="16" rx="3" fill="url(#ivShelf)" />
                        <rect x="30" y="214" width="150" height="16" rx="3" fill="url(#ivShelf)" />
                        <rect x="30" y="278" width="150" height="16" rx="3" fill="url(#ivShelf)" />
                        <rect x="30" y="86" width="14" height="208" fill="url(#ivShelf)" />
                        <rect x="166" y="86" width="14" height="208" fill="url(#ivShelf)" />

                        <rect x="48" y="106" width="36" height="40" rx="3" fill="#c2410c" />
                        <rect x="48" y="106" width="36" height="6" fill="#ea580c" />
                        <rect x="64" y="106" width="4" height="40" fill="#7c2d12" />
                        <rect x="90" y="112" width="30" height="34" rx="3" fill="#fb923c" />
                        <rect x="90" y="112" width="30" height="5" fill="#fdba74" />
                        <rect x="128" y="100" width="34" height="46" rx="3" fill="#ea580c" />
                        <rect x="128" y="100" width="34" height="6" fill="#fb923c" />
                        <rect x="134" y="112" width="2" height="28" fill="white" opacity="0.6" />
                        <rect x="138" y="112" width="2" height="28" fill="white" opacity="0.4" />
                        <rect x="142" y="112" width="2" height="28" fill="white" opacity="0.6" />
                        <rect x="146" y="112" width="2" height="28" fill="white" opacity="0.4" />

                        <rect x="48" y="172" width="30" height="38" rx="3" fill="#fb923c" />
                        <rect x="82" y="166" width="36" height="44" rx="3" fill="#c2410c" />
                        <rect x="82" y="166" width="36" height="6" fill="#ea580c" />
                        <rect x="122" y="174" width="32" height="36" rx="3" fill="#ea580c" />

                        <rect x="52" y="236" width="34" height="38" rx="3" fill="#ea580c" />
                        <rect x="90" y="240" width="34" height="34" rx="3" fill="#fb923c" />
                        <rect x="128" y="232" width="34" height="42" rx="3" fill="#c2410c" />
                        <rect x="128" y="232" width="34" height="6" fill="#ea580c" />

                        <rect x="46" y="298" width="140" height="10" rx="3" fill="#7c2d12" opacity="0.35" />
                        <rect x="52" y="296" width="60" height="22" rx="3" fill="#9a3412" />
                        <rect x="118" y="292" width="44" height="28" rx="3" fill="#c2410c" />
                        <path d="M56 316 v10 M64 316 v10 M72 316 v10 M80 316 v10 M88 316 v10 M96 316 v10 M104 316 v10" stroke="#3f1c0f" strokeWidth="1.6" opacity="0.55" />

                        <rect x="212" y="252" width="150" height="120" rx="10" fill="url(#ivCounter)" />
                        <rect x="212" y="252" width="150" height="14" rx="6" fill="#ea580c" />
                        <rect x="224" y="284" width="46" height="6" rx="3" fill="#fdba74" opacity="0.6" />
                        <rect x="224" y="296" width="60" height="6" rx="3" fill="#fdba74" opacity="0.45" />

                        <rect x="288" y="180" width="66" height="76" rx="6" fill="#431407" />
                        <rect x="294" y="186" width="54" height="46" rx="3" fill="url(#ivScreen)" />
                        <polyline points="298,222 310,206 320,214 334,196 344,204" stroke="#ea580c" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        <rect x="316" y="236" width="20" height="10" fill="#7c2d12" />
                        <rect x="306" y="246" width="40" height="6" rx="3" fill="#3f1c0f" />

                        <rect x="248" y="204" width="44" height="14" rx="4" fill="#1c0a03" transform="rotate(-18 270 211)" />
                        <circle cx="253" cy="220" r="5" fill="#fb923c" transform="rotate(-18 270 211)" />
                        <rect x="240" y="208" width="16" height="4" fill="#ef4444" opacity="0.85" transform="rotate(-18 270 211)" />

                        <rect x="234" y="272" width="52" height="34" rx="3" fill="#fdba74" />
                        <rect x="238" y="276" width="2" height="26" fill="#7c2d12" opacity="0.7" />
                        <rect x="243" y="276" width="2" height="26" fill="#7c2d12" opacity="0.5" />
                        <rect x="248" y="276" width="2" height="26" fill="#7c2d12" opacity="0.7" />
                        <rect x="253" y="276" width="2" height="26" fill="#7c2d12" opacity="0.5" />
                        <rect x="258" y="276" width="2" height="26" fill="#7c2d12" opacity="0.7" />
                        <rect x="263" y="276" width="2" height="26" fill="#7c2d12" opacity="0.5" />
                        <rect x="268" y="276" width="2" height="26" fill="#7c2d12" opacity="0.7" />
                        <rect x="273" y="276" width="2" height="26" fill="#7c2d12" opacity="0.5" />

                        <ellipse cx="190" cy="404" rx="150" ry="14" fill="#7c2d12" opacity="0.15" />
                      </svg>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-orange-900/45 via-transparent to-transparent" />
                    <div className="module-hero-badge bg-orange-700/90 text-white">
                      <div>
                        <p className="module-hero-badge-title">Inventory & POS</p>
                      </div>
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-lg">
                        <FaWarehouse />
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">From purchase order to till close — what the inventory module handles.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Raise a purchase order, receive stock, sell at the counter, close the till — the whole flow in one system, all posting to the same accounting layer.</p>
            </div>
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
                  <div className="inline-flex rounded-xl bg-orange-50 p-2.5 text-xl text-orange-700">{f.icon}</div>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Retail shops, wholesalers and service businesses with stock.</h2>
              </div>
              <div className="mt-7 grid gap-4 lg:grid-cols-3">
                {useCases.map((uc) => (
                  <div key={uc.title} className="rounded-2xl border border-slate-200 bg-orange-50/40 p-5 shadow-sm">
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Also managing rental property, HR or a car wash? Milik handles all of it.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Each module runs on its own but shares the same accounting layer and the same login. Add more when your business needs them — no data migration, no separate subscriptions for each tool.</p>
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
            <div className="rounded-2xl bg-gradient-to-r from-orange-800 via-orange-700 to-orange-900 px-6 py-8 text-white shadow-2xl">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-orange-200">Ready to manage your stock properly?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Explore Inventory & POS in the Milik demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/85">
                  See stock management, purchase orders, POS sessions and till reconciliation with real sample data.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("property_manager")}
                    className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-orange-800 transition hover:bg-orange-50"
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
