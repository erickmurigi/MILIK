import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaCoins, FaFileInvoice, FaHandshake, FaHome, FaLayerGroup, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import { setTitle, setDesc, setKeywords, setCanonical, setOg, setTw, setSchema, removeSchema } from "../../utils/pageMeta";
import inventoryImg from "../../assets/landing/INVENTORY AND POS.png";

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
                    <img src={inventoryImg} alt="Inventory manager using Milik POS system" loading="eager" className="lg:h-full lg:object-cover" />
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
