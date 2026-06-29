import mongoose from "mongoose";
import ChartOfAccount from "../models/ChartOfAccount.js";
import Company from "../models/Company.js";

const SYSTEM_CHART_TEMPLATE = [
  { code: "1100", name: "Cash on Hand", type: "asset", group: "assets", subGroup: "Cashbooks", isSystem: true, isHeader: false, isPosting: true },
  { code: "1110", name: "Bank Accounts", type: "asset", group: "assets", subGroup: "Cashbooks", isSystem: true, isHeader: false, isPosting: true },
  { code: "1130", name: "M-Pesa Collections", type: "asset", group: "assets", subGroup: "Cashbooks", isSystem: true, isHeader: false, isPosting: true },
  { code: "1200", name: "Tenant Receivables", type: "asset", group: "assets", subGroup: "Current Assets", isSystem: true, isHeader: false, isPosting: true },
  { code: "1210", name: "Landlord Advances Recoverable", type: "asset", group: "assets", subGroup: "Current Assets", isSystem: true, isHeader: false, isPosting: true },
  { code: "1220", name: "Utility Recoverables", type: "asset", group: "assets", subGroup: "Current Assets", isSystem: true, isHeader: false, isPosting: true },
  { code: "1230", name: "Deposit Held", type: "asset", group: "assets", subGroup: "Current Assets", isSystem: true, isHeader: false, isPosting: true },

  { code: "2100", name: "Tenant Deposit Payable", type: "liability", group: "liabilities", subGroup: "Current Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2110", name: "Landlord Remittance Payable", type: "liability", group: "liabilities", subGroup: "Current Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2120", name: "Accrued Expenses", type: "liability", group: "liabilities", subGroup: "Current Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2130", name: "Unallocated Receipts", type: "liability", group: "liabilities", subGroup: "Current Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2140", name: "Tax Payables", type: "liability", group: "liabilities", subGroup: "Current Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2141", name: "Withholding Tax Payable", type: "liability", group: "liabilities", subGroup: "Current Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2150", name: "Landlord Funds Held", type: "liability", group: "liabilities", subGroup: "Current Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2160", name: "Car Wash Staff Commissions Payable", type: "liability", group: "liabilities", subGroup: "Car Wash Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2161", name: "Car Wash Staff Savings Payable",     type: "liability", group: "liabilities", subGroup: "Car Wash Liabilities", isSystem: true, isHeader: false, isPosting: true },

  { code: "3100", name: "Owner's Equity", type: "equity", group: "equity", subGroup: "Equity", isSystem: true, isHeader: false, isPosting: true },
  { code: "3200", name: "Retained Earnings", type: "equity", group: "equity", subGroup: "Equity", isSystem: true, isHeader: false, isPosting: true },

  { code: "4100", name: "Rent Income", type: "income", group: "income", subGroup: "Operating Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4101", name: "Service Charge Income", type: "income", group: "income", subGroup: "Operating Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4102", name: "Utility Recharge Income", type: "income", group: "income", subGroup: "Operating Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4103", name: "Penalty / Late Fee Income", type: "income", group: "income", subGroup: "Operating Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4200", name: "Management Fee Income", type: "income", group: "income", subGroup: "Operating Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4210", name: "Commission Income", type: "income", group: "income", subGroup: "Operating Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4300", name: "Other Property Income", type: "income", group: "income", subGroup: "Other Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4301", name: "Advancement Interest Income", type: "income", group: "income", subGroup: "Other Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4400", name: "Car Wash Service Income", type: "income", group: "income", subGroup: "Car Wash Income", isSystem: true, isHeader: false, isPosting: true },

  { code: "5100", name: "Maintenance Expense", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5101", name: "Repairs Expense", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5102", name: "Cleaning Expense", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5103", name: "Security Expense", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5104", name: "Utility Expense", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5200", name: "Management Expense", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5201", name: "Bank Charges", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5202", name: "Legal / Compliance Expense", type: "expense", group: "expenses", subGroup: "Operating Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5310", name: "Car Wash Supplies Expense", type: "expense", group: "expenses", subGroup: "Car Wash Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5311", name: "Car Wash Staff Wages", type: "expense", group: "expenses", subGroup: "Car Wash Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5312", name: "Car Wash Water and Utilities", type: "expense", group: "expenses", subGroup: "Car Wash Expenses", isSystem: true, isHeader: false, isPosting: true },

  // Property Sale accounts
  { code: "1240", name: "Sale Deposits Receivable", type: "asset", group: "assets", subGroup: "Sale Receivables", isSystem: true, isHeader: false, isPosting: true },
  { code: "1250", name: "Sale Installments Receivable", type: "asset", group: "assets", subGroup: "Sale Receivables", isSystem: true, isHeader: false, isPosting: true },
  { code: "2180", name: "Agent Commissions Payable", type: "liability", group: "liabilities", subGroup: "Sale Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2181", name: "Sale Buyer Deposits Held", type: "liability", group: "liabilities", subGroup: "Sale Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "4500", name: "Property Sale Commission Income", type: "income", group: "income", subGroup: "Sale Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "4510", name: "Sale Listing Fee Income", type: "income", group: "income", subGroup: "Sale Income", isSystem: true, isHeader: false, isPosting: true },
  { code: "5500", name: "Agent Commission Expense", type: "expense", group: "expenses", subGroup: "Sale Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5501", name: "Sale Marketing Expense", type: "expense", group: "expenses", subGroup: "Sale Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5502", name: "Legal & Conveyancing Expense", type: "expense", group: "expenses", subGroup: "Sale Expenses", isSystem: true, isHeader: false, isPosting: true },

  // HR / Payroll accounts
  { code: "2170", name: "PAYE Tax Payable", type: "liability", group: "liabilities", subGroup: "HR & Payroll Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2171", name: "NHIF Contributions Payable", type: "liability", group: "liabilities", subGroup: "HR & Payroll Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2172", name: "NSSF Contributions Payable", type: "liability", group: "liabilities", subGroup: "HR & Payroll Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2173", name: "AHL Levy Payable", type: "liability", group: "liabilities", subGroup: "HR & Payroll Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2174", name: "Other Payroll Deductions Payable", type: "liability", group: "liabilities", subGroup: "HR & Payroll Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "2175", name: "Net Salaries Payable", type: "liability", group: "liabilities", subGroup: "HR & Payroll Liabilities", isSystem: true, isHeader: false, isPosting: true },
  { code: "5400", name: "Salaries and Wages Expense", type: "expense", group: "expenses", subGroup: "HR & Payroll Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5401", name: "Employer NHIF Contribution", type: "expense", group: "expenses", subGroup: "HR & Payroll Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5402", name: "Employer NSSF Contribution", type: "expense", group: "expenses", subGroup: "HR & Payroll Expenses", isSystem: true, isHeader: false, isPosting: true },
  { code: "5403", name: "Employer AHL Levy", type: "expense", group: "expenses", subGroup: "HR & Payroll Expenses", isSystem: true, isHeader: false, isPosting: true },
];

const SYSTEM_CHART_CODES = SYSTEM_CHART_TEMPLATE.map((account) => account.code);
const ensureCache = new Map();
const ENSURE_CACHE_TTL_MS = 5 * 60 * 1000;
const VALID_MODULE_SCOPES = new Set(["general", "propertyManagement", "carwash", "hr", "propertySale", "inventory"]);
const CARWASH_ACCOUNT_CODES = new Set(["2160", "2161", "4400", "5310", "5311", "5312"]);
const SHARED_CASHBOOK_CODES = new Set(["1100", "1110", "1130"]);
const HR_ACCOUNT_CODES = new Set(["2170", "2171", "2172", "2173", "2174", "2175", "5400", "5401", "5402", "5403"]);
const SALE_ACCOUNT_CODES = new Set(["1240", "1250", "2180", "2181", "4500", "4510", "5500", "5501", "5502"]);

const moduleScopesForAccount = (account = {}) => {
  const code = String(account.code || "").trim().toUpperCase();
  const name = String(account.name || "").toLowerCase();
  const subGroup = String(account.subGroup || "").toLowerCase();

  if (SHARED_CASHBOOK_CODES.has(code)) return ["propertyManagement", "carwash", "propertySale", "hr"];
  if (CARWASH_ACCOUNT_CODES.has(code) || name.includes("car wash") || subGroup.includes("car wash")) return ["carwash"];
  if (HR_ACCOUNT_CODES.has(code) || subGroup.includes("hr & payroll") || name.includes("payroll") || name.includes("paye") || name.includes("nhif") || name.includes("nssf") || name.includes("ahl levy")) return ["hr"];
  if (SALE_ACCOUNT_CODES.has(code) || subGroup.includes("sale ")) return ["propertySale"];
  if (["3100", "3200"].includes(code)) return ["general"];
  return ["propertyManagement"];
};

const normalizeModuleScopes = (value = []) => {
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => String(item || "").trim()).filter((item) => VALID_MODULE_SCOPES.has(item)))];
};

const getActiveModuleScopes = (modules = {}) => {
  const scopes = new Set(["general"]);
  if (modules.propertyManagement) scopes.add("propertyManagement");
  if (modules.carwash)            scopes.add("carwash");
  if (modules.hr)                 scopes.add("hr");
  if (modules.propertySale)       scopes.add("propertySale");
  return [...scopes];
};

const getCompanyActiveScopes = async (businessId) => {
  const company = await Company.findById(businessId).select("modules").lean();
  if (!company) return ["general", "propertyManagement"];
  return getActiveModuleScopes(company.modules || {});
};

const normalizeBusinessId = (businessId) => {
  const raw = typeof businessId === "object" && businessId?._id ? businessId._id : businessId;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return null;
  return new mongoose.Types.ObjectId(String(raw));
};

const normalizeGroup = (group, type) => {
  const value = String(group || "").trim().toLowerCase();
  if (["assets", "liabilities", "equity", "income", "expenses"].includes(value)) return value;

  const byType = String(type || "").trim().toLowerCase();
  if (byType === "asset") return "assets";
  if (byType === "liability") return "liabilities";
  if (byType === "equity") return "equity";
  if (byType === "income") return "income";
  if (byType === "expense") return "expenses";
  return "assets";
};

export const ensureSystemChartOfAccounts = async (businessId, options = {}) => {
  const normalizedBusinessId = normalizeBusinessId(businessId);
  if (!normalizedBusinessId) {
    throw new Error("A valid business id is required to initialize chart of accounts.");
  }

  const cacheKey = String(normalizedBusinessId);
  const cachedAt = ensureCache.get(cacheKey);
  if (!options.force && cachedAt && Date.now() - cachedAt < ENSURE_CACHE_TTL_MS) {
    return;
  }

  const activeScopes = await getCompanyActiveScopes(normalizedBusinessId);
  const relevantAccounts = SYSTEM_CHART_TEMPLATE.filter((account) =>
    moduleScopesForAccount(account).some((s) => activeScopes.includes(s))
  );

  const ops = relevantAccounts.map((account) => ({
    updateOne: {
      filter: { business: normalizedBusinessId, code: account.code },
      update: {
        $set: {
          moduleScopes: normalizeModuleScopes(account.moduleScopes || moduleScopesForAccount(account)),
        },
        $setOnInsert: {
          business: normalizedBusinessId,
          code: account.code,
          name: account.name,
          type: account.type,
          group: account.group,
          subGroup: account.subGroup || "",
          isSystem: true,
          isHeader: Boolean(account.isHeader),
          isPosting: account.isHeader ? false : Boolean(account.isPosting),
          level: 0,
          parentAccount: null,
          balance: 0,
        },
      },
      upsert: true,
    },
  }));

  if (ops.length > 0) {
    await ChartOfAccount.bulkWrite(ops, { ordered: false });
  }

  ensureCache.set(cacheKey, Date.now());

  // Return void - the return value was not used by any callers
  // Previously this returned all accounts which was wasteful on every invoice save
  return;
};

export const findChartOfAccounts = async ({
  businessId,
  code = null,
  type = null,
  group = null,
  search = null,
  moduleScope = null,
}) => {
  const normalizedBusinessId = normalizeBusinessId(businessId);
  if (!normalizedBusinessId) {
    throw new Error("A valid business id is required to fetch chart of accounts.");
  }

  const scopes = moduleScope
    ? normalizeModuleScopes(moduleScope)
    : await getCompanyActiveScopes(normalizedBusinessId);
  await ensureSystemChartOfAccounts(normalizedBusinessId, { force: scopes.includes("carwash") || scopes.includes("hr") });

  const query = { business: normalizedBusinessId };

  if (code) query.code = String(code).trim().toUpperCase();
  if (type) query.type = String(type).trim().toLowerCase();
  if (group) query.group = normalizeGroup(group, type);

  if (scopes.length) {
    const scopedMatch = { moduleScopes: { $in: scopes } };
    if (scopes.includes("carwash")) {
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            scopedMatch,
            { subGroup: { $regex: "car wash|cashbook", $options: "i" } },
            { name: { $regex: "car wash", $options: "i" } },
          ],
        },
      ];
    } else if (scopes.includes("hr")) {
      query.$and = [
        ...(query.$and || []),
        {
          $or: [
            scopedMatch,
            { subGroup: { $regex: "hr.*payroll|payroll.*hr", $options: "i" } },
          ],
        },
      ];
    } else {
      query.moduleScopes = { $in: scopes };
    }
  }

  if (search) {
    const pattern = String(search).trim();
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { code: { $regex: pattern, $options: "i" } },
          { name: { $regex: pattern, $options: "i" } },
          { subGroup: { $regex: pattern, $options: "i" } },
        ],
      },
    ];
  }

  return ChartOfAccount.find(query)
    .sort({ group: 1, subGroup: 1, code: 1 })
    .populate("parentAccount", "code name")
    .lean();
};

export const normalizeChartAccountPayload = (payload = {}) => {
  const normalizedType = String(payload.type || "").trim().toLowerCase();
  const normalizedGroup = normalizeGroup(payload.group, normalizedType);

  return {
    code: String(payload.code || "").trim().toUpperCase(),
    name: String(payload.name || "").trim(),
    type: normalizedType,
    group: normalizedGroup,
    subGroup: String(payload.subGroup || "").trim(),
    isHeader: Boolean(payload.isHeader),
    isPosting: payload.isHeader ? false : Boolean(payload.isPosting !== false),
    parentAccount: payload.parentAccount || null,
    moduleScopes: Object.prototype.hasOwnProperty.call(payload, "moduleScopes")
      ? normalizeModuleScopes(payload.moduleScopes)
      : undefined,
  };
};

export const findSystemAccountByCode = async (businessId, code) => {
  const normalizedBusinessId = normalizeBusinessId(businessId);
  if (!normalizedBusinessId) {
    throw new Error("A valid business id is required to resolve a system account.");
  }

  await ensureSystemChartOfAccounts(normalizedBusinessId);

  return ChartOfAccount.findOne({
    business: normalizedBusinessId,
    code: String(code || "").trim().toUpperCase(),
  });
};

export default {
  ensureSystemChartOfAccounts,
  findChartOfAccounts,
  normalizeChartAccountPayload,
  findSystemAccountByCode,
};
