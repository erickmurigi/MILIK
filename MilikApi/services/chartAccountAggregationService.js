import mongoose from "mongoose";
import ChartOfAccount from "../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { computeAccountBalance } from "./accountingClassificationService.js";

const normalizeIds = (accountIds = []) =>
  Array.from(
    new Set(
      (Array.isArray(accountIds) ? accountIds : [accountIds])
        .filter(Boolean)
        .map((id) => String(id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    )
  ).map((id) => new mongoose.Types.ObjectId(id));

export async function aggregateChartOfAccountBalances(businessId, accountIds = []) {
  if (!businessId || !mongoose.Types.ObjectId.isValid(String(businessId))) {
    throw new Error("Valid businessId is required for chart balance aggregation.");
  }

  const businessObjectId = new mongoose.Types.ObjectId(String(businessId));
  const normalizedAccountIds = normalizeIds(accountIds);

  const accountQuery = { business: businessObjectId };
  if (normalizedAccountIds.length > 0) {
    accountQuery._id = { $in: normalizedAccountIds };
  }

  const accounts = await ChartOfAccount.find(accountQuery).select(
    "_id type balance business code name group subGroup isHeader isPosting"
  );

  if (accounts.length === 0) {
    return [];
  }

  const targetAccountIds = accounts.map((account) => account._id);

  const grouped = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: businessObjectId,
        accountId: { $in: targetAccountIds },
        status: { $nin: ["void", "draft"] },
      },
    },
    {
      $group: {
        _id: {
          accountId: "$accountId",
          direction: "$direction",
        },
        total: { $sum: "$amount" },
      },
    },
  ]);

  const totalsMap = new Map();

  for (const row of grouped) {
    const accountId = String(row?._id?.accountId || "");
    const direction = String(row?._id?.direction || "").toLowerCase();
    if (!accountId) continue;

    const current = totalsMap.get(accountId) || { debit: 0, credit: 0 };
    if (direction === "debit") current.debit = Number(row?.total || 0);
    if (direction === "credit") current.credit = Number(row?.total || 0);
    totalsMap.set(accountId, current);
  }

  // Build bulk operations instead of individual saves
  const bulkOps = [];

  for (const account of accounts) {
    const totals = totalsMap.get(String(account._id)) || { debit: 0, credit: 0 };
    const nextBalance = computeAccountBalance({
      type: account.type,
      debit: totals.debit,
      credit: totals.credit,
    });

    if (Number(account.balance || 0) !== Number(nextBalance || 0)) {
      bulkOps.push({
        updateOne: {
          filter: { _id: account._id },
          update: { $set: { balance: nextBalance } },
        },
      });
    }
  }

  // Use bulkWrite for efficient batch updates
  if (bulkOps.length > 0) {
    await ChartOfAccount.bulkWrite(bulkOps);
  }

  return accounts;
}

export default {
  aggregateChartOfAccountBalances,
};