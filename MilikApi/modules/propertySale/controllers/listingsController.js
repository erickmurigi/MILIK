import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleListing from "../models/SaleListing.js";
import SaleAgent from "../models/SaleAgent.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { deleteImageFile } from "../middleware/listingImageUpload.js";

export const listListings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { search = "", status = "", propertyType = "", agentId = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (status) filter.status = status;
    if (propertyType) filter.propertyType = propertyType;
    if (agentId) filter.assignedAgent = agentId;
    if (search.trim()) {
      filter.$text = { $search: search.trim() };
    }
    const [listings, total, statsRaw] = await Promise.all([
      SaleListing.find(filter)
        .populate("assignedAgent", "fullName agentNumber phone")
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      SaleListing.countDocuments(filter),
      SaleListing.aggregate([
        { $match: { business: bId } },
        { $group: { _id: "$status", count: { $sum: 1 }, totalValue: { $sum: "$askingPrice" } } },
      ]),
    ]);
    const statsMap = Object.fromEntries(statsRaw.map((s) => [s._id, { count: s.count, totalValue: s.totalValue }]));
    const stats = {
      available:     statsMap.available     || { count: 0, totalValue: 0 },
      reserved:      statsMap.reserved      || { count: 0, totalValue: 0 },
      under_contract: statsMap.under_contract || { count: 0, totalValue: 0 },
      sold:          statsMap.sold          || { count: 0, totalValue: 0 },
      withdrawn:     statsMap.withdrawn     || { count: 0, totalValue: 0 },
    };
    res.status(200).json({ data: listings, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1, stats });
  } catch (err) {
    next(err);
  }
};

export const getListing = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const listing = await SaleListing.findOne({ _id: req.params.id, business })
      .populate("assignedAgent", "fullName agentNumber phone email commissionRate commissionType")
      .lean();
    if (!listing) return next(createError(404, "Listing not found"));
    res.status(200).json(listing);
  } catch (err) {
    next(err);
  }
};

export const createListing = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    if (req.body.assignedAgent) {
      const agent = await SaleAgent.findOne({ _id: req.body.assignedAgent, business, status: "active" }).lean();
      if (!agent) return next(createError(400, "Assigned agent not found or inactive"));
    }

    const listingNumber = await generateSequentialNumber(SaleListing, business, "LST");
    const listing = await SaleListing.create({
      ...req.body,
      business,
      listingNumber,
      createdBy: userId,
      updatedBy: userId,
    });
    const populated = await listing.populate("assignedAgent", "fullName agentNumber phone");
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const updateListing = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, listingNumber: _n, createdBy: _c, ...updates } = req.body;

    if (updates.assignedAgent) {
      const agent = await SaleAgent.findOne({ _id: updates.assignedAgent, business, status: "active" }).lean();
      if (!agent) return next(createError(400, "Assigned agent not found or inactive"));
    }

    const listing = await SaleListing.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    ).populate("assignedAgent", "fullName agentNumber phone");
    if (!listing) return next(createError(404, "Listing not found"));
    res.status(200).json(listing);
  } catch (err) {
    next(err);
  }
};

export const deleteListing = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const listing = await SaleListing.findOne({ _id: req.params.id, business });
    if (!listing) return next(createError(404, "Listing not found"));
    if (["under_contract", "sold"].includes(listing.status)) {
      return next(createError(400, "Cannot delete a listing that is under contract or sold"));
    }
    await listing.deleteOne();
    res.status(200).json({ message: "Listing deleted" });
  } catch (err) {
    next(err);
  }
};

export const uploadListingImages = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    if (!req.files?.length) return next(createError(400, "No valid images uploaded"));
    const listing = await SaleListing.findOne({ _id: req.params.id, business });
    if (!listing) return next(createError(404, "Listing not found"));
    const newUrls = req.files.map((f) => `/uploads/sale-listings/${f.filename}`);
    listing.images.push(...newUrls);
    listing.updatedBy = userId;
    await listing.save();
    res.status(200).json({ images: listing.images });
  } catch (err) {
    next(err);
  }
};

export const removeListingImage = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { url } = req.body;
    if (!url) return next(createError(400, "Image URL required"));
    const listing = await SaleListing.findOne({ _id: req.params.id, business });
    if (!listing) return next(createError(404, "Listing not found"));
    listing.images = listing.images.filter((u) => u !== url);
    listing.updatedBy = userId;
    await listing.save();
    deleteImageFile(url);
    res.status(200).json({ images: listing.images });
  } catch (err) {
    next(err);
  }
};

export const updateListingStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const VALID = ["available", "reserved", "under_contract", "sold", "withdrawn"];
    const { status } = req.body;
    if (!VALID.includes(status)) return next(createError(400, "Invalid listing status"));

    const existing = await SaleListing.findOne({ _id: req.params.id, business }).lean();
    if (!existing) return next(createError(404, "Listing not found"));
    if (existing.status === "sold") {
      return next(createError(400, "A sold listing cannot be manually re-listed — cancel the deal instead"));
    }

    const listing = await SaleListing.findOneAndUpdate(
      { _id: req.params.id, business },
      { status, updatedBy: userId },
      { new: true }
    );
    res.status(200).json(listing);
  } catch (err) {
    next(err);
  }
};
