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

const HR_ACCOUNTING_DEFAULT_KEYS = {
  salaryExpenseAccount: {
    label: "Salaries & Wages Expense Account",
    allowedTypes: ["expense"],
    fallbackCandidates: [
      { code: "5400", type: "expense" },
      { nameRegex: "^salaries and wages expense$", type: "expense" },
      { nameRegex: "salary|salaries|wages", type: "expense" },
    ],
  },
  netPayableAccount: {
    label: "Net Salaries Payable Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2175", type: "liability" },
      { nameRegex: "^net salaries payable$", type: "liability" },
      { nameRegex: "net salary|net salaries", type: "liability" },
    ],
  },
  payePayableAccount: {
    label: "PAYE Tax Payable Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2170", type: "liability" },
      { nameRegex: "^paye tax payable$", type: "liability" },
      { nameRegex: "paye", type: "liability" },
    ],
  },
  nhifPayableAccount: {
    label: "NHIF Contributions Payable Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2171", type: "liability" },
      { nameRegex: "^nhif contributions payable$", type: "liability" },
      { nameRegex: "nhif", type: "liability" },
    ],
  },
  nssfPayableAccount: {
    label: "NSSF Contributions Payable Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2172", type: "liability" },
      { nameRegex: "^nssf contributions payable$", type: "liability" },
      { nameRegex: "nssf", type: "liability" },
    ],
  },
  ahlPayableAccount: {
    label: "AHL Levy Payable Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2173", type: "liability" },
      { nameRegex: "^ahl levy payable$", type: "liability" },
      { nameRegex: "ahl", type: "liability" },
    ],
  },
  otherDeductionsPayableAccount: {
    label: "Other Payroll Deductions Payable Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2174", type: "liability" },
      { nameRegex: "other payroll deductions", type: "liability" },
    ],
  },
  employerNhifExpenseAccount: {
    label: "Employer NHIF Contribution Expense Account",
    allowedTypes: ["expense"],
    fallbackCandidates: [
      { code: "5401", type: "expense" },
      { nameRegex: "employer nhif", type: "expense" },
    ],
  },
  employerNssfExpenseAccount: {
    label: "Employer NSSF Contribution Expense Account",
    allowedTypes: ["expense"],
    fallbackCandidates: [
      { code: "5402", type: "expense" },
      { nameRegex: "employer nssf", type: "expense" },
    ],
  },
  employerAhlExpenseAccount: {
    label: "Employer AHL Levy Expense Account",
    allowedTypes: ["expense"],
    fallbackCandidates: [
      { code: "5403", type: "expense" },
      { nameRegex: "employer ahl", type: "expense" },
    ],
  },
};

const INV_ACCOUNTING_DEFAULT_KEYS = {
  inventoryAssetAccount: {
    label: "Inventory Asset (Stock on Hand) Account",
    allowedTypes: ["asset"],
    fallbackCandidates: [
      { code: "1300", type: "asset" },
      { nameRegex: "^inventory$", type: "asset" },
      { nameRegex: "stock on hand", type: "asset" },
      { nameRegex: "inventory asset", type: "asset" },
    ],
  },
  cogsAccount: {
    label: "Cost of Goods Sold (COGS) Account",
    allowedTypes: ["expense"],
    fallbackCandidates: [
      { code: "5000", type: "expense" },
      { nameRegex: "cost of goods sold", type: "expense" },
      { nameRegex: "^cogs$", type: "expense" },
    ],
  },
  salesRevenueAccount: {
    label: "Sales Revenue / POS Revenue Account",
    allowedTypes: ["income"],
    fallbackCandidates: [
      { code: "4000", type: "income" },
      { nameRegex: "sales revenue", type: "income" },
      { nameRegex: "^sales$", type: "income" },
    ],
  },
  stockAdjustmentAccount: {
    label: "Stock Adjustments & Write-offs Account",
    allowedTypes: ["expense"],
    fallbackCandidates: [
      { nameRegex: "stock adjustment", type: "expense" },
      { nameRegex: "inventory write", type: "expense" },
    ],
  },
  purchaseClearingAccount: {
    label: "Purchase Clearing / Accounts Payable Account",
    allowedTypes: ["liability"],
    fallbackCandidates: [
      { code: "2000", type: "liability" },
      { nameRegex: "accounts payable", type: "liability" },
      { nameRegex: "trade creditors", type: "liability" },
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
  if (!candidates.length) return null;
  // Run all candidate queries in parallel; return the first (highest-priority) hit.
  const results = await Promise.all(
    candidates.map((c) =>
      ChartOfAccount.findOne(buildCandidateQuery(businessId, c)).lean().catch(() => null)
    )
  );
  return results.find(Boolean) ?? null;
};

const getConfiguredAccountId = async (businessId, field) => {
  const settings = await CompanySettings.findOne({ company: businessId })
    .select(`accountingDefaults.${field}`)
    .lean();

  return settings?.accountingDefaults?.[field] || null;
};

export const getAccountingDefaultDefinition = (field) => ACCOUNTING_DEFAULT_KEYS[field] || null;

export const getHrAccountingDefaultDefinition = (field) => HR_ACCOUNTING_DEFAULT_KEYS[field] || null;

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

const validateAccountingDefaultAccountForDefinition = async ({ businessId, field, rawValue, definition }) => {
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

export const validateAccountingDefaultAccount = async ({ businessId, field, rawValue }) => {
  const definition = getAccountingDefaultDefinition(field);
  return validateAccountingDefaultAccountForDefinition({ businessId, field, rawValue, definition });
};

export const validateHrAccountingDefaultAccount = async ({ businessId, field, rawValue }) => {
  const definition = getHrAccountingDefaultDefinition(field);
  return validateAccountingDefaultAccountForDefinition({ businessId, field, rawValue, definition });
};

export const getInvAccountingDefaultDefinition = (field) => INV_ACCOUNTING_DEFAULT_KEYS[field] || null;

export const validateInvAccountingDefaultAccount = async ({ businessId, field, rawValue }) => {
  const definition = getInvAccountingDefaultDefinition(field);
  return validateAccountingDefaultAccountForDefinition({ businessId, field, rawValue, definition });
};

export const resolveConfiguredInvAccountingDefaultAccount = async ({ businessId, field, fallbackCandidates = null } = {}) => {
  if (!businessId || !field) return null;

  const definition = getInvAccountingDefaultDefinition(field);
  if (!definition) return null;

  await ensureSystemChartOfAccounts(businessId);

  const settings = await CompanySettings.findOne({ company: businessId })
    .select(`inventoryAccountingDefaults.${field}`)
    .lean();

  const configuredAccountId = settings?.inventoryAccountingDefaults?.[field] || null;
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

export const resolveConfiguredHrAccountingDefaultAccount = async ({ businessId, field, fallbackCandidates = null } = {}) => {
  if (!businessId || !field) return null;

  const definition = getHrAccountingDefaultDefinition(field);
  if (!definition) return null;

  await ensureSystemChartOfAccounts(businessId);

  const settings = await CompanySettings.findOne({ company: businessId })
    .select(`hrAccountingDefaults.${field}`)
    .lean();

  const configuredAccountId = settings?.hrAccountingDefaults?.[field] || null;
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

export default {
  getAccountingDefaultDefinition,
  getHrAccountingDefaultDefinition,
  getInvAccountingDefaultDefinition,
  resolveConfiguredAccountingDefaultAccount,
  resolveConfiguredHrAccountingDefaultAccount,
  resolveConfiguredInvAccountingDefaultAccount,
  validateAccountingDefaultAccount,
  validateHrAccountingDefaultAccount,
  validateInvAccountingDefaultAccount,
};
