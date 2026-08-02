export const COMPANY_OPERATING_MODES = {
  PROPERTY_MANAGER:     'property_manager',
  SELF_MANAGING_LANDLORD: 'self_managing_landlord',
  REAL_ESTATE_AGENCY:   'real_estate_agency',
  HOSPITALITY:          'hospitality',
  CARWASH:              'carwash',
  SACCO:                'sacco',
  RETAIL:               'retail',
  SECURITY_SERVICES:    'security_services',
  ACADEMIC:             'academic',
  FACILITY_MANAGEMENT:  'facility_management',
  TELCO_DEALERSHIP:     'telco_dealership',
  HR_SERVICES:          'hr_services',
  PROJECT_MANAGEMENT:   'project_management',
  ASSET_VALUATION:      'asset_valuation',
  OTHER:                'other',
};

export const normalizeCompanyOperatingMode = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (
    [
      COMPANY_OPERATING_MODES.OTHER,
      'general',
      'general_business',
      'other_business',
      'non_property',
      'non_property_business',
      'business',
      'company',
    ].includes(normalized)
  ) {
    return COMPANY_OPERATING_MODES.OTHER;
  }

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

  if (['real_estate_agency', 'real_estate', 'property_sales', 'estate_agency'].includes(normalized))
    return COMPANY_OPERATING_MODES.REAL_ESTATE_AGENCY;

  if (['hospitality', 'hotel', 'hotel_management', 'lodging', 'resort'].includes(normalized))
    return COMPANY_OPERATING_MODES.HOSPITALITY;

  if (['carwash', 'car_wash', 'car_wash_business', 'autowash'].includes(normalized))
    return COMPANY_OPERATING_MODES.CARWASH;

  if (['sacco', 'cooperative', 'sacco_cooperative', 'savings_cooperative'].includes(normalized))
    return COMPANY_OPERATING_MODES.SACCO;

  if (['retail', 'pos', 'retail_pos', 'shop', 'store', 'supermarket'].includes(normalized))
    return COMPANY_OPERATING_MODES.RETAIL;

  if (['security_services', 'security', 'security_company', 'guard_services'].includes(normalized))
    return COMPANY_OPERATING_MODES.SECURITY_SERVICES;

  if (['academic', 'school', 'college', 'university', 'education', 'academics'].includes(normalized))
    return COMPANY_OPERATING_MODES.ACADEMIC;

  if (['facility_management', 'facilities', 'facilities_management', 'facilities_mgmt'].includes(normalized))
    return COMPANY_OPERATING_MODES.FACILITY_MANAGEMENT;

  if (['telco_dealership', 'telco', 'telecom', 'telco_dealer', 'telecommunications'].includes(normalized))
    return COMPANY_OPERATING_MODES.TELCO_DEALERSHIP;

  if (['hr_services', 'hr', 'human_resource', 'payroll_services', 'staffing'].includes(normalized))
    return COMPANY_OPERATING_MODES.HR_SERVICES;

  if (['project_management', 'projects', 'project_firm', 'consulting'].includes(normalized))
    return COMPANY_OPERATING_MODES.PROJECT_MANAGEMENT;

  if (['asset_valuation', 'valuation', 'valuers', 'asset_valuers'].includes(normalized))
    return COMPANY_OPERATING_MODES.ASSET_VALUATION;

  return COMPANY_OPERATING_MODES.OTHER;
};

export const getCompanyOperatingModeLabel = (value = '') => {
  const mode = normalizeCompanyOperatingMode(value);
  const labels = {
    [COMPANY_OPERATING_MODES.PROPERTY_MANAGER]:      'Property Manager',
    [COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD]:'Self-Managing Landlord',
    [COMPANY_OPERATING_MODES.REAL_ESTATE_AGENCY]:    'Real Estate Agency',
    [COMPANY_OPERATING_MODES.HOSPITALITY]:           'Hospitality / Hotel',
    [COMPANY_OPERATING_MODES.CARWASH]:               'Car Wash Business',
    [COMPANY_OPERATING_MODES.SACCO]:                 'SACCO / Cooperative',
    [COMPANY_OPERATING_MODES.RETAIL]:                'Retail / POS',
    [COMPANY_OPERATING_MODES.SECURITY_SERVICES]:     'Security Services',
    [COMPANY_OPERATING_MODES.ACADEMIC]:              'Academic Institution',
    [COMPANY_OPERATING_MODES.FACILITY_MANAGEMENT]:   'Facility Management',
    [COMPANY_OPERATING_MODES.TELCO_DEALERSHIP]:      'Telco Dealership',
    [COMPANY_OPERATING_MODES.HR_SERVICES]:           'HR / Payroll Services',
    [COMPANY_OPERATING_MODES.PROJECT_MANAGEMENT]:    'Project Management',
    [COMPANY_OPERATING_MODES.ASSET_VALUATION]:       'Asset Valuation',
    [COMPANY_OPERATING_MODES.OTHER]:                 'Other',
  };
  return labels[mode] || 'Other';
};

export const isSelfManagingLandlordCompany = (company = {}) =>
  normalizeCompanyOperatingMode(company?.companyMode || company?.operatingMode || company?.mode) ===
  COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD;

export const isPropertyManagerCompany = (company = {}) =>
  normalizeCompanyOperatingMode(company?.companyMode || company?.operatingMode || company?.mode) ===
  COMPANY_OPERATING_MODES.PROPERTY_MANAGER;

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
});

export const MODULE_LABELS = {
  propertyManagement:  'Property Management',
  accounts:            'Accounting',
  billing:             'Billing',
  inventory:           'Inventory',
  telcoDealership:     'Telco Dealership',
  procurement:         'Procurement',
  hr:                  'Human Resource',
  facilityManagement:  'Facility Management',
  hotelManagement:     'Hotel Management',
  propertySale:        'Property Sales',
  frontOffice:         'Front Office',
  dms:                 'Document Management',
  academics:           'Academics',
  projectManagement:   'Project Management',
  assetValuation:      'Asset Valuation',
  pos:                 'POS',
  securityServices:    'Security Services',
  carwash:             'MILIK Car Wash',
  clients:             'Contract Management',
  crm:                 'CRM',
  sacco:               'SACCO / Cooperative',
  revenueRecognition:  'Revenue Recognition',
  incidentManagement:  'Incident Management',
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

// Modules that grant access to the shared accounting layer (Chart of Accounts, journals, reports).
// Any company with at least one of these enabled can view GL data.
// Only "accounts" grants write/admin access to COA structure.
export const GL_ACCESS_MODULES = ["accounts", "propertyManagement", "hr", "carwash", "propertySale"];

export const hasAnyCompanyModule = (company, moduleKeys = []) => {
  if (!company) return false;
  return moduleKeys.some((key) => hasCompanyModule(company, key));
};

export const getEnabledCompanyModuleKeys = (companyOrModules = {}) =>
  Object.entries(normalizeCompanyModules(companyOrModules))
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key);

export const getCompanyWorkspaceHomeLabel = (company = {}) =>
  isSelfManagingLandlordCompany(company)
    ? 'Landlord Workspace'
    : isPropertyManagerCompany(company)
      ? 'Property Management'
      : 'Workspace';
