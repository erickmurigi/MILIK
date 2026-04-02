const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"];

const GROUP_BY_TYPE = {
  asset: "assets",
  liability: "liabilities",
  equity: "equity",
  income: "income",
  expense: "expenses",
};

const NORMAL_BALANCE_BY_TYPE = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
};

const SUBGROUP_OPTIONS_BY_TYPE = {
  asset: [
    "Cashbooks",
    "Bank Accounts",
    "Current Assets",
    "Fixed Assets",
    "Receivables",
    "Other Assets",
  ],
  liability: [
    "Current Liabilities",
    "Long-term Liabilities",
    "Payables",
    "Control Accounts",
    "Other Liabilities",
  ],
  equity: ["Equity", "Capital", "Retained Earnings", "Reserves", "Other Equity"],
  income: [
    "Operating Income",
    "Rental Income",
    "Commission Income",
    "Other Income",
  ],
  expense: [
    "Operating Expenses",
    "Administrative Expenses",
    "Property Expenses",
    "Finance Costs",
    "Other Expenses",
  ],
};

export const normalizeAccountType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  return ACCOUNT_TYPES.includes(normalized) ? normalized : "";
};

export const normalizeAccountGroup = (group = "", type = "") => {
  const normalizedType = normalizeAccountType(type);
  const normalizedGroup = String(group || "").trim().toLowerCase();

  if (["assets", "liabilities", "equity", "income", "expenses"].includes(normalizedGroup)) {
    return normalizedGroup;
  }

  return GROUP_BY_TYPE[normalizedType] || "assets";
};

export const getNormalBalanceSide = (type = "") => {
  const normalizedType = normalizeAccountType(type);
  return NORMAL_BALANCE_BY_TYPE[normalizedType] || "debit";
};

export const computeAccountBalance = ({ type, debit = 0, credit = 0 }) => {
  const normalizedType = normalizeAccountType(type);
  const debitAmount = Number(debit || 0);
  const creditAmount = Number(credit || 0);

  if (getNormalBalanceSide(normalizedType) === "debit") {
    return debitAmount - creditAmount;
  }

  return creditAmount - debitAmount;
};

export const entrySignedForAccount = (entry = {}, accountType = "") => {
  const amount =
    Number(entry?.amount ?? 0) ||
    Math.max(Number(entry?.debit || 0), Number(entry?.credit || 0), 0);

  const direction = String(entry?.direction || "").trim().toLowerCase();
  const normalSide = getNormalBalanceSide(accountType);

  if (normalSide === "debit") {
    return direction === "debit" ? amount : -amount;
  }

  return direction === "credit" ? amount : -amount;
};

export const getSubGroupOptionsForType = (type = "") => {
  const normalizedType = normalizeAccountType(type);
  return SUBGROUP_OPTIONS_BY_TYPE[normalizedType] || [];
};

export const enrichAccountClassification = (account = {}) => {
  const type = normalizeAccountType(account.type);
  const group = normalizeAccountGroup(account.group, type);

  return {
    ...account,
    type,
    group,
    normalBalanceSide: getNormalBalanceSide(type),
    accountClass: String(account.subGroup || "").trim() || "",
  };
};

export default {
  normalizeAccountType,
  normalizeAccountGroup,
  getNormalBalanceSide,
  computeAccountBalance,
  entrySignedForAccount,
  getSubGroupOptionsForType,
  enrichAccountClassification,
};