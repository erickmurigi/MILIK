// Utility: getCashbookAccounts
export function getCashbookAccounts(accounts) {
  return accounts.filter(
    (acc) =>
      acc.accountType === "Asset" &&
      (acc.accountSubType === "Cash" || acc.accountSubType === "Bank")
  );
}
