import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import ChartOfAccount from "../../../models/ChartOfAccount.js";
import PaymentVoucher from "../../../models/PaymentVoucher.js";
import SaleAdvocate from "../models/SaleAdvocate.js";
import SaleOwner from "../models/SaleOwner.js";
import SaleProject from "../models/SaleProject.js";
import SaleDeal from "../models/SaleDeal.js";
import SaleListing from "../models/SaleListing.js";
import SaleAdvocateRechargeRemittance from "../models/SaleAdvocateRechargeRemittance.js";
import { round2 } from "../../../utils/math.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { postAdvocateRechargeRemittance, reverseAdvocateRechargeRemittance } from "../services/propertySaleAccountingService.js";
import { ownAdvocateOwnerIds } from "../middleware/advocateScope.js";
import { outstandingRecoverableExpenseVouchers } from "../services/recoverableExpense.js";
import { claimPaymentReference, releasePaymentReference } from "../../../services/paymentReferenceGuard.js";

// Same resolution ownAdvocateOwnerIds does for the logged-in scoped caller (middleware/advocateScope.js),
// but for an arbitrary advocate id a STAFF caller picks explicitly — mirrors the existing Trust
// Remittances page's "choose an advocate, see their stuff" workflow for this one, owner-scoped flow.
//
// Deliberately OWNER-centric, not project-centric: an advocate linked to even one of an owner's
// projects is treated as the firm handling that owner's relationship with the company as a whole, so
// they see every recharge for that owner regardless of which specific project it's tagged to. This is
// a visibility/attribution concern (who owes the company what), not a custody-of-funds one — contrast
// with trust money (dealAdvocateTrustBalance), which stays strictly scoped to whichever advocate
// actually collected it, since that's a real fiduciary (LSK) boundary, not just a UI convenience.
const ownerIdsForAdvocate = async (business, advocateId) => {
  const [defaultProjectIds, dealListingIds] = await Promise.all([
    SaleProject.distinct("_id", { business, assignedAdvocate: advocateId }),
    SaleDeal.distinct("listing", { business, advocate: advocateId }),
  ]);
  const dealProjectIds = dealListingIds.length
    ? await SaleListing.distinct("project", { business, _id: { $in: dealListingIds }, project: { $ne: null } })
    : [];
  const projectIds = [...new Set([...defaultProjectIds, ...dealProjectIds].map(String))];
  if (!projectIds.length) return [];
  return SaleProject.distinct("owner", { business, _id: { $in: projectIds }, owner: { $ne: null } });
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

const populateRechargeRemittance = (query) =>
  query
    .populate("advocate", "fullName advocateNumber firm phone")
    .populate("owner", "fullName ownerNumber")
    .populate("cashbook", "name code")
    .populate("allocations.voucher", "voucherNo amount narration payeeName");

// Every outstanding recoverable-expense voucher the caller can see, oldest-due-first — the "what do I
// still owe Pink House" list an advocate checks before remitting. A scoped advocate always sees only
// their own owners' vouchers; a staff caller can narrow to one owner (?owner=) or sees every business's
// outstanding voucher when neither is given.
export const listOutstandingRecharges = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);

    let ownerIds;
    if (req.saleAdvocateId) {
      ownerIds = await ownAdvocateOwnerIds(req, business);
    } else if (req.query.owner) {
      if (!mongoose.isValidObjectId(String(req.query.owner))) return next(createError(400, "Invalid owner"));
      ownerIds = [req.query.owner];
    } else if (req.query.advocate) {
      if (!mongoose.isValidObjectId(String(req.query.advocate))) return next(createError(400, "Invalid advocate"));
      ownerIds = await ownerIdsForAdvocate(business, req.query.advocate);
    } else {
      ownerIds = (await SaleOwner.find({ business }).select("_id").lean()).map((o) => o._id);
    }

    if (!ownerIds.length) return res.status(200).json({ data: [] });

    const owners = await SaleOwner.find({ business, _id: { $in: ownerIds } }).select("fullName ownerNumber").lean();
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));

    const perOwner = await Promise.all(ownerIds.map((id) => outstandingRecoverableExpenseVouchers(business, id)));
    const projectIds = [...new Set(perOwner.flat().map((v) => v.saleProject).filter(Boolean).map(String))];
    const projects = projectIds.length ? await SaleProject.find({ business, _id: { $in: projectIds } }).select("name").lean() : [];
    const projectNameById = new Map(projects.map((p) => [String(p._id), p.name]));

    const data = ownerIds.flatMap((id, i) =>
      perOwner[i].map((v) => ({
        ...v,
        owner: { _id: id, fullName: ownerById.get(String(id))?.fullName, ownerNumber: ownerById.get(String(id))?.ownerNumber },
        projectName: v.saleProject ? projectNameById.get(String(v.saleProject)) || null : null,
      }))
    );
    data.sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0));

    res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
};

export const listRechargeRemittances = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { advocate = "", owner = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
    const filter = { business };
    if (req.saleAdvocateId) filter.advocate = req.saleAdvocateId;
    else if (advocate && mongoose.isValidObjectId(String(advocate))) filter.advocate = advocate;
    if (owner && mongoose.isValidObjectId(String(owner))) filter.owner = owner;

    const [data, total] = await Promise.all([
      populateRechargeRemittance(SaleAdvocateRechargeRemittance.find(filter).sort({ date: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum)).lean(),
      SaleAdvocateRechargeRemittance.countDocuments(filter),
    ]);
    res.status(200).json({ data, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (err) {
    next(err);
  }
};

export const getRechargeRemittance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const filter = { _id: req.params.id, business };
    if (req.saleAdvocateId) filter.advocate = req.saleAdvocateId;
    const remittance = await populateRechargeRemittance(SaleAdvocateRechargeRemittance.findOne(filter)).lean();
    if (!remittance) return next(createError(404, "Remittance not found"));
    res.status(200).json(remittance);
  } catch (err) {
    next(err);
  }
};

export const createRechargeRemittance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);

    // Scoped advocate caller: always remit as themselves — same "never let the caller's own input
    // override the scope" rule used throughout this module.
    const advocateId = req.saleAdvocateId || req.body.advocate;
    if (req.saleAdvocateId && req.body.advocate && String(req.body.advocate) !== req.saleAdvocateId) {
      return next(createError(404, "Advocate not found"));
    }
    const advocate = await SaleAdvocate.findOne({ _id: advocateId, business }).select("_id").lean();
    if (!advocate) return next(createError(400, "Advocate not found"));

    if (!mongoose.isValidObjectId(String(req.body.owner))) return next(createError(400, "Owner is required"));
    const owner = await SaleOwner.findOne({ _id: req.body.owner, business }).select("_id").lean();
    if (!owner) return next(createError(400, "Owner not found"));

    // A scoped advocate can only remit for an owner they can actually see (one of their own projects).
    if (req.saleAdvocateId) {
      const ownerIds = (await ownAdvocateOwnerIds(req, business)).map(String);
      if (!ownerIds.includes(String(owner._id))) return next(createError(404, "Owner not found"));
    }

    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    if (!allocations.length) return next(createError(400, "At least one voucher allocation is required"));

    const voucherIds = allocations.map((a) => String(a.voucher));
    if (new Set(voucherIds).size !== voucherIds.length) {
      return next(createError(400, "The same voucher cannot be allocated twice in one remittance"));
    }
    if (voucherIds.some((id) => !mongoose.isValidObjectId(id))) return next(createError(400, "Invalid voucher in allocations"));

    const vouchers = await PaymentVoucher.find({
      _id: { $in: voucherIds }, business, saleOwner: owner._id, category: "sale_owner_expense",
    }).select("_id voucherNo").lean();
    const voucherById = new Map(vouchers.map((v) => [String(v._id), v]));
    for (const id of voucherIds) {
      if (!voucherById.has(id)) return next(createError(400, "One of the selected vouchers was not found for this owner"));
    }

    const outstanding = await outstandingRecoverableExpenseVouchers(business, owner._id);
    const outstandingByVoucher = new Map(outstanding.map((v) => [String(v.voucherId), v.outstanding]));

    let amount = 0;
    const cleanAllocations = [];
    for (const a of allocations) {
      const voucherId = String(a.voucher);
      const allocAmount = round2(Number(a.amount));
      if (!Number.isFinite(allocAmount) || allocAmount <= 0) {
        return next(createError(400, "Each allocation's amount must be a number greater than 0"));
      }
      const avail = outstandingByVoucher.get(voucherId) || 0;
      if (allocAmount > avail + 0.01) {
        const label = voucherById.get(voucherId)?.voucherNo || voucherId;
        return next(createError(400, `Amount for voucher ${label} (KES ${allocAmount.toLocaleString()}) exceeds its outstanding balance of KES ${avail.toLocaleString()}`));
      }
      cleanAllocations.push({ voucher: voucherId, amount: allocAmount });
      amount = round2(amount + allocAmount);
    }

    const cashbookAcc = await resolveCashbook(business, req.body.cashbook);
    if (req.body.cashbook && !cashbookAcc) return next(createError(400, "Selected cashbook account not found"));

    const remittanceNumber = await generateSequentialNumber(SaleAdvocateRechargeRemittance, business, "RCG");
    const remittance = await SaleAdvocateRechargeRemittance.create({
      business,
      remittanceNumber,
      advocate: advocate._id,
      owner: owner._id,
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
      await claimPaymentReference({ business, reference: remittance.reference, sourceModel: "SaleAdvocateRechargeRemittance", sourceId: remittance._id });
    } catch (refErr) {
      await SaleAdvocateRechargeRemittance.deleteOne({ _id: remittance._id });
      return next(refErr);
    }

    try {
      await postAdvocateRechargeRemittance({ businessId: business, remittance, userId, cashbookAccountId: cashbookAcc?._id || null });
    } catch (glErr) {
      await SaleAdvocateRechargeRemittance.deleteOne({ _id: remittance._id });
      await releasePaymentReference({ business, reference: remittance.reference, sourceModel: "SaleAdvocateRechargeRemittance", sourceId: remittance._id }).catch(() => {});
      return next(createError(422, `Recharge remittance saved but GL posting failed: ${glErr.message}. It has been rolled back.`));
    }

    const populated = await populateRechargeRemittance(SaleAdvocateRechargeRemittance.findById(remittance._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

// Staff-only correction path — same voided/audit-trail pattern used throughout this module: the record
// stays (status "cancelled"), only the GL and the claimed reference are released. A scoped advocate can
// create their own recharge remittances but not correct them after the fact.
export const voidRechargeRemittance = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const remittance = await SaleAdvocateRechargeRemittance.findOne({ _id: req.params.id, business });
    if (!remittance) return next(createError(404, "Remittance not found"));
    if (remittance.status === "cancelled") return next(createError(400, "Remittance is already voided"));

    remittance.status = "cancelled";
    remittance.updatedBy = userId;
    await remittance.save();

    try {
      await reverseAdvocateRechargeRemittance({ businessId: business, remittance, userId, reason: req.body.reason });
    } catch (glErr) {
      remittance.status = "posted";
      await remittance.save();
      return next(createError(422, `GL reversal failed: ${glErr.message}. Remittance void has been rolled back.`));
    }

    await releasePaymentReference({ business, reference: remittance.reference, sourceModel: "SaleAdvocateRechargeRemittance", sourceId: remittance._id }).catch(() => {});

    const populated = await populateRechargeRemittance(SaleAdvocateRechargeRemittance.findById(remittance._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};
