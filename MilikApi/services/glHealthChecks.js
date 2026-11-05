// Checks the GL Health Centre runs on top of the core balance checks in ledgerDiagnostics.js:
//   - stored Chart of Accounts balances that no longer match the ledger;
//   - entries posted into a period after it was closed or locked;
//   - sub-ledgers that should equal their GL control account (petty cash, client receivables,
//     client deferred revenue);
//   - contra accounts, whose "wrong side" balance is correct and must not be flagged or zeroed.
import mongoose from "mongoose";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../models/ChartOfAccount.js";
import AccountingPeriod from "../models/AccountingPeriod.js";
import PettyCashAccount from "../models/PettyCashAccount.js";
import FixedAsset from "../models/FixedAsset.js";
import ClientInvoice from "../modules/clients/models/ClientInvoice.js";
import ClientRevenueSchedule from "../modules/clients/models/ClientRevenueSchedule.js";
import { computeAccountBalance } from "./accountingClassificationService.js";
import { round2 } from "../utils/math.js";

const REPORT_STATUSES = ["approved", "reversed"];
const TOLERANCE = 0.01;

const debitExpr = {
  $cond: [{ $gt: ["$debit", 0] }, "$debit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "debit"] }, { $ifNull: ["$amount", 0] }, 0] }],
};
const creditExpr = {
  $cond: [{ $gt: ["$credit", 0] }, "$credit", { $cond: [{ $eq: [{ $toLower: { $ifNull: ["$direction", ""] } }, "credit"] }, { $ifNull: ["$amount", 0] }, 0] }],
};

// Accounts that normally sit on the opposite side to their type: accumulated depreciation and
// amortisation against assets, allowances / provisions for doubtful debts. A credit balance there is
// correct, so they are never "abnormal" and the clear-balance repair refuses them.
const CONTRA_NAME = /accumulated\s+(depreciation|amorti[sz]ation)|allowance\s+for|provision\s+for\s+(doubtful|bad)/i;

export const findContraAccountIds = async (bizId) => {
  const [depreciationAccounts, named] = await Promise.all([
    FixedAsset.distinct("accumulatedDepreciationAccount", { business: bizId }),
    ChartOfAccount.find({ business: bizId, name: CONTRA_NAME }).select("_id").lean(),
  ]);
  return new Set([...depreciationAccounts.filter(Boolean).map(String), ...named.map((a) => String(a._id))]);
};

export const isContraAccount = async (bizId, accountId) => (await findContraAccountIds(bizId)).has(String(accountId));

// Clearing and suspense accounts should net to zero; a balance either way means something is waiting
// to be cleared, which is worth a different hint from "wrong sign".
export const isClearingAccount = (account = {}) => /clearing|suspense/i.test(`${account.name || ""} ${account.subGroup || ""}`);

// The cached balance on each account against one computed from the ledger the same way the
// recompute does (status not void/draft, normal-side sign).
const storedBalanceMismatches = async (bizId) => {
  const [accounts, totals] = await Promise.all([
    ChartOfAccount.find({ business: bizId }).select("_id code name type balance").lean(),
    FinancialLedgerEntry.aggregate([
      { $match: { business: bizId, accountId: { $ne: null }, status: { $nin: ["void", "draft"] } } },
      { $group: { _id: "$accountId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
    ]).allowDiskUse(true),
  ]);
  const byId = new Map(totals.map((t) => [String(t._id), t]));
  return accounts
    .map((a) => {
      const t = byId.get(String(a._id)) || { debit: 0, credit: 0 };
      const ledger = round2(computeAccountBalance({ type: a.type, debit: t.debit, credit: t.credit }));
      const stored = round2(Number(a.balance || 0));
      return { accountId: a._id, code: a.code, name: a.name, stored, ledger, difference: round2(stored - ledger) };
    })
    .filter((r) => Math.abs(r.difference) >= TOLERANCE)
    .sort((x, y) => Math.abs(y.difference) - Math.abs(x.difference))
    .slice(0, 50);
};

// Entries dated inside a closed/locked period but created after it closed. Includes anything posted
// through a posting window, so it reads as "review", not as an error.
const closedPeriodPostings = async (bizId) => {
  const periods = await AccountingPeriod.find({ business: bizId, status: { $in: ["closed", "locked"] } })
    .select("name status startDate endDate closedAt lockedAt").lean();
  const results = await Promise.all(periods.map(async (p) => {
    const closedAt = p.closedAt || p.lockedAt;
    if (!closedAt) return null;
    const [row] = await FinancialLedgerEntry.aggregate([
      { $match: { business: bizId, status: { $in: REPORT_STATUSES }, transactionDate: { $gte: p.startDate, $lte: p.endDate }, createdAt: { $gt: closedAt } } },
      { $group: { _id: null, entries: { $sum: 1 }, debit: { $sum: debitExpr } } },
    ]);
    return row?.entries ? { periodId: p._id, name: p.name, status: p.status, closedAt, entries: row.entries, debit: round2(row.debit) } : null;
  }));
  return results.filter(Boolean);
};

const glBalanceOf = async (bizId, accountIds) => {
  if (!accountIds.length) return new Map();
  const rows = await FinancialLedgerEntry.aggregate([
    { $match: { business: bizId, accountId: { $in: accountIds }, status: { $in: REPORT_STATUSES } } },
    { $group: { _id: "$accountId", debit: { $sum: debitExpr }, credit: { $sum: creditExpr } } },
  ]).allowDiskUse(true);
  return new Map(rows.map((r) => [String(r._id), round2(r.debit - r.credit)]));
};

// Sub-ledger totals against the GL control account they feed. Only reported where the company uses
// that sub-ledger. GL figures are debit minus credit, so a liability's balance is negated.
const reconciliations = async (bizId) => {
  const [pettyAccounts, controlAccounts, clientAr, deferred] = await Promise.all([
    PettyCashAccount.find({ business: bizId, glAccountId: { $ne: null } }).select("name glAccountId currentBalance").lean(),
    ChartOfAccount.find({ business: bizId, code: { $in: ["1260", "2165"] } }).select("_id code name").lean(),
    ClientInvoice.aggregate([
      { $match: { business: bizId, status: { $nin: ["draft", "cancelled"] } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          outstanding: {
            $sum: {
              $subtract: [
                { $add: [{ $ifNull: ["$total", 0] }, { $ifNull: ["$debitedAmount", 0] }] },
                { $add: [{ $ifNull: ["$paidAmount", 0] }, { $ifNull: ["$creditedAmount", 0] }] },
              ],
            },
          },
        },
      },
    ]),
    ClientRevenueSchedule.aggregate([
      { $match: { business: bizId, status: { $ne: "cancelled" } } },
      { $group: { _id: null, count: { $sum: 1 }, deferred: { $sum: { $subtract: ["$totalAmount", { $add: [{ $ifNull: ["$creditedAmount", 0] }, { $ifNull: ["$recognizedAmount", 0] }] }] } } } },
    ]),
  ]);

  const pettyGlIds = [...new Set(pettyAccounts.map((a) => String(a.glAccountId)))].map((id) => new mongoose.Types.ObjectId(id));
  const glIds = [...pettyGlIds, ...controlAccounts.map((a) => a._id)];
  const [gl, glAccounts] = await Promise.all([
    glBalanceOf(bizId, glIds),
    ChartOfAccount.find({ _id: { $in: pettyGlIds } }).select("_id code name").lean(),
  ]);
  const accountById = new Map([...glAccounts, ...controlAccounts].map((a) => [String(a._id), a]));
  const out = [];

  for (const glId of pettyGlIds.map(String)) {
    const boxes = pettyAccounts.filter((a) => String(a.glAccountId) === glId);
    const subledger = round2(boxes.reduce((s, a) => s + Number(a.currentBalance || 0), 0));
    const glBalance = gl.get(glId) || 0;
    const account = accountById.get(glId);
    out.push({
      key: `petty-${glId}`, label: `Petty cash (${boxes.map((b) => b.name).join(", ")})`,
      account: account ? { code: account.code, name: account.name } : null,
      gl: glBalance, subledger, difference: round2(glBalance - subledger), link: "/accounts/petty-cash",
    });
  }

  const receivable = controlAccounts.find((a) => a.code === "1260");
  if (receivable && (clientAr[0]?.count || gl.get(String(receivable._id)))) {
    const glBalance = gl.get(String(receivable._id)) || 0;
    const subledger = round2(clientAr[0]?.outstanding || 0);
    out.push({
      key: "client-ar", label: "Client receivables vs unpaid client invoices",
      account: { code: receivable.code, name: receivable.name }, gl: glBalance, subledger,
      difference: round2(glBalance - subledger), link: "/clients/reports",
    });
  }

  const deferredAccount = controlAccounts.find((a) => a.code === "2165");
  if (deferredAccount && (deferred[0]?.count || gl.get(String(deferredAccount._id)))) {
    const glBalance = round2(-(gl.get(String(deferredAccount._id)) || 0)); // credit-normal
    const subledger = round2(deferred[0]?.deferred || 0);
    out.push({
      key: "client-deferred", label: "Deferred revenue vs revenue schedules",
      account: { code: deferredAccount.code, name: deferredAccount.name }, gl: glBalance, subledger,
      difference: round2(glBalance - subledger), link: "/clients/revenue",
    });
  }
  return out;
};

export const runExtendedChecks = async (bizId) => {
  const [contraIds, mismatches, lateEntries, recs] = await Promise.all([
    findContraAccountIds(bizId),
    storedBalanceMismatches(bizId),
    closedPeriodPostings(bizId),
    reconciliations(bizId),
  ]);
  return { contraIds, storedBalanceMismatches: mismatches, closedPeriodPostings: lateEntries, reconciliations: recs };
};
