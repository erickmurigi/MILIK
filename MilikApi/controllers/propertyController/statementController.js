import LandlordStatement from "../../models/LandlordStatement.js";
import LandlordStatementLine from "../../models/LandlordStatementLine.js";
import Property from "../../models/Property.js";
import ProcessedStatement from "../../models/ProcessedStatement.js";
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

const canSupersedeReversedApprovedStatement = async ({ businessId, statementId }) => {
  if (!statementId || !businessId) return false;

  const hasActiveProcessedSnapshot = await ProcessedStatement.exists({
    business: businessId,
    sourceStatement: statementId,
    status: { $ne: "reversed" },
  });

  if (hasActiveProcessedSnapshot) return false;

  const hasReversedProcessedSnapshot = await ProcessedStatement.exists({
    business: businessId,
    status: "reversed",
    $or: [
      { reversedSourceStatement: statementId },
      { sourceStatement: statementId },
    ],
  });

  return Boolean(hasReversedProcessedSnapshot);
};

const markSupersededApprovedStatementRevised = async ({ statementId, replacementStatementId }) => {
  if (!statementId || !replacementStatementId) return;

  await LandlordStatement.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(statementId)) },
    {
      $set: {
        status: "revised",
        supersededByStatementId: new mongoose.Types.ObjectId(String(replacementStatementId)),
        revisionReason: "Superseded after reversing the processed statement for the same period.",
        updatedAt: new Date(),
      },
    }
  );
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
    const requestedCutoffAtRaw = req.body?.cutoffAt || req.body?.statementEndAt || null;
    const requestedCutoffAt = requestedCutoffAtRaw ? new Date(requestedCutoffAtRaw) : null;
    const hasExplicitCutoffAt = requestedCutoffAt && !Number.isNaN(requestedCutoffAt.getTime());
    const periodStartStart = startOfDay(periodStart);
    const periodStartEnd = endOfDay(periodStart);
    const periodEndStart = startOfDay(periodEnd);
    const periodEndEnd = endOfDay(periodEnd);

    // Always regenerate the current workspace from live data instead of reopening a stale draft snapshot.
    const existingDrafts = await LandlordStatement.find({
      business: businessId,
      property: propertyId,
      landlord: landlordId,
      status: "draft",
      ...(periodStartStart && periodStartEnd
        ? { periodStart: { $gte: periodStartStart, $lte: periodStartEnd } }
        : {}),
      ...(hasExplicitCutoffAt
        ? { periodEnd: requestedCutoffAt }
        : periodEndStart && periodEndEnd
        ? { periodEnd: { $gte: periodEndStart, $lte: periodEndEnd } }
        : {}),
    }).sort({ createdAt: -1, _id: -1 }).limit(10).lean();

    const existingDraft = existingDrafts[0] || null;

    if (existingDraft) {
      const duplicateDraftIds = existingDrafts
        .slice(1)
        .map((item) => item?._id)
        .filter(Boolean);

      if (duplicateDraftIds.length > 0) {
        await LandlordStatementLine.deleteMany({ statement: { $in: duplicateDraftIds }, business: businessId });
        await LandlordStatement.deleteMany({ _id: { $in: duplicateDraftIds }, business: businessId, status: "draft" });
      }

      const result = await refreshDraftStatement(
        existingDraft._id,
        userId,
        notes || "",
        statementType,
        hasExplicitCutoffAt ? requestedCutoffAt : null,
        periodEnd
      );

      const [lines, refreshedStatement] = await Promise.all([
        LandlordStatementLine.find({ statement: existingDraft._id }).sort({ lineNumber: 1 }).lean(),
        LandlordStatement.findById(existingDraft._id).lean(),
      ]);

      return res.status(200).json({
        success: true,
        message: refreshRequested
          ? "Draft statement regenerated successfully"
          : "Draft statement refreshed from current transactions",
        data: {
          statement: refreshedStatement || result.statement,
          lines,
          lineCount: lines.length,
          isExisting: true,
          refreshed: true,
        },
      });
    }

    // Create new draft — if an approved statement already covers this exact period
    // and its processed statement was reversed, automatically create a revision so the
    // user doesn't have to manually navigate to "Create Revision".
    let result;
    try {
      result = await createDraftStatement({
        businessId,
        propertyId,
        landlordId,
        statementPeriodStart: periodStart,
        statementPeriodEnd: periodEnd,
        cutoffAt: hasExplicitCutoffAt ? requestedCutoffAt : null,
        statementType,
        userId,
        notes: notes || "",
      });
    } catch (draftErr) {
      if (draftErr?.code === "APPROVED_STATEMENT_EXISTS" && draftErr?.existingStatementId) {
        // Simpler check: no active PS directly linked to this approved statement AND it hasn't
        // already been superseded by a revision. This avoids the strict reversedSourceStatement
        // linkage requirement that fails when intermediate PSs were created for different statements.
        const [hasActivePS, isAlreadySuperseded, existingRevisionDraft] = await Promise.all([
          ProcessedStatement.exists({
            business: businessId,
            sourceStatement: draftErr.existingStatementId,
            status: { $ne: "reversed" },
          }),
          LandlordStatement.exists({
            _id: draftErr.existingStatementId,
            supersededByStatementId: { $exists: true, $ne: null },
          }),
          LandlordStatement.findOne({
            business: businessId,
            property: propertyId,
            landlord: landlordId,
            supersedesStatementId: draftErr.existingStatementId,
            status: "draft",
          })
            .sort({ version: -1, createdAt: -1 })
            .lean(),
        ]);
        const canAutoRevise = !hasActivePS && !isAlreadySuperseded;
        if (canAutoRevise) {

          let revisionStatementId;

          if (existingRevisionDraft) {
            revisionStatementId = String(existingRevisionDraft._id);
          } else {
            const revisionResult = await createRevision(
              draftErr.existingStatementId,
              userId,
              "Auto-revision: processed statement was reversed — regenerating for the same period."
            );
            emitToCompany(businessId, "statement:revised", {
              originalStatementId: revisionResult.originalStatement._id,
              newStatementId: revisionResult.statement._id,
              landlordId,
              propertyId,
            });
            revisionStatementId = String(revisionResult.statement._id);
          }

          const full = await getStatementById(revisionStatementId, {
            includeLines: true,
            populateRefs: true,
          });
          return res.status(201).json({
            success: true,
            message:
              "The previous processed statement was reversed, so a revision draft has been loaded for this period. Review and approve when ready.",
            data: {
              statement: full.statement,
              lines: full.lines || [],
              lineCount: full.lines.length,
              isExisting: Boolean(existingRevisionDraft),
              isRevision: true,
            },
          });
        }
      }
      throw draftErr;
    }

    emitToCompany(businessId, "statement:created", {
      statementId: result.statement._id,
      landlordId,
      propertyId,
    });

    // Return full data (statement + lines) so the client does not need a second getStatement call.
    const full = await getStatementById(String(result.statement._id), {
      includeLines: true,
      populateRefs: true,
    });

    res.status(201).json({
      success: true,
      message: "Draft statement created successfully",
      data: {
        statement: full.statement || result.statement,
        lines: full.lines || [],
        lineCount: full.lines?.length ?? result.lineCount,
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

    // Safeguard: Prevent multiple approved statements for the same period.
    // Exception: if the older approved snapshot only exists because its processed statement was later reversed,
    // allow a fresh approval for the regenerated replacement statement.
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
      // Allow if this draft explicitly supersedes the blocking approved statement (it IS the revision).
      // Also allow when no active PS is linked and the statement hasn't already been superseded —
      // same relaxed check as createDraft's canAutoRevise path.
      const isExplicitRevision =
        statement.supersedesStatementId &&
        String(statement.supersedesStatementId) === String(existingApproved._id);

      if (!isExplicitRevision) {
        const [hasActivePS, isAlreadySuperseded] = await Promise.all([
          ProcessedStatement.exists({
            business: businessId,
            sourceStatement: existingApproved._id,
            status: { $ne: "reversed" },
          }),
          LandlordStatement.exists({
            _id: existingApproved._id,
            supersededByStatementId: { $exists: true, $ne: null },
          }),
        ]);

        if (hasActivePS || isAlreadySuperseded) {
          return res.status(400).json({
            success: false,
            message: `An approved statement already exists for this period (${existingApproved.statementNumber}). Please create a revision instead.`,
            data: {
              existingStatementId: existingApproved._id,
              existingStatementNumber: existingApproved.statementNumber,
            },
          });
        }
      }

      await markSupersededApprovedStatementRevised({
        statementId: existingApproved._id,
        replacementStatementId: statementId,
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
    const [statements, total] = await Promise.all([
      LandlordStatement.find(filter)
        .sort({ periodStart: -1, version: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("property", "name propertyName address city")
        .populate("landlord", "landlordName landlordType email phoneNumber")
        .populate("approvedBy", "surname otherNames email")
        .lean(),
      LandlordStatement.countDocuments(filter),
    ]);

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
 * Admin backdoor: force-mark an approved statement as "revised" so it stops blocking
 * new approvals for the same period. Use only to fix data errors (e.g. orphaned approved
 * statement with no processed statement). Optionally links a replacement draft via body.replacementStatementId.
 */
export const adminMarkRevised = async (req, res, next) => {
  try {
    const { statementId } = req.params;
    const { replacementStatementId, reason } = req.body || {};

    if (!isValidObjectId(statementId)) {
      return res.status(400).json({ success: false, message: "Invalid statementId" });
    }

    const statement = await LandlordStatement.findById(statementId)
      .select("_id statementNumber status business property landlord periodStart periodEnd")
      .lean();

    if (!statement) {
      return res.status(404).json({ success: false, message: "Statement not found" });
    }

    if (statement.status === "revised") {
      return res.status(200).json({ success: true, message: "Statement is already marked as revised", statementNumber: statement.statementNumber });
    }

    if (!["approved", "sent", "draft"].includes(statement.status)) {
      return res.status(400).json({ success: false, message: `Cannot mark a ${statement.status} statement as revised` });
    }

    const $set = {
      status: "revised",
      revisionReason: reason || "Admin force-marked as revised to correct data error",
    };

    if (replacementStatementId && isValidObjectId(replacementStatementId)) {
      $set.supersededByStatementId = new mongoose.Types.ObjectId(String(replacementStatementId));
    }

    await LandlordStatement.findByIdAndUpdate(statement._id, { $set });

    return res.status(200).json({
      success: true,
      message: `Statement ${statement.statementNumber} has been force-marked as revised. The pending revision draft can now be approved.`,
      statementNumber: statement.statementNumber,
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
    const [referencedAsSupersedes, referencedAsOriginal] = await Promise.all([
      LandlordStatement.findOne({ business: businessId, supersededByStatementId: statementId }).lean(),
      LandlordStatement.findOne({ business: businessId, supersedesStatementId: statementId }).lean(),
    ]);

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

    const [aggResult, latestStatement] = await Promise.all([
      LandlordStatement.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
            reviewed: { $sum: { $cond: [{ $eq: ["$status", "reviewed"] }, 1, 0] } },
            approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
            sent: { $sum: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
            revised: { $sum: { $cond: [{ $eq: ["$status", "revised"] }, 1, 0] } },
            totalOpeningBalance: { $sum: { $ifNull: ["$openingBalance", 0] } },
            totalPeriodNet: { $sum: { $ifNull: ["$periodNet", 0] } },
            totalClosingBalance: { $sum: { $ifNull: ["$closingBalance", 0] } },
          },
        },
      ]),
      LandlordStatement.findOne(filter)
        .sort({ periodStart: -1 })
        .select("_id statementNumber status periodStart periodEnd landlord property version")
        .lean(),
    ]);

    const agg = aggResult[0] || {};
    const summary = {
      total: agg.total || 0,
      byStatus: {
        draft: agg.draft || 0,
        reviewed: agg.reviewed || 0,
        approved: agg.approved || 0,
        sent: agg.sent || 0,
        revised: agg.revised || 0,
      },
      totalOpeningBalance: agg.totalOpeningBalance || 0,
      totalPeriodNet: agg.totalPeriodNet || 0,
      totalClosingBalance: agg.totalClosingBalance || 0,
      latestStatement: latestStatement || null,
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