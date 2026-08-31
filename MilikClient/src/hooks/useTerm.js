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
};

// Returns a stable primitive — no shallowEqual needed; re-renders only when the string value changes.
export function useTerm(key) {
  return useSelector((s) => {
    const terminology = s.companySettings?.companySettings?.terminology;
    const custom = terminology instanceof Map ? terminology.get(key) : terminology?.[key];
    return custom || DEFAULTS[key] || key;
  });
}

// Multi-key variant — one Redux subscription for many terms.
// Object is built inside the selector; shallowEqual prevents re-renders when values haven't changed.
export function useTerms(...keys) {
  return useSelector((s) => {
    const terminology = s.companySettings?.companySettings?.terminology;
    const result = {};
    for (const k of keys) {
      const custom = terminology instanceof Map ? terminology.get(k) : terminology?.[k];
      result[k] = custom || DEFAULTS[k] || k;
    }
    return result;
  }, shallowEqual);
}

// Non-hook version for use outside components — pass the terminology object directly
export function getTerm(terminology, key) {
  const custom = terminology instanceof Map
    ? terminology?.get(key)
    : terminology?.[key];
  return custom || DEFAULTS[key] || key;
}

// Returns the active terminology preset label ("Water Vending", etc.) or null if no preset matches.
export function useTermPresetLabel() {
  return useSelector((s) => detectPresetLabel(s.companySettings?.companySettings?.terminology));
}

export { DEFAULTS as TERM_DEFAULTS };
