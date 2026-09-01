// Test helpers for the Financial/Accounting engine domain — composes the base
// factories in test/factories.js rather than duplicating their logic (per the
// shared-foundation rule: base factories.js is off-limits to edit directly).
//
// Usage:
//   import { getAccountByCode } from "../test/factories.financial.js";
//   const cash = await getAccountByCode(company._id, "1100");

import ChartOfAccount from "../models/ChartOfAccount.js";

// Looks up one of the real system chart-of-accounts rows created by
// ensureSystemChartOfAccounts (see services/chartOfAccountsService.js
// SYSTEM_CHART_TEMPLATE) for a given business + account code. Throws loudly
// if the account isn't found rather than silently returning undefined, since
// a missing posting account would otherwise surface as a confusing later
// failure deep inside postEntry/validatePostingAccount.
export const getAccountByCode = async (businessId, code) => {
  const account = await ChartOfAccount.findOne({ business: businessId, code }).lean();
  if (!account) {
    throw new Error(`getAccountByCode: no system chart-of-accounts row found for code "${code}" — did the test call createTestChartOfAccounts(company._id) first?`);
  }
  return account;
};

export default { getAccountByCode };
