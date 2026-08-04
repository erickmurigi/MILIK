/** Returns a display name for a tenant object from any shape the API returns */
export const getTenantName = (tenant) =>
  tenant?.name ||
  tenant?.tenantName ||
  [tenant?.firstName, tenant?.lastName].filter(Boolean).join(" ") ||
  "Unnamed Tenant";

/** Returns the best available display label for a unit object */
export const getUnitLabel = (unit) => unit?.unitNumber || unit?.unitName || unit?.name || "";

/** Returns a display name for a landlord object from any shape the API returns */
export const getLandlordName = (landlord) =>
  landlord?.landlordName ||
  [landlord?.firstName, landlord?.lastName].filter(Boolean).join(" ") ||
  landlord?.name ||
  "Unnamed Landlord";

/**
 * Builds an AppSelect option for a tenant.
 * label    → tenant name
 * description → "CODE · Unit X  ·  Status" (any parts that exist)
 */
export const buildTenantOption = (tenant) => {
  if (!tenant) return null;
  const name = getTenantName(tenant);
  const code = tenant.tenantCode || tenant.code || "";
  const primaryUnit = getUnitLabel(tenant.unit) || tenant.unitNumber || "";
  const additionalUnits = Array.isArray(tenant.additionalUnits)
    ? tenant.additionalUnits.map((u) => getUnitLabel(u)).filter(Boolean)
    : [];
  const allUnits = [primaryUnit, ...additionalUnits].filter(Boolean);
  const unitLabel = allUnits.join(", ");
  const status = tenant.status || tenant.tenantStatus || "";

  const parts = [
    code,
    unitLabel ? `Unit ${unitLabel}` : "",
    status,
  ].filter(Boolean);

  return {
    value: String(tenant._id || tenant.id || ""),
    label: name,
    description: parts.join(" · ") || undefined,
  };
};

/** Builds an array of AppSelect options from a tenant list */
export const buildTenantOptions = (tenants = []) =>
  tenants.map(buildTenantOption).filter(Boolean);
