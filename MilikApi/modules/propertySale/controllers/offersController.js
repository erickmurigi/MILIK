import { createError } from "../../../utils/error.js";
import SaleOffer from "../models/SaleOffer.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import { currentUserId, escapeRegex, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";

const populateOffer = (query) =>
  query
    .populate("listing", "title listingNumber propertyType askingPrice location status")
    .populate("buyer", "fullName buyerNumber phone email")
    .populate("agent", "fullName agentNumber phone");

const sanitizeOfferBody = (body) => {
  const out = { ...body };
  if ("agent" in out)              out.agent              = out.agent || null;
  if ("offerAmount" in out)        out.offerAmount        = out.offerAmount        !== "" && out.offerAmount        != null ? Number(out.offerAmount)        : 0;
  if ("counterOfferAmount" in out) out.counterOfferAmount = out.counterOfferAmount !== "" && out.counterOfferAmount != null ? Number(out.counterOfferAmount) : null;
  if ("offerDate" in out)          out.offerDate          = out.offerDate   || null;
  if ("validityDate" in out)       out.validityDate       = out.validityDate || null;
  return out;
};

export const listOffers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", listingId = "", buyerId = "" } = req.query;
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = { business };
    if (status) filter.status = status;
    if (listingId) filter.listing = listingId;
    if (buyerId) filter.buyer = buyerId;
    if (search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ offerNumber: rx }];
    }
    const [offers, total] = await Promise.all([
      populateOffer(SaleOffer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      SaleOffer.countDocuments(filter),
    ]);
    res.status(200).json({ data: offers, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const offer = await populateOffer(SaleOffer.findOne({ _id: req.params.id, business })).lean();
    if (!offer) return next(createError(404, "Offer not found"));
    res.status(200).json(offer);
  } catch (err) {
    next(err);
  }
};

export const createOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const body = sanitizeOfferBody(req.body);

    const [listing, buyer, agent] = await Promise.all([
      SaleListing.findOne({ _id: body.listing, business }).lean(),
      SaleBuyer.findOne({ _id: body.buyer, business }).lean(),
      body.agent ? SaleAgent.findOne({ _id: body.agent, business, status: "active" }).lean() : Promise.resolve(null),
    ]);
    if (!listing) return next(createError(400, "Listing not found"));
    if (!["available", "reserved"].includes(listing.status)) {
      return next(createError(400, `Cannot create an offer on a listing that is ${listing.status}`));
    }
    if (!buyer) return next(createError(400, "Buyer not found"));
    if (body.agent && !agent) return next(createError(400, "Agent not found or inactive"));

    const offerNumber = await generateSequentialNumber(SaleOffer, business, "OFR");
    const offer = await SaleOffer.create({
      ...body,
      business,
      offerNumber,
      createdBy: userId,
      updatedBy: userId,
    });

    if (listing.status === "available") {
      await SaleListing.findByIdAndUpdate(listing._id, { status: "reserved" });
    }

    const populated = await populateOffer(SaleOffer.findById(offer._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const updateOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, offerNumber: _n, createdBy: _c, listing: _l, buyer: _by, status: _s, ...rawUpdates } = req.body;
    const updates = sanitizeOfferBody(rawUpdates);
    const offer = await populateOffer(
      SaleOffer.findOneAndUpdate(
        { _id: req.params.id, business },
        { ...updates, updatedBy: userId },
        { new: true, runValidators: true }
      )
    ).lean();
    if (!offer) return next(createError(404, "Offer not found"));
    res.status(200).json(offer);
  } catch (err) {
    next(err);
  }
};

// Offer state machine: terminal statuses are rejected, expired, withdrawn (no transitions out)
const OFFER_TRANSITIONS = {
  pending:     ["negotiating", "accepted", "rejected", "expired", "withdrawn"],
  negotiating: ["accepted", "rejected", "expired", "withdrawn"],
  accepted:    ["withdrawn"],  // back-out only; deal cancellation handles the normal reversal
  rejected:    [],
  expired:     [],
  withdrawn:   [],
};

export const updateOfferStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { status, counterOfferAmount, negotiationNotes } = req.body;

    const existingOffer = await SaleOffer.findOne({ _id: req.params.id, business }).lean();
    if (!existingOffer) return next(createError(404, "Offer not found"));

    const allowed = OFFER_TRANSITIONS[existingOffer.status] ?? [];
    if (!allowed.includes(status)) {
      return next(createError(400, `Cannot transition offer from "${existingOffer.status}" to "${status}"`));
    }

    const update = { status, updatedBy: userId };
    if (counterOfferAmount !== undefined && counterOfferAmount !== "") update.counterOfferAmount = Number(counterOfferAmount) || 0;
    if (negotiationNotes !== undefined) update.negotiationNotes = negotiationNotes;

    const offer = await SaleOffer.findOneAndUpdate(
      { _id: req.params.id, business },
      update,
      { new: true }
    ).populate("listing buyer agent").lean();

    if (!offer) return next(createError(404, "Offer not found")); // should not happen — already fetched above

    if (["rejected", "expired", "withdrawn"].includes(status)) {
      const otherActive = await SaleOffer.findOne({
        business,
        listing: offer.listing,
        _id: { $ne: offer._id },
        status: { $in: ["pending", "negotiating", "accepted"] },
      });
      if (!otherActive) {
        await SaleListing.findByIdAndUpdate(offer.listing, { status: "available" });
      }
    }

    res.status(200).json(offer);
  } catch (err) {
    next(err);
  }
};

export const deleteOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const offer = await SaleOffer.findOne({ _id: req.params.id, business });
    if (!offer) return next(createError(404, "Offer not found"));
    if (offer.status === "accepted") return next(createError(400, "Cannot delete an accepted offer — cancel the deal instead"));

    const listingId = offer.listing;
    await offer.deleteOne();

    // Restore listing to available if no other active offers remain
    const otherActive = await SaleOffer.findOne({
      business,
      listing: listingId,
      status: { $in: ["pending", "negotiating", "accepted"] },
    });
    if (!otherActive) {
      await SaleListing.findOneAndUpdate(
        { _id: listingId, business, status: "reserved" },
        { status: "available" }
      );
    }

    res.status(200).json({ message: "Offer deleted" });
  } catch (err) {
    next(err);
  }
};
