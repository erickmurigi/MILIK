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

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const oid = (value) => new mongoose.Types.ObjectId(String(value));

const resolveBusinessId = (req) =>
  req?.query?.business ||
  req?.query?.company ||
  req?.body?.business ||
  req?.body?.company ||
  req?.user?.company?._id ||
  req?.user?.company ||
  null;

const normalizePaymentMethod = (value) => {
  const normalized = String(value || "bank_transfer").trim().toLowerCase();
  if (normalized === "mpesa") return "mobile_money";
  if (normalized === "cheque") return "check";
  if (["bank_transfer", "mobile_money", "cash", "check", "credit_card", "other"].includes(normalized)) {
    return normalized;
  }
  return "bank_transfer";
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
    .populate("recoveryHistory.processedBy", "username email firstName lastName");

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

const recalculateRecoveryBalances = (row) => {
  const activeHistory = getActiveRecoveryHistory(row);
  const recoveredPrincipal = round2(
    activeHistory.reduce((sum, item) => sum + Number(item?.principalAmount || item?.amount || 0), 0)
  );
  const recoveredInterest = round2(
    activeHistory.reduce((sum, item) => sum + Number(item?.interestAmount || 0), 0)
  );

  row.recoveredAmount = recoveredPrincipal;
  row.interestRecoveredAmount = recoveredInterest;
  row.balanceOutstanding = round2(
    Number(row.totalRecoverableAmount || row.amount || 0) -
      Number(row.recoveredAmount || 0) -
      Number(row.interestRecoveredAmount || 0)
  );

  if (row.balanceOutstanding <= 0) {
    row.status = "completed";
  } else if (String(row.status || "") === "completed") {
    row.status = "active";
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
    return start && end && start.getTime() <= normalizeToStartOfDay(periodStart).getTime() && end.getTime() >= normalizeToEndOfDay(periodEnd).getTime();
  });
};

const computeSchedule = (row) => {
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

  const installmentCount = Math.max(schedule.length || 1, 1);
  const baseInstallment = installmentCount > 0 ? round2(Number(row.amount || 0) / installmentCount) : round2(row.amount || 0);

  let scheduledTotal = 0;
  const scheduleWithAmounts = schedule.map((item, index) => {
    const isLast = index === schedule.length - 1;
    const amount = isLast ? round2(Number(row.amount || 0) - scheduledTotal) : baseInstallment;
    scheduledTotal = round2(scheduledTotal + amount);
    const processedEntry = getActiveRecoveryHistory(row).find(
      (history) => String(history?.periodKey || "") === item.periodKey
    );

    return {
      ...item,
      scheduledAmount: amount,
      processed: processedKeys.has(item.periodKey),
      processedAt: processedEntry?.processedAt || null,
      processedAmount: processedEntry ? round2(processedEntry.amount || 0) : 0,
      referenceNo: processedEntry?.referenceNo || "",
    };
  });

  return scheduleWithAmounts;
};

const serializeAdvancement = (row) => {
  const plain = typeof row?.toObject === "function" ? row.toObject({ virtuals: true }) : { ...(row || {}) };
  const scheduleWindow = resolveAdvancementScheduleWindow({
    startDate: plain.startDate,
    endDate: plain.endDate,
    periodMonths: plain.periodMonths,
    gracePeriodMonths: plain.gracePeriodMonths,
  });
  const schedule = computeSchedule(plain);
  const activeHistory = getActiveRecoveryHistory(plain);
  const cancelledHistory = getCancelledRecoveryHistory(plain);
  const eligiblePeriods = filterEligibleSchedule({
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
  }));

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

  return {
    ...plain,
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
  const advanceRecoverableAccount = await resolveAdvanceRecoverableAccount(row.business);
  const cashbookAccount = await resolveCashbookAccount({ businessId: row.business, cashbook, paymentMethod });

  if (!advanceRecoverableAccount?._id || !cashbookAccount?._id) {
    throw new Error("Landlord advancement posting accounts could not be resolved.");
  }

  const journalGroupId = new mongoose.Types.ObjectId();
  const notes = String(row.narration || row.title || "Landlord advancement disbursement").trim();

  const debitEntry = await postEntry({
    business: accountingContext.businessId,
    property: accountingContext.propertyId,
    landlord: accountingContext.landlordId,
    sourceTransactionType: "advance",
    sourceTransactionId: String(row._id),
    transactionDate: row.disbursementDate,
    statementPeriodStart: row.startDate,
    statementPeriodEnd: row.startDate,
    category: "ADVANCE_TO_LANDLORD",
    amount: round2(row.amount || 0),
    direction: "debit",
    accountId: advanceRecoverableAccount._id,
    journalGroupId,
    payer: "manager",
    receiver: "landlord",
    notes,
    metadata: {
      advancementId: String(row._id),
      referenceNo: row.referenceNo,
      postingKind: "landlord_advancement_disbursement",
      includeInLandlordStatement: false,
    },
    createdBy: actorUserId,
    approvedBy: actorUserId,
    approvedAt: row.disbursementDate,
    status: "approved",
  });

  const creditEntry = await postEntry({
    business: accountingContext.businessId,
    property: accountingContext.propertyId,
    landlord: accountingContext.landlordId,
    sourceTransactionType: "advance",
    sourceTransactionId: String(row._id),
    transactionDate: row.disbursementDate,
    statementPeriodStart: row.startDate,
    statementPeriodEnd: row.startDate,
    category: "ADVANCE_TO_LANDLORD",
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
      postingKind: "landlord_advancement_cashbook_offset",
      includeInLandlordStatement: false,
      paymentMethod,
    },
    createdBy: actorUserId,
    approvedBy: actorUserId,
    approvedAt: row.disbursementDate,
    status: "approved",
  });

  row.disbursementJournalGroupId = journalGroupId;
  row.disbursementEntryId = debitEntry._id;
  row.disbursementOffsetEntryId = creditEntry._id;
  row.disbursedAt = row.disbursementDate;
};

export const createLandlordAdvancement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const actorUserId = await resolveActorUserId(req, businessId);
    if (!isValidObjectId(req.body?.landlord)) return res.status(400).json({ success: false, message: "Landlord is required" });
    if (!isValidObjectId(req.body?.property)) return res.status(400).json({ success: false, message: "Property is required" });

    const accountingContext = await resolvePropertyAccountingContext({
      businessId,
      propertyId: req.body.property,
      landlordId: req.body.landlord,
    });

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid advancement amount is required" });
    }

    const title = String(req.body?.title || req.body?.narration || "Landlord Advancement").trim();
    const disbursementDate = parseDate(req.body?.disbursementDate, new Date());
    const startDate = parseDate(req.body?.startDate, disbursementDate || new Date());
    const normalizedPeriodMonths = normalizePeriodMonths(req.body?.periodMonths);
    const normalizedGracePeriodMonths = normalizeGracePeriodMonths(req.body?.gracePeriodMonths);
    const scheduleWindow = resolveAdvancementScheduleWindow({
      startDate,
      endDate: req.body?.endDate,
      periodMonths: normalizedPeriodMonths,
      gracePeriodMonths: normalizedGracePeriodMonths,
    });
    const endDate = parseDate(scheduleWindow.endDate, startDate);
    if (!startDate) return res.status(400).json({ success: false, message: "Valid recovery start date is required" });
    if (endDate && endDate < startDate) return res.status(400).json({ success: false, message: "Recovery end date cannot be earlier than start date" });

    const referenceNo = String(req.body?.referenceNo || "").trim() || (await generateReferenceNo(businessId));
    const status = ["draft", "active", "paused", "completed", "cancelled"].includes(String(req.body?.status || "").toLowerCase())
      ? String(req.body?.status || "").toLowerCase()
      : "draft";
    const frequency = normalizeFrequency(req.body?.frequency);
    const dayOfMonth = Number(req.body?.dayOfMonth || startDate.getDate() || 5);
    const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);

    const row = new LandlordAdvancement({
      business: accountingContext.businessId,
      landlord: accountingContext.landlordId,
      property: accountingContext.propertyId,
      title,
      referenceNo,
      amount: round2(amount),
      recoveredAmount: 0,
      balanceOutstanding: round2(amount),
      frequency,
      dayOfMonth: Math.max(1, Math.min(31, dayOfMonth)),
      disbursementDate,
      startDate,
      periodMonths: normalizedPeriodMonths,
      gracePeriodMonths: normalizedGracePeriodMonths,
      endDate,
      paymentMethod,
      cashbook: isValidObjectId(req.body?.cashbook) ? req.body.cashbook : null,
      status,
      narration: String(req.body?.narration || "").trim(),
      notes: String(req.body?.notes || "").trim(),
      createdBy: actorUserId,
      updatedBy: actorUserId,
      recoveryHistory: [],
    });

    if (status === "active") {
      await postDisbursementIfMissing({
        row,
        actorUserId,
        paymentMethod,
        cashbook: row.cashbook,
      });
    }

    await row.save();
    const populated = await populateQuery(LandlordAdvancement.findById(row._id));
    res.status(201).json(serializeAdvancement(await populated));
  } catch (error) {
    next(error);
  }
};

export const getLandlordAdvancements = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const filter = { business: businessId };
    if (req.query?.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query?.landlord && isValidObjectId(req.query.landlord)) filter.landlord = req.query.landlord;
    if (req.query?.property && isValidObjectId(req.query.property)) filter.property = req.query.property;
    if (req.query?.search) {
      const term = String(req.query.search).trim();
      filter.$or = [
        { referenceNo: { $regex: term, $options: "i" } },
        { title: { $regex: term, $options: "i" } },
        { narration: { $regex: term, $options: "i" } },
        { notes: { $regex: term, $options: "i" } },
      ];
    }

    const rows = await populateQuery(LandlordAdvancement.find(filter).sort({ createdAt: -1 }));
    res.status(200).json(serializeRows(await rows));
  } catch (error) {
    next(error);
  }
};

export const updateLandlordAdvancement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Landlord advancement not found" });

    const hasAccountingHistory = Boolean(row.disbursedAt) || (Array.isArray(row.recoveryHistory) && row.recoveryHistory.length > 0);
    const structuralFields = ["amount", "landlord", "property", "startDate", "endDate", "periodMonths", "gracePeriodMonths", "frequency", "dayOfMonth", "disbursementDate"];
    if (hasAccountingHistory && structuralFields.some((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field))) {
      return res.status(400).json({
        success: false,
        message: "Posted or recovered advancements cannot change amount, property, landlord, or schedule. Create a new advancement or reverse the existing accounting history first.",
      });
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
      const title = String(req.body?.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "Advancement title is required" });
      row.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "narration")) row.narration = String(req.body?.narration || "").trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "notes")) row.notes = String(req.body?.notes || "").trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "paymentMethod")) row.paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "cashbook")) row.cashbook = isValidObjectId(req.body?.cashbook) ? req.body.cashbook : null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
      const status = String(req.body?.status || "").toLowerCase();
      if (!["draft", "active", "paused", "completed", "cancelled"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid advancement status" });
      }
      row.status = status;
    }

    if (!hasAccountingHistory) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "amount")) {
        const amount = Number(req.body?.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "Valid advancement amount is required" });
        row.amount = round2(amount);
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "frequency")) row.frequency = normalizeFrequency(req.body?.frequency);
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "dayOfMonth")) {
        const dayOfMonth = Number(req.body?.dayOfMonth || 0);
        row.dayOfMonth = Math.max(1, Math.min(31, dayOfMonth || row.dayOfMonth || 5));
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "disbursementDate")) {
        const disbursementDate = parseDate(req.body?.disbursementDate, null);
        if (!disbursementDate) return res.status(400).json({ success: false, message: "Valid disbursement date is required" });
        row.disbursementDate = disbursementDate;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "startDate")) {
        const startDate = parseDate(req.body?.startDate, null);
        if (!startDate) return res.status(400).json({ success: false, message: "Valid recovery start date is required" });
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
        if (endDate && row.startDate && endDate < row.startDate) return res.status(400).json({ success: false, message: "Recovery end date cannot be earlier than start date" });
        row.endDate = endDate;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "landlord") || Object.prototype.hasOwnProperty.call(req.body || {}, "property")) {
        const targetLandlord = Object.prototype.hasOwnProperty.call(req.body || {}, "landlord") ? req.body?.landlord : row.landlord;
        const targetProperty = Object.prototype.hasOwnProperty.call(req.body || {}, "property") ? req.body?.property : row.property;
        if (!isValidObjectId(targetLandlord) || !isValidObjectId(targetProperty)) {
          return res.status(400).json({ success: false, message: "Property and landlord are required" });
        }
        const accountingContext = await resolvePropertyAccountingContext({ businessId, propertyId: targetProperty, landlordId: targetLandlord });
        row.landlord = accountingContext.landlordId;
        row.property = accountingContext.propertyId;
      }

      if (
        Object.prototype.hasOwnProperty.call(req.body || {}, "startDate") ||
        Object.prototype.hasOwnProperty.call(req.body || {}, "endDate") ||
        Object.prototype.hasOwnProperty.call(req.body || {}, "periodMonths") ||
        Object.prototype.hasOwnProperty.call(req.body || {}, "gracePeriodMonths")
      ) {
        const scheduleWindow = resolveAdvancementScheduleWindow({
          startDate: row.startDate,
          endDate: row.endDate,
          periodMonths: row.periodMonths,
          gracePeriodMonths: row.gracePeriodMonths,
        });
        row.endDate = scheduleWindow.endDate || row.endDate;
      }
    }

    if (row.status === "active" && !row.disbursedAt) {
      await postDisbursementIfMissing({
        row,
        actorUserId,
        paymentMethod: row.paymentMethod,
        cashbook: row.cashbook,
      });
    }

    row.updatedBy = actorUserId;
    await row.save();
    const populated = await populateQuery(LandlordAdvancement.findById(row._id));
    res.status(200).json(serializeAdvancement(await populated));
  } catch (error) {
    next(error);
  }
};

export const updateLandlordAdvancementStatus = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });
    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Landlord advancement not found" });

    const status = String(req.body?.status || "").toLowerCase();
    if (!["draft", "active", "paused", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid advancement status" });
    }
    row.status = status;
    row.updatedBy = actorUserId;

    if (status === "active" && !row.disbursedAt) {
      await postDisbursementIfMissing({ row, actorUserId, paymentMethod: row.paymentMethod, cashbook: row.cashbook });
    }

    await row.save();
    const populated = await populateQuery(LandlordAdvancement.findById(row._id));
    res.status(200).json(serializeAdvancement(await populated));
  } catch (error) {
    next(error);
  }
};

export const processLandlordAdvancementRecovery = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });
    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Landlord advancement not found" });

    if (!row.disbursedAt) {
      return res.status(400).json({ success: false, message: "Advancement must be disbursed/activated before recoveries can be processed." });
    }
    if (!["active", "paused", "draft"].includes(String(row.status || ""))) {
      return res.status(400).json({ success: false, message: "This advancement cannot be recovered in its current status." });
    }

    const selectedPeriod = resolveSelectedRecoveryPeriod(row, req.body || {});
    if (!selectedPeriod) {
      return res.status(400).json({ success: false, message: "No eligible recovery period is available. Future and already processed periods are blocked." });
    }

    const alreadyProcessed = getActiveRecoveryHistory(row).some(
      (item) => String(item?.periodKey || getPeriodKey(item?.dueDate || item?.processedAt, row.frequency)) === selectedPeriod.periodKey
    );
    if (alreadyProcessed) {
      return res.status(400).json({ success: false, message: `Recovery already processed for ${selectedPeriod.periodLabel}.` });
    }

    const closedPeriod = await isPeriodClosedByProcessedStatement({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
      periodStart: selectedPeriod.periodStart,
      periodEnd: selectedPeriod.periodEnd,
    });
    if (closedPeriod) {
      return res.status(400).json({
        success: false,
        message: `Cannot process ${selectedPeriod.periodLabel} because that statement period has already been processed/closed. Reverse or reopen the affected statement first.`,
      });
    }

    const amount = Number(req.body?.amount || selectedPeriod.scheduledAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "Valid recovery amount is required" });
    if (round2(amount) > round2(row.balanceOutstanding || 0)) {
      return res.status(400).json({ success: false, message: "Recovery amount cannot exceed outstanding advancement balance." });
    }

    const accountingContext = await resolvePropertyAccountingContext({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
    });
    const remittancePayableAccount = await resolveLandlordRemittancePayableAccount(businessId);
    const advanceRecoverableAccount = await resolveAdvanceRecoverableAccount(businessId);
    if (!remittancePayableAccount?._id || !advanceRecoverableAccount?._id) {
      return res.status(400).json({ success: false, message: "Advancement recovery posting accounts could not be resolved." });
    }

    const processedAt = normalizeToStartOfDay(req.body?.processedAt || req.body?.runDate || selectedPeriod.dueDate || new Date());
    const journalGroupId = new mongoose.Types.ObjectId();
    const sourceTransactionId = `${row._id}:${selectedPeriod.periodKey}`;
    const notes = String(req.body?.note || row.narration || row.title || "Landlord advancement recovery").trim();

    const visibleEntry = await postEntry({
      business: accountingContext.businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      sourceTransactionType: "other",
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
        statementBucket: "deduction",
        advancementId: String(row._id),
        referenceNo: row.referenceNo,
        periodKey: selectedPeriod.periodKey,
        periodLabel: selectedPeriod.periodLabel,
        postingKind: "landlord_advancement_recovery",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: processedAt,
      status: "approved",
    });

    const offsetEntry = await postEntry({
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
        periodKey: selectedPeriod.periodKey,
        periodLabel: selectedPeriod.periodLabel,
        postingKind: "landlord_advancement_recoverable_offset",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: processedAt,
      status: "approved",
    });

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
    if (row.status === "draft") row.status = "active";

    await row.save();
    const populated = await populateQuery(LandlordAdvancement.findById(row._id));
    res.status(200).json(serializeAdvancement(await populated));
  } catch (error) {
    next(error);
  }
};

export const cancelLandlordAdvancementRecovery = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Landlord advancement not found" });

    const recoveryId = String(req.params.recoveryId || req.body?.recoveryId || "").trim();
    const periodKey = String(req.body?.periodKey || "").trim();
    const recoveryRow = recoveryId
      ? row.recoveryHistory.id(recoveryId)
      : row.recoveryHistory.find((item) => getRecoveryPeriodKey(item, row.frequency) === periodKey);

    if (!recoveryRow) {
      return res.status(404).json({ success: false, message: "Processed recovery period not found on this advancement." });
    }

    if (recoveryRow.cancelledAt) {
      return res.status(400).json({ success: false, message: "This recovery period has already been cancelled." });
    }

    const closedPeriod = await isPeriodClosedByProcessedStatement({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
      periodStart: recoveryRow.periodStart || recoveryRow.dueDate || row.startDate,
      periodEnd: recoveryRow.periodEnd || recoveryRow.dueDate || row.startDate,
    });

    if (closedPeriod) {
      return res.status(400).json({
        success: false,
        message:
          "This recovery period already belongs to a processed landlord statement. Reverse or reopen the affected processed statement first.",
      });
    }

    const reason =
      String(req.body?.reason || "").trim() ||
      `Advancement recovery ${recoveryRow.periodLabel || recoveryRow.periodKey || "period"} cancelled`;

    const touchedAccountIds = new Set();
    const reverseOne = async (entryId) => {
      if (!entryId || !isValidObjectId(entryId)) return null;
      const originalEntry = await FinancialLedgerEntry.findOne({
        _id: entryId,
        business: businessId,
        reversalOf: null,
        status: "approved",
      }).select("_id accountId");
      if (!originalEntry) return null;
      if (originalEntry?.accountId) touchedAccountIds.add(String(originalEntry.accountId));
      const reversal = await postReversal({ entryId: originalEntry._id, reason, userId: actorUserId });
      if (reversal?.reversalEntry?.accountId) {
        touchedAccountIds.add(String(reversal.reversalEntry.accountId));
      }
      return reversal;
    };

    await reverseOne(recoveryRow.visibleStatementEntryId);
    await reverseOne(recoveryRow.offsetEntryId);

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(String(row.business), Array.from(touchedAccountIds));
    }

    recoveryRow.cancelledAt = new Date();
    recoveryRow.cancelledBy = actorUserId;
    recoveryRow.cancellationReason = reason;
    row.updatedBy = actorUserId;
    recalculateRecoveryBalances(row);
    await row.save();

    const populated = await populateQuery(LandlordAdvancement.findById(row._id));
    res.status(200).json(serializeAdvancement(await populated));
  } catch (error) {
    next(error);
  }
};

export const deleteLandlordAdvancement = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });
    const row = await LandlordAdvancement.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Landlord advancement not found" });

    if (row.disbursedAt || (Array.isArray(row.recoveryHistory) && row.recoveryHistory.length > 0)) {
      return res.status(400).json({ success: false, message: "Posted or recovered advancements cannot be deleted. Preserve the audit trail and cancel or complete the record instead." });
    }

    await LandlordAdvancement.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({ success: true, message: "Landlord advancement deleted" });
  } catch (error) {
    next(error);
  }
};
