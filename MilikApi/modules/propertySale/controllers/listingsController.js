import { createError } from "../../../utils/error.js";
import SaleListing from "../models/SaleListing.js";
import SaleAgent from "../models/SaleAgent.js";
import { currentUserId, escapeRegex, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

export const listListings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", propertyType = "", agentId = "" } = req.query;
    const filter = { business };
    if (status) filter.status = status;
    if (propertyType) filter.propertyType = propertyType;
    if (agentId) filter.assignedAgent = agentId;
    if (search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ title: rx }, { listingNumber: rx }, { location: rx }, { town: rx }, { titleDeedNumber: rx }];
    }
    const listings = await SaleListing.find(filter)
      .populate("assignedAgent", "fullName agentNumber phone")
      .sort({ createdAt: -1 })
      .lean();
    res.status(200).json(listings);
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

export const updateListingStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const VALID = ["available", "reserved", "under_contract", "sold", "withdrawn"];
    const { status } = req.body;
    if (!VALID.includes(status)) return next(createError(400, "Invalid listing status"));
    const listing = await SaleListing.findOneAndUpdate(
      { _id: req.params.id, business },
      { status, updatedBy: userId },
      { new: true }
    );
    if (!listing) return next(createError(404, "Listing not found"));
    res.status(200).json(listing);
  } catch (err) {
    next(err);
  }
};
