import { createError } from "../../../utils/error.js";
import SaleLead    from "../models/SaleLead.js";
import SaleBuyer   from "../models/SaleBuyer.js";
import SaleActivity from "../models/SaleActivity.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

export const listLeads = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", source = "", agent = "", overdueOnly = "", page = 1, limit = 50 } = req.query;
    const pageNum  = Math.max(parseInt(page,  10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);

    const filter = { business };
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (agent)  filter.assignedAgent = agent;
    if (overdueOnly === "1") {
      filter.nextFollowUpDate = { $lt: new Date() };
      filter.status = { $nin: ["converted", "lost"] };
    }
    if (search.trim()) filter.$text = { $search: search.trim() };

    const [leads, total] = await Promise.all([
      SaleLead.find(filter)
        .populate("assignedAgent", "fullName")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      SaleLead.countDocuments(filter),
    ]);

    res.status(200).json({ data: leads, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) { next(err); }
};

export const getPipeline = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const pipeline = await SaleLead.aggregate([
      { $match: { business } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.status(200).json({ pipeline });
  } catch (err) { next(err); }
};

export const getLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const lead = await SaleLead.findOne({ _id: req.params.id, business })
      .populate("assignedAgent",     "fullName phone")
      .populate("interestedListings","listingNumber title")
      .populate("convertedBuyer",    "buyerNumber fullName")
      .lean();
    if (!lead) return next(createError(404, "Lead not found"));
    res.status(200).json(lead);
  } catch (err) { next(err); }
};

export const createLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const leadNumber = await generateSequentialNumber(SaleLead, business, "LDR");
    const lead = await SaleLead.create({ ...req.body, business, leadNumber, createdBy: userId, updatedBy: userId });
    res.status(201).json(lead);
  } catch (err) { next(err); }
};

export const updateLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const { business: _b, leadNumber: _n, createdBy: _c, convertedBuyer: _cv, convertedAt: _ca, ...updates } = req.body;
    const lead = await SaleLead.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    ).populate("assignedAgent", "fullName");
    if (!lead) return next(createError(404, "Lead not found"));
    res.status(200).json(lead);
  } catch (err) { next(err); }
};

export const deleteLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const lead = await SaleLead.findOne({ _id: req.params.id, business });
    if (!lead) return next(createError(404, "Lead not found"));
    if (lead.status === "converted") return next(createError(400, "Cannot delete a converted lead"));
    await Promise.all([
      lead.deleteOne(),
      SaleActivity.deleteMany({ business, relatedLead: lead._id }),
    ]);
    res.status(200).json({ message: "Lead deleted" });
  } catch (err) { next(err); }
};

export const convertLead = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const lead = await SaleLead.findOne({ _id: req.params.id, business });
    if (!lead) return next(createError(404, "Lead not found"));
    if (lead.status === "converted") return next(createError(400, "Lead is already converted"));

    const { idNumber = "" } = req.body;
    const buyerNumber = await generateSequentialNumber(SaleBuyer, business, "BYR");
    const buyer = await SaleBuyer.create({
      business,
      buyerNumber,
      fullName:   lead.fullName,
      phone:      lead.phone,
      email:      lead.email,
      source:     lead.source,
      idNumber,
      notes:      lead.notes,
      kycStatus:  "pending",
      createdBy:  userId,
      updatedBy:  userId,
    });

    await SaleLead.findByIdAndUpdate(lead._id, {
      status:         "converted",
      convertedBuyer: buyer._id,
      convertedAt:    new Date(),
      updatedBy:      userId,
    });

    res.status(200).json({ message: "Lead converted to buyer", buyer });
  } catch (err) { next(err); }
};
