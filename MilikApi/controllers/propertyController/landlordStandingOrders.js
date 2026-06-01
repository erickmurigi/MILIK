import mongoose from "mongoose";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import LandlordStandingOrder from "../../models/LandlordStandingOrder.js";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { resolveLandlordRemittancePayableAccount, resolvePropertyAccountingContext } from "../../services/propertyAccountingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import {
  addFrequency,
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

const buildDestination = (payload = {}, existing = {}) => ({
  accountName: String(payload?.accountName ?? existing?.accountName ?? "").trim(),
  accountNumber: String(payload?.accountNumber ?? existing?.accountNumber ?? "").trim(),
  bankName: String(payload?.bankName ?? existing?.bankName ?? "").trim(),
  branchName: String(payload?.branchName ?? existing?.branchName ?? "").trim(),
  mobileNumber: String(payload?.mobileNumber ?? existing?.mobileNumber ?? "").trim(),
});

const validateDestination = ({ paymentMethod, destination }) => {
  const normalizedMethod = normalizePaymentMethod(paymentMethod);
  if (normalizedMethod === "mobile_money") {
    if (!String(destination?.mobileNumber || "").trim()) {
      return "M-Pesa / mobile money standing orders require a destination mobile number.";
    }
  }

  if (["bank_transfer", "check", "credit_card"].includes(normalizedMethod)) {
    const hasAccountName = Boolean(String(destination?.accountName || "").trim());
    const hasBankName = Boolean(String(destination?.bankName || "").trim());
    const hasAccountNumber = Boolean(String(destination?.accountNumber || "").trim());
    if (!hasAccountName || (!hasBankName && !hasAccountNumber)) {
      return "Bank standing orders require the payee name and either bank name or account number.";
    }
  }

  return "";
};

const getActiveRunHistory = (runHistory = [], frequency = "monthly") =>
  (Array.isArray(runHistory) ? runHistory : []).filter((item) => {
    if (!item) return false;
    if (item.cancelledAt) return false;
    if (String(item?.status || "").toLowerCase() === "cancelled") return false;
    const periodKey = String(item?.periodKey || getPeriodKey(item?.dueDate || item?.runDate, frequency) || "").trim();
    return Boolean(periodKey);
  });

const recalculateRunSummary = (row) => {
  const activeRuns = getActiveRunHistory(row?.runHistory, row?.frequency);
  const sortedRuns = [...activeRuns].sort((left, right) => {
    const leftDate = normalizeToStartOfDay(left?.runDate || left?.dueDate || null);
    const rightDate = normalizeToStartOfDay(right?.runDate || right?.dueDate || null);
    return (rightDate?.getTime?.() || 0) - (leftDate?.getTime?.() || 0);
  });
  const latestRun = sortedRuns[0] || null;

  row.totalRuns = activeRuns.length;
  row.totalProcessedAmount = round2(
    activeRuns.reduce((sum, item) => sum + Number(item?.amount || 0), 0)
  );
  row.lastRunAt = latestRun?.runDate || null;
  row.lastRunDate = latestRun?.runDate || null;
};

const generateOrderNo = async (businessId) => {
  const prefix = "LSO";
  const last = await LandlordStandingOrder.findOne(
    {
      business: businessId,
      $or: [
        { standingOrderNo: { $regex: `^${prefix}\\d+$` } },
        { referenceNo: { $regex: `^${prefix}\\d+$` } },
      ],
    },
    { standingOrderNo: 1, referenceNo: 1 },
    { sort: { createdAt: -1 } }
  ).lean();

  const lastNo = last?.standingOrderNo || last?.referenceNo || "";
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
    .populate("runHistory.processedBy", "username email firstName lastName")
    .populate("runHistory.cancelledBy", "username email firstName lastName");

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for landlord standing order posting.",
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

const statementCursorFor = (statement) => {
  const cursor = statement?.cutoffAt || statement?.periodEnd || null;
  return cursor ? normalizeToEndOfDay(cursor) : null;
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

const serializeStandingOrder = (row) => {
  const plain = typeof row?.toObject === "function" ? row.toObject({ virtuals: true }) : { ...(row || {}) };
  const activeRunHistory = getActiveRunHistory(plain.runHistory, plain.frequency);
  const schedule = buildRunSchedule({
    startDate: plain.startDate,
    endDate: plain.endDate,
    frequency: plain.frequency,
    dayOfMonth: plain.dayOfMonth,
    capAt: new Date(),
  });
  const eligiblePeriods = filterEligibleSchedule({
    schedule,
    runHistory: activeRunHistory,
    now: new Date(),
    frequency: plain.frequency,
  });

  const processedPeriods = (Array.isArray(plain.runHistory) ? plain.runHistory : [])
    .map((run) => ({
      id: run?._id || null,
      periodKey: String(run?.periodKey || getPeriodKey(run?.dueDate || run?.runDate, plain.frequency) || ""),
      periodLabel: String(run?.periodLabel || "").trim() || null,
      runDate: run?.runDate || null,
      dueDate: run?.dueDate || null,
      periodStart: run?.periodStart || null,
      periodEnd: run?.periodEnd || null,
      amount: round2(run?.amount || 0),
      referenceNo: run?.referenceNo || "",
      note: run?.note || "",
      journalGroupId: run?.journalGroupId || null,
      visibleStatementEntryId: run?.visibleStatementEntryId || null,
      offsetEntryId: run?.offsetEntryId || null,
      processedBy: run?.processedBy || null,
      cancelledAt: run?.cancelledAt || null,
      cancelledBy: run?.cancelledBy || null,
      cancellationReason: run?.cancellationReason || "",
      reversalVisibleEntryId: run?.reversalVisibleEntryId || null,
      reversalOffsetEntryId: run?.reversalOffsetEntryId || null,
      isCancelled: Boolean(run?.cancelledAt),
    }))
    .filter((item) => item.periodKey)
    .sort(comparePeriodOrder);

  const processedPeriodsCount = processedPeriods.filter((item) => !item.isCancelled).length;
  const cancelledPeriodsCount = processedPeriods.filter((item) => item.isCancelled).length;

  return {
    ...plain,
    eligiblePeriods: eligiblePeriods.map((item) => ({
      periodKey: item.periodKey,
      periodLabel: item.periodLabel,
      dueDate: item.dueDate,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
    })),
    processedPeriods,
    processedPeriodsCount,
    cancelledPeriodsCount,
    unprocessedPeriodsCount: Math.max(schedule.length - processedPeriodsCount, 0),
    nextEligiblePeriod: eligiblePeriods[0] || null,
  };
};

const serializeRows = (rows = []) => rows.map((row) => serializeStandingOrder(row));

const resolveSelectedScheduleItem = (row, payload = {}) => {
  const activeRunHistory = getActiveRunHistory(row?.runHistory, row?.frequency);
  const schedule = buildRunSchedule({
    startDate: row.startDate,
    endDate: row.endDate,
    frequency: row.frequency,
    dayOfMonth: row.dayOfMonth,
    capAt: new Date(),
  });
  const eligiblePeriods = filterEligibleSchedule({
    schedule,
    runHistory: activeRunHistory,
    now: new Date(),
    frequency: row.frequency,
  });

  const requestedKey = String(payload?.periodKey || payload?.schedulePeriod || "").trim();
  if (requestedKey) {
    return eligiblePeriods.find((item) => item.periodKey === requestedKey) || null;
  }

  const requestedDate = parseDate(payload?.runDate, null);
  if (requestedDate) {
    const derivedKey = getPeriodKey(requestedDate, row.frequency);
    return eligiblePeriods.find((item) => item.periodKey === derivedKey) || null;
  }

  return eligiblePeriods[0] || null;
};

const syncNextRunDate = (row, { preserveStopped = false } = {}) => {
  const serialized = serializeStandingOrder(row);
  if (preserveStopped && row.status === "stopped") {
    row.nextRunDate = null;
    return serialized;
  }

  row.nextRunDate = serialized.nextEligiblePeriod?.dueDate || null;

  if (!serialized.nextEligiblePeriod && row.status === "active") {
    row.status = "stopped";
    row.nextRunDate = null;
  }

  if (row.endDate && row.nextRunDate && normalizeToStartOfDay(row.nextRunDate) > normalizeToEndOfDay(row.endDate)) {
    row.status = "stopped";
    row.nextRunDate = null;
  }

  return serialized;
};

export const createLandlordStandingOrder = async (req, res, next) => {
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
      return res.status(400).json({ success: false, message: "Valid standing order amount is required" });
    }

    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ success: false, message: "Standing order title is required" });

    const startDate = parseDate(req.body?.startDate, new Date());
    if (!startDate) return res.status(400).json({ success: false, message: "Valid start date is required" });

    const endDate = parseDate(req.body?.endDate, null);
    if (endDate && endDate < startDate) {
      return res.status(400).json({ success: false, message: "End date cannot be earlier than start date" });
    }

    const frequency = normalizeFrequency(req.body?.frequency);
    const status = ["draft", "active", "paused", "stopped"].includes(String(req.body?.status || "").toLowerCase())
      ? String(req.body?.status || "").toLowerCase()
      : "draft";
    const referenceNo = String(req.body?.referenceNo || "").trim() || (await generateOrderNo(businessId));
    const dayOfMonth = Number(req.body?.dayOfMonth || startDate.getDate() || 5);
    const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
    const destination = buildDestination(req.body?.destination || req.body);
    const destinationError = validateDestination({ paymentMethod, destination });
    if (destinationError) {
      return res.status(400).json({ success: false, message: destinationError });
    }

    const doc = await LandlordStandingOrder.create({
      business: accountingContext.businessId,
      referenceNo,
      standingOrderNo: referenceNo,
      landlord: accountingContext.landlordId,
      property: accountingContext.propertyId,
      title,
      narration: String(req.body?.narration || "").trim(),
      amount: round2(amount),
      frequency,
      dayOfMonth: Math.max(1, Math.min(31, dayOfMonth)),
      startDate,
      endDate,
      nextRunDate: status === "stopped" ? null : startDate,
      status,
      paymentMethod,
      cashbook: isValidObjectId(req.body?.cashbook) ? req.body.cashbook : null,
      destination,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      notes: String(req.body?.notes || "").trim(),
      totalRuns: 0,
      totalProcessedAmount: 0,
    });

    syncNextRunDate(doc, { preserveStopped: true });
    await doc.save();

    const populated = await populateQuery(LandlordStandingOrder.findById(doc._id)).lean();
    res.status(201).json(serializeStandingOrder(populated));
  } catch (error) {
    next(error);
  }
};

export const getLandlordStandingOrders = async (req, res, next) => {
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
        { standingOrderNo: { $regex: term, $options: "i" } },
        { referenceNo: { $regex: term, $options: "i" } },
        { title: { $regex: term, $options: "i" } },
        { narration: { $regex: term, $options: "i" } },
        { notes: { $regex: term, $options: "i" } },
      ];
    }

    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const [total, rows] = await Promise.all([
      LandlordStandingOrder.countDocuments(filter),
      populateQuery(LandlordStandingOrder.find(filter).sort({ createdAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum)).lean(),
    ]);
    res.status(200).json({ data: serializeRows(rows), total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (error) {
    next(error);
  }
};

export const updateLandlordStandingOrder = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

    const hasProcessedRuns = getActiveRunHistory(row.runHistory, row.frequency).length > 0;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
      const title = String(req.body?.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "Standing order title is required" });
      row.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "narration")) row.narration = String(req.body?.narration || "").trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "notes")) row.notes = String(req.body?.notes || "").trim();

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "amount")) {
      const amount = Number(req.body?.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: "Valid standing order amount is required" });
      }
      row.amount = round2(amount);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "frequency")) {
      if (hasProcessedRuns && normalizeFrequency(req.body?.frequency) !== normalizeFrequency(row.frequency)) {
        return res.status(400).json({ success: false, message: "Frequency cannot be changed after processed runs exist. Create a new standing order for the new schedule." });
      }
      row.frequency = normalizeFrequency(req.body?.frequency);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "paymentMethod")) {
      row.paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "cashbook")) {
      row.cashbook = isValidObjectId(req.body?.cashbook) ? req.body.cashbook : null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "startDate")) {
      const startDate = parseDate(req.body?.startDate, null);
      if (!startDate) return res.status(400).json({ success: false, message: "Valid start date is required" });
      if (hasProcessedRuns && normalizeToStartOfDay(startDate)?.getTime() !== normalizeToStartOfDay(row.startDate)?.getTime()) {
        return res.status(400).json({ success: false, message: "Start date cannot be changed after processed runs exist. Create a new standing order for the new start date." });
      }
      row.startDate = startDate;
      if (!row.nextRunDate) row.nextRunDate = startDate;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "endDate")) {
      const endDate = parseDate(req.body?.endDate, null);
      if (endDate && row.startDate && endDate < row.startDate) {
        return res.status(400).json({ success: false, message: "End date cannot be earlier than start date" });
      }
      row.endDate = endDate;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "dayOfMonth")) {
      const dayOfMonth = Number(req.body?.dayOfMonth || 0);
      const normalizedDay = Math.max(1, Math.min(31, dayOfMonth || row.dayOfMonth || 5));
      if (hasProcessedRuns && normalizedDay !== Number(row.dayOfMonth || 5)) {
        return res.status(400).json({ success: false, message: "Run day cannot be changed after processed runs exist. Create a new standing order for the new schedule." });
      }
      row.dayOfMonth = normalizedDay;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "landlord") || Object.prototype.hasOwnProperty.call(req.body || {}, "property")) {
      const targetLandlord = Object.prototype.hasOwnProperty.call(req.body || {}, "landlord") ? req.body?.landlord : row.landlord;
      const targetProperty = Object.prototype.hasOwnProperty.call(req.body || {}, "property") ? req.body?.property : row.property;
      if (!isValidObjectId(targetLandlord)) return res.status(400).json({ success: false, message: "Landlord is required" });
      if (!isValidObjectId(targetProperty)) return res.status(400).json({ success: false, message: "Property is required" });
      if (hasProcessedRuns && (String(targetLandlord) !== String(row.landlord) || String(targetProperty) !== String(row.property))) {
        return res.status(400).json({ success: false, message: "Property or landlord cannot be changed after processed runs exist. Create a new standing order instead." });
      }

      const accountingContext = await resolvePropertyAccountingContext({
        businessId,
        propertyId: targetProperty,
        landlordId: targetLandlord,
      });
      row.landlord = accountingContext.landlordId;
      row.property = accountingContext.propertyId;
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, "destination") ||
      ["accountName", "accountNumber", "bankName", "branchName", "mobileNumber"].some((key) =>
        Object.prototype.hasOwnProperty.call(req.body || {}, key)
      )
    ) {
      row.destination = buildDestination(req.body?.destination || req.body, row.destination || {});
    }

    const destinationError = validateDestination({ paymentMethod: row.paymentMethod, destination: row.destination || {} });
    if (destinationError) {
      return res.status(400).json({ success: false, message: destinationError });
    }

    row.updatedBy = actorUserId;

    if (!row.referenceNo && row.standingOrderNo) row.referenceNo = row.standingOrderNo;
    if (!row.standingOrderNo && row.referenceNo) row.standingOrderNo = row.referenceNo;

    recalculateRunSummary(row);
    syncNextRunDate(row, { preserveStopped: true });

    await row.save();
    const populated = await populateQuery(LandlordStandingOrder.findById(row._id)).lean();
    res.status(200).json(serializeStandingOrder(populated));
  } catch (error) {
    next(error);
  }
};

export const updateLandlordStandingOrderStatus = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const status = String(req.body?.status || "").toLowerCase();
    if (!["draft", "active", "paused", "stopped"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid standing order status" });
    }

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

    row.status = status;
    row.updatedBy = actorUserId;

    if (status === "active") {
      const destinationError = validateDestination({ paymentMethod: row.paymentMethod, destination: row.destination || {} });
      if (destinationError) {
        return res.status(400).json({ success: false, message: destinationError });
      }
      row.nextRunDate = serializeStandingOrder(row).nextEligiblePeriod?.dueDate || row.startDate || new Date();
    }
    if (status === "stopped") {
      row.nextRunDate = null;
    }
    if (status === "paused") {
      row.nextRunDate = serializeStandingOrder(row).nextEligiblePeriod?.dueDate || null;
    }

    await row.save();
    const populated = await populateQuery(LandlordStandingOrder.findById(row._id)).lean();
    res.status(200).json(serializeStandingOrder(populated));
  } catch (error) {
    next(error);
  }
};

export const runLandlordStandingOrder = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

    if (String(row.status || "").toLowerCase() !== "active") {
      return res.status(400).json({ success: false, message: "Only active standing orders can be processed. Activate this standing order first." });
    }

    if (!isValidObjectId(row.property) || !isValidObjectId(row.landlord)) {
      return res.status(400).json({ success: false, message: "Standing order must have a valid property and landlord before it can run." });
    }

    const selectedPeriod = resolveSelectedScheduleItem(row, req.body || {});
    if (!selectedPeriod) {
      return res.status(400).json({
        success: false,
        message: "No eligible standing order period is available to run. Future periods and already processed periods are blocked.",
      });
    }

    const alreadyProcessed = getActiveRunHistory(row.runHistory, row.frequency).some(
      (item) => String(item?.periodKey || getPeriodKey(item?.dueDate || item?.runDate, row.frequency)) === selectedPeriod.periodKey
    );
    if (alreadyProcessed) {
      return res.status(400).json({ success: false, message: `Standing order already processed for ${selectedPeriod.periodLabel}.` });
    }

    if (row.endDate && normalizeToStartOfDay(selectedPeriod.periodStart) > normalizeToEndOfDay(row.endDate)) {
      row.status = "stopped";
      row.nextRunDate = null;
      await row.save();
      return res.status(400).json({ success: false, message: "This standing order is already past its end date." });
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

    const amount = Number(req.body?.amount || row.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid run amount is required" });
    }

    const accountingContext = await resolvePropertyAccountingContext({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
    });
    const remittancePayableAccount = await resolveLandlordRemittancePayableAccount(businessId);
    const cashbookAccount = await resolveCashbookAccount({
      businessId,
      cashbook: req.body?.cashbook || row.cashbook,
      paymentMethod: normalizePaymentMethod(req.body?.paymentMethod || row.paymentMethod),
    });

    if (!remittancePayableAccount?._id || !cashbookAccount?._id) {
      return res.status(400).json({ success: false, message: "Standing order posting accounts could not be resolved." });
    }

    const destinationError = validateDestination({
      paymentMethod: req.body?.paymentMethod || row.paymentMethod,
      destination: row.destination || {},
    });
    if (destinationError) {
      return res.status(400).json({ success: false, message: destinationError });
    }

    const runDate = normalizeToStartOfDay(req.body?.runDate || selectedPeriod.dueDate || new Date());
    const journalGroupId = new mongoose.Types.ObjectId();
    const sourceTransactionId = `${row._id}:${selectedPeriod.periodKey}`;
    const notes = String(req.body?.note || row.narration || row.title || "Standing order deduction").trim();

    const visibleEntry = await postEntry({
      business: accountingContext.businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      sourceTransactionType: "recurring_deduction",
      sourceTransactionId,
      transactionDate: runDate,
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
        standingOrderId: String(row._id),
        standingOrderNo: row.standingOrderNo || row.referenceNo,
        periodKey: selectedPeriod.periodKey,
        periodLabel: selectedPeriod.periodLabel,
        postingKind: "standing_order_run",
        description: notes,
        referenceNo: row.referenceNo,
        paymentMethod: normalizePaymentMethod(req.body?.paymentMethod || row.paymentMethod),
        cashbookAccountId: String(cashbookAccount._id),
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: runDate,
      status: "approved",
    });

    const offsetEntry = await postEntry({
      business: accountingContext.businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      sourceTransactionType: "recurring_deduction",
      sourceTransactionId,
      transactionDate: runDate,
      statementPeriodStart: selectedPeriod.periodStart,
      statementPeriodEnd: selectedPeriod.periodEnd,
      category: "RECURRING_DEDUCTION",
      amount: round2(amount),
      direction: "credit",
      accountId: cashbookAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes,
      metadata: {
        includeInLandlordStatement: false,
        standingOrderId: String(row._id),
        standingOrderNo: row.standingOrderNo || row.referenceNo,
        periodKey: selectedPeriod.periodKey,
        periodLabel: selectedPeriod.periodLabel,
        postingKind: "standing_order_cashbook_offset",
        paymentMethod: normalizePaymentMethod(req.body?.paymentMethod || row.paymentMethod),
        cashbookAccountId: String(cashbookAccount._id),
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: runDate,
      status: "approved",
    });

    row.runHistory.unshift({
      runDate,
      dueDate: selectedPeriod.dueDate,
      periodStart: selectedPeriod.periodStart,
      periodEnd: selectedPeriod.periodEnd,
      periodKey: selectedPeriod.periodKey,
      periodLabel: selectedPeriod.periodLabel,
      amount: round2(amount),
      note: notes,
      referenceNo: `${row.standingOrderNo || row.referenceNo}-${selectedPeriod.periodKey}`,
      processedBy: actorUserId,
      journalGroupId,
      visibleStatementEntryId: visibleEntry._id,
      offsetEntryId: offsetEntry._id,
    });

    recalculateRunSummary(row);
    syncNextRunDate(row);

    row.updatedBy = actorUserId;
    await row.save();

    await aggregateChartOfAccountBalances(String(row.business), [
      String(remittancePayableAccount._id),
      String(cashbookAccount._id),
    ]);

    const populated = await populateQuery(LandlordStandingOrder.findById(row._id)).lean();
    res.status(200).json(serializeStandingOrder(populated));
  } catch (error) {
    next(error);
  }
};

export const reverseLandlordStandingOrderRun = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const actorUserId = await resolveActorUserId(req, businessId);
    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

    const runId = String(req.params.runId || req.body?.runId || "").trim();
    const periodKey = String(req.body?.periodKey || "").trim();
    const runRow = runId
      ? row.runHistory.id(runId)
      : row.runHistory.find((item) => String(item?.periodKey || getPeriodKey(item?.dueDate || item?.runDate, row.frequency) || "") === periodKey);

    if (!runRow) {
      return res.status(404).json({ success: false, message: "Processed standing order run not found." });
    }

    if (runRow.cancelledAt) {
      return res.status(400).json({ success: false, message: "This standing order run has already been reversed." });
    }

    const closedPeriod = await isPeriodClosedByProcessedStatement({
      businessId,
      propertyId: row.property,
      landlordId: row.landlord,
      periodStart: runRow.periodStart || runRow.dueDate || row.startDate,
      periodEnd: runRow.periodEnd || runRow.dueDate || row.startDate,
    });

    if (closedPeriod) {
      return res.status(400).json({
        success: false,
        message:
          "This run already belongs to a processed landlord statement. Reverse or reopen the affected processed statement first.",
      });
    }

    const reason =
      String(req.body?.reason || "").trim() ||
      `Standing order run ${runRow.periodLabel || runRow.periodKey || "period"} reversed`;

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

    const visibleReversal = await reverseOne(runRow.visibleStatementEntryId);
    const offsetReversal = await reverseOne(runRow.offsetEntryId);

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(String(row.business), Array.from(touchedAccountIds));
    }

    runRow.cancelledAt = new Date();
    runRow.cancelledBy = actorUserId;
    runRow.cancellationReason = reason;
    runRow.reversalVisibleEntryId = visibleReversal?.reversalEntry?._id || null;
    runRow.reversalOffsetEntryId = offsetReversal?.reversalEntry?._id || null;

    row.updatedBy = actorUserId;
    recalculateRunSummary(row);
    syncNextRunDate(row, { preserveStopped: true });
    await row.save();

    const populated = await populateQuery(LandlordStandingOrder.findById(row._id)).lean();
    res.status(200).json(serializeStandingOrder(populated));
  } catch (error) {
    next(error);
  }
};

export const deleteLandlordStandingOrder = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

    if (Array.isArray(row.runHistory) && row.runHistory.length > 0) {
      return res.status(400).json({ success: false, message: "Standing order with processed runs cannot be deleted. Stop it instead to preserve audit history." });
    }

    await LandlordStandingOrder.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({ success: true, message: "Standing order deleted" });
  } catch (error) {
    next(error);
  }
};
