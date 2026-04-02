import mongoose from 'mongoose';
import { getCompanyModuleDefaults, getDefaultSmsTemplates, normalizeCompanyUnitTypes, normalizePhoneCountryCode, normalizeSmsProvider } from '../utils/companyModules.js';

const companyModuleDefaults = getCompanyModuleDefaults();

const optionalIndexedString = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
};

const optionalString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeAccessKeyItem = (item = {}) => {
  const adminKey = optionalIndexedString(item?.adminKey);
  const normalKey = optionalIndexedString(item?.normalKey);

  if (!adminKey && !normalKey) {
    return null;
  }

  return {
    adminKey,
    normalKey,
    keyVersion: String(item?.keyVersion || 'v1').trim() || 'v1',
  };
};

const resolveConfigName = (item = {}, index = 0) => {
  const explicitName = optionalString(item?.name);
  if (explicitName) return explicitName;

  const shortCode = optionalString(item?.shortCode);
  if (shortCode) return `Paybill ${shortCode}`;

  return `Paybill Configuration ${index + 1}`;
};

const hasMeaningfulMpesaConfig = (item = {}) =>
  Boolean(
    optionalString(item?.name) ||
      optionalString(item?.shortCode) ||
      optionalString(item?.consumerKey) ||
      optionalString(item?.consumerSecret) ||
      optionalString(item?.passkey) ||
      optionalString(item?.defaultCashbookAccountId) ||
      optionalString(item?.defaultCashbookAccountName) ||
      item?.enabled ||
      item?.isActive
  );

const normalizeMpesaPaybillConfigItem = (item = {}, index = 0) => {
  const normalizedShortCode = optionalString(item?.shortCode);
  const normalized = {
    name: resolveConfigName(item, index),
    enabled: Boolean(item?.enabled),
    isActive: Boolean(item?.enabled) ? Boolean(item?.isActive) : false,
    shortCode: normalizedShortCode,
    consumerKey: optionalString(item?.consumerKey),
    consumerSecret: optionalString(item?.consumerSecret),
    passkey: optionalString(item?.passkey),
    defaultCashbookAccountId: item?.defaultCashbookAccountId || null,
    defaultCashbookAccountName: optionalString(item?.defaultCashbookAccountName),
    unmatchedPaymentMode:
      item?.unmatchedPaymentMode === 'hold_unallocated' ? 'hold_unallocated' : 'manual_review',
    postingMode:
      item?.postingMode === 'auto_post_matched' ? 'auto_post_matched' : 'manual_review',
    callbackMode: 'milik_managed',
    responseType: item?.responseType === 'Cancelled' ? 'Cancelled' : 'Completed',
    accountReferenceSource: 'tenant_code',
    tenantAccountReferenceLabel: optionalString(item?.tenantAccountReferenceLabel) || 'Tenant Code',
    lastConfiguredAt: item?.lastConfiguredAt || null,
    lastConfiguredBy: optionalString(item?.lastConfiguredBy),
  };

  if (item?._id) {
    normalized._id = item._id;
  }

  return normalized;
};


const EMAIL_PROFILE_USAGE_TAGS = [
  'receipts',
  'invoices',
  'landlord_statements',
  'system_alerts',
  'demo_requests',
  'onboarding',
];

const normalizeEmailAddress = (value) => optionalString(value).toLowerCase();

const normalizeUsageTags = (value = []) => {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => optionalString(item).toLowerCase())
        .filter((item) => EMAIL_PROFILE_USAGE_TAGS.includes(item))
    )
  );
};

const resolveEmailProfileName = (item = {}, index = 0) => {
  const explicitName = optionalString(item?.name);
  if (explicitName) return explicitName;

  const senderEmail = normalizeEmailAddress(item?.senderEmail);
  if (senderEmail) return senderEmail;

  return `Email Profile ${index + 1}`;
};

const hasMeaningfulEmailProfile = (item = {}) =>
  Boolean(
    optionalString(item?.name) ||
      optionalString(item?.senderName) ||
      normalizeEmailAddress(item?.senderEmail) ||
      normalizeEmailAddress(item?.replyTo) ||
      optionalString(item?.smtpHost) ||
      optionalString(item?.smtpPort) ||
      optionalString(item?.username) ||
      optionalString(item?.passwordEncrypted) ||
      normalizeEmailAddress(item?.internalCopyEmail) ||
      item?.enabled ||
      item?.isDefault ||
      (Array.isArray(item?.usageTags) && item.usageTags.length > 0)
  );

const normalizeEmailProfileItem = (item = {}, index = 0) => {
  const rawPort = item?.smtpPort;
  const numericPort = Number(rawPort);
  const normalized = {
    name: resolveEmailProfileName(item, index),
    senderName: optionalString(item?.senderName),
    senderEmail: normalizeEmailAddress(item?.senderEmail),
    replyTo: normalizeEmailAddress(item?.replyTo),
    smtpHost: optionalString(item?.smtpHost).toLowerCase(),
    smtpPort: Number.isFinite(numericPort) && numericPort > 0 ? numericPort : null,
    encryption: ['ssl', 'tls', 'none'].includes(optionalString(item?.encryption).toLowerCase())
      ? optionalString(item?.encryption).toLowerCase()
      : 'ssl',
    username: optionalString(item?.username),
    passwordEncrypted: optionalString(item?.passwordEncrypted),
    internalCopyEmail: normalizeEmailAddress(item?.internalCopyEmail),
    internalCopyMode: ['bcc', 'cc', 'none'].includes(optionalString(item?.internalCopyMode).toLowerCase())
      ? optionalString(item?.internalCopyMode).toLowerCase()
      : 'none',
    usageTags: normalizeUsageTags(item?.usageTags),
    enabled: Boolean(item?.enabled),
    isDefault: Boolean(item?.isDefault),
    lastTestStatus: ['success', 'failed', 'never'].includes(optionalString(item?.lastTestStatus).toLowerCase())
      ? optionalString(item?.lastTestStatus).toLowerCase()
      : 'never',
    lastTestedAt: item?.lastTestedAt || null,
    lastTestMessage: optionalString(item?.lastTestMessage),
    lastSuccessfulSendAt: item?.lastSuccessfulSendAt || null,
    lastUpdatedAt: item?.lastUpdatedAt || null,
    lastUpdatedBy: optionalString(item?.lastUpdatedBy),
  };

  if (item?._id) {
    normalized._id = item._id;
  }

  return normalized;
};

const resolveSmsProfileName = (item = {}, index = 0) => {
  const explicitName = optionalString(item?.name);
  if (explicitName) return explicitName;

  const senderId = optionalString(item?.senderId);
  if (senderId) return senderId;

  return `SMS Profile ${index + 1}`;
};

const hasMeaningfulSmsProfile = (item = {}) =>
  Boolean(
    optionalString(item?.name) ||
      optionalString(item?.provider) ||
      optionalString(item?.senderId) ||
      optionalString(item?.accountUsername) ||
      optionalString(item?.apiKeyEncrypted) ||
      optionalString(item?.apiSecretEncrypted) ||
      optionalString(item?.defaultCountryCode) ||
      item?.enabled ||
      item?.isDefault
  );

const normalizeSmsProfileItem = (item = {}, index = 0) => {
  const normalized = {
    name: resolveSmsProfileName(item, index),
    provider: normalizeSmsProvider(item?.provider),
    senderId: optionalString(item?.senderId),
    accountUsername: optionalString(item?.accountUsername),
    apiKeyEncrypted: optionalString(item?.apiKeyEncrypted),
    apiSecretEncrypted: optionalString(item?.apiSecretEncrypted),
    defaultCountryCode: normalizePhoneCountryCode(item?.defaultCountryCode),
    callbackUrl: optionalString(item?.callbackUrl),
    enabled: Boolean(item?.enabled),
    isDefault: Boolean(item?.isDefault),
    lastTestStatus: ['success', 'failed', 'never'].includes(optionalString(item?.lastTestStatus).toLowerCase())
      ? optionalString(item?.lastTestStatus).toLowerCase()
      : 'never',
    lastTestedAt: item?.lastTestedAt || null,
    lastTestMessage: optionalString(item?.lastTestMessage),
    lastUpdatedAt: item?.lastUpdatedAt || null,
    lastUpdatedBy: optionalString(item?.lastUpdatedBy),
  };

  if (item?._id) {
    normalized._id = item._id;
  }

  return normalized;
};

const normalizeSmsTemplateItem = (item = {}, fallback = {}, availableProfileIds = new Set()) => {
  const key = optionalString(item?.key || fallback?.key);
  const selectedProfileId = item?.profileId ? String(item.profileId) : '';
  const resolvedProfileId = selectedProfileId && availableProfileIds.has(selectedProfileId) ? selectedProfileId : null;

  const normalized = {
    key,
    name: optionalString(item?.name) || optionalString(fallback?.name),
    description: optionalString(item?.description) || optionalString(fallback?.description),
    recipientType: ['tenant', 'landlord', 'internal'].includes(optionalString(item?.recipientType || fallback?.recipientType).toLowerCase())
      ? optionalString(item?.recipientType || fallback?.recipientType).toLowerCase()
      : 'tenant',
    enabled: item?.enabled === undefined ? Boolean(fallback?.enabled) : Boolean(item?.enabled),
    sendMode: ['manual', 'automatic'].includes(optionalString(item?.sendMode).toLowerCase())
      ? optionalString(item?.sendMode).toLowerCase()
      : optionalString(fallback?.sendMode).toLowerCase() || 'manual',
    profileId: resolvedProfileId,
    messageBody: optionalString(item?.messageBody) || optionalString(fallback?.messageBody),
    placeholders: Array.isArray(fallback?.placeholders)
      ? fallback.placeholders.map((placeholder) => optionalString(placeholder)).filter(Boolean)
      : [],
    lastUpdatedAt: item?.lastUpdatedAt || null,
    lastUpdatedBy: optionalString(item?.lastUpdatedBy),
  };

  if (item?._id) {
    normalized._id = item._id;
  }

  return normalized;
};

const buildLegacyMpesaSummary = (configs = []) => {
  const primary = configs.find((config) => config?.isActive) || configs.find((config) => config?.enabled) || configs[0] || null;
  if (!primary) {
    return {
      name: '',
      enabled: false,
      isActive: false,
      shortCode: '',
      consumerKey: '',
      consumerSecret: '',
      passkey: '',
      defaultCashbookAccountId: null,
      defaultCashbookAccountName: '',
      unmatchedPaymentMode: 'manual_review',
      postingMode: 'manual_review',
      callbackMode: 'milik_managed',
      responseType: 'Completed',
      accountReferenceSource: 'tenant_code',
      tenantAccountReferenceLabel: 'Tenant Code',
      lastConfiguredAt: null,
      lastConfiguredBy: '',
    };
  }
  return normalizeMpesaPaybillConfigItem(primary, 0);
};

const mpesaPaybillConfigSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    enabled: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    shortCode: { type: String, trim: true, default: '' },
    consumerKey: { type: String, trim: true, default: '' },
    consumerSecret: { type: String, trim: true, default: '' },
    passkey: { type: String, trim: true, default: '' },
    defaultCashbookAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
      default: null,
    },
    defaultCashbookAccountName: { type: String, trim: true, default: '' },
    unmatchedPaymentMode: {
      type: String,
      enum: ['manual_review', 'hold_unallocated'],
      default: 'manual_review',
    },
    postingMode: {
      type: String,
      enum: ['manual_review', 'auto_post_matched'],
      default: 'manual_review',
    },
    callbackMode: {
      type: String,
      enum: ['milik_managed'],
      default: 'milik_managed',
    },
    responseType: {
      type: String,
      enum: ['Completed', 'Cancelled'],
      default: 'Completed',
    },
    accountReferenceSource: {
      type: String,
      enum: ['tenant_code'],
      default: 'tenant_code',
    },
    tenantAccountReferenceLabel: { type: String, trim: true, default: 'Tenant Code' },
    lastConfiguredAt: { type: Date, default: null },
    lastConfiguredBy: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const paymentIntegrationSchema = new mongoose.Schema(
  {
    mpesaPaybill: {
      type: mpesaPaybillConfigSchema,
      default: () => ({}),
    },
    mpesaPaybills: {
      type: [mpesaPaybillConfigSchema],
      default: [],
    },
  },
  { _id: false }
);


const emailProfileSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    senderName: { type: String, trim: true, default: '' },
    senderEmail: { type: String, trim: true, lowercase: true, default: '' },
    replyTo: { type: String, trim: true, lowercase: true, default: '' },
    smtpHost: { type: String, trim: true, lowercase: true, default: '' },
    smtpPort: { type: Number, default: null },
    encryption: {
      type: String,
      enum: ['ssl', 'tls', 'none'],
      default: 'ssl',
    },
    username: { type: String, trim: true, default: '' },
    passwordEncrypted: { type: String, trim: true, default: '' },
    internalCopyEmail: { type: String, trim: true, lowercase: true, default: '' },
    internalCopyMode: {
      type: String,
      enum: ['none', 'bcc', 'cc'],
      default: 'none',
    },
    usageTags: {
      type: [String],
      default: [],
    },
    enabled: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    lastTestStatus: {
      type: String,
      enum: ['never', 'success', 'failed'],
      default: 'never',
    },
    lastTestedAt: { type: Date, default: null },
    lastTestMessage: { type: String, trim: true, default: '' },
    lastSuccessfulSendAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: null },
    lastUpdatedBy: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const smsProfileSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    provider: {
      type: String,
      enum: ['generic', 'africas_talking', 'twilio', 'custom_http'],
      default: 'generic',
    },
    senderId: { type: String, trim: true, default: '' },
    accountUsername: { type: String, trim: true, default: '' },
    apiKeyEncrypted: { type: String, trim: true, default: '' },
    apiSecretEncrypted: { type: String, trim: true, default: '' },
    defaultCountryCode: { type: String, trim: true, default: '+254' },
    callbackUrl: { type: String, trim: true, default: '' },
    enabled: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    lastTestStatus: {
      type: String,
      enum: ['never', 'success', 'failed'],
      default: 'never',
    },
    lastTestedAt: { type: Date, default: null },
    lastTestMessage: { type: String, trim: true, default: '' },
    lastUpdatedAt: { type: Date, default: null },
    lastUpdatedBy: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const smsTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    name: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    recipientType: {
      type: String,
      enum: ['tenant', 'landlord', 'internal'],
      default: 'tenant',
    },
    enabled: { type: Boolean, default: false },
    sendMode: { type: String, enum: ['manual', 'automatic'], default: 'manual' },
    profileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    messageBody: { type: String, trim: true, default: '' },
    placeholders: { type: [String], default: [] },
    lastUpdatedAt: { type: Date, default: null },
    lastUpdatedBy: { type: String, trim: true, default: '' },
  },
  { _id: true }
);

const communicationSchema = new mongoose.Schema(
  {
    emailProfiles: {
      type: [emailProfileSchema],
      default: [],
    },
    defaultEmailProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    smsProfiles: {
      type: [smsProfileSchema],
      default: [],
    },
    defaultSmsProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    smsTemplates: {
      type: [smsTemplateSchema],
      default: () => getDefaultSmsTemplates(),
    },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    // General Information
    companyName: { type: String, required: true, trim: true },
    companyCode: { type: String, trim: true, uppercase: true, default: '' },
    registrationNo: { type: String, trim: true, default: undefined },
    taxPIN: { type: String, trim: true, default: '' },
    taxExemptCode: { type: String, trim: true, default: '' },

    // Address
    postalAddress: { type: String, required: true, trim: true },
    country: { type: String, default: 'Kenya', trim: true },
    town: { type: String, trim: true, default: '' },
    roadStreet: { type: String, trim: true, default: '' },
    latitude: { type: String, trim: true, default: '' },
    longitude: { type: String, trim: true, default: '' },

    // Currency & Statutory
    baseCurrency: { type: String, required: true, default: 'KES', trim: true },
    taxRegime: { type: String, required: true, default: 'VAT', trim: true },

    // Module Settings – stored as boolean flags
    modules: {
      propertyManagement: {
        type: Boolean,
        default: companyModuleDefaults.propertyManagement,
      },
      inventory: { type: Boolean, default: companyModuleDefaults.inventory },
      telcoDealership: {
        type: Boolean,
        default: companyModuleDefaults.telcoDealership,
      },
      procurement: { type: Boolean, default: companyModuleDefaults.procurement },
      hr: { type: Boolean, default: companyModuleDefaults.hr },
      facilityManagement: {
        type: Boolean,
        default: companyModuleDefaults.facilityManagement,
      },
      hotelManagement: {
        type: Boolean,
        default: companyModuleDefaults.hotelManagement,
      },
      accounts: { type: Boolean, default: companyModuleDefaults.accounts },
      billing: { type: Boolean, default: companyModuleDefaults.billing },
      propertySale: { type: Boolean, default: companyModuleDefaults.propertySale },
      frontOffice: { type: Boolean, default: companyModuleDefaults.frontOffice },
      dms: { type: Boolean, default: companyModuleDefaults.dms },
      academics: { type: Boolean, default: companyModuleDefaults.academics },
      projectManagement: {
        type: Boolean,
        default: companyModuleDefaults.projectManagement,
      },
      assetValuation: {
        type: Boolean,
        default: companyModuleDefaults.assetValuation,
      },
      pos: { type: Boolean, default: companyModuleDefaults.pos ?? false },
      securityServices: {
        type: Boolean,
        default: companyModuleDefaults.securityServices ?? false,
      },
    },

    // Fiscal Period Settings
    fiscalStartMonth: { type: String, required: true, default: 'January' },
    fiscalStartYear: { type: Number, required: true },
    fiscalPeriods: {
      monthly: { type: Boolean, default: true },
      quarterly: { type: Boolean, default: false },
      fourMonths: { type: Boolean, default: false },
      semiAnnual: { type: Boolean, default: false },
    },
    operationPeriodType: { type: String, required: true, default: 'Monthly' },

    // Additional fields from original Business schema
    businessOwner: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phoneNo: { type: String, trim: true, default: '' },
    kraPin: { type: String, trim: true, default: '' },
    slogan: { type: String, default: '', trim: true },
    logo: { type: String, default: '', trim: true },
    unitTypes: { type: [String], default: () => normalizeCompanyUnitTypes() },
    POBOX: { type: String, default: '', trim: true },
    Street: { type: String, default: '', trim: true },
    City: { type: String, default: '', trim: true },

    paymentIntegration: {
      type: paymentIntegrationSchema,
      default: () => ({}),
    },

    communication: {
      type: communicationSchema,
      default: () => ({}),
    },

    // Demo workspace marker
    isDemoWorkspace: { type: Boolean, default: false, index: true },

    // Access keys for multi-tenant authentication
    // Keep optional so company creation does not fail when keys are not supplied.
    accessKeys: [
      {
        adminKey: { type: String, trim: true, default: undefined },
        normalKey: { type: String, trim: true, default: undefined },
        keyVersion: { type: String, default: 'v1', trim: true },
      },
    ],

    // Status flags
    isActive: { type: Boolean, default: false },
    accountActive: { type: Boolean, default: true },
    accountStatus: { type: String, default: 'Active' },
  },
  { timestamps: true }
);

companySchema.pre('validate', function normalizeCompany(next) {
  if (this.companyName && !this.companyCode) {
    this.companyCode = this.companyName
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 5);
  }

  if (typeof this.email === 'string') {
    this.email = this.email.trim().toLowerCase();
  }

  this.unitTypes = normalizeCompanyUnitTypes(this.unitTypes);
  this.registrationNo = optionalIndexedString(this.registrationNo);
  this.isDemoWorkspace = Boolean(this.isDemoWorkspace);

  if (this.modules) {
    this.modules = {
      ...companyModuleDefaults,
      ...this.modules,
    };
  } else {
    this.modules = { ...companyModuleDefaults };
  }

  if (Array.isArray(this.accessKeys)) {
    this.accessKeys = this.accessKeys
      .map((item) => normalizeAccessKeyItem(item))
      .filter(Boolean);
  } else {
    this.accessKeys = [];
  }

  const rawPaymentIntegration = this.paymentIntegration || {};
  const rawMpesaPaybills = Array.isArray(rawPaymentIntegration?.mpesaPaybills)
    ? rawPaymentIntegration.mpesaPaybills
    : [];
  const rawLegacyMpesa = rawPaymentIntegration?.mpesaPaybill || {};

  const sourceMpesaConfigs = rawMpesaPaybills.length
    ? rawMpesaPaybills
    : hasMeaningfulMpesaConfig(rawLegacyMpesa)
      ? [rawLegacyMpesa]
      : [];

  const normalizedMpesaPaybills = sourceMpesaConfigs
    .map((item, index) => normalizeMpesaPaybillConfigItem(item, index))
    .filter((item) => hasMeaningfulMpesaConfig(item));

  this.paymentIntegration = {
    mpesaPaybills: normalizedMpesaPaybills,
    mpesaPaybill: buildLegacyMpesaSummary(normalizedMpesaPaybills),
  };

  const rawCommunication = this.communication || {};
  const sourceEmailProfiles = Array.isArray(rawCommunication?.emailProfiles)
    ? rawCommunication.emailProfiles
    : [];

  const normalizedEmailProfiles = sourceEmailProfiles
    .map((item, index) => normalizeEmailProfileItem(item, index))
    .filter((item) => hasMeaningfulEmailProfile(item));

  const explicitDefaultEmailProfileId = rawCommunication?.defaultEmailProfileId
    ? String(rawCommunication.defaultEmailProfileId)
    : '';

  let resolvedDefaultEmailProfileId = null;
  if (explicitDefaultEmailProfileId) {
    const matchingProfile = normalizedEmailProfiles.find(
      (profile) => String(profile?._id || '') === explicitDefaultEmailProfileId
    );
    if (matchingProfile?._id) {
      resolvedDefaultEmailProfileId = matchingProfile._id;
    }
  }

  if (!resolvedDefaultEmailProfileId) {
    resolvedDefaultEmailProfileId =
      normalizedEmailProfiles.find((profile) => profile?.isDefault)?._id ||
      normalizedEmailProfiles.find((profile) => profile?.enabled)?._id ||
      normalizedEmailProfiles[0]?._id ||
      null;
  }

  const finalEmailProfiles = normalizedEmailProfiles.map((profile) => ({
    ...profile,
    isDefault: Boolean(resolvedDefaultEmailProfileId) && String(profile?._id || '') === String(resolvedDefaultEmailProfileId),
  }));

  const sourceSmsProfiles = Array.isArray(rawCommunication?.smsProfiles)
    ? rawCommunication.smsProfiles
    : [];

  const normalizedSmsProfiles = sourceSmsProfiles
    .map((item, index) => normalizeSmsProfileItem(item, index))
    .filter((item) => hasMeaningfulSmsProfile(item));

  const explicitDefaultSmsProfileId = rawCommunication?.defaultSmsProfileId
    ? String(rawCommunication.defaultSmsProfileId)
    : '';

  let resolvedDefaultSmsProfileId = null;
  if (explicitDefaultSmsProfileId) {
    const matchingProfile = normalizedSmsProfiles.find(
      (profile) => String(profile?._id || '') === explicitDefaultSmsProfileId
    );
    if (matchingProfile?._id) {
      resolvedDefaultSmsProfileId = matchingProfile._id;
    }
  }

  if (!resolvedDefaultSmsProfileId) {
    resolvedDefaultSmsProfileId =
      normalizedSmsProfiles.find((profile) => profile?.isDefault)?._id ||
      normalizedSmsProfiles.find((profile) => profile?.enabled)?._id ||
      normalizedSmsProfiles[0]?._id ||
      null;
  }

  const finalSmsProfiles = normalizedSmsProfiles.map((profile) => ({
    ...profile,
    isDefault: Boolean(resolvedDefaultSmsProfileId) && String(profile?._id || '') === String(resolvedDefaultSmsProfileId),
  }));

  const availableSmsProfileIds = new Set(
    finalSmsProfiles.map((profile) => String(profile?._id || '')).filter(Boolean)
  );

  const defaultSmsTemplates = getDefaultSmsTemplates();
  const existingSmsTemplates = Array.isArray(rawCommunication?.smsTemplates)
    ? rawCommunication.smsTemplates
    : [];
  const templatesByKey = new Map(
    existingSmsTemplates
      .map((item) => [optionalString(item?.key), item])
      .filter(([key]) => Boolean(key))
  );

  const normalizedSmsTemplates = defaultSmsTemplates.map((templateDefinition) =>
    normalizeSmsTemplateItem(
      templatesByKey.get(optionalString(templateDefinition.key)) || {},
      templateDefinition,
      availableSmsProfileIds
    )
  );

  this.communication = {
    emailProfiles: finalEmailProfiles,
    defaultEmailProfileId: resolvedDefaultEmailProfileId || null,
    smsProfiles: finalSmsProfiles,
    defaultSmsProfileId: resolvedDefaultSmsProfileId || null,
    smsTemplates: normalizedSmsTemplates,
  };

  next();
});

// Indexes for performance / uniqueness
companySchema.index({ companyCode: 1 }, { sparse: true });
companySchema.index({ companyName: 1 });
companySchema.index({ isDemoWorkspace: 1, companyName: 1 });
companySchema.index({ isDemoWorkspace: 1, updatedAt: -1 });
companySchema.index({ 'accessKeys.keyVersion': 1 });
companySchema.index(
  { registrationNo: 1 },
  {
    unique: true,
    partialFilterExpression: {
      registrationNo: { $exists: true, $type: 'string' },
    },
  }
);

companySchema.index(
  { 'paymentIntegration.mpesaPaybills.shortCode': 1 },
  {
    name: 'company_mpesa_shortcode_lookup',
    partialFilterExpression: {
      'paymentIntegration.mpesaPaybills.shortCode': { $type: 'string', $gt: '' },
    },
  }
);

// Unique only when actual values exist
companySchema.index(
  { 'accessKeys.adminKey': 1 },
  {
    name: 'company_access_admin_key_unique',
    unique: true,
    partialFilterExpression: {
      'accessKeys.adminKey': { $exists: true, $type: 'string' },
    },
  }
);

companySchema.index(
  { 'accessKeys.normalKey': 1 },
  {
    name: 'company_access_normal_key_unique',
    unique: true,
    partialFilterExpression: {
      'accessKeys.normalKey': { $exists: true, $type: 'string' },
    },
  }
);

export default mongoose.model('Company', companySchema);
