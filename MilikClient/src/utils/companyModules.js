export const MODULE_LABELS = {
  propertyManagement: 'Property Management',
  accounts: 'Accounting',
  billing: 'Billing',
  inventory: 'Inventory',
  telcoDealership: 'Telco Dealership',
  procurement: 'Procurement',
  hr: 'Human Resource',
  facilityManagement: 'Facility Management',
  hotelManagement: 'Hotel Management',
  propertySale: 'Property Sales',
  frontOffice: 'Front Office',
  dms: 'Document Management',
  academics: 'Academics',
  projectManagement: 'Project Management',
  assetValuation: 'Asset Valuation',
  pos: 'POS',
  securityServices: 'Security Services',
};

export const COMPANY_MODULE_KEYS = Object.keys(MODULE_LABELS);

export const normalizeCompanyModules = (companyOrModules = {}) => {
  const source = companyOrModules?.modules || companyOrModules || {};
  const normalized = {};

  COMPANY_MODULE_KEYS.forEach((key) => {
    const rawValue = source?.[key];

    if (typeof rawValue === 'boolean') {
      normalized[key] = rawValue;
      return;
    }

    if (typeof rawValue === 'string') {
      const value = rawValue.trim().toLowerCase();
      normalized[key] = value === 'true';
      return;
    }

    if (rawValue && typeof rawValue === 'object' && typeof rawValue.enabled === 'boolean') {
      normalized[key] = rawValue.enabled;
      return;
    }

    normalized[key] = false;
  });

  const enabledList = Array.isArray(companyOrModules?.enabledModules)
    ? companyOrModules.enabledModules
    : [];

  enabledList.forEach((key) => {
    if (key in normalized) normalized[key] = true;
  });

  return normalized;
};

export const hasCompanyModule = (company, moduleKey) => {
  if (!moduleKey) return true;
  if (!company) return false;
  const modules = normalizeCompanyModules(company);
  return Boolean(modules[moduleKey]);
};

export const getEnabledCompanyModuleKeys = (companyOrModules = {}) =>
  Object.entries(normalizeCompanyModules(companyOrModules))
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);
