import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleOwnerCommission from "../models/SaleOwnerCommission.js";
import SaleAgencyCommissionPayout from "../models/SaleAgencyCommissionPayout.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { postAgencyCommissionPayout, reverseAgencyCommissionPayout } from "../services/propertySaleAccountingService.js";
import { dealAdvocateTrustBalance } from "../services/dealProgress.js";
import { ownAdvocateDealIds } from "../middleware/advocateScope.js";
import { outstandingAgencyCommissions } from "../services/agencyCommissionOutstanding.js";
import { claimPaymentReference, releasePaymentReference } from "../../../services/paymentReferenceGuard.js";

// Deals a given advocate holds trust for — reuses the REAL scoping helper (middleware/advocateScope.js)
// via a fake req, exactly like this session's own diagnostic scripts, for both the logged-in scoped
// caller AND a staff caller viewing a specific advocate by id. Never reimplemented separately, so this
// can't drift from what the advocate's own login actually sees.
const dealIdsForAdvocate = (business, advocateId) => ownAdvocateDealIds({ saleAdvocateId: String(advocateId) }, business);

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
    .populate("advocate", "fullName advocateNumber firm phone")
    .populate("cashbook", "name code")
    .populate("allocations.ownerCommission", "commissionNumber deal owner");

// Every deferred-and-unpaid agency commission the caller can see, oldest-first — the "what does this
// advocate still owe Pink House for its own commission" list, shown before an Agency Commission Payout.
export const listOutstandingAgencyCommissions = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    let dealIds;
    if (req.saleAdvocateId) {
      dealIds = await ownAdvocateDealIds(req, business);
    } else if (req.query.advocate) {
      if (!mongoose.isValidObjectId(String(req.query.advocate))) return next(createError(400, "Invalid advocate"));
      dealIds = await dealIdsForAdvocate(business, req.query.advocate);
    } else {
      return next(createError(400, "An advocate is required"));
    }

    const data = await outstandingAgencyCommissions(business, dealIds);
    if (!data.length) return res.status(200).json({ data: [] });

    // Display-only enrichment — the service itself stays lean (ids only) since it's also reused for
    // payout validation, where owner/deal names are irrelevant.
    const ownerIds = [...new Set(data.map((d) => String(d.owner)))];
    const dealIdsUsed = data.map((d) => d.deal);
    const [owners, deals] = await Promise.all([
      SaleOwner.find({ business, _id: { $in: ownerIds } }).select("fullName ownerNumber").lean(),
      SaleDeal.find({ business, _id: { $in: dealIdsUsed } }).select("dealNumber").lean(),
    ]);
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));
    const dealById = new Map(deals.map((d) => [String(d._id), d]));
    const enriched = data.map((d) => ({
      ...d,
      owner: { _id: d.owner, fullName: ownerById.get(String(d.owner))?.fullName, ownerNumber: ownerById.get(String(d.owner))?.ownerNumber },
      dealNumber: dealById.get(String(d.deal))?.dealNumber || null,
    }));

    res.status(200).json({ data: enriched });
  } catch (err) {
    next(err);
  }
};

export const listAgencyCommissionPayouts = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { advocate = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (req.saleAdvocateId) filter.advocate = req.saleAdvocateId;
    else if (advocate && mongoose.isValidObjectId(String(advocate))) filter.advocate = advocate;

    const [data, total] = await Promise.all([
      populatePayout(SaleAgencyCommissionPayout.find(filter).sort({ date: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum)).lean(),
      SaleAgencyCommissionPayout.countDocuments(filter),
    ]);
    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) {
    next(err);
  }
};

export const getAgencyCommissionPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { _id: req.params.id, business };
    if (req.saleAdvocateId) filter.advocate = req.saleAdvocateId;
    const payout = await populatePayout(SaleAgencyCommissionPayout.findOne(filter)).lean();
    if (!payout) return next(createError(404, "Payout not found"));
    res.status(200).json(payout);
  } catch (err) {
    next(err);
  }
};

export const createAgencyCommissionPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    // Scoped advocate caller: always pay as themselves — same rule as every other advocate-initiated action.
    const advocateId = req.saleAdvocateId || req.body.advocate;
    if (req.saleAdvocateId && req.body.advocate && String(req.body.advocate) !== req.saleAdvocateId) {
      return next(createError(404, "Advocate not found"));
    }
    const advocate = await SaleAdvocate.findOne({ _id: advocateId, business }).select("_id").lean();
    if (!advocate) return next(createError(400, "Advocate not found"));

    const dealIds = await dealIdsForAdvocate(business, advocate._id);

    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    if (!allocations.length) return next(createError(400, "At least one commission allocation is required"));

    const commissionIds = allocations.map((a) => String(a.ownerCommission));
    if (new Set(commissionIds).size !== commissionIds.length) {
      return next(createError(400, "The same commission cannot be allocated twice in one payout"));
    }
    if (commissionIds.some((id) => !mongoose.isValidObjectId(id))) return next(createError(400, "Invalid commission in allocations"));

    const commissions = await SaleOwnerCommission.find({
      _id: { $in: commissionIds }, business, deal: { $in: dealIds },
    }).select("_id commissionNumber deal").lean();
    const commissionById = new Map(commissions.map((c) => [String(c._id), c]));
    for (const id of commissionIds) {
      if (!commissionById.has(id)) return next(createError(400, "One of the selected commissions was not found for this advocate"));
    }

    // Capped by BOTH the commission's own remaining deferred/unpaid amount AND the commission's deal's
    // overall trust availability (other disbursements — a broker payout, an owner payout, a plain
    // remittance — may already have drawn down the same trust pool since the commission deferred).
    const outstanding = await outstandingAgencyCommissions(business, dealIds);
    const outstandingByCommission = new Map(outstanding.map((o) => [String(o.ownerCommissionId), o.outstanding]));
    const dealBalanceCache = new Map();
    const dealBalance = async (dealId) => {
      const key = String(dealId);
      if (!dealBalanceCache.has(key)) dealBalanceCache.set(key, await dealAdvocateTrustBalance(business, dealId));
      return dealBalanceCache.get(key);
    };

    let amount = 0;
    const cleanAllocations = [];
    for (const a of allocations) {
      const commissionId = String(a.ownerCommission);
      const allocAmount = round2(Number(a.amount));
      if (!Number.isFinite(allocAmount) || allocAmount <= 0) {
        return next(createError(400, "Each allocation's amount must be a number greater than 0"));
      }
      const commissionCap = outstandingByCommission.get(commissionId) || 0;
      if (allocAmount > commissionCap + 0.01) {
        const label = commissionById.get(commissionId)?.commissionNumber || commissionId;
        return next(createError(400, `Amount for commission ${label} (KES ${allocAmount.toLocaleString()}) exceeds its outstanding deferred balance of KES ${commissionCap.toLocaleString()}`));
      }
      const deal = commissionById.get(commissionId).deal;
      const trust = await dealBalance(deal);
      if (allocAmount > trust.available + 0.01) {
        const label = commissionById.get(commissionId)?.commissionNumber || commissionId;
        return next(createError(400, `Deal for commission ${label}'s advocate trust balance is only KES ${trust.available.toLocaleString()} — cannot allocate KES ${allocAmount.toLocaleString()} to it`));
      }
      cleanAllocations.push({ ownerCommission: commissionId, amount: allocAmount });
      amount = round2(amount + allocAmount);
    }

    const cashbookAcc = await resolveCashbook(business, req.body.cashbook);
    if (req.body.cashbook && !cashbookAcc) return next(createError(400, "Selected cashbook account not found"));

    const payoutNumber = await generateSequentialNumber(SaleAgencyCommissionPayout, business, "ACP");
    const payout = await SaleAgencyCommissionPayout.create({
      business,
      payoutNumber,
      advocate: advocate._id,
      allocations: cleanAllocations,
      amount,
      date: req.body.date || new Date(),
      cashbook: cashbookAcc?._id || null,
      reference: req.body.reference || "",
      notes: req.body.notes || "",
      createdBy: userId,
      updatedBy: userId,
    });

    try {
      await claimPaymentReference({ business, reference: payout.reference, sourceModel: "SaleAgencyCommissionPayout", sourceId: payout._id });
    } catch (refErr) {
      await SaleAgencyCommissionPayout.deleteOne({ _id: payout._id });
      return next(refErr);
    }

    try {
      await postAgencyCommissionPayout({ businessId: business, payout, userId, cashbookAccountId: cashbookAcc?._id || null });
    } catch (glErr) {
      await SaleAgencyCommissionPayout.deleteOne({ _id: payout._id });
      await releasePaymentReference({ business, reference: payout.reference, sourceModel: "SaleAgencyCommissionPayout", sourceId: payout._id }).catch(() => {});
      return next(createError(422, `Agency commission payout saved but GL posting failed: ${glErr.message}. It has been rolled back.`));
    }

    const populated = await populatePayout(SaleAgencyCommissionPayout.findById(payout._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

// Staff-only correction path — same voided/audit-trail pattern as every other remittance/payout type in
// this module.
export const voidAgencyCommissionPayout = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const payout = await SaleAgencyCommissionPayout.findOne({ _id: req.params.id, business });
    if (!payout) return next(createError(404, "Payout not found"));
    if (payout.status === "cancelled") return next(createError(400, "Payout is already voided"));

    payout.status = "cancelled";
    payout.updatedBy = userId;
    await payout.save();

    try {
      await reverseAgencyCommissionPayout({ businessId: business, payout, userId, reason: req.body.reason });
    } catch (glErr) {
      payout.status = "posted";
      await payout.save();
      return next(createError(422, `GL reversal failed: ${glErr.message}. Payout void has been rolled back.`));
    }

    await releasePaymentReference({ business, reference: payout.reference, sourceModel: "SaleAgencyCommissionPayout", sourceId: payout._id }).catch(() => {});

    const populated = await populatePayout(SaleAgencyCommissionPayout.findById(payout._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};
