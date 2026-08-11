
import mongoose from "mongoose";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import LandlordAdvancement from "../../models/LandlordAdvancement.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { resolveLandlordRemittancePayableAccount, resolvePropertyAccountingContext } from "../../services/propertyAccountingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { createError } from "../../utils/error.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { parsePagination } from "../../utils/pagination.js";
import {
  buildRunSchedule,
  comparePeriodOrder,
  filterEligibleSchedule,
  getPeriodKey,
  normalizeFrequency,
  normalizeToEndOfDay,
  normalizeToStartOfDay,
  parseDate,
  round2,
} from "../../utils/recurringSchedule.js";

const ADVANCE_TYPES = ["against_payable", "future_recoverable"];
const LEGACY_STATUSES = ["draft", "active", "paused", "completed", "cancelled"];
const WORKFLOW_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "disbursed",
  "recovering",
  "cleared",
  "cancelled",
  "reversed",
  "paused",
  ...LEGACY_STATUSES,
];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const oid = (value) => new mongoose.Types.ObjectId(String(value));

const normalizePaymentMethod = (value) => {
  const normalized = String(value || "bank_transfer").trim().toLowerCase();
  if (normalized === "mpesa") return "mobile_money";
  if (normalized === "cheque") return "check";
  if (["bank_transfer", "mobile_money", "cash", "check", "credit_card", "other"].includes(normalized)) {
    return normalized;
  }
  return "bank_transfer";
};

const normalizeAdvanceType = (value, row = null) => {
  const normalized = String(value || row?.advanceType || "").trim().toLowerCase();
  if (ADVANCE_TYPES.includes(normalized)) return normalized;
  // Historical MILIK records were only future recoverable
  return "future_recoverable";
};

const normalizeRequestedStatus = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "active") return "disbursed";
  if (normalized === "completed") return "cleared";
  return normalized;
};

const addMonths = (dateValue, months = 0) => {
  const parsed = parseDate(dateValue, null);
  if (!parsed) return null;
  const monthCount = Math.max(0, Number(months || 0));
  const date = new Date(parsed);
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + monthCount);
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, maxDay));
  return date;
};

const endOfMonth = (dateValue) => {
  const parsed = parseDate(dateValue, null);
  if (!parsed) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0, 23, 59, 59, 999);
};

const normalizeGracePeriodMonths = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
};

const normalizePeriodMonths = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.trunc(parsed));
};

const resolveAdvancementScheduleWindow = ({
  startDate,
  endDate = null,
  periodMonths = null,
  gracePeriodMonths = 0,
} = {}) => {
  const normalizedStartDate = parseDate(startDate, null);
  const normalizedEndDate = parseDate(endDate, null);
  const normalizedPeriodMonths = normalizePeriodMonths(periodMonths);
  const normalizedGracePeriodMonths = normalizeGracePeriodMonths(gracePeriodMonths);
  const effectiveStartDate = addMonths(normalizedStartDate, normalizedGracePeriodMonths) || normalizedStartDate;

  if (!normalizedPeriodMonths) {
    return {
      effectiveStartDate,
      endDate: normalizedEndDate,
      periodMonths: null,
      gracePeriodMonths: normalizedGracePeriodMonths,
    };
  }

  const computedEndDate = endOfMonth(
    addMonths(effectiveStartDate || normalizedStartDate, Math.max(normalizedPeriodMonths - 1, 0))
  );

  return {
    effectiveStartDate,
    endDate: computedEndDate || normalizedEndDate,
    periodMonths: normalizedPeriodMonths,
    gracePeriodMonths: normalizedGracePeriodMonths,
  };
};

const generateReferenceNo = async (businessId) => {
  const prefix = "LADV";
  const last = await LandlordAdvancement.findOne(
    { business: businessId, referenceNo: { $regex: `^${prefix}\\d+$` } },
    { referenceNo: 1 },
    { sort: { createdAt: -1 } }
  ).lean();
  const lastNo = last?.referenceNo || "";
  const seq = lastNo ? (parseInt(String(lastNo).replace(prefix, ""), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const populateQuery = (query) =>
  query
    .populate("landlord", "landlordName firstName lastName email phoneNumber")
    .populate("property", "propertyName propertyCode name")
    .populate("cashbook", "code accountCode name accountName")
    .populate("createdBy", "username email firstName lastName")
    .populate("updatedBy", "username email firstName lastName")
    .populate("submittedBy", "username email firstName lastName")
    .populate("approvedBy", "username email firstName lastName")
    .populate("rejectedBy", "username email firstName lastName")
    .populate("cancelledBy", "username email firstName lastName")
    .populate("reversedBy", "username email firstName lastName")
    .populate("recoveryHistory.processedBy", "username email firstName lastName")
    .populate("recoveryHistory.cancelledBy", "username email firstName lastName");

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for landlord advancement posting.",
  });

const resolveCashbookAccount = async ({ businessId, cashbook, paymentMethod }) => {
  await ensureSystemChartOfAccounts(businessId);

  const baseQuery = {
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
    $or: [
      { type: "asset" },
      { type: "Asset" },
      { accountType: "asset" },
      { accountType: "Asset" },
      { nature: "asset" },
      { nature: "Asset" },
      { accountNature: "asset" },
      { accountNature: "Asset" },
    ],
  };

  if (isValidObjectId(cashbook)) {
    const byId = await ChartOfAccount.findOne({ ...baseQuery, _id: cashbook }).lean();
    if (byId) return byId;
  }

  const fallbackCode =
    paymentMethod === "cash"
      ? "1100"
      : paymentMethod === "mobile_money"
      ? "1130"
      : "1110";

  const systemFallback = await findSystemAccountByCode(businessId, fallbackCode);
  if (systemFallback) return systemFallback;

  return ChartOfAccount.findOne(baseQuery).sort({ createdAt: 1 }).lean();
};

const resolveAdvanceRecoverableAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);
  const exact = await findSystemAccountByCode(businessId, "1210");
  if (exact) return exact;
  return ChartOfAccount.findOne({ business: businessId, code: "1210" }).lean();
};

const statementCursorFor = (statement) => {
  const cursor = statement?.cutoffAt || statement?.periodEnd || null;
  return cursor ? normalizeToEndOfDay(cursor) : null;
};

const getRecoveryPeriodKey = (item, frequency) =>
  String(item?.periodKey || getPeriodKey(item?.dueDate || item?.processedAt, frequency) || "").trim();

const getActiveRecoveryHistory = (row) =>
  (Array.isArray(row?.recoveryHistory) ? row.recoveryHistory : []).filter((item) => !item?.cancelledAt);

const getCancelledRecoveryHistory = (row) =>
  (Array.isArray(row?.recoveryHistory) ? row.recoveryHistory : []).filter((item) => item?.cancelledAt);

const resolveLifecycleStatus = (row) => {
  const rawStatus = String(row?.status || "draft").toLowerCase();
  const advanceType = normalizeAdvanceType(row?.advanceType, row);
  const hasDisbursement = Boolean(row?.disbursedAt || row?.disbursementEntryId || row?.disbursementOffsetEntryId);
  const outstanding = round2(Number(row?.balanceOutstanding || 0));

  if (rawStatus === "reversed") return "reversed";
  if (rawStatus === "cancelled") return "cancelled";
  if (rawStatus === "rejected") return "rejected";
  if (rawStatus === "submitted") return "submitted";
  if (rawStatus === "draft") return "draft";
  if (rawStatus === "approved" && !hasDisbursement) return "approved";
  if (rawStatus === "completed" || rawStatus === "cleared") return "cleared";
  if (rawStatus === "paused") return "paused";

  if (!hasDisbursement) {
    return rawStatus === "approved" ? "approved" : rawStatus === "submitted" ? "submitted" : "draft";
  }

  if (advanceType === "future_recoverable") {
    if (outstanding <= 0) return "cleared";
    if (getActiveRecoveryHistory(row).length > 0 || rawStatus === "recovering") return "recovering";
    return "disbursed";
  }

  return "disbursed";
};

const recalculateRecoveryBalances = (row) => {
  const advanceType = normalizeAdvanceType(row?.advanceType, row);

  if (advanceType === "against_payable") {
    row.recoveredAmount = 0;
    row.interestRecoveredAmount = 0;
    row.totalRecoverableAmount = 0;
    row.balanceOutstanding = 0;
    if (row.disbursedAt && !["cancelled", "reversed", "rejected"].includes(String(row.status || "").toLowerCase())) {
      row.status = "disbursed";
    }
    return;
  }

  const activeHistory = getActiveRecoveryHistory(row);
  const recoveredPrincipal = round2(
    activeHistory.reduce((sum, item) => sum + Number(item?.principalAmount || item?.amount || 0), 0)
  );
  const recoveredInterest = round2(
    activeHistory.reduce((sum, item) => sum + Number(item?.interestAmount || 0), 0)
  );

  row.recoveredAmount = recoveredPrincipal;
  row.interestRecoveredAmount = recoveredInterest;

  const totalRecoverable = round2(
    Number(row.totalRecoverableAmount || row.amount || 0) || 0
  );

  row.balanceOutstanding = round2(
    totalRecoverable - Number(row.recoveredAmount || 0) - Number(row.interestRecoveredAmount || 0)
  );

  if (row.balanceOutstanding <= 0 && row.disbursedAt) {
    row.status = "cleared";
  } else if (row.disbursedAt) {
    row.status = activeHistory.length > 0 ? "recovering" : "disbursed";
  } else if (String(row.status || "") === "completed") {
    row.status = "approved";
  }
};

const isPeriodClosedByProcessedStatement = async ({ businessId, propertyId, landlordId, periodStart, periodEnd }) => {
  if (!isValidObjectId(businessId) || !isValidObjectId(propertyId) || !isValidObjectId(landlordId)) return false;

  const candidates = await ProcessedStatement.find({
    business: oid(businessId),
    property: oid(propertyId),
    landlord: oid(landlordId),
    status: { $ne: "reversed" },
    periodStart: { $lte: normalizeToStartOfDay(periodStart) },
    $or: [
      { cutoffAt: { $gte: normalizeToEndOfDay(periodEnd) } },
      { cutoffAt: null, periodEnd: { $gte: normalizeToEndOfDay(periodEnd) } },
    ],
  })
    .select("_id periodStart periodEnd cutoffAt status")
    .lean();

  return candidates.some((item) => {
    const start = normalizeToStartOfDay(item.periodStart);
    const end = statementCursorFor(item);
    return (
      start &&
      end &&
      start.getTime() <= normalizeToStartOfDay(periodStart).getTime() &&
      end.getTime() >= normalizeToEndOfDay(periodEnd).getTime()
    );
  });
};

const computeSchedule = (row) => {
  const advanceType = normalizeAdvanceType(row?.advanceType, row);
  if (advanceType !== "future_recoverable") return [];

  const scheduleWindow = resolveAdvancementScheduleWindow({
    startDate: row.startDate,
    endDate: row.endDate,
    periodMonths: row.periodMonths,
    gracePeriodMonths: row.gracePeriodMonths,
  });

  const schedule = buildRunSchedule({
    startDate: scheduleWindow.effectiveStartDate || row.startDate,
    endDate: scheduleWindow.endDate || row.endDate,
    frequency: row.frequency,
    dayOfMonth: row.dayOfMonth,
    capAt: new Date(),
  });

  const processedKeys = new Set(
    getActiveRecoveryHistory(row)
      .map((item) => getRecoveryPeriodKey(item, row.frequency))
      .filter(Boolean)
  );

  const principalTarget = Number(row.amount || 0);
  const installmentCount = Math.max(schedule.length || 1, 1);
  const baseInstallment = installmentCount > 0 ? round2(principalTarget / installmentCount) : round2(principalTarget);

  let scheduledTotal = 0;
  return schedule.map((item, index) => {
    const isLast = index === schedule.length - 1;
    const amount = isLast ? round2(principalTarget - scheduledTotal) : baseInstallment;
    scheduledTotal = round2(scheduledTotal + amount);
    const processedEntry = getActiveRecoveryHistory(row).find(
      (history) => String(history?.periodKey || "") === item.periodKey
    );

    return {
      ...item,
      scheduledAmount: amount,
      scheduledPrincipalAmount: amount,
      scheduledInterestAmount: 0,
      processed: processedKeys.has(item.periodKey),
      processedAt: processedEntry?.processedAt || null,
      processedAmount: processedEntry ? round2(processedEntry.amount || 0) : 0,
      referenceNo: processedEntry?.referenceNo || "",
    };
  });
};

const computeCurrentLandlordPayable = async ({ businessId, propertyId, landlordId }) => {
  const payableAccount = await resolveLandlordRemittancePayableAccount(businessId);
  if (!payableAccount?._id) return 0;

  const grouped = await FinancialLedgerEntry.aggregate([
    {
      $match: {
        business: oid(businessId),
        property: oid(propertyId),
        landlord: oid(landlordId),
        accountId: oid(payableAccount._id),
        status: { $nin: ["draft", "void"] },
      },
    },
    {
      $group: {
        _id: "$direction",
        total: { $sum: "$amount" },
      },
    },
  ]);

  const debitTotal = grouped.find((g) => g._id === "debit")?.total || 0;
  const creditTotal = grouped.find((g) => g._id === "credit")?.total || 0;
  return round2(Number(creditTotal) - Number(debitTotal));
};

const ensureAgainstPayableAmountIsSafe = async ({ businessId, propertyId, landlordId, amount }) => {
  const currentPayable = await computeCurrentLandlordPayable({ businessId, propertyId, landlordId });
  const requestedAmount = round2(Number(amount || 0));

  if (requestedAmount > currentPayable) {
    const error = new Error(
      `Current landlord payable is only KES ${currentPayable.toLocaleString()}. Use Future Recoverable Advance for any excess amount.`
    );
    error.statusCode = 400;
    error.payableSnapshotAmount = currentPayable;
    throw error;
  }

  return currentPayable;
};

const computeStatementWindowForDisbursement = (row) => {
  const effectiveDate = normalizeToStartOfDay(row?.disbursementDate || new Date());
  return {
    periodStart: effectiveDate,
    periodEnd: normalizeToEndOfDay(effectiveDate),
  };
};

const syncDisbursementDerivedFields = async (row) => {
  const advanceType = normalizeAdvanceType(row?.advanceType, row);
  if (advanceType === "against_payable") {
    row.balanceOutstanding = 0;
    row.totalRecoverableAmount = 0;
    row.recoveredAmount = 0;
    row.interestRecoveredAmount = 0;
  } else {
    recalculateRecoveryBalances(row);
  }
  row.status = resolveLifecycleStatus(row);
};

const serializeAdvancement = (row) => {
  const plain = typeof row?.toObject === "function" ? row.toObject({ virtuals: true }) : { ...(row || {}) };
  const advanceType = normalizeAdvanceType(plain.advanceType, plain);
  const scheduleWindow =
    advanceType === "future_recoverable"
      ? resolveAdvancementScheduleWindow({
          startDate: plain.startDate,
          endDate: plain.endDate,
          periodMonths: plain.periodMonths,
          gracePeriodMonths: plain.gracePeriodMonths,
        })
      : {
          effectiveStartDate: plain.startDate || null,
          endDate: plain.endDate || plain.startDate || null,
        };
  const schedule = computeSchedule(plain);
  const activeHistory = getActiveRecoveryHistory(plain);
  const cancelledHistory = getCancelledRecoveryHistory(plain);
  const eligiblePeriods =
    advanceType === "future_recoverable"
      ? filterEligibleSchedule({
          schedule,
          runHistory: activeHistory,
          now: new Date(),
          frequency: plain.frequency,
        }).map((item) => ({
          periodKey: item.periodKey,
          periodLabel: item.periodLabel,
          dueDate: item.dueDate,
          periodStart: item.periodStart,
          periodEnd: item.periodEnd,
          scheduledAmount: item.scheduledAmount,
          scheduledPrincipalAmount: item.scheduledPrincipalAmount,
          scheduledInterestAmount: item.scheduledInterestAmount,
        }))
      : [];

  const processedPeriods = activeHistory
    .map((run) => ({
      recoveryId: String(run?._id || ""),
      periodKey: getRecoveryPeriodKey(run, plain.frequency),
      periodLabel: String(run?.periodLabel || "").trim() || null,
      processedAt: run?.processedAt || null,
      dueDate: run?.dueDate || null,
      periodStart: run?.periodStart || null,
      periodEnd: run?.periodEnd || null,
      amount: round2(run?.amount || 0),
      principalAmount: round2(run?.principalAmount || run?.amount || 0),
      interestAmount: round2(run?.interestAmount || 0),
      referenceNo: run?.referenceNo || "",
      note: run?.note || "",
    }))
    .filter((item) => item.periodKey)
    .sort(comparePeriodOrder);

  const cancelledPeriods = cancelledHistory
    .map((run) => ({
      recoveryId: String(run?._id || ""),
      periodKey: getRecoveryPeriodKey(run, plain.frequency),
      periodLabel: String(run?.periodLabel || "").trim() || null,
      processedAt: run?.processedAt || null,
      amount: round2(run?.amount || 0),
      cancelledAt: run?.cancelledAt || null,
      cancellationReason: run?.cancellationReason || "",
    }))
    .filter((item) => item.periodKey)
    .sort(comparePeriodOrder);

  const totalRecoveredAmount = round2(Number(plain.recoveredAmount || 0) + Number(plain.interestRecoveredAmount || 0));
  const lifecycleStatus = resolveLifecycleStatus(plain);
  const outstandingRecoverableAmount = advanceType === "future_recoverable" ? round2(Number(plain.balanceOutstanding || 0)) : 0;

  return {
    ...plain,
    advanceType,
    legacyStatus: plain.status,
    status: lifecycleStatus,
    computedRecoveryStartDate: scheduleWindow.effectiveStartDate || plain.startDate || null,
    computedRecoveryEndDate: scheduleWindow.endDate || plain.endDate || null,
    amortizationSchedule: schedule,
    eligibleRecoveryPeriods: eligiblePeriods,
    processedPeriods,
    cancelledPeriods,
    processedPeriodsCount: processedPeriods.length,
    cancelledPeriodsCount: cancelledPeriods.length,
    unprocessedPeriodsCount: Math.max(schedule.length - processedPeriods.length, 0),
    nextEligibleRecoveryPeriod: eligiblePeriods[0] || null,
    outstandingRecoverableAmount,
    totalRecoveredAmount,
    alreadyPaidToLandlord: advanceType === "against_payable" && plain.disbursedAt ? round2(plain.amount || 0) : 0,
    isRecoverable: advanceType === "future_recoverable",
    canRecover: advanceType === "future_recoverable" && ["disbursed", "recovering", "approved", "paused"].includes(lifecycleStatus),
    canDisburse: !plain.disbursedAt && !["cancelled", "rejected", "reversed", "cleared"].includes(lifecycleStatus),
  };
};

const serializeRows = (rows = []) => rows.map((row) => serializeAdvancement(row));

const resolveSelectedRecoveryPeriod = (row, payload = {}) => {
  const serialized = serializeAdvancement(row);
  const requestedKey = String(payload?.periodKey || payload?.schedulePeriod || "").trim();
  if (requestedKey) {
    return serialized.eligibleRecoveryPeriods.find((item) => item.periodKey === requestedKey) || null;
  }
  const requestedDate = parseDate(payload?.runDate || payload?.processedAt, null);
  if (requestedDate) {
    const derivedKey = getPeriodKey(requestedDate, row.frequency);
    return serialized.eligibleRecoveryPeriods.find((item) => item.periodKey === derivedKey) || null;
  }
  return serialized.nextEligibleRecoveryPeriod || null;
};

const postDisbursementIfMissing = async ({ row, actorUserId, paymentMethod, cashbook }) => {
  if (row.disbursementEntryId && row.disbursementOffsetEntryId) return;

  const accountingContext = await resolvePropertyAccountingContext({
    businessId: row.business,
    propertyId: row.property,
    landlordId: row.landlord,
  });

  const advanceType = normalizeAdvanceType(row.advanceType, row);
  const cashbookAccount = await resolveCashbookAccount({ businessId: row.business, cashbook, paymentMethod });
  if (!cashbookAccount?._id) {
    throw new Error("Selected cashbook / payout account could not be resolved.");
  }

  const journalGroupId = new mongoose.Types.ObjectId();
  const notes = String(
    row.narration ||
      row.title ||
      (advanceType === "against_payable"
        ? "Landlord advance against current payable"
        : "Future recoverable landlord advance")
  ).trim();

  let primaryAccount = null;
  let primaryDirection = "debit";
  let primaryCategory = "ADVANCE_TO_LANDLORD";
  let primaryMetadata = {};

  if (advanceType === "against_payable") {
    const payableAccount = await resolveLandlordRemittancePayableAccount(row.business);
    if (!payableAccount?._id) {
      throw new Error("Landlord remittance payable account could not be resolved.");
    }

    const currentPayable = await ensureAgainstPayableAmountIsSafe({
      businessId: row.business,
      propertyId: row.property,
      landlordId: row.landlord,
      amount: row.amount,
    });

    row.payableAvailableAtDisbursement = currentPayable;
    row.payableBalanceAfterDisbursement = round2(currentPayable - Number(row.amount || 0));

    primaryAccount = payableAccount;
    primaryDirection = "debit";
    primaryCategory = "ADVANCE_TO_LANDLORD";
    primaryMetadata = {
      advancementId: String(row._id),
      referenceNo: row.referenceNo,
      advanceType,
      includeInLandlordStatement: true,
      statementBucket: "advance_payment",
      postingKind: "landlord_advance_against_payable",
      alreadyPaidToLandlord: true,
    };
  } else {
    const advanceRecoverableAccount = await resolveAdvanceRecoverableAccount(row.business);
    if (!advanceRecoverableAccount?._id) {
      throw new Error("Landlord advances recoverable account could not be resolved.");
    }
    primaryAccount = advanceRecoverableAccount;
    primaryDirection = "debit";
    primaryCategory = "ADVANCE_TO_LANDLORD";
    primaryMetadata = {
      advancementId: String(row._id),
      referenceNo: row.referenceNo,
      advanceType,
      postingKind: "landlord_advancement_disbursement",
      includeInLandlordStatement: false,
    };
  }

  const statementWindow = computeStatementWindowForDisbursement(row);

  let primaryEntry;
  try {
    primaryEntry = await postEntry({
      business: accountingContext.businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      sourceTransactionType: "advance",
      sourceTransactionId: String(row._id),
      transactionDate: row.disbursementDate,
      statementPeriodStart: statementWindow.periodStart,
      statementPeriodEnd: statementWindow.periodEnd,
      category: primaryCategory,
      amount: round2(row.amount || 0),
      direction: primaryDirection,
      accountId: primaryAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "landlord",
      notes,
      metadata: primaryMetadata,
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: row.disbursementDate,
      status: "approved",
    });

    await postEntry({
      business: accountingContext.businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      sourceTransactionType: "advance",
      sourceTransactionId: String(row._id),
      transactionDate: row.disbursementDate,
      statementPeriodStart: statementWindow.periodStart,
      statementPeriodEnd: statementWindow.periodEnd,
      category: primaryCategory,
      amount: round2(row.amount || 0),
      direction: "credit",
      accountId: cashbookAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes,
      metadata: {
        advancementId: String(row._id),
        referenceNo: row.referenceNo,
        advanceType,
        postingKind: "landlord_advancement_cashbook_offset",
        includeInLandlordStatement: false,
        paymentMethod,
        cashbookId: String(cashbookAccount._id),
        cashbookName: cashbookAccount.name || cashbookAccount.accountName || cashbookAccount.code || "",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: row.disbursementDate,
      status: "approved",
    });
  } catch (error) {
    if (primaryEntry?._id) {
      await postReversal({ entryId: primaryEntry._id, reason: `Auto-reversal: GL balance protection for advancement disbursement ${row.referenceNo || row._id}`, userId: actorUserId }).catch(() => null);
    }
    throw error;
  }

  row.disbursementJournalGroupId = journalGroupId;
  row.disbursementEntryId = primaryEntry._id;
  row.disbursementOffsetEntryId = offsetEntry._id;
  row.disbursedAt = row.disbursementDate;
  row.approvedAt = row.approvedAt || row.disbursementDate;
  row.approvedBy = row.approvedBy || actorUserId;
  await syncDisbursementDerivedFields(row);

  await aggregateChartOfAccountBalances(String(row.business), [
    String(primaryAccount._id),
    String(cashbookAccount._id),
  ]);
};

const reverseDisbursementIfPossible = async ({ row, businessId, actorUserId, reason }) => {
  if (!row.disbursementEntryId || !row.disbursementOffsetEntryId) {
    throw new Error("No posted disbursement exists for this landlord advance.");
  }

  if (getActiveRecoveryHistory(row).length > 0) {
    const error = new Error("Recoveries already exist on this landlord advance. Cancel the recoveries before reversing the disbursement.");
    error.statusCode = 400;
    throw error;
  }

  const advanceType = normalizeAdvanceType(row.advanceType, row);
  if (advanceType === "against_payable") {
    const window = computeStatementWindowForDisbursement(row);
    const periodClosed = await isPeriodClosedByProcessedStatement({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
    });

    if (periodClosed) {
      const error = new Error("This early payout already falls inside a processed landlord statement period. Reverse or reopen that processed statement first.");
      error.statusCode = 400;
      throw error;
    }
  }

  const touchedAccountIds = new Set();

  const reverseOne = async (entryId) => {
    if (!entryId || !isValidObjectId(entryId)) return null;
    const originalEntry = await FinancialLedgerEntry.findOne({
      _id: entryId,
      business: businessId,
      reversalOf: null,
      status: { $nin: ["void"] },
    }).select("_id accountId status reversedByEntry");
    if (!originalEntry || originalEntry.reversedByEntry || originalEntry.status === "reversed") return null;

    if (originalEntry?.accountId) touchedAccountIds.add(String(originalEntry.accountId));
    const reversal = await postReversal({ entryId: originalEntry._id, reason, userId: actorUserId });
    if (reversal?.reversalEntry?.accountId) {
      touchedAccountIds.add(String(reversal.reversalEntry.accountId));
    }
    return reversal;
  };

  const firstReversal = await reverseOne(row.disbursementEntryId);
  try {
    await reverseOne(row.disbursementOffsetEntryId);
  } catch (e) {
    if (firstReversal?.reversalEntry?._id) {
      await postReversal({ entryId: firstReversal.reversalEntry._id, reason: `Auto-reversal: undo partial ${reason}`, userId: actorUserId }).catch(() => null);
    }
    throw e;
  }

  if (touchedAccountIds.size > 0) {
    await aggregateChartOfAccountBalances(String(row.business), Array.from(touchedAccountIds));
  }

  row.reversedAt = new Date();
  row.reversedBy = actorUserId;
  row.reversalReason = reason;
  row.status = "reversed";
};

const applyDraftOrPreDisbursementUpdates = async ({ row, req, businessId }) => {
  const advanceTypeBefore = normalizeAdvanceType(row.advanceType, row);

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
    const title = String(req.body?.title || "").trim();
    if (!title) {
      const error = new Error("Advance title is required");
      error.statusCode = 400;
      throw error;
    }
    row.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "advanceType")) {
    row.advanceType = normalizeAdvanceType(req.body?.advanceType, row);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "narration")) row.narration = String(req.body?.narration || "").trim();
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "notes")) row.notes = String(req.body?.notes || "").trim();
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "paymentMethod")) row.paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "cashbook")) row.cashbook = isValidObjectId(req.body?.cashbook) ? req.body?.cashbook : null;

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "amount")) {
    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      const error = new Error("Valid advance amount is required");
      error.statusCode = 400;
      throw error;
    }
    row.amount = round2(amount);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "frequency")) row.frequency = normalizeFrequency(req.body?.frequency);

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "dayOfMonth")) {
    const dayOfMonth = Number(req.body?.dayOfMonth || 0);
    row.dayOfMonth = Math.max(1, Math.min(31, dayOfMonth || row.dayOfMonth || 5));
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "disbursementDate")) {
    const disbursementDate = parseDate(req.body?.disbursementDate, null);
    if (!disbursementDate) {
      const error = new Error("Valid disbursement date is required");
      error.statusCode = 400;
      throw error;
    }
    row.disbursementDate = disbursementDate;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "startDate")) {
    const startDate = parseDate(req.body?.startDate, null);
    if (!startDate) {
      const error = new Error("Valid recovery start date is required");
      error.statusCode = 400;
      throw error;
    }
    row.startDate = startDate;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "periodMonths")) {
    row.periodMonths = normalizePeriodMonths(req.body?.periodMonths);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "gracePeriodMonths")) {
    row.gracePeriodMonths = normalizeGracePeriodMonths(req.body?.gracePeriodMonths);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "endDate")) {
    const endDate = parseDate(req.body?.endDate, null);
    if (endDate && row.startDate && endDate < row.startDate) {
      const error = new Error("Recovery end date cannot be earlier than start date");
      error.statusCode = 400;
      throw error;
    }
    row.endDate = endDate;
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "interestRate")) {
    row.interestRate = Math.max(Number(req.body?.interestRate || 0), 0);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "interestType")) {
    const interestType = String(req.body?.interestType || "").trim().toLowerCase();
    row.interestType = ["simple_flat", "reducing_balance"].includes(interestType) ? interestType : "simple_flat";
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "scheduledInterestTotal")) {
    row.scheduledInterestTotal = Math.max(Number(req.body?.scheduledInterestTotal || 0), 0);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "landlord") || Object.prototype.hasOwnProperty.call(req.body || {}, "property")) {
    const targetLandlord = Object.prototype.hasOwnProperty.call(req.body || {}, "landlord") ? req.body?.landlord : row.landlord;
    const targetProperty = Object.prototype.hasOwnProperty.call(req.body || {}, "property") ? req.body?.property : row.property;
    if (!isValidObjectId(targetLandlord) || !isValidObjectId(targetProperty)) {
      const error = new Error("Property and landlord are required");
      error.statusCode = 400;
      throw error;
    }
    const accountingContext = await resolvePropertyAccountingContext({ businessId, propertyId: targetProperty, landlordId: targetLandlord });
    row.landlord = accountingContext.landlordId;
    row.property = accountingContext.propertyId;
  }

  const advanceType = normalizeAdvanceType(row.advanceType, row);

  if (advanceType === "future_recoverable") {
    const scheduleWindow = resolveAdvancementScheduleWindow({
      startDate: row.startDate,
      endDate: row.endDate,
      periodMonths: row.periodMonths,
      gracePeriodMonths: row.gracePeriodMonths,
    });
    row.endDate = scheduleWindow.endDate || row.endDate;
    row.payableSnapshotAmount = 0;
  } else {
    row.startDate = row.disbursementDate || row.startDate;
    row.endDate = row.disbursementDate || row.endDate || row.startDate;
    row.periodMonths = null;
    row.gracePeriodMonths = 0;
    row.frequency = "monthly";
    row.dayOfMonth = Math.max(1, Math.min(31, Number(row.startDate ? new Date(row.startDate).getDate() : 5) || 5));
    row.interestRate = 0;
    row.scheduledInterestTotal = 0;
    row.interestRecoveredAmount = 0;
    row.totalRecoverableAmount = 0;
    row.recoveredAmount = 0;
    row.balanceOutstanding = 0;
    row.payableSnapshotAmount = await ensureAgainstPayableAmountIsSafe({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
      amount: row.amount,
    });
  }

  if (advanceTypeBefore !== advanceType && advanceType === "future_recoverable") {
    recalculateRecoveryBalances(row);
  }
};

const persistAndRespond = async (res, row, statusCode = 200) => {
  await row.save();
  const populated = await populateQuery(LandlordAdvancement.findById(row._id)).lean();
  res.status(statusCode).json(serializeAdvancement(populated));
};

const ensureSafeDeletion = (row) => {
  if (row.disbursedAt || (Array.isArray(row.recoveryHistory) && row.recoveryHistory.length > 0)) {
    const error = new Error("Posted or recovered landlord advances cannot be deleted. Cancel or reverse them instead to preserve the audit trail.");
    error.statusCode = 400;
    throw error;
  }
};

const handleStatusTransition = async ({ row, requestedStatus, req, businessId, actorUserId }) => {
  const nextStatus = normalizeRequestedStatus(requestedStatus);
  if (!WORKFLOW_STATUSES.includes(nextStatus)) {
    const error = new Error("Invalid landlord advance status");
    error.statusCode = 400;
    throw error;
  }

  const lifecycleStatus = resolveLifecycleStatus(row);
  const hasPosting = Boolean(row.disbursedAt || row.disbursementEntryId || row.disbursementOffsetEntryId);

  if (nextStatus === "draft") {
    if (hasPosting || getActiveRecoveryHistory(row).length > 0) {
      const error = new Error("A posted landlord advance cannot be moved back to draft.");
      error.statusCode = 400;
      throw error;
    }
    row.status = "draft";
    return;
  }

  if (nextStatus === "submitted") {
    if (hasPosting) {
      const error = new Error("A posted landlord advance cannot be resubmitted.");
      error.statusCode = 400;
      throw error;
    }
    row.status = "submitted";
    row.submittedAt = new Date();
    row.submittedBy = actorUserId;
    return;
  }

  if (nextStatus === "approved") {
    if (["cancelled", "rejected", "reversed", "cleared"].includes(lifecycleStatus)) {
      const error = new Error("This landlord advance cannot be approved in its current status.");
      error.statusCode = 400;
      throw error;
    }
    row.status = "approved";
    row.approvedAt = new Date();
    row.approvedBy = actorUserId;
    if (!row.submittedAt) {
      row.submittedAt = new Date();
      row.submittedBy = actorUserId;
    }
    return;
  }

  if (nextStatus === "rejected") {
    if (hasPosting) {
      const error = new Error("A posted landlord advance cannot be rejected. Reverse it instead.");
      error.statusCode = 400;
      throw error;
    }
    row.status = "rejected";
    row.rejectedAt = new Date();
    row.rejectedBy = actorUserId;
    row.rejectionReason = String(req.body?.reason || req.body?.rejectionReason || "").trim();
    return;
  }

  if (nextStatus === "cancelled") {
    if (hasPosting) {
      const error = new Error("A posted landlord advance cannot be cancelled. Reverse it instead.");
      error.statusCode = 400;
      throw error;
    }
    row.status = "cancelled";
    row.cancelledAt = new Date();
    row.cancelledBy = actorUserId;
    row.cancellationReason = String(req.body?.reason || req.body?.cancellationReason || "").trim();
    return;
  }

  if (nextStatus === "disbursed" || nextStatus === "recovering") {
    if (!row.disbursedAt) {
      await postDisbursementIfMissing({
        row,
        actorUserId,
        paymentMethod: row.paymentMethod,
        cashbook: row.cashbook,
      });
    } else {
      const advanceType = normalizeAdvanceType(row.advanceType, row);
      if (nextStatus === "recovering" && advanceType === "future_recoverable") {
        row.status = round2(Number(row.balanceOutstanding || 0)) > 0 ? "recovering" : "cleared";
      } else if (nextStatus === "disbursed" && advanceType === "future_recoverable") {
        row.status = round2(Number(row.balanceOutstanding || 0)) > 0 ? "recovering" : "cleared";
      } else {
        row.status = "disbursed";
      }
    }
    return;
  }

  if (nextStatus === "cleared") {
    const advanceType = normalizeAdvanceType(row.advanceType, row);
    if (advanceType === "future_recoverable" && round2(Number(row.balanceOutstanding || 0)) > 0) {
      const error = new Error("This recoverable advance still has an outstanding balance and cannot be marked cleared.");
      error.statusCode = 400;
      throw error;
    }
    if (!row.disbursedAt) {
      const error = new Error("Only a disbursed landlord advance can be cleared.");
      error.statusCode = 400;
      throw error;
    }
    row.status = "cleared";
    return;
  }

  if (nextStatus === "paused") {
    const advanceType = normalizeAdvanceType(row.advanceType, row);
    if (advanceType !== "future_recoverable" || !row.disbursedAt) {
      const error = new Error("Only a disbursed future recoverable advance can be paused.");
      error.statusCode = 400;
      throw error;
    }
    row.status = "paused";
    return;
  }

  if (nextStatus === "reversed") {
    if (!hasPosting) {
      const error = new Error("Only a posted landlord advance can be reversed.");
      error.statusCode = 400;
      throw error;
    }
    await reverseDisbursementIfPossible({
      row,
      businessId,
      actorUserId,
      reason:
        String(req.body?.reason || req.body?.reversalReason || "").trim() ||
        `Landlord advance ${row.referenceNo || row._id} reversed`,
    });
    return;
  }

  throw new Error("Unsupported landlord advance status transition.");
};

export const createLandlordAdvancement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const actorUserId = await resolveActorUserId(req, businessId);
    if (!isValidObjectId(req.body?.landlord)) return next(createError(400, "Landlord is required"));
    if (!isValidObjectId(req.body?.property)) return next(createError(400, "Property is required"));

    const accountingContext = await resolvePropertyAccountingContext({
      businessId,
      propertyId: req.body.property,
      landlordId: req.body.landlord,
    });

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return next(createError(400, "Valid advancement amount is required"));
    }

    const advanceType = normalizeAdvanceType(req.body?.advanceType);
    const disbursementDate = parseDate(req.body?.disbursementDate, new Date());
    const startDate = parseDate(req.body?.startDate, disbursementDate || new Date());
    const normalizedPeriodMonths = normalizePeriodMonths(req.body?.periodMonths);
    const normalizedGracePeriodMonths = normalizeGracePeriodMonths(req.body?.gracePeriodMonths);
    const scheduleWindow =
      advanceType === "future_recoverable"
        ? resolveAdvancementScheduleWindow({
            startDate,
            endDate: req.body?.endDate,
            periodMonths: normalizedPeriodMonths,
            gracePeriodMonths: normalizedGracePeriodMonths,
          })
        : {
            effectiveStartDate: disbursementDate,
            endDate: disbursementDate,
          };
    const endDate = parseDate(scheduleWindow.endDate, startDate);
    if (!startDate) return next(createError(400, "Valid recovery start date is required"));
    if (endDate && endDate < startDate) return next(createError(400, "Recovery end date cannot be earlier than start date"));

    const referenceNo = String(req.body?.referenceNo || "").trim() || (await generateReferenceNo(businessId));
    const requestedStatus = normalizeRequestedStatus(req.body?.status || "draft");
    const status = WORKFLOW_STATUSES.includes(requestedStatus) ? requestedStatus : "draft";
    const frequency = normalizeFrequency(req.body?.frequency);
    const dayOfMonth = Number(req.body?.dayOfMonth || startDate.getDate() || 5);
    const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);

    const title =
      String(req.body?.title || "").trim() ||
      (advanceType === "against_payable" ? "Landlord Advance - Early Payout" : "Landlord Advance - Recover from Next Statement");

    const row = new LandlordAdvancement({
      business: accountingContext.businessId,
      landlord: accountingContext.landlordId,
      property: accountingContext.propertyId,
      advanceType,
      title,
      referenceNo,
      amount: round2(amount),
      scheduledInterestTotal: advanceType === "future_recoverable" ? Math.max(Number(req.body?.scheduledInterestTotal || 0), 0) : 0,
      totalRecoverableAmount: advanceType === "future_recoverable" ? round2(amount + Number(req.body?.scheduledInterestTotal || 0)) : 0,
      recoveredAmount: 0,
      balanceOutstanding: advanceType === "future_recoverable" ? round2(amount + Number(req.body?.scheduledInterestTotal || 0)) : 0,
      frequency: advanceType === "future_recoverable" ? frequency : "monthly",
      dayOfMonth: Math.max(1, Math.min(31, dayOfMonth)),
      disbursementDate,
      startDate: advanceType === "future_recoverable" ? startDate : disbursementDate,
      periodMonths: advanceType === "future_recoverable" ? normalizedPeriodMonths : null,
      gracePeriodMonths: advanceType === "future_recoverable" ? normalizedGracePeriodMonths : 0,
      endDate: advanceType === "future_recoverable" ? endDate : disbursementDate,
      paymentMethod,
      cashbook: isValidObjectId(req.body?.cashbook) ? req.body.cashbook : null,
      status: ["disbursed", "recovering"].includes(status) ? "approved" : status,
      narration: String(req.body?.narration || "").trim(),
      notes: String(req.body?.notes || "").trim(),
      interestRate: advanceType === "future_recoverable" ? Math.max(Number(req.body?.interestRate || 0), 0) : 0,
      interestType: ["simple_flat", "reducing_balance"].includes(String(req.body?.interestType || "").trim().toLowerCase())
        ? String(req.body?.interestType || "").trim().toLowerCase()
        : "simple_flat",
      createdBy: actorUserId,
      updatedBy: actorUserId,
      recoveryHistory: [],
    });

    if (advanceType === "against_payable") {
      row.payableSnapshotAmount = await ensureAgainstPayableAmountIsSafe({
        businessId,
        propertyId: row.property,
        landlordId: row.landlord,
        amount: row.amount,
      });
    }

    if (status === "submitted") {
      row.submittedAt = new Date();
      row.submittedBy = actorUserId;
    }
    if (status === "approved" || ["disbursed", "recovering"].includes(status)) {
      row.approvedAt = new Date();
      row.approvedBy = actorUserId;
      row.submittedAt = row.submittedAt || new Date();
      row.submittedBy = row.submittedBy || actorUserId;
    }
    if (status === "rejected") {
      row.rejectedAt = new Date();
      row.rejectedBy = actorUserId;
      row.rejectionReason = String(req.body?.reason || req.body?.rejectionReason || "").trim();
    }
    if (status === "cancelled") {
      row.cancelledAt = new Date();
      row.cancelledBy = actorUserId;
      row.cancellationReason = String(req.body?.reason || req.body?.cancellationReason || "").trim();
    }

    if (["disbursed", "recovering"].includes(status)) {
      await postDisbursementIfMissing({
        row,
        actorUserId,
        paymentMethod,
        cashbook: row.cashbook,
      });
    }

    await persistAndRespond(res, row, 201);
  } catch (error) {
    if (error?.statusCode) {
      return next(createError(error.statusCode, error.message));
    }
    next(error);
  }
};

export const getLandlordAdvancements = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const filter = { business: businessId };
    if (req.query?.landlord && isValidObjectId(req.query.landlord)) filter.landlord = req.query.landlord;
    if (req.query?.property && isValidObjectId(req.query.property)) filter.property = req.query.property;
    if (req.query?.advanceType && req.query.advanceType !== "all") filter.advanceType = req.query.advanceType;
    if (req.query?.search) {
      const term = String(req.query.search).trim();
      filter.$or = [
        { referenceNo: { $regex: term, $options: "i" } },
        { title: { $regex: term, $options: "i" } },
        { narration: { $regex: term, $options: "i" } },
        { notes: { $regex: term, $options: "i" } },
      ];
    }

    const rows = await populateQuery(LandlordAdvancement.find(filter).sort({ createdAt: -1 })).lean();
    let serialized = serializeRows(rows);

    if (req.query?.status && req.query.status !== "all") {
      const requested = normalizeRequestedStatus(req.query.status);
      serialized = serialized.filter((row) => row.status === requested || String(row.legacyStatus || "").toLowerCase() === requested);
    }

    const { page: pageNum, limit: limitNum } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const total = serialized.length;
    const data = serialized.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (error) {
    next(error);
  }
};

export const updateLandlordAdvancement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Landlord advancement not found"));

    const hasAccountingHistory = Boolean(row.disbursedAt) || (Array.isArray(row.recoveryHistory) && row.recoveryHistory.length > 0);
    const structuralFields = [
      "amount",
      "advanceType",
      "landlord",
      "property",
      "startDate",
      "endDate",
      "periodMonths",
      "gracePeriodMonths",
      "frequency",
      "dayOfMonth",
      "disbursementDate",
    ];
    if (hasAccountingHistory && structuralFields.some((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field))) {
      return next(createError(400, "Posted or recovered landlord advances cannot change amount, type, property, landlord, or recovery schedule. Reverse and recreate if a structural correction is required."));
    }

    if (!hasAccountingHistory) {
      await applyDraftOrPreDisbursementUpdates({ row, req, businessId });
    } else {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
        const title = String(req.body?.title || "").trim();
        if (!title) return next(createError(400, "Advancement title is required"));
        row.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "narration")) row.narration = String(req.body?.narration || "").trim();
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "notes")) row.notes = String(req.body?.notes || "").trim();
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "paymentMethod")) row.paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "cashbook")) row.cashbook = isValidObjectId(req.body?.cashbook) ? req.body?.cashbook : null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
      await handleStatusTransition({
        row,
        requestedStatus: req.body?.status,
        req,
        businessId,
        actorUserId,
      });
    } else {
      row.status = resolveLifecycleStatus(row);
    }

    row.updatedBy = actorUserId;
    await persistAndRespond(res, row, 200);
  } catch (error) {
    if (error?.statusCode) {
      return next(createError(error.statusCode, error.message));
    }
    next(error);
  }
};

export const updateLandlordAdvancementStatus = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));
    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Landlord advancement not found"));

    await handleStatusTransition({
      row,
      requestedStatus: req.body?.status,
      req,
      businessId,
      actorUserId,
    });

    row.updatedBy = actorUserId;
    await persistAndRespond(res, row, 200);
  } catch (error) {
    if (error?.statusCode) {
      return next(createError(error.statusCode, error.message));
    }
    next(error);
  }
};

export const processLandlordAdvancementRecovery = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));
    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Landlord advancement not found"));

    const advanceType = normalizeAdvanceType(row.advanceType, row);
    if (advanceType !== "future_recoverable") {
      return next(createError(400, "Against payable advances are already treated as paid to the landlord and do not support statement recoveries."));
    }

    if (!row.disbursedAt) {
      return next(createError(400, "Advance must be disbursed before recoveries can be processed."));
    }

    const lifecycleStatus = resolveLifecycleStatus(row);
    if (!["recovering", "disbursed", "paused"].includes(lifecycleStatus)) {
      return next(createError(400, "This landlord advance cannot be recovered in its current status."));
    }

    const selectedPeriod = resolveSelectedRecoveryPeriod(row, req.body || {});
    if (!selectedPeriod) {
      return next(createError(400, "No eligible recovery period is available. Future and already processed periods are blocked."));
    }

    const alreadyProcessed = getActiveRecoveryHistory(row).some(
      (item) => String(item?.periodKey || getPeriodKey(item?.dueDate || item?.processedAt, row.frequency)) === selectedPeriod.periodKey
    );
    if (alreadyProcessed) {
      return next(createError(400, `Recovery already processed for ${selectedPeriod.periodLabel}.`));
    }

    const closedPeriod = await isPeriodClosedByProcessedStatement({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
      periodStart: selectedPeriod.periodStart,
      periodEnd: selectedPeriod.periodEnd,
    });
    if (closedPeriod) {
      return next(createError(400, `Cannot process ${selectedPeriod.periodLabel} because that statement period has already been processed/closed. Reverse or reopen the affected statement first.`));
    }

    const amount = Number(req.body?.amount || selectedPeriod.scheduledAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Valid recovery amount is required"));
    if (round2(amount) > round2(row.balanceOutstanding || 0)) {
      return next(createError(400, "Recovery amount cannot exceed outstanding recoverable advance balance."));
    }

    const accountingContext = await resolvePropertyAccountingContext({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
    });
    const remittancePayableAccount = await resolveLandlordRemittancePayableAccount(businessId);
    const advanceRecoverableAccount = await resolveAdvanceRecoverableAccount(businessId);
    if (!remittancePayableAccount?._id || !advanceRecoverableAccount?._id) {
      return next(createError(400, "Advancement recovery posting accounts could not be resolved."));
    }

    const processedAt = normalizeToStartOfDay(req.body?.processedAt || req.body?.runDate || selectedPeriod.dueDate || new Date());
    const journalGroupId = new mongoose.Types.ObjectId();
    const sourceTransactionId = `${row._id}:${selectedPeriod.periodKey}`;
    const notes = String(req.body?.note || row.narration || row.title || "Recoverable landlord advance recovery").trim();

    let visibleEntry, offsetEntry;
    try {
      visibleEntry = await postEntry({
        business: accountingContext.businessId,
        property: accountingContext.propertyId,
        landlord: accountingContext.landlordId,
        sourceTransactionType: "advance",
        sourceTransactionId,
        transactionDate: processedAt,
        statementPeriodStart: selectedPeriod.periodStart,
        statementPeriodEnd: selectedPeriod.periodEnd,
        category: "ADJUSTMENT",
        amount: round2(amount),
        direction: "debit",
        accountId: remittancePayableAccount._id,
        journalGroupId,
        payer: "manager",
        receiver: "landlord",
        notes,
        metadata: {
          includeInLandlordStatement: true,
          statementBucket: "advance_recovery",
          advancementId: String(row._id),
          referenceNo: row.referenceNo,
          advanceType,
          periodKey: selectedPeriod.periodKey,
          periodLabel: selectedPeriod.periodLabel,
          postingKind: "landlord_advancement_recovery",
        },
        createdBy: actorUserId,
        approvedBy: actorUserId,
        approvedAt: processedAt,
        status: "approved",
      });

      offsetEntry = await postEntry({
        business: accountingContext.businessId,
        property: accountingContext.propertyId,
        landlord: accountingContext.landlordId,
        sourceTransactionType: "advance",
        sourceTransactionId,
        transactionDate: processedAt,
        statementPeriodStart: selectedPeriod.periodStart,
        statementPeriodEnd: selectedPeriod.periodEnd,
        category: "ADVANCE_RECOVERY",
        amount: round2(amount),
        direction: "credit",
        accountId: advanceRecoverableAccount._id,
        journalGroupId,
        payer: "manager",
        receiver: "system",
        notes,
        metadata: {
          includeInLandlordStatement: false,
          advancementId: String(row._id),
          referenceNo: row.referenceNo,
          advanceType,
          periodKey: selectedPeriod.periodKey,
          periodLabel: selectedPeriod.periodLabel,
          postingKind: "landlord_advancement_recoverable_offset",
        },
        createdBy: actorUserId,
        approvedBy: actorUserId,
        approvedAt: processedAt,
        status: "approved",
      });
    } catch (error) {
      if (visibleEntry?._id) {
        await postReversal({ entryId: visibleEntry._id, reason: `Auto-reversal: GL balance protection for advancement recovery ${row.referenceNo || row._id}`, userId: actorUserId }).catch(() => null);
      }
      throw error;
    }

    row.recoveryHistory.unshift({
      processedAt,
      dueDate: selectedPeriod.dueDate,
      periodStart: selectedPeriod.periodStart,
      periodEnd: selectedPeriod.periodEnd,
      periodKey: selectedPeriod.periodKey,
      periodLabel: selectedPeriod.periodLabel,
      amount: round2(amount),
      principalAmount: round2(amount),
      interestAmount: 0,
      note: notes,
      referenceNo: `${row.referenceNo}-${selectedPeriod.periodKey}`,
      processedBy: actorUserId,
      journalGroupId,
      visibleStatementEntryId: visibleEntry._id,
      offsetEntryId: offsetEntry._id,
      cancelledAt: null,
      cancelledBy: null,
      cancellationReason: "",
    });
    recalculateRecoveryBalances(row);
    row.updatedBy = actorUserId;

    await aggregateChartOfAccountBalances(String(row.business), [
      String(remittancePayableAccount._id),
      String(advanceRecoverableAccount._id),
    ]);

    await persistAndRespond(res, row, 200);
  } catch (error) {
    next(error);
  }
};

export const cancelLandlordAdvancementRecovery = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Landlord advancement not found"));

    const recoveryId = String(req.params.recoveryId || req.body?.recoveryId || "").trim();
    const periodKey = String(req.body?.periodKey || "").trim();
    const recoveryRow = recoveryId
      ? row.recoveryHistory.id(recoveryId)
      : row.recoveryHistory.find((item) => getRecoveryPeriodKey(item, row.frequency) === periodKey);

    if (!recoveryRow) {
      return next(createError(404, "Processed recovery period not found on this advancement."));
    }

    if (recoveryRow.cancelledAt) {
      return next(createError(400, "This recovery period has already been cancelled."));
    }

    const closedPeriod = await isPeriodClosedByProcessedStatement({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
      periodStart: recoveryRow.periodStart || recoveryRow.dueDate || row.startDate,
      periodEnd: recoveryRow.periodEnd || recoveryRow.dueDate || row.startDate,
    });

    if (closedPeriod) {
      return next(createError(400, "This recovery period already belongs to a processed landlord statement. Reverse or reopen the affected processed statement first."));
    }

    const reason =
      String(req.body?.reason || "").trim() ||
      `Recoverable landlord advance recovery ${recoveryRow.periodLabel || recoveryRow.periodKey || "period"} cancelled`;

    const touchedAccountIds = new Set();
    const reverseOne = async (entryId) => {
      if (!entryId || !isValidObjectId(entryId)) return null;
      const originalEntry = await FinancialLedgerEntry.findOne({
        _id: entryId,
        business: businessId,
        reversalOf: null,
        status: { $nin: ["void"] },
      }).select("_id accountId status reversedByEntry");
      if (!originalEntry || originalEntry.reversedByEntry || originalEntry.status === "reversed") return null;
      if (originalEntry?.accountId) touchedAccountIds.add(String(originalEntry.accountId));
      const reversal = await postReversal({ entryId: originalEntry._id, reason, userId: actorUserId });
      if (reversal?.reversalEntry?.accountId) {
        touchedAccountIds.add(String(reversal.reversalEntry.accountId));
      }
      return reversal;
    };

    const firstRecoveryReversal = await reverseOne(recoveryRow.visibleStatementEntryId);
    try {
      await reverseOne(recoveryRow.offsetEntryId);
    } catch (e) {
      if (firstRecoveryReversal?.reversalEntry?._id) {
        await postReversal({ entryId: firstRecoveryReversal.reversalEntry._id, reason: `Auto-reversal: undo partial ${reason}`, userId: actorUserId }).catch(() => null);
      }
      throw e;
    }

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(String(row.business), Array.from(touchedAccountIds));
    }

    recoveryRow.cancelledAt = new Date();
    recoveryRow.cancelledBy = actorUserId;
    recoveryRow.cancellationReason = reason;
    row.updatedBy = actorUserId;
    recalculateRecoveryBalances(row);

    await persistAndRespond(res, row, 200);
  } catch (error) {
    next(error);
  }
};

export const deleteLandlordAdvancement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Company context is required"));
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return next(createError(404, "Landlord advancement not found"));

    ensureSafeDeletion(row);

    await LandlordAdvancement.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({ success: true, message: "Landlord advancement deleted" });
  } catch (error) {
    if (error?.statusCode) {
      return next(createError(error.statusCode, error.message));
    }
    next(error);
  }
};
