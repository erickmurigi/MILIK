import LandlordStatement from "../../models/LandlordStatement.js";
import LandlordStatementLine from "../../models/LandlordStatementLine.js";
import Property from "../../models/Property.js";
import mongoose from "mongoose";
import {
  createDraftStatement,
  refreshDraftStatement,
  approveStatement,
  getStatementById,
  createRevision,
  validateStatementAudit,
} from "../../services/statementSnapshotService.js";
import { generateStatementPdf } from "../../services/statementPdfService.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const resolveBusinessId = async (req, propertyId = null) => {
  if (req.user?.company && isValidObjectId(req.user.company)) return String(req.user.company);
  if (req.body?.businessId && isValidObjectId(req.body.businessId)) return String(req.body.businessId);
  if (req.query?.businessId && isValidObjectId(req.query.businessId)) return String(req.query.businessId);
  if (propertyId && isValidObjectId(propertyId)) {
    const property = await Property.findById(propertyId).select('business').lean();
    if (property?.business) return String(property.business);
  }
  return null;
};

const resolvePropertyLandlord = async (propertyId) => {
  if (!propertyId || !isValidObjectId(propertyId)) return {};
  const property = await Property.findById(propertyId).select('business landlords').lean();
  if (!property) return {};
  const primary = Array.isArray(property.landlords) ? property.landlords.find((l) => l?.isPrimary && l?.landlordId) : null;
  const fallback = Array.isArray(property.landlords) ? property.landlords.find((l) => l?.landlordId) : null;
  return {
    businessId: property.business ? String(property.business) : null,
    landlordId: primary?.landlordId ? String(primary.landlordId) : fallback?.landlordId ? String(fallback.landlordId) : null,
  };
};

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for statement audit attribution.",
  });

const findStatementForAccess = async (statementId, req) => {
  const directBusinessId = await resolveBusinessId(req);
  if (directBusinessId) {
    const scoped = await LandlordStatement.findOne({ _id: statementId, business: directBusinessId });
    if (scoped) return scoped;
  }
  return LandlordStatement.findById(statementId);
};

const startOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

/**
 * Create a draft statement from ledger data.
 * If a draft already exists for the same period/landlord, returns the existing draft.
 */
export const createDraft = async (req, res, next) => {
  try {
    const {
      propertyId,
      landlordId: landlordIdFromBody,
      periodStart,
      periodEnd,
      notes,
      statementType = "provisional",
    } = req.body;
    const propertyContext = await resolvePropertyLandlord(propertyId);
    const businessId = (await resolveBusinessId(req, propertyId)) || propertyContext.businessId;
    const landlordId = landlordIdFromBody || propertyContext.landlordId;
    const userId = await resolveActorUserId(req, businessId);

    if (!propertyId || !periodStart || !periodEnd) {
      return res.status(400).json({
        success: false,
        message: "propertyId, periodStart, and periodEnd are required",
      });
    }

    if (!landlordId) {
      return res.status(400).json({
        success: false,
        message: "The selected property has no linked landlord. Link a landlord to the property before generating a statement.",
      });
    }

    const refreshRequested = req.body?.refresh === true || String(req.query?.refresh || "").toLowerCase() === "true";
    const periodStartStart = startOfDay(periodStart);
    const periodStartEnd = endOfDay(periodStart);
    const periodEndStart = startOfDay(periodEnd);
    const periodEndEnd = endOfDay(periodEnd);

    // Reopen existing draft for same period even if stored date has time component.
    const existingDraft = await LandlordStatement.findOne({
      business: businessId,
      property: propertyId,
      landlord: landlordId,
      status: "draft",
      ...(periodStartStart && periodStartEnd
        ? { periodStart: { $gte: periodStartStart, $lte: periodStartEnd } }
        : {}),
      ...(periodEndStart && periodEndEnd
        ? { periodEnd: { $gte: periodEndStart, $lte: periodEndEnd } }
        : {}),
    }).sort({ createdAt: -1 });

    if (existingDraft) {
      const result = refreshRequested
        ? await refreshDraftStatement(existingDraft._id, userId, notes || "", statementType)
        : { statement: existingDraft, lineCount: existingDraft.lineCount || 0 };

      const lines = await LandlordStatementLine.find({ statement: existingDraft._id })
        .sort({ lineNumber: 1 })
        .lean();

      const reopenedStatement = refreshRequested
        ? result.statement
        : await LandlordStatement.findById(existingDraft._id).lean();

      return res.status(200).json({
        success: true,
        message: refreshRequested
          ? "Existing draft regenerated successfully"
          : "Existing draft reopened successfully",
        data: {
          statement: reopenedStatement,
          lines,
          lineCount: lines.length,
          isExisting: true,
          refreshed: refreshRequested,
        },
      });
    }

    // Create new draft
    const result = await createDraftStatement({
      businessId,
      propertyId,
      landlordId,
      statementPeriodStart: periodStart,
      statementPeriodEnd: periodEnd,
      statementType,
      userId,
      notes: notes || "",
    });

    emitToCompany(businessId, "statement:created", {
      statementId: result.statement._id,
      landlordId,
      propertyId,
    });

    res.status(201).json({
      success: true,
      message: "Draft statement created successfully",
      data: {
        statement: result.statement,
        lineCount: result.lineCount,
        isExisting: false,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Approve a draft statement, freezing it as immutable.
 */
export const approve = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { approvalNotes } = req.body;
    const statement = await findStatementForAccess(statementId, req);
    const businessId = statement?.business ? String(statement.business) : await resolveBusinessId(req);
    const userId = await resolveActorUserId(req, businessId);

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    if (statement.status === "approved" || statement.status === "sent") {
      return res.status(400).json({
        success: false,
        message: "Statement is already approved or sent",
      });
    }

    if (statement.status === "revised") {
      return res.status(400).json({
        success: false,
        message: "Revised statements cannot be approved. Use the superseding statement instead.",
      });
    }

    // Safeguard: Prevent approval of empty statements
    const lineCount = await LandlordStatementLine.countDocuments({
      statement: statementId,
      business: businessId,
    });

    if (lineCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot approve statement with no line items. Statement must contain at least one entry.",
      });
    }

    // Safeguard: Prevent multiple approved statements for the same period
    const existingApproved = await LandlordStatement.findOne({
      business: businessId,
      property: statement.property,
      landlord: statement.landlord,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      status: "approved",
      _id: { $ne: statementId },
    });

    if (existingApproved) {
      return res.status(400).json({
        success: false,
        message: `An approved statement already exists for this period (${existingApproved.statementNumber}). Please create a revision instead.`,
        data: {
          existingStatementId: existingApproved._id,
          existingStatementNumber: existingApproved.statementNumber,
        },
      });
    }

    // Approve statement (freezes statement and lines)
    const result = await approveStatement(statementId, userId, approvalNotes || "");

    emitToCompany(businessId, "statement:approved", {
      statementId: result.statement._id,
      landlordId: result.statement.landlord,
      propertyId: result.statement.property,
    });

    res.status(200).json({
      success: true,
      message: "Statement approved and frozen successfully",
      data: {
        statement: result.statement,
        lines: result.lines,
        lineCount: result.lines.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Get a single statement by ID with its lines.
 * Always uses frozen snapshot data, never regenerates from ledger.
 */
export const getStatement = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { includeLines = "true", populateRefs = "true" } = req.query;
    const statementCheck = await findStatementForAccess(statementId, req);

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    if (!statementCheck) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    const result = await getStatementById(statementId, {
      includeLines: includeLines === "true",
      populateRefs: populateRefs === "true",
    });

    res.status(200).json({
      success: true,
      data: {
        statement: result.statement,
        lines: result.lines,
        lineCount: result.lines.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * List statements for a landlord with filtering.
 * Returns snapshot headers only (lines fetched separately via getStatement).
 */
export const listStatementsForLandlord = async (req, res, next) => {
  try {
    const {
      propertyId,
      landlordId: landlordIdFromQuery,
      periodStart,
      periodEnd,
      status,
      page = 1,
      limit = 20,
    } = req.query;

    const propertyContext = propertyId ? await resolvePropertyLandlord(propertyId) : {};
    const businessId = (await resolveBusinessId(req, propertyId)) || propertyContext.businessId;
    const landlordId = landlordIdFromQuery || propertyContext.landlordId;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context could not be resolved for statements listing",
      });
    }

    if (!propertyId && !landlordId) {
      return res.status(400).json({
        success: false,
        message: "Provide propertyId or landlordId to list statements",
      });
    }

    const filter = {
      business: businessId,
    };

    if (landlordId) filter.landlord = landlordId;

    if (propertyId) filter.property = propertyId;
    if (status) filter.status = status;

    if (periodStart || periodEnd) {
      filter.periodStart = {};
      if (periodStart) filter.periodStart.$gte = new Date(periodStart);
      if (periodEnd) filter.periodStart.$lte = new Date(periodEnd);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const statements = await LandlordStatement.find(filter)
      .sort({ periodStart: -1, version: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("property", "name propertyName address city")
      .populate("landlord", "landlordName landlordType email phoneNumber")
      .populate("approvedBy", "surname otherNames email")
      .lean();

    const total = await LandlordStatement.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        statements,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Create a revision of an approved/sent statement.
 * Marks original as "revised" and creates new draft version.
 */
export const createStatementRevision = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { revisionReason } = req.body;
    const statementCheck = await findStatementForAccess(statementId, req);
    const businessId = statementCheck?.business ? String(statementCheck.business) : await resolveBusinessId(req);
    const userId = await resolveActorUserId(req, businessId);

    if (!statementId || !revisionReason) {
      return res.status(400).json({
        success: false,
        message: "statementId and revisionReason are required",
      });
    }

    if (!statementCheck) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    const result = await createRevision(statementId, userId, revisionReason);

    emitToCompany(businessId, "statement:revised", {
      originalStatementId: result.originalStatement._id,
      newStatementId: result.statement._id,
      landlordId: result.statement.landlord,
      propertyId: result.statement.property,
    });

    res.status(201).json({
      success: true,
      message: "Statement revision created successfully",
      data: {
        newStatement: result.statement,
        originalStatement: result.originalStatement,
        lineCount: result.lineCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Mark an approved statement as sent (for tracking purposes).
 */
export const markAsSent = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const statement = await findStatementForAccess(statementId, req);
    const businessId = statement?.business ? String(statement.business) : await resolveBusinessId(req);
    const userId = await resolveActorUserId(req, businessId);

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    if (statement.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: "Only approved statements can be marked as sent",
      });
    }

    statement.status = "sent";
    statement.sentAt = new Date();
    statement.sentBy = userId;
    await statement.save();

    emitToCompany(businessId, "statement:sent", {
      statementId: statement._id,
      landlordId: statement.landlord,
      propertyId: statement.property,
    });

    res.status(200).json({
      success: true,
      message: "Statement marked as sent",
      data: { statement },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a draft statement (only drafts can be deleted).
 */
export const deleteDraft = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const statement = await findStatementForAccess(statementId, req);
    const businessId = statement?.business ? String(statement.business) : await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    if (statement.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft statements can be deleted",
      });
    }

    // Safeguard: Protect draft deletion in revision chains
    // Check if this statement is referenced in any revision chain
    const referencedAsSupersedes = await LandlordStatement.findOne({
      business: businessId,
      supersededByStatementId: statementId,
    });

    if (referencedAsSupersedes) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete statement. It is referenced as a superseding version by statement ${referencedAsSupersedes.statementNumber}`,
        data: {
          referencedByStatementId: referencedAsSupersedes._id,
          referencedByStatementNumber: referencedAsSupersedes.statementNumber,
        },
      });
    }

    const referencedAsOriginal = await LandlordStatement.findOne({
      business: businessId,
      supersedesStatementId: statementId,
    });

    if (referencedAsOriginal) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete statement. It is referenced as an original version by revision ${referencedAsOriginal.statementNumber}`,
        data: {
          referencedByStatementId: referencedAsOriginal._id,
          referencedByStatementNumber: referencedAsOriginal.statementNumber,
        },
      });
    }

    // Delete associated lines first
    await LandlordStatementLine.deleteMany({
      statement: statementId,
      business: businessId,
    });

    // Delete statement header
    await LandlordStatement.findOneAndDelete({
      _id: statementId,
      business: businessId,
    });

    emitToCompany(businessId, "statement:deleted", {
      statementId,
      landlordId: statement.landlord,
      propertyId: statement.property,
    });

    res.status(200).json({
      success: true,
      message: "Draft statement deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Validate statement audit integrity.
 * Checks that header counts match actual frozen lines.
 */
export const validateAudit = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const statementCheck = await findStatementForAccess(statementId, req);
    const businessId = statementCheck?.business ? String(statementCheck.business) : await resolveBusinessId(req);

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    if (!statementCheck) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    const result = await validateStatementAudit(statementId);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Generate and download PDF for an approved/sent statement.
 * Uses immutable statement snapshot only - never regenerates from ledger.
 */
export const generatePdf = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const statement = await findStatementForAccess(statementId, req);
    const businessId = statement?.business ? String(statement.business) : req.user.company;

    if (!statementId) {
      return res.status(400).json({
        success: false,
        message: "statementId is required",
      });
    }

    if (!statement) {
      return res.status(404).json({
        success: false,
        message: "Statement not found or access denied",
      });
    }

    const pdfBuffer = await generateStatementPdf(statementId, businessId);

    const filename = `Statement_${statement.statementNumber}.pdf`;
    const disposition = req.query?.preview === 'true' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
};

/**
 * Get statement summary statistics for a property/landlord.
 */
export const getStatementSummary = async (req, res, next) => {
  try {
    const { propertyId, landlordId: landlordIdFromQuery, year } = req.query;
    const propertyContext = propertyId ? await resolvePropertyLandlord(propertyId) : {};
    const businessId = (await resolveBusinessId(req, propertyId)) || propertyContext.businessId;
    const landlordId = landlordIdFromQuery || propertyContext.landlordId;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: "Business context could not be resolved for statement summary",
      });
    }

    if (!propertyId && !landlordId) {
      return res.status(400).json({
        success: false,
        message: "Provide propertyId or landlordId to get statement summary",
      });
    }

    const filter = {
      business: businessId,
    };

    if (landlordId) filter.landlord = landlordId;

    if (propertyId) filter.property = propertyId;
    if (year) {
      const yearInt = parseInt(year);
      filter.periodStart = {
        $gte: new Date(yearInt, 0, 1),
        $lt: new Date(yearInt + 1, 0, 1),
      };
    }

    const statements = await LandlordStatement.find(filter).lean();

    const summary = {
      total: statements.length,
      byStatus: {
        draft: statements.filter((s) => s.status === "draft").length,
        reviewed: statements.filter((s) => s.status === "reviewed").length,
        approved: statements.filter((s) => s.status === "approved").length,
        sent: statements.filter((s) => s.status === "sent").length,
        revised: statements.filter((s) => s.status === "revised").length,
      },
      totalOpeningBalance: statements.reduce((sum, s) => sum + (s.openingBalance || 0), 0),
      totalPeriodNet: statements.reduce((sum, s) => sum + (s.periodNet || 0), 0),
      totalClosingBalance: statements.reduce((sum, s) => sum + (s.closingBalance || 0), 0),
      latestStatement: statements.sort((a, b) => 
        new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime()
      )[0] || null,
    };

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  createDraft,
  approve,
  getStatement,
  listStatementsForLandlord,
  createStatementRevision,
  markAsSent,
  deleteDraft,
  validateAudit,
  generatePdf,
  getStatementSummary,
};