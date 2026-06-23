// Canonical account classifiers — single source of truth for both dashboard and financial reports.

const normalizeAcc = (account = {}) => ({
  code:     String(account.code     || "").trim(),
  name:     String(account.name     || "").trim().toLowerCase(),
  subGroup: String(account.subGroup || "").trim().toLowerCase(),
});

// ─── PMS dashboard classifiers (whitelist) ────────────────────────────────────
// Used by propertyController/dashboard.js to show only property-manager-earned
// revenue and operating costs — excludes landlord pass-through AND non-PMS modules.

export const isManagerIncomeAccount = (account = {}) => {
  const { code, name, subGroup } = normalizeAcc(account);

  if (["4200", "4210", "4103"].includes(code)) return true;
  if (name.includes("management fee") || name.includes("commission income")) return true;
  if (name.includes("late fee") || name.includes("penalty")) return true;
  if (name.includes("lease agreement fee") || name.includes("letting fee") || name.includes("agreement fee")) return true;
  if (subGroup === "other income" && !name.includes("property income")) return true;

  if (["4100", "4101", "4102", "4300"].includes(code)) return false;
  if (name.includes("rent income")) return false;
  if (name.includes("service charge income")) return false;
  if (name.includes("utility recharge income")) return false;
  if (name.includes("other property income")) return false;

  return false;
};

export const isManagerExpenseAccount = (account = {}) => {
  const { code, name, subGroup } = normalizeAcc(account);

  if (["5200", "5201", "5202"].includes(code)) return true;
  if (subGroup === "administrative expenses" || subGroup === "finance costs") return true;
  if (name.includes("management expense") || name.includes("bank charges")) return true;
  if (name.includes("legal") || name.includes("compliance")) return true;
  if (
    name.includes("salary") ||
    name.includes("wage") ||
    name.includes("office") ||
    name.includes("internet") ||
    name.includes("software") ||
    name.includes("subscription") ||
    name.includes("marketing") ||
    name.includes("transport") ||
    name.includes("fuel")
  ) return true;
  if (name.includes("staff welfare") || name.includes("welfare")) return true;
  if (name.includes("miscellaneous")) return true;
  if (name.includes("stationery") || name.includes("stationary")) return true;
  if (name.includes("cleaning supplies")) return true;
  if (name.includes("petty cash")) return true;
  if (name.includes("postage") || name.includes("courier")) return true;
  if (name.includes("staff training") || name.includes("training")) return true;
  if (name.includes("tea") || name.includes("refreshment") || name.includes("catering")) return true;

  if (["5100", "5101", "5102", "5103", "5104"].includes(code)) return false;
  if (subGroup === "property expenses") return false;
  if (name.includes("maintenance expense")) return false;
  if (name.includes("repairs expense")) return false;
  if (name.includes("cleaning expense")) return false;
  if (name.includes("security expense")) return false;
  if (name.includes("utility expense")) return false;

  return false;
};

// ─── Company-wide P&L classifiers (blacklist) ────────────────────────────────
// Used by financialReports.js income statement — includes ALL modules' income and
// expenses. Only excludes landlord/property pass-through accounts that belong to
// landlords, not the company. Works for Car Wash, HR, Inventory, PMS, and any
// future module without per-module whitelist updates.

const LANDLORD_INCOME_CODES  = ["4100", "4101", "4102", "4300"];
const LANDLORD_INCOME_NAMES  = ["rent income", "service charge income", "utility recharge income", "other property income"];
const LANDLORD_EXPENSE_CODES = ["5100", "5101", "5102", "5103", "5104"];
const LANDLORD_EXPENSE_NAMES = ["maintenance expense", "repairs expense", "cleaning expense", "security expense", "utility expense"];

export const isOperatingIncomeAccount = (account = {}) => {
  const { code, name, subGroup } = normalizeAcc(account);
  if (LANDLORD_INCOME_CODES.includes(code)) return false;
  if (LANDLORD_INCOME_NAMES.some((n) => name.includes(n))) return false;
  if (subGroup === "property income" || subGroup === "rental income") return false;
  return true;
};

export const isOperatingExpenseAccount = (account = {}) => {
  const { code, name, subGroup } = normalizeAcc(account);
  if (LANDLORD_EXPENSE_CODES.includes(code)) return false;
  if (subGroup === "property expenses") return false;
  if (LANDLORD_EXPENSE_NAMES.some((n) => name.includes(n))) return false;
  return true;
};

// ─── Self-managing landlord P&L classifiers ──────────────────────────────────
// Used when companyMode === 'self_managing_landlord'.
// Rent income IS their revenue; maintenance/repairs ARE their expenses.
// Commission / management-fee accounts are excluded — they manage themselves.

export const isSelfManagingLandlordIncomeAccount = (account = {}) => {
  const { code, name, subGroup } = normalizeAcc(account);
  // Exclude commission and management-fee lines — not applicable for self-managers
  if (["4200", "4210"].includes(code)) return false;
  if (name.includes("commission income") || name.includes("management fee")) return false;
  // All property / rental income is the landlord's own revenue
  if (LANDLORD_INCOME_CODES.includes(code)) return true;
  if (LANDLORD_INCOME_NAMES.some((n) => name.includes(n))) return true;
  if (subGroup === "property income" || subGroup === "rental income") return true;
  // Penalty / late-fee income
  if (code === "4103" || name.includes("late fee") || name.includes("penalty")) return true;
  return false;
};

export const isSelfManagingLandlordExpenseAccount = (account = {}) => {
  const { code, name, subGroup } = normalizeAcc(account);
  // All direct property expenses — the landlord bears these themselves
  if (LANDLORD_EXPENSE_CODES.includes(code)) return true;
  if (subGroup === "property expenses") return true;
  if (LANDLORD_EXPENSE_NAMES.some((n) => name.includes(n))) return true;
  // General admin / finance costs also belong on the landlord's P&L
  if (["5200", "5201", "5202"].includes(code)) return true;
  if (subGroup === "administrative expenses" || subGroup === "finance costs") return true;
  if (name.includes("bank charge") || name.includes("insurance") || name.includes("legal") || name.includes("compliance")) return true;
  if (name.includes("mortgage") || name.includes("loan interest")) return true;
  return false;
};
