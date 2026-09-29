import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleListing from "../models/SaleListing.js";
import SaleBuyer from "../models/SaleBuyer.js";
import SaleAgent from "../models/SaleAgent.js";
import SaleOffer from "../models/SaleOffer.js";
import SalePayment from "../models/SalePayment.js";
import SalePaymentSchedule from "../models/SalePaymentSchedule.js";
import SaleCommission from "../models/SaleCommission.js";
import { currentUserId, escapeRegex, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import {
  postPropertySaleCommissionAccrual,
  reversePropertySaleCommissionAccrual,
  transferDepositToRevenue,
  forfeitDepositIncome,
  postStampDutyEntry,
} from "../services/propertySaleAccountingService.js";
import SaleSettings from "../models/SaleSettings.js";
import { calcWithholding, clampWhtRate } from "../../../utils/withholdingTax.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import Company from "../../../models/Company.js";
import { sendAdHocSms, sendAdHocEmail } from "../../../services/communicationService.js";
import { deleteDocumentFile } from "../middleware/dealDocumentUpload.js";
import { agentFilter } from "../middleware/agentScope.js";
import { andInto, searchWords, wordsSearchFilter } from "../services/saleSearch.js";
import { round2 } from "../../../utils/math.js";

const fillPlaceholders = (text, vars) =>
  String(text || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

// Rate used when the deal doesn't set one: the company's default from Property Sale settings, else the statutory 5%
const DEFAULT_COMMISSION_WHT_RATE = 5;
const defaultWhtRate = async (business) => {
  const settings = await SaleSettings.findOne({ business }).select("commissionDefaults.whtRate").lean();
  return clampWhtRate(settings?.commissionDefaults?.whtRate, DEFAULT_COMMISSION_WHT_RATE);
};

const createCommissionForDeal = async ({ business, dealId, agent, listingId, buyerId, agreedPrice, overrides, userId }) => {
  const saleAmount     = Number(agreedPrice);
  const commissionRate = overrides.commissionRateOverride != null ? Number(overrides.commissionRateOverride) : agent.commissionRate;
  const commissionType = overrides.commissionTypeOverride ?? agent.commissionType;
  const commissionAmount = round2(
    overrides.commissionAmountOverride != null
      ? Number(overrides.commissionAmountOverride)
      : commissionType === "percentage"
        ? (saleAmount * commissionRate) / 100
        : commissionRate
  );
  // Store the rate actually applied so whtRate always agrees with whtAmount
  const { whtRate, whtAmount, netAmount } = calcWithholding(
    commissionAmount,
    overrides.whtRate != null && overrides.whtRate !== "" ? overrides.whtRate : await defaultWhtRate(business)
  );
  const commissionNumber = await generateSequentialNumber(SaleCommission, business, "COM");
  return SaleCommission.create({
    business, commissionNumber, deal: dealId, agent: agent._id,
    listing: listingId, buyer: buyerId,
    saleAmount, commissionRate, commissionType, commissionAmount,
    whtRate, whtAmount, netAmount,
    status: "pending", createdBy: userId,
  });
};

const sanitizeDealBody = (body) => {
  const out = { ...body };
  if ("agent" in out)               out.agent               = out.agent || null;
  if ("offer" in out)               out.offer               = out.offer || null;
  if ("agreedPrice" in out)         out.agreedPrice         = out.agreedPrice         !== "" && out.agreedPrice         != null ? Number(out.agreedPrice)         : 0;
  if ("stampDutyAmount" in out)     out.stampDutyAmount     = out.stampDutyAmount     !== "" && out.stampDutyAmount     != null ? Number(out.stampDutyAmount)     : 0;
  if ("dealDate" in out)            out.dealDate            = out.dealDate            || null;
  if ("expectedClosingDate" in out) out.expectedClosingDate = out.expectedClosingDate || null;
  if ("titleTransferDate" in out)   out.titleTransferDate   = out.titleTransferDate   || null;
  return out;
};

const populateDeal = (query) =>
  query
    .populate("listing", "title listingNumber propertyType askingPrice location town county size sizeUnit status")
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

const TERMINAL_OFFER_STATUSES = ["rejected", "expired", "withdrawn"];
// Body ids must be plain ObjectId strings — rejects objects such as { $ne: null } reaching a query
const isIdString = (v) => typeof v === "string" && mongoose.isValidObjectId(v);

/**
 * Persists a new deal and its side effects with compensation (no multi-doc transaction:
 * this module's writes are spread across several helpers and models). Steps:
 *   1. validate the deal doc up front (no writes yet)
 *   2. atomically claim the listing (conditional findOneAndUpdate) — the concurrency gate
 *   3. save deal -> create commission -> mark offer accepted
 * If step 3 fails, everything already written is undone (deal + commissions deleted,
 * listing/offer status restored) and the original error is rethrown.
 */
const persistNewDeal = async ({ business, userId, dealDoc, listing, agent, offer, commissionArgs }) => {
  await dealDoc.validate();

  const prevListing = await SaleListing.findOneAndUpdate(
    { _id: listing._id, business, status: { $nin: ["sold", "under_contract"] } },
    { status: "under_contract" }
  ).select("status").lean();
  if (!prevListing) throw createError(400, "This listing is already sold or has an active deal");

  let offerFlipped = false;
  try {
    await dealDoc.save();
    if (agent) await createCommissionForDeal({ ...commissionArgs, business, dealId: dealDoc._id, agent, userId });
    if (offer && offer.status !== "accepted") {
      await SaleOffer.updateOne({ _id: offer._id, business }, { status: "accepted", updatedBy: userId });
      offerFlipped = true;
    }
  } catch (err) {
    const undo = await Promise.allSettled([
      SaleCommission.deleteMany({ business, deal: dealDoc._id }),
      SaleDeal.deleteOne({ _id: dealDoc._id, business }),
      SaleListing.updateOne({ _id: listing._id, business, status: "under_contract" }, { status: prevListing.status }),
      offerFlipped ? SaleOffer.updateOne({ _id: offer._id, business, status: "accepted" }, { status: offer.status }) : null,
    ]);
    undo.forEach((r) => { if (r.status === "rejected") console.error("[propertySale] deal-create compensation failed:", r.reason); });
    throw err;
  }
};

export const listDeals = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { search = "", status = "", agentId = "", buyerId = "", listingId = "", dateFrom = "", dateTo = "" } = req.query;
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const filter = { business };
    if (status) {
      filter.status = status;
    } else if (req.query?.includeCancelled !== "true") {
      // cancelled deals are kept for the audit trail but stay out of the working list unless asked for
      filter.status = { $ne: "cancelled" };
    }
    // agent-scoped user can only see their own deals
    if (req.saleAgentId) filter.agent = req.saleAgentId;
    else if (agentId)    filter.agent = agentId;
    if (buyerId)   filter.buyer   = buyerId;
    if (listingId) filter.listing = listingId;
    if (dateFrom || dateTo) {
      filter.dealDate = {};
      if (dateFrom) filter.dealDate.$gte = new Date(dateFrom);
      if (dateTo)   filter.dealDate.$lte = new Date(dateTo + "T23:59:59.999Z");
    }
    // A deal is found by its number, its buyer (name / number / phone) or its listing (title / number / unit / location);
    // every word typed must be found, each in any of those (so "karen wanjiru" = listing word + buyer word)
    const words = searchWords(String(search));
    if (words.length) {
      const clauses = await Promise.all(words.map(async (word) => {
        const [buyerIds, listingIds] = await Promise.all([
          SaleBuyer.distinct("_id", { business, ...wordsSearchFilter(word, ["fullName", "buyerNumber", "phone", "email"], { phoneFields: ["phone"] }) }),
          SaleListing.distinct("_id", { business, ...wordsSearchFilter(word, ["title", "listingNumber", "unitNumber", "location", "town"]) }),
        ]);
        return { $or: [{ dealNumber: new RegExp(escapeRegex(word), "i") }, { buyer: { $in: buyerIds } }, { listing: { $in: listingIds } }] };
      }));
      clauses.forEach((clause) => andInto(filter, clause));
    }
    const [deals, total] = await Promise.all([
      // documents are loaded per deal via getDeal (detail panel) — omitted from list rows
      populateDeal(SaleDeal.find(filter).select("-documents").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
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
    const deal = await populateDeal(SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) })).lean();
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

    const { listing: listingId, buyer: buyerId, offer: offerId } = req.body;
    // Agent-scoped users can only create deals assigned to themselves
    const agentId = req.saleAgentId || req.body.agent;

    if (!isIdString(listingId)) return next(createError(400, "Listing not found"));
    if (!isIdString(buyerId))   return next(createError(400, "Buyer not found"));
    if (agentId && !isIdString(agentId)) return next(createError(400, "Agent not found"));
    if (offerId && !isIdString(offerId)) return next(createError(400, "Offer not found"));

    const [listing, buyer, agent, offer] = await Promise.all([
      SaleListing.findOne({ _id: listingId, business }).lean(),
      SaleBuyer.findOne({ _id: buyerId, business }).lean(),
      agentId ? SaleAgent.findOne({ _id: agentId, business }).lean() : Promise.resolve(null),
      offerId ? SaleOffer.findOne({ _id: offerId, business }).select("_id listing status").lean() : Promise.resolve(null),
    ]);
    if (!listing) return next(createError(400, "Listing not found"));
    if (listing.status === "sold") return next(createError(400, "This listing is already sold"));
    if (listing.status === "under_contract") return next(createError(400, "This listing already has an active deal"));
    if (!buyer) return next(createError(400, "Buyer not found"));
    if (agentId && !agent) return next(createError(400, "Agent not found"));
    if (offerId) {
      if (!offer) return next(createError(400, "Offer not found"));
      if (TERMINAL_OFFER_STATUSES.includes(offer.status)) return next(createError(400, `Cannot create a deal from a ${offer.status} offer`));
      if (String(offer.listing) !== String(listing._id)) return next(createError(400, "Offer does not belong to the selected listing"));
    }

    // Strip commission override fields (they belong on the commission record) and server-controlled fields
    const {
      commissionRateOverride, commissionTypeOverride, commissionAmountOverride, whtRate,
      status: _s, documents: _d, actualClosingDate: _a, _id: _i,
      ...rawDealBody
    } = req.body;
    const dealBody = sanitizeDealBody(rawDealBody);

    const dealNumber = await generateSequentialNumber(SaleDeal, business, "DL");
    // Only the business-verified ids are persisted — never the raw body values
    const dealDoc = new SaleDeal({
      ...dealBody,
      business,
      dealNumber,
      listing: listing._id,
      buyer: buyer._id,
      agent: agent?._id ?? null,
      offer: offer?._id ?? null,
      createdBy: userId,
      updatedBy: userId,
    });

    await persistNewDeal({
      business, userId, dealDoc, listing, agent, offer,
      commissionArgs: {
        listingId: listing._id, buyerId: buyer._id,
        agreedPrice: dealDoc.agreedPrice,
        overrides: { commissionRateOverride, commissionTypeOverride, commissionAmountOverride, whtRate },
      },
    });

    const populated = await populateDeal(SaleDeal.findById(dealDoc._id)).lean();
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
    const { business: _b, dealNumber: _n, createdBy: _c, listing: _l, buyer: _by, offer: _o, status: _s, documents: _d, _id: _i, ...rawUpdates } = req.body;
    const updates = sanitizeDealBody(rawUpdates);

    // Agent-scoped users cannot reassign a deal to another agent
    if (req.saleAgentId) delete updates.agent;

    // Agent id comes from the body — must belong to this business
    if (updates.agent && (!isIdString(updates.agent) || !(await SaleAgent.exists({ _id: updates.agent, business })))) {
      return next(createError(400, "Agent not found"));
    }

    // agreedPrice changes must be reconciled with payments already taken and any payment schedule
    let priceChange = null;
    if ("agreedPrice" in updates) {
      const existing = await SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) }).select("agreedPrice status").lean();
      if (!existing) return next(createError(404, "Deal not found"));
      const newPrice = round2(updates.agreedPrice);
      if (newPrice !== round2(existing.agreedPrice)) {
        if (existing.status !== "active") return next(createError(400, `Agreed price cannot be changed on a ${existing.status} deal`));
        priceChange = { old: existing.agreedPrice, new: newPrice };
        const [totalPaid, scheduleAgg] = await Promise.all([
          computeTotals(business, existing._id),
          SalePaymentSchedule.aggregate([
            { $match: { business: new mongoose.Types.ObjectId(String(business)), deal: existing._id } },
            { $group: { _id: null, total: { $sum: "$expectedAmount" }, count: { $sum: 1 } } },
          ]),
        ]);
        if (newPrice < round2(totalPaid) - 0.01) {
          return next(createError(400, `Agreed price (KES ${newPrice.toLocaleString()}) cannot be less than the KES ${round2(totalPaid).toLocaleString()} already paid on this deal`));
        }
        const sched = scheduleAgg[0];
        // same tolerance as setSchedule (KES 1)
        if (sched?.count && Math.abs(sched.total - newPrice) > 1) {
          return next(createError(400, `This deal has a payment schedule totalling KES ${round2(sched.total).toLocaleString()}. Reissue the payment schedule for the new agreed price before changing it`));
        }
      }
    }

    const deal = await populateDeal(
      SaleDeal.findOneAndUpdate(
        { _id: req.params.id, business, ...agentFilter(req) },
        { ...updates, updatedBy: userId },
        { new: true, runValidators: true }
      )
    ).lean();
    if (!deal) return next(createError(404, "Deal not found"));

    // Keep the agent's not-yet-approved commission in step with the new price. Only percentage
    // commissions that were derived from the old price follow it; flat amounts and manual overrides stay.
    // Approved/paid commissions are never touched (they may already have ledger entries).
    if (priceChange) {
      const pending = await SaleCommission.find({ business, deal: deal._id, status: "pending" }).lean();
      await Promise.all(pending.map((c) => {
        const patch = { saleAmount: priceChange.new };
        const derivedFromOldPrice =
          c.commissionType === "percentage" &&
          Math.abs(c.commissionAmount - round2((priceChange.old * c.commissionRate) / 100)) <= 0.01;
        if (derivedFromOldPrice) {
          const commissionAmount = round2((priceChange.new * c.commissionRate) / 100);
          const { whtAmount, netAmount } = calcWithholding(commissionAmount, c.whtRate);
          Object.assign(patch, { commissionAmount, whtAmount, netAmount });
        }
        return SaleCommission.updateOne({ _id: c._id, business, status: "pending" }, { $set: { ...patch, updatedBy: userId } });
      }));
    }

    const totalPaid = await computeTotals(business, deal._id);
    res.status(200).json({ ...deal, totalPaid, balance: deal.agreedPrice - totalPaid });
  } catch (err) {
    next(err);
  }
};

export const closeDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) });
    if (!deal) return next(createError(404, "Deal not found"));
    if (deal.status !== "active") return next(createError(400, `Deal is already ${deal.status}`));

    const totalPaid = await computeTotals(business, deal._id);
    if (round2(totalPaid) < round2(deal.agreedPrice) - 0.01) {
      return next(createError(400, `Outstanding balance of KES ${round2(deal.agreedPrice - totalPaid).toLocaleString()} must be cleared before closing`));
    }

    const stampDutyAmount = Number(req.body.stampDutyAmount || 0);

    // Resolve stamp duty cashbook BEFORE mutating the deal so a bad account can't leave a half-closed deal
    let stampDutyCashbookId = null;
    if (stampDutyAmount > 0 && req.body.stampDutyCashbook) {
      const cbAcc = await ChartOfAccount.findOne({
        _id: req.body.stampDutyCashbook, business,
        isPosting: { $ne: false }, isHeader: { $ne: true },
      }).lean();
      if (!cbAcc) return next(createError(400, "Stamp duty cashbook account not found"));
      stampDutyCashbookId = cbAcc._id;
    }

    // Snapshot fields close mutates so a GL failure can restore them exactly
    const prior = {
      stampDutyAmount:   deal.stampDutyAmount,
      actualClosingDate: deal.actualClosingDate,
      titleTransferDate: deal.titleTransferDate,
      handoverNotes:     deal.handoverNotes,
    };
    deal.status = "closed";
    deal.actualClosingDate = req.body.actualClosingDate || new Date();
    deal.titleTransferDate = req.body.titleTransferDate || null;
    deal.handoverNotes = req.body.handoverNotes || deal.handoverNotes;
    if (stampDutyAmount > 0) deal.stampDutyAmount = stampDutyAmount;
    deal.updatedBy = userId;
    await deal.save();

    const [, pendingCommissions, depositPayments] = await Promise.all([
      SaleListing.findByIdAndUpdate(deal.listing, { status: "sold" }),
      SaleCommission.find({ business, deal: deal._id, status: "pending" }).lean(),
      SalePayment.find({ business, deal: deal._id, paymentType: "deposit", status: "paid" }).lean(),
    ]);

    // Post all GL: commissions + deposit transfers + stamp duty — roll back if any fail
    try {
      await Promise.all([
        ...pendingCommissions.map((commission) =>
          postPropertySaleCommissionAccrual({ businessId: business, commission, userId })
        ),
        ...depositPayments.map((payment) =>
          transferDepositToRevenue({ businessId: business, payment, userId })
        ),
      ]);
      if (stampDutyAmount > 0) {
        await postStampDutyEntry({
          businessId: business,
          dealId: String(deal._id),
          amount: stampDutyAmount,
          cashbookAccountId: stampDutyCashbookId,
          userId,
          date: deal.actualClosingDate,
        });
      }
    } catch (glErr) {
      deal.status = "active";
      deal.stampDutyAmount   = prior.stampDutyAmount;
      deal.actualClosingDate = prior.actualClosingDate;
      deal.titleTransferDate = prior.titleTransferDate;
      deal.handoverNotes     = prior.handoverNotes;
      deal.updatedBy = userId;
      await deal.save();
      await SaleListing.findByIdAndUpdate(deal.listing, { status: "under_contract" });
      return next(createError(422, `GL posting failed during deal close: ${glErr.message}. Deal has been rolled back to active.`));
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
    const deal = await SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) });
    if (!deal) return next(createError(404, "Deal not found"));
    if (deal.status === "closed") return next(createError(400, "Cannot cancel a closed deal"));
    if (deal.status === "cancelled") return next(createError(400, "Deal is already cancelled"));

    // depositAction: "void" means caller must void deposits first; "forfeit" means retain as income
    const depositAction = req.body.depositAction === "forfeit" ? "forfeit" : "void";

    const [depositPayments, nonDepositPaidCount, paidCommissionCount] = await Promise.all([
      SalePayment.find({ business, deal: deal._id, paymentType: "deposit", status: "paid" }).lean(),
      SalePayment.countDocuments({ business, deal: deal._id, paymentType: { $ne: "deposit" }, status: "paid" }),
      SaleCommission.countDocuments({ business, deal: deal._id, status: "paid" }),
    ]);
    if (nonDepositPaidCount > 0) {
      return next(createError(400, `${nonDepositPaidCount} non-deposit payment(s) must be voided before cancelling this deal`));
    }
    if (depositPayments.length > 0 && depositAction === "void") {
      return next(createError(400, `${depositPayments.length} deposit payment(s) must be voided first, or set depositAction="forfeit" to retain them as income`));
    }
    if (paidCommissionCount > 0) {
      return next(createError(400, `${paidCommissionCount} commission(s) have already been paid out — reverse them before cancelling this deal`));
    }

    deal.status = "cancelled";
    deal.notes = req.body.cancellationReason ? `Cancelled: ${req.body.cancellationReason}` : deal.notes;
    deal.updatedBy = userId;
    await deal.save();

    const [, approvedCommissions] = await Promise.all([
      SaleListing.findByIdAndUpdate(deal.listing, { status: "available" }),
      SaleCommission.find({ business, deal: deal._id, status: "approved" }).lean(),
    ]);

    // Reverse GL accrual for approved commissions — roll back deal if any reversal fails
    const cancellationReason = req.body.cancellationReason ? `Deal cancelled: ${req.body.cancellationReason}` : "Deal cancelled";
    try {
      await Promise.all(
        approvedCommissions.map((commission) =>
          reversePropertySaleCommissionAccrual({ businessId: business, commission, userId, reason: cancellationReason })
        )
      );
    } catch (glErr) {
      deal.status = "active";
      deal.updatedBy = userId;
      await deal.save();
      await SaleListing.findByIdAndUpdate(deal.listing, { status: "under_contract" });
      return next(createError(422, `GL reversal failed during deal cancellation: ${glErr.message}. Deal has been rolled back to active.`));
    }
    await SaleCommission.updateMany({ business, deal: deal._id, status: { $in: ["pending", "approved"] } }, { status: "cancelled" });

    // Forfeit deposit payments to income if requested
    if (depositPayments.length > 0 && depositAction === "forfeit") {
      const forfeitReason = `Deposit forfeited — deal ${deal.dealNumber} cancelled${req.body.cancellationReason ? `: ${req.body.cancellationReason}` : ""}`;
      try {
        await Promise.all(depositPayments.map((payment) =>
          forfeitDepositIncome({ businessId: business, payment, userId, reason: forfeitReason })
        ));
      } catch (glErr) {
        // Forfeit posting failed — log but don't roll back; deal is already cancelled
        // User can post a manual journal entry to fix the GL
        return next(createError(422, `Deal cancelled but deposit forfeit GL posting failed: ${glErr.message}. Post a manual journal entry to transfer deposits from "Buyer Deposit Held" to "Forfeited Deposit Income".`));
      }
    }

    res.status(200).json(deal);
  } catch (err) {
    next(err);
  }
};

export const deleteDeal = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) }).lean();
    if (!deal) return next(createError(404, "Deal not found"));
    if (deal.status !== "cancelled") return next(createError(400, "Only cancelled deals can be deleted"));

    const paidPayments = await SalePayment.countDocuments({ business, deal: deal._id, status: "paid" });
    if (paidPayments > 0) return next(createError(400, "Cannot delete a deal with confirmed payments — void them first"));

    await Promise.all([
      SalePayment.deleteMany({ business, deal: deal._id }),
      SaleCommission.deleteMany({ business, deal: deal._id }),
      SalePaymentSchedule.deleteMany({ business, deal: deal._id }),
      SaleDeal.findByIdAndDelete(deal._id),
    ]);
    // Remove the deal's uploaded files from disk so they aren't orphaned
    (deal.documents || []).forEach((d) => d?.filename && deleteDocumentFile(d.filename));

    res.status(200).json({ message: "Deal deleted" });
  } catch (err) {
    next(err);
  }
};

export const sendDealSms = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) })
      .populate("buyer", "fullName phone").lean();
    if (!deal) return next(createError(404, "Deal not found"));
    const phone = String(req.body.phone || deal.buyer?.phone || "").trim();
    const body  = String(req.body.body || "").trim();
    if (!phone) return next(createError(400, "Buyer has no phone number on this deal"));
    if (!body)  return next(createError(400, "Message body is required"));
    await sendAdHocSms({ businessId: business, phone, body, templateKey: "sale_deal_manual" });
    res.json({ success: true, message: "SMS sent" });
  } catch (err) {
    next(err);
  }
};

export const sendDealEmail = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const [deal, company] = await Promise.all([
      SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) })
        .populate("buyer",   "fullName email phone buyerNumber")
        .populate("listing", "title listingNumber propertyType location town county askingPrice size sizeUnit")
        .populate("agent",   "fullName")
        .lean(),
      Company.findById(business).select("companyName name phoneNo email").lean(),
    ]);
    if (!deal) return next(createError(404, "Deal not found"));
    const to      = String(req.body.to      || deal.buyer?.email || "").trim();
    const subject = String(req.body.subject || "").trim();
    const body    = String(req.body.body    || "").trim();
    if (!to)      return next(createError(400, "Buyer has no email address on this deal"));
    if (!subject) return next(createError(400, "Email subject is required"));
    if (!body)    return next(createError(400, "Email body is required"));
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const fmtNum  = (n) => n != null ? Number(n).toLocaleString() : "";
    const vars = {
      // Buyer
      buyerName:            deal.buyer?.fullName      || "Buyer",
      buyerNumber:          deal.buyer?.buyerNumber   || "",
      phone:                deal.buyer?.phone         || "",
      email:                deal.buyer?.email         || "",
      // Deal
      dealNumber:           deal.dealNumber           || "",
      dealStatus:           deal.status               || "",
      salePrice:            fmtNum(deal.agreedPrice),
      dealDate:             fmtDate(deal.dealDate),
      expectedClosingDate:  fmtDate(deal.expectedClosingDate),
      actualClosingDate:    fmtDate(deal.actualClosingDate),
      titleTransferDate:    fmtDate(deal.titleTransferDate),
      stampDuty:            fmtNum(deal.stampDutyAmount),
      // Listing / Property
      listingTitle:         deal.listing?.title          || "",
      listingNumber:        deal.listing?.listingNumber  || "",
      propertyType:         deal.listing?.propertyType   || "",
      propertyLocation:     deal.listing?.location       || "",
      propertyTown:         deal.listing?.town           || "",
      propertyCounty:       deal.listing?.county         || "",
      propertySize:         deal.listing?.size != null ? `${deal.listing.size} ${deal.listing.sizeUnit || ""}`.trim() : "",
      askingPrice:          fmtNum(deal.listing?.askingPrice),
      // Agent
      agentName:            deal.agent?.fullName         || "",
      // Company
      companyName:          company?.companyName || company?.name || "",
      companyPhone:         company?.phoneNo     || "",
      companyEmail:         company?.email       || "",
    };
    await sendAdHocEmail({ businessId: business, to, subject: fillPlaceholders(subject, vars), bodyText: fillPlaceholders(body, vars) });
    res.json({ success: true, message: "Email sent" });
  } catch (err) {
    next(err);
  }
};

// ── Convert accepted/pending offer directly into a deal ─────────────────────
export const createDealFromOffer = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    // The duplicate-deal lookup is independent of the offer fetch — run both together; the checks
    // below still evaluate in the original order so error precedence is unchanged.
    const [offer, existingDeal] = await Promise.all([
      SaleOffer.findOne({ _id: req.params.offerId, business, ...agentFilter(req) }).populate("listing buyer agent").lean(),
      SaleDeal.findOne({ business, offer: req.params.offerId }).select("_id").lean(),
    ]);
    if (!offer) return next(createError(404, "Offer not found"));
    if (TERMINAL_OFFER_STATUSES.includes(offer.status)) {
      return next(createError(400, `Cannot convert a ${offer.status} offer to a deal`));
    }
    if (!offer.listing || !offer.buyer) return next(createError(400, "Offer has a missing listing or buyer"));
    // offer.listing is already a full lean listing doc from the populate above — reuse it, keeping the
    // tenant check the old re-fetch enforced (persistNewDeal's atomic claim remains the concurrency gate).
    const listing = String(offer.listing.business) === String(business) ? offer.listing : null;
    if (!listing) return next(createError(400, "Listing not found"));
    if (listing.status === "sold")           return next(createError(400, "Listing is already sold"));
    if (listing.status === "under_contract") return next(createError(400, "Listing already has an active deal"));

    if (existingDeal) return next(createError(400, "A deal already exists for this offer"));

    const agreedPrice = Number(req.body.agreedPrice ?? offer.counterOfferAmount ?? offer.offerAmount);
    const { commissionRateOverride, commissionTypeOverride, commissionAmountOverride, whtRate, ...rest } = req.body;

    const dealNumber = await generateSequentialNumber(SaleDeal, business, "DL");
    const dealDoc = new SaleDeal({
      business, dealNumber,
      offer:    offer._id,
      listing:  offer.listing._id,
      buyer:    offer.buyer._id,
      agent:    offer.agent?._id ?? null,
      agreedPrice,
      dealDate:            rest.dealDate            || new Date(),
      expectedClosingDate: rest.expectedClosingDate || null,
      notes:               rest.notes               || offer.notes || "",
      createdBy: userId,
      updatedBy: userId,
    });

    await persistNewDeal({
      business, userId, dealDoc, listing,
      agent: offer.agent || null,
      offer: { _id: offer._id, status: offer.status },
      commissionArgs: {
        listingId: offer.listing._id, buyerId: offer.buyer._id,
        agreedPrice,
        overrides: { commissionRateOverride, commissionTypeOverride, commissionAmountOverride, whtRate },
      },
    });

    const populated = await populateDeal(SaleDeal.findById(dealDoc._id)).lean();
    res.status(201).json({ ...populated, totalPaid: 0, balance: populated.agreedPrice });
  } catch (err) {
    next(err);
  }
};

// ── Deal documents ───────────────────────────────────────────────────────────
export const uploadDealDocument = async (req, res, next) => {
  // multer has already written the file to disk — remove it on every failure path
  const discardUpload = () => { if (req.file?.filename) deleteDocumentFile(req.file.filename); };
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) });
    if (!deal) { discardUpload(); return next(createError(404, "Deal not found")); }
    if (!req.file)  return next(createError(400, "No file uploaded"));

    deal.documents.push({
      label:        String(req.body.label || "").trim() || req.file.originalname,
      originalName: req.file.originalname,
      filename:     req.file.filename,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      uploadedAt:   new Date(),
      uploadedBy:   userId,
    });
    await deal.save();
    res.status(201).json(deal.documents[deal.documents.length - 1]);
  } catch (err) {
    discardUpload();
    next(err);
  }
};

export const deleteDealDocument = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const deal = await SaleDeal.findOne({ _id: req.params.id, business, ...agentFilter(req) });
    if (!deal) return next(createError(404, "Deal not found"));
    const doc = deal.documents.id(req.params.docId);
    if (!doc) return next(createError(404, "Document not found"));
    const filename = doc.filename;
    doc.deleteOne();
    await deal.save();
    deleteDocumentFile(filename);
    res.json({ message: "Document deleted" });
  } catch (err) {
    next(err);
  }
};
