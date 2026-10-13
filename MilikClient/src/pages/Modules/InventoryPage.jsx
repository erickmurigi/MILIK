import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  FaArrowRight, FaBuilding, FaCar, FaChartLine, FaCheckCircle,
  FaCoins, FaFileInvoice, FaHandshake, FaHome, FaLayerGroup, FaUsers, FaWarehouse,
} from "react-icons/fa";
import ModulePageShell from "./ModulePageShell";
import MetricTile from "../../components/MetricTile";
import BrandPatternPanel from "../../components/BrandPatternPanel";
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

const otherModules = [
  { icon: <FaBuilding />, title: "Property Management", desc: "Tenant billing, M-PESA rent collection and landlord statements.", href: "/property-management" },
  { icon: <FaCar />, title: "Car Wash", desc: "Job tracking, loyalty programs and staff commissions.", href: "/car-wash" },
  { icon: <FaUsers />, title: "Human Resources", desc: "Payroll, leave management and staff appraisals.", href: "/human-resources" },
  { icon: <FaHandshake />, title: "Property Sales", desc: "Listings, buyer tracking and agent commissions.", href: "/property-sales" },
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
    setOg("og:image", `${SITE}/og-image.png`);
    setOg("og:image:width", "512");
    setOg("og:image:height", "512");
    setOg("og:image:alt", "Milik Inventory and POS Management Kenya");
    setTw("twitter:card", "summary_large_image");
    setTw("twitter:site", "@milikproperty");
    setTw("twitter:title", "Inventory and POS Management Kenya | Milik");
    setTw("twitter:description", "Stock management, purchase orders, POS sessions and till reconciliation for Kenyan businesses.");
    setTw("twitter:image", `${SITE}/og-image.png`);
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
          <section className="border-b border-slate-200 bg-[#f7faf8]">
            <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2 lg:items-start lg:gap-14 lg:px-8 lg:py-16">
              <div>
                <div className="inline-flex items-center gap-2 border border-[#0B3B2E]/15 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-[#0B3B2E]">
                  Inventory & POS
                </div>
                <h1 className="mt-4 text-2xl font-extrabold leading-[1.15] tracking-tight text-slate-950 sm:text-3xl lg:text-[2.2rem]">
                  Know your stock, control your till, close the day with numbers you trust.
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Stockouts, phantom shortages and till discrepancies usually come down to one thing — no single source of truth. Milik connects purchasing, stock and point of sale so every number matches.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => openTrialModal("inventory_pos")}
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

              <BrandPatternPanel eyebrow="What Inventory & POS tracks · example workspace">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile label="Items in stock" value="1,240" />
                  <MetricTile label="Low stock alerts" value="6" />
                  <MetricTile label="Sales today" value="KSh 32.4K" big accent className="col-span-2" />
                  <MetricTile label="Open purchase orders" value="4" />
                  <MetricTile label="Till variance" value="KSh 0" />
                </div>
              </BrandPatternPanel>
            </div>
          </section>

          {/* Features */}
          <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FF8C00]">What it does</p>
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">What the inventory module handles — from purchase order to till close.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">One stock figure, one accounting figure, every time. No separate spreadsheet to reconcile at month-end.</p>
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
                <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">From a single counter to a full supply chain.</h2>
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
              <h2 className="mt-2 text-2xl font-extrabold text-slate-950 sm:text-3xl">Also managing property, staff or a car wash? Milik covers that too.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">Every Milik module uses the same workspace and the same accounting layer. Add more when your business needs it — no migration, no new system to learn.</p>
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
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#FF8C00]">Ready to clean up your stock and till?</p>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">Explore inventory and POS in the Milik demo workspace.</h2>
                <p className="mt-3 text-sm leading-6 text-white/80">
                  Request a free demo and see purchase orders, stock receipts, POS sessions and till reconciliation with real sample data.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => openTrialModal("inventory_pos")}
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
