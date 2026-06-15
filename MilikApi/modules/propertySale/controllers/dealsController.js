import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOffer from "../models/SaleOffer.js";
import SalePayment from "../models/SalePayment.js";
import SaleCommission from "../models/SaleCommission.js";
import { currentUserId, escapeRegex, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { postPropertySaleCommissionAccrual, reversePropertySaleCommissionAccrual } from "../services/propertySaleAccountingService.js";

const populateDeal = (query) =>
  query
    .populate("listing", "title listingNumber propertyType askingPrice location town status")
    .populate("buyer", "fullName buyerNumber phone email")
    .populate("agent", "fullName agentNumber phone commissionRate commissionType")
    .populate("offer", "offerNumber offerAmount");

const computeTotals = async (business, dealId) => {
  const result = await SalePayment.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(String(business)), deal: new mongoose.Types.ObjectId(String(dealId)), status: "paid" } },
    { $group: { _id: "$deal", totalPaid: { $sum: "$amount" } } },
  ]);
  return result[0]?.totalPaid || 0;
};

export const listDeals = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", agentId = "", buyerId = "" } = req.query;
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = { business };
    if (status) filter.status = status;
    if (agentId) filter.agent = agentId;
    if (buyerId) filter.buyer = buyerId;
    if (search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ dealNumber: rx }];
    }
    const [deals, total] = await Promise.all([
      populateDeal(SaleDeal.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      SaleDeal.countDocuments(filter),
    ]);
    const dealIds = deals.map((d) => d._id);
    const paymentTotals = dealIds.length
      ? await SalePayment.aggregate([
          { $match: { business: new mongoose.Types.ObjectId(String(business)), deal: { $in: dealIds }, status: "paid" } },
          { $group: { _id: "$deal", totalPaid: { $sum: "$amount" } } },
        ])
      : [];
    const totalsMap = Object.fromEntries(paymentTotals.map((p) => [String(p._id), p.totalPaid]));
    const data = deals.map((d) => {
      const totalPaid = totalsMap[String(d._id)] || 0;
      return { ...d, totalPaid, balance: d.agreedPrice - totalPaid };
    });
    res.status(200).json({ data, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
};

export const getDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const deal = await populateDeal(SaleDeal.findOne({ _id: req.params.id, business })).lean();
    if (!deal) return next(createError(404, "Deal not found"));
    const totalPaid = await computeTotals(business, deal._id);
    res.status(200).json({ ...deal, totalPaid, balance: deal.agreedPrice - totalPaid });
  } catch (err) {
    next(err);
  }
};

export const createDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const [listing, buyer, agent] = await Promise.all([
      SaleListing.findOne({ _id: req.body.listing, business }).lean(),
      SaleBuyer.findOne({ _id: req.body.buyer, business }).lean(),
      req.body.agent ? SaleAgent.findOne({ _id: req.body.agent, business }).lean() : Promise.resolve(null),
    ]);
    if (!listing) return next(createError(400, "Listing not found"));
    if (listing.status === "sold") return next(createError(400, "This listing is already sold"));
    if (listing.status === "under_contract") return next(createError(400, "This listing already has an active deal"));
    if (!buyer) return next(createError(400, "Buyer not found"));
    if (req.body.agent && !agent) return next(createError(400, "Agent not found"));

    if (req.body.offer) {
      await SaleOffer.findByIdAndUpdate(req.body.offer, { status: "accepted" });
    }

    const dealNumber = await generateSequentialNumber(SaleDeal, business, "DL");
    const deal = await SaleDeal.create({
      ...req.body,
      business,
      dealNumber,
      createdBy: userId,
      updatedBy: userId,
    });

    const postDealOps = [SaleListing.findByIdAndUpdate(listing._id, { status: "under_contract" })];

    if (agent) {
      const saleAmount = req.body.agreedPrice;
      const commissionAmount = agent.commissionType === "percentage"
        ? (saleAmount * agent.commissionRate) / 100
        : agent.commissionRate;
      postDealOps.push(
        generateSequentialNumber(SaleCommission, business, "COM").then((commissionNumber) =>
          SaleCommission.create({
            business,
            commissionNumber,
            deal: deal._id,
            agent: agent._id,
            listing: req.body.listing,
            buyer: req.body.buyer,
            saleAmount,
            commissionRate: agent.commissionRate,
            commissionType: agent.commissionType,
            commissionAmount,
            status: "pending",
            createdBy: userId,
          })
        )
      );
    }

    await Promise.all(postDealOps);

    const populated = await populateDeal(SaleDeal.findById(deal._id)).lean();
    res.status(201).json({ ...populated, totalPaid: 0, balance: populated.agreedPrice });
  } catch (err) {
    next(err);
  }
};

export const updateDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    // status must go through closeDeal / cancelDeal — strip it here to prevent bypassing validation
    const { business: _b, dealNumber: _n, createdBy: _c, listing: _l, buyer: _by, offer: _o, status: _s, ...updates } = req.body;
    const deal = await populateDeal(
      SaleDeal.findOneAndUpdate(
        { _id: req.params.id, business },
        { ...updates, updatedBy: userId },
        { new: true, runValidators: true }
      )
    );
    if (!deal) return next(createError(404, "Deal not found"));
    const totalPaid = await computeTotals(business, deal._id);
    res.status(200).json({ ...deal.toObject(), totalPaid, balance: deal.agreedPrice - totalPaid });
  } catch (err) {
    next(err);
  }
};

export const closeDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business });
    if (!deal) return next(createError(404, "Deal not found"));
    if (deal.status !== "active") return next(createError(400, `Deal is already ${deal.status}`));

    const totalPaid = await computeTotals(business, deal._id);
    if (totalPaid < deal.agreedPrice) {
      return next(createError(400, `Outstanding balance of KES ${(deal.agreedPrice - totalPaid).toLocaleString()} must be cleared before closing`));
    }

    deal.status = "closed";
    deal.actualClosingDate = req.body.actualClosingDate || new Date();
    deal.titleTransferDate = req.body.titleTransferDate || null;
    deal.handoverNotes = req.body.handoverNotes || deal.handoverNotes;
    deal.updatedBy = userId;
    await deal.save();

    const [, pendingCommissions] = await Promise.all([
      SaleListing.findByIdAndUpdate(deal.listing, { status: "sold" }),
      SaleCommission.find({ business, deal: deal._id, status: "pending" }).lean(),
    ]);

    // Post GL accrual for each pending commission before approving them
    for (const commission of pendingCommissions) {
      postPropertySaleCommissionAccrual({ businessId: business, commission, userId }).catch((err) =>
        console.error("[PS GL] postPropertySaleCommissionAccrual failed:", err.message)
      );
    }
    await SaleCommission.updateMany({ business, deal: deal._id, status: "pending" }, { status: "approved" });

    res.status(200).json({ ...deal.toObject(), totalPaid, balance: 0 });
  } catch (err) {
    next(err);
  }
};

export const cancelDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business });
    if (!deal) return next(createError(404, "Deal not found"));
    if (deal.status === "closed") return next(createError(400, "Cannot cancel a closed deal"));
    if (deal.status === "cancelled") return next(createError(400, "Deal is already cancelled"));

    const paidPaymentCount = await SalePayment.countDocuments({ business, deal: deal._id, status: "paid" });
    if (paidPaymentCount > 0) {
      return next(createError(400, `${paidPaymentCount} payment(s) must be voided before cancelling this deal`));
    }

    deal.status = "cancelled";
    deal.notes = req.body.cancellationReason ? `Cancelled: ${req.body.cancellationReason}` : deal.notes;
    deal.updatedBy = userId;
    await deal.save();

    const [, approvedCommissions] = await Promise.all([
      SaleListing.findByIdAndUpdate(deal.listing, { status: "available" }),
      SaleCommission.find({ business, deal: deal._id, status: "approved" }).lean(),
    ]);

    // Reverse GL accrual for any already-approved commissions before cancelling
    const cancellationReason = req.body.cancellationReason ? `Deal cancelled: ${req.body.cancellationReason}` : "Deal cancelled";
    for (const commission of approvedCommissions) {
      reversePropertySaleCommissionAccrual({ businessId: business, commission, userId, reason: cancellationReason }).catch((err) =>
        console.error("[PS GL] reversePropertySaleCommissionAccrual failed:", err.message)
      );
    }
    await SaleCommission.updateMany({ business, deal: deal._id, status: { $in: ["pending", "approved"] } }, { status: "cancelled" });

    res.status(200).json(deal);
  } catch (err) {
    next(err);
  }
};

export const deleteDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business });
    if (!deal) return next(createError(404, "Deal not found"));
    if (deal.status !== "cancelled") return next(createError(400, "Only cancelled deals can be deleted"));

    const paidPayments = await SalePayment.countDocuments({ business, deal: deal._id, status: "paid" });
    if (paidPayments > 0) return next(createError(400, "Cannot delete a deal with confirmed payments — void them first"));

    await SalePayment.deleteMany({ business, deal: deal._id });
    await SaleCommission.deleteMany({ business, deal: deal._id });
    await SaleDeal.findByIdAndDelete(deal._id);

    res.status(200).json({ message: "Deal deleted" });
  } catch (err) {
    next(err);
  }
};
