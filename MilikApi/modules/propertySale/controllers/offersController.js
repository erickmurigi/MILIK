import { createError } from "../../../utils/error.js";
import SaleOffer from "../models/SaleOffer.js";
import SaleListing from "../models/SaleListing.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import { currentUserId, escapeRegex, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { agentFilter } from "../middleware/agentScope.js";

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
    const filter = { business, ...agentFilter(req) };
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
    const offer = await populateOffer(SaleOffer.findOne({ _id: req.params.id, business, ...agentFilter(req) })).lean();
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
    // Scoped agents always create offers for themselves
    if (req.saleAgentId) body.agent = req.saleAgentId;

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
    // A scoped agent cannot hand their offer to someone else
    if (req.saleAgentId) delete updates.agent;
    const offer = await populateOffer(
      SaleOffer.findOneAndUpdate(
        { _id: req.params.id, business, ...agentFilter(req) },
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

// A listing can carry only one live "accepted" claim at a time. The claim is an atomic
// compare-and-set on SaleListing.acceptedOffer (status available|reserved + acceptedOffer null), so two
// concurrent accepts can never both win. Accepting parks the listing as "reserved" (NOT under_contract):
// createDealFromOffer / createDeal reject under_contract listings and are the ones that move it there.
const isAcceptedClaimLive = async (business, offerId) => {
  const accepted = await SaleOffer.exists({ _id: offerId, business, status: "accepted" });
  if (!accepted) return false;
  const deals = await SaleDeal.find({ business, offer: offerId }).select("status").lean();
  // accepted with no deal yet, or with a non-cancelled deal => still live
  return deals.length === 0 || deals.some((d) => d.status !== "cancelled");
};

const claimListingForOffer = async (business, listingId, offerId) => {
  const claim = () =>
    SaleListing.findOneAndUpdate(
      { _id: listingId, business, status: { $in: ["available", "reserved"] }, acceptedOffer: null },
      { $set: { status: "reserved", acceptedOffer: offerId } },
      { new: false }
    ).select("status").lean();

  let previous = await claim();
  if (previous) return { previousStatus: previous.status };

  const current = await SaleListing.findOne({ _id: listingId, business }).select("status acceptedOffer").lean();
  if (!current) return { error: createError(400, "Listing not found") };
  if (!["available", "reserved"].includes(current.status)) {
    return { error: createError(409, `Cannot accept this offer — the listing is already ${current.status.replace("_", " ")}`) };
  }
  if (current.acceptedOffer) {
    if (await isAcceptedClaimLive(business, current.acceptedOffer)) {
      return { error: createError(409, "Another offer has already been accepted for this listing") };
    }
    // Stale pointer (offer withdrawn/rejected or its deal was cancelled) — clear it and retry once
    await SaleListing.updateOne({ _id: listingId, business, acceptedOffer: current.acceptedOffer }, { $set: { acceptedOffer: null } });
    previous = await claim();
    if (previous) return { previousStatus: previous.status };
  }
  return { error: createError(409, "The listing was changed by another request — please refresh and try again") };
};

const releaseListingClaim = (business, listingId, offerId, previousStatus) =>
  SaleListing.updateOne(
    { _id: listingId, business, acceptedOffer: offerId, status: "reserved" },
    { $set: { acceptedOffer: null, status: previousStatus } }
  );

export const updateOfferStatus = async (req, res, next) => {
  let claim = null;
  let existingOffer = null;
  let business = null;
  try {
    business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { status, counterOfferAmount, negotiationNotes } = req.body;

    existingOffer = await SaleOffer.findOne({ _id: req.params.id, business, ...agentFilter(req) }).lean();
    if (!existingOffer) return next(createError(404, "Offer not found"));

    const allowed = OFFER_TRANSITIONS[existingOffer.status] ?? [];
    if (!allowed.includes(status)) {
      return next(createError(400, `Cannot transition offer from "${existingOffer.status}" to "${status}"`));
    }

    const update = { status, updatedBy: userId };
    if (counterOfferAmount !== undefined && counterOfferAmount !== "") {
      if (counterOfferAmount === null) {
        update.counterOfferAmount = null;
      } else {
        const amount = typeof counterOfferAmount === "number" || typeof counterOfferAmount === "string" ? Number(counterOfferAmount) : NaN;
        if (!Number.isFinite(amount) || amount < 0) {
          return next(createError(400, "Counter offer amount must be a valid non-negative number"));
        }
        update.counterOfferAmount = amount;
      }
    }
    if (negotiationNotes !== undefined) update.negotiationNotes = negotiationNotes;

    // Backing out of an accepted offer is blocked once a live deal exists — the deal must be cancelled first.
    if (existingOffer.status === "accepted" && status === "withdrawn") {
      const liveDeal = await SaleDeal.exists({ business, offer: existingOffer._id, status: { $ne: "cancelled" } });
      if (liveDeal) {
        return next(createError(400, "This offer has a deal linked to it — cancel the deal first before withdrawing the offer"));
      }
    }

    // Accepting: atomically claim the listing so only one offer per listing can be accepted.
    if (status === "accepted") {
      const result = await claimListingForOffer(business, existingOffer.listing, existingOffer._id);
      if (result.error) return next(result.error);
      claim = result;
    }

    // Compare-and-set on the current status so a concurrent transition can't be silently overwritten
    const offer = await SaleOffer.findOneAndUpdate(
      { _id: req.params.id, business, ...agentFilter(req), status: existingOffer.status },
      update,
      { new: true }
    ).populate("listing buyer agent").lean();

    if (!offer) {
      if (claim) await releaseListingClaim(business, existingOffer.listing, existingOffer._id, claim.previousStatus);
      claim = null;
      return next(createError(409, "Offer was changed by another request — please refresh and try again"));
    }

    if (claim) {
      try {
        // The accepted offer wins: every other open offer on this listing is rejected.
        await SaleOffer.updateMany(
          { business, listing: existingOffer.listing, _id: { $ne: offer._id }, status: { $in: ["pending", "negotiating"] } },
          { $set: { status: "rejected", updatedBy: userId } }
        );
      } catch (err) {
        await SaleOffer.updateOne({ _id: offer._id, business }, { $set: { status: existingOffer.status } });
        await releaseListingClaim(business, existingOffer.listing, existingOffer._id, claim.previousStatus);
        claim = null;
        throw err;
      }
    }

    if (["rejected", "expired", "withdrawn"].includes(status)) {
      // Release this offer's claim on the listing if it held one
      if (existingOffer.status === "accepted") {
        await SaleListing.updateOne(
          { _id: existingOffer.listing, business, acceptedOffer: existingOffer._id },
          { $set: { acceptedOffer: null } }
        );
      }
      const otherActive = await SaleOffer.exists({
        business,
        listing: existingOffer.listing,
        _id: { $ne: offer._id },
        status: { $in: ["pending", "negotiating", "accepted"] },
      });
      if (!otherActive) {
        // Only reopen a listing that is merely reserved — never one that is under contract / sold
        await SaleListing.findOneAndUpdate(
          { _id: existingOffer.listing, business, status: "reserved" },
          { status: "available" }
        );
      }
    }

    res.status(200).json(offer);
  } catch (err) {
    if (claim) {
      // Unexpected failure after the listing was claimed — hand the claim back
      try { await releaseListingClaim(business, existingOffer.listing, existingOffer._id, claim.previousStatus); } catch { /* best effort */ }
    }
    next(err);
  }
};

export const deleteOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const offer = await SaleOffer.findOne({ _id: req.params.id, business, ...agentFilter(req) });
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
