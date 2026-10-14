import mongoose from "mongoose";
import { createError } from "../../../utils/error.js";
import SaleOwnerStatement from "../models/SaleOwnerStatement.js";
import SaleOwnerStatementLine from "../models/SaleOwnerStatementLine.js";
import SaleOwner from "../models/SaleOwner.js";
import { currentUserId, generateSequentialNumber, resolveActiveBusinessId } from "../services/businessScope.js";
import { generateOwnerStatementData } from "../services/ownerStatementService.js";

const OWNER_FIELDS = "fullName ownerNumber phone email";

const populateStatement = (query) => query.populate("owner", OWNER_FIELDS).populate("project", "name projectNumber");

// Builds (or, for an existing draft, rebuilds) the header + line rows for one owner/period. Freely
// re-callable while draft — delete+reinsert lines, recompute header. Blocked once approved (the model's
// own pre-update/delete guards enforce this; this function additionally checks status up front for a
// clearer error message).
export const createDraftStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const { owner: ownerId, project: projectId = null, periodStart, periodEnd } = req.body || {};

    if (!mongoose.isValidObjectId(String(ownerId))) return next(createError(400, "Owner is required"));
    if (!periodStart || !periodEnd) return next(createError(400, "periodStart and periodEnd are required"));
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return next(createError(400, "Invalid period range"));
    }
    // A bare "To" date (from a plain <input type="date">) parses to midnight at the START of that day —
    // without this, anything dated on the "To" day itself (a payment or voucher recorded later that same
    // day) falls after the cutoff and silently drops off the statement, even though a user picking
    // "through 14 Oct" obviously means the whole day, not "up to midnight at its start."
    end.setHours(23, 59, 59, 999);

    const owner = await SaleOwner.findOne({ _id: ownerId, business }).lean();
    if (!owner) return next(createError(404, "Owner not found"));

    const existing = await SaleOwnerStatement.findOne({
      business, owner: ownerId, project: projectId || null, periodStart: start, periodEnd: end, version: 1,
    });
    if (existing && existing.status === "approved") {
      return next(createError(409, "This period already has an approved statement — create a new period or a later version (not yet supported) instead"));
    }

    const { lines, totals } = await generateOwnerStatementData({ businessId: business, ownerId, projectId, periodStart: start, periodEnd: end });

    let statement = existing;
    if (statement) {
      await SaleOwnerStatementLine.deleteMany({ statement: statement._id });
      statement.set({
        ...totals, entryCount: lines.length, generatedAt: new Date(),
      });
      await statement.save();
    } else {
      const statementNumber = await generateSequentialNumber(SaleOwnerStatement, business, "OSTMT");
      statement = await SaleOwnerStatement.create({
        business, owner: ownerId, project: projectId || null, periodStart: start, periodEnd: end,
        statementNumber, status: "draft", ...totals, entryCount: lines.length, createdBy: userId,
      });
    }

    if (lines.length) {
      await SaleOwnerStatementLine.insertMany(
        lines.map((l) => ({ ...l, statement: statement._id, business, owner: ownerId }))
      );
    }

    const populated = await populateStatement(SaleOwnerStatement.findById(statement._id)).lean();
    res.status(existing ? 200 : 201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const getStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const statement = await populateStatement(SaleOwnerStatement.findOne({ _id: req.params.id, business })).lean();
    if (!statement) return next(createError(404, "Statement not found"));
    const lines = await SaleOwnerStatementLine.find({ statement: statement._id }).sort({ lineNumber: 1 }).lean();
    res.status(200).json({ ...statement, lines });
  } catch (err) {
    next(err);
  }
};

export const listStatements = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const { owner: ownerId = "", status = "" } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const filter = { business };
    if (ownerId) filter.owner = ownerId;
    if (status) filter.status = status;

    const [data, total] = await Promise.all([
      populateStatement(SaleOwnerStatement.find(filter).sort({ periodStart: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      SaleOwnerStatement.countDocuments(filter),
    ]);
    res.status(200).json({ data, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    next(err);
  }
};

export const approveStatement = async (req, res, next) => {
  try {
    const business = resolveActiveBusinessId(req);
    const userId = currentUserId(req);
    const statement = await SaleOwnerStatement.findOne({ _id: req.params.id, business });
    if (!statement) return next(createError(404, "Statement not found"));
    if (statement.status === "approved") return next(createError(400, "Statement is already approved"));

    statement.status = "approved";
    statement.approvedAt = new Date();
    statement.approvedBy = userId;
    await statement.save();

    const populated = await populateStatement(SaleOwnerStatement.findById(statement._id)).lean();
    res.status(200).json(populated);
  } catch (err) {
    next(err);
  }
};
