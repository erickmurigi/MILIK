import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SalePayment from "../models/SalePayment.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleListing from "../models/SaleListing.js";
import SaleProject from "../models/SaleProject.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { agentFilter, ownDealIds } from "../middleware/agentScope.js";
import { ownAdvocateDealIds, advocateProjectFilter } from "../middleware/advocateScope.js";
import {
  postPropertySalePaymentLedger,
  reversePropertySalePaymentLedger,
} from "../services/propertySaleAccountingService.js";
import { sumPaidForDeal, percentPaid } from "../services/dealProgress.js";
import { applyTierCrossings } from "../services/commissionReleaseService.js";

// Agent-scoped or advocate-scoped users only see payments on their own deals (query fragment; empty for
// everyone else). The two scopes are mutually exclusive in practice (a user is linked to at most one of
// SaleAgent/SaleAdvocate), so whichever lookup returns a restriction (non-null) wins.
const dealScope = async (req, business) => {
  const agentIds = await ownDealIds(req, business);
  if (agentIds) return { deal: { $in: agentIds } };
  const advocateIds = await ownAdvocateDealIds(req, business);
  if (advocateIds) return { deal: { $in: advocateIds } };
  return {};
};

// Advocate id for a deal's listing's project (null for standalone listings or projects with no advocate).
// Mirrors dealsController.js's resolveListingOwner for the owner-commission feature, but starts from the
// listing id (the deal object loaded here isn't populated) rather than a full listing document.
const resolveListingAdvocate = async (business, listingId) => {
  if (!listingId) return null;
  const listing = await SaleListing.findOne({ business, _id: listingId }).select("project").lean();
  if (!listing?.project) return null;
  const project = await SaleProject.findOne({ business, _id: listing.project }).select("assignedAdvocate").lean();
  return project?.assignedAdvocate || null;
};

// An advocate must belong to this business and be active
const resolveAdvocate = async (businessId, advocateId) => {
  if (!advocateId || !mongoose.isValidObjectId(String(advocateId))) return null;
  return SaleAdvocate.findOne({ _id: advocateId, business: businessId, status: "active" }).select("_id").lean();
};

// Deep-populate: deal includes nested listing + buyer so receipt/table fields work
const populatePayment = (query) =>
  query.populate({
    path: "deal",
    select: "dealNumber agreedPrice status",
    populate: [
      { path: "listing", select: "title listingNumber propertyType" },
      { path: "buyer",   select: "fullName buyerNumber phone email" },
    ],
  });

const sanitizePaymentBody = (body) => {
  const out = { ...body };
  if ("amount" in out)      out.amount      = out.amount      !== "" && out.amount      != null ? Number(out.amount)      : 0;
  if ("paymentDate" in out) out.paymentDate = out.paymentDate || null;
  // Normalize so an empty/omitted value lands on the documented default rather than tripping enum validation
  if ("collectionMethod" in out) out.collectionMethod = out.collectionMethod === "advocate_trust" ? "advocate_trust" : "direct";
  return out;
};

// Resolve a cashbook ChartOfAccount from an _id sent by the frontend
const resolveCashbook = async (businessId, cashbookId) => {
  if (!cashbookId || !mongoose.isValidObjectId(String(cashbookId))) return null;
  return ChartOfAccount.findOne({
    _id: cashbookId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader:  { $ne: true },
  }).lean();
};

const OVERPAY_TOLERANCE = 0.01;
const LOCKED_DEAL_STATUSES = ["closed", "cancelled"];

const overpaymentError = (amount, remaining) =>
  createError(400, `Payment of ${Number(amount).toLocaleString()} exceeds remaining balance of ${remaining.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`);

// Payments on a closed/cancelled deal cannot be voided or edited: closing/cancelling posts separate
// deposit-transfer / forfeit GL entries that payment-level reversal does not touch.
const lockedDealError = (dealStatus, action) =>
  LOCKED_DEAL_STATUSES.includes(dealStatus)
    ? createError(409, `Cannot ${action} a payment on a ${dealStatus} deal. Reverse or reopen the deal through the deal workflow first.`)
    : null;

export const listPayments = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const bId = new mongoose.Types.ObjectId(String(business));
    const { deal = "", buyer = "", paymentType = "", paymentMethod = "", status = "", search = "", dateFrom = "", dateTo = "" } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const filter = { business };
    if (deal)          filter.deal          = new mongoose.Types.ObjectId(String(deal));
    if (buyer)         filter.buyer         = new mongoose.Types.ObjectId(String(buyer));
    if (paymentType)   filter.paymentType   = paymentType;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (status)        filter.status        = status;
    if (search)        filter.paymentNumber = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (dateFrom || dateTo) {
      filter.paymentDate = {};
      if (dateFrom) filter.paymentDate.$gte = new Date(dateFrom);
      if (dateTo)   filter.paymentDate.$lte = new Date(dateTo + "T23:59:59.999Z");
    }

    const ownDeals = await ownDealIds(req, business);
    if (ownDeals) filter.$and = [{ deal: { $in: ownDeals } }];

    const collectedMatch = { business: bId, status: "paid" };
    if (ownDeals) collectedMatch.$and = [{ deal: { $in: ownDeals } }];
    if (deal) collectedMatch.deal = new mongoose.Types.ObjectId(String(deal));

    const [payments, total, [agg]] = await Promise.all([
      populatePayment(SalePayment.find(filter).sort({ paymentDate: -1 }).skip(skip).limit(limit)).lean(),
      SalePayment.countDocuments(filter),
      SalePayment.aggregate([
        { $match: collectedMatch },
        { $group: { _id: null, totalCollected: { $sum: "$amount" } } },
      ]),
    ]);

    res.status(200).json({ data: payments, total, totalCollected: agg?.totalCollected || 0, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
};

export const getPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment = await populatePayment(SalePayment.findOne({ _id: req.params.id, business, ...(await dealScope(req, business)) })).lean();
    if (!payment) return next(createError(404, "Payment not found"));
    res.status(200).json(payment);
  } catch (err) {
    next(err);
  }
};

export const createPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    // Advocate-scoped users can only record payments against deals under their own assigned project(s)
    const advocateScopeFilter = req.saleAdvocateId ? await advocateProjectFilter(req, business, "listing") : {};
    const deal = await SaleDeal.findOne({ _id: req.body.deal, business, ...agentFilter(req), ...advocateScopeFilter }).lean();
    if (!deal) return next(createError(400, "Deal not found"));
    if (deal.status !== "active") return next(createError(400, "Payments can only be recorded for active deals"));

    // Resolve cashbook in parallel with the deal's paid-to-date total — independent lookups.
    // cashbook is still validated/stored even for an advocate_trust payment (kept for consistency with the
    // existing field and in case the record is later corrected to "direct") — the accounting service simply
    // ignores it for the debit side while collectionMethod stays "advocate_trust".
    const [totalPaid, cashbookAcc] = await Promise.all([
      sumPaidForDeal(business, deal._id),
      resolveCashbook(business, req.body.cashbook),
    ]);
    const remaining  = round2(deal.agreedPrice - totalPaid);
    if (Number(req.body.amount) > remaining + OVERPAY_TOLERANCE) {
      return next(overpaymentError(req.body.amount, remaining));
    }

    if (req.body.cashbook && !cashbookAcc) {
      return next(createError(400, "Selected cashbook account not found"));
    }

    // Advocate: explicit body value (validated) > the scoped advocate's own id > auto-filled from the
    // deal's listing's project.assignedAdvocate (mirrors dealsController.js's resolveListingOwner pattern).
    let advocateId = null;
    if (req.body.advocate) {
      const advocateAcc = await resolveAdvocate(business, req.body.advocate);
      if (!advocateAcc) return next(createError(400, "Selected advocate not found or inactive"));
      advocateId = advocateAcc._id;
    } else if (req.saleAdvocateId) {
      advocateId = req.saleAdvocateId;
    } else {
      advocateId = await resolveListingAdvocate(business, deal.listing);
    }

    const paymentNumber = await generateSequentialNumber(SalePayment, business, "PMT");
    const payment = await SalePayment.create({
      ...sanitizePaymentBody(req.body),
      business,
      paymentNumber,
      cashbook: cashbookAcc?._id || null,
      advocate: advocateId || null,
      listing:  deal.listing,
      buyer:    deal.buyer,
      status:   "paid",
      createdBy: userId,
      updatedBy: userId,
    });

    // The check above is read-then-write, so two concurrent submits can both pass it. Re-check after the
    // insert (before any GL posting): if the deal is now overpaid, remove this payment and reject.
    // Worst case under a true race is that both requests are rejected; never that both are kept.
    const totalAfter = await sumPaidForDeal(business, deal._id);
    if (round2(totalAfter) > round2(deal.agreedPrice) + OVERPAY_TOLERANCE) {
      await SalePayment.deleteOne({ _id: payment._id });
      return next(overpaymentError(payment.amount, round2(deal.agreedPrice - (totalAfter - payment.amount))));
    }

    try {
      await postPropertySalePaymentLedger({
        businessId: business,
        payment,
        userId,
        cashbookAccountId: cashbookAcc?._id || null,
      });
    } catch (glErr) {
      // GL failed — delete the payment so DB and ledger stay in sync
      await SalePayment.deleteOne({ _id: payment._id });
      return next(createError(422, `Payment saved but GL posting failed: ${glErr.message}. Payment has been rolled back.`));
    }

    try {
      await applyTierCrossings({
        businessId: business, dealId: deal._id, userId,
        previousPctPaid: percentPaid(totalPaid, deal.agreedPrice),
        newPctPaid: percentPaid(totalAfter, deal.agreedPrice),
      });
    } catch (tierErr) {
      // Never leave a payment recorded with an un-posted tier — unwind the payment and its GL together.
      await reversePropertySalePaymentLedger({ businessId: business, payment, userId }).catch(() => {});
      await SalePayment.deleteOne({ _id: payment._id });
      return next(createError(422, `Payment saved but commission tier posting failed: ${tierErr.message}. Payment has been rolled back.`));
    }

    const populated = await populatePayment(SalePayment.findById(payment._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const updatePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const old = await SalePayment.findOne({ _id: req.params.id, business, ...(await dealScope(req, business)) }).lean();
    if (!old) return next(createError(404, "Payment not found"));
    if (old.status === "cancelled") return next(createError(400, "Cannot edit a voided payment"));

    const dealForUpdate = await SaleDeal.findOne({ _id: old.deal, business }).select("status agreedPrice").lean();

    const {
      business: _b, paymentNumber: _n, createdBy: _c,
      deal: _d, listing: _l, buyer: _by, status: _s,
      ...rawUpdates
    } = req.body;
    const updates = sanitizePaymentBody(rawUpdates);

    // Resolve new cashbook if changed
    const newCashbookId = updates.cashbook !== undefined ? updates.cashbook : String(old.cashbook || "");
    const cashbookAcc   = await resolveCashbook(business, newCashbookId);
    if (newCashbookId && !cashbookAcc) return next(createError(400, "Selected cashbook account not found"));
    updates.cashbook = cashbookAcc?._id || null;

    // Resolve new advocate if changed (same validation as createPayment)
    const newAdvocateId = updates.advocate !== undefined ? updates.advocate : String(old.advocate || "");
    const advocateAcc   = newAdvocateId ? await resolveAdvocate(business, newAdvocateId) : null;
    if (newAdvocateId && !advocateAcc) return next(createError(400, "Selected advocate not found or inactive"));
    updates.advocate = advocateAcc?._id || null;

    const amountChanged = updates.amount    !== undefined && Number(updates.amount)   !== Number(old.amount);
    const dateChanged   = updates.paymentDate !== undefined && new Date(updates.paymentDate).toDateString() !== new Date(old.paymentDate).toDateString();
    const cashbookChanged = String(updates.cashbook || "") !== String(old.cashbook || "");
    // The debit side depends on collectionMethod (1314 vs cashbook/1311), so a method change needs the
    // same reverse-and-repost as an amount/date/cashbook change even if nothing else moved.
    const collectionMethodChanged = updates.collectionMethod !== undefined && updates.collectionMethod !== (old.collectionMethod || "direct");
    const glCorrectionNeeded = amountChanged || dateChanged || cashbookChanged || collectionMethodChanged;

    // Only edits that rewrite GL (amount/date/cashbook) are unsafe on a closed/cancelled deal;
    // descriptive fields (reference, notes) stay editable.
    const updateLockErr = glCorrectionNeeded && dealForUpdate && lockedDealError(dealForUpdate.status, "edit");
    if (updateLockErr) return next(updateLockErr);

    // Amount edits must keep the deal's total paid within the agreed price (same rule as createPayment)
    let previousPctPaid = null, newPctPaid = null;
    if (amountChanged && dealForUpdate && old.status === "paid") {
      const otherPaid = await sumPaidForDeal(business, old.deal, old._id);
      const remaining = round2(dealForUpdate.agreedPrice - otherPaid);
      if (Number(updates.amount) > remaining + OVERPAY_TOLERANCE) {
        return next(overpaymentError(updates.amount, remaining));
      }
      // Tiers key off cumulative %paid — an amount edit can cross a threshold forward or backward.
      previousPctPaid = percentPaid(otherPaid + Number(old.amount), dealForUpdate.agreedPrice);
      newPctPaid       = percentPaid(otherPaid + Number(updates.amount), dealForUpdate.agreedPrice);
    }

    if (glCorrectionNeeded) {
      // Reverse old GL entries first
      try {
        await reversePropertySalePaymentLedger({ businessId: business, payment: old, userId });
      } catch (glErr) {
        return next(createError(422, `GL reversal failed: ${glErr.message}. Payment not updated.`));
      }
    }

    const payment = await populatePayment(
      SalePayment.findOneAndUpdate(
        { _id: req.params.id, business, ...(await dealScope(req, business)) },
        { ...updates, updatedBy: userId },
        { new: true, runValidators: true }
      )
    ).lean();
    if (!payment) return next(createError(404, "Payment not found"));

    if (glCorrectionNeeded) {
      try {
        await postPropertySalePaymentLedger({
          businessId: business,
          payment,
          userId,
          cashbookAccountId: cashbookAcc?._id || null,
        });
      } catch (glErr) {
        // Re-post of new GL failed — restore old GL so ledger isn't left empty
        await postPropertySalePaymentLedger({
          businessId: business,
          payment: old,
          userId,
          cashbookAccountId: old.cashbook || null,
        }).catch(() => {});
        return next(createError(422, `GL re-posting failed: ${glErr.message}. Old GL has been restored.`));
      }
    }

    if (previousPctPaid != null && newPctPaid > previousPctPaid) {
      try {
        await applyTierCrossings({ businessId: business, dealId: old.deal, userId, previousPctPaid, newPctPaid });
      } catch (tierErr) {
        return next(createError(422, `Payment updated but commission tier posting failed: ${tierErr.message}. Review commission tiers manually for this deal.`));
      }
    }

    res.status(200).json(payment);
  } catch (err) {
    next(err);
  }
};

export const voidPayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId   = currentUserId(req);

    const payment = await SalePayment.findOne({ _id: req.params.id, business, ...(await dealScope(req, business)) });
    if (!payment) return next(createError(404, "Payment not found"));
    if (payment.status === "cancelled") return next(createError(400, "Payment is already cancelled/voided"));

    // Closing/cancelling a deal posts separate deposit-transfer/forfeit entries that this void would not reverse
    const voidDeal = await SaleDeal.findOne({ _id: payment.deal, business }).select("status").lean();
    const voidLockErr = voidDeal && lockedDealError(voidDeal.status, "void");
    if (voidLockErr) return next(voidLockErr);

    // Voiding an advocate_trust payment represents a REAL refund the advocate must have actually made
    // to the buyer — not a data-entry correction, which is all a "direct" void ever means. Require the
    // caller to confirm that and provide a reference before anything is touched. "direct" payments are
    // completely unaffected (no change from today's behavior).
    if (payment.collectionMethod === "advocate_trust") {
      const refundReference = String(req.body.refundReference || "").trim();
      if (req.body.refundConfirmed !== true || !refundReference) {
        return next(createError(400, "Voiding an advocate-trust payment represents a real refund — confirm the advocate has refunded the buyer and provide a reference"));
      }
      payment.refundReference = refundReference;
    }

    payment.status    = "cancelled";
    payment.updatedBy = userId;
    await payment.save();

    try {
      await reversePropertySalePaymentLedger({ businessId: business, payment, userId });
    } catch (glErr) {
      // GL reversal failed — restore payment status so records are consistent
      payment.status = "paid";
      await payment.save();
      return next(createError(422, `GL reversal failed: ${glErr.message}. Payment void has been rolled back.`));
    }

    // No tier-crossing check here, deliberately: voiding a payment only ever decreases %paid, and tier
    // release is a one-way ratchet (applyTierCrossings no-ops whenever newPctPaid <= previousPctPaid) —
    // only an explicit deal cancellation claws back an already-released tier.

    const populated = await populatePayment(SalePayment.findById(payment._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payment  = await SalePayment.findOne({ _id: req.params.id, business, ...(await dealScope(req, business)) });
    if (!payment) return next(createError(404, "Payment not found"));
    if (payment.status === "paid") return next(createError(400, "Cannot delete a confirmed payment — void it first to reverse it"));
    await payment.deleteOne();
    res.status(200).json({ message: "Payment deleted" });
  } catch (err) {
    next(err);
  }
};
