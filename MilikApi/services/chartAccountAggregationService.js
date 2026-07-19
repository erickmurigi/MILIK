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
    "_id type balance business code name group subGroup isHeader isPosting property"
  );

  if (accounts.length === 0) return [];

  if (isFullRun) {
    const lastRun = balanceLastRefreshed.get(String(businessId)) || 0;
    if (Date.now() - lastRun < BALANCE_TTL_MS) return accounts;
  }

  // PCTRL accounts are non-posting summaries — their balance is the net credit on
  // account 2110 (Landlord Remittance Payable) tagged with their property.
  // This represents what the PM currently holds on behalf of each landlord.
  const pctrlAccounts = accounts.filter(
    (a) => String(a.code || "").startsWith("PCTRL-") && a.property
  );
  const regularAccounts = accounts.filter(
    (a) => !String(a.code || "").startsWith("PCTRL-") || !a.property
  );

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
          _id: { accountId: "$accountId", direction: "$direction" },
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

    for (const account of regularAccounts) {
      const totals = totalsMap.get(String(account._id)) || { debit: 0, credit: 0 };
      const nextBalance = computeAccountBalance({ type: account.type, debit: totals.debit, credit: totals.credit });
      if (Number(account.balance || 0) !== Number(nextBalance || 0)) {
        bulkOps.push({ updateOne: { filter: { _id: account._id }, update: { $set: { balance: nextBalance } } } });
      }
    }
  }

  // ── PCTRL control accounts ──────────────────────────────────────────────────
  if (pctrlAccounts.length > 0) {
    const remittanceAcct = await ChartOfAccount.findOne({ business: businessObjectId, code: "2110" })
      .select("_id").lean();

    if (remittanceAcct) {
      const propertyIds = pctrlAccounts.map((a) => a.property);
      const rows = await FinancialLedgerEntry.aggregate([
        {
          $match: {
            business: businessObjectId,
            accountId: remittanceAcct._id,
            property: { $in: propertyIds },
            status: { $nin: ["void", "draft"] },
          },
        },
        {
          $group: {
            _id: "$property",
            credit: { $sum: "$credit" },
            debit:  { $sum: "$debit"  },
          },
        },
      ]);

      const pctrlMap = new Map(
        rows.map((r) => [String(r._id), Math.max(0, Number(r.credit || 0) - Number(r.debit || 0))])
      );

      for (const account of pctrlAccounts) {
        const balance = pctrlMap.get(String(account.property)) || 0;
        if (Number(account.balance || 0) !== balance) {
          bulkOps.push({ updateOne: { filter: { _id: account._id }, update: { $set: { balance } } } });
        }
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