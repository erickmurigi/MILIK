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

// Per-business TTL guard — skips full ledger scans requested within 30 s of the previous one.
// Targeted partial runs (specific accountIds, e.g. after posting a journal) always execute.
const balanceLastRefreshed = new Map();
const BALANCE_TTL_MS = 30_000;

export const invalidateBalanceCache = (businessId) => {
  if (businessId) balanceLastRefreshed.delete(String(businessId));
};

export async function aggregateChartOfAccountBalances(businessId, accountIds = []) {
  if (!businessId || !mongoose.Types.ObjectId.isValid(String(businessId))) {
    throw new Error("Valid businessId is required for chart balance aggregation.");
  }

  const businessObjectId = new mongoose.Types.ObjectId(String(businessId));
  const normalizedAccountIds = normalizeIds(accountIds);
  const isFullRun = normalizedAccountIds.length === 0;

  const accountQuery = { business: businessObjectId };
  if (normalizedAccountIds.length > 0) {
    accountQuery._id = { $in: normalizedAccountIds };
  }

  const accounts = await ChartOfAccount.find(accountQuery).select(
    "_id type balance"
  );

  if (accounts.length === 0) return [];

  if (isFullRun) {
    const lastRun = balanceLastRefreshed.get(String(businessId)) || 0;
    if (Date.now() - lastRun < BALANCE_TTL_MS) return accounts;
  }

  // Every account, property control (PCTRL-) accounts included, carries its own ledger balance: the
  // same figure the Trial Balance, Balance Sheet and the account's Ledger Activity show. (PCTRL balances
  // used to be overwritten with the 2110 remittance figure for the property, so the Chart of Accounts
  // disagreed with every report. The amount held for a landlord is shown on the property itself.)
  const regularAccounts = accounts;

  const bulkOps = [];

  // ── Regular posting accounts ────────────────────────────────────────────────
  if (regularAccounts.length > 0) {
    const targetAccountIds = regularAccounts.map((a) => a._id);

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
          _id: "$accountId",
          totalDebit: {
            $sum: {
              $cond: [
                { $gt: ["$debit", 0] }, "$debit",
                { $cond: [
                  { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] },
                  { $ifNull: ["$amount", 0] },
                  0,
                ]},
              ],
            },
          },
          totalCredit: {
            $sum: {
              $cond: [
                { $gt: ["$credit", 0] }, "$credit",
                { $cond: [
                  { $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] },
                  { $ifNull: ["$amount", 0] },
                  0,
                ]},
              ],
            },
          },
        },
      },
    ]);

    const totalsMap = new Map();
    for (const row of grouped) {
      const accountId = String(row?._id || "");
      if (!accountId) continue;
      totalsMap.set(accountId, {
        debit:  Number(row?.totalDebit  || 0),
        credit: Number(row?.totalCredit || 0),
      });
    }

    for (const account of regularAccounts) {
      const totals = totalsMap.get(String(account._id)) || { debit: 0, credit: 0 };
      const nextBalance = computeAccountBalance({ type: account.type, debit: totals.debit, credit: totals.credit });
      if (Number(account.balance || 0) !== Number(nextBalance || 0)) {
        bulkOps.push({ updateOne: { filter: { _id: account._id }, update: { $set: { balance: nextBalance } } } });
      }
    }
  }

  if (bulkOps.length > 0) {
    await ChartOfAccount.bulkWrite(bulkOps);
  }

  if (isFullRun) balanceLastRefreshed.set(String(businessId), Date.now());

  return accounts;
}

export default {
  aggregateChartOfAccountBalances,
  invalidateBalanceCache,
};