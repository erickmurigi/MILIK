import mongoose from "mongoose";
import LandlordStandingOrder from "../../models/LandlordStandingOrder.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const getBusinessId = (req) => req.query.business || req.body.business || req.params.businessId || null;

const computeNextRunDate = ({ startDate, dayOfMonth, frequency }) => {
  const base = startDate ? new Date(startDate) : new Date();
  if (Number.isNaN(base.getTime())) return null;

  const next = new Date(base);
  next.setHours(0, 0, 0, 0);
  next.setDate(Math.min(Math.max(Number(dayOfMonth || 5), 1), 28));

  if (next < new Date()) {
    if (frequency === "quarterly") next.setMonth(next.getMonth() + 3);
    else if (frequency === "semi_annually") next.setMonth(next.getMonth() + 6);
    else if (frequency === "annually") next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1);
  }

  return next;
};

const buildReference = async (businessId) => {
  const year = new Date().getFullYear();
  const count = await LandlordStandingOrder.countDocuments({ business: businessId });
  return `LSO-${year}-${String(count + 1).padStart(4, "0")}`;
};

export const listLandlordStandingOrders = async (req, res) => {
  try {
    const business = getBusinessId(req);
    if (!isValidObjectId(business)) {
      return res.status(400).json({ success: false, message: "Valid business is required." });
    }

    const filter = { business };
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.frequency && req.query.frequency !== "all") filter.frequency = req.query.frequency;
    if (isValidObjectId(req.query.landlord)) filter.landlord = req.query.landlord;
    if (isValidObjectId(req.query.property)) filter.property = req.query.property;

    const rows = await LandlordStandingOrder.find(filter)
      .populate("landlord", "landlordName")
      .populate("property", "propertyName name")
      .populate("createdBy", "firstname lastname username")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load landlord standing orders." });
  }
};

export const createLandlordStandingOrder = async (req, res) => {
  try {
    const business = getBusinessId(req);
    if (!isValidObjectId(business)) {
      return res.status(400).json({ success: false, message: "Valid business is required." });
    }
    if (!isValidObjectId(req.body.landlord)) {
      return res.status(400).json({ success: false, message: "Landlord is required." });
    }

    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be greater than zero." });
    }

    const payload = {
      business,
      landlord: req.body.landlord,
      property: isValidObjectId(req.body.property) ? req.body.property : null,
      title: String(req.body.title || "").trim(),
      amount,
      frequency: req.body.frequency || "monthly",
      dayOfMonth: Number(req.body.dayOfMonth || 5),
      startDate: req.body.startDate,
      endDate: req.body.endDate || null,
      paymentMethod: req.body.paymentMethod || "bank_transfer",
      destination: {
        accountName: req.body.destination?.accountName || "",
        accountNumber: req.body.destination?.accountNumber || "",
        bankName: req.body.destination?.bankName || "",
        branchName: req.body.destination?.branchName || "",
        mobileNumber: req.body.destination?.mobileNumber || "",
      },
      narration: req.body.narration || "",
      status: req.body.status || "draft",
      nextRunDate: computeNextRunDate({
        startDate: req.body.startDate,
        dayOfMonth: req.body.dayOfMonth,
        frequency: req.body.frequency || "monthly",
      }),
      createdBy: req.user?.id,
      notes: req.body.notes || "",
      referenceNo: await buildReference(business),
    };

    if (!payload.title) {
      return res.status(400).json({ success: false, message: "Title is required." });
    }
    if (!payload.startDate) {
      return res.status(400).json({ success: false, message: "Start date is required." });
    }

    const saved = await LandlordStandingOrder.create(payload);
    const row = await LandlordStandingOrder.findById(saved._id)
      .populate("landlord", "landlordName")
      .populate("property", "propertyName name")
      .populate("createdBy", "firstname lastname username")
      .lean();

    return res.status(201).json({ success: true, data: row });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to create landlord standing order." });
  }
};

export const updateLandlordStandingOrder = async (req, res) => {
  try {
    const business = getBusinessId(req);
    const { id } = req.params;
    if (!isValidObjectId(business) || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Valid business and record id are required." });
    }

    const row = await LandlordStandingOrder.findOne({ _id: id, business });
    if (!row) {
      return res.status(404).json({ success: false, message: "Landlord standing order not found." });
    }

    row.landlord = isValidObjectId(req.body.landlord) ? req.body.landlord : row.landlord;
    row.property = req.body.property === "" ? null : isValidObjectId(req.body.property) ? req.body.property : row.property;
    row.title = req.body.title !== undefined ? String(req.body.title || "").trim() : row.title;
    row.amount = req.body.amount !== undefined ? Number(req.body.amount || 0) : row.amount;
    row.frequency = req.body.frequency || row.frequency;
    row.dayOfMonth = req.body.dayOfMonth !== undefined ? Number(req.body.dayOfMonth || 5) : row.dayOfMonth;
    row.startDate = req.body.startDate !== undefined ? req.body.startDate : row.startDate;
    row.endDate = req.body.endDate !== undefined ? req.body.endDate || null : row.endDate;
    row.paymentMethod = req.body.paymentMethod || row.paymentMethod;
    row.narration = req.body.narration !== undefined ? req.body.narration || "" : row.narration;
    row.status = req.body.status || row.status;
    row.notes = req.body.notes !== undefined ? req.body.notes || "" : row.notes;
    row.destination = {
      accountName: req.body.destination?.accountName ?? row.destination?.accountName ?? "",
      accountNumber: req.body.destination?.accountNumber ?? row.destination?.accountNumber ?? "",
      bankName: req.body.destination?.bankName ?? row.destination?.bankName ?? "",
      branchName: req.body.destination?.branchName ?? row.destination?.branchName ?? "",
      mobileNumber: req.body.destination?.mobileNumber ?? row.destination?.mobileNumber ?? "",
    };
    row.nextRunDate = computeNextRunDate({
      startDate: row.startDate,
      dayOfMonth: row.dayOfMonth,
      frequency: row.frequency,
    });

    await row.save();

    const refreshed = await LandlordStandingOrder.findById(row._id)
      .populate("landlord", "landlordName")
      .populate("property", "propertyName name")
      .populate("createdBy", "firstname lastname username")
      .lean();

    return res.status(200).json({ success: true, data: refreshed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to update landlord standing order." });
  }
};

export const deleteLandlordStandingOrder = async (req, res) => {
  try {
    const business = getBusinessId(req);
    const { id } = req.params;
    if (!isValidObjectId(business) || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Valid business and record id are required." });
    }

    const deleted = await LandlordStandingOrder.findOneAndDelete({ _id: id, business });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Landlord standing order not found." });
    }

    return res.status(200).json({ success: true, message: "Landlord standing order deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to delete landlord standing order." });
  }
};
