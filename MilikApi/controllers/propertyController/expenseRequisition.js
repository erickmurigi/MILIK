import mongoose from "mongoose";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import ServiceProvider from "../../models/ServiceProvider.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const resolveBusinessId = (req) =>
  req?.query?.business ||
  req?.query?.company ||
  req?.body?.business ||
  req?.body?.company ||
  req?.user?.company?._id ||
  req?.user?.company ||
  null;

const resolveActorUserId = (req) =>
  req?.user?._id || req?.user?.id || req?.user?.userId || null;

const parseDate = (value, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const normalizeCategory = (value) => {
  const normalized = String(value || "other").trim().toLowerCase();
  if (["maintenance", "repair", "utility", "tax", "insurance", "supplies", "other", "general"].includes(normalized)) {
    return normalized;
  }
  return "other";
};

const normalizeStatus = (value, fallback = "draft") => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (["draft", "submitted", "approved", "rejected", "converted", "cancelled"].includes(normalized)) {
    return normalized;
  }
  return fallback;
};

const populateQuery = (query) =>
  query
    .populate("property", "propertyName propertyCode name")
    .populate("unit", "unitNumber name")
    .populate("landlord", "landlordName firstName lastName")
    .populate("serviceProvider", "name providerCode phone email category")
    .populate("requestedBy", "username email firstName lastName")
    .populate("approvedBy", "username email firstName lastName")
    .populate("rejectedBy", "username email firstName lastName")
    .populate("linkedVoucher", "voucherNo status amount dueDate");

const generateRequisitionNo = async (businessId) => {
  const prefix = "ERQ";
  const last = await ExpenseRequisition.findOne(
    {
      business: businessId,
      $or: [
        { requisitionNo: { $regex: `^${prefix}\\d+$` } },
        { referenceNo: { $regex: `^${prefix}\\d+$` } },
      ],
    },
    { requisitionNo: 1, referenceNo: 1 },
    { sort: { createdAt: -1 } }
  ).lean();

  const lastNo = last?.requisitionNo || last?.referenceNo || "";
  const seq = lastNo ? (parseInt(String(lastNo).replace(prefix, ""), 10) || 0) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const resolveVendorName = async (serviceProviderId, fallbackVendorName = "") => {
  if (isValidObjectId(serviceProviderId)) {
    const provider = await ServiceProvider.findById(serviceProviderId).select("name").lean();
    if (provider?.name) return provider.name;
  }
  return String(fallbackVendorName || "").trim();
};

export const createExpenseRequisition = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const actorUserId = resolveActorUserId(req);

    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });
    if (!actorUserId) return res.status(400).json({ success: false, message: "Authenticated user is required" });
    if (!isValidObjectId(req.body?.property)) {
      return res.status(400).json({ success: false, message: "Property is required" });
    }

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid requisition amount is required" });
    }

    const title = String(req.body?.title || "").trim();
    if (!title) {
      return res.status(400).json({ success: false, message: "Requisition title is required" });
    }

    const requisitionNo = String(req.body?.requisitionNo || req.body?.referenceNo || "").trim() || (await generateRequisitionNo(businessId));
    const requestedDate = parseDate(req.body?.requestDate, new Date());
    const neededBy = parseDate(req.body?.neededBy || req.body?.neededByDate, null);
    const serviceProviderId = isValidObjectId(req.body?.serviceProvider) ? req.body.serviceProvider : null;
    const status = normalizeStatus(req.body?.status, "draft");

    const doc = await ExpenseRequisition.create({
      business: businessId,
      requisitionNo,
      referenceNo: requisitionNo,
      property: req.body.property,
      unit: isValidObjectId(req.body?.unit) ? req.body.unit : null,
      landlord: isValidObjectId(req.body?.landlord) ? req.body.landlord : null,
      serviceProvider: serviceProviderId,
      title,
      description: String(req.body?.description || "").trim(),
      amount,
      requestDate: requestedDate,
      neededBy,
      neededByDate: neededBy,
      priority: ["low", "normal", "high", "urgent"].includes(String(req.body?.priority || "").toLowerCase())
        ? String(req.body?.priority || "").toLowerCase()
        : "normal",
      category: normalizeCategory(req.body?.category),
      status,
      notes: String(req.body?.notes || "").trim(),
      vendorName: await resolveVendorName(serviceProviderId, req.body?.vendorName),
      requestedBy: actorUserId,
    });

    const populated = await populateQuery(ExpenseRequisition.findById(doc._id));
    return res.status(201).json(await populated);
  } catch (error) {
    next(error);
  }
};

export const getExpenseRequisitions = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const filter = { business: businessId };
    if (req.query?.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query?.property && isValidObjectId(req.query.property)) filter.property = req.query.property;
    if (req.query?.serviceProvider && isValidObjectId(req.query.serviceProvider)) filter.serviceProvider = req.query.serviceProvider;
    if (req.query?.search) {
      const term = String(req.query.search).trim();
      filter.$or = [
        { requisitionNo: { $regex: term, $options: "i" } },
        { referenceNo: { $regex: term, $options: "i" } },
        { title: { $regex: term, $options: "i" } },
        { description: { $regex: term, $options: "i" } },
        { category: { $regex: term, $options: "i" } },
        { vendorName: { $regex: term, $options: "i" } },
        { notes: { $regex: term, $options: "i" } },
      ];
    }

    const rows = await populateQuery(ExpenseRequisition.find(filter).sort({ createdAt: -1 }));
    res.status(200).json(await rows);
  } catch (error) {
    next(error);
  }
};

export const updateExpenseRequisition = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const row = await ExpenseRequisition.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Expense requisition not found" });
    if (!["draft", "submitted"].includes(String(row.status))) {
      return res.status(400).json({ success: false, message: "Only draft or submitted requisitions can be edited." });
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
      const title = String(req.body?.title || "").trim();
      if (!title) return res.status(400).json({ success: false, message: "Requisition title is required" });
      row.title = title;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "description")) row.description = String(req.body?.description || "").trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "notes")) row.notes = String(req.body?.notes || "").trim();
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "category")) row.category = normalizeCategory(req.body?.category);

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "priority")) {
      row.priority = ["low", "normal", "high", "urgent"].includes(String(req.body?.priority || "").toLowerCase())
        ? String(req.body?.priority || "").toLowerCase()
        : "normal";
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "amount")) {
      const amount = Number(req.body?.amount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: "Valid requisition amount is required" });
      }
      row.amount = amount;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "property")) {
      if (!isValidObjectId(req.body?.property)) {
        return res.status(400).json({ success: false, message: "Property is required" });
      }
      row.property = req.body.property;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "unit")) {
      row.unit = isValidObjectId(req.body?.unit) ? req.body.unit : null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "landlord")) {
      row.landlord = isValidObjectId(req.body?.landlord) ? req.body.landlord : null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "requestDate")) {
      const requestDate = parseDate(req.body?.requestDate, null);
      if (!requestDate) return res.status(400).json({ success: false, message: "Valid request date is required" });
      row.requestDate = requestDate;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "neededBy") || Object.prototype.hasOwnProperty.call(req.body || {}, "neededByDate")) {
      const neededBy = parseDate(req.body?.neededBy || req.body?.neededByDate, null);
      row.neededBy = neededBy;
      row.neededByDate = neededBy;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "serviceProvider")) {
      row.serviceProvider = isValidObjectId(req.body?.serviceProvider) ? req.body.serviceProvider : null;
      row.vendorName = await resolveVendorName(row.serviceProvider, req.body?.vendorName || row.vendorName);
    } else if (Object.prototype.hasOwnProperty.call(req.body || {}, "vendorName")) {
      row.vendorName = String(req.body?.vendorName || "").trim();
    }

    await row.save();
    const populated = await populateQuery(ExpenseRequisition.findById(row._id));
    res.status(200).json(await populated);
  } catch (error) {
    next(error);
  }
};

export const updateExpenseRequisitionStatus = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const status = normalizeStatus(req.body?.status, "");
    if (!status) {
      return res.status(400).json({ success: false, message: "Invalid requisition status" });
    }

    const row = await ExpenseRequisition.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Expense requisition not found" });

    row.status = status;

    if (status === "approved") {
      row.approvedAt = new Date();
      row.approvedBy = resolveActorUserId(req);
      row.rejectedAt = null;
      row.rejectedBy = null;
      row.rejectionReason = "";
    } else if (status === "rejected") {
      row.rejectedAt = new Date();
      row.rejectedBy = resolveActorUserId(req);
      row.rejectionReason = String(req.body?.reason || "Rejected").trim();
    } else if (status === "draft" || status === "submitted" || status === "cancelled") {
      if (status === "draft") {
        row.approvedAt = null;
        row.approvedBy = null;
      }
      if (status !== "rejected") {
        row.rejectedAt = null;
        row.rejectedBy = null;
        row.rejectionReason = "";
      }
    }

    await row.save();
    const populated = await populateQuery(ExpenseRequisition.findById(row._id));
    res.status(200).json(await populated);
  } catch (error) {
    next(error);
  }
};

export const deleteExpenseRequisition = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return res.status(400).json({ success: false, message: "Company context is required" });

    const row = await ExpenseRequisition.findOne({ _id: req.params.id, business: businessId });
    if (!row) return res.status(404).json({ success: false, message: "Expense requisition not found" });
    if (["approved", "converted"].includes(String(row.status))) {
      return res.status(400).json({ success: false, message: "Approved or converted requisitions cannot be deleted." });
    }

    await ExpenseRequisition.deleteOne({ _id: row._id, business: businessId });
    res.status(200).json({ success: true, message: "Expense requisition deleted" });
  } catch (error) {
    next(error);
  }
};
