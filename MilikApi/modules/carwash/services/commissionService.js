import mongoose from "mongoose";
import CarWashCommissionRule from "../models/CarWashCommissionRule.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import CarWashCommissionPayout from "../models/CarWashCommissionPayout.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import { findSystemAccountByCode } from "../../../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances } from "../../../services/chartAccountAggregationService.js";
import { postEntry, postReversal } from "../../../services/ledgerPostingService.js";
import { resolveAuditActorUserId } from "../../../utils/systemActor.js";
import { createError } from "../../../utils/error.js";

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const dayRange = (value = new Date()) => {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const calculateAmount = ({ type, rate, baseAmount }) => {
  const normalizedType = String(type || "fixed").toLowerCase();
  const numericRate = Number(rate || 0);
  if (normalizedType === "percentage") return round2((Number(baseAmount || 0) * numericRate) / 100);
  return round2(numericRate);
};

export const resolveCommissionRuleForJob = async (job = {}) => {
  if (!job?.business || !job?.assignedStaff) return null;
  const rules = await CarWashCommissionRule.find({
    business: job.business,
    active: true,
    $and: [
      { $or: [{ service: job.service || null }, { service: null }] },
      { $or: [{ staff: job.assignedStaff }, { staff: null }] },
    ],
  }).lean();

  return rules
    .map((rule) => ({
      ...rule,
      score: (rule.staff ? 4 : 0) + (rule.service ? 2 : 0) + Number(rule.priority || 0) / 1000,
    }))
    .sort((a, b) => b.score - a.score)[0] || null;
};

const postCommissionAccrual = async ({ req, commission }) => {
  if (!commission || Number(commission.commissionAmount || 0) <= 0) return [];
  if (Array.isArray(commission.accrualLedgerEntries) && commission.accrualLedgerEntries.length) {
    return commission.accrualLedgerEntries;
  }

  const business = commission.business;
  const actorUserId = await resolveAuditActorUserId({ req, businessId: business });
  const [expenseAccount, payableAccount] = await Promise.all([
    findSystemAccountByCode(business, "5311"),
    findSystemAccountByCode(business, "2160"),
  ]);
  if (!expenseAccount?._id || !payableAccount?._id) {
    throw new Error("Car Wash commission ledger accounts are not available.");
  }

  const { start, end } = dayRange(commission.earnedAt || new Date());
  const amount = round2(commission.commissionAmount);
  const basePayload = {
    business,
    sourceTransactionType: "carwash_commission",
    sourceTransactionId: String(commission._id),
    transactionDate: commission.earnedAt || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_COMMISSION_ACCRUAL",
    amount,
    payer: "system",
    receiver: "staff",
    createdBy: actorUserId,
    approvedBy: actorUserId,
    allowUnscoped: true,
  };

  const debitLeg = await postEntry({
    ...basePayload,
    accountId: expenseAccount._id,
    direction: "debit",
    notes: `Car Wash commission earned: ${commission.jobNumber || commission.serviceName || commission._id}`,
    metadata: { postingRole: "carwash_commission_expense", staff: String(commission.staff), job: String(commission.job) },
  });
  const creditLeg = await postEntry({
    ...basePayload,
    accountId: payableAccount._id,
    direction: "credit",
    notes: `Car Wash commission payable: ${commission.jobNumber || commission.serviceName || commission._id}`,
    metadata: {
      postingRole: "carwash_commission_payable",
      staff: String(commission.staff),
      job: String(commission.job),
      offsetOfEntryId: String(debitLeg._id),
    },
  });

  await aggregateChartOfAccountBalances(business, [String(expenseAccount._id), String(payableAccount._id)]);
  commission.accrualLedgerEntries = [debitLeg._id, creditLeg._id];
  await commission.save();
  return commission.accrualLedgerEntries;
};

export const accrueCommissionForJob = async ({ req = null, job }) => {
  if (!job || !["done", "paid"].includes(String(job.status || "").toLowerCase())) return null;
  if (!job.assignedStaff) return null;

  await cancelJobCommissions({
    req,
    business: job.business,
    jobId: job._id,
    excludeStaff: job.assignedStaff,
    reason: "Cancelled because the Car Wash job was reassigned to another staff member.",
  });

  const existing = await CarWashStaffCommission.findOne({
    business: job.business,
    job: job._id,
    staff: job.assignedStaff,
    status: { $ne: "cancelled" },
  });
  if (existing) {
    let shouldSaveExisting = false;
    if (existing.status !== "paid") {
      const refreshedRule = await resolveCommissionRuleForJob(job);
      if (!refreshedRule || Number(refreshedRule.rate || 0) <= 0) {
        await cancelJobCommissions({
          req,
          business: job.business,
          jobId: job._id,
          reason: "Cancelled because the Car Wash job no longer matches an active commission rule.",
        });
        return null;
      }

      const refreshedAmount = calculateAmount({
        type: refreshedRule.commissionType,
        rate: refreshedRule.rate,
        baseAmount: job.price,
      });
      if (refreshedAmount <= 0) {
        await cancelJobCommissions({
          req,
          business: job.business,
          jobId: job._id,
          reason: "Cancelled because the Car Wash job commission amount is zero.",
        });
        return null;
      }

      const termsChanged =
        String(existing.rule || "") !== String(refreshedRule._id || "") ||
        String(existing.service || "") !== String(job.service || "") ||
        String(existing.serviceName || "") !== String(job.serviceName || "") ||
        Number(existing.baseAmount || 0) !== Number(job.price || 0) ||
        String(existing.commissionType || "") !== String(refreshedRule.commissionType || "") ||
        Number(existing.commissionRate || 0) !== Number(refreshedRule.rate || 0) ||
        Number(existing.commissionAmount || 0) !== Number(refreshedAmount || 0);
      if (termsChanged && Array.isArray(existing.accrualLedgerEntries) && existing.accrualLedgerEntries.length) {
        await cancelJobCommissions({
          req,
          business: job.business,
          jobId: job._id,
          reason: "Cancelled because the Car Wash job commission was recalculated.",
        });
        return accrueCommissionForJob({ req, job });
      }

      existing.service = job.service || null;
      existing.rule = refreshedRule._id;
      existing.jobNumber = job.jobNumber || "";
      existing.serviceName = job.serviceName || "";
      existing.baseAmount = Number(job.price || 0);
      existing.commissionType = refreshedRule.commissionType;
      existing.commissionRate = Number(refreshedRule.rate || 0);
      existing.commissionAmount = refreshedAmount;
      shouldSaveExisting = true;
    }
    if (existing.status !== "paid" && job.paymentStatus === "paid") {
      existing.status = "payable";
      existing.payableAt = existing.payableAt || new Date();
      existing.updatedBy = existing.updatedBy || null;
      shouldSaveExisting = true;
    }
    if (shouldSaveExisting) await existing.save();
    if (existing.status !== "cancelled") await postCommissionAccrual({ req, commission: existing });
    return existing;
  }

  const rule = await resolveCommissionRuleForJob(job);
  if (!rule || Number(rule.rate || 0) <= 0) return null;

  const amount = calculateAmount({ type: rule.commissionType, rate: rule.rate, baseAmount: job.price });
  if (amount <= 0) return null;

  const actorUserId = req ? await resolveAuditActorUserId({ req, businessId: job.business }) : null;
  const commission = await CarWashStaffCommission.create({
    business: job.business,
    branch: job.branch || null,
    job: job._id,
    staff: job.assignedStaff,
    service: job.service || null,
    rule: rule._id,
    jobNumber: job.jobNumber || "",
    serviceName: job.serviceName || "",
    baseAmount: Number(job.price || 0),
    commissionType: rule.commissionType,
    commissionRate: Number(rule.rate || 0),
    commissionAmount: amount,
    status: job.paymentStatus === "paid" ? "payable" : "earned",
    earnedAt: new Date(),
    payableAt: job.paymentStatus === "paid" ? new Date() : null,
    createdBy: actorUserId,
    updatedBy: actorUserId,
  });

  await postCommissionAccrual({ req, commission });
  return commission;
};

export const markJobCommissionsPayable = async ({ business, jobId }) => {
  await CarWashStaffCommission.updateMany(
    { business, job: jobId, status: "earned" },
    { $set: { status: "payable", payableAt: new Date() } }
  );
};

export const handleJobPaymentStatusAfterPaymentChange = async ({ business, job, checkOnly = false }) => {
  if (!business || !job?._id) return;
  if (String(job.paymentStatus || "").toLowerCase() === "paid") {
    if (checkOnly) return;
    await markJobCommissionsPayable({ business, jobId: job._id });
    return;
  }

  const paidCommission = await CarWashStaffCommission.findOne({
    business,
    job: job._id,
    status: "paid",
  }).select("_id payout jobNumber");
  if (paidCommission) {
    throw createError(400, "Cannot delete this payment because staff commission has already been paid out.");
  }
  if (checkOnly) return;

  await CarWashStaffCommission.updateMany(
    { business, job: job._id, status: "payable" },
    { $set: { status: "earned", payableAt: null } }
  );
};

export const cancelJobCommissions = async ({
  req = null,
  business,
  jobId,
  excludeStaff = null,
  reason = "Cancelled because the Car Wash job was cancelled.",
}) => {
  const filter = {
    business,
    job: jobId,
    status: { $in: ["earned", "payable"] },
  };
  if (excludeStaff) filter.staff = { $ne: excludeStaff };
  const commissions = await CarWashStaffCommission.find({
    ...filter,
  });
  if (!commissions.length) return;

  const actorUserId = await resolveAuditActorUserId({ req, businessId: business });
  const accountIds = new Set();

  const bulkOps = [];
  for (const commission of commissions) {
    const reversalEntryIds = [];
    for (const entryId of commission.accrualLedgerEntries || []) {
      try {
        const { originalEntry, reversalEntry } = await postReversal({
          entryId,
          userId: actorUserId,
          reason: `Car Wash commission cancelled: ${commission.jobNumber || commission._id}`,
        });
        if (originalEntry?.accountId) accountIds.add(String(originalEntry.accountId));
        if (reversalEntry?.accountId) accountIds.add(String(reversalEntry.accountId));
        if (reversalEntry?._id) reversalEntryIds.push(reversalEntry._id);
      } catch (error) {
        if (!/already reversed/i.test(String(error?.message || ""))) throw error;
      }
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: commission._id },
        update: {
          $set: {
            status: "cancelled",
            notes: reason,
            updatedBy: actorUserId,
          },
          $push: {
            accrualReversalLedgerEntries: { $each: reversalEntryIds },
          },
        },
      },
    });
  }

  if (bulkOps.length) {
    await CarWashStaffCommission.bulkWrite(bulkOps);
  }

  if (accountIds.size) {
    await aggregateChartOfAccountBalances(business, [...accountIds]);
  }
};

export const generatePayoutNumber = async (business) => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CWP-${stamp}-`;
  const latest = await CarWashCommissionPayout.findOne(
    { business, payoutNumber: { $regex: `^${prefix}` } },
    { payoutNumber: 1 },
    { sort: { payoutNumber: -1 } }
  ).lean();
  const nextNum = latest ? parseInt(latest.payoutNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

export const resolvePayoutCashbook = async (business, value) => {
  const accountId = String(value || "").trim();
  if (!mongoose.Types.ObjectId.isValid(accountId)) throw createError(400, "Select a valid commission payout cashbook");
  const account = await ChartOfAccount.findOne({
    _id: accountId,
    business,
    type: "asset",
    isPosting: true,
    subGroup: { $regex: "cashbook", $options: "i" },
  }).lean();
  if (!account) throw createError(400, "Select a valid posting cashbook for this commission payout");
  return account;
};

export const postCommissionPayoutLedger = async ({ req, payout, cashbookAccount }) => {
  const actorUserId = await resolveAuditActorUserId({ req, businessId: payout.business });
  const payableAccount = await findSystemAccountByCode(payout.business, "2160");
  if (!payableAccount?._id || !cashbookAccount?._id) {
    throw new Error("Car Wash commission payout accounts are not available.");
  }

  const { start, end } = dayRange(payout.payoutDate);
  const amount = round2(payout.amount);
  const basePayload = {
    business: payout.business,
    sourceTransactionType: "carwash_commission_payout",
    sourceTransactionId: String(payout._id),
    transactionDate: payout.payoutDate || new Date(),
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "CARWASH_COMMISSION_PAYOUT",
    amount,
    payer: "manager",
    receiver: "staff",
    createdBy: actorUserId,
    approvedBy: actorUserId,
    allowUnscoped: true,
  };

  const debitLeg = await postEntry({
    ...basePayload,
    accountId: payableAccount._id,
    direction: "debit",
    notes: `Car Wash commission payout ${payout.payoutNumber}`,
    metadata: { postingRole: "carwash_commission_payable_settlement", staff: String(payout.staff) },
  });
  const creditLeg = await postEntry({
    ...basePayload,
    accountId: cashbookAccount._id,
    direction: "credit",
    notes: `Cashbook payment for Car Wash commission payout ${payout.payoutNumber}`,
    metadata: {
      postingRole: "cashbook_outflow",
      staff: String(payout.staff),
      cashbookAccountId: String(cashbookAccount._id),
      offsetOfEntryId: String(debitLeg._id),
    },
  });

  await aggregateChartOfAccountBalances(payout.business, [String(payableAccount._id), String(cashbookAccount._id)]);
  payout.ledgerEntries = [debitLeg._id, creditLeg._id];
  await payout.save();
  return payout.ledgerEntries;
};
