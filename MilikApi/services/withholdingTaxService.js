import ChartOfAccount from "../models/ChartOfAccount.js";
import { findSystemAccountByCode } from "./chartOfAccountsService.js";
import { createError } from "../utils/error.js";

export const WHT_PAYABLE_CODE = "2141";

/**
 * The liability account tax withheld is credited to: the one chosen on the document, otherwise 2141 Withholding Tax Payable.
 * Refused up front (before anything is posted) when it is missing, switched off, not a posting account or not a liability,
 * because a withholding leg that cannot post would leave the entry unbalanced.
 */
export const resolveWhtPayableAccount = async ({ businessId, accountId = null }) => {
  const account = accountId
    ? await ChartOfAccount.findOne({ _id: accountId, business: businessId, isPosting: { $ne: false }, isHeader: { $ne: true } }).lean()
    : await findSystemAccountByCode(String(businessId), WHT_PAYABLE_CODE).catch(() => null);

  if (!account) {
    throw createError(400, `The withholding tax payable account (${WHT_PAYABLE_CODE}) could not be found. Add it to the chart of accounts, or choose a withholding tax account.`);
  }
  if (account.active === false || account.isActive === false) {
    throw createError(400, `Withholding tax account ${account.code || ""} ${account.name || ""} is inactive. Reactivate it in Chart of Accounts or choose another account.`.replace(/\s+/g, " "));
  }
  if (String(account.type || "").toLowerCase() !== "liability") {
    throw createError(400, "The withholding tax account must be a liability account (tax held for the tax authority).");
  }
  return account;
};
