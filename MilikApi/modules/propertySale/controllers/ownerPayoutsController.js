import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleOwnerPayout from "../models/SaleOwnerPayout.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleProject from "../models/SaleProject.js";
import SaleListing from "../models/SaleListing.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { postSaleOwnerPayout, reverseSaleOwnerPayout } from "../services/propertySaleAccountingService.js";
import { dealAdvocateTrustBalance } from "../services/dealProgress.js";
import { generateOwnerStatementData } from "../services/ownerStatementService.js";
import { claimPaymentReference, releasePaymentReference } from "../../../services/paymentReferenceGuard.js";
import { ownAdvocateDealIds, ownAdvocateOwnerIds } from "../middleware/advocateScope.js";

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
    .populate("allocations.deal", "dealNumber agreedPrice")
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

// Live "what's owed right now" figure — not tied to any one statement (a payout isn't modeled as
// belonging to a specific statement, only to the owner), so this is the honest answer to "has this
// owner been paid" rather than trying to retroactively mark a frozen, already-approved statement paid.
export const getOwnerOutstandingBalance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const owner = await SaleOwner.findOne({ _id: req.params.ownerId, business }).select("_id").lean();
    if (!owner) return next(createError(404, "Owner not found"));
    // Was previously unscoped — any advocate-linked login (which already holds sale-owners:view) could
    // query ANY owner's balance by guessing an id, not just owners they're actually linked to.
    if (req.saleAdvocateId) {
      const ownerIds = (await ownAdvocateOwnerIds(req, business)).map(String);
      if (!ownerIds.includes(String(owner._id))) return next(createError(404, "Owner not found"));
    }
    const outstanding = round2(await resolveOwnerOutstandingBalance(business, owner._id));
    res.status(200).json({ outstanding });
  } catch (err) {
    next(err);
  }
};

// Every deal of this owner that the advocate holds trust money against, each with its own available
// balance — the breakdown an advocate needs before choosing which deal(s) to combine into one direct
// payout to the owner. Deliberately scoped by ownAdvocateDealIds (deals this advocate actually holds
// trust for), NOT the owner-centric visibility recoverable expenses use — trust is a fiduciary (LSK)
// custody concern, not a shared-visibility one, so it stays strictly "whose money is this."
export const getAdvocateOwnerTrustSummary = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const owner = await SaleOwner.findOne({ _id: req.params.ownerId, business }).select("_id").lean();
    if (!owner) return next(createError(404, "Owner not found"));
    if (req.saleAdvocateId) {
      const ownerIds = (await ownAdvocateOwnerIds(req, business)).map(String);
      if (!ownerIds.includes(String(owner._id))) return next(createError(404, "Owner not found"));
    }

    const projects = await SaleProject.find({ business, owner: owner._id }).select("_id").lean();
    const projectIds = projects.map((p) => p._id);
    const listings = projectIds.length
      ? await SaleListing.find({ business, project: { $in: projectIds } }).select("_id title unitNumber").lean()
      : [];
    const listingIds = listings.map((l) => l._id);
    const listingById = new Map(listings.map((l) => [String(l._id), l]));

    const dealScope = req.saleAdvocateId ? { _id: { $in: await ownAdvocateDealIds(req, business) } } : {};
    const deals = listingIds.length
      ? await SaleDeal.find({ business, listing: { $in: listingIds }, ...dealScope }).select("_id dealNumber listing").lean()
      : [];

    const balances = await Promise.all(deals.map((d) => dealAdvocateTrustBalance(business, d._id)));
    const data = deals
      .map((d, i) => {
        const listing = listingById.get(String(d.listing));
        return {
          dealId: d._id, dealNumber: d.dealNumber,
          listingLabel: listing?.title || (listing?.unitNumber ? `Unit ${listing.unitNumber}` : d.dealNumber),
          available: balances[i].available,
        };
      })
      .filter((d) => d.available > 0.01);
    const totalAvailable = round2(data.reduce((s, d) => s + d.available, 0));

    res.status(200).json({ data, totalAvailable });
  } catch (err) {
    next(err);
  }
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
    // advocate-scoped user (mandatory, ungated): a payout isn't attributable to any one advocate
    // unless it touches one of their own deals — via the single `deal` field (legacy/single-deal
    // payout) OR `allocations.deal` (a combined multi-deal payout they created). Payouts with neither
    // (pure cashbook draws against the owner's overall balance) stay out of scope entirely,
    // deny-by-default. An explicit ?deal= still narrows correctly, but only within their own scope.
    if (req.saleAdvocateId) {
      const dealIds = (await ownAdvocateDealIds(req, business)).map(String);
      const requestedDealId = filter.deal ? String(filter.deal) : null;
      if (requestedDealId && !dealIds.includes(requestedDealId)) {
        return res.status(200).json({ data: [], total: 0, page: pageNum, pages: 1 });
      }
      delete filter.deal;
      const scopedDealIds = requestedDealId ? [requestedDealId] : dealIds;
      filter.$or = [{ deal: { $in: scopedDealIds } }, { "allocations.deal": { $in: scopedDealIds } }];
    }

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
    let advocateFilter = {};
    if (req.saleAdvocateId) {
      const dealIds = await ownAdvocateDealIds(req, business);
      advocateFilter = { $or: [{ deal: { $in: dealIds } }, { "allocations.deal": { $in: dealIds } }] };
    }
    const payout = await populatePayout(SaleOwnerPayout.findOne({ _id: req.params.id, business, ...advocateFilter })).lean();
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

    const reference = String(req.body.reference || "").trim();
    if (!reference) return next(createError(400, "A reference number is required"));

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
    let cleanAllocations = [];

    if (source === "advocate_trust") {
      const hasDeal = req.body.deal && mongoose.isValidObjectId(String(req.body.deal));
      const rawAllocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
      if (hasDeal && rawAllocations.length) {
        return next(createError(400, "Provide either a single deal or a multi-deal allocation list, not both"));
      }
      // advocate-scoped caller: defense-in-depth — a trust payout can only be claimed against deal(s)
      // that are actually theirs, even though the default shipped Advocate role needs the dedicated
      // sale-owner-payouts:create grant (not sale-owners:create) to reach this endpoint at all.
      const dealScope = req.saleAdvocateId ? { _id: { $in: await ownAdvocateDealIds(req, business) } } : {};

      if (rawAllocations.length) {
        // Combined payout: trust drawn from several of this owner's deals in one go — the advocate
        // handed over proceeds from, say, 3 closed plots as one payment to the owner.
        const dealIds = rawAllocations.map((a) => String(a.deal));
        if (new Set(dealIds).size !== dealIds.length) {
          return next(createError(400, "The same deal cannot be allocated twice in one payout"));
        }
        if (dealIds.some((id) => !mongoose.isValidObjectId(id))) return next(createError(400, "Invalid deal in allocations"));

        const deals = await SaleDeal.find({ _id: { $in: dealIds }, business, ...dealScope }).select("_id").lean();
        const dealById = new Map(deals.map((d) => [String(d._id), d]));
        for (const id of dealIds) {
          if (!dealById.has(id)) return next(createError(400, "One of the selected deals was not found"));
        }

        const balances = await Promise.all(dealIds.map((id) => dealAdvocateTrustBalance(business, id)));
        const balanceByDeal = new Map(dealIds.map((id, i) => [id, balances[i]]));

        let allocatedTotal = 0;
        for (const a of rawAllocations) {
          const dealId = String(a.deal);
          const allocAmount = round2(Number(a.amount));
          if (!Number.isFinite(allocAmount) || allocAmount <= 0) {
            return next(createError(400, "Each allocation's amount must be a number greater than 0"));
          }
          const avail = balanceByDeal.get(dealId).available;
          if (allocAmount > avail + 0.01) {
            return next(createError(400, `Deal ${dealId}'s advocate trust balance is only KES ${avail.toLocaleString()} — cannot allocate KES ${allocAmount.toLocaleString()} to it.`));
          }
          cleanAllocations.push({ deal: dealId, amount: allocAmount });
          allocatedTotal = round2(allocatedTotal + allocAmount);
        }
        if (Math.abs(allocatedTotal - totalClaim) > 0.01) {
          return next(createError(400, `Allocations total KES ${allocatedTotal.toLocaleString()} but the payout is for KES ${totalClaim.toLocaleString()}${cgtAmount > 0 ? " (incl. CGT)" : ""} — they must match exactly.`));
        }
      } else {
        // Single-deal payout — original behavior, byte-identical.
        if (!hasDeal) return next(createError(400, "A deal is required for an advocate_trust owner payout"));
        dealDoc = await SaleDeal.findOne({ _id: req.body.deal, business, ...dealScope }).select("_id").lean();
        if (!dealDoc) return next(createError(400, "Deal not found"));

        const trust = await dealAdvocateTrustBalance(business, dealDoc._id);
        if (totalClaim > trust.available + 0.01) {
          return next(createError(400, `This deal's advocate trust balance is only KES ${trust.available.toLocaleString()} — cannot pay out KES ${totalClaim.toLocaleString()}${cgtAmount > 0 ? " (incl. CGT)" : ""}.`));
        }
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
      allocations: cleanAllocations,
      amount,
      cgtAmount,
      cgtReference: req.body.cgtReference || "",
      date: req.body.date || new Date(),
      source,
      advocate: advocateAcc?._id || null,
      cashbook: cashbookAcc?._id || null,
      reference,
      notes: req.body.notes || "",
      createdBy: userId,
      updatedBy: userId,
    });

    // reference (payout to owner) and cgtReference (owner's own remittance to KRA) are two distinct
    // real-world transactions, each guarded independently.
    try {
      await claimPaymentReference({ business, reference: payout.reference, sourceModel: "SaleOwnerPayout", sourceId: payout._id });
      await claimPaymentReference({ business, reference: payout.cgtReference, sourceModel: "SaleOwnerPayout", sourceId: payout._id });
    } catch (refErr) {
      await releasePaymentReference({ business, reference: payout.reference, sourceModel: "SaleOwnerPayout", sourceId: payout._id }).catch(() => {});
      await SaleOwnerPayout.deleteOne({ _id: payout._id });
      return next(refErr);
    }

    try {
      await postSaleOwnerPayout({
        businessId: business,
        payout,
        userId,
        cashbookAccountId: cashbookAcc?._id || null,
      });
    } catch (glErr) {
      // GL failed — delete the payout so DB and ledger stay in sync (same rollback pattern used
      // throughout this module, e.g. rechargeRemittancesController.js's createRechargeRemittance)
      await SaleOwnerPayout.deleteOne({ _id: payout._id });
      await releasePaymentReference({ business, reference: payout.reference, sourceModel: "SaleOwnerPayout", sourceId: payout._id }).catch(() => {});
      await releasePaymentReference({ business, reference: payout.cgtReference, sourceModel: "SaleOwnerPayout", sourceId: payout._id }).catch(() => {});
      return next(createError(422, `Owner payout saved but GL posting failed: ${glErr.message}. Payout has been rolled back.`));
    }

    const populated = await populatePayout(SaleOwnerPayout.findById(payout._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

// Corrects a mis-entered payout (wrong owner, wrong amount, etc.) — previously there was no way to do
// this at all: resolveOwnerOutstandingBalance subtracts every SaleOwnerPayout with no way to exclude a
// bad one, permanently corrupting the owner's balance. Same voided/audit-trail pattern as
// paymentsController.js's voidPayment — the record stays (status: "cancelled"), only the GL and the
// claimed reference are released.
export const voidOwnerPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    let advocateFilter = {};
    if (req.saleAdvocateId) {
      const dealIds = await ownAdvocateDealIds(req, business);
      advocateFilter = { $or: [{ deal: { $in: dealIds } }, { "allocations.deal": { $in: dealIds } }] };
    }
    const payout = await SaleOwnerPayout.findOne({ _id: req.params.id, business, ...advocateFilter });
    if (!payout) return next(createError(404, "Owner payout not found"));
    if (payout.status === "cancelled") return next(createError(400, "Payout is already voided"));

    payout.status = "cancelled";
    payout.updatedBy = userId;
    await payout.save();

    try {
      await reverseSaleOwnerPayout({ businessId: business, payout, userId, reason: req.body.reason });
    } catch (glErr) {
      payout.status = "paid";
      await payout.save();
      return next(createError(422, `GL reversal failed: ${glErr.message}. Payout void has been rolled back.`));
    }

    await releasePaymentReference({ business, reference: payout.reference, sourceModel: "SaleOwnerPayout", sourceId: payout._id }).catch(() => {});
    await releasePaymentReference({ business, reference: payout.cgtReference, sourceModel: "SaleOwnerPayout", sourceId: payout._id }).catch(() => {});

    const populated = await populatePayout(SaleOwnerPayout.findById(payout._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};
