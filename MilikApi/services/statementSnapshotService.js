import mongoose from "mongoose";
import LandlordStatement from "../models/LandlordStatement.js";
import LandlordStatementLine from "../models/LandlordStatementLine.js";
import { generateLandlordStatement } from "./landlordStatementService.js";

/**
 * Helper: Generate unique statement number
 * Format: STMT-YYYYMM-XXXXX
 */
const generateStatementNumber = async (businessId, periodStart) => {
  const date = new Date(periodStart);
  const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `STMT-${yearMonth}`;

  // Find highest sequence number for this period
  const lastStatement = await LandlordStatement.findOne(
    {
      business: businessId,
      statementNumber: { $regex: `^${prefix}-` },
    },
    { statementNumber: 1 }
  ).sort({ createdAt: -1 });

  let sequence = 1;
  if (lastStatement?.statementNumber) {
    const match = lastStatement.statementNumber.match(/-(\d+)$/);
    if (match) {
      sequence = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}-${String(sequence).padStart(5, "0")}`;
};

/**
 * Create a draft statement from ledger data.
 * Statement remains mutable until approved.
 *
 * @param {Object} params - Statement creation parameters
 * @param {string} params.businessId - Business ID
 * @param {string} params.propertyId - Property ID
 * @param {string} params.landlordId - Landlord ID
 * @param {Date|string} params.statementPeriodStart - Period start
 * @param {Date|string} params.statementPeriodEnd - Period end
 * @param {string} params.userId - User creating the statement
 * @param {string} params.notes - Optional notes
 *
 * @returns {Promise<Object>} Created statement with { statement, lineCount }
 */
export const createDraftStatement = async ({
  businessId,
  propertyId,
  landlordId,
  statementPeriodStart,
  statementPeriodEnd,
  statementType = "provisional",
  userId,
  notes = "",
}) => {
  if (!businessId || !propertyId || !landlordId || !statementPeriodStart || !statementPeriodEnd || !userId) {
    throw new Error("createDraftStatement requires businessId, propertyId, landlordId, period dates, and userId");
  }

  // Step 1: Generate statement data from ledger
  const statementData = await generateLandlordStatement({
    propertyId,
    landlordId,
    statementPeriodStart,
    statementPeriodEnd,
  });

  // Step 2: Generate statement number
  const statementNumber = await generateStatementNumber(businessId, statementPeriodStart);

  // Step 3: Check for existing draft for same period/landlord
  const existingDraft = await LandlordStatement.findOne({
    business: businessId,
    property: propertyId,
    landlord: landlordId,
    periodStart: statementData.periodStart,
    periodEnd: statementData.periodEnd,
    status: "draft",
  });

  if (existingDraft) {
    return {
      statement: existingDraft,
      lineCount: Number(existingDraft.lineCount || 0),
      isExisting: true,
    };
  }

  // Step 4: Create statement header
  const statement = await LandlordStatement.create({
    business: businessId,
    property: propertyId,
    landlord: landlordId,
    periodStart: statementData.periodStart,
    periodEnd: statementData.periodEnd,
    statementNumber,
    version: 1,
    status: "draft",
    openingBalance: statementData.openingBalance,
    periodNet: statementData.periodNet,
    closingBalance: statementData.closingBalance,
    currency: statementData.currency,
    totalsByCategory: statementData.totalsByCategory,
    entryCount: statementData.entries.length,
    lineCount: statementData.entries.length,
    ledgerEntryCount: statementData.entries.length,
    ledgerEntryIds: statementData.entries.map((entry) => entry._id),
    generatedAt: new Date(),
    notes: notes || "",
    metadata: {
      generatedBy: userId,
      entryCount: statementData.entries.length,
      statementType,
      workspace: {
        ...(statementData.metadata || {}),
        statementType,
      },
    },
  });

  // Step 5: Create statement lines (not yet frozen, can be regenerated)
  // Lines are only frozen when statement is approved
  const lines = [];
  let runningBalance = statementData.openingBalance;

  for (let i = 0; i < statementData.entries.length; i++) {
    const entry = statementData.entries[i];
    const signedAmount = entry.direction === "debit" ? -Math.abs(entry.amount) : Math.abs(entry.amount);
    runningBalance += signedAmount;

    lines.push({
      statement: statement._id,
      business: businessId,
      property: propertyId,
      landlord: landlordId,
      tenant: entry.tenant || null,
      unit: entry.unit || null,
      transactionDate: entry.transactionDate,
      category: entry.category,
      description: entry.notes || entry.description || `${entry.category} entry`,
      amount: Math.abs(entry.amount),
      direction: entry.direction,
      runningBalance,
      sourceLedgerEntryId: entry._id,
      sourceTransactionType: entry.sourceTransactionType || null,
      sourceTransactionId: entry.sourceTransactionId || null,
      lineNumber: i + 1,
      metadata: entry.metadata || {},
    });
  }

  if (lines.length > 0) {
    await LandlordStatementLine.insertMany(lines);
  }

  return {
    statement,
    lineCount: lines.length,
  };
};

/**
 * Refresh an existing draft statement from current ledger entries.
 * Used when users regenerate draft after new invoices/receipts are posted.
 *
 * @param {string} statementId - Draft statement ID
 * @param {string} userId - User refreshing the draft
 * @param {string} notes - Optional notes override
 *
 * @returns {Promise<Object>} Refreshed draft with latest lines
 */
export const refreshDraftStatement = async (statementId, userId, notes = "", statementType = null) => {
  if (!statementId || !userId) {
    throw new Error("refreshDraftStatement requires statementId and userId");
  }

  const draft = await LandlordStatement.findById(statementId);
  if (!draft) {
    throw new Error("Draft statement not found");
  }

  if (draft.status !== "draft") {
    throw new Error("Only draft statements can be refreshed");
  }

  const resolvedStatementType =
    statementType || draft?.metadata?.statementType || draft?.metadata?.workspace?.statementType || "provisional";

  const statementData = await generateLandlordStatement({
    propertyId: draft.property,
    landlordId: draft.landlord,
    statementPeriodStart: draft.periodStart,
    statementPeriodEnd: draft.periodEnd,
  });

  // Replace all existing draft lines with refreshed lines.
  await LandlordStatementLine.deleteMany({ statement: draft._id });

  const lines = [];
  let runningBalance = statementData.openingBalance;

  for (let i = 0; i < statementData.entries.length; i++) {
    const entry = statementData.entries[i];
    const signedAmount = entry.direction === "debit" ? -Math.abs(entry.amount) : Math.abs(entry.amount);
    runningBalance += signedAmount;

    lines.push({
      statement: draft._id,
      business: draft.business,
      property: draft.property,
      landlord: draft.landlord,
      tenant: entry.tenant || null,
      unit: entry.unit || null,
      transactionDate: entry.transactionDate,
      category: entry.category,
      description: entry.notes || entry.description || `${entry.category} entry`,
      amount: Math.abs(entry.amount),
      direction: entry.direction,
      runningBalance,
      sourceLedgerEntryId: entry._id,
      sourceTransactionType: entry.sourceTransactionType || null,
      sourceTransactionId: entry.sourceTransactionId || null,
      lineNumber: i + 1,
      metadata: entry.metadata || {},
    });
  }

  if (lines.length > 0) {
    await LandlordStatementLine.insertMany(lines);
  }

  draft.openingBalance = statementData.openingBalance;
  draft.periodNet = statementData.periodNet;
  draft.closingBalance = statementData.closingBalance;
  draft.currency = statementData.currency;
  draft.totalsByCategory = statementData.totalsByCategory;
  draft.entryCount = statementData.entries.length;
  draft.lineCount = statementData.entries.length;
  draft.ledgerEntryCount = statementData.entries.length;
  draft.ledgerEntryIds = statementData.entries.map((entry) => entry._id);
  draft.generatedAt = new Date();
  if (notes) {
    draft.notes = notes;
  }
  draft.metadata = {
    ...(draft.metadata || {}),
    refreshedBy: userId,
    refreshedAt: new Date(),
    entryCount: statementData.entries.length,
    statementType: resolvedStatementType,
    workspace: {
      ...(statementData.metadata || {}),
      statementType: resolvedStatementType,
    },
  };

  await draft.save();

  return {
    statement: draft,
    lineCount: lines.length,
  };
};

/**
 * Approve a draft statement, freezing it as immutable.
 * Once approved, the statement and its lines cannot be modified.
 *
 * @param {string} statementId - Statement ID to approve
 * @param {string} userId - User approving the statement
 * @param {string} approvalNotes - Optional approval notes
 *
 * @returns {Promise<Object>} Approved statement with lines
 */
export const approveStatement = async (statementId, userId, approvalNotes = "") => {
  if (!statementId || !userId) {
    throw new Error("approveStatement requires statementId and userId");
  }

  const statement = await LandlordStatement.findById(statementId);
  if (!statement) {
    throw new Error("Statement not found");
  }

  if (statement.status === "approved" || statement.status === "sent") {
    throw new Error("Statement is already approved or sent");
  }

  if (statement.status === "revised") {
    throw new Error("Revised statements cannot be approved. Use the superseding statement instead.");
  }

  // Update statement status to approved
  statement.status = "approved";
  statement.approvedAt = new Date();
  statement.approvedBy = mongoose.Types.ObjectId.isValid(String(userId || "")) ? userId : null;
  if (approvalNotes) {
    statement.notes = statement.notes ? `${statement.notes}\n\nApproval: ${approvalNotes}` : approvalNotes;
  }
  await statement.save();

  // Lines are now frozen (immutable via pre-save hooks)
  const lines = await LandlordStatementLine.find({ statement: statementId }).sort({ lineNumber: 1 }).lean();

  return {
    statement,
    lines,
  };
};

/**
 * Get a statement by ID with its lines.
 *
 * @param {string} statementId - Statement ID
 * @param {Object} options - Query options
 * @param {boolean} options.includeLines - Include statement lines (default: true)
 * @param {boolean} options.populateRefs - Populate landlord/property references (default: false)
 *
 * @returns {Promise<Object>} Statement with optional lines
 */
export const getStatementById = async (statementId, options = {}) => {
  const { includeLines = true, populateRefs = false } = options;

  if (!statementId) {
    throw new Error("statementId is required");
  }

  let query = LandlordStatement.findById(statementId);

  if (populateRefs) {
    query = query
      .populate("property", "name propertyName address city commissionPercentage commissionRecognitionBasis")
      .populate("landlord", "landlordName landlordType email phoneNumber")
      .populate("approvedBy", "surname otherNames email")
      .populate("sentBy", "surname otherNames email");
  }

  const statement = await query.lean();
  if (!statement) {
    throw new Error("Statement not found");
  }

  if (!includeLines) {
    return { statement, lines: [] };
  }

  // Always sort lines by lineNumber ASC for deterministic rendering
  const lines = await LandlordStatementLine.find({ statement: statementId })
    .populate("tenant", "name paymentMethod phone idNumber")
    .populate("unit", "unitNumber name")
    .sort({ lineNumber: 1 })
    .lean();

  return {
    statement,
    lines,
  };
};

/**
 * Create a revision of an existing statement.
 * Marks the original as "revised" and creates a new version with incremented version number.
 *
 * @param {string} originalStatementId - ID of statement to revise
 * @param {string} userId - User creating the revision
 * @param {string} revisionReason - Reason for revision
 * @param {Object} overrides - Optional field overrides for the new statement
 *
 * @returns {Promise<Object>} New statement version with lines
 */
export const createRevision = async (originalStatementId, userId, revisionReason, overrides = {}) => {
  if (!originalStatementId || !userId || !revisionReason) {
    throw new Error("createRevision requires originalStatementId, userId, and revisionReason");
  }

  const originalStatement = await LandlordStatement.findById(originalStatementId);
  if (!originalStatement) {
    throw new Error("Original statement not found");
  }

  if (originalStatement.status !== "approved" && originalStatement.status !== "sent") {
    throw new Error("Only approved or sent statements can be revised. Drafts can be edited directly.");
  }

  if (originalStatement.supersededByStatementId) {
    throw new Error("This statement has already been superseded by a newer version.");
  }

  // Regenerate statement from current ledger data
  const statementData = await generateLandlordStatement({
    propertyId: originalStatement.property,
    landlordId: originalStatement.landlord,
    statementPeriodStart: originalStatement.periodStart,
    statementPeriodEnd: originalStatement.periodEnd,
  });

  // Create new statement version
  const newVersion = originalStatement.version + 1;
  const newStatementNumber = `${originalStatement.statementNumber}-R${newVersion}`;

  const revisedStatement = await LandlordStatement.create({
    business: originalStatement.business,
    property: originalStatement.property,
    landlord: originalStatement.landlord,
    periodStart: originalStatement.periodStart,
    periodEnd: originalStatement.periodEnd,
    statementNumber: newStatementNumber,
    version: newVersion,
    status: "draft",
    openingBalance: statementData.openingBalance,
    periodNet: statementData.periodNet,
    closingBalance: statementData.closingBalance,
    currency: statementData.currency,
    totalsByCategory: statementData.totalsByCategory,
    entryCount: statementData.entries.length,
    lineCount: statementData.entries.length,
    ledgerEntryCount: statementData.entries.length,
    ledgerEntryIds: statementData.entries.map((entry) => entry._id),
    generatedAt: new Date(),
    supersedesStatementId: originalStatement._id,
    revisionReason,
    notes: `Revision of ${originalStatement.statementNumber}. Reason: ${revisionReason}`,
    metadata: {
      generatedBy: userId,
      entryCount: statementData.entries.length,
      originalStatementId: String(originalStatement._id),
      originalVersion: originalStatement.version,
      ...overrides.metadata,
    },
    ...overrides,
  });

  // Create new lines
  const lines = [];
  let runningBalance = statementData.openingBalance;

  for (let i = 0; i < statementData.entries.length; i++) {
    const entry = statementData.entries[i];
    const signedAmount = entry.direction === "debit" ? -Math.abs(entry.amount) : Math.abs(entry.amount);
    runningBalance += signedAmount;

    lines.push({
      statement: revisedStatement._id,
      business: originalStatement.business,
      property: originalStatement.property,
      landlord: originalStatement.landlord,
      tenant: entry.tenant || null,
      unit: entry.unit || null,
      transactionDate: entry.transactionDate,
      category: entry.category,
      description: entry.notes || entry.description || `${entry.category} entry`,
      amount: Math.abs(entry.amount),
      direction: entry.direction,
      runningBalance,
      sourceLedgerEntryId: entry._id,
      sourceTransactionType: entry.sourceTransactionType || null,
      sourceTransactionId: entry.sourceTransactionId || null,
      lineNumber: i + 1,
      metadata: entry.metadata || {},
    });
  }

  if (lines.length > 0) {
    await LandlordStatementLine.insertMany(lines);
  }

  // Mark original as revised
  originalStatement.status = "revised";
  originalStatement.supersededByStatementId = revisedStatement._id;
  await originalStatement.save();

  return {
    statement: revisedStatement,
    lineCount: lines.length,
    originalStatement,
  };
};

/**
 * Validate statement audit protection fields against actual lines.
 * Verifies that header counts match the frozen line records.
 *
 * @param {string} statementId - Statement ID to validate
 * @returns {Promise<Object>} Validation result with any discrepancies
 */
export const validateStatementAudit = async (statementId) => {
  if (!statementId) {
    throw new Error("statementId is required");
  }

  const statement = await LandlordStatement.findById(statementId).lean();
  if (!statement) {
    throw new Error("Statement not found");
  }

  const lines = await LandlordStatementLine.find({ statement: statementId }).lean();
  const actualLineCount = lines.length;

  const errors = [];

  // Validate lineCount matches actual lines
  if (statement.lineCount !== actualLineCount) {
    errors.push({
      field: "lineCount",
      expected: actualLineCount,
      actual: statement.lineCount,
      message: `Header lineCount (${statement.lineCount}) does not match actual line count (${actualLineCount})`,
    });
  }

  // Validate entryCount matches lineCount (should be same)
  if (statement.entryCount !== actualLineCount) {
    errors.push({
      field: "entryCount",
      expected: actualLineCount,
      actual: statement.entryCount,
      message: `Header entryCount (${statement.entryCount}) does not match actual line count (${actualLineCount})`,
    });
  }

  // Validate ledgerEntryCount
  if (statement.ledgerEntryCount !== actualLineCount) {
    errors.push({
      field: "ledgerEntryCount",
      expected: actualLineCount,
      actual: statement.ledgerEntryCount,
      message: `Header ledgerEntryCount (${statement.ledgerEntryCount}) does not match actual line count (${actualLineCount})`,
    });
  }

  // Validate ledgerEntryIds length
  const ledgerIdCount = Array.isArray(statement.ledgerEntryIds) ? statement.ledgerEntryIds.length : 0;
  if (ledgerIdCount !== actualLineCount) {
    errors.push({
      field: "ledgerEntryIds",
      expected: actualLineCount,
      actual: ledgerIdCount,
      message: `Header ledgerEntryIds length (${ledgerIdCount}) does not match actual line count (${actualLineCount})`,
    });
  }

  // Validate running balance calculation
  const lastLine = lines.sort((a, b) => a.lineNumber - b.lineNumber)[lines.length - 1];
  if (lastLine && Math.abs(lastLine.runningBalance - statement.closingBalance) > 0.01) {
    errors.push({
      field: "closingBalance",
      expected: lastLine.runningBalance,
      actual: statement.closingBalance,
      message: `Header closingBalance (${statement.closingBalance}) does not match last line runningBalance (${lastLine.runningBalance})`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    counts: {
      headerLineCount: statement.lineCount,
      headerEntryCount: statement.entryCount,
      headerLedgerEntryCount: statement.ledgerEntryCount,
      headerLedgerEntryIds: ledgerIdCount,
      actualLines: actualLineCount,
    },
    statement: {
      id: statement._id,
      statementNumber: statement.statementNumber,
      version: statement.version,
      status: statement.status,
    },
  };
};

export default {
  createDraftStatement,
  refreshDraftStatement,
  approveStatement,
  getStatementById,
  createRevision,
  validateStatementAudit,
};
