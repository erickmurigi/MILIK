import mongoose from "mongoose";
import LandlordStandingOrder from "../../models/LandlordStandingOrder.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const resolveBusinessId = (req) =>
  req?.query?.business ||
  req?.query?.company ||
  req?.body?.business ||
  req?.body?.company ||
  req?.user?.company?._id ||
  req?.user?.company ||
  null;

const resolveRequestUserId = (req) => req?.user?._id || req?.user?.id || null;

const parseDate = (value, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalizeFrequency = (value) => {
  const normalized = String(value || "monthly").trim().toLowerCase();
  if (["weekly", "monthly", "quarterly", "semi_annually", "annually", "yearly", "custom"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "semi-annually" || normalized === "semiannually") return "semi_annually";
  if (normalized === "annual") return "annually";
  return "monthly";
};

const normalizePaymentMethod = (value) => {
  const normalized = String(value || "bank_transfer").trim().toLowerCase();
  if (normalized === "mpesa") return "mobile_money";
  if (normalized === "cheque") return "check";
  if (["bank_transfer", "mobile_money", "cash", "check", "credit_card", "other"].includes(normalized)) {
    return normalized;
  }
  return "bank_transfer";
};

const addFrequency = (dateValue, frequency, dayOfMonth = null) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const next = new Date(date);
  const normalized = normalizeFrequency(frequency);

  if (normalized === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }

  if (normalized === "quarterly") {
    next.setMonth(next.getMonth() + 3);
  } else if (normalized === "semi_annually") {
    next.setMonth(next.getMonth() + 6);
  } else if (normalized === "annually" || normalized === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else {
    next.setMonth(next.getMonth() + 1);
  }

  if (Number.isFinite(Number(dayOfMonth)) && Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 31) {
    const desiredDay = Number(dayOfMonth);
    const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(desiredDay, maxDay));
  }

  return next;
};

const buildDestination = (payload = {}) => ({
  accountName: String(payload?.accountName || "").trim(),
  accountNumber: String(payload?.accountNumber || "").trim(),
  bankName: String(payload?.bankName || "").trim(),
  branchName: String(payload?.branchName || "").trim(),
  mobileNumber: String(payload?.mobileNumber || "").trim(),
});

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
    .populate("createdBy", "username email firstName lastName")
    .populate("updatedBy", "username email firstName lastName")
    .populate("runHistory.processedBy", "username email firstName lastName");

export const createLandlordStandingOrder = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const actorUserId = resolveRequestUserId(req);

    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });
    if (!actorUserId) return res.status(400).json({ success: false, message: "Authenticated user is required" });
    if (!isValidObjectId(req.body?.landlord)) return res.status(400).json({ success: false, message: "Landlord is required" });

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
    const seedRunDate = parseDate(req.body?.nextRunDate, startDate) || startDate;

    const doc = await LandlordStandingOrder.create({
      business: businessId,
      referenceNo,
      standingOrderNo: referenceNo,
      landlord: req.body.landlord,
      property: isValidObjectId(req.body?.property) ? req.body.property : null,
      title,
      narration: String(req.body?.narration || "").trim(),
      amount: round2(amount),
      frequency,
      dayOfMonth: Math.max(1, Math.min(31, dayOfMonth)),
      startDate,
      endDate,
      nextRunDate: status === "stopped" ? null : seedRunDate,
      status,
      paymentMethod: normalizePaymentMethod(req.body?.paymentMethod),
      destination: buildDestination(req.body?.destination || req.body),
      createdBy: actorUserId,
      updatedBy: actorUserId,
      notes: String(req.body?.notes || "").trim(),
      totalRuns: 0,
      totalProcessedAmount: 0,
    });

    const populated = await populateQuery(LandlordStandingOrder.findById(doc._id));
    res.status(201).json(await populated);
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

    const rows = await populateQuery(LandlordStandingOrder.find(filter).sort({ createdAt: -1 }));
    res.status(200).json(await rows);
  } catch (error) {
    next(error);
  }
};

export const updateLandlordStandingOrder = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

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
      row.frequency = normalizeFrequency(req.body?.frequency);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "paymentMethod")) {
      row.paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "startDate")) {
      const startDate = parseDate(req.body?.startDate, null);
      if (!startDate) return res.status(400).json({ success: false, message: "Valid start date is required" });
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
      row.dayOfMonth = Math.max(1, Math.min(31, dayOfMonth || row.dayOfMonth || 5));
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "landlord")) {
      if (!isValidObjectId(req.body?.landlord)) {
        return res.status(400).json({ success: false, message: "Landlord is required" });
      }
      row.landlord = req.body.landlord;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "property")) {
      row.property = isValidObjectId(req.body?.property) ? req.body.property : null;
    }

    if (
      Object.prototype.hasOwnProperty.call(req.body || {}, "destination") ||
      ["accountName", "accountNumber", "bankName", "branchName", "mobileNumber"].some((key) =>
        Object.prototype.hasOwnProperty.call(req.body || {}, key)
      )
    ) {
      row.destination = buildDestination(req.body?.destination || req.body);
    }

    row.updatedBy = resolveRequestUserId(req) || row.updatedBy || null;

    if (!row.referenceNo && row.standingOrderNo) row.referenceNo = row.standingOrderNo;
    if (!row.standingOrderNo && row.referenceNo) row.standingOrderNo = row.referenceNo;

    await row.save();
    const populated = await populateQuery(LandlordStandingOrder.findById(row._id));
    res.status(200).json(await populated);
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

    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

    row.status = status;
    row.updatedBy = resolveRequestUserId(req) || row.updatedBy || null;

    if (status === "active" && !row.nextRunDate) {
      row.nextRunDate = row.startDate || new Date();
    }
    if (status === "stopped") {
      row.nextRunDate = null;
    }

    await row.save();
    const populated = await populateQuery(LandlordStandingOrder.findById(row._id));
    res.status(200).json(await populated);
  } catch (error) {
    next(error);
  }
};

export const runLandlordStandingOrder = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const row = await LandlordStandingOrder.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Standing order not found" });

    if (!["active", "paused", "draft"].includes(String(row.status))) {
      return res.status(400).json({ success: false, message: "This standing order cannot be run in its current state." });
    }

    const runDate = parseDate(req.body?.runDate, new Date());
    if (!runDate) return res.status(400).json({ success: false, message: "Valid run date is required" });

    if (row.endDate && runDate > row.endDate) {
      row.status = "stopped";
      row.nextRunDate = null;
      await row.save();
      return res.status(400).json({ success: false, message: "This standing order is already past its end date." });
    }

    const amount = Number(req.body?.amount || row.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid run amount is required" });
    }

    const dueDate = row.nextRunDate || row.startDate || runDate;
    const nextRunDate = addFrequency(dueDate, row.frequency, row.dayOfMonth);

    row.runHistory.unshift({
      runDate,
      dueDate,
      amount: round2(amount),
      note: String(req.body?.note || row.narration || row.title || "").trim(),
      referenceNo: `${row.standingOrderNo || row.referenceNo}-RUN-${String(Number(row.totalRuns || 0) + 1).padStart(3, "0")}`,
      processedBy: resolveRequestUserId(req),
    });

    row.totalRuns = Number(row.totalRuns || 0) + 1;
    row.totalProcessedAmount = round2(Number(row.totalProcessedAmount || 0) + round2(amount));
    row.lastRunAt = runDate;
    row.lastRunDate = runDate;
    row.status = row.status === "draft" ? "active" : row.status;
    row.nextRunDate = nextRunDate;

    if (row.endDate && row.nextRunDate && new Date(row.nextRunDate) > new Date(row.endDate)) {
      row.status = "stopped";
      row.nextRunDate = null;
    }

    row.updatedBy = resolveRequestUserId(req) || row.updatedBy || null;
    await row.save();

    const populated = await populateQuery(LandlordStandingOrder.findById(row._id));
    res.status(200).json(await populated);
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

    await LandlordStandingOrder.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({ success: true, message: "Standing order deleted" });
  } catch (error) {
    next(error);
  }
};
