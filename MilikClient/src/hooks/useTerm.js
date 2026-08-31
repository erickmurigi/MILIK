import { useSelector, shallowEqual } from "react-redux";

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

export { DEFAULTS as TERM_DEFAULTS };
