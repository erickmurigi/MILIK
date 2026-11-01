// Cost centres: a small, company-managed list (e.g. "Head Office", "Nairobi Branch") that journal lines
// can be tagged with, so Profit by Tag can group income/expenses by department rather than account.
// Deliberately a managed list, not free text on the journal line — a free-text field fragments reporting
// the moment two people type "Head office" and "Head Office" for the same thing.
import mongoose from "mongoose";
import CostCentre from "../../models/CostCentre.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { createError } from "../../utils/error.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const actorId = (req) => {
  const id = req.user?._id || req.user?.id;
  return isValidObjectId(id) ? id : null;
};

export const listCostCentres = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) return next(createError(400, "A valid business id is required."));
    const filter = { business };
    if (req.query.status) filter.status = req.query.status;
    const costCentres = await CostCentre.find(filter).sort({ name: 1 }).lean();
    return res.status(200).json({ success: true, data: costCentres });
  } catch (err) {
    next(err);
  }
};

export const createCostCentre = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) return next(createError(400, "A valid business id is required."));
    const name = String(req.body?.name || "").trim();
    if (!name) return next(createError(400, "Give this cost centre a name."));

    const costCentre = await CostCentre.create({
      business,
      name,
      code: String(req.body?.code || "").trim(),
      notes: String(req.body?.notes || "").trim(),
      createdBy: actorId(req),
      updatedBy: actorId(req),
    });
    return res.status(201).json({ success: true, data: costCentre });
  } catch (err) {
    if (err?.code === 11000) return next(createError(409, "A cost centre with this name already exists."));
    next(err);
  }
};

export const updateCostCentre = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) return next(createError(400, "A valid business id is required."));

    const updates = {};
    if ("name" in req.body) {
      const name = String(req.body.name || "").trim();
      if (!name) return next(createError(400, "Give this cost centre a name."));
      updates.name = name;
    }
    if ("code" in req.body) updates.code = String(req.body.code || "").trim();
    if ("notes" in req.body) updates.notes = String(req.body.notes || "").trim();
    if ("status" in req.body) updates.status = req.body.status === "inactive" ? "inactive" : "active";
    updates.updatedBy = actorId(req);

    const costCentre = await CostCentre.findOneAndUpdate(
      { _id: req.params.id, business },
      updates,
      { new: true, runValidators: true }
    ).lean();
    if (!costCentre) return next(createError(404, "Cost centre not found."));
    return res.status(200).json({ success: true, data: costCentre });
  } catch (err) {
    if (err?.code === 11000) return next(createError(409, "A cost centre with this name already exists."));
    next(err);
  }
};

export const deleteCostCentre = async (req, res, next) => {
  try {
    const business = resolveBusinessId(req);
    if (!business) return next(createError(400, "A valid business id is required."));

    const costCentre = await CostCentre.findOne({ _id: req.params.id, business });
    if (!costCentre) return next(createError(404, "Cost centre not found."));

    const used = await FinancialLedgerEntry.countDocuments({ business, "dimensions.costCentre": costCentre._id });
    if (used > 0) {
      return next(createError(400, `This cost centre is used on ${used} ledger entr${used === 1 ? "y" : "ies"} — deactivate it instead of deleting it.`));
    }

    await costCentre.deleteOne();
    return res.status(200).json({ success: true, message: "Cost centre deleted" });
  } catch (err) {
    next(err);
  }
};
