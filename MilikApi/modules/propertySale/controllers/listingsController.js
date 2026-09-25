import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleListing from "../models/SaleListing.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleProject from "../models/SaleProject.js";
import SaleSettings from "../models/SaleSettings.js";
import { cleanAttributes, typeValue } from "../services/listingAttributes.js";
import { PROJECT_WITH_AGENT, withEffectiveAgent } from "../services/listingAgent.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { deleteImageFile } from "../middleware/listingImageUpload.js";
import { andInto, wordsSearchFilter } from "../services/saleSearch.js";

const CREATE_STATUSES = ["available", "withdrawn"];

// The extra fields the company defined for a property type (empty for a type without any)
const typeFields = async (business, propertyType) => {
  const settings = await SaleSettings.findOne({ business }).select("propertyTypes").lean();
  return (settings?.propertyTypes ?? []).find((t) => typeValue(t.name) === typeValue(propertyType))?.fields ?? [];
};

// Validates the project a new unit is created in, and normalises the unit fields.
// Returns an error (to pass to next) or null; mutates `body` (trimmed unitNumber/block).
const checkUnitFields = async (body, business) => {
  if (!body.project) {
    body.project = null;
    body.unitNumber = "";
    body.block = "";
    return null;
  }
  if (!mongoose.isValidObjectId(String(body.project))) return createError(400, "Invalid project");
  const project = await SaleProject.findOne({ _id: body.project, business }).select("status").lean();
  if (!project) return createError(400, "Project not found");
  if (project.status === "archived") return createError(400, "This project is archived — restore it before adding units");
  body.unitNumber = String(body.unitNumber ?? "").trim();
  body.block = String(body.block ?? "").trim();
  if (!body.unitNumber) return createError(400, "Unit number is required for a unit inside a project");
  return null;
};

// Numeric-aware ordering so "Plot 2" sorts before "Plot 10" in a project's unit list
const withUnitOrdering = (query, on) => (on ? query.collation({ locale: "en", numericOrdering: true }) : query);

const duplicateUnitError = (err) =>
  err?.code === 11000 && /unitNumber|project/.test(String(err.message)) ? createError(409, "That unit number already exists in this project") : null;

const sanitizeListingBody = (body) => {
  const out = { ...body };
  if ("assignedAgent" in out) out.assignedAgent = out.assignedAgent || null;
  if ("askingPrice" in out)   out.askingPrice   = out.askingPrice   !== "" && out.askingPrice   != null ? Number(out.askingPrice)   : 0;
  if ("size" in out)          out.size          = out.size          !== "" && out.size          != null ? Number(out.size)          : null;
  if ("listedDate" in out)    out.listedDate    = out.listedDate    || null;
  return out;
};

export const listListings = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { search = "", status = "", propertyType = "", agentId = "", projectId = "", project = "", block = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (status) filter.status = status;
    if (propertyType) filter.propertyType = propertyType;
    // An agent's listings are those assigned to them plus units that inherit them from their project
    const andClauses = [];
    if (agentId) {
      if (!mongoose.isValidObjectId(String(agentId))) return next(createError(400, "Invalid agent"));
      const agentProjects = await SaleProject.distinct("_id", { business, assignedAgent: agentId });
      andClauses.push(
        agentProjects.length
          ? { $or: [{ assignedAgent: agentId }, { assignedAgent: null, project: { $in: agentProjects } }] }
          : { assignedAgent: agentId }
      );
    }
    if (andClauses.length) filter.$and = andClauses;
    if (block) filter.block = block;

    // Project scope: a project id, "any" (units only), "none" (standalone only). Default: every sellable item,
    // so offer/deal pickers keep seeing units and standalone listings alike.
    let scope = {};
    let aggScope = {};
    if (projectId) {
      if (!mongoose.isValidObjectId(String(projectId))) return next(createError(400, "Invalid project"));
      scope = { project: projectId };
      aggScope = { project: new mongoose.Types.ObjectId(String(projectId)) };
    } else if (project === "any") {
      scope = aggScope = { project: { $ne: null } };
    } else if (project === "none") {
      scope = aggScope = { project: null };
    }
    Object.assign(filter, scope);

    // Substring search over what a person remembers about a listing: title, number, unit, location, type, title deed
    andInto(filter, wordsSearchFilter(search, ["title", "listingNumber", "unitNumber", "location", "town", "county", "propertyType", "titleDeedNumber"]));
    const [listings, total, statsRaw] = await Promise.all([
      withUnitOrdering(SaleListing.find(filter), Boolean(projectId))
        .populate("assignedAgent", "fullName agentNumber phone")
        .populate(PROJECT_WITH_AGENT)
        .sort(projectId ? { block: 1, unitNumber: 1 } : { createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      SaleListing.countDocuments(filter),
      SaleListing.aggregate([
        { $match: { business: bId, ...aggScope } },
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
    res.status(200).json({ data: listings.map(withEffectiveAgent), total, page: pageNum, pages: Math.ceil(total / limitNum) || 1, stats });
  } catch (err) {
    next(err);
  }
};

export const getListing = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const listing = await SaleListing.findOne({ _id: req.params.id, business })
      .populate("assignedAgent", "fullName agentNumber phone email commissionRate commissionType")
      .populate(PROJECT_WITH_AGENT)
      .lean();
    if (!listing) return next(createError(404, "Listing not found"));
    res.status(200).json(withEffectiveAgent(listing));
  } catch (err) {
    next(err);
  }
};

export const createListing = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    // acceptedOffer is server-managed. A new listing may only start as available/withdrawn —
    // reserved / under_contract / sold are driven by the offers + deals workflow.
    // images are managed only through the upload/delete image endpoints.
    const { acceptedOffer: _ao, images: _im, ...rawBody } = req.body;
    if (rawBody.status && !CREATE_STATUSES.includes(rawBody.status)) {
      return next(createError(400, `A new listing can only be created as ${CREATE_STATUSES.join(" or ")}`));
    }
    const body = sanitizeListingBody(rawBody);
    if (body.assignedAgent) {
      const agent = await SaleAgent.findOne({ _id: body.assignedAgent, business, status: "active" }).lean();
      if (!agent) return next(createError(400, "Assigned agent not found or inactive"));
    }
    const unitError = await checkUnitFields(body, business);
    if (unitError) return next(unitError);
    const cleaned = cleanAttributes(await typeFields(business, body.propertyType ?? "plot"), body.attributes);
    if (cleaned.error) return next(createError(400, cleaned.error));
    body.attributes = cleaned.attributes;

    const listingNumber = await generateSequentialNumber(SaleListing, business, "LST");
    const listing = await SaleListing.create({
      ...body,
      business,
      listingNumber,
      createdBy: userId,
      updatedBy: userId,
    });
    const populated = await SaleListing.findById(listing._id)
      .populate("assignedAgent", "fullName agentNumber phone")
      .populate(PROJECT_WITH_AGENT)
      .lean();
    res.status(201).json(withEffectiveAgent(populated));
  } catch (err) {
    next(duplicateUnitError(err) || err);
  }
};

export const updateListing = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    // status is stripped: every status change must go through updateListingStatus (deal/offer guards).
    // acceptedOffer is server-managed by the offer workflow.
    // images are managed only through the upload/delete image endpoints (a generic edit must not overwrite them).
    // project is stripped too: units are attached/detached only through the project endpoints (moving a unit that
    // has offers or deals would distort project figures).
    const { business: _b, listingNumber: _n, createdBy: _c, status: _s, acceptedOffer: _ao, images: _im, project: _p, ...rawUpdates } = req.body;
    const updates = sanitizeListingBody(rawUpdates);

    if (updates.assignedAgent) {
      const agent = await SaleAgent.findOne({ _id: updates.assignedAgent, business, status: "active" }).lean();
      if (!agent) return next(createError(400, "Assigned agent not found or inactive"));
    }

    // Custom field values are checked against the (possibly new) property type. Changing the type without sending
    // values clears them, since the old type's fields no longer apply.
    if ("attributes" in updates || "propertyType" in updates) {
      const current = await SaleListing.findOne({ _id: req.params.id, business }).select("propertyType").lean();
      if (!current) return next(createError(404, "Listing not found"));
      const nextType = updates.propertyType ?? current.propertyType;
      if ("attributes" in updates) {
        const cleaned = cleanAttributes(await typeFields(business, nextType), updates.attributes);
        if (cleaned.error) return next(createError(400, cleaned.error));
        updates.attributes = cleaned.attributes;
      } else if (typeValue(nextType) !== typeValue(current.propertyType)) {
        updates.attributes = {};
      }
    }

    // unitNumber / block only make sense on a unit, and a unit must keep its number (looked up only when they change)
    if ("unitNumber" in updates || "block" in updates) {
      const existing = await SaleListing.findOne({ _id: req.params.id, business }).select("project").lean();
      if (!existing) return next(createError(404, "Listing not found"));
      if (existing.project) {
        if ("unitNumber" in updates) {
          updates.unitNumber = String(updates.unitNumber ?? "").trim();
          if (!updates.unitNumber) return next(createError(400, "Unit number is required for a unit inside a project"));
        }
        if ("block" in updates) updates.block = String(updates.block ?? "").trim();
      } else {
        delete updates.unitNumber;
        delete updates.block;
      }
    }

    const listing = await SaleListing.findOneAndUpdate(
      { _id: req.params.id, business },
      { ...updates, updatedBy: userId },
      { new: true, runValidators: true }
    )
      .populate("assignedAgent", "fullName agentNumber phone")
      .populate(PROJECT_WITH_AGENT)
      .lean();
    if (!listing) return next(createError(404, "Listing not found"));
    res.status(200).json(withEffectiveAgent(listing));
  } catch (err) {
    next(duplicateUnitError(err) || err);
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
    listing.images?.forEach(deleteImageFile);
    res.status(200).json({ message: "Listing deleted" });
  } catch (err) {
    next(err);
  }
};

export const uploadListingImages = async (req, res, next) => {
  // The upload middleware has already written the processed images to disk — remove them again
  // whenever they don't end up attached to a listing (404, save failure, etc.).
  let attached = false;
  const discardUploads = () => req.files?.forEach((f) => deleteImageFile(f.filename));
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    if (!req.files?.length) return next(createError(400, "No valid images uploaded"));
    const listing = await SaleListing.findOne({ _id: req.params.id, business });
    if (!listing) {
      discardUploads();
      return next(createError(404, "Listing not found"));
    }
    const newUrls = req.files.map((f) => `/uploads/sale-listings/${f.filename}`);
    listing.images.push(...newUrls);
    listing.updatedBy = userId;
    await listing.save();
    attached = true;
    res.status(200).json({ images: listing.images });
  } catch (err) {
    if (!attached) discardUploads();
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
    // Only a photo that is on this listing may be removed (and its file deleted): the URL comes from the client
    if (!listing.images.includes(url)) return next(createError(404, "Image not found on this listing"));
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
    if (existing.status === status) return res.status(200).json(existing);

    // under_contract / sold are only reachable through the deals workflow; and a listing that has a
    // live (active/closed) deal must not be moved back to a pre-contract status by hand.
    const deals = await SaleDeal.find({
      business,
      listing: existing._id,
      status: { $in: ["active", "closed"] },
    }).select("status").lean();
    const hasActiveDeal = deals.some((d) => d.status === "active");
    const hasClosedDeal = deals.some((d) => d.status === "closed");

    if (status === "under_contract" && !hasActiveDeal) {
      return next(createError(400, "A listing can only be set to under contract through an active deal — create the deal in the Deals workflow"));
    }
    if (status === "sold" && !hasClosedDeal) {
      return next(createError(400, "A listing can only be marked sold by closing its deal in the Deals workflow"));
    }
    if (["available", "reserved"].includes(status) && (hasActiveDeal || hasClosedDeal)) {
      return next(createError(400, "This listing has an active or closed deal — cancel the deal instead of changing the listing status manually"));
    }

    const listing = await SaleListing.findOneAndUpdate(
      { _id: req.params.id, business },
      { status, updatedBy: userId },
      { new: true }
    ).lean();
    res.status(200).json(listing);
  } catch (err) {
    next(err);
  }
};
