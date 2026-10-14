import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleAdvocateRemittance from "../models/SaleAdvocateRemittance.js";
import SalePayment from "../models/SalePayment.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleListing from "../models/SaleListing.js";
import SaleProject from "../models/SaleProject.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { postSaleAdvocateRemittance } from "../services/propertySaleAccountingService.js";
import { dealAdvocateTrustBalance } from "../services/dealProgress.js";
import { outstandingRecoverableExpenseVouchers } from "../services/recoverableExpense.js";

// Owner id for a deal, resolved via its listing -> project -> owner (mirrors dealsController.js's
// resolveListingOwner). null for a standalone listing or a project with no owner.
const resolveDealOwner = async (business, listingId) => {
  if (!listingId) return null;
  const listing = await SaleListing.findOne({ business, _id: listingId }).select("project").lean();
  if (!listing?.project) return null;
  const project = await SaleProject.findOne({ business, _id: listing.project }).select("owner").lean();
  return project?.owner || null;
};

const resolveCashbook = async (businessId, cashbookId) => {
  if (!cashbookId || !mongoose.isValidObjectId(String(cashbookId))) return null;
  return ChartOfAccount.findOne({
    _id: cashbookId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader:  { $ne: true },
  }).lean();
};

const populateRemittance = (query) =>
  query.populate("advocate", "fullName advocateNumber firm phone").populate("cashbook", "name code");

// Outstanding advocate_trust balance: money the advocate has collected into their own trust account but
// not yet handed over = sum(advocate_trust payments, paid) - sum(remittances recorded).
export const advocateTrustBalance = async (business, advocateId) => {
  const bId = new mongoose.Types.ObjectId(String(business));
  const aId = new mongoose.Types.ObjectId(String(advocateId));
  const [[collected], [remitted]] = await Promise.all([
    SalePayment.aggregate([
      { $match: { business: bId, advocate: aId, collectionMethod: "advocate_trust", status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    SaleAdvocateRemittance.aggregate([
      { $match: { business: bId, advocate: aId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);
  const collectedTotal = round2(collected?.total || 0);
  const remittedTotal  = round2(remitted?.total || 0);
  return { collected: collectedTotal, remitted: remittedTotal, outstanding: round2(collectedTotal - remittedTotal) };
};

export const getAdvocateTrustBalance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    if (req.saleAdvocateId && req.saleAdvocateId !== String(req.params.advocateId)) {
      return next(createError(404, "Advocate not found"));
    }
    const advocate = await SaleAdvocate.findOne({ _id: req.params.advocateId, business }).select("_id").lean();
    if (!advocate) return next(createError(404, "Advocate not found"));
    const balance = await advocateTrustBalance(business, advocate._id);
    res.status(200).json(balance);
  } catch (err) {
    next(err);
  }
};

export const listRemittances = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { advocate = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    // Scoped advocate caller: always their own remittances, regardless of what ?advocate= was
    // passed — never let a query param override the scope.
    if (req.saleAdvocateId) filter.advocate = req.saleAdvocateId;
    else if (advocate && mongoose.isValidObjectId(String(advocate))) filter.advocate = advocate;

    const [data, total] = await Promise.all([
      populateRemittance(SaleAdvocateRemittance.find(filter).sort({ date: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum)).lean(),
      SaleAdvocateRemittance.countDocuments(filter),
    ]);
    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) {
    next(err);
  }
};

export const getRemittance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { _id: req.params.id, business };
    if (req.saleAdvocateId) filter.advocate = req.saleAdvocateId;
    const remittance = await populateRemittance(SaleAdvocateRemittance.findOne(filter)).lean();
    if (!remittance) return next(createError(404, "Remittance not found"));
    res.status(200).json(remittance);
  } catch (err) {
    next(err);
  }
};

export const createRemittance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const advocate = await SaleAdvocate.findOne({ _id: req.body.advocate, business }).select("_id").lean();
    if (!advocate) return next(createError(400, "Advocate not found"));

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Amount must be a number greater than 0"));

    const cashbookAcc = await resolveCashbook(business, req.body.cashbook);
    if (req.body.cashbook && !cashbookAcc) return next(createError(400, "Selected cashbook account not found"));

    // Deal-scoped remittance (optional — null/omitted preserves the flat, ad-hoc, advocate-level
    // remittance this endpoint has always supported, with no appliedTo split at all).
    let dealDoc = null;
    let appliedTo = [];
    if (req.body.deal) {
      if (!mongoose.isValidObjectId(String(req.body.deal))) return next(createError(400, "Invalid deal"));
      dealDoc = await SaleDeal.findOne({ _id: req.body.deal, business }).select("_id listing").lean();
      if (!dealDoc) return next(createError(400, "Deal not found"));

      const trust = await dealAdvocateTrustBalance(business, dealDoc._id);
      if (amount > trust.available + 0.01) {
        return next(createError(400, `This deal's advocate trust balance is only KES ${trust.available.toLocaleString()} — cannot remit KES ${amount.toLocaleString()}.`));
      }

      // Apply the incoming cash against the owner's outstanding recoverable expenses first
      // (oldest-due-first across however many vouchers it takes), then whatever's left over is
      // treated as plain commission-cash — exactly the split postSaleAdvocateRemittance's
      // postRecoverableExpenseSettlement step expects in appliedTo.
      const ownerId = await resolveDealOwner(business, dealDoc.listing);
      let remaining = round2(amount);
      if (ownerId) {
        const outstandingVouchers = await outstandingRecoverableExpenseVouchers(business, ownerId);
        for (const v of outstandingVouchers) {
          if (remaining <= 0) break;
          const take = round2(Math.min(v.outstanding, remaining));
          if (take <= 0) continue;
          appliedTo.push({ category: "recoverable_expense", refId: v.voucherId, amount: take });
          remaining = round2(remaining - take);
        }
      }
      if (remaining > 0) appliedTo.push({ category: "owner_commission_cash", refId: null, amount: remaining });
    }

    const remittanceNumber = await generateSequentialNumber(SaleAdvocateRemittance, business, "ADR");
    const remittance = await SaleAdvocateRemittance.create({
      business,
      remittanceNumber,
      advocate: advocate._id,
      deal: dealDoc?._id || null,
      amount,
      date: req.body.date || new Date(),
      cashbook: cashbookAcc?._id || null,
      appliedTo,
      reference: req.body.reference || "",
      notes: req.body.notes || "",
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      await postSaleAdvocateRemittance({
        businessId: business,
        remittance,
        userId,
        cashbookAccountId: cashbookAcc?._id || null,
        appliedTo,
      });
    } catch (glErr) {
      // GL failed — delete the remittance so DB and ledger stay in sync (same rollback pattern as
      // paymentsController.js's createPayment)
      await SaleAdvocateRemittance.deleteOne({ _id: remittance._id });
      return next(createError(422, `Remittance saved but GL posting failed: ${glErr.message}. Remittance has been rolled back.`));
    }

    const populated = await populateRemittance(SaleAdvocateRemittance.findById(remittance._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};
