const MODULE_REGISTRY = {
  propertyManagement: {
    key: 'propertyManagement',
    label: 'Property Management',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'propertyMgmt',
  },
  accounts: {
    key: 'accounts',
    label: 'Accounting',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'accounts',
  },
  billing: {
    key: 'billing',
    label: 'Billing',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: null,
  },
  inventory: {
    key: 'inventory',
    label: 'Inventory',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'inventory',
  },
  telcoDealership: {
    key: 'telcoDealership',
    label: 'Telco Dealership',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'telcoDealership',
  },
  procurement: {
    key: 'procurement',
    label: 'Procurement',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'procurement',
  },
  hr: {
    key: 'hr',
    label: 'Human Resource',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'humanResource',
  },
  facilityManagement: {
    key: 'facilityManagement',
    label: 'Facility Management',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'facilityManagement',
  },
  hotelManagement: {
    key: 'hotelManagement',
    label: 'Hotel Management',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'hotelManagement',
  },
  propertySale: {
    key: 'propertySale',
    label: 'Property Sales',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'propertySale',
  },
  frontOffice: {
    key: 'frontOffice',
    label: 'Front Office',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: null,
  },
  dms: {
    key: 'dms',
    label: 'Document Management',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'dms',
  },
  academics: {
    key: 'academics',
    label: 'Academics',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'academics',
  },
  projectManagement: {
    key: 'projectManagement',
    label: 'Project Management',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'projectManagement',
  },
  assetValuation: {
    key: 'assetValuation',
    label: 'Asset Valuation',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'assetValuation',
  },
  pos: {
    key: 'pos',
    label: 'POS',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'inventory',
  },
  securityServices: {
    key: 'securityServices',
    label: 'Security Services',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: null,
  },
  carwash: {
    key: 'carwash',
    label: 'MILIK Car Wash',
    category: 'expansion',
    defaultEnabled: false,
    userAccessKey: 'carwash',
  },
};

const ACCESS_VALUES = ['Not allowed', 'View only', 'Full access'];

export const COMPANY_OPERATING_MODES = {
  PROPERTY_MANAGER: 'property_manager',
  SELF_MANAGING_LANDLORD: 'self_managing_landlord',
  OTHER: 'other',
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

  return COMPANY_OPERATING_MODES.OTHER;
};

export const isSelfManagingLandlordCompany = (company = {}) =>
  normalizeCompanyOperatingMode(company?.companyMode || company?.operatingMode || company?.mode) ===
  COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD;

export const isPropertyManagerCompany = (company = {}) =>
  normalizeCompanyOperatingMode(company?.companyMode || company?.operatingMode || company?.mode) ===
  COMPANY_OPERATING_MODES.PROPERTY_MANAGER;

export const getCompanyOperatingModeLabel = (value = '') => {
  const mode = normalizeCompanyOperatingMode(value);
  if (mode === COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD) return 'Self-Managing Landlord';
  if (mode === COMPANY_OPERATING_MODES.PROPERTY_MANAGER) return 'Property Manager';
  return 'Other';
};

const normalizeText = (value = '') => String(value || '').trim();
const DEFAULT_COMPANY_UNIT_TYPES = ['studio', '1bed', '2bed', '3bed', '4bed', 'commercial'];

export const normalizeCompanyUnitTypes = (value = []) => {
  const source = Array.isArray(value) ? value : [value];
  const normalized = Array.from(
    new Set(
      source
        .map((item) => normalizeText(item))
        .filter(Boolean)
        .map((item) => item.slice(0, 80))
    )
  );

  return normalized.length ? normalized : [...DEFAULT_COMPANY_UNIT_TYPES];
};


const maskSecret = (value = '') => {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (raw.length <= 4) {
    return `${raw.charAt(0)}***`;
  }
  return `${raw.slice(0, 2)}••••${raw.slice(-2)}`;
};

const toPlainObject = (value = {}) => (value?.toObject ? value.toObject() : value || {});

const hasMpesaConfigMeaningfulValues = (config = {}) => {
  const raw = toPlainObject(config);
  return Boolean(
    normalizeText(raw?.name) ||
      normalizeText(raw?.shortCode) ||
      normalizeText(raw?.consumerKey) ||
      normalizeText(raw?.consumerSecret) ||
      normalizeText(raw?.passkey) ||
      normalizeText(raw?.defaultCashbookAccountId) ||
      normalizeText(raw?.defaultCashbookAccountName) ||
      raw?.enabled ||
      raw?.isActive
  );
};

const resolveMpesaConfigName = (config = {}, index = 0) => {
  const raw = toPlainObject(config);
  const explicitName = normalizeText(raw?.name);
  if (explicitName) return explicitName;

  const shortCode = normalizeText(raw?.shortCode);
  if (shortCode) {
    return `Paybill ${shortCode}`;
  }

  return `Paybill Configuration ${index + 1}`;
};

export const getRawMpesaPaybillConfigs = (paymentIntegration = {}) => {
  const integration = toPlainObject(paymentIntegration);
  const explicitArray = Array.isArray(integration?.mpesaPaybills)
    ? integration.mpesaPaybills.map((item) => toPlainObject(item)).filter((item) => item && typeof item === 'object')
    : [];

  const legacy = toPlainObject(integration?.mpesaPaybill || {});
  const hasLegacy = hasMpesaConfigMeaningfulValues(legacy);

  if (explicitArray.length > 0) {
    // Merge legacy into the array only if it carries a shortCode not already present
    if (hasLegacy && normalizeText(legacy.shortCode)) {
      const alreadyPresent = explicitArray.some(
        (c) => normalizeText(c.shortCode) === normalizeText(legacy.shortCode)
      );
      if (!alreadyPresent) return [legacy, ...explicitArray];
    }
    return explicitArray;
  }

  return hasLegacy ? [legacy] : [];
};

export const getPrimaryMpesaPaybillConfig = (configs = []) => {
  const safeConfigs = Array.isArray(configs) ? configs : [];
  return (
    safeConfigs.find((config) => config?.isActive) ||
    safeConfigs.find((config) => config?.enabled) ||
    safeConfigs[0] ||
    null
  );
};



const EMAIL_PROFILE_USAGE_TAGS = [
  'receipts',
  'invoices',
  'landlord_statements',
  'system_alerts',
  'demo_requests',
  'onboarding',
];

const SMS_PROFILE_PROVIDERS = ['generic', 'africas_talking', 'twilio', 'mtech', 'custom_http'];

export const SMS_TEMPLATE_DEFINITIONS = [
  {
    key: 'receipt_sms_tenant',
    name: 'Receipt SMS',
    recipientType: 'tenant',
    description: 'Sent to tenants after a receipt is posted successfully.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Dear {tenantName}, we have received {amount} for {propertyName} Unit {unitNumber} via {paymentMethod}. Receipt: {receiptNumber} ({paymentDate}). Ref: {referenceNumber}. - {companyName}',
    placeholders: ['tenantName', 'tenantCode', 'amount', 'propertyName', 'unitNumber', 'receiptNumber', 'paymentDate', 'paymentMethod', 'paymentType', 'referenceNumber', 'dueDate', 'bankingDate', 'description', 'companyName', 'companyPhone'],
  },
  {
    key: 'invoice_sms_tenant',
    name: 'Invoice SMS',
    recipientType: 'tenant',
    description: 'Sent to tenants when a rental invoice is prepared.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Dear {tenantName} ({tenantCode}), invoice {invoiceNumber} for {propertyName} Unit {unitNumber}: {particulars}. Amount due: {amountDue} by {dueDate}. - {companyName}',
    placeholders: ['tenantName', 'tenantCode', 'invoiceNumber', 'category', 'propertyName', 'unitNumber', 'amountDue', 'dueDate', 'invoiceDate', 'invoiceStatus', 'rentAmount', 'description', 'particulars', 'companyName', 'companyPhone'],
  },
  {
    key: 'overdue_reminder_tenant',
    name: 'Overdue Reminder',
    recipientType: 'tenant',
    description: 'Sent to tenants once a balance has genuinely moved into overdue state.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Dear {tenantName}, your overdue balance for {propertyName} Unit {unitNumber} is {overdueAmount}. Monthly rent: {rent}. Please clear this immediately to avoid penalties. - {companyName}',
    placeholders: ['tenantName', 'tenantCode', 'propertyName', 'unitNumber', 'overdueAmount', 'balance', 'rent', 'moveInDate', 'companyName', 'companyPhone'],
  },
  {
    key: 'landlord_statement_ready',
    name: 'Landlord Statement Ready',
    recipientType: 'landlord',
    description: 'Sent when a landlord statement has been processed and is ready for review.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {landlordName}, your {statementType} statement for {propertyName} ({statementPeriod}) is ready. Net Due: {netAmountDue}. Commission: {commissionAmount}. - {companyName}',
    placeholders: ['landlordName', 'landlordCode', 'propertyName', 'statementPeriod', 'statementDate', 'statementNumber', 'statementType', 'netAmountDue', 'totalRentInvoiced', 'totalRentReceived', 'commissionAmount', 'commissionPercentage', 'totalExpenses', 'companyName', 'companyPhone'],
  },
  {
    key: 'landlord_payment_sms',
    name: 'Landlord Payment SMS',
    recipientType: 'landlord',
    description: 'Sent after a landlord payment posts successfully.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {landlordName} ({landlordCode}), {amount} paid for {propertyName} on {paymentDate}. Ref: {referenceNumber}. Stmt: {statementNumber}. - {companyName}',
    placeholders: ['landlordName', 'landlordCode', 'amount', 'propertyName', 'paymentDate', 'referenceNumber', 'statementNumber', 'statementPeriod', 'companyName', 'companyPhone'],
  },
  {
    key: 'management_fee_invoice_sms',
    name: 'Management Fee Invoice SMS',
    recipientType: 'landlord',
    description: 'Sent when a management fee invoice is issued to the landlord.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {landlordName}, management fee invoice {invoiceNumber} for {propertyName} ({billingPeriod}): Fee {commissionAmount}, Total {totalDue}. Ref: {statementNumber}. - {companyName}',
    placeholders: ['landlordName', 'landlordCode', 'propertyName', 'billingPeriod', 'invoiceNumber', 'statementNumber', 'commissionAmount', 'totalDue', 'companyName', 'companyPhone'],
  },
  {
    key: 'maintenance_update_tenant',
    name: 'Maintenance Update - Tenant',
    recipientType: 'tenant',
    description: 'Used when a maintenance update should be shared with the affected tenant.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {recipientName}, maintenance update for {propertyName} Unit {unitNumber}: {issueTitle} is now {status}. - {companyName}',
    placeholders: ['recipientName', 'propertyName', 'unitNumber', 'issueTitle', 'status', 'scheduledDate', 'completionDate', 'companyName', 'companyPhone'],
  },
  {
    key: 'maintenance_update_landlord',
    name: 'Maintenance Update - Landlord',
    recipientType: 'landlord',
    description: 'Used when a maintenance update should be shared with the landlord.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {recipientName}, maintenance update for {propertyName} Unit {unitNumber}: {issueTitle} is now {status}. - {companyName}',
    placeholders: ['recipientName', 'propertyName', 'unitNumber', 'issueTitle', 'status', 'scheduledDate', 'completionDate', 'companyName', 'companyPhone'],
  },
  {
    key: 'tenant_notice_sms',
    name: 'Tenant Notice SMS',
    recipientType: 'tenant',
    description: 'Manual tenant communication from tenant and meter-related pages.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {tenantName}, this is a notice from {companyName} regarding {propertyName} Unit {unitNumber}. Your current balance is {balance}. Monthly rent: {rent}. Kindly contact us for any queries.',
    placeholders: ['tenantName', 'tenantCode', 'companyName', 'companyPhone', 'propertyName', 'unitNumber', 'rent', 'balance', 'overdueAmount', 'moveInDate', 'leaseType', 'depositAmount', 'tenantStatus', 'idNumber'],
  },
  {
    key: 'landlord_notice_sms',
    name: 'Landlord Notice SMS',
    recipientType: 'landlord',
    description: 'Manual landlord communication from the landlords page.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {landlordName} ({landlordCode}), this is a notice from {companyName}. Kindly contact us for any clarification regarding your account.',
    placeholders: ['landlordName', 'landlordCode', 'landlordType', 'taxPin', 'companyName', 'companyPhone', 'companyEmail'],
  },
  {
    key: 'penalty_notice_sms',
    name: 'Penalty Notice SMS',
    recipientType: 'tenant',
    description: 'Sent to tenants after a late penalty invoice has been created.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Dear {tenantName} ({tenantCode}), penalty invoice {invoiceNumber} of {amountDue} raised for {propertyName} Unit {unitNumber}. Due: {dueDate}. Orig. Invoice: {sourceInvoiceNumber}. - {companyName}',
    placeholders: ['tenantName', 'tenantCode', 'invoiceNumber', 'amountDue', 'propertyName', 'unitNumber', 'dueDate', 'invoiceDate', 'sourceInvoiceNumber', 'description', 'companyName', 'companyPhone'],
  },
  {
    key: 'meter_usage_notification_sms',
    name: 'Meter / Usage Notification SMS',
    recipientType: 'tenant',
    description: 'Notify an affected tenant after a meter reading or utility usage update.',
    sendMode: 'manual',
    enabled: false,
    messageBody:
      'Hello {tenantName}, your {utilityType} reading for {propertyName} Unit {unitNumber} ({billingPeriod}): {previousReading}→{currentReading} ({unitsConsumed} units). Charge: {amount}. - {companyName}',
    placeholders: ['tenantName', 'tenantCode', 'utilityType', 'meterNumber', 'propertyName', 'unitNumber', 'billingPeriod', 'readingDate', 'previousReading', 'currentReading', 'unitsConsumed', 'rate', 'amount', 'companyName', 'companyPhone'],
  },
  {
    key: 'carwash_notice_sms',
    name: 'Customer Notice SMS',
    recipientType: 'carwash_customer',
    description: 'General-purpose SMS notice to a car wash customer.',
    sendMode: 'manual',
    enabled: false,
    messageBody: 'Hello {customerName}, {companyName} has a message for you.',
    placeholders: ['customerName', 'companyName', 'companyPhone'],
  },
  {
    key: 'hr_employee_notice_sms',
    name: 'Employee Notice SMS',
    recipientType: 'employee',
    description: 'General-purpose SMS notice to an employee.',
    sendMode: 'manual',
    enabled: false,
    messageBody: 'Hello {employeeName}, {companyName} has a notice for you. Please contact HR for details.',
    placeholders: ['employeeName', 'companyName', 'companyPhone'],
  },
  {
    key: 'sale_buyer_notice_sms',
    name: 'Buyer Notice SMS',
    recipientType: 'sale_buyer',
    description: 'General-purpose SMS notice to a property buyer.',
    sendMode: 'manual',
    enabled: false,
    messageBody: 'Hello {buyerName}, {companyName} has an update regarding your property inquiry. Please contact us.',
    placeholders: ['buyerName', 'companyName', 'companyPhone'],
  },
  {
    key: 'sale_agent_notice_sms',
    name: 'Agent Notice SMS',
    recipientType: 'sale_agent',
    description: 'General-purpose SMS notice to a sales agent.',
    sendMode: 'manual',
    enabled: false,
    messageBody: 'Hello {agentName}, {companyName} has a notice for you. Kindly follow up.',
    placeholders: ['agentName', 'companyName', 'companyPhone'],
  },
  {
    key: 'inv_supplier_notice_sms',
    name: 'Supplier Notice SMS',
    recipientType: 'supplier',
    description: 'General-purpose SMS notice to an inventory supplier.',
    sendMode: 'manual',
    enabled: false,
    messageBody: 'Hello {supplierName}, {companyName} has a message for you. Please contact us at {companyPhone}.',
    placeholders: ['supplierName', 'companyName', 'companyPhone'],
  },
];

export const normalizeSmsProvider = (value = '') => {
  const normalized = normalizeText(value).toLowerCase();
  return SMS_PROFILE_PROVIDERS.includes(normalized) ? normalized : 'generic';
};

export const normalizePhoneCountryCode = (value = '') => {
  const raw = normalizeText(value);
  if (!raw) return '+254';

  const compact = raw.replace(/\s+/g, '');
  const withoutSymbols = compact.replace(/[^\d+]/g, '');
  if (!withoutSymbols) return '+254';

  if (withoutSymbols.startsWith('+')) {
    return `+${withoutSymbols.slice(1).replace(/\D/g, '')}`;
  }

  if (withoutSymbols.startsWith('00')) {
    return `+${withoutSymbols.slice(2).replace(/\D/g, '')}`;
  }

  return `+${withoutSymbols.replace(/\D/g, '')}`;
};

export const getDefaultSmsTemplates = () => SMS_TEMPLATE_DEFINITIONS.map((definition) => ({ ...definition }));

const hasSmsProfileMeaningfulValues = (profile = {}) => {
  const raw = toPlainObject(profile);
  return Boolean(
    normalizeText(raw?.name) ||
      normalizeText(raw?.provider) ||
      normalizeText(raw?.senderId) ||
      normalizeText(raw?.accountUsername) ||
      normalizeText(raw?.apiKeyEncrypted || raw?.apiKey) ||
      normalizeText(raw?.apiSecretEncrypted || raw?.apiSecret) ||
      normalizeText(raw?.defaultCountryCode) ||
      raw?.enabled ||
      raw?.isDefault
  );
};

const resolveSmsProfileName = (profile = {}, index = 0) => {
  const raw = toPlainObject(profile);
  const explicitName = normalizeText(raw?.name);
  if (explicitName) return explicitName;

  const senderId = normalizeText(raw?.senderId);
  if (senderId) return senderId;

  return `SMS Profile ${index + 1}`;
};

export const getRawSmsProfiles = (communication = {}) => {
  const rawCommunication = toPlainObject(communication);
  const explicitArray = Array.isArray(rawCommunication?.smsProfiles)
    ? rawCommunication.smsProfiles.map((item) => toPlainObject(item)).filter((item) => item && typeof item === 'object')
    : [];

  return explicitArray.filter((item) => hasSmsProfileMeaningfulValues(item));
};

export const getPrimarySmsProfile = (profiles = [], defaultSmsProfileId = null) => {
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  const targetDefaultId = normalizeText(defaultSmsProfileId);

  if (targetDefaultId) {
    const byId = safeProfiles.find((profile) => String(profile?._id || '') === targetDefaultId);
    if (byId) return byId;
  }

  return (
    safeProfiles.find((profile) => profile?.isDefault) ||
    safeProfiles.find((profile) => profile?.enabled) ||
    safeProfiles[0] ||
    null
  );
};

const checkProviderIsConfigured = (provider = 'generic', profile = {}, hasApiKey = false) => {
  const senderId = normalizeText(profile?.senderId);
  const accountUsername = normalizeText(profile?.accountUsername);
  const callbackUrl = normalizeText(profile?.callbackUrl);
  switch (provider) {
    case 'africas_talking':
      // Africa's Talking requires accountUsername (username) and apiKey; senderId is optional
      return Boolean(accountUsername && hasApiKey);
    case 'twilio':
      // Twilio requires accountSid (accountUsername), authToken (apiKey), and from-number (senderId)
      return Boolean(accountUsername && hasApiKey && senderId);
    case 'mtech':
      // MTech requires apiKey, senderId, and the specific API endpoint URL (no universal default)
      return Boolean(hasApiKey && senderId && callbackUrl);
    case 'custom_http':
      // Custom HTTP only requires a callbackUrl
      return Boolean(callbackUrl);
    case 'generic':
    default:
      // Generic requires a callbackUrl to dispatch
      return Boolean(callbackUrl);
  }
};

export const buildSmsProfileStatus = (profile = {}) => {
  const provider = normalizeSmsProvider(profile?.provider);
  const senderId = normalizeText(profile?.senderId);
  const accountUsername = normalizeText(profile?.accountUsername);
  const hasApiKey = Boolean(normalizeText(profile?.apiKeyEncrypted || profile?.apiKey)) || Boolean(profile?.hasApiKey);
  const callbackUrl = normalizeText(profile?.callbackUrl);
  const hasAny = Boolean(senderId || accountUsername || hasApiKey || callbackUrl || normalizeText(profile?.name));
  const isConfigured = Boolean(provider) && checkProviderIsConfigured(provider, profile, hasApiKey);

  if (!hasAny) {
    return {
      code: 'not_configured',
      label: 'Not configured',
      reason: 'No SMS provider details have been saved for this profile yet.',
      isConfigured: false,
    };
  }

  if (isConfigured && profile?.enabled) {
    return {
      code: 'active',
      label: 'Active',
      reason: 'This SMS configuration is complete and enabled for the active company.',
      isConfigured: true,
    };
  }

  if (isConfigured) {
    return {
      code: 'configured',
      label: 'Configured',
      reason: 'This SMS configuration is complete. Enable it when you are ready to use it.',
      isConfigured: true,
    };
  }

  return {
    code: 'partial',
    label: 'Partially configured',
    reason: 'Some SMS provider details are still missing from this profile.',
    isConfigured: false,
  };
};

export const mergeSmsTemplatesWithDefaults = (templates = [], smsProfiles = []) => {
  const safeTemplates = Array.isArray(templates) ? templates.map((item) => toPlainObject(item)) : [];
  const profiles = Array.isArray(smsProfiles) ? smsProfiles.map((item) => toPlainObject(item)) : [];
  const validProfileIds = new Set(profiles.map((profile) => String(profile?._id || '')).filter(Boolean));

  const byKey = new Map(
    safeTemplates
      .map((template) => [normalizeText(template?.key), template])
      .filter(([key]) => Boolean(key))
  );

  const merged = SMS_TEMPLATE_DEFINITIONS.map((definition, index) => {
    const existing = byKey.get(definition.key) || {};
    const selectedProfileId = normalizeText(existing?.profileId);

    return {
      _id: existing?._id ? String(existing._id) : `sms-template-${definition.key}`,
      key: definition.key,
      name: normalizeText(existing?.name) || definition.name,
      description: normalizeText(existing?.description) || definition.description,
      recipientType: definition.recipientType,
      enabled: existing?.enabled === undefined ? Boolean(definition.enabled) : Boolean(existing.enabled),
      sendMode: ['manual', 'automatic'].includes(normalizeText(existing?.sendMode).toLowerCase())
        ? normalizeText(existing?.sendMode).toLowerCase()
        : definition.sendMode,
      profileId: selectedProfileId && validProfileIds.has(selectedProfileId) ? selectedProfileId : null,
      messageBody: normalizeText(existing?.messageBody) || definition.messageBody,
      placeholders: Array.isArray(definition.placeholders) ? [...definition.placeholders] : [],
      sortOrder: index + 1,
      lastUpdatedAt: existing?.lastUpdatedAt || null,
      lastUpdatedBy: normalizeText(existing?.lastUpdatedBy),
    };
  });

  const defaultKeys = new Set(SMS_TEMPLATE_DEFINITIONS.map((definition) => definition.key));
  const extras = safeTemplates
    .filter((template) => !defaultKeys.has(normalizeText(template?.key)))
    .map((template, index) => ({
      _id: template?._id ? String(template._id) : `sms-template-extra-${index + 1}`,
      key: normalizeText(template?.key) || `sms-template-extra-${index + 1}`,
      name: normalizeText(template?.name) || `SMS Template ${index + 1}`,
      description: normalizeText(template?.description),
      recipientType: ['tenant', 'landlord', 'internal'].includes(normalizeText(template?.recipientType).toLowerCase())
        ? normalizeText(template?.recipientType).toLowerCase()
        : 'tenant',
      enabled: Boolean(template?.enabled),
      sendMode: ['manual', 'automatic'].includes(normalizeText(template?.sendMode).toLowerCase())
        ? normalizeText(template?.sendMode).toLowerCase()
        : 'manual',
      profileId: validProfileIds.has(normalizeText(template?.profileId)) ? normalizeText(template?.profileId) : null,
      messageBody: normalizeText(template?.messageBody),
      placeholders: Array.isArray(template?.placeholders) ? template.placeholders.map((item) => normalizeText(item)).filter(Boolean) : [],
      sortOrder: merged.length + index + 1,
      lastUpdatedAt: template?.lastUpdatedAt || null,
      lastUpdatedBy: normalizeText(template?.lastUpdatedBy),
    }));

  return [...merged, ...extras];
};

const normalizeUsageTags = (value = []) => {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => normalizeText(item).toLowerCase())
        .filter((item) => EMAIL_PROFILE_USAGE_TAGS.includes(item))
    )
  );
};

const hasEmailProfileMeaningfulValues = (profile = {}) => {
  const raw = toPlainObject(profile);
  return Boolean(
    normalizeText(raw?.name) ||
      normalizeText(raw?.senderName) ||
      normalizeText(raw?.senderEmail) ||
      normalizeText(raw?.replyTo) ||
      normalizeText(raw?.smtpHost) ||
      normalizeText(raw?.smtpPort) ||
      normalizeText(raw?.username) ||
      normalizeText(raw?.passwordEncrypted || raw?.password) ||
      normalizeText(raw?.internalCopyEmail) ||
      raw?.enabled ||
      raw?.isDefault ||
      (Array.isArray(raw?.usageTags) && raw.usageTags.length > 0)
  );
};

const resolveEmailProfileName = (profile = {}, index = 0) => {
  const raw = toPlainObject(profile);
  const explicitName = normalizeText(raw?.name);
  if (explicitName) return explicitName;

  const senderEmail = normalizeText(raw?.senderEmail);
  if (senderEmail) return senderEmail;

  return `Email Profile ${index + 1}`;
};

export const getRawEmailProfiles = (communication = {}) => {
  const rawCommunication = toPlainObject(communication);
  const explicitArray = Array.isArray(rawCommunication?.emailProfiles)
    ? rawCommunication.emailProfiles
        .map((item) => toPlainObject(item))
        .filter((item) => item && typeof item === 'object')
    : [];

  return explicitArray.filter((item) => hasEmailProfileMeaningfulValues(item));
};

export const getPrimaryEmailProfile = (profiles = [], defaultEmailProfileId = null) => {
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  const targetDefaultId = normalizeText(defaultEmailProfileId);

  if (targetDefaultId) {
    const byId = safeProfiles.find((profile) => String(profile?._id || '') === targetDefaultId);
    if (byId) return byId;
  }

  return (
    safeProfiles.find((profile) => profile?.isDefault) ||
    safeProfiles.find((profile) => profile?.enabled) ||
    safeProfiles[0] ||
    null
  );
};

export const buildEmailProfileStatus = (profile = {}) => {
  const senderName = normalizeText(profile?.senderName);
  const senderEmail = normalizeText(profile?.senderEmail);
  const smtpHost = normalizeText(profile?.smtpHost);
  const smtpPort = Number(profile?.smtpPort || 0);
  const username = normalizeText(profile?.username);
  const hasPassword = Boolean(normalizeText(profile?.passwordEncrypted || profile?.password)) || Boolean(profile?.hasPassword);
  const hasAny = Boolean(senderName || senderEmail || smtpHost || smtpPort || username || hasPassword);
  const isConfigured = Boolean(senderName && senderEmail && smtpHost && smtpPort > 0 && username && hasPassword);

  if (!hasAny) {
    return {
      code: 'not_configured',
      label: 'Not configured',
      reason: 'No SMTP settings have been saved for this email profile yet.',
      isConfigured: false,
    };
  }

  if (isConfigured && profile?.enabled) {
    return {
      code: 'active',
      label: 'Active',
      reason: 'This email profile is complete and enabled for sending.',
      isConfigured: true,
    };
  }

  if (isConfigured) {
    return {
      code: 'configured',
      label: 'Configured',
      reason: 'This email profile is complete. Enable it when you are ready to use it for sending.',
      isConfigured: true,
    };
  }

  return {
    code: 'partial',
    label: 'Partially configured',
    reason: 'Some SMTP details are still missing from this email profile.',
    isConfigured: false,
  };
};

export const sanitizeCommunicationForClient = (communication = {}) => {
  const rawCommunication = toPlainObject(communication);
  const emailProfiles = getRawEmailProfiles(rawCommunication);
  const smsProfiles = getRawSmsProfiles(rawCommunication);
  const defaultEmailProfileId = normalizeText(rawCommunication?.defaultEmailProfileId);
  const defaultSmsProfileId = normalizeText(rawCommunication?.defaultSmsProfileId);

  const sanitizedProfiles = emailProfiles.map((rawProfile, index) => {
    const profile = toPlainObject(rawProfile);
    const status = buildEmailProfileStatus(profile);
    const hasPassword = Boolean(normalizeText(profile?.passwordEncrypted || profile?.password));

    return {
      _id: profile?._id ? String(profile._id) : `email-profile-${index + 1}`,
      name: resolveEmailProfileName(profile, index),
      senderName: normalizeText(profile?.senderName),
      senderEmail: normalizeText(profile?.senderEmail).toLowerCase(),
      replyTo: normalizeText(profile?.replyTo).toLowerCase(),
      smtpHost: normalizeText(profile?.smtpHost).toLowerCase(),
      smtpPort: Number(profile?.smtpPort || 0) || '',
      encryption: ['ssl', 'tls', 'none'].includes(normalizeText(profile?.encryption).toLowerCase())
        ? normalizeText(profile?.encryption).toLowerCase()
        : 'ssl',
      username: normalizeText(profile?.username),
      hasPassword,
      passwordMasked: hasPassword ? 'Saved and masked' : '',
      internalCopyEmail: normalizeText(profile?.internalCopyEmail).toLowerCase(),
      internalCopyMode: ['bcc', 'cc', 'none'].includes(normalizeText(profile?.internalCopyMode).toLowerCase())
        ? normalizeText(profile?.internalCopyMode).toLowerCase()
        : 'none',
      usageTags: normalizeUsageTags(profile?.usageTags),
      enabled: Boolean(profile?.enabled),
      isDefault: Boolean(profile?.isDefault),
      lastTestStatus: ['success', 'failed', 'never'].includes(normalizeText(profile?.lastTestStatus).toLowerCase())
        ? normalizeText(profile?.lastTestStatus).toLowerCase()
        : 'never',
      lastTestedAt: profile?.lastTestedAt || null,
      lastTestMessage: normalizeText(profile?.lastTestMessage),
      lastSuccessfulSendAt: profile?.lastSuccessfulSendAt || null,
      lastUpdatedAt: profile?.lastUpdatedAt || null,
      lastUpdatedBy: normalizeText(profile?.lastUpdatedBy),
      status: status.code,
      statusLabel: status.label,
      statusReason: status.reason,
      isConfigured: status.isConfigured,
    };
  });

  const primary = getPrimaryEmailProfile(sanitizedProfiles, defaultEmailProfileId);

  const sanitizedSmsProfiles = smsProfiles.map((rawProfile, index) => {
    const profile = toPlainObject(rawProfile);
    const status = buildSmsProfileStatus(profile);
    const hasApiKey = Boolean(normalizeText(profile?.apiKeyEncrypted || profile?.apiKey));
    const hasApiSecret = Boolean(normalizeText(profile?.apiSecretEncrypted || profile?.apiSecret));

    return {
      _id: profile?._id ? String(profile._id) : `sms-profile-${index + 1}`,
      name: resolveSmsProfileName(profile, index),
      provider: normalizeSmsProvider(profile?.provider),
      senderId: normalizeText(profile?.senderId),
      accountUsername: normalizeText(profile?.accountUsername),
      hasApiKey,
      apiKeyMasked: hasApiKey ? 'Saved and masked' : '',
      hasApiSecret,
      apiSecretMasked: hasApiSecret ? 'Saved and masked' : '',
      defaultCountryCode: normalizePhoneCountryCode(profile?.defaultCountryCode),
      callbackUrl: normalizeText(profile?.callbackUrl),
      enabled: Boolean(profile?.enabled),
      isDefault: Boolean(profile?.isDefault),
      lastTestStatus: ['success', 'failed', 'never'].includes(normalizeText(profile?.lastTestStatus).toLowerCase())
        ? normalizeText(profile?.lastTestStatus).toLowerCase()
        : 'never',
      lastTestedAt: profile?.lastTestedAt || null,
      lastTestMessage: normalizeText(profile?.lastTestMessage),
      lastUpdatedAt: profile?.lastUpdatedAt || null,
      lastUpdatedBy: normalizeText(profile?.lastUpdatedBy),
      status: status.code,
      statusLabel: status.label,
      statusReason: status.reason,
      isConfigured: status.isConfigured,
    };
  });

  const primarySmsProfile = getPrimarySmsProfile(sanitizedSmsProfiles, defaultSmsProfileId);
  const sanitizedSmsTemplates = mergeSmsTemplatesWithDefaults(rawCommunication?.smsTemplates, sanitizedSmsProfiles).map((template) => ({
    ...template,
    profileName: template.profileId
      ? sanitizedSmsProfiles.find((profile) => String(profile._id) === String(template.profileId))?.name || ''
      : '',
    usesDefaultProfile: !template.profileId,
  }));

  return {
    emailEnabled: rawCommunication?.emailEnabled !== false,
    emailProfiles: sanitizedProfiles,
    defaultEmailProfileId: primary?._id || '',
    defaultEmailProfile: primary
      ? { ...primary }
      : {
          _id: '',
          name: '',
          senderName: '',
          senderEmail: '',
          replyTo: '',
          smtpHost: '',
          smtpPort: '',
          encryption: 'ssl',
          username: '',
          hasPassword: false,
          passwordMasked: '',
          internalCopyEmail: '',
          internalCopyMode: 'none',
          usageTags: [],
          enabled: false,
          isDefault: false,
          lastTestStatus: 'never',
          lastTestedAt: null,
          lastTestMessage: '',
          lastSuccessfulSendAt: null,
          lastUpdatedAt: null,
          lastUpdatedBy: '',
          status: 'not_configured',
          statusLabel: 'Not configured',
          statusReason: 'No SMTP settings have been saved for this company yet.',
          isConfigured: false,
        },
    smsProfiles: sanitizedSmsProfiles,
    defaultSmsProfileId: primarySmsProfile?._id || '',
    defaultSmsProfile: primarySmsProfile
      ? { ...primarySmsProfile }
      : {
          _id: '',
          name: '',
          provider: 'generic',
          senderId: '',
          accountUsername: '',
          hasApiKey: false,
          apiKeyMasked: '',
          hasApiSecret: false,
          apiSecretMasked: '',
          defaultCountryCode: '+254',
          callbackUrl: '',
          enabled: false,
          isDefault: false,
          lastTestStatus: 'never',
          lastTestedAt: null,
          lastTestMessage: '',
          lastUpdatedAt: null,
          lastUpdatedBy: '',
          status: 'not_configured',
          statusLabel: 'Not configured',
          statusReason: 'No SMS profile has been saved for this company yet.',
          isConfigured: false,
        },
    smsTemplates: sanitizedSmsTemplates,
  };
};

export const getModuleRegistry = () => MODULE_REGISTRY;

export const getCompanyModuleDefaults = () =>
  Object.values(MODULE_REGISTRY).reduce((acc, module) => {
    acc[module.key] = module.defaultEnabled;
    return acc;
  }, {});

export const normalizeCompanyModules = (modules = {}) => {
  const defaults = getCompanyModuleDefaults();
  const normalized = { ...defaults };

  Object.keys(MODULE_REGISTRY).forEach((key) => {
    const rawValue = modules?.[key];

    if (typeof rawValue === 'boolean') {
      normalized[key] = rawValue;
      return;
    }

    if (typeof rawValue === 'string') {
      const value = rawValue.trim().toLowerCase();
      if (value === 'true') {
        normalized[key] = true;
        return;
      }
      if (value === 'false') {
        normalized[key] = false;
        return;
      }
    }

    if (rawValue && typeof rawValue === 'object' && typeof rawValue.enabled === 'boolean') {
      normalized[key] = rawValue.enabled;
    }
  });

  return normalized;
};

export const normalizeCompanyIdentityFields = (payload = {}) => ({
  email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
  phoneNo: typeof payload.phoneNo === 'string' ? payload.phoneNo.trim() : '',
  slogan: typeof payload.slogan === 'string' ? payload.slogan.trim() : '',
  logo: typeof payload.logo === 'string' ? payload.logo.trim() : '',
  unitTypes: normalizeCompanyUnitTypes(payload.unitTypes),
});

export const buildMpesaPaybillStatus = (config = {}) => {
  const shortCode = normalizeText(config?.shortCode);
  const defaultCashbookAccountId = normalizeText(config?.defaultCashbookAccountId);
  const hasConsumerKey = Boolean(normalizeText(config?.consumerKey)) || Boolean(config?.hasConsumerKey);
  const hasConsumerSecret = Boolean(normalizeText(config?.consumerSecret)) || Boolean(config?.hasConsumerSecret);
  const hasPasskey = Boolean(normalizeText(config?.passkey)) || Boolean(config?.hasPasskey);
  const hasAny =
    Boolean(shortCode) ||
    Boolean(defaultCashbookAccountId) ||
    hasConsumerKey ||
    hasConsumerSecret ||
    hasPasskey;

  const isConfigured =
    Boolean(shortCode) &&
    Boolean(defaultCashbookAccountId) &&
    hasConsumerKey &&
    hasConsumerSecret &&
    hasPasskey;

  if (!hasAny) {
    return {
      code: 'not_configured',
      label: 'Not configured',
      reason: 'No M-Pesa Paybill setup has been saved for this configuration yet.',
      isConfigured: false,
    };
  }

  if (isConfigured && config?.enabled && config?.isActive) {
    return {
      code: 'active',
      label: 'Active',
      reason: 'This Paybill configuration is complete and active for live use.',
      isConfigured: true,
    };
  }

  if (isConfigured) {
    return {
      code: 'configured',
      label: 'Configured',
      reason: 'The Paybill configuration is complete. Activate it when you are ready to receive live callbacks.',
      isConfigured: true,
    };
  }

  return {
    code: 'partial',
    label: 'Partially configured',
    reason: 'Some required Paybill settings are still missing.',
    isConfigured: false,
  };
};

export const sanitizePaymentIntegrationForClient = (paymentIntegration = {}) => {
  const rawConfigs = getRawMpesaPaybillConfigs(paymentIntegration);

  const mpesaPaybills = rawConfigs.map((rawConfig, index) => {
    const config = toPlainObject(rawConfig);
    const status = buildMpesaPaybillStatus(config);

    return {
      _id: config?._id ? String(config._id) : `mpesa-config-${index + 1}`,
      name: resolveMpesaConfigName(config, index),
      enabled: Boolean(config.enabled),
      isActive: status.code === 'active',
      shortCode: normalizeText(config.shortCode),
      defaultCashbookAccountId: config.defaultCashbookAccountId ? String(config.defaultCashbookAccountId) : '',
      defaultCashbookAccountName: normalizeText(config.defaultCashbookAccountName),
      unmatchedPaymentMode:
        config.unmatchedPaymentMode === 'hold_unallocated' ? 'hold_unallocated' : 'manual_review',
      postingMode:
        config.postingMode === 'auto_post_matched' ? 'auto_post_matched' : 'manual_review',
      callbackMode: 'milik_managed',
      responseType: config.responseType === 'Cancelled' ? 'Cancelled' : 'Completed',
      accountReferenceSource: 'tenant_code',
      tenantAccountReferenceLabel: normalizeText(config.tenantAccountReferenceLabel) || 'Tenant Code',
      hasConsumerKey: Boolean(normalizeText(config.consumerKey)),
      hasConsumerSecret: Boolean(normalizeText(config.consumerSecret)),
      hasPasskey: Boolean(normalizeText(config.passkey)),
      consumerKeyMasked: maskSecret(config.consumerKey),
      consumerSecretMasked: maskSecret(config.consumerSecret),
      passkeyMasked: maskSecret(config.passkey),
      initiatorName: normalizeText(config.initiatorName),
      hasInitiatorPassword: Boolean(normalizeText(config.initiatorPassword)),
      initiatorPasswordMasked: maskSecret(config.initiatorPassword),
      hasSecurityCredential: Boolean(normalizeText(config.securityCredential)),
      securityCredentialMasked: maskSecret(config.securityCredential),
      lastConfiguredAt: config.lastConfiguredAt || null,
      status: status.code,
      statusLabel: status.label,
      statusReason: status.reason,
      isConfigured: status.isConfigured,
    };
  });

  const primary = getPrimaryMpesaPaybillConfig(mpesaPaybills);

  const rawCoopConfigs = Array.isArray(paymentIntegration?.coopB2BConfigs)
    ? paymentIntegration.coopB2BConfigs
    : [];

  const coopB2BConfigs = rawCoopConfigs.map((raw, index) => {
    const c = typeof raw?.toObject === 'function' ? raw.toObject() : (raw || {});
    const id = c._id ? String(c._id) : `coop-config-${index + 1}`;
    return {
      _id:                      id,
      name:                     String(c.name || `Co-op B2B ${index + 1}`).trim(),
      enabled:                  Boolean(c.enabled),
      institutionCode:          String(c.institutionCode || '').trim(),
      institutionName:          String(c.institutionName || '').trim(),
      connectionID:             String(c.connectionID   || '').trim(),
      hasConnectionPassword:    Boolean(String(c.connectionPassword || '').trim()),
      connectionPasswordMasked: maskSecret(c.connectionPassword),
      coopBankAccountNumber:    String(c.coopBankAccountNumber || '').trim(),
      paybillNumber:            String(c.paybillNumber         || '').trim(),
      defaultCashbookAccountId:   c.defaultCashbookAccountId ? String(c.defaultCashbookAccountId) : '',
      defaultCashbookAccountName: String(c.defaultCashbookAccountName || '').trim(),
      postingMode:              c.postingMode === 'auto_post_matched' ? 'auto_post_matched' : 'manual_review',
      lastConfiguredAt:         c.lastConfiguredAt || null,
    };
  });

  return {
    mpesaPaybills,
    mpesaPaybill: primary
      ? { ...primary }
      : {
          _id: '',
          name: '',
          enabled: false,
          isActive: false,
          shortCode: '',
          defaultCashbookAccountId: '',
          defaultCashbookAccountName: '',
          unmatchedPaymentMode: 'manual_review',
          postingMode: 'manual_review',
          callbackMode: 'milik_managed',
          responseType: 'Completed',
          accountReferenceSource: 'tenant_code',
          tenantAccountReferenceLabel: 'Tenant Code',
          hasConsumerKey: false,
          hasConsumerSecret: false,
          hasPasskey: false,
          consumerKeyMasked: '',
          consumerSecretMasked: '',
          passkeyMasked: '',
          lastConfiguredAt: null,
          status: 'not_configured',
          statusLabel: 'Not configured',
          statusReason: 'No M-Pesa Paybill setup has been saved for this company yet.',
          isConfigured: false,
        },
    coopB2BConfigs,
  };
};

export const getEnabledCompanyModuleKeys = (company = {}) => {
  const modules = normalizeCompanyModules(company?.modules || {});
  return Object.keys(modules).filter((key) => modules[key]);
};

const normalizeUserModuleAccessValue = (value) => {
  const text = String(value || '').trim();
  if (ACCESS_VALUES.includes(text)) return text;
  return '';
};

export const getUserModuleAccessLevel = (user = {}, moduleKey, companyId = null) => {
  const registryItem = MODULE_REGISTRY[moduleKey];
  const userAccessKey = registryItem?.userAccessKey;
  if (!userAccessKey) return '';

  const resolvedCompanyId = String(companyId || user?.company?._id || user?.company || '');
  if (resolvedCompanyId && Array.isArray(user?.companyAssignments)) {
    const assignment = user.companyAssignments.find((item) => String(item?.company?._id || item?.company || '') === resolvedCompanyId);
    const scopedValue = normalizeUserModuleAccessValue(assignment?.moduleAccess?.[userAccessKey]);
    if (scopedValue) return scopedValue;
  }

  return normalizeUserModuleAccessValue(user?.moduleAccess?.[userAccessKey]);
};

export const hasModuleAccess = (user = {}, company = {}, moduleKey, options = {}) => {
  const registryItem = MODULE_REGISTRY[moduleKey];
  if (!registryItem) return true;

  if (user?.isSystemAdmin || user?.superAdminAccess) {
    return true;
  }

  const modules = normalizeCompanyModules(company?.modules || {});
  if (!modules[moduleKey]) {
    return false;
  }

  if (user?.adminAccess) {
    return true;
  }

  const accessLevel = getUserModuleAccessLevel(user, moduleKey, company?._id || company);
  if (!accessLevel) {
    return true;
  }

  if (options.requireWrite) {
    return accessLevel === 'Full access';
  }

  return accessLevel === 'View only' || accessLevel === 'Full access';
};

export const buildCompanyEntitlements = (company = {}, user = null) => {
  const modules = normalizeCompanyModules(company?.modules || {});

  return Object.values(MODULE_REGISTRY).map((module) => {
    const accessLevel = user ? getUserModuleAccessLevel(user, module.key, company?._id || company) : '';

    return {
      key: module.key,
      label: module.label,
      category: module.category,
      enabled: Boolean(modules[module.key]),
      accessLevel: user
        ? accessLevel || (hasModuleAccess(user, company, module.key) ? 'Full access' : 'Not allowed')
        : null,
      isAccessible: user ? hasModuleAccess(user, company, module.key) : Boolean(modules[module.key]),
    };
  });
};

export const serializeCompanyForClient = (company = {}, user = null) => {
  if (!company) return null;

  const modules = normalizeCompanyModules(company.modules || {});
  const entitlements = buildCompanyEntitlements(company, user);
  const paymentIntegration = sanitizePaymentIntegrationForClient(company.paymentIntegration || {});
  const communication = sanitizeCommunicationForClient(company.communication || {});

  return {
    ...company,
    companyMode: normalizeCompanyOperatingMode(company.companyMode || company.operatingMode || company.mode),
    modules,
    paymentIntegration,
    communication,
    unitTypes: normalizeCompanyUnitTypes(company.unitTypes),
    enabledModules: Object.keys(modules).filter((key) => modules[key]),
    entitlements,
  };
};
