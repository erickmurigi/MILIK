export const COMPANY_OPERATING_MODES = {
  PROPERTY_MANAGER: 'property_manager',
  SELF_MANAGING_LANDLORD: 'self_managing_landlord',
};

export const normalizeCompanyOperatingMode = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (
    [
      'landlord',
      'self_managing_landlord',
      'self_managed_landlord',
      'self_landlord',
      'self_managing_owner',
      'owner',
    ].includes(normalized)
  ) {
    return COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD;
  }

  if (
    [
      COMPANY_OPERATING_MODES.PROPERTY_MANAGER,
      'property_manager_company',
      'manager',
      'property_management',
      'property_management_company',
      'agency',
    ].includes(normalized)
  ) {
    return COMPANY_OPERATING_MODES.PROPERTY_MANAGER;
  }

  return COMPANY_OPERATING_MODES.PROPERTY_MANAGER;
};

export const getCompanyOperatingModeLabel = (value = '') =>
  normalizeCompanyOperatingMode(value) === COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD
    ? 'Self-Managing Landlord'
    : 'Property Manager';

export const isSelfManagingLandlordCompany = (company = {}) =>
  normalizeCompanyOperatingMode(company?.companyMode || company?.operatingMode || company?.mode) ===
  COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD;

export const isPropertyManagerCompany = (company = {}) => !isSelfManagingLandlordCompany(company);

export const normalizeCompanyEntity = (company = null) => {
  if (!company || typeof company !== 'object') return company;

  const modules = normalizeCompanyModules(company);

  return {
    ...company,
    companyMode: normalizeCompanyOperatingMode(company?.companyMode || company?.operatingMode || company?.mode),
    modules,
    enabledModules: Object.keys(modules).filter((key) => modules[key]),
  };
};

export const normalizeCompanyCollection = (companies = []) =>
  (Array.isArray(companies) ? companies : []).map((company) => normalizeCompanyEntity(company));

export const applyCompanyModeBaseModules = (modules = {}, companyMode = '') => ({
  ...normalizeCompanyModules(modules),
  propertyManagement: true,
});

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

export const getCompanyWorkspaceHomeLabel = (company = {}) =>
  isSelfManagingLandlordCompany(company) ? 'Landlord Workspace' : 'Property Management';
