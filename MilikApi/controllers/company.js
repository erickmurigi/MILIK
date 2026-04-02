import mongoose from "mongoose";
import Company from "../models/Company.js";
import User from "../models/User.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import { createError } from "../utils/error.js";
import {
  buildEmailProfileStatus,
  buildMpesaPaybillStatus,
  buildSmsProfileStatus,
  getPrimaryEmailProfile,
  getPrimaryMpesaPaybillConfig,
  getPrimarySmsProfile,
  getRawEmailProfiles,
  getRawMpesaPaybillConfigs,
  getRawSmsProfiles,
  mergeSmsTemplatesWithDefaults,
  normalizeCompanyModules,
  normalizeCompanyIdentityFields,
  normalizePhoneCountryCode,
  normalizeSmsProvider,
  serializeCompanyForClient,
} from "../utils/companyModules.js";
import { canAccessCompanyId, normalizeCompanyId } from "./verifyToken.js";
import { ensureSystemChartOfAccounts } from "../services/chartOfAccountsService.js";
import {
  buildCompanyInternalCopyRecipients,
  buildCompanySmtpTransporter,
  encryptStoredSecret,
  resolveCompanyMailSender,
} from "../utils/smtpMailer.js";

const companySummarySelect =
  "companyName companyCode baseCurrency country town email phoneNo slogan logo unitTypes isActive accountStatus isDemoWorkspace modules fiscalStartMonth fiscalStartYear operationPeriodType paymentIntegration.mpesaPaybills paymentIntegration.mpesaPaybill communication.emailProfiles communication.defaultEmailProfileId communication.smsProfiles communication.defaultSmsProfileId communication.smsTemplates";

const DEMO_COMPANY_EMAIL = "demo.workspace@milik.local";
const DEMO_COMPANY_NAME_REGEX = /^milik\s+demo\s+workspace$/i;

const buildLiveCompanyFilter = () => ({
  isDemoWorkspace: { $ne: true },
  companyName: { $not: DEMO_COMPANY_NAME_REGEX },
  email: { $ne: DEMO_COMPANY_EMAIL },
});

const shouldIncludeDemoCompanies = (req = {}) =>
  req?.user?.isDemoUser || String(req?.query?.includeDemo || "").toLowerCase() === "true";

const buildCompanyCode = (companyName = "") =>
  String(companyName)
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .substring(0, 5);

const serializeCompanyResponse = (companyDoc, user = null) => {
  const company = companyDoc?.toObject ? companyDoc.toObject() : companyDoc;
  return serializeCompanyForClient(company, user);
};

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");


const resolveConfigName = (config = {}, index = 0) => {
  const explicitName = normalizeText(config?.name);
  if (explicitName) return explicitName;

  const shortCode = normalizeText(config?.shortCode);
  if (shortCode) return `Paybill ${shortCode}`;

  return `Paybill Configuration ${index + 1}`;
};

const isCashbookLikeAccount = (account = {}) => {
  const code = String(account?.code || "").trim();
  const name = String(account?.name || "").trim();
  const type = String(account?.type || "").trim().toLowerCase();
  return type === "asset" && (/^11/.test(code) || /(cash|bank|mpesa|m-pesa|mobile money|wallet|collection)/i.test(name));
};

const getCompanyMpesaConfigs = (company) => getRawMpesaPaybillConfigs(company?.paymentIntegration || {});

const setCompanyMpesaConfigs = (company, configs = []) => {
  const currentIntegration = company.paymentIntegration?.toObject
    ? company.paymentIntegration.toObject()
    : company.paymentIntegration || {};

  company.paymentIntegration = {
    ...currentIntegration,
    mpesaPaybills: configs,
  };
};


const EMAIL_USAGE_TAGS = [
  "receipts",
  "invoices",
  "landlord_statements",
  "system_alerts",
  "demo_requests",
  "onboarding",
];

const normalizeEmail = (value) => normalizeText(value).toLowerCase();

const isValidEmailAddress = (value = "") => /^\S+@\S+\.\S+$/.test(String(value || "").trim());

const validateEmailAddress = (value = "", fieldLabel = "Email address") => {
  const normalizedValue = normalizeEmail(value);
  if (!normalizedValue) return;
  if (!isValidEmailAddress(normalizedValue)) {
    throw createError(400, `${fieldLabel} is not valid.`);
  }
};

const normalizeUsageTags = (value = []) => {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => normalizeText(item).toLowerCase())
        .filter((item) => EMAIL_USAGE_TAGS.includes(item))
    )
  );
};

const resolveEmailProfileName = (profile = {}, index = 0) => {
  const explicitName = normalizeText(profile?.name);
  if (explicitName) return explicitName;

  const senderEmail = normalizeEmail(profile?.senderEmail);
  if (senderEmail) return senderEmail;

  return `Email Profile ${index + 1}`;
};

const validateSmtpPort = (value) => {
  if (value === undefined || value === null || value === "") return;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw createError(400, "SMTP port must be a valid number between 1 and 65535.");
  }
};

const getCompanyEmailProfiles = (company) => getRawEmailProfiles(company?.communication || {});

const resolveDefaultEmailProfileId = (profiles = [], requestedDefaultId = null) => {
  const normalizedRequested = normalizeText(requestedDefaultId);
  if (normalizedRequested) {
    const matchingByRequested = profiles.find((profile) => String(profile?._id || "") === normalizedRequested);
    if (matchingByRequested?._id) return matchingByRequested._id;
  }

  return (
    profiles.find((profile) => profile?.isDefault)?._id ||
    profiles.find((profile) => profile?.enabled)?._id ||
    profiles[0]?._id ||
    null
  );
};

const setCompanyEmailProfiles = (company, profiles = [], requestedDefaultId = null) => {
  const currentCommunication = company.communication?.toObject
    ? company.communication.toObject()
    : company.communication || {};

  const resolvedDefaultId = resolveDefaultEmailProfileId(profiles, requestedDefaultId);
  const nextProfiles = profiles.map((profile) => ({
    ...profile,
    isDefault: Boolean(resolvedDefaultId) && String(profile?._id || "") === String(resolvedDefaultId),
  }));

  company.communication = {
    ...currentCommunication,
    emailProfiles: nextProfiles,
    defaultEmailProfileId: resolvedDefaultId || null,
  };
};

const ensureUniqueEmailProfileNameInCompany = ({ profiles = [], profileId = null, name = "" }) => {
  const normalizedName = normalizeText(name).toLowerCase();
  if (!normalizedName) return;

  const duplicate = profiles.find(
    (profile) =>
      String(profile?._id || "") !== String(profileId || "") &&
      normalizeText(profile?.name).toLowerCase() === normalizedName
  );

  if (duplicate) {
    throw createError(400, "Use a different email profile name. This company already has one with the same name.");
  }
};

const buildEmailProfileRecord = ({
  existingProfile = {},
  payload = {},
  actorUserId,
  index = 0,
  isCreate = false,
}) => {
  const nextProfile = {
    _id: existingProfile?._id || new mongoose.Types.ObjectId(),
    name: resolveEmailProfileName(existingProfile, index),
    senderName: normalizeText(existingProfile?.senderName),
    senderEmail: normalizeEmail(existingProfile?.senderEmail),
    replyTo: normalizeEmail(existingProfile?.replyTo),
    smtpHost: normalizeText(existingProfile?.smtpHost).toLowerCase(),
    smtpPort: Number(existingProfile?.smtpPort || 0) || null,
    encryption: ["ssl", "tls", "none"].includes(normalizeText(existingProfile?.encryption).toLowerCase())
      ? normalizeText(existingProfile?.encryption).toLowerCase()
      : "ssl",
    username: normalizeText(existingProfile?.username),
    passwordEncrypted: normalizeText(existingProfile?.passwordEncrypted),
    internalCopyEmail: normalizeEmail(existingProfile?.internalCopyEmail),
    internalCopyMode: ["bcc", "cc", "none"].includes(normalizeText(existingProfile?.internalCopyMode).toLowerCase())
      ? normalizeText(existingProfile?.internalCopyMode).toLowerCase()
      : "none",
    usageTags: normalizeUsageTags(existingProfile?.usageTags),
    enabled: Boolean(existingProfile?.enabled),
    isDefault: Boolean(existingProfile?.isDefault),
    lastTestStatus: ["success", "failed", "never"].includes(normalizeText(existingProfile?.lastTestStatus).toLowerCase())
      ? normalizeText(existingProfile?.lastTestStatus).toLowerCase()
      : "never",
    lastTestedAt: existingProfile?.lastTestedAt || null,
    lastTestMessage: normalizeText(existingProfile?.lastTestMessage),
    lastSuccessfulSendAt: existingProfile?.lastSuccessfulSendAt || null,
    lastUpdatedAt: existingProfile?.lastUpdatedAt || null,
    lastUpdatedBy: normalizeText(existingProfile?.lastUpdatedBy),
  };

  let hasChanges = isCreate;

  const applyBoolean = (field) => {
    if (payload[field] === undefined) return;
    const nextValue = Boolean(payload[field]);
    if (nextProfile[field] !== nextValue) {
      nextProfile[field] = nextValue;
      hasChanges = true;
    }
  };

  if (payload.name !== undefined) {
    const value = normalizeText(payload.name);
    if (!value) {
      throw createError(400, "Enter a profile name for this email configuration.");
    }
    if (nextProfile.name !== value) {
      nextProfile.name = value;
      hasChanges = true;
    }
  } else if (!normalizeText(nextProfile.name)) {
    nextProfile.name = resolveEmailProfileName({ ...nextProfile, ...payload }, index);
    hasChanges = true;
  }

  if (payload.senderName !== undefined) {
    const value = normalizeText(payload.senderName);
    if (nextProfile.senderName !== value) {
      nextProfile.senderName = value;
      hasChanges = true;
    }
  }

  if (payload.senderEmail !== undefined) {
    const value = normalizeEmail(payload.senderEmail);
    validateEmailAddress(value, "Sender email");
    if (nextProfile.senderEmail !== value) {
      nextProfile.senderEmail = value;
      hasChanges = true;
    }
  }

  if (payload.replyTo !== undefined) {
    const value = normalizeEmail(payload.replyTo);
    validateEmailAddress(value, "Reply-to email");
    if (nextProfile.replyTo !== value) {
      nextProfile.replyTo = value;
      hasChanges = true;
    }
  }

  if (payload.smtpHost !== undefined) {
    const value = normalizeText(payload.smtpHost).toLowerCase();
    if (nextProfile.smtpHost !== value) {
      nextProfile.smtpHost = value;
      hasChanges = true;
    }
  }

  if (payload.smtpPort !== undefined) {
    const rawValue = payload.smtpPort;
    if (rawValue === "" || rawValue === null) {
      if (nextProfile.smtpPort !== null) {
        nextProfile.smtpPort = null;
        hasChanges = true;
      }
    } else {
      validateSmtpPort(rawValue);
      const numericPort = Number(rawValue);
      if (nextProfile.smtpPort !== numericPort) {
        nextProfile.smtpPort = numericPort;
        hasChanges = true;
      }
    }
  }

  if (payload.encryption !== undefined) {
    const value = normalizeText(payload.encryption).toLowerCase();
    const nextValue = ["ssl", "tls", "none"].includes(value) ? value : "ssl";
    if (nextProfile.encryption !== nextValue) {
      nextProfile.encryption = nextValue;
      hasChanges = true;
    }
  }

  if (payload.username !== undefined) {
    const value = normalizeText(payload.username);
    if (nextProfile.username !== value) {
      nextProfile.username = value;
      hasChanges = true;
    }
  }

  if (payload.password !== undefined) {
    const value = normalizeText(payload.password);
    if (value) {
      nextProfile.passwordEncrypted = encryptStoredSecret(value);
      hasChanges = true;
    }
  }

  if (payload.internalCopyEmail !== undefined) {
    const value = normalizeEmail(payload.internalCopyEmail);
    validateEmailAddress(value, "Internal copy email");
    if (nextProfile.internalCopyEmail !== value) {
      nextProfile.internalCopyEmail = value;
      hasChanges = true;
    }
  }

  if (payload.internalCopyMode !== undefined) {
    const value = normalizeText(payload.internalCopyMode).toLowerCase();
    const nextValue = ["bcc", "cc", "none"].includes(value) ? value : "none";
    if (nextProfile.internalCopyMode !== nextValue) {
      nextProfile.internalCopyMode = nextValue;
      hasChanges = true;
    }
  }

  if (payload.usageTags !== undefined) {
    const nextTags = normalizeUsageTags(payload.usageTags);
    if (JSON.stringify(nextProfile.usageTags) !== JSON.stringify(nextTags)) {
      nextProfile.usageTags = nextTags;
      hasChanges = true;
    }
  }

  applyBoolean("enabled");
  applyBoolean("isDefault");

  if (nextProfile.isDefault) {
    nextProfile.enabled = true;
  }

  const status = buildEmailProfileStatus({
    ...nextProfile,
    hasPassword: Boolean(nextProfile.passwordEncrypted),
  });

  if ((nextProfile.enabled || nextProfile.isDefault) && !status.isConfigured) {
    throw createError(
      400,
      "Complete the sender details, SMTP host, port, username and password before enabling this email profile."
    );
  }

  if (hasChanges) {
    nextProfile.lastUpdatedAt = new Date();
    nextProfile.lastUpdatedBy = actorUserId ? String(actorUserId) : normalizeText(existingProfile?.lastUpdatedBy);
  }

  return nextProfile;
};

const applyEmailProfileMutation = ({ company, payload, actorUserId }) => {
  const action = normalizeText(payload?.action).toLowerCase();
  const profileId = normalizeText(payload?.profileId);
  const profilePayload = payload?.profile || {};
  const existingProfiles = getCompanyEmailProfiles(company);

  if (!["create", "update", "delete"].includes(action)) {
    throw createError(400, "Invalid email profile action.");
  }

  if (action === "create") {
    const nextProfile = buildEmailProfileRecord({
      existingProfile: {},
      payload: profilePayload,
      actorUserId,
      index: existingProfiles.length,
      isCreate: true,
    });

    ensureUniqueEmailProfileNameInCompany({
      profiles: existingProfiles,
      profileId: nextProfile._id,
      name: nextProfile.name,
    });

    setCompanyEmailProfiles(
      company,
      [...existingProfiles, nextProfile],
      nextProfile.isDefault ? nextProfile._id : company.communication?.defaultEmailProfileId || null
    );
    return;
  }

  if (!profileId) {
    throw createError(400, "Email profile id is required for this action.");
  }

  const targetIndex = existingProfiles.findIndex((profile) => String(profile?._id || "") === profileId);
  if (targetIndex === -1) {
    throw createError(404, "Email profile not found for this company.");
  }

  if (action === "delete") {
    const nextProfiles = existingProfiles.filter((profile) => String(profile?._id || "") !== profileId);
    setCompanyEmailProfiles(company, nextProfiles, company.communication?.defaultEmailProfileId || null);
    return;
  }

  const nextProfile = buildEmailProfileRecord({
    existingProfile: existingProfiles[targetIndex],
    payload: profilePayload,
    actorUserId,
    index: targetIndex,
    isCreate: false,
  });

  ensureUniqueEmailProfileNameInCompany({
    profiles: existingProfiles,
    profileId,
    name: nextProfile.name,
  });

  const nextProfiles = existingProfiles.map((profile, index) => (index === targetIndex ? nextProfile : profile));
  const currentDefaultId = normalizeText(company.communication?.defaultEmailProfileId || "");
  const requestedDefaultId = nextProfile.isDefault
    ? nextProfile._id
    : currentDefaultId === profileId
      ? null
      : company.communication?.defaultEmailProfileId || null;

  setCompanyEmailProfiles(company, nextProfiles, requestedDefaultId);
};

const getCompanySmsProfiles = (company) => getRawSmsProfiles(company?.communication || {});

const resolveDefaultSmsProfileId = (profiles = [], requestedDefaultId = null) => {
  const normalizedRequested = normalizeText(requestedDefaultId);
  if (normalizedRequested) {
    const matchingByRequested = profiles.find((profile) => String(profile?._id || "") === normalizedRequested);
    if (matchingByRequested?._id) return matchingByRequested._id;
  }

  return (
    profiles.find((profile) => profile?.isDefault)?._id ||
    profiles.find((profile) => profile?.enabled)?._id ||
    profiles[0]?._id ||
    null
  );
};

const setCompanySmsProfiles = (company, profiles = [], requestedDefaultId = null) => {
  const currentCommunication = company.communication?.toObject
    ? company.communication.toObject()
    : company.communication || {};

  const resolvedDefaultId = resolveDefaultSmsProfileId(profiles, requestedDefaultId);
  const nextProfiles = profiles.map((profile) => ({
    ...profile,
    isDefault: Boolean(resolvedDefaultId) && String(profile?._id || "") === String(resolvedDefaultId),
  }));

  company.communication = {
    ...currentCommunication,
    smsProfiles: nextProfiles,
    defaultSmsProfileId: resolvedDefaultId || null,
  };
};

const ensureUniqueSmsProfileNameInCompany = ({ profiles = [], profileId = null, name = "" }) => {
  const normalizedName = normalizeText(name).toLowerCase();
  if (!normalizedName) return;

  const duplicate = profiles.find(
    (profile) =>
      String(profile?._id || "") !== String(profileId || "") &&
      normalizeText(profile?.name).toLowerCase() === normalizedName
  );

  if (duplicate) {
    throw createError(400, "Use a different SMS configuration name. This company already has one with the same name.");
  }
};

const buildSmsProfileRecord = ({ existingProfile = {}, payload = {}, actorUserId, index = 0, isCreate = false }) => {
  const nextProfile = {
    _id: existingProfile?._id || new mongoose.Types.ObjectId(),
    name: normalizeText(existingProfile?.name) || `SMS Profile ${index + 1}`,
    provider: normalizeSmsProvider(existingProfile?.provider),
    senderId: normalizeText(existingProfile?.senderId),
    accountUsername: normalizeText(existingProfile?.accountUsername),
    apiKeyEncrypted: normalizeText(existingProfile?.apiKeyEncrypted),
    apiSecretEncrypted: normalizeText(existingProfile?.apiSecretEncrypted),
    defaultCountryCode: normalizePhoneCountryCode(existingProfile?.defaultCountryCode),
    callbackUrl: normalizeText(existingProfile?.callbackUrl),
    enabled: Boolean(existingProfile?.enabled),
    isDefault: Boolean(existingProfile?.isDefault),
    lastTestStatus: ["success", "failed", "never"].includes(normalizeText(existingProfile?.lastTestStatus).toLowerCase())
      ? normalizeText(existingProfile?.lastTestStatus).toLowerCase()
      : "never",
    lastTestedAt: existingProfile?.lastTestedAt || null,
    lastTestMessage: normalizeText(existingProfile?.lastTestMessage),
    lastUpdatedAt: existingProfile?.lastUpdatedAt || null,
    lastUpdatedBy: normalizeText(existingProfile?.lastUpdatedBy),
  };

  let hasChanges = isCreate;

  const applyBoolean = (field) => {
    if (payload[field] === undefined) return;
    const nextValue = Boolean(payload[field]);
    if (nextProfile[field] !== nextValue) {
      nextProfile[field] = nextValue;
      hasChanges = true;
    }
  };

  if (payload.name !== undefined) {
    const value = normalizeText(payload.name);
    if (!value) {
      throw createError(400, "Enter a profile name for this SMS configuration.");
    }
    if (nextProfile.name !== value) {
      nextProfile.name = value;
      hasChanges = true;
    }
  }

  if (payload.provider !== undefined) {
    const value = normalizeSmsProvider(payload.provider);
    if (nextProfile.provider !== value) {
      nextProfile.provider = value;
      hasChanges = true;
    }
  }

  if (payload.senderId !== undefined) {
    const value = normalizeText(payload.senderId);
    if (nextProfile.senderId !== value) {
      nextProfile.senderId = value;
      hasChanges = true;
    }
  }

  if (payload.accountUsername !== undefined) {
    const value = normalizeText(payload.accountUsername);
    if (nextProfile.accountUsername !== value) {
      nextProfile.accountUsername = value;
      hasChanges = true;
    }
  }

  if (payload.apiKey !== undefined) {
    const value = normalizeText(payload.apiKey);
    if (value) {
      nextProfile.apiKeyEncrypted = encryptStoredSecret(value);
      hasChanges = true;
    }
  }

  if (payload.apiSecret !== undefined) {
    const value = normalizeText(payload.apiSecret);
    if (value) {
      nextProfile.apiSecretEncrypted = encryptStoredSecret(value);
      hasChanges = true;
    }
  }

  if (payload.defaultCountryCode !== undefined) {
    const value = normalizePhoneCountryCode(payload.defaultCountryCode);
    if (nextProfile.defaultCountryCode !== value) {
      nextProfile.defaultCountryCode = value;
      hasChanges = true;
    }
  }

  if (payload.callbackUrl !== undefined) {
    const value = normalizeText(payload.callbackUrl);
    if (nextProfile.callbackUrl !== value) {
      nextProfile.callbackUrl = value;
      hasChanges = true;
    }
  }

  applyBoolean("enabled");
  applyBoolean("isDefault");

  if (nextProfile.isDefault) {
    nextProfile.enabled = true;
  }

  const status = buildSmsProfileStatus({
    ...nextProfile,
    hasApiKey: Boolean(nextProfile.apiKeyEncrypted),
  });

  if ((nextProfile.enabled || nextProfile.isDefault) && !status.isConfigured) {
    throw createError(
      400,
      "Complete the provider, sender ID, account username and API key before enabling this SMS configuration."
    );
  }

  if (hasChanges) {
    nextProfile.lastUpdatedAt = new Date();
    nextProfile.lastUpdatedBy = actorUserId ? String(actorUserId) : normalizeText(existingProfile?.lastUpdatedBy);
  }

  return nextProfile;
};

const applySmsProfileMutation = ({ company, payload, actorUserId }) => {
  const action = normalizeText(payload?.action).toLowerCase();
  const profileId = normalizeText(payload?.profileId);
  const profilePayload = payload?.profile || {};
  const existingProfiles = getCompanySmsProfiles(company);

  if (!["create", "update", "delete"].includes(action)) {
    throw createError(400, "Invalid SMS profile action.");
  }

  if (action === "create") {
    const nextProfile = buildSmsProfileRecord({
      existingProfile: {},
      payload: profilePayload,
      actorUserId,
      index: existingProfiles.length,
      isCreate: true,
    });

    ensureUniqueSmsProfileNameInCompany({
      profiles: existingProfiles,
      profileId: nextProfile._id,
      name: nextProfile.name,
    });

    setCompanySmsProfiles(
      company,
      [...existingProfiles, nextProfile],
      nextProfile.isDefault ? nextProfile._id : company.communication?.defaultSmsProfileId || null
    );
    return;
  }

  if (!profileId) {
    throw createError(400, "SMS profile id is required for this action.");
  }

  const targetIndex = existingProfiles.findIndex((profile) => String(profile?._id || "") === profileId);
  if (targetIndex === -1) {
    throw createError(404, "SMS profile not found for this company.");
  }

  if (action === "delete") {
    const nextProfiles = existingProfiles.filter((profile) => String(profile?._id || "") !== profileId);
    setCompanySmsProfiles(company, nextProfiles, company.communication?.defaultSmsProfileId || null);
    return;
  }

  const nextProfile = buildSmsProfileRecord({
    existingProfile: existingProfiles[targetIndex],
    payload: profilePayload,
    actorUserId,
    index: targetIndex,
    isCreate: false,
  });

  ensureUniqueSmsProfileNameInCompany({
    profiles: existingProfiles,
    profileId,
    name: nextProfile.name,
  });

  const nextProfiles = existingProfiles.map((profile, index) => (index === targetIndex ? nextProfile : profile));
  const currentDefaultId = normalizeText(company.communication?.defaultSmsProfileId || "");
  const requestedDefaultId = nextProfile.isDefault
    ? nextProfile._id
    : currentDefaultId === profileId
      ? null
      : company.communication?.defaultSmsProfileId || null;

  setCompanySmsProfiles(company, nextProfiles, requestedDefaultId);
};

const getCompanySmsTemplates = (company) => mergeSmsTemplatesWithDefaults(
  company?.communication?.smsTemplates || [],
  getCompanySmsProfiles(company)
);

const setCompanySmsTemplates = (company, templates = []) => {
  const currentCommunication = company.communication?.toObject
    ? company.communication.toObject()
    : company.communication || {};
  const smsProfiles = getCompanySmsProfiles(company);

  company.communication = {
    ...currentCommunication,
    smsTemplates: mergeSmsTemplatesWithDefaults(templates, smsProfiles),
  };
};

const applySmsTemplateMutation = ({ company, payload, actorUserId }) => {
  const action = normalizeText(payload?.action).toLowerCase();
  const templateId = normalizeText(payload?.templateId);
  const templateKey = normalizeText(payload?.templateKey);
  const templatePayload = payload?.template || {};
  const currentTemplates = getCompanySmsTemplates(company);

  if (action === "reset_defaults") {
    setCompanySmsTemplates(company, []);
    return;
  }

  if (action !== "update") {
    throw createError(400, "Invalid SMS template action.");
  }

  const targetIndex = currentTemplates.findIndex(
    (template) =>
      String(template?._id || "") === templateId ||
      normalizeText(template?.key) === templateKey
  );

  if (targetIndex === -1) {
    throw createError(404, "SMS template not found for this company.");
  }

  const smsProfiles = getCompanySmsProfiles(company);
  const validProfileIds = new Set(smsProfiles.map((profile) => String(profile?._id || "")).filter(Boolean));
  const existingTemplate = currentTemplates[targetIndex];
  const nextTemplate = {
    ...existingTemplate,
    enabled: templatePayload.enabled === undefined ? Boolean(existingTemplate.enabled) : Boolean(templatePayload.enabled),
    sendMode: ["manual", "automatic"].includes(normalizeText(templatePayload.sendMode).toLowerCase())
      ? normalizeText(templatePayload.sendMode).toLowerCase()
      : existingTemplate.sendMode,
    profileId:
      templatePayload.profileId === undefined
        ? existingTemplate.profileId || ''
        : validProfileIds.has(normalizeText(templatePayload.profileId))
          ? normalizeText(templatePayload.profileId)
          : '',
    messageBody:
      templatePayload.messageBody === undefined
        ? existingTemplate.messageBody
        : normalizeText(templatePayload.messageBody),
    lastUpdatedAt: new Date(),
    lastUpdatedBy: actorUserId ? String(actorUserId) : normalizeText(existingTemplate?.lastUpdatedBy),
  };

  if (!nextTemplate.messageBody) {
    throw createError(400, "Enter the SMS template message before saving.");
  }

  const nextTemplates = currentTemplates.map((template, index) => (index == targetIndex ? nextTemplate : template));
  setCompanySmsTemplates(company, nextTemplates);
};

const validatePaybillNumber = (shortCode = "") => {
  if (shortCode && !/^\d{5,7}$/.test(shortCode)) {
    throw createError(400, "Paybill number must contain 5 to 7 digits.");
  }
};

const ensureUniqueConfigNameInCompany = ({ configs = [], configId = null, name = "" }) => {
  const normalizedName = normalizeText(name).toLowerCase();
  if (!normalizedName) return;

  const duplicate = configs.find(
    (config) =>
      String(config?._id || "") !== String(configId || "") &&
      normalizeText(config?.name).toLowerCase() === normalizedName
  );

  if (duplicate) {
    throw createError(400, "Use a different Paybill configuration name. This company already has one with the same name.");
  }
};

const ensureUniqueShortCode = async ({ companyId, configs = [], configId = null, shortCode = "" }) => {
  const normalizedShortCode = normalizeText(shortCode);
  if (!normalizedShortCode) return;

  const duplicateInCompany = configs.find(
    (config) =>
      String(config?._id || "") !== String(configId || "") &&
      normalizeText(config?.shortCode) === normalizedShortCode
  );

  if (duplicateInCompany) {
    throw createError(400, "This company already has another Paybill configuration using the same Paybill number.");
  }

  const duplicateInOtherCompany = await Company.findOne({
    _id: { $ne: companyId },
    $or: [
      { "paymentIntegration.mpesaPaybills.shortCode": normalizedShortCode },
      { "paymentIntegration.mpesaPaybill.shortCode": normalizedShortCode },
    ],
  })
    .select("_id companyName")
    .lean();

  if (duplicateInOtherCompany) {
    throw createError(400, "This M-Pesa Paybill is already assigned to another company.");
  }
};

const buildMpesaConfigRecord = async ({
  company,
  configs,
  existingConfig = {},
  payload = {},
  actorUserId,
  index = 0,
  isCreate = false,
}) => {
  const nextConfig = {
    _id: existingConfig?._id || new mongoose.Types.ObjectId(),
    name: resolveConfigName(existingConfig, index),
    enabled: Boolean(existingConfig?.enabled),
    isActive: Boolean(existingConfig?.isActive),
    shortCode: normalizeText(existingConfig?.shortCode),
    consumerKey: normalizeText(existingConfig?.consumerKey),
    consumerSecret: normalizeText(existingConfig?.consumerSecret),
    passkey: normalizeText(existingConfig?.passkey),
    defaultCashbookAccountId: existingConfig?.defaultCashbookAccountId || null,
    defaultCashbookAccountName: normalizeText(existingConfig?.defaultCashbookAccountName),
    unmatchedPaymentMode:
      existingConfig?.unmatchedPaymentMode === "hold_unallocated" ? "hold_unallocated" : "manual_review",
    postingMode:
      existingConfig?.postingMode === "auto_post_matched" ? "auto_post_matched" : "manual_review",
    callbackMode: "milik_managed",
    responseType: existingConfig?.responseType === "Cancelled" ? "Cancelled" : "Completed",
    accountReferenceSource: "tenant_code",
    tenantAccountReferenceLabel: "Tenant Code",
    lastConfiguredAt: existingConfig?.lastConfiguredAt || null,
    lastConfiguredBy: normalizeText(existingConfig?.lastConfiguredBy),
  };

  let hasChanges = isCreate;

  const applyBoolean = (field) => {
    if (payload[field] === undefined) return;
    const nextValue = Boolean(payload[field]);
    if (nextConfig[field] !== nextValue) {
      nextConfig[field] = nextValue;
      hasChanges = true;
    }
  };

  const applyEnum = (field, allowedValues, fallbackValue) => {
    if (payload[field] === undefined) return;
    const raw = normalizeText(payload[field]);
    const nextValue = allowedValues.includes(raw) ? raw : fallbackValue;
    if (nextConfig[field] !== nextValue) {
      nextConfig[field] = nextValue;
      hasChanges = true;
    }
  };

  if (payload.name !== undefined) {
    const name = normalizeText(payload.name);
    if (!name) {
      throw createError(400, "Enter a configuration name for this Paybill setup.");
    }
    if (nextConfig.name !== name) {
      nextConfig.name = name;
      hasChanges = true;
    }
  } else if (!normalizeText(nextConfig.name)) {
    nextConfig.name = resolveConfigName({ ...nextConfig, ...payload }, index);
    hasChanges = true;
  }

  applyBoolean("enabled");
  applyBoolean("isActive");

  if (payload.shortCode !== undefined) {
    const shortCode = normalizeText(payload.shortCode);
    validatePaybillNumber(shortCode);
    if (nextConfig.shortCode !== shortCode) {
      nextConfig.shortCode = shortCode;
      hasChanges = true;
    }
  }

  ["consumerKey", "consumerSecret", "passkey"].forEach((field) => {
    if (payload[field] === undefined) return;
    const secretValue = normalizeText(payload[field]);
    if (!secretValue) return;
    if (nextConfig[field] !== secretValue) {
      nextConfig[field] = secretValue;
      hasChanges = true;
    }
  });

  applyEnum("unmatchedPaymentMode", ["manual_review", "hold_unallocated"], "manual_review");
  applyEnum("postingMode", ["manual_review", "auto_post_matched"], "manual_review");
  applyEnum("responseType", ["Completed", "Cancelled"], "Completed");

  if (payload.defaultCashbookAccountId !== undefined) {
    const accountId = normalizeText(payload.defaultCashbookAccountId);

    if (!accountId) {
      if (nextConfig.defaultCashbookAccountId || nextConfig.defaultCashbookAccountName) {
        nextConfig.defaultCashbookAccountId = null;
        nextConfig.defaultCashbookAccountName = "";
        hasChanges = true;
      }
    } else {
      const account = await ChartOfAccount.findOne({
        _id: accountId,
        business: company._id,
        type: "asset",
      })
        .select("_id code name type")
        .lean();

      if (!account || !isCashbookLikeAccount(account)) {
        throw createError(400, "Select a valid receiving cashbook for this company.");
      }

      const currentAccountId = nextConfig.defaultCashbookAccountId ? String(nextConfig.defaultCashbookAccountId) : "";
      if (currentAccountId !== String(account._id) || nextConfig.defaultCashbookAccountName !== account.name) {
        nextConfig.defaultCashbookAccountId = account._id;
        nextConfig.defaultCashbookAccountName = account.name;
        hasChanges = true;
      }
    }
  }

  if (!nextConfig.enabled && nextConfig.isActive) {
    nextConfig.isActive = false;
    hasChanges = true;
  }

  ensureUniqueConfigNameInCompany({
    configs,
    configId: nextConfig._id,
    name: nextConfig.name,
  });

  await ensureUniqueShortCode({
    companyId: company._id,
    configs,
    configId: nextConfig._id,
    shortCode: nextConfig.shortCode,
  });

  const status = buildMpesaPaybillStatus(nextConfig);
  if (nextConfig.isActive && !status.isConfigured) {
    throw createError(
      400,
      "Complete the Paybill number, credentials and default receiving cashbook before activating the integration."
    );
  }

  if (hasChanges) {
    nextConfig.lastConfiguredAt = new Date();
    nextConfig.lastConfiguredBy = actorUserId ? String(actorUserId) : normalizeText(existingConfig?.lastConfiguredBy);
  }

  return nextConfig;
};

const applyLegacySingleMpesaUpdate = async ({ company, payload, actorUserId }) => {
  const configs = getCompanyMpesaConfigs(company);
  const primary = getPrimaryMpesaPaybillConfig(configs);
  const primaryId = primary?._id ? String(primary._id) : null;
  const remainingConfigs = primaryId
    ? configs.filter((config) => String(config?._id || "") !== primaryId)
    : [...configs];

  const nextPrimary = await buildMpesaConfigRecord({
    company,
    configs,
    existingConfig: primary || { name: "Primary Paybill" },
    payload,
    actorUserId,
    index: 0,
    isCreate: !primary,
  });

  const nextConfigs = [nextPrimary, ...remainingConfigs];
  setCompanyMpesaConfigs(company, nextConfigs);
};

const applyMpesaPaybillMutation = async ({ company, payload, actorUserId }) => {
  const action = normalizeText(payload?.action).toLowerCase();
  const configId = normalizeText(payload?.configId);
  const configPayload = payload?.config || {};
  const existingConfigs = getCompanyMpesaConfigs(company);

  if (!["create", "update", "delete"].includes(action)) {
    throw createError(400, "Invalid Paybill configuration action.");
  }

  if (action === "create") {
    const nextConfig = await buildMpesaConfigRecord({
      company,
      configs: existingConfigs,
      existingConfig: {},
      payload: configPayload,
      actorUserId,
      index: existingConfigs.length,
      isCreate: true,
    });

    setCompanyMpesaConfigs(company, [...existingConfigs, nextConfig]);
    return;
  }

  if (!configId) {
    throw createError(400, "Paybill configuration id is required for this action.");
  }

  const targetIndex = existingConfigs.findIndex((config) => String(config?._id || "") === configId);
  if (targetIndex === -1) {
    throw createError(404, "Paybill configuration not found for this company.");
  }

  if (action === "delete") {
    const nextConfigs = existingConfigs.filter((config) => String(config?._id || "") !== configId);
    setCompanyMpesaConfigs(company, nextConfigs);
    return;
  }

  const nextConfig = await buildMpesaConfigRecord({
    company,
    configs: existingConfigs,
    existingConfig: existingConfigs[targetIndex],
    payload: configPayload,
    actorUserId,
    index: targetIndex,
    isCreate: false,
  });

  const nextConfigs = existingConfigs.map((config, index) => (index === targetIndex ? nextConfig : config));
  setCompanyMpesaConfigs(company, nextConfigs);
};

export const createCompany = async (req, res, next) => {
  try {
    if (!req.user.superAdminAccess) {
      return next(createError(403, "Only super admin can create companies"));
    }

    const {
      companyName,
      registrationNo,
      taxPIN,
      taxExemptCode,
      postalAddress,
      country = "Kenya",
      town,
      roadStreet,
      latitude,
      longitude,
      baseCurrency = "KES",
      taxRegime = "VAT",
      fiscalStartMonth = "January",
      fiscalStartYear,
      operationPeriodType = "Monthly",
      businessOwner,
      slogan,
      modules = {},
      POBOX,
      Street,
      City,
    } = req.body;

    const identityFields = normalizeCompanyIdentityFields(req.body);

    if (!companyName || !postalAddress) {
      return next(createError(400, "Company name and postal address are required"));
    }

    const existingCompany = await Company.findOne({ companyName: String(companyName).trim() });
    if (existingCompany) {
      return next(createError(400, "Company with this name already exists"));
    }

    const newCompany = new Company({
      companyName: String(companyName).trim(),
      companyCode: buildCompanyCode(companyName),
      registrationNo,
      taxPIN,
      taxExemptCode,
      postalAddress,
      country,
      town,
      roadStreet,
      latitude,
      longitude,
      baseCurrency,
      taxRegime,
      fiscalStartMonth,
      fiscalStartYear: fiscalStartYear || new Date().getFullYear(),
      modules: normalizeCompanyModules(modules),
      operationPeriodType,
      businessOwner,
      slogan,
      ...identityFields,
      POBOX,
      Street,
      City,
    });

    const savedCompany = await newCompany.save();

    try {
      await ensureSystemChartOfAccounts(savedCompany._id);
    } catch (seedError) {
      await Company.findByIdAndDelete(savedCompany._id);
      throw new Error(`Company created but default chart seeding failed: ${seedError.message}`);
    }

    res.status(201).json({
      success: true,
      company: serializeCompanyResponse(savedCompany),
      message: "Company created successfully",
    });
  } catch (err) {
    console.error("Create company error:", err);

    if (err?.code === 11000) {
      const duplicateField = Object.keys(err?.keyPattern || {})[0] || "";

      if (duplicateField === "accessKeys.adminKey" || duplicateField === "accessKeys.normalKey") {
        return next(
          createError(
            500,
            "Company creation is blocked by a stale MongoDB access key index. Drop the old company access key index and retry the request."
          )
        );
      }

      if (duplicateField === "registrationNo") {
        return next(createError(400, "A company with this registration number already exists"));
      }

      if (
        duplicateField === "paymentIntegration.mpesaPaybill.shortCode" ||
        duplicateField === "paymentIntegration.mpesaPaybills.shortCode"
      ) {
        return next(createError(400, "This M-Pesa Paybill is already assigned to another company."));
      }
    }

    next(err);
  }
};

export const getAllCompanies = async (req, res, next) => {
  try {
    if (!req.user.superAdminAccess) {
      return next(createError(403, "Only super admin can view all companies"));
    }

    const { page = 1, limit = 10, search } = req.query;
    const includeDemoCompanies = shouldIncludeDemoCompanies(req);

    const query = includeDemoCompanies ? {} : buildLiveCompanyFilter();
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { registrationNo: { $regex: search, $options: "i" } },
        { companyCode: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNo: { $regex: search, $options: "i" } },
      ];
    }

    const companies = await Company.find(query)
      .select(companySummarySelect)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .sort({ createdAt: -1 })
      .lean();

    const total = await Company.countDocuments(query);

    res.status(200).json({
      success: true,
      companies: companies.map((company) => serializeCompanyResponse(company, req.user)),
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        total,
      },
      message: "Companies retrieved successfully",
    });
  } catch (err) {
    console.error("Get companies error:", err);
    next(err);
  }
};

export const getAccessibleCompanies = async (req, res, next) => {
  try {
    const includeDemoCompanies = shouldIncludeDemoCompanies(req);
    const companyFilter = includeDemoCompanies ? {} : buildLiveCompanyFilter();

    if (req.user?.isSystemAdmin || req.user?.superAdminAccess) {
      const companies = await Company.find(companyFilter)
        .select(companySummarySelect)
        .sort({ companyName: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        companies: companies.map((company) => serializeCompanyResponse(company, req.user)),
        message: "Accessible companies retrieved successfully",
      });
    }

    const companyIds = Array.from(
      new Set(
        [
          req.user?.company,
          req.user?.primaryCompany,
          ...(Array.isArray(req.user?.accessibleCompanies) ? req.user.accessibleCompanies : []),
          ...(Array.isArray(req.user?.companyAssignments)
            ? req.user.companyAssignments.map((item) => item?.company)
            : []),
        ]
          .map((item) => normalizeCompanyId(item))
          .filter(Boolean)
      )
    );

    if (!companyIds.length) {
      return next(createError(403, "No company associated with user"));
    }

    const companies = await Company.find({ _id: { $in: companyIds }, ...companyFilter })
      .select(companySummarySelect)
      .sort({ companyName: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      companies: companies.map((company) => serializeCompanyResponse(company, req.user)),
      message: "Accessible companies retrieved successfully",
    });
  } catch (err) {
    console.error("Get accessible companies error:", err);
    next(err);
  }
};

export const getCompany = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return next(createError(404, "Company not found"));
    }

    if (!canAccessCompanyId(req.user, req.params.id)) {
      return next(createError(403, "You can only view your own company"));
    }

    res.status(200).json({
      success: true,
      company: serializeCompanyResponse(company, req.user),
      message: "Company retrieved successfully",
    });
  } catch (err) {
    console.error("Get company error:", err);
    next(err);
  }
};

export const updateCompany = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return next(createError(404, "Company not found"));
    }

    if (!canAccessCompanyId(req.user, req.params.id)) {
      return next(createError(403, "You can only edit your own company"));
    }

    const allowedFields = [
      "companyName",
      "registrationNo",
      "taxPIN",
      "taxExemptCode",
      "postalAddress",
      "country",
      "town",
      "roadStreet",
      "latitude",
      "longitude",
      "baseCurrency",
      "taxRegime",
      "fiscalStartMonth",
      "fiscalStartYear",
      "operationPeriodType",
      "businessOwner",
      "POBOX",
      "Street",
      "City",
      "unitTypes",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        company[field] = req.body[field];
      }
    });

    if (req.body.modules !== undefined) {
      company.modules = normalizeCompanyModules(req.body.modules);
    }

    const identityFields = normalizeCompanyIdentityFields(req.body);
    Object.entries(identityFields).forEach(([key, value]) => {
      if (key === "unitTypes") {
        if (req.body.unitTypes !== undefined) {
          company.unitTypes = value;
        }
        return;
      }

      if (req.body[key] !== undefined) {
        company[key] = value;
      }
    });

    if (req.body.paymentIntegration?.mpesaPaybills) {
      await applyMpesaPaybillMutation({
        company,
        payload: req.body.paymentIntegration.mpesaPaybills,
        actorUserId: req.user?.id || req.user?._id,
      });
    } else if (req.body.paymentIntegration?.mpesaPaybill) {
      await applyLegacySingleMpesaUpdate({
        company,
        payload: req.body.paymentIntegration.mpesaPaybill,
        actorUserId: req.user?.id || req.user?._id,
      });
    }

    if (req.body.communication?.emailProfiles) {
      applyEmailProfileMutation({
        company,
        payload: req.body.communication.emailProfiles,
        actorUserId: req.user?.id || req.user?._id,
      });
    }

    if (req.body.communication?.smsProfiles) {
      applySmsProfileMutation({
        company,
        payload: req.body.communication.smsProfiles,
        actorUserId: req.user?.id || req.user?._id,
      });
    }

    if (req.body.communication?.smsTemplates) {
      applySmsTemplateMutation({
        company,
        payload: req.body.communication.smsTemplates,
        actorUserId: req.user?.id || req.user?._id,
      });
    }

    if (req.body.companyName !== undefined && !req.body.companyCode) {
      company.companyCode = buildCompanyCode(req.body.companyName);
    }

    const updatedCompany = await company.save();

    res.status(200).json({
      success: true,
      company: serializeCompanyResponse(updatedCompany, req.user),
      message: "Company updated successfully",
    });
  } catch (err) {
    console.error("Update company error:", err);

    if (err?.code === 11000) {
      const duplicateField = Object.keys(err?.keyPattern || {})[0] || "";

      if (duplicateField === "registrationNo") {
        return next(createError(400, "A company with this registration number already exists"));
      }

      if (
        duplicateField === "paymentIntegration.mpesaPaybill.shortCode" ||
        duplicateField === "paymentIntegration.mpesaPaybills.shortCode"
      ) {
        return next(createError(400, "This M-Pesa Paybill is already assigned to another company."));
      }
    }

    next(err);
  }
};


export const testCompanyEmailProfile = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return next(createError(404, "Company not found"));
    }

    if (!canAccessCompanyId(req.user, req.params.id)) {
      return next(createError(403, "You can only access your own company email settings"));
    }

    const profileId = normalizeText(req.body?.profileId);
    const testRecipient = normalizeEmail(req.body?.toEmail || req.user?.email || company.email);

    validateEmailAddress(testRecipient, "Test email address");

    const profiles = getCompanyEmailProfiles(company);
    const selectedProfile = profileId
      ? profiles.find((profile) => String(profile?._id || "") === profileId)
      : getPrimaryEmailProfile(profiles, company.communication?.defaultEmailProfileId || null);

    if (!selectedProfile) {
      return next(createError(404, "Email profile not found for this company."));
    }

    const status = buildEmailProfileStatus({
      ...selectedProfile,
      hasPassword: Boolean(normalizeText(selectedProfile?.passwordEncrypted)),
    });

    if (!status.isConfigured) {
      return next(
        createError(
          400,
          "Complete the sender details, SMTP host, port, username and password before sending a test email."
        )
      );
    }

    const transporter = buildCompanySmtpTransporter(selectedProfile);
    await transporter.verify();

    const mailOptions = {
      from: resolveCompanyMailSender(selectedProfile),
      to: testRecipient,
      subject: `Milik email setup test - ${company.companyName}`,
      replyTo: selectedProfile.replyTo || undefined,
      text: [
        `Hello,`,
        "",
        `This is a MILIK test email for ${company.companyName}.`,
        `Profile: ${selectedProfile.name || selectedProfile.senderEmail}`,
        `SMTP Host: ${selectedProfile.smtpHost}`,
        `Sent at: ${new Date().toISOString()}`,
      ].join("\n"),
      html: `
        <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.6; max-width: 720px;">
          <h2 style="margin: 0 0 16px; color: #0B3B2E;">Milik email setup test</h2>
          <p>Hello,</p>
          <p>This is a successful MILIK test email for <strong>${company.companyName}</strong>.</p>
          <table cellpadding="8" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; max-width: 640px;">
            <tr><td style="font-weight: 700; width: 180px;">Profile</td><td>${selectedProfile.name || selectedProfile.senderEmail}</td></tr>
            <tr><td style="font-weight: 700;">Sender</td><td>${selectedProfile.senderName || selectedProfile.senderEmail}</td></tr>
            <tr><td style="font-weight: 700;">SMTP host</td><td>${selectedProfile.smtpHost}</td></tr>
          </table>
          <p style="margin-top: 18px; color: #475569; font-size: 14px;">If you received this email, the SMTP profile is working correctly.</p>
        </div>
      `,
      ...buildCompanyInternalCopyRecipients(selectedProfile),
    };

    await transporter.sendMail(mailOptions);

    const nextProfiles = profiles.map((profile) =>
      String(profile?._id || "") === String(selectedProfile?._id || "")
        ? {
            ...profile,
            lastTestStatus: "success",
            lastTestedAt: new Date(),
            lastTestMessage: `Test email sent successfully to ${testRecipient}`,
            lastSuccessfulSendAt: new Date(),
            lastUpdatedAt: profile?.lastUpdatedAt || new Date(),
            lastUpdatedBy: profile?.lastUpdatedBy || String(req.user?.id || req.user?._id || ""),
          }
        : profile
    );

    setCompanyEmailProfiles(company, nextProfiles, company.communication?.defaultEmailProfileId || null);
    const updatedCompany = await company.save();

    return res.status(200).json({
      success: true,
      company: serializeCompanyResponse(updatedCompany, req.user),
      message: `Test email sent successfully to ${testRecipient}`,
    });
  } catch (err) {
    try {
      const company = await Company.findById(req.params.id);
      if (company) {
        const profileId = normalizeText(req.body?.profileId);
        const profiles = getCompanyEmailProfiles(company);
        const nextProfiles = profiles.map((profile) =>
          String(profile?._id || "") === profileId
            ? {
                ...profile,
                lastTestStatus: "failed",
                lastTestedAt: new Date(),
                lastTestMessage: err?.message || "Email test failed",
              }
            : profile
        );
        setCompanyEmailProfiles(company, nextProfiles, company.communication?.defaultEmailProfileId || null);
        await company.save();
      }
    } catch (_ignored) {
      // Ignore metadata save errors and return the original failure.
    }

    console.error("Test company email profile error:", err);
    next(err);
  }
};

export const deleteCompany = async (req, res, next) => {
  try {
    if (!req.user.superAdminAccess) {
      return next(createError(403, "Only super admin can delete companies"));
    }

    const company = await Company.findById(req.params.id);

    if (!company) {
      return next(createError(404, "Company not found"));
    }

    const userCount = await User.countDocuments({ company: req.params.id });
    if (userCount > 0) {
      return next(createError(400, `Cannot delete company with ${userCount} associated users`));
    }

    await company.deleteOne();

    res.status(200).json({
      success: true,
      message: "Company deleted successfully",
    });
  } catch (err) {
    console.error("Delete company error:", err);
    next(err);
  }
};

export const getCompanyUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search } = req.query;

    if (!canAccessCompanyId(req.user, req.params.id)) {
      return next(createError(403, "You can only view your company's users"));
    }

    const query = { company: req.params.id };
    if (search) {
      query.$or = [
        { surname: { $regex: search, $options: "i" } },
        { otherNames: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(query)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .sort({ createdAt: -1 })
      .select("-password -resetPasswordToken -resetPasswordExpire");

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      users,
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        total,
      },
      message: "Users retrieved successfully",
    });
  } catch (err) {
    console.error("Get company users error:", err);
    next(err);
  }
};
