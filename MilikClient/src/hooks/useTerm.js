import { useSelector, shallowEqual } from "react-redux";

// Known terminology presets — used to detect which preset is active
const PRESET_SIGNATURES = [
  {
    label: "Water Vending",
    values: { tenant: "customer", tenants: "customers", unit: "meter", units: "meters", property: "zone", properties: "zones" },
  },
  {
    label: "Internet / ISP",
    values: { tenant: "subscriber", tenants: "subscribers", unit: "connection", units: "connections", property: "site", properties: "sites" },
  },
  {
    label: "Self-Storage",
    values: { tenant: "client", tenants: "clients", unit: "storage unit", units: "storage units", property: "facility", properties: "facilities" },
  },
];

function detectPresetLabel(terminology) {
  if (!terminology) return null;
  const get = (k) => (terminology instanceof Map ? terminology.get(k) : terminology?.[k] || "").toLowerCase().trim();
  for (const preset of PRESET_SIGNATURES) {
    if (Object.entries(preset.values).every(([k, v]) => get(k) === v)) return preset.label;
  }
  return null;
}

const DEFAULTS = {
  tenant: "Tenant",
  tenants: "Tenants",
  unit: "Unit",
  units: "Units",
  property: "Property",
  properties: "Properties",
  landlord: "Landlord",
  landlords: "Landlords",
  rent: "Rent",
  lease: "Lease",
  meter: "Meter",
  meters: "Meters",
  utility: "Utility",
  utilities: "Utilities",
  invoice: "Invoice",
  invoices: "Invoices",
  receipt: "Receipt",
  receipts: "Receipts",
  // Sales module — display words only (API and database names never change)
  saleModule: "Property Sales",
  saleListing: "Listing",
  saleListings: "Listings",
  saleProject: "Project",
  saleProjects: "Projects",
  saleUnit: "Unit",
  saleUnits: "Units",
  saleBuyer: "Buyer",
  saleBuyers: "Buyers",
  saleLead: "Lead",
  saleLeads: "Leads",
  saleOffer: "Offer",
  saleOffers: "Offers",
  saleDeal: "Deal",
  saleDeals: "Deals",
  saleAgent: "Agent",
  saleAgents: "Agents",
};

// Keys owned by the Sales module. The Terminology screen applies presets per scope, so choosing a Sales preset
// never clears the property-management words (and vice versa).
export const SALE_TERM_KEYS = Object.keys(DEFAULTS).filter((k) => k.startsWith("sale"));

// Sales plurals and their singular. A company that renames only the singular ("Vehicle") gets the regular plural
// ("Vehicles") for the plural key, instead of falling back to the default word ("Listings").
export const SALE_PLURAL_OF = {
  saleListings: "saleListing", saleProjects: "saleProject", saleUnits: "saleUnit", saleBuyers: "saleBuyer",
  saleLeads: "saleLead", saleOffers: "saleOffer", saleDeals: "saleDeal", saleAgents: "saleAgent",
};

const readTerm = (terminology, key) => (terminology instanceof Map ? terminology.get(key) : terminology?.[key]);

const resolveTerm = (terminology, key) => {
  const custom = readTerm(terminology, key);
  if (custom) return custom;
  const singular = SALE_PLURAL_OF[key];
  const customSingular = singular ? readTerm(terminology, singular) : null;
  if (customSingular) return `${customSingular}s`;
  return DEFAULTS[key] || key;
};

// Returns a stable primitive — no shallowEqual needed; re-renders only when the string value changes.
export function useTerm(key) {
  return useSelector((s) => resolveTerm(s.companySettings?.companySettings?.terminology, key));
}

// Multi-key variant — one Redux subscription for many terms.
// Object is built inside the selector; shallowEqual prevents re-renders when values haven't changed.
export function useTerms(...keys) {
  return useSelector((s) => {
    const terminology = s.companySettings?.companySettings?.terminology;
    const result = {};
    for (const k of keys) result[k] = resolveTerm(terminology, k);
    return result;
  }, shallowEqual);
}

// Non-hook version for use outside components — pass the terminology object directly
export function getTerm(terminology, key) {
  return resolveTerm(terminology, key);
}

// Returns the active terminology preset label ("Water Vending", etc.) or null if no preset matches.
export function useTermPresetLabel() {
  return useSelector((s) => detectPresetLabel(s.companySettings?.companySettings?.terminology));
}

// Compound labels such as "Sales Agent" / "Sale Deals": the prefix is kept only while the term is still the built-in
// default, so a renamed term stands alone ("Salesperson", not "Sales Salesperson").
export const prefixedTerm = (prefix, term, key) => (term === DEFAULTS[key] ? `${prefix} ${term}` : term);

export { DEFAULTS as TERM_DEFAULTS };
