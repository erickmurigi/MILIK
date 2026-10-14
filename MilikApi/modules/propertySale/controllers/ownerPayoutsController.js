import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleOwnerPayout from "../models/SaleOwnerPayout.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { postSaleOwnerPayout } from "../services/propertySaleAccountingService.js";
import { dealAdvocateTrustBalance } from "../services/dealProgress.js";
import { generateOwnerStatementData } from "../services/ownerStatementService.js";

const resolveCashbook = async (businessId, cashbookId) => {
  if (!cashbookId || !mongoose.isValidObjectId(String(cashbookId))) return null;
  return ChartOfAccount.findOne({
    _id: cashbookId,
    business: businessId,
    isPosting: { $ne: false },
    isHeader:  { $ne: true },
  }).lean();
};

const populatePayout = (query) =>
  query
    .populate("owner", "fullName ownerNumber phone email")
    .populate("deal", "dealNumber agreedPrice")
    .populate("advocate", "fullName advocateNumber firm")
    .populate("cashbook", "name code");

// An owner's current outstanding net balance across every project/deal, all-time — reuses the exact
// proceeds/commission/expense/payout aggregation ownerStatementService.generateOwnerStatementData
// already builds for statements, with a wide-open period so "outstanding right now" simply falls out
// of its own payout-aware netBalance (it already subtracts prior SaleOwnerPayout totals).
const resolveOwnerOutstandingBalance = async (business, ownerId) => {
  const { totals } = await generateOwnerStatementData({
    businessId: business, ownerId, projectId: null,
    periodStart: new Date(0), periodEnd: new Date(),
  });
  return totals.netBalance;
};

export const listOwnerPayouts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { owner = "", deal = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (owner && mongoose.isValidObjectId(String(owner))) filter.owner = owner;
    if (deal && mongoose.isValidObjectId(String(deal))) filter.deal = deal;

    const [data, total] = await Promise.all([
      populatePayout(SaleOwnerPayout.find(filter).sort({ date: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum)).lean(),
      SaleOwnerPayout.countDocuments(filter),
    ]);
    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) {
    next(err);
  }
};

export const getOwnerPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const payout = await populatePayout(SaleOwnerPayout.findOne({ _id: req.params.id, business })).lean();
    if (!payout) return next(createError(404, "Owner payout not found"));
    res.status(200).json(payout);
  } catch (err) {
    next(err);
  }
};

export const createOwnerPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    const owner = await SaleOwner.findOne({ _id: req.body.owner, business }).select("_id").lean();
    if (!owner) return next(createError(400, "Owner not found"));

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return next(createError(400, "Amount must be a number greater than 0"));

    // CGT is always the owner's own personal obligation to KRA, never a liability on this company's
    // books — withheld here purely for record-keeping (computed externally, e.g. via KRA iTax) and to
    // correctly shrink both what's left of the owner's entitlement and what's left of the deal's trust
    // balance, since it leaves the trust/cashbook just as surely as the cash the owner receives does.
    const cgtAmount = req.body.cgtAmount !== undefined ? Number(req.body.cgtAmount) : 0;
    if (!Number.isFinite(cgtAmount) || cgtAmount < 0) return next(createError(400, "CGT amount must be a number of 0 or more"));
    const totalClaim = round2(amount + cgtAmount);

    const source = req.body.source === "advocate_trust" ? "advocate_trust" : "company_cashbook";

    let dealDoc = null;
    let advocateAcc = null;
    let cashbookAcc = null;

    if (source === "advocate_trust") {
      // Trust funds are only ever tracked per-deal (dealAdvocateTrustBalance) — a deal is mandatory here.
      if (!req.body.deal || !mongoose.isValidObjectId(String(req.body.deal))) {
        return next(createError(400, "A deal is required for an advocate_trust owner payout"));
      }
      dealDoc = await SaleDeal.findOne({ _id: req.body.deal, business }).select("_id").lean();
      if (!dealDoc) return next(createError(400, "Deal not found"));

      const trust = await dealAdvocateTrustBalance(business, dealDoc._id);
      if (totalClaim > trust.available + 0.01) {
        return next(createError(400, `This deal's advocate trust balance is only KES ${trust.available.toLocaleString()} — cannot pay out KES ${totalClaim.toLocaleString()}${cgtAmount > 0 ? " (incl. CGT)" : ""}.`));
      }

      if (req.body.advocate) {
        advocateAcc = await SaleAdvocate.findOne({ _id: req.body.advocate, business }).select("_id").lean();
        if (!advocateAcc) return next(createError(400, "Advocate not found"));
      }
    } else {
      if (req.body.deal && mongoose.isValidObjectId(String(req.body.deal))) {
        dealDoc = await SaleDeal.findOne({ _id: req.body.deal, business }).select("_id").lean();
      }
      cashbookAcc = await resolveCashbook(business, req.body.cashbook);
      if (req.body.cashbook && !cashbookAcc) return next(createError(400, "Selected cashbook account not found"));
    }

    const outstanding = round2(await resolveOwnerOutstandingBalance(business, owner._id));
    if (totalClaim > outstanding + 0.01) {
      return next(createError(400, `Owner's outstanding balance is only KES ${outstanding.toLocaleString()} — cannot pay out KES ${totalClaim.toLocaleString()}${cgtAmount > 0 ? " (incl. CGT)" : ""}.`));
    }

    const payoutNumber = await generateSequentialNumber(SaleOwnerPayout, business, "OPY");
    const payout = await SaleOwnerPayout.create({
      business,
      payoutNumber,
      owner: owner._id,
      deal: dealDoc?._id || null,
      amount,
      cgtAmount,
      cgtReference: req.body.cgtReference || "",
      date: req.body.date || new Date(),
      source,
      advocate: advocateAcc?._id || null,
      cashbook: cashbookAcc?._id || null,
      reference: req.body.reference || "",
      notes: req.body.notes || "",
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      await postSaleOwnerPayout({
        businessId: business,
        payout,
        userId,
        cashbookAccountId: cashbookAcc?._id || null,
      });
    } catch (glErr) {
      // GL failed — delete the payout so DB and ledger stay in sync (same rollback pattern used
      // throughout this module, e.g. advocateRemittancesController.js's createRemittance)
      await SaleOwnerPayout.deleteOne({ _id: payout._id });
      return next(createError(422, `Owner payout saved but GL posting failed: ${glErr.message}. Payout has been rolled back.`));
    }

    const populated = await populatePayout(SaleOwnerPayout.findById(payout._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};
