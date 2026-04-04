import mongoose from "mongoose";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const getBusinessId = (req) => req.query.business || req.body.business || req.params.businessId || null;

const buildReference = async (businessId) => {
  const year = new Date().getFullYear();
  const count = await ExpenseRequisition.countDocuments({ business: businessId });
  return `ERQ-${year}-${String(count + 1).padStart(4, "0")}`;
};

export const listExpenseRequisitions = async (req, res) => {
  try {
    const business = getBusinessId(req);
    if (!isValidObjectId(business)) {
      return res.status(400).json({ success: false, message: "Valid business is required." });
    }

    const filter = { business };
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.priority && req.query.priority !== "all") filter.priority = req.query.priority;
    if (isValidObjectId(req.query.property)) filter.property = req.query.property;

    const rows = await ExpenseRequisition.find(filter)
      .populate("property", "propertyName name")
      .populate("unit", "unitNumber")
      .populate("landlord", "landlordName")
      .populate("requestedBy", "firstname lastname username")
      .populate("approvedBy", "firstname lastname username")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load expense requisitions." });
  }
};

export const createExpenseRequisition = async (req, res) => {
  try {
    const business = getBusinessId(req);
    if (!isValidObjectId(business)) {
      return res.status(400).json({ success: false, message: "Valid business is required." });
    }

    if (!isValidObjectId(req.body.property)) {
      return res.status(400).json({ success: false, message: "Property is required." });
    }

    const payload = {
      business,
      property: req.body.property,
      unit: isValidObjectId(req.body.unit) ? req.body.unit : null,
      landlord: isValidObjectId(req.body.landlord) ? req.body.landlord : null,
      title: String(req.body.title || "").trim(),
      category: req.body.category || "other",
      amount: Number(req.body.amount || 0),
      neededByDate: req.body.neededByDate || null,
      priority: req.body.priority || "normal",
      status: req.body.status || "draft",
      description: req.body.description || "",
      vendorName: req.body.vendorName || "",
      requestedBy: req.user?.id,
      referenceNo: await buildReference(business),
    };

    if (!payload.title) {
      return res.status(400).json({ success: false, message: "Title is required." });
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be greater than zero." });
    }

    const saved = await ExpenseRequisition.create(payload);
    const row = await ExpenseRequisition.findById(saved._id)
      .populate("property", "propertyName name")
      .populate("unit", "unitNumber")
      .populate("landlord", "landlordName")
      .populate("requestedBy", "firstname lastname username")
      .lean();

    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to create expense requisition." });
  }
};

export const updateExpenseRequisition = async (req, res) => {
  try {
    const business = getBusinessId(req);
    const { id } = req.params;
    if (!isValidObjectId(business) || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Valid business and record id are required." });
    }

    const row = await ExpenseRequisition.findOne({ _id: id, business });
    if (!row) {
      return res.status(404).json({ success: false, message: "Expense requisition not found." });
    }

    const currentStatus = String(row.status || "draft");
    const nextStatus = req.body.status ? String(req.body.status) : currentStatus;

    row.property = isValidObjectId(req.body.property) ? req.body.property : row.property;
    row.unit = req.body.unit === "" ? null : isValidObjectId(req.body.unit) ? req.body.unit : row.unit;
    row.landlord = req.body.landlord === "" ? null : isValidObjectId(req.body.landlord) ? req.body.landlord : row.landlord;
    row.title = req.body.title !== undefined ? String(req.body.title || "").trim() : row.title;
    row.category = req.body.category || row.category;
    row.amount = req.body.amount !== undefined ? Number(req.body.amount || 0) : row.amount;
    row.neededByDate = req.body.neededByDate !== undefined ? req.body.neededByDate || null : row.neededByDate;
    row.priority = req.body.priority || row.priority;
    row.description = req.body.description !== undefined ? req.body.description || "" : row.description;
    row.vendorName = req.body.vendorName !== undefined ? req.body.vendorName || "" : row.vendorName;
    row.status = nextStatus;

    if (["approved", "rejected"].includes(nextStatus) && currentStatus !== nextStatus) {
      row.approvedBy = req.user?.id || null;
      row.approvedAt = new Date();
      row.rejectionReason = nextStatus === "rejected" ? String(req.body.rejectionReason || "").trim() : "";
    }

    await row.save();

    const refreshed = await ExpenseRequisition.findById(row._id)
      .populate("property", "propertyName name")
      .populate("unit", "unitNumber")
      .populate("landlord", "landlordName")
      .populate("requestedBy", "firstname lastname username")
      .populate("approvedBy", "firstname lastname username")
      .lean();

    return res.status(200).json({ success: true, data: refreshed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to update expense requisition." });
  }
};

export const deleteExpenseRequisition = async (req, res) => {
  try {
    const business = getBusinessId(req);
    const { id } = req.params;
    if (!isValidObjectId(business) || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Valid business and record id are required." });
    }

    const deleted = await ExpenseRequisition.findOneAndDelete({ _id: id, business });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Expense requisition not found." });
    }

    return res.status(200).json({ success: true, message: "Expense requisition deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to delete expense requisition." });
  }
};
