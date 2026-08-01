export function getCashbookAccounts(accounts) {
  return accounts.filter(
    (acc) =>
      acc.accountType === "Asset" &&
      (acc.accountSubType === "Cash" || acc.accountSubType === "Bank")
  );
}

export const CASHBOOK_PATTERN = /cash|bank|m-?pesa|mobile money|wallet|petty|till|collection/i;

export const isCashbookAccount = (a) =>
  Boolean(a) &&
  String(a?.type || "").toLowerCase() === "asset" &&
  !a.isHeader &&
  a.isPosting !== false &&
  !a.isControl &&
  CASHBOOK_PATTERN.test(`${a?.name || ""} ${a?.group || ""} ${a?.subGroup || ""}`);
