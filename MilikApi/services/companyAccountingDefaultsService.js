import ChartOfAccount from "../models/ChartOfAccount.js";
import CompanySettings from "../models/CompanySettings.js";
import { ensureSystemChartOfAccounts } from "./chartOfAccountsService.js";

const ACCOUNTING_DEFAULT_KEYS = {
  tenantReceivableAccount: {
    label: "Tenant Receivable Account",
    allowedTypes: ["asset"],
    fallbackCandidates: [
      { code: "1200", type: "asset" },
      { nameRegex: "^tenant receivable", type: "asset" },
      { nameRegex: "accounts receivable", type: "asset" },
      { nameRegex: "receivable", type: "asset" },
    ],
  },
  rentIncomeAccount: {
    label: "Rent Income Account",
    allowedTypes: ["income"],
    fallbackCandidates: [
      { code: "4100", type: "income" },
      { nameRegex: "^rent income$", type: "income" },
      { nameRegex: "^rental income$", type: "income" },
      { nameRegex: "rent", type: "income" },
    ],
  },
  utilityRechargeIncomeAccount: {
    label: "Utility Recharge Income Account",
    allowedTypes: ["income"],
    fallbackCandidates: [
      { code: "4102", type: "income" },
      { nameRegex: "^utility recharge income$", type: "income" },
      { nameRegex: "^utility income$", type: "income" },
      { nameRegex: "utility", type: "income" },
    ],
  },
  penaltyIncomeAccount: {
    label: "Penalty Income Account",
    allowedTypes: ["income"],
    fallbackCandidates: [
      { nameRegex: "late penalty", type: "income" },
      { nameRegex: "late fee", type: "income" },
      { nameRegex: "penalty income", type: "income" },
      { nameRegex: "other income", type: "income" },
    ],
  },
  depositLiabilityAccount: {
    label: "Deposit Liability Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2100", type: "liability" },
      { nameRegex: "^tenant deposit payable$", type: "liability" },
      { nameRegex: "^security deposits payable$", type: "liability" },
      { nameRegex: "tenant deposit", type: "liability" },
      { nameRegex: "security deposit", type: "liability" },
      { nameRegex: "deposit liability", type: "liability" },
    ],
  },
  managementCommissionIncomeAccount: {
    label: "Management Commission Income Account",
    allowedTypes: ["income"],
    fallbackCandidates: [
      { code: "4210", type: "income" },
      { nameRegex: "^commission income$", type: "income" },
      { nameRegex: "management fee income", type: "income" },
      { nameRegex: "commission", type: "income" },
    ],
  },
  leaseAgreementFeeIncomeAccount: {
    label: "Lease / Agreement Fee Income Account",
    allowedTypes: ["income"],
    fallbackCandidates: [
      { code: "4101", type: "income" },
      { code: "4300", type: "income" },
      { nameRegex: "lease agreement", type: "income" },
      { nameRegex: "agreement fee", type: "income" },
      { nameRegex: "lease fee", type: "income" },
      { nameRegex: "^service charge income$", type: "income" },
      { nameRegex: "service charge", type: "income" },
      { nameRegex: "service income", type: "income" },
      { nameRegex: "^other property income$", type: "income" },
      { nameRegex: "other property income", type: "income" },
      { nameRegex: "other income", type: "income" },
    ],
  },
};

const normalizeType = (value = "") => String(value || "").trim().toLowerCase();

const buildCandidateQuery = (businessId, candidate = {}) => {
  const query = {
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
  };

  const and = [];
  if (candidate._id) query._id = candidate._id;
  if (candidate.type) and.push({ type: candidate.type });
  if (candidate.code) and.push({ code: candidate.code });
  if (candidate.group) and.push({ group: candidate.group });
  if (candidate.nameRegex) and.push({ name: { $regex: candidate.nameRegex, $options: "i" } });
  if (and.length > 0) query.$and = and;

  return query;
};

const findFirstAccount = async (businessId, candidates = []) => {
  for (const candidate of candidates) {
    const account = await ChartOfAccount.findOne(buildCandidateQuery(businessId, candidate)).lean();
    if (account) return account;
  }
  return null;
};

const getConfiguredAccountId = async (businessId, field) => {
  const settings = await CompanySettings.findOne({ company: businessId })
    .select(`accountingDefaults.${field}`)
    .lean();

  return settings?.accountingDefaults?.[field] || null;
};

export const getAccountingDefaultDefinition = (field) => ACCOUNTING_DEFAULT_KEYS[field] || null;

export const resolveConfiguredAccountingDefaultAccount = async ({ businessId, field, fallbackCandidates = null } = {}) => {
  if (!businessId || !field) return null;

  const definition = getAccountingDefaultDefinition(field);
  if (!definition) return null;

  await ensureSystemChartOfAccounts(businessId);

  const configuredAccountId = await getConfiguredAccountId(businessId, field);
  if (configuredAccountId) {
    const query = {
      business: businessId,
      _id: configuredAccountId,
      isPosting: { $ne: false },
      isHeader: { $ne: true },
    };

    if (Array.isArray(definition.allowedTypes) && definition.allowedTypes.length > 0) {
      query.type = definition.allowedTypes.length === 1 ? definition.allowedTypes[0] : { $in: definition.allowedTypes };
    }

    const configuredAccount = await ChartOfAccount.findOne(query).lean();
    if (configuredAccount) return configuredAccount;
  }

  return findFirstAccount(businessId, fallbackCandidates || definition.fallbackCandidates || []);
};

export const validateAccountingDefaultAccount = async ({ businessId, field, rawValue }) => {
  const definition = getAccountingDefaultDefinition(field);
  if (!definition) {
    throw new Error(`Unknown accounting default field: ${field}`);
  }

  const normalized = String(rawValue || "").trim();
  if (!normalized) return null;

  const query = {
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
  };

  if (Array.isArray(definition.allowedTypes) && definition.allowedTypes.length > 0) {
    query.type = definition.allowedTypes.length === 1 ? definition.allowedTypes[0] : { $in: definition.allowedTypes.map(normalizeType) };
  }

  if (/^[a-f\d]{24}$/i.test(normalized)) {
    query._id = normalized;
  } else {
    query.code = normalized;
  }

  const account = await ChartOfAccount.findOne(query).select("_id code name type").lean();

  if (!account) {
    throw new Error(`${definition.label} selection is invalid or no longer available for this company.`);
  }

  return account;
};

export default {
  getAccountingDefaultDefinition,
  resolveConfiguredAccountingDefaultAccount,
  validateAccountingDefaultAccount,
};
