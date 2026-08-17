import RentalListingLead from "../models/RentalListingLead.js";
import { resolveBusinessId, currentUserId } from "../utils/requestContext.js";
import { parsePagination } from "../utils/pagination.js";
import { createError } from "../utils/error.js";

// GET /api/rental-leads
export const listRentalLeads = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Business context is required"));

    const { status = "", search = "" } = req.query;
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const filter = { business: businessId };
    if (status) filter.status = status;
    if (search.trim()) filter.$text = { $search: search.trim() };

    const [leads, total] = await Promise.all([
      RentalListingLead.find(filter)
        .populate("unit", "unitNumber unitType listingTitle")
        .populate("property", "propertyName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      RentalListingLead.countDocuments(filter),
    ]);

    res.status(200).json({ success: true, data: leads, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/rental-leads/:id
export const updateRentalLead = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Business context is required"));

    const { status, notes } = req.body || {};
    const updates = { updatedBy: currentUserId(req) };
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = String(notes).trim();

    const lead = await RentalListingLead.findOneAndUpdate(
      { _id: req.params.id, business: businessId },
      updates,
      { new: true, runValidators: true }
    );

    if (!lead) return next(createError(404, "Lead not found"));
    res.status(200).json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/rental-leads/:id
export const deleteRentalLead = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) return next(createError(400, "Business context is required"));

    const lead = await RentalListingLead.findOneAndDelete({ _id: req.params.id, business: businessId });
    if (!lead) return next(createError(404, "Lead not found"));
    res.status(200).json({ success: true, message: "Lead deleted" });
  } catch (err) {
    next(err);
  }
};
