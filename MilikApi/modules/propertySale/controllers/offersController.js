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

export const listOffers = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", listingId = "", buyerId = "" } = req.query;
    const filter = { business };
    if (status) filter.status = status;
    if (listingId) filter.listing = listingId;
    if (buyerId) filter.buyer = buyerId;
    if (search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ offerNumber: rx }];
    }
    const offers = await populateOffer(SaleOffer.find(filter).sort({ createdAt: -1 })).lean();
    res.status(200).json(offers);
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

    const listing = await SaleListing.findOne({ _id: req.body.listing, business }).lean();
    if (!listing) return next(createError(400, "Listing not found"));
    if (!["available", "reserved"].includes(listing.status)) {
      return next(createError(400, `Cannot create an offer on a listing that is ${listing.status}`));
    }

    const buyer = await SaleBuyer.findOne({ _id: req.body.buyer, business }).lean();
    if (!buyer) return next(createError(400, "Buyer not found"));

    if (req.body.agent) {
      const agent = await SaleAgent.findOne({ _id: req.body.agent, business, status: "active" }).lean();
      if (!agent) return next(createError(400, "Agent not found or inactive"));
    }

    const offerNumber = await generateSequentialNumber(SaleOffer, business, "OFR");
    const offer = await SaleOffer.create({
      ...req.body,
      business,
      offerNumber,
      createdBy: userId,
      updatedBy: userId,
    });

    if (listing.status === "available") {
      await SaleListing.findByIdAndUpdate(listing._id, { status: "reserved" });
    }

    const populated = await populateOffer(SaleOffer.findById(offer._id));
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const updateOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { business: _b, offerNumber: _n, createdBy: _c, listing: _l, buyer: _by, ...updates } = req.body;
    const offer = await populateOffer(
      SaleOffer.findOneAndUpdate(
        { _id: req.params.id, business },
        { ...updates, updatedBy: userId },
        { new: true, runValidators: true }
      )
    );
    if (!offer) return next(createError(404, "Offer not found"));
    res.status(200).json(offer);
  } catch (err) {
    next(err);
  }
};

export const updateOfferStatus = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const VALID = ["pending", "negotiating", "accepted", "rejected", "expired", "withdrawn"];
    const { status, counterOfferAmount, negotiationNotes } = req.body;
    if (!VALID.includes(status)) return next(createError(400, "Invalid offer status"));

    const update = { status, updatedBy: userId };
    if (counterOfferAmount !== undefined) update.counterOfferAmount = counterOfferAmount;
    if (negotiationNotes !== undefined) update.negotiationNotes = negotiationNotes;

    const offer = await SaleOffer.findOneAndUpdate(
      { _id: req.params.id, business },
      update,
      { new: true }
    ).populate("listing buyer agent");

    if (!offer) return next(createError(404, "Offer not found"));

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
    await offer.deleteOne();
    res.status(200).json({ message: "Offer deleted" });
  } catch (err) {
    next(err);
  }
};
