import mongoose from "mongoose";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import Landlord from "../models/Landlord.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import ExpenseProperty from "../models/ExpenseProperty.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import TenantInvoiceNote from "../models/TenantInvoiceNote.js";
import ProcessedStatement from "../models/ProcessedStatement.js";
// Not queried directly in this file, but MUST stay imported: resolveEffectiveStatementWindow
// below populates ProcessedStatement.sourceStatement (ref: "LandlordStatement"), and Mongoose
// needs the model registered in-process for that populate to resolve — it won't discover the
// schema from the ref string alone.
import LandlordStatement from "../models/LandlordStatement.js"; // eslint-disable-line no-unused-vars
import LandlordStatementTenantBalance from "../models/LandlordStatementTenantBalance.js";
import CompanySettings from "../models/CompanySettings.js";
import Company from "../models/Company.js";
import { isSelfManagingLandlordCompany } from "../utils/companyModules.js";
import { buildCommissionTaxSnapshot, getCompanyTaxConfiguration } from "./taxCalculationService.js";

const round2 = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const startOfDay = (value) => {
  const d = toDate(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (value) => {
  const d = toDate(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

const formatStatementPeriodDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const buildStatementPeriodLabel = (start, end) => {
  const startLabel = formatStatementPeriodDate(start);
  const endLabel = formatStatementPeriodDate(end);
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  return startLabel || endLabel || "";
};

const oid = (value) =>
  typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : value;

const isValidObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId ||
  (typeof value === "string" && mongoose.Types.ObjectId.isValid(value));

const getEntityId = (value) => {
  if (!value) return "";

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === "string" || typeof value === "number") return String(value);

  if (typeof value === "object") {
    if (typeof value.toHexString === "function") {
      try {
        return value.toHexString();
      } catch {
        // fall through to nested id extraction
      }
    }

    if (value._id && value._id !== value) return getEntityId(value._id);
    if (value.id && value.id !== value) return getEntityId(value.id);
  }

  return "";
};

const safeName = (value = "") => String(value || "").trim().toLowerCase();

// "on_receipt" recognises a rent-tagged payment in full the moment it lands;
// "on_invoice_allocation" (default) only recognises the part covering rent invoiced
// on-or-before the period end, deferring anything paid ahead of the billing.
const normalizePrepaymentRecognition = (value = "") =>
  String(value || "").trim().toLowerCase() === "on_receipt"
    ? "on_receipt"
    : "on_invoice_allocation";

const normalizeCommissionRecognitionBasis = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "expected" || raw === "accrual" || raw === "invoiced") {
    return "invoiced";
  }
  if (raw === "manager_received" || raw === "received_manager_only") {
    return "received_manager_only";
  }
  if (raw === "received") {
    return "received";
  }
  return raw || "received";
};


const buildInvoiceRecognitionDateQuery = ({ periodStart, periodEnd = null, lowerBound = null }) => {
  const beforePeriodRange = lowerBound
    ? { $gte: lowerBound, $lt: periodStart }
    : { $lt: periodStart };

  const inPeriodRange = periodEnd ? { $gte: periodStart, $lte: periodEnd } : null;

  return {
    $or: [
      periodEnd
        ? { bookingDate: inPeriodRange }
        : { bookingDate: beforePeriodRange },
      {
        $or: [{ bookingDate: { $exists: false } }, { bookingDate: null }],
        invoiceDate: periodEnd ? inPeriodRange : beforePeriodRange,
      },
    ],
  };
};

const getInvoiceRecognitionDate = (invoice = {}) =>
  invoice?.bookingDate || invoice?.invoiceDate || invoice?.createdAt || null;

const getInvoiceStatementDate = (invoice = {}) => getInvoiceRecognitionDate(invoice);

const isSameCalendarDay = (left, right) => {
  const leftDate = left ? new Date(left) : null;
  const rightDate = right ? new Date(right) : null;
  if (!leftDate || !rightDate) return false;
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return false;
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
};

const resolveSameDayRecognitionDate = (datedValue = null, auditValue = null) => {
  const primaryDate = datedValue ? new Date(datedValue) : null;
  const auditDate = auditValue ? new Date(auditValue) : null;

  if (primaryDate && !Number.isNaN(primaryDate.getTime())) {
    if (auditDate && !Number.isNaN(auditDate.getTime()) && isSameCalendarDay(primaryDate, auditDate)) {
      return auditDate.getTime() > primaryDate.getTime() ? auditDate : primaryDate;
    }
    return primaryDate;
  }

  if (auditDate && !Number.isNaN(auditDate.getTime())) return auditDate;
  return null;
};

const getNoteStatementDate = (note = {}) => {
  if (note?.bookingDate) return new Date(note.bookingDate);
  return resolveSameDayRecognitionDate(note?.noteDate || null, note?.createdAt || note?.updatedAt || null);
};

const getReceiptStatementDate = (receipt = {}) => {
  if (receipt?.bookingDate) return new Date(receipt.bookingDate);
  return resolveSameDayRecognitionDate(
    receipt?.paymentDate || null,
    receipt?.confirmedAt || receipt?.recordDate || receipt?.createdAt || null
  );
};

const capDateToNow = (value) => {
  const date = toDate(value);
  const now = new Date();
  return date.getTime() > now.getTime() ? now : date;
};

const getStatementCursor = (statement = {}) => {
  const cursor = statement?.cutoffAt || statement?.closedAt || statement?.periodEnd || null;
  if (!cursor) return null;
  const date = new Date(cursor);
  return Number.isNaN(date.getTime()) ? null : date;
};

const resolveOpeningLandlordSettlementBalance = (statement = null) => {
  if (!statement) return 0;

  const positiveOutstanding = round2(Math.max(Number(statement?.balanceDue || 0), 0));
  const inferredRecoveryOutstanding = Math.max(
    Number(statement?.amountPayableByLandlordToManager || 0) - Number(statement?.amountRecovered || 0),
    0
  );
  const negativeOutstanding = round2(
    Math.max(Number(statement?.recoveryBalance ?? 0), inferredRecoveryOutstanding, 0)
  );

  if (negativeOutstanding > 0) return round2(-negativeOutstanding);
  if (positiveOutstanding > 0) return positiveOutstanding;
  return 0;
};

const resolveEffectiveStatementWindow = async ({
  businessId,
  propertyId,
  landlordId,
  statementPeriodStart,
  statementPeriodEnd,
  cutoffAt = null,
  propertyDateAcquired = null,
}) => {
  if (!isValidObjectId(businessId) || !isValidObjectId(propertyId) || !isValidObjectId(landlordId)) {
    throw new Error("resolveEffectiveStatementWindow requires valid business, property, and landlord ids.");
  }

  const requestedStartAt = startOfDay(statementPeriodStart);
  const requestedEndAt = endOfDay(statementPeriodEnd);

  let effectiveEndAt = capDateToNow(requestedEndAt);
  if (cutoffAt) {
    const explicitCutoff = new Date(cutoffAt);
    if (!Number.isNaN(explicitCutoff.getTime()) && explicitCutoff.getTime() < effectiveEndAt.getTime()) {
      effectiveEndAt = explicitCutoff;
    }
  }

  const priorProcessedStatements = await ProcessedStatement.find({
    business: oid(businessId),
    property: oid(propertyId),
    landlord: oid(landlordId),
    status: { $ne: "reversed" },
    $or: [
      { cutoffAt: { $lt: effectiveEndAt } },
      { cutoffAt: null, periodEnd: { $lt: effectiveEndAt } },
    ],
  })
    .select(
      "_id cutoffAt closedAt periodStart periodEnd balanceDue isNegativeStatement amountPayableByLandlordToManager amountRecovered recoveryBalance status sourceStatement"
    )
    // Populated in the SAME round-trip: the per-tenant balance snapshot (Bal B/F carry-
    // forward) must be sourced from the exact statement this processed cut-off closed —
    // never independently re-queried by "latest approved LandlordStatement", which can
    // drift out of sync with the cut-off that actually governs period continuity (a
    // statement can be Approved without ever being Processed).
    .populate({ path: "sourceStatement", select: "_id periodEnd approvedAt" })
    .sort({ cutoffAt: -1, closedAt: -1, periodEnd: -1 })
    .limit(10)
    .lean();

  const latestProcessedStatement =
    priorProcessedStatements
      .map((item) => ({ item, cursor: getStatementCursor(item) }))
      .filter(({ cursor }) => cursor && cursor.getTime() < effectiveEndAt.getTime())
      .sort((a, b) => b.cursor.getTime() - a.cursor.getTime())[0]?.item || null;

  const previousCutoffAt = getStatementCursor(latestProcessedStatement);
  const propertyAcquiredAt = propertyDateAcquired ? startOfDay(propertyDateAcquired) : null;

  let effectiveStartAt = requestedStartAt;
  if (propertyAcquiredAt && propertyAcquiredAt.getTime() > effectiveStartAt.getTime()) {
    effectiveStartAt = propertyAcquiredAt;
  }
  if (previousCutoffAt && previousCutoffAt.getTime() >= effectiveStartAt.getTime()) {
    effectiveStartAt = new Date(previousCutoffAt.getTime() + 1);
  }

  if (effectiveStartAt.getTime() > effectiveEndAt.getTime()) {
    const err = new Error(
      "This period has already been fully processed. Reverse the processed statement first, then use 'Create Revision' on the approved statement to re-generate it."
    );
    err.statusCode = 409;
    err.code = "PERIOD_ALREADY_PROCESSED";
    err.latestProcessedStatementId = latestProcessedStatement?._id
      ? String(latestProcessedStatement._id)
      : null;
    throw err;
  }

  return {
    requestedStartAt,
    requestedEndAt,
    effectiveStartAt,
    effectiveEndAt,
    previousCutoffAt,
    latestProcessedStatement,
    openingLandlordSettlementBalance: resolveOpeningLandlordSettlementBalance(latestProcessedStatement),
  };
};

const normalizeSectionRow = (item = {}) => {
  const dateValue = item?.date || item?.transactionDate || null;
  const normalizedDate = dateValue ? new Date(dateValue) : null;
  return {
    date:
      normalizedDate && !Number.isNaN(normalizedDate.getTime())
        ? normalizedDate
        : null,
    description: String(item?.description || item?.notes || "").trim(),
    amount: round2(Math.abs(Number(item?.amount || 0))),
    category: String(item?.category || "").trim(),
    sourceId: item?.sourceId ? String(item.sourceId) : "",
  };
};

const makeSectionFingerprint = (item = {}) => {
  const row = normalizeSectionRow(item);
  return [
    row.date ? row.date.toISOString().slice(0, 10) : "",
    safeName(row.description),
    row.amount.toFixed(2),
  ].join("|");
};

const dedupeExpenseRowsAgainstAdditions = ({
  expenseRows = [],
  additionRows = [],
}) => {
  const normalizedAdditions = additionRows
    .map(normalizeSectionRow)
    .filter((row) => row.amount > 0);

  const additionSourceIds = new Set(
    normalizedAdditions.map((row) => row.sourceId).filter(Boolean)
  );
  const additionFingerprints = new Set(
    normalizedAdditions.map((row) => makeSectionFingerprint(row))
  );

  return expenseRows.filter((row) => {
    const normalized = normalizeSectionRow(row);
    if (normalized.amount <= 0) return false;

    if (normalized.sourceId && additionSourceIds.has(normalized.sourceId)) {
      return false;
    }

    if (additionFingerprints.has(makeSectionFingerprint(normalized))) {
      return false;
    }

    return true;
  });
};

const detectUtilityBucket = (text = "", metadata = {}) => {
  const explicitType = safeName(
    metadata?.utilityType ||
      metadata?.meterUtilityType ||
      metadata?.statementUtilityType ||
      metadata?.utilityName ||
      metadata?.utility ||
      metadata?.name ||
      ""
  );
  if (/water/.test(explicitType)) return "water";
  if (/garbage|refuse|trash|waste/.test(explicitType)) return "garbage";

  const name = safeName(text);
  if (/water/.test(name)) return "water";
  if (/garbage|refuse|trash|waste/.test(name)) return "garbage";
  return "";
};

const listUtilityNames = (row) => [
  ...(Array.isArray(row?.unitUtilities) ? row.unitUtilities : []),
  ...(Array.isArray(row?.tenantUtilities) ? row.tenantUtilities : []),
]
  .map((u) => safeName(u?.utility || u?.utilityLabel || u?.name || u))
  .filter(Boolean);

const titleCase = (value = "") =>
  String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeUtilityKey = (value = "") => {
  const normalized = safeName(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "other_utility";
};

const defaultUtilityLabel = "Other Utility";

const ensureUtilityMap = (row = {}) => {
  if (!row.utilities || typeof row.utilities !== "object" || Array.isArray(row.utilities)) {
    row.utilities = {};
  }
  return row.utilities;
};

const registerUtilityAmount = (row, utilityKey, utilityLabel, phase, amount) => {
  const utilities = ensureUtilityMap(row);
  const key = normalizeUtilityKey(utilityKey || utilityLabel);
  const label =
    titleCase(utilityLabel || key.replace(/_/g, " ")) || defaultUtilityLabel;

  if (!utilities[key]) {
    utilities[key] = {
      key,
      label,
      invoiced: 0,
      paid: 0,
    };
  }

  if (phase === "invoice") {
    utilities[key].invoiced = round2(
      Number(utilities[key].invoiced || 0) + Number(amount || 0)
    );
  } else {
    utilities[key].paid = round2(
      Number(utilities[key].paid || 0) + Number(amount || 0)
    );
  }

  const legacyField =
    phase === "invoice"
      ? key === "water"
        ? "invoicedWater"
        : key === "garbage"
        ? "invoicedGarbage"
        : ""
      : key === "water"
      ? "paidWater"
      : key === "garbage"
      ? "paidGarbage"
      : "";

  if (legacyField) {
    row[legacyField] = round2(Number(row[legacyField] || 0) + Number(amount || 0));
  }
};

const matchConfiguredUtilityName = (row, text = "") => {
  const normalizedText = safeName(text);
  if (!normalizedText) return "";

  return listUtilityNames(row).find(
    (name) => normalizedText.includes(name) || name.includes(normalizedText)
  );
};

const getSoleConfiguredUtilityName = (row = null) => {
  const uniqueNames = Array.from(new Set(listUtilityNames(row).filter(Boolean)));
  return uniqueNames.length === 1 ? uniqueNames[0] : "";
};

const resolveUtilityIdentity = (text = "", metadata = {}, row = null) => {
  const explicitLabel =
    metadata?.utilityType ||
    metadata?.meterUtilityType ||
    metadata?.statementUtilityType ||
    metadata?.utilityName ||
    metadata?.utility ||
    metadata?.name ||
    "";

  if (safeName(explicitLabel)) {
    return {
      key: normalizeUtilityKey(explicitLabel),
      label: titleCase(explicitLabel) || defaultUtilityLabel,
    };
  }

  const configuredMatch = row ? matchConfiguredUtilityName(row, text) : "";
  if (configuredMatch) {
    return {
      key: normalizeUtilityKey(configuredMatch),
      label: titleCase(configuredMatch) || defaultUtilityLabel,
    };
  }

  const soleConfiguredUtility = row ? getSoleConfiguredUtilityName(row) : "";
  if (soleConfiguredUtility) {
    return {
      key: normalizeUtilityKey(soleConfiguredUtility),
      label: titleCase(soleConfiguredUtility) || defaultUtilityLabel,
    };
  }

  const detectedBucket = detectUtilityBucket(text, metadata);
  if (detectedBucket === "water") {
    return { key: "water", label: "Water" };
  }

  if (detectedBucket === "garbage") {
    return { key: "garbage", label: "Garbage" };
  }

  return { key: "other_utility", label: defaultUtilityLabel };
};

const mergeNoteUtilityMetadata = (note = {}) => {
  const noteMetadata = note?.metadata && typeof note.metadata === "object" ? note.metadata : {};
  const sourceInvoiceMetadata =
    note?.sourceInvoice?.metadata && typeof note.sourceInvoice.metadata === "object"
      ? note.sourceInvoice.metadata
      : {};

  return {
    ...sourceInvoiceMetadata,
    ...noteMetadata,
    utilityType:
      noteMetadata?.utilityType ||
      noteMetadata?.meterUtilityType ||
      noteMetadata?.statementUtilityType ||
      sourceInvoiceMetadata?.utilityType ||
      sourceInvoiceMetadata?.meterUtilityType ||
      sourceInvoiceMetadata?.statementUtilityType ||
      sourceInvoiceMetadata?.utilityName ||
      sourceInvoiceMetadata?.utility ||
      noteMetadata?.utilityName ||
      noteMetadata?.utility ||
      "",
    meterUtilityType:
      noteMetadata?.meterUtilityType ||
      sourceInvoiceMetadata?.meterUtilityType ||
      noteMetadata?.utilityType ||
      sourceInvoiceMetadata?.utilityType ||
      "",
    statementUtilityType:
      noteMetadata?.statementUtilityType ||
      sourceInvoiceMetadata?.statementUtilityType ||
      noteMetadata?.utilityType ||
      sourceInvoiceMetadata?.utilityType ||
      "",
  };
};

const getCombinedUtilityBreakdown = (metadata = {}) => {
  const normalizedBillItemKey = safeName(metadata?.billItemKey || "");
  if (normalizedBillItemKey !== "rent_utility:combined") return [];

  return (Array.isArray(metadata?.utilityBreakdown) ? metadata.utilityBreakdown : [])
    .map((item) => ({
      label: String(item?.label || item?.utilityType || item?.name || item?.utility || "Utility").trim() || "Utility",
      amount: round2(Math.max(0, Number(item?.amount || 0))),
    }))
    .filter((item) => item.amount > 0);
};

const getInvoiceTaxSplit = ({ amount = 0, taxSnapshot = {} } = {}) => {
  const grossAmount = round2(Math.max(0, Number(amount || 0)));
  if (grossAmount <= 0) {
    return {
      grossAmount: 0,
      netAmount: 0,
      taxAmount: 0,
      isTaxed: false,
    };
  }

  const snapshotTaxAmount = round2(Math.max(0, Number(taxSnapshot?.taxAmount || 0)));
  const derivedNetAmount = round2(
    snapshotTaxAmount > 0
      ? Math.max(0, Number(taxSnapshot?.netAmount ?? grossAmount - snapshotTaxAmount))
      : grossAmount
  );
  const boundedNetAmount = round2(Math.min(grossAmount, Math.max(0, derivedNetAmount)));
  const boundedTaxAmount = round2(Math.max(0, Math.min(grossAmount - boundedNetAmount, snapshotTaxAmount || grossAmount - boundedNetAmount)));
  const finalNetAmount = round2(Math.max(0, grossAmount - boundedTaxAmount));

  return {
    grossAmount,
    netAmount: finalNetAmount,
    taxAmount: boundedTaxAmount,
    isTaxed: boundedTaxAmount > 0,
  };
};

const splitAppliedAmountBetweenBaseAndTax = ({ appliedAmount = 0, grossAmount = 0, taxAmount = 0 } = {}) => {
  const applied = round2(Math.max(0, Number(appliedAmount || 0)));
  const gross = round2(Math.max(0, Number(grossAmount || 0)));
  const tax = round2(Math.max(0, Math.min(gross, Number(taxAmount || 0))));
  if (applied <= 0 || gross <= 0) {
    return {
      grossApplied: 0,
      baseApplied: 0,
      taxApplied: 0,
    };
  }

  const taxRatio = tax > 0 ? Math.min(1, tax / gross) : 0;
  const rawTaxApplied = round2(applied * taxRatio);
  const taxApplied = round2(Math.max(0, Math.min(applied, rawTaxApplied)));
  const baseApplied = round2(Math.max(0, applied - taxApplied));

  return {
    grossApplied: applied,
    baseApplied,
    taxApplied,
  };
};

const getCombinedInvoiceStatementSplit = ({ amount = 0, metadata = {}, taxSnapshot = {}, row = null } = {}) => {
  const breakdown = getCombinedUtilityBreakdown(metadata);
  if (breakdown.length === 0) return null;

  const amountSplit = getInvoiceTaxSplit({ amount, taxSnapshot });
  const totalNetAmount = round2(amountSplit.netAmount || 0);
  if (totalNetAmount <= 0) {
    return {
      grossAmount: amountSplit.grossAmount || 0,
      netAmount: 0,
      taxAmount: amountSplit.taxAmount || 0,
      rentAmount: 0,
      utilityAmount: 0,
      utilities: [],
    };
  }

  let remaining = totalNetAmount;
  const utilities = breakdown.map((item, index) => {
    const rawAmount = round2(Number(item.amount || 0));
    const appliedAmount = index === breakdown.length - 1
      ? round2(Math.max(0, remaining))
      : round2(Math.max(0, Math.min(remaining, rawAmount)));
    remaining = round2(Math.max(0, remaining - appliedAmount));

    const identity = resolveUtilityIdentity(item.label, {
      utilityType: item.label,
      meterUtilityType: item.label,
      statementUtilityType: item.label,
    }, row);

    return {
      key: identity.key,
      label: identity.label,
      amount: appliedAmount,
    };
  }).filter((item) => item.amount > 0);

  const utilityAmount = round2(utilities.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const rentAmount = round2(Math.max(0, totalNetAmount - utilityAmount));

  return {
    grossAmount: amountSplit.grossAmount,
    netAmount: totalNetAmount,
    taxAmount: amountSplit.taxAmount,
    rentAmount,
    utilityAmount,
    utilities,
  };
};

const getCombinedReceiptAllocationSplit = ({ allocationRow = {}, sourceInvoice = null, row = null } = {}) => {
  if (!sourceInvoice) return null;

  const invoiceSplit = getCombinedInvoiceStatementSplit({
    amount: sourceInvoice?.amount || 0,
    metadata: sourceInvoice?.metadata || {},
    taxSnapshot: sourceInvoice?.taxSnapshot || {},
    row,
  });
  const appliedAmount = round2(Math.max(0, Number(allocationRow?.appliedAmount || 0)));
  if (!invoiceSplit || invoiceSplit.utilityAmount <= 0 || appliedAmount <= 0) return null;

  const appliedSplit = splitAppliedAmountBetweenBaseAndTax({
    appliedAmount,
    grossAmount: invoiceSplit.grossAmount || sourceInvoice?.amount || 0,
    taxAmount: invoiceSplit.taxAmount || 0,
  });
  const baseApplied = round2(appliedSplit.baseApplied || 0);
  if (baseApplied <= 0) {
    return {
      rentAmount: 0,
      utilityAmount: 0,
      utilities: [],
      taxAmount: round2(appliedSplit.taxApplied || 0),
    };
  }

  const ratio = invoiceSplit.netAmount > 0 ? Math.min(1, baseApplied / invoiceSplit.netAmount) : 0;
  let remainingUtilityApplied = round2(invoiceSplit.utilityAmount * ratio);
  const utilities = (invoiceSplit.utilities || []).map((item, index, arr) => {
    const rawAmount = round2(Number(item.amount || 0) * ratio);
    const allocatedAmount = index === arr.length - 1
      ? round2(Math.max(0, remainingUtilityApplied))
      : round2(Math.max(0, Math.min(remainingUtilityApplied, rawAmount)));
    remainingUtilityApplied = round2(Math.max(0, remainingUtilityApplied - allocatedAmount));
    return {
      ...item,
      amount: allocatedAmount,
    };
  }).filter((item) => item.amount > 0);

  const utilityAmount = round2(utilities.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const rentAmount = round2(Math.max(0, baseApplied - utilityAmount));

  return {
    rentAmount,
    utilityAmount,
    utilities,
    taxAmount: round2(appliedSplit.taxApplied || 0),
  };
};

const sumUtilityPhase = (row = {}, phase = "invoice") =>
  Object.values(row?.utilities || {}).reduce((sum, item) => {
    const amount =
      phase === "invoice"
        ? Number(item?.invoiced || 0)
        : Number(item?.paid || 0);
    return sum + amount;
  }, 0);

// Deposit gets its own dynamic column, exactly like a utility — appears only when a
// property has deposit activity this period, hidden otherwise. Unlike rent/utilities, a
// deposit is a liability held on the tenant's behalf, not income: it is deliberately NEVER
// folded into row.balanceCF (the rent-ledger balance) or any commission/remittance total —
// it exists purely so the schedule shows the tenant's full transaction picture in one row,
// the same figures reconciling to the separate "Deposits You Now Hold" section.
const ensureDepositMap = (row = {}) => {
  if (!row.deposits || typeof row.deposits !== "object" || Array.isArray(row.deposits)) {
    row.deposits = {};
  }
  return row.deposits;
};

const registerDepositAmount = (row, phase, amount, label = "Deposit") => {
  const value = round2(Number(amount || 0));
  if (value === 0) return;
  const deposits = ensureDepositMap(row);
  const key = "deposit";
  if (!deposits[key]) {
    deposits[key] = { key, label: label || "Deposit", invoiced: 0, paid: 0 };
  }
  if (phase === "invoice") {
    deposits[key].invoiced = round2(Number(deposits[key].invoiced || 0) + value);
  } else {
    deposits[key].paid = round2(Number(deposits[key].paid || 0) + value);
  }
};

const sumDepositPhase = (row = {}, phase = "invoice") =>
  Object.values(row?.deposits || {}).reduce((sum, item) => {
    const amount = phase === "invoice" ? Number(item?.invoiced || 0) : Number(item?.paid || 0);
    return sum + amount;
  }, 0);

const buildDepositColumns = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    Object.values(row?.deposits || {}).forEach((item) => {
      const key = item?.key || "deposit";
      if (!map.has(key)) {
        map.set(key, { key, label: item?.label || "Deposit", invoiced: 0, paid: 0 });
      }
      const column = map.get(key);
      column.invoiced = round2(Number(column.invoiced || 0) + Number(item?.invoiced || 0));
      column.paid = round2(Number(column.paid || 0) + Number(item?.paid || 0));
    });
  });
  return Array.from(map.values())
    .filter((item) => Number(item.invoiced || 0) !== 0 || Number(item.paid || 0) !== 0)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
};

const buildUtilityColumns = (rows = []) => {
  const map = new Map();

  rows.forEach((row) => {
    Object.values(row?.utilities || {}).forEach((item) => {
      const key = normalizeUtilityKey(item?.key || item?.label || "");
      if (!map.has(key)) {
        map.set(key, {
          key,
          label:
            item?.label || titleCase(key.replace(/_/g, " ")) || defaultUtilityLabel,
          invoiced: 0,
          paid: 0,
        });
      }

      const column = map.get(key);
      column.invoiced = round2(
        Number(column.invoiced || 0) + Number(item?.invoiced || 0)
      );
      column.paid = round2(Number(column.paid || 0) + Number(item?.paid || 0));
    });
  });

  return Array.from(map.values())
    .filter(
      (item) => Number(item.invoiced || 0) !== 0 || Number(item.paid || 0) !== 0
    )
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
};

const getReceiptCategory = (paymentType, paidDirectToLandlord) => {
  if (paymentType === "utility") {
    return paidDirectToLandlord
      ? "UTILITY_RECEIPT_LANDLORD"
      : "UTILITY_RECEIPT_MANAGER";
  }
  return paidDirectToLandlord
    ? "RENT_RECEIPT_LANDLORD"
    : "RENT_RECEIPT_MANAGER";
};

const getReceiptSign = (receipt = {}) =>
  Number(receipt?.amount || 0) < 0 ? -1 : 1;

const getReceiptAllocationRows = (receipt = {}) => {
  const sign = getReceiptSign(receipt);
  return Array.isArray(receipt?.allocations)
    ? receipt.allocations
        .filter((row) => Number(row?.appliedAmount || 0) > 0)
        .map((row) => ({
          ...row,
          appliedAmount: round2(Number(row?.appliedAmount || 0) * sign),
        }))
    : [];
};

const formatStatementMonthYear = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

const uniqClean = (items = []) =>
  Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const normalizeChargeLabel = (value = "") => {
  const normalized = safeName(value).replace(/[_-]+/g, " ");
  if (!normalized) return "Charge";
  if (normalized.includes("rent")) return "Rent Charge";
  if (normalized.includes("utility")) return "Utility Charge";
  if (normalized.includes("water")) return "Water";
  if (normalized.includes("electric")) return "Electricity";
  if (normalized.includes("garbage") || normalized.includes("refuse") || normalized.includes("waste")) return "Garbage";
  if (normalized.includes("penalty") || normalized.includes("late")) return "Late Penalty";
  if (normalized.includes("deposit")) return "Deposit Charge";
  if (normalized.includes("debit note")) return "Debit Note";
  if (normalized.includes("credit note")) return "Credit Note";
  return titleCase(normalized);
};

const getInvoiceChargeLabelForStatement = ({ invoice = {}, row = null, combinedSplit = null } = {}) => {
  const category = String(invoice?.category || "").toUpperCase();
  if (category === "UTILITY_CHARGE") {
    const utilityIdentity = resolveUtilityIdentity(invoice.description || invoice.invoiceNumber || "", invoice.metadata || {}, row);
    const utilityLabel = utilityIdentity?.label && utilityIdentity.label !== defaultUtilityLabel ? utilityIdentity.label : "";
    return utilityLabel ? `Utility Charge (${utilityLabel})` : "Utility Charge";
  }
  if (category === "RENT_CHARGE") {
    const utilities = uniqClean((Array.isArray(combinedSplit?.utilities) ? combinedSplit.utilities : []).map((item) => item?.label));
    return utilities.length > 0 ? `Rent Charge (${["Rent", ...utilities].join(" + ")})` : "Rent Charge";
  }
  if (category === "DEPOSIT_CHARGE") return "Deposit Charge";
  return normalizeChargeLabel(invoice?.description || invoice?.category || "Charge");
};

const buildTenantStatementInvoiceDescription = ({ invoice = {}, row = null, combinedSplit = null } = {}) => {
  const label = getInvoiceChargeLabelForStatement({ invoice, row, combinedSplit });
  const period = formatStatementMonthYear(getInvoiceStatementDate(invoice) || invoice.invoiceDate || invoice.bookingDate);
  return [label, period].filter(Boolean).join(" – ") || invoice.description || invoice.invoiceNumber || "Tenant invoice";
};

const getAllocationChargeLabelForStatement = ({ allocationRow = {}, sourceInvoice = null, row = null } = {}) => {
  if (sourceInvoice) {
    const category = String(sourceInvoice?.category || "").toUpperCase();
    if (category === "UTILITY_CHARGE") {
      const utilityIdentity = resolveUtilityIdentity(
        allocationRow?.description || sourceInvoice.description || sourceInvoice.invoiceNumber || "",
        {
          ...(sourceInvoice.metadata || {}),
          utilityType: allocationRow?.utilityType || allocationRow?.statementUtilityType || allocationRow?.utility || allocationRow?.name || sourceInvoice.metadata?.utilityType || sourceInvoice.metadata?.statementUtilityType || sourceInvoice.metadata?.utility || "",
        },
        row
      );
      return utilityIdentity?.label && utilityIdentity.label !== defaultUtilityLabel ? utilityIdentity.label : "Utility";
    }
    if (category === "RENT_CHARGE") return "Rent";
    if (category === "DEPOSIT_CHARGE") return "Deposit";
  }
  return normalizeChargeLabel(allocationRow?.priorityGroup || allocationRow?.category || allocationRow?.description || allocationRow?.type || "Charge").replace(/ Charge$/i, "");
};

const buildGroupedReceiptDescription = ({ receipt = {}, allocationRows = [], invoiceStatementMap = new Map(), row = null } = {}) => {
  const reference = receipt.receiptNumber || receipt.referenceNumber || "";
  const fallbackPeriod = formatStatementMonthYear(getReceiptStatementDate(receipt) || receipt.paymentDate || receipt.recordDate || receipt.createdAt);
  const grouped = new Map();
  (Array.isArray(allocationRows) ? allocationRows : []).forEach((allocationRow) => {
    const sourceInvoice = invoiceStatementMap.get(String(allocationRow?.invoice || allocationRow?.invoiceId || ""));
    const label = getAllocationChargeLabelForStatement({ allocationRow, sourceInvoice, row });
    const period = formatStatementMonthYear(sourceInvoice ? getInvoiceStatementDate(sourceInvoice) || sourceInvoice.invoiceDate || sourceInvoice.bookingDate : null) || fallbackPeriod;
    const key = period || "__no_period__";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(label);
  });
  const groups = Array.from(grouped.entries()).map(([period, labels]) => {
    const cleanLabels = uniqClean(labels);
    if (period === "__no_period__") return cleanLabels.join(" + ");
    return `${cleanLabels.join(" + ")} – ${period}`;
  }).filter(Boolean);
  const allocationSummary = groups.length > 0 ? groups.join(" + ") : fallbackPeriod;
  return ["Payment Received", allocationSummary, reference ? `Ref: ${reference}` : ""].filter(Boolean).join(" – ");
};

const getReceiptSummaryAmount = (receipt = {}, key = "") => {
  const summary = receipt?.allocationSummary || {};
  const sign = getReceiptSign(receipt);

  if (key === "late_penalty") {
    return round2(Number(summary.latePenalty || 0) * sign);
  }
  if (key === "debit_note") {
    return round2(Number(summary.debitNote || 0) * sign);
  }

  return round2(Number(summary[key] || 0) * sign);
};

const getReceiptAllocationStatementImpact = ({
  allocationRow = {},
  sourceInvoice = null,
  row = null,
}) => {
  const fallbackAmount = round2(Number(allocationRow?.appliedAmount || 0));
  if (fallbackAmount === 0) {
    return {
      rentAmount: 0,
      utilityAmount: 0,
      utilities: [],
      taxAmount: 0,
      depositAmount: 0,
      statementRelevantAmount: 0,
      statementCategory: "",
      isStatementRelevant: false,
    };
  }

  // The Receipt Allocation Workspace records an unapplied/prepayment portion as its own
  // synthetic allocation row (invoice: null, isPrepayment: true, priorityGroup often
  // "rent" purely as a display label) purely for audit-trail visibility — it does not
  // pay any real invoice. That same amount is already counted once via
  // getReceiptSummaryAmount(receipt, "unapplied") elsewhere in the receipt loop, so this
  // row must be excluded here or it gets counted a second time as real rent revenue.
  if (allocationRow?.isPrepayment) {
    return {
      rentAmount: 0,
      utilityAmount: 0,
      utilities: [],
      taxAmount: 0,
      depositAmount: 0,
      statementRelevantAmount: 0,
      statementCategory: "",
      isStatementRelevant: false,
    };
  }

  const combinedSplit = getCombinedReceiptAllocationSplit({ allocationRow, sourceInvoice, row });
  if (combinedSplit) {
    const rentAmount = round2(Number(combinedSplit.rentAmount || 0));
    const utilityAmount = round2(Number(combinedSplit.utilityAmount || 0));
    const taxAmount = round2(Number(combinedSplit.taxAmount || 0));
    const statementRelevantAmount = round2(rentAmount + utilityAmount + taxAmount);

    return {
      rentAmount,
      utilityAmount,
      utilities: Array.isArray(combinedSplit.utilities) ? combinedSplit.utilities : [],
      taxAmount,
      depositAmount: 0,
      statementRelevantAmount,
      statementCategory: statementRelevantAmount !== 0 ? "rent" : "",
      isStatementRelevant: statementRelevantAmount !== 0,
    };
  }

  const sourceCategory = String(sourceInvoice?.category || "").toUpperCase();
  if (sourceCategory === "DEPOSIT_CHARGE") {
    return {
      rentAmount: 0,
      utilityAmount: 0,
      utilities: [],
      taxAmount: 0,
      depositAmount: fallbackAmount,
      statementRelevantAmount: 0,
      statementCategory: "deposit",
      isStatementRelevant: false,
    };
  }

  const sourceTaxSplit = sourceInvoice
    ? getInvoiceTaxSplit({
        amount: sourceInvoice?.amount || 0,
        taxSnapshot: sourceInvoice?.taxSnapshot || {},
      })
    : {
        grossAmount: Math.abs(fallbackAmount),
        netAmount: Math.abs(fallbackAmount),
        taxAmount: 0,
      };

  const appliedTaxSplit = splitAppliedAmountBetweenBaseAndTax({
    appliedAmount: Math.abs(fallbackAmount),
    grossAmount: sourceTaxSplit.grossAmount || Math.abs(fallbackAmount),
    taxAmount: sourceTaxSplit.taxAmount || 0,
  });

  const signedBaseApplied = Math.sign(fallbackAmount || 1) * Number(appliedTaxSplit.baseApplied || 0);
  const signedTaxApplied = Math.sign(fallbackAmount || 1) * Number(appliedTaxSplit.taxApplied || 0);

  if (sourceCategory === "RENT_CHARGE") {
    const rentAmount = round2(signedBaseApplied);
    const taxAmount = round2(signedTaxApplied);
    return {
      rentAmount,
      utilityAmount: 0,
      utilities: [],
      taxAmount,
      depositAmount: 0,
      statementRelevantAmount: round2(rentAmount + taxAmount),
      statementCategory: "rent",
      isStatementRelevant: rentAmount !== 0 || taxAmount !== 0,
    };
  }

  if (sourceCategory === "UTILITY_CHARGE") {
    const utilityAmount = round2(signedBaseApplied);
    const taxAmount = round2(signedTaxApplied);
    const utilityIdentity = resolveUtilityIdentity(
      allocationRow?.utilityType || allocationRow?.description || sourceInvoice?.description || "",
      {
        utilityType: allocationRow?.utilityType || sourceInvoice?.metadata?.utilityType || "",
        meterUtilityType:
          allocationRow?.utilityType || sourceInvoice?.metadata?.meterUtilityType || "",
        statementUtilityType:
          allocationRow?.utilityType || sourceInvoice?.metadata?.statementUtilityType || "",
      },
      row
    );

    return {
      rentAmount: 0,
      utilityAmount,
      utilities:
        utilityAmount !== 0
          ? [{
              key: utilityIdentity.key,
              label: utilityIdentity.label,
              amount: utilityAmount,
            }]
          : [],
      taxAmount,
      depositAmount: 0,
      statementRelevantAmount: round2(utilityAmount + taxAmount),
      statementCategory: "utility",
      isStatementRelevant: utilityAmount !== 0 || taxAmount !== 0,
    };
  }

  const priorityGroup = String(allocationRow?.priorityGroup || "other").toLowerCase();
  if (priorityGroup === "rent") {
    return {
      rentAmount: fallbackAmount,
      utilityAmount: 0,
      utilities: [],
      taxAmount: 0,
      depositAmount: 0,
      statementRelevantAmount: fallbackAmount,
      statementCategory: "rent",
      isStatementRelevant: fallbackAmount !== 0,
    };
  }

  if (priorityGroup === "debit_note") {
    // Debit notes carry their real charge category (RENT_CHARGE / UTILITY_CHARGE) on
    // the allocation row's `category` field (not "DEBIT_NOTE"). Route accordingly.
    const underlyingCategory = String(allocationRow?.category || "").toUpperCase();
    if (underlyingCategory === "UTILITY_CHARGE") {
      const utilityIdentity = resolveUtilityIdentity(
        allocationRow?.utilityType || allocationRow?.description || sourceInvoice?.description || "",
        {
          utilityType: allocationRow?.utilityType || sourceInvoice?.metadata?.utilityType || "",
          meterUtilityType: allocationRow?.utilityType || sourceInvoice?.metadata?.meterUtilityType || "",
          statementUtilityType: allocationRow?.utilityType || sourceInvoice?.metadata?.statementUtilityType || "",
        },
        row
      );
      return {
        rentAmount: 0,
        utilityAmount: fallbackAmount,
        utilities: fallbackAmount !== 0 ? [{ key: utilityIdentity.key, label: utilityIdentity.label, amount: fallbackAmount }] : [],
        taxAmount: 0,
        depositAmount: 0,
        statementRelevantAmount: fallbackAmount,
        statementCategory: "utility",
        isStatementRelevant: fallbackAmount !== 0,
      };
    }
    // Only RENT_CHARGE debit notes count toward landlord rent. OTHER_CHARGE (lease fees,
    // agency fees, etc.) are management company income and must never inflate paidRent.
    if (underlyingCategory !== "RENT_CHARGE") {
      return { rentAmount: 0, utilityAmount: 0, utilities: [], taxAmount: 0, depositAmount: 0, statementRelevantAmount: 0, statementCategory: "other", isStatementRelevant: false };
    }
    return {
      rentAmount: fallbackAmount,
      utilityAmount: 0,
      utilities: [],
      taxAmount: 0,
      depositAmount: 0,
      statementRelevantAmount: fallbackAmount,
      statementCategory: "rent",
      isStatementRelevant: fallbackAmount !== 0,
    };
  }

  if (priorityGroup === "utility") {
    const utilityIdentity = resolveUtilityIdentity(
      allocationRow?.utilityType || allocationRow?.description || "",
      {
        utilityType: allocationRow?.utilityType || "",
        meterUtilityType: allocationRow?.utilityType || "",
        statementUtilityType: allocationRow?.utilityType || "",
      },
      row
    );

    return {
      rentAmount: 0,
      utilityAmount: fallbackAmount,
      utilities: [{
        key: utilityIdentity.key,
        label: utilityIdentity.label,
        amount: fallbackAmount,
      }],
      taxAmount: 0,
      depositAmount: 0,
      statementRelevantAmount: fallbackAmount,
      statementCategory: "utility",
      isStatementRelevant: fallbackAmount !== 0,
    };
  }

  return {
    rentAmount: 0,
    utilityAmount: 0,
    utilities: [],
    taxAmount: 0,
    depositAmount: 0,
    statementRelevantAmount: 0,
    statementCategory: "",
    isStatementRelevant: false,
  };
};

const getEffectiveDepositReceiptAmount = (receipt = {}) => {
  const summarized = getReceiptSummaryAmount(receipt, "deposit");
  if (Math.abs(summarized) > 0) return summarized;

  const allocationRows = getReceiptAllocationRows(receipt);
  if (allocationRows.length > 0) {
    const fromRows = allocationRows.reduce((sum, row) => {
      const priorityGroup = String(row?.priorityGroup || "").toLowerCase();
      if (priorityGroup !== "deposit") return sum;
      return sum + Number(row?.appliedAmount || 0);
    }, 0);
    if (Math.abs(fromRows) > 0) return round2(fromRows);
  }

  const paymentType = safeName(receipt?.paymentType || "");
  if (paymentType === "deposit") {
    const rawAmount = Number(receipt?.amount || 0);
    if (Math.abs(rawAmount) > 0) return round2(rawAmount);
  }

  return 0;
};

const normalizeDepositHolderValue = (value = "") => {
  const normalized = safeName(value);
  if (!normalized) return "";
  if (["landlord", "held_by_landlord"].includes(normalized)) return "landlord";
  if (["management company", "management_company", "propertymanager", "property manager", "property_manager", "manager"].includes(normalized)) {
    return "manager";
  }
  return "";
};

const getVoucherExpenseCategory = (voucherCategory = "") => {
  const normalized = safeName(voucherCategory);
  if (normalized === "landlord_maintenance") return "maintenance";
  if (normalized === "landlord_other") return "other";
  if (normalized === "manager_property") return "operating_expense";
  return "";
};

const resolveVoucherStatementDate = (voucher = {}) => {
  const candidates = [
    voucher?.paidDate,
    voucher?.paidAt,
    voucher?.approvedAt,
    voucher?.createdAt,
    voucher?.updatedAt,
    voucher?.dueDate,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
};

const resolveExplicitDepositHolderFromAllocationRow = (row = {}) => {
  const priorityGroup = safeName(row?.priorityGroup || "");
  if (priorityGroup !== "deposit") return "";

  const depositHolder =
    normalizeDepositHolderValue(row?.depositHeldBy) ||
    normalizeDepositHolderValue(row?.metadata?.depositHeldBy) ||
    normalizeDepositHolderValue(row?.sourceInvoice?.depositHeldBy) ||
    normalizeDepositHolderValue(row?.sourceInvoice?.metadata?.depositHeldBy);

  const ledgerMode = safeName(
    row?.invoiceLedgerMode ||
      row?.ledgerMode ||
      row?.sourceInvoice?.ledgerMode ||
      row?.sourceInvoice?.metadata?.ledgerMode ||
      ""
  );

  if (depositHolder) return depositHolder;
  if (ledgerMode === "off_ledger") return "landlord";
  return "";
};

const isLandlordDepositAllocationRow = (row = {}) =>
  resolveExplicitDepositHolderFromAllocationRow(row) === "landlord";

const getReceiptDepositAllocationBreakdown = (receipt = {}, fallbackHolderResolver = null) => {
  const allocationRows = getReceiptAllocationRows(receipt).filter(
    (row) => safeName(row?.priorityGroup || "") === "deposit" && Math.abs(Number(row?.appliedAmount || 0)) > 0
  );

  if (allocationRows.length > 0) {
    return allocationRows.reduce(
      (acc, row) => {
        const amount = round2(Math.abs(Number(row?.appliedAmount || 0)));
        if (amount === 0) return acc;

        const explicitHolder = resolveExplicitDepositHolderFromAllocationRow(row);
        const fallbackHolder =
          typeof fallbackHolderResolver === "function" ? fallbackHolderResolver(receipt, row) : "manager";
        const resolvedHolder = explicitHolder || fallbackHolder || "manager";

        if (resolvedHolder === "landlord") acc.landlord = round2(acc.landlord + amount);
        else acc.manager = round2(acc.manager + amount);
        acc.total = round2(acc.total + amount);
        return acc;
      },
      { manager: 0, landlord: 0, total: 0 }
    );
  }

  const effectiveAmount = round2(Math.abs(Number(getEffectiveDepositReceiptAmount(receipt) || 0)));
  if (effectiveAmount === 0) {
    return { manager: 0, landlord: 0, total: 0 };
  }

  const holder = typeof fallbackHolderResolver === "function" ? fallbackHolderResolver(receipt) : "manager";
  if (holder === "landlord") {
    return { manager: 0, landlord: effectiveAmount, total: effectiveAmount };
  }
  return { manager: effectiveAmount, landlord: 0, total: effectiveAmount };
};

const hasAnyDepositReceiptAllocation = (receipt = {}, fallbackHolderResolver = null) => {
  const breakdown = getReceiptDepositAllocationBreakdown(receipt, fallbackHolderResolver);
  return breakdown.total > 0;
};

const mergeUniqueReceiptsById = (...lists) => {
  const merged = [];
  const seen = new Set();
  lists.flat().forEach((item) => {
    const key = String(item?._id || "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
};

const calculateCommissionAmount = ({
  paymentMode,
  percentage,
  fixedAmount,
  commissionBase,
}) => {
  const normalizedMode = String(paymentMode || "percentage").toLowerCase();
  const pctAmount = round2(
    (Number(commissionBase || 0) * Number(percentage || 0)) / 100
  );
  const fixed = round2(fixedAmount);

  if (normalizedMode === "fixed") return fixed;
  if (normalizedMode === "both") return round2(pctAmount + fixed);
  return pctAmount;
};

const buildCommissionDescription = ({
  paymentMode,
  percentage,
  fixedAmount,
}) => {
  const normalizedMode = String(paymentMode || "percentage").toLowerCase();
  const pct = Number(percentage || 0);
  const fixed = round2(fixedAmount);

  if (normalizedMode === "fixed") {
    return `Management commission (Fixed KES ${fixed.toFixed(2)})`;
  }
  if (normalizedMode === "both") {
    return `Management commission (${pct}% + Fixed KES ${fixed.toFixed(2)})`;
  }
  return `Management commission (${pct}%)`;
};

export const generateLandlordStatement = async ({
  propertyId,
  landlordId,
  statementPeriodStart,
  statementPeriodEnd,
  cutoffAt = null,
}) => {
  if (
    !propertyId ||
    !landlordId ||
    !statementPeriodStart ||
    !statementPeriodEnd
  ) {
    throw new Error(
      "generateLandlordStatement requires propertyId, landlordId, statementPeriodStart, and statementPeriodEnd"
    );
  }

  if (!isValidObjectId(propertyId)) {
    throw new Error("Invalid propertyId supplied for landlord statement generation.");
  }

  if (!isValidObjectId(landlordId)) {
    throw new Error("Invalid landlordId supplied for landlord statement generation.");
  }

  const propertyObjectId = oid(propertyId);
  const landlordObjectId = oid(landlordId);

  // Round-trip 1: property + landlord fetched in parallel (landlord business validated after).
  const [property, landlordRecord] = await Promise.all([
    Property.findById(propertyObjectId)
      .select(
        "dateAcquired propertyCode propertyName name address city commissionPercentage commissionRecognitionBasis prepaymentRecognition commissionPaymentMode commissionFixedAmount commissionTaxSettings totalUnits business landlords depositHeldBy letManage"
      )
      .lean(),
    Landlord.findOne({ _id: landlordObjectId })
      .select("landlordName email phoneNumber company")
      .lean(),
  ]);

  if (!property) throw new Error("Property not found");
  if (String(property?.letManage || "").trim().toLowerCase() === "letting") {
    const lettingErr = new Error(
      "Landlord statements are not available for Letting-only properties. Switch the property to Managing or Both mode to generate landlord statements."
    );
    lettingErr.statusCode = 422;
    throw lettingErr;
  }
  if (!property.business) {
    throw new Error("Property is missing business scope. Cannot generate landlord statement safely.");
  }

  if (!landlordRecord || String(landlordRecord.company || "") !== String(property.business)) {
    throw new Error("Landlord not found for the supplied property business scope.");
  }

  const businessId = String(property.business);
  const businessObjectId = oid(property.business);

  const landlordLinkedToProperty = (Array.isArray(property.landlords) ? property.landlords : []).some(
    (item) => String(item?.landlordId || "") === String(landlordObjectId)
  );

  if (!landlordLinkedToProperty) {
    throw new Error("Landlord is not linked to the supplied property.");
  }

  // Round-trip 2: statement window resolution (which now also resolves the source
  // LandlordStatement of the latest PROCESSED cut-off, in the same query) in parallel
  // with the two lightweight company lookups.
  const [windowResult, companySettingsDoc, companyDoc] = await Promise.all([
    resolveEffectiveStatementWindow({
      businessId: businessObjectId,
      propertyId: propertyObjectId,
      landlordId: landlordObjectId,
      statementPeriodStart,
      statementPeriodEnd,
      cutoffAt,
      propertyDateAcquired: property.dateAcquired || null,
    }),
    CompanySettings.findOne({ company: businessObjectId }).select("incomeRules").lean(),
    Company.findById(businessObjectId, { companyMode: 1 }).lean(),
  ]);

  const latePenaltyToLandlord =
    (companySettingsDoc?.incomeRules?.latePenaltyBeneficiary || "manager") === "landlord";
  // Self-managing landlord companies have no manager, no commission, and no manager/
  // landlord deposit-holder split — this statement becomes a "Property Performance
  // Statement" for their own records rather than a remittance document. The row-building
  // logic below is identical either way (same tenants/invoices/receipts/expenses); only
  // the commission and a handful of display labels change for this mode.
  const selfManaged = isSelfManagingLandlordCompany(companyDoc || {});

  const {
    effectiveStartAt,
    effectiveEndAt,
    previousCutoffAt,
    latestProcessedStatement,
    openingLandlordSettlementBalance,
  } = windowResult;

  const periodStart = effectiveStartAt;
  const periodEnd = effectiveEndAt;

  // Payments allocated to a rent invoice dated AFTER this cutoff are ahead of the billing.
  // Under the default "on_invoice_allocation" policy they are held as a prepayment credit
  // (not counted toward paid rent / commission / remittance this period) and recognised in
  // the period the invoice belongs to — so each collected shilling is counted exactly once.
  const prepaymentRecognition = normalizePrepaymentRecognition(property?.prepaymentRecognition);
  const periodEndTime = periodEnd.getTime();

  // The tenant balance carry-forward (Bal B/F) must come from the SAME statement that
  // actually closed the period — the one referenced by the latest PROCESSED cut-off, not
  // merely "the latest Approved LandlordStatement". Approving a statement no longer
  // freezes anything by itself: a statement can sit Approved for days without being
  // Processed, and until it is, the next statement must still recompute its opening
  // balance from full history rather than trusting a snapshot nobody has actually closed
  // out yet. previousCutoffAt already IS that processed statement's own cut-off, so using
  // it here (instead of a separately-queried periodEnd) keeps Bal B/F's snapshot boundary
  // and the period-start continuity boundary permanently in lockstep.
  const lastApproved =
    latestProcessedStatement?.sourceStatement && typeof latestProcessedStatement.sourceStatement === "object"
      ? latestProcessedStatement.sourceStatement
      : null;
  const snapshotDate = lastApproved && previousCutoffAt ? previousCutoffAt : null;

  // Phase 1: all property-scoped queries in parallel — includes tenant balance snapshots
  // and gap take-on invoices that were previously sequential round-trips.
  const [
    units,
    invoicesBefore,
    invoicesInPeriod,
    notesForStatementWindow,
    expensesInPeriod,
    vouchersInPeriod,
    statementAdjustments,
    tenantBalanceSnapshots,
    gapTakeOnsResult,
  ] = await Promise.all([
    Unit.find({ property: propertyObjectId, business: businessObjectId })
      .select("_id unitNumber name rent utilities status isVacant property")
      .lean(),

    TenantInvoice.find({
      property: propertyObjectId,
      business: businessObjectId,
      ...buildInvoiceRecognitionDateQuery({ periodStart, lowerBound: snapshotDate }),
      status: { $nin: ["cancelled", "reversed"] },
    })
      .select(
        "_id tenant unit category amount description invoiceDate bookingDate invoiceNumber landlord metadata depositHeldBy taxSnapshot"
      )
      .lean(),

    TenantInvoice.find({
      property: propertyObjectId,
      business: businessObjectId,
      ...buildInvoiceRecognitionDateQuery({ periodStart, periodEnd }),
      status: { $nin: ["cancelled", "reversed"] },
    })
      .select(
        "_id tenant unit category amount description invoiceDate bookingDate invoiceNumber landlord metadata depositHeldBy taxSnapshot"
      )
      .lean(),

    TenantInvoiceNote.find({
      property: propertyObjectId,
      business: businessObjectId,
      status: { $nin: ["cancelled", "reversed"] },
      postingStatus: { $nin: ["failed", "reversed"] },
      $or: [
        snapshotDate
          ? { noteDate: { $gte: snapshotDate, $lte: periodEnd } }
          : { noteDate: { $lte: periodEnd } },
        snapshotDate
          ? { createdAt: { $gte: snapshotDate, $lte: periodEnd } }
          : { createdAt: { $lte: periodEnd } },
      ],
    })
      .select(
        "_id tenant unit category amount description noteDate noteNumber noteType metadata sourceInvoice createdAt updatedAt"
      )
      .lean(),

    ExpenseProperty.find({
      property: propertyObjectId,
      business: businessObjectId,
      date: { $gte: periodStart, $lte: periodEnd },
    })
      .select("_id amount description date category unit")
      .lean(),

    PaymentVoucher.find({
      property: propertyObjectId,
      business: businessObjectId,
      // "manager_property" ("Operating Expense (Property)" in the voucher form) is just as
      // much a landlord-borne cost as landlord_maintenance/landlord_other — it's a
      // property-scoped, PMS-only category the manager pays on the landlord's behalf.
      // Missing it here meant those vouchers never appeared as a statement deduction.
      category: { $in: ["landlord_maintenance", "landlord_other", "manager_property"] },
      status: { $in: ["approved", "paid"] },
      sourceProcessedStatement: null, // exclude landlord remittance vouchers — they settle prior statements
      $and: [
        { $or: [{ landlord: landlordObjectId }, { landlord: null }, { landlord: { $exists: false } }] },
        {
          $or: [
            { paidDate: { $gte: periodStart, $lte: periodEnd } },
            { paidAt: { $gte: periodStart, $lte: periodEnd } },
            { approvedAt: { $gte: periodStart, $lte: periodEnd } },
            { createdAt: { $gte: periodStart, $lte: periodEnd } },
          ],
        },
      ],
    })
      .select("_id voucherNo category amount narration reference dueDate paidDate approvedAt paidAt createdAt expenseRecord landlord property status")
      .lean(),

    FinancialLedgerEntry.find({
      property: propertyObjectId,
      business: businessObjectId,
      landlord: landlordObjectId,
      category: { $in: ["ADJUSTMENT", "ADVANCE_TO_LANDLORD", "LANDLORD_RECEIPT"] },
      transactionDate: { $gte: periodStart, $lte: periodEnd },
      status: "approved",
      sourceTransactionType: {
        $in: ["manual_adjustment", "other", "processed_statement", "recurring_deduction", "advance", "landlord_receipt"],
      },
      // Remittance journal entries (settling a prior statement) must not reduce the NEW period's net
      $nor: [{ category: "ADVANCE_TO_LANDLORD", sourceTransactionType: "processed_statement" }],
      $or: [
        { "metadata.includeInLandlordStatement": true },
        { "metadata.statementBucket": { $in: ["addition", "deduction", "advance_recovery", "advance_payment", "landlord_receipt_addition"] } },
      ],
    })
      .select(
        "_id amount debit credit direction transactionDate notes sourceTransactionType sourceTransactionId metadata tenant unit"
      )
      .lean(),

    // 8th: tenant balance snapshots from last approved statement
    snapshotDate && lastApproved?._id
      ? LandlordStatementTenantBalance.find({ statement: lastApproved._id })
          .select("tenantKey balanceCF")
          .lean()
      : Promise.resolve([]),

    // 9th: take-on balances added after the last approved statement closed
    snapshotDate && lastApproved?.approvedAt
      ? TenantInvoice.find({
          property: propertyObjectId,
          business: businessObjectId,
          status: { $nin: ["cancelled", "reversed"] },
          "metadata.isTakeOnBalance": true,
          createdAt: { $gt: lastApproved.approvedAt },
          ...buildInvoiceRecognitionDateQuery({ periodStart: snapshotDate, lowerBound: null }),
        })
          .select("_id tenant unit category amount description invoiceDate bookingDate invoiceNumber landlord metadata depositHeldBy taxSnapshot")
          .lean()
      : Promise.resolve([]),
  ]);

  const snapshotMap = new Map(
    tenantBalanceSnapshots.map((s) => [String(s.tenantKey), s])
  );

  // Merge gap take-ons into invoicesBefore (they appear as Balance B/F on the next statement)
  if (gapTakeOnsResult.length > 0) {
    const existingIds = new Set(invoicesBefore.map((i) => String(i._id)));
    for (const inv of gapTakeOnsResult) {
      if (!existingIds.has(String(inv._id))) invoicesBefore.push(inv);
    }
  }

  const unitIds = units.map((u) => u._id);

  // Phase 2: tenant + payment queries that depend on unitIds.
  // All payment types fetched in a single RentPayment query and split in memory.
  const dateOrFilter = snapshotDate
    ? [
        { bookingDate: { $gte: snapshotDate, $lte: periodEnd } },
        { paymentDate: { $gte: snapshotDate, $lte: periodEnd } },
        { confirmedAt: { $gte: snapshotDate, $lte: periodEnd } },
        { recordDate:  { $gte: snapshotDate, $lte: periodEnd } },
        { createdAt:   { $gte: snapshotDate, $lte: periodEnd } },
        // A receipt whose own dates all predate this snapshot's cutoff (so the snapshot
        // already reflects it) can still gain a NEW allocation afterward — e.g.
        // autoApplyPrepayments matching a held prepayment to an invoice that itself gets
        // booked/created later, while catching up on backdated data entry. That new
        // allocation must stay visible to statement generation no matter how far in the
        // past `periodEnd` is set, or the prepayment recognition silently disappears the
        // moment the statement stops being extended all the way to "today". Deliberately
        // uncapped above periodEnd — the pre-snapshot guard in the receiptsBefore loop
        // below stops this receipt's ALREADY-SNAPSHOTTED balance impact from being
        // double-counted once it resurfaces here for an unrelated reason.
        { updatedAt: { $gte: snapshotDate } },
      ]
    : [
        { bookingDate: { $lte: periodEnd } },
        { paymentDate: { $lte: periodEnd } },
        { confirmedAt: { $lte: periodEnd } },
        { recordDate:  { $lte: periodEnd } },
        { createdAt:   { $lte: periodEnd } },
      ];

  const [tenants, allPaymentsForStatementWindow] = await Promise.all([
    Tenant.find({
      unit: { $in: unitIds },
      business: businessObjectId,
      status: { $nin: ["inactive", "moved_out", "evicted"] },
    })
      .select(
        "_id name tenantCode rent status unit additionalUnits utilities paymentMethod balance moveInDate createdAt depositHeldBy terminationDate moveOutDate"
      )
      .lean(),

    RentPayment.find({
      business: businessObjectId,
      unit: { $in: unitIds },
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null,
      isCancellationEntry: { $ne: true },
      paymentType: { $in: ["rent", "utility", "deposit"] },
      $or: dateOrFilter,
    })
      .select(
        "_id tenant unit amount paymentType paymentDate bookingDate paidDirectToLandlord description referenceNumber receiptNumber breakdown utilities allocations allocationSummary metadata depositHeldBy ledgerMode confirmedAt recordDate createdAt"
      )
      .lean(),
  ]);

  const standardReceiptsForStatementWindow = allPaymentsForStatementWindow.filter(
    (p) => p.paymentType === "rent" || p.paymentType === "utility"
  );
  const depositReceiptsForStatementWindow = allPaymentsForStatementWindow.filter(
    (p) => p.paymentType === "deposit"
  );

  const unitMap = new Map(units.map((u) => [String(u._id), u]));
  const tenantMap = new Map(tenants.map((t) => [String(t._id), t]));
  const invoiceStatementMap = new Map(
    [...invoicesBefore, ...invoicesInPeriod].map((invoice) => [String(invoice?._id || ""), invoice])
  );

  // When a balance snapshot exists, invoicesBefore only covers the gap period.  Gap-period
  // receipts may still allocate against pre-snapshot invoices.  Collect any missing invoice
  // IDs referenced by gap receipts and fetch them in one bulk query to keep the map complete.
  if (snapshotDate) {
    const missingInvoiceIds = new Set();
    for (const receipt of standardReceiptsForStatementWindow) {
      const recognitionDate = getReceiptStatementDate(receipt);
      const recognitionTime = recognitionDate ? new Date(recognitionDate).getTime() : NaN;
      if (Number.isNaN(recognitionTime) || recognitionTime >= periodStart.getTime()) continue;
      for (const alloc of Array.isArray(receipt.allocations) ? receipt.allocations : []) {
        const invoiceId = String(alloc?.invoice || alloc?.invoiceId || "");
        if (invoiceId && !invoiceStatementMap.has(invoiceId)) {
          missingInvoiceIds.add(invoiceId);
        }
      }
    }
    if (missingInvoiceIds.size > 0) {
      const missingInvoices = await TenantInvoice.find({
        _id: { $in: Array.from(missingInvoiceIds).map((id) => oid(id)) },
        business: businessObjectId,
      })
        .select("_id tenant unit category amount description invoiceDate bookingDate invoiceNumber landlord metadata depositHeldBy taxSnapshot")
        .lean();
      missingInvoices.forEach((inv) => invoiceStatementMap.set(String(inv._id), inv));
    }
  }

  // Hydrate note.sourceInvoice in-memory from already-fetched invoices (avoids extra DB round-trip)
  notesForStatementWindow.forEach((note) => {
    const refId = note.sourceInvoice ? String(note.sourceInvoice) : "";
    if (refId) {
      note.sourceInvoice = invoiceStatementMap.get(refId) || null;
    }
  });

  const tenantsByUnit = new Map();

  // Only actively-occupying tenants seed a unit's "current occupant" row below — a
  // terminated tenant's tenant.unit is never cleared on termination, so without this
  // filter they'd keep getting a row generated for a unit they no longer occupy on every
  // later statement (even one showing someone else living there now). This doesn't affect
  // a terminated tenant's OWN legitimate transactions within the period — those are
  // resolved separately via tenantMap (still built from the unfiltered `tenants` array)
  // as each invoice/receipt/note is processed below.
  tenants
    .filter((tenant) => String(tenant.status || "").toLowerCase() !== "terminated")
    .forEach((tenant) => {
      const key = String(tenant.unit);
      if (!tenantsByUnit.has(key)) tenantsByUnit.set(key, []);
      tenantsByUnit.get(key).push(tenant);
    });


  const notesBefore = [];
  const notesInPeriod = [];
  (Array.isArray(notesForStatementWindow) ? notesForStatementWindow : []).forEach((note) => {
    const recognitionDate = getNoteStatementDate(note);
    if (!recognitionDate || Number.isNaN(new Date(recognitionDate).getTime())) return;

    const recognitionTime = new Date(recognitionDate).getTime();
    if (recognitionTime < periodStart.getTime()) {
      notesBefore.push(note);
    } else if (recognitionTime <= periodEnd.getTime()) {
      notesInPeriod.push(note);
    }
  });

  const receiptsBefore = [];
  const receiptsInPeriod = [];
  (Array.isArray(standardReceiptsForStatementWindow) ? standardReceiptsForStatementWindow : []).forEach((receipt) => {
    const recognitionDate = getReceiptStatementDate(receipt);
    if (!recognitionDate || Number.isNaN(new Date(recognitionDate).getTime())) return;

    const recognitionTime = new Date(recognitionDate).getTime();
    if (recognitionTime < periodStart.getTime()) {
      receiptsBefore.push(receipt);
    } else if (recognitionTime <= periodEnd.getTime()) {
      receiptsInPeriod.push(receipt);
    }
  });

  const depositReceiptsBefore = [];
  const depositReceiptsInPeriod = [];
  (Array.isArray(depositReceiptsForStatementWindow) ? depositReceiptsForStatementWindow : []).forEach((receipt) => {
    const recognitionDate = getReceiptStatementDate(receipt);
    if (!recognitionDate || Number.isNaN(new Date(recognitionDate).getTime())) return;

    const recognitionTime = new Date(recognitionDate).getTime();
    if (recognitionTime < periodStart.getTime()) {
      depositReceiptsBefore.push(receipt);
    } else if (recognitionTime <= periodEnd.getTime()) {
      depositReceiptsInPeriod.push(receipt);
    }
  });

  const rowsMap = new Map();

  const ensureRow = (tenantId, unitId, fallback = {}) => {
    const resolvedUnitId = getEntityId(unitId || fallback.unitId || fallback.unit);
    const unit = unitMap.get(resolvedUnitId) || {};
    let resolvedTenantId = getEntityId(tenantId || fallback.tenantId || fallback.tenant);
    let tenant = resolvedTenantId
      ? tenantMap.get(resolvedTenantId) || {}
      : {};

    // A terminated tenant is fully excluded from the landlord statement, unconditionally —
    // no date comparison. Clearing resolvedTenantId folds this into the same "vacant"
    // bucket as the unit's current-occupancy placeholder, so the amount still counts
    // toward the property's totals without being attributed to their name.
    if (["terminated", "moved_out"].includes(String(tenant?.status || "").toLowerCase())) {
      tenant = {};
      resolvedTenantId = "";
    }

    const key = `${resolvedUnitId}:${String(tenant._id || resolvedTenantId || "vacant")}`;

    // A real tenant/transaction row supersedes a "vacant" placeholder already seeded for
    // the same unit — that placeholder only exists because no tenant currently occupies
    // this unit (e.g. the tenant who was here this period has since been terminated, so
    // the current-occupancy seeding step above deliberately excluded them). Once we know
    // there was real activity here, the unit clearly wasn't vacant for that part of the
    // period, so drop the stale placeholder rather than showing both.
    if (!key.endsWith(":vacant")) {
      const vacantKey = `${resolvedUnitId}:vacant`;
      if (rowsMap.has(vacantKey)) rowsMap.delete(vacantKey);
    }

    if (!rowsMap.has(key)) {
      const tenantSnapshot = snapshotMap.get(key);
      // Genuine concurrent multi-unit occupancy only — tenant.unit + tenant.additionalUnits
      // is the one place this is actually configured. This is what the "X units" badge and
      // the Multi toggle's merge in the client are driven by: a tenant with multiple rows
      // this period purely from transaction history (a mid-period transfer, or a stray
      // invoice at an old unit) is NOT "multi-unit" — each such row stays its own separate,
      // unmerged, unbadged line. Only an actual additionalUnits assignment counts.
      const concurrentUnitIds = tenant._id
        ? [
            ...new Set(
              [getEntityId(tenant.unit), ...(Array.isArray(tenant.additionalUnits) ? tenant.additionalUnits.map((id) => getEntityId(id)) : [])]
                .filter((id) => id && unitMap.has(id))
            ),
          ]
        : [];
      const concurrentUnitLabels = concurrentUnitIds
        .map((id) => unitMap.get(id)?.unitNumber || unitMap.get(id)?.name)
        .filter(Boolean);
      rowsMap.set(key, {
        key,
        tenantId: String(tenant._id || resolvedTenantId || ""),
        unitId: resolvedUnitId,
        unit: unit.unitNumber || unit.name || fallback.unitLabel || "-",
        accountNo: tenant.tenantCode || fallback.accountNo || "-",
        tenantName: tenant.name || fallback.tenantName || "VACANT",
        multiUnitCount: concurrentUnitIds.length,
        multiUnitLabels: concurrentUnitLabels,
        perMonth: Number(tenant.rent || unit.rent || fallback.perMonth || 0),
        balanceBF: tenantSnapshot ? round2(tenantSnapshot.balanceCF) : 0,
        // Seeds the raw-ledger Bal B/F the same way — otherwise, whenever a prior period
        // was approved (so this period's invoicesBefore/receiptsBefore only cover the gap
        // since that snapshot, not full history), rawBalanceBF would start from 0 instead
        // of picking up where the last approved statement's Bal C/F left off.
        rawBalanceBF: tenantSnapshot ? round2(tenantSnapshot.balanceCF) : 0,
        invoicedRent: 0,
        invoicedGarbage: 0,
        invoicedWater: 0,
        paidRent: 0,
        paidGarbage: 0,
        paidWater: 0,
        invoicedTax: 0,
        paidTax: 0,
        unappliedCredits: 0,
        utilities: {},
        balanceCF: 0,
        unitUtilities: Array.isArray(unit.utilities) ? unit.utilities : [],
        tenantUtilities: Array.isArray(tenant.utilities) ? tenant.utilities : [],
        referenceNumbers: [],
      });
    }

    return rowsMap.get(key);
  };

  units.forEach((unit) => {
    const unitTenants = (tenantsByUnit.get(String(unit._id)) || []).sort(
      (a, b) => {
        const da = new Date(a.moveInDate || a.createdAt || 0).getTime();
        const db = new Date(b.moveInDate || b.createdAt || 0).getTime();
        return db - da;
      }
    );

    if (unitTenants.length > 0) {
      unitTenants.forEach((tenant) => ensureRow(tenant._id, unit._id));
    } else {
      ensureRow(null, unit._id, { tenantName: "VACANT" });
    }
  });

  const entries = [];

  const pushEntry = ({
    tenantId,
    unitId,
    transactionDate,
    category,
    amount,
    direction,
    description,
    sourceTransactionType,
    sourceTransactionId,
    metadata = {},
  }) => {
    entries.push({
      _id: new mongoose.Types.ObjectId(),
      tenant: tenantId || null,
      unit: unitId || null,
      transactionDate,
      createdAt: transactionDate,
      category,
      amount: round2(Math.abs(amount || 0)),
      direction,
      notes: description,
      description,
      sourceTransactionType: sourceTransactionType || null,
      sourceTransactionId: sourceTransactionId || null,
      metadata,
    });
  };

  const shouldIncludeInvoiceInLandlordStatement = (invoice = {}) => {
    const metadata = invoice?.metadata || {};
    if (typeof metadata.includeInLandlordStatement === "boolean") {
      return metadata.includeInLandlordStatement;
    }
    const billItemKey = String(metadata?.billItemKey || "").toLowerCase();
    // billItemKey overrides category defaults for ambiguous OTHER_CHARGE types
    if (billItemKey === "service_charge") return true;
    if (billItemKey === "lease_fee" || billItemKey === "other_charge") return false;
    const cat = String(invoice?.category || "").toUpperCase();
    if (cat === "LATE_PENALTY_CHARGE") return latePenaltyToLandlord;
    if (cat === "OTHER_CHARGE") return false;
    return true;
  };

  const shouldIncludeNoteInLandlordStatement = (note = {}) => {
    const metadata = mergeNoteUtilityMetadata(note);
    const bik = String(metadata?.billItemKey || "").toLowerCase();
    // Hard manager-only keys — never a landlord addition regardless of stored flag
    if (bik === "lease_fee") return false;
    if (bik === "other_charge") return false;
    // Service charge is always landlord income
    if (bik === "service_charge") return true;
    // Late payment follows the company income rule (configurable)
    if (bik === "late_payment") return latePenaltyToLandlord;
    if (typeof metadata.includeInLandlordStatement === "boolean") {
      return metadata.includeInLandlordStatement;
    }
    if (String(note?.noteType || "").toUpperCase() === "DEBIT_NOTE" && metadata.standaloneDebitNote === true) {
      return true;
    }
    if (String(note?.category || "").toUpperCase() === "LATE_PENALTY_CHARGE") {
      return latePenaltyToLandlord;
    }
    return true;
  };

  const getSignedNoteAmount = (note = {}) => {
    const amount = Math.abs(Number(note?.amount || 0));
    return String(note?.noteType || "").toUpperCase() === "CREDIT_NOTE"
      ? -amount
      : amount;
  };

  const resolveDepositHolderForRecord = (record = {}, allocationRow = null) => {
    const tenantId = getEntityId(record?.tenant);
    const tenant = tenantId ? tenantMap.get(tenantId) || {} : {};

    const allocationRows = Array.isArray(record?.allocations) ? record.allocations : [];
    const allocationHolder =
      resolveExplicitDepositHolderFromAllocationRow(allocationRow || {}) ||
      allocationRows.reduce((resolved, row) => {
        return resolved || resolveExplicitDepositHolderFromAllocationRow(row);
      }, "");

    const tenantHolder = normalizeDepositHolderValue(tenant?.depositHeldBy);
    const recordHolder =
      normalizeDepositHolderValue(record?.depositHeldBy) ||
      normalizeDepositHolderValue(record?.metadata?.depositHeldBy);
    const propertyHolder = normalizeDepositHolderValue(property?.depositHeldBy);
    const normalizedPaymentType = safeName(record?.paymentType || "");
    const hasDepositAllocation = allocationRows.some(
      (row) => safeName(row?.priorityGroup || "") === "deposit"
    );

    // Most-specific wins: allocation row → receipt/invoice field → tenant default → property default
    return allocationHolder || recordHolder || tenantHolder || propertyHolder || "manager";
  };

  const allDepositReceiptsBefore = mergeUniqueReceiptsById(
    depositReceiptsBefore,
    receiptsBefore.filter((receipt) => hasAnyDepositReceiptAllocation(receipt, resolveDepositHolderForRecord))
  );
  const allDepositReceiptsInPeriod = mergeUniqueReceiptsById(
    depositReceiptsInPeriod,
    receiptsInPeriod.filter((receipt) => hasAnyDepositReceiptAllocation(receipt, resolveDepositHolderForRecord))
  );

  const createDepositMemoBucket = (key, label) => ({
    key,
    label,
    openingBalance: 0,
    billed: 0,
    received: 0,
    closingBalance: 0,
  });

  const depositMemoBuckets = {
    manager: createDepositMemoBucket("manager", "Deposits held by manager"),
    landlord: createDepositMemoBucket("landlord", "Deposits held by landlord"),
  };

  // Restore deposit liability opening balances from snapshot so the bounded queries
  // don't produce an incorrect opening balance in the deposit memo section.
  const depositManagerSnapshot = snapshotMap.get("__deposit:manager__");
  const depositLandlordSnapshot = snapshotMap.get("__deposit:landlord__");
  if (depositManagerSnapshot) {
    depositMemoBuckets.manager.openingBalance = round2(depositManagerSnapshot.balanceCF);
    depositMemoBuckets.manager.closingBalance = round2(depositManagerSnapshot.balanceCF);
  }
  if (depositLandlordSnapshot) {
    depositMemoBuckets.landlord.openingBalance = round2(depositLandlordSnapshot.balanceCF);
    depositMemoBuckets.landlord.closingBalance = round2(depositLandlordSnapshot.balanceCF);
  }

  const depositSettlementRows = [];
  const depositSettlementTotals = {
    additions: 0,
    offsets: 0,
  };

  const pushDepositSettlementRow = ({
    date,
    description,
    amount,
    effect = "addition",
    holder = "landlord",
    paidDirectToLandlord = false,
    sourceId = "",
    unit = "",
  }) => {
    const value = round2(Math.abs(Number(amount || 0)));
    if (value === 0) return;

    const normalizedEffect = effect === "offset" ? "offset" : "addition";
    depositSettlementRows.push({
      date,
      description,
      amount: value,
      effect: normalizedEffect,
      holder,
      paidDirectToLandlord: Boolean(paidDirectToLandlord),
      sourceId,
      unit: unit || "",
    });

    if (normalizedEffect === "offset") {
      depositSettlementTotals.offsets = round2(depositSettlementTotals.offsets + value);
    } else {
      depositSettlementTotals.additions = round2(depositSettlementTotals.additions + value);
    }
  };

  const applyDepositReceiptToMemo = (record = {}, amount = 0, phase = "current") => {
    const value = round2(Math.abs(amount));
    if (value === 0) return;
    const bucket = depositMemoBuckets[resolveDepositHolderForRecord(record)] || depositMemoBuckets.manager;
    if (phase === "opening") bucket.openingBalance = round2(bucket.openingBalance - value);
    else bucket.received = round2(bucket.received + value);
    bucket.closingBalance = round2(bucket.closingBalance - value);
  };

  const applyUtility = (row, phase, amount, hint, metadata = {}) => {
    const value = round2(amount);
    if (value === 0) return;

    const utilityIdentity = resolveUtilityIdentity(hint, metadata, row);
    registerUtilityAmount(
      row,
      utilityIdentity.key,
      utilityIdentity.label,
      phase,
      value
    );
  };

  const broughtForwardCreditApplicationRows = [];
  const broughtForwardCreditApplicationTotals = {
    totalApplied: 0,
    rentApplied: 0,
    utilityApplied: 0,
    taxApplied: 0,
  };

  // Declared here (rather than after the current-period invoice loop below) so the
  // brought-forward credit-application loop can also feed them: a prior-period prepayment
  // that gets applied to a charge dated in THIS period is real cash recognised for the
  // first time this period, and must be counted in this period's collections exactly once —
  // see the "sourceInCurrentPeriod" branch inside the receiptsBefore loop.
  let totalRentReceivedManager = 0;
  let totalRentReceivedLandlord = 0;
  let totalUtilityReceivedManager = 0;
  let totalUtilityReceivedLandlord = 0;
  let totalInvoiceTaxReceivedManager = 0;
  let totalInvoiceTaxReceivedLandlord = 0;

  for (const invoice of invoicesBefore) {
    if (!shouldIncludeInvoiceInLandlordStatement(invoice)) continue;

    const row = ensureRow(invoice.tenant, invoice.unit);
    const amount = Number(invoice.amount || 0);

    if (invoice.category === "RENT_CHARGE") {
      row.balanceBF += amount;
    } else if (invoice.category === "UTILITY_CHARGE") {
      row.balanceBF += amount;
    }
  }

  for (const note of notesBefore) {
    if (!shouldIncludeNoteInLandlordStatement(note)) continue;

    const row = ensureRow(note.tenant, note.unit);
    const amount = getSignedNoteAmount(note);

    if (note.category === "RENT_CHARGE") {
      row.balanceBF += amount;
    } else if (note.category === "UTILITY_CHARGE") {
      row.balanceBF += amount;
    }
  }

  for (const receipt of allDepositReceiptsBefore) {
    const depositBreakdown = getReceiptDepositAllocationBreakdown(receipt, resolveDepositHolderForRecord);
    if (depositBreakdown.manager > 0) {
      applyDepositReceiptToMemo({ ...receipt, depositHeldBy: "manager" }, depositBreakdown.manager, "opening");
    }
    if (depositBreakdown.landlord > 0) {
      applyDepositReceiptToMemo({ ...receipt, depositHeldBy: "landlord" }, depositBreakdown.landlord, "opening");
    }
  }

  for (const receipt of receiptsBefore) {
    const defaultRow = ensureRow(receipt.tenant, receipt.unit);
    const allocationRows = getReceiptAllocationRows(receipt);
    const unappliedAllocated = getReceiptSummaryAmount(receipt, "unapplied");

    // A receipt whose own recognition date is already BEFORE this snapshot's cutoff was
    // already folded into that snapshot's balanceCF — it only shows up here (via the
    // uncapped `updatedAt` fetch clause above) because it gained a fresh allocation
    // afterward. Its historical, already-snapshotted impact (unapplied credit, payoff of
    // a pre-existing debt) must NOT be re-applied to balanceBF a second time; only its
    // brand-new in-period recognition (handled below via sourceInCurrentPeriod) is real.
    const receiptRecognitionDate = getReceiptStatementDate(receipt);
    const receiptRecognitionTime = receiptRecognitionDate ? new Date(receiptRecognitionDate).getTime() : NaN;
    const alreadyReflectedInSnapshot =
      snapshotDate && Number.isFinite(receiptRecognitionTime) && receiptRecognitionTime < snapshotDate.getTime();

    // Cash this old receipt never applied to any charge is a genuine credit carried
    // forward — it must sit in unappliedCredits, never silently reduce Balance B/F as if
    // it had repaid a real debt (that conflated "prepayment held" with "debt settled" and
    // shifted the opening balance by the unapplied amount every time one existed).
    if (unappliedAllocated !== 0 && !alreadyReflectedInSnapshot) {
      defaultRow.unappliedCredits += unappliedAllocated;
    }

    if (allocationRows.length > 0) {
      allocationRows.forEach((allocationRow) => {
        const sourceInvoice = invoiceStatementMap.get(String(allocationRow?.invoice || allocationRow?.invoiceId || ""));
        // A single receipt can span more than one of the tenant's units (e.g. one payment
        // settling both BAR's and S7's rent for a two-unit tenant) — resolve each
        // allocation row against the unit its own source invoice actually belongs to,
        // not the receipt's own top-level unit field. Falls back to the receipt's unit
        // only when the source can't be resolved (a debit note, or a pure prepayment
        // placeholder row with no linked invoice at all).
        const row = ensureRow(receipt.tenant, sourceInvoice?.unit || receipt.unit);
        const impact = getReceiptAllocationStatementImpact({
          allocationRow,
          sourceInvoice,
          row,
        });

        // The target invoice may not be in THIS statement's own fetch window (e.g. it was
        // excluded by a snapshot's lowerBound cutoff) even though it genuinely exists —
        // fall back to the allocation row's own stored invoiceDate/bookingDate (set by
        // autoApplyPrepayments / manual allocation) rather than treating an unresolved
        // sourceInvoice as "no date info", which would wrongly reduce Bal B/F as if this
        // were paying off pre-existing debt. Mirrors the same fallback the receiptsInPeriod
        // loop's deferred-prepayment check already uses below.
        const sourceInvoiceDate =
          (sourceInvoice ? getInvoiceStatementDate(sourceInvoice) : null) ||
          allocationRow?.invoiceDate ||
          allocationRow?.bookingDate ||
          null;
        const sourceInvoiceTime = sourceInvoiceDate ? new Date(sourceInvoiceDate).getTime() : Number.NaN;
        const sourceInCurrentPeriod =
          Number.isFinite(sourceInvoiceTime) &&
          sourceInvoiceTime >= periodStart.getTime() &&
          sourceInvoiceTime <= periodEnd.getTime();

        // Only reduce the balance carried INTO this period when the applied-against
        // charge is itself from before this period — i.e. this old receipt paid off a
        // debt the tenant already owed as of periodStart. When the charge is dated THIS
        // period instead, the credit isn't paying off a pre-existing debt at all — it's
        // being matched, for the first time, against a charge that itself only exists
        // this period. That case is handled below as a fresh in-period recognition
        // instead, so it must NOT also reduce Balance B/F (that would double-subtract the
        // same dollar: once via the opening credit, again via "Paid" this period).
        if (!sourceInCurrentPeriod && !alreadyReflectedInSnapshot) {
          row.balanceBF = round2(row.balanceBF - Number(impact.statementRelevantAmount || 0));
        }

        if (sourceInCurrentPeriod && Math.abs(Number(impact.statementRelevantAmount || 0)) > 0) {
          const grossAppliedAmount = round2(Math.abs(Number(allocationRow?.appliedAmount || 0)));
          const rentApplied = round2(Math.abs(Number(impact.rentAmount || 0)));
          const utilityApplied = round2(Math.abs(Number(impact.utilityAmount || 0)));
          const taxApplied = round2(Math.abs(Number(impact.taxAmount || 0)));

          const receiptReference =
            receipt.receiptNumber || receipt.referenceNumber || String(receipt._id || "");
          const appliedDocumentReference =
            sourceInvoice?.invoiceNumber || allocationRow?.invoiceNumber || allocationRow?.description || "Charge";

          broughtForwardCreditApplicationRows.push({
            date: getReceiptStatementDate(receipt) || receipt.paymentDate,
            receiptDate: receipt.paymentDate,
            chargeDate: sourceInvoiceDate,
            description: `B/F prepayment ${receiptReference} applied to ${appliedDocumentReference} - ${row.tenantName}`,
            amount: grossAppliedAmount,
            rentApplied,
            utilityApplied,
            taxApplied,
            category: impact.statementCategory || "credit_application",
            tenantName: row.tenantName,
            unit: row.unit,
            receiptReference,
            chargeReference: appliedDocumentReference,
            sourceId: `${String(receipt._id || "")}:${String(sourceInvoice?._id || allocationRow?.invoice || allocationRow?.invoiceId || "")}`,
          });

          broughtForwardCreditApplicationTotals.totalApplied = round2(
            broughtForwardCreditApplicationTotals.totalApplied + grossAppliedAmount
          );
          broughtForwardCreditApplicationTotals.rentApplied = round2(
            broughtForwardCreditApplicationTotals.rentApplied + rentApplied
          );
          broughtForwardCreditApplicationTotals.utilityApplied = round2(
            broughtForwardCreditApplicationTotals.utilityApplied + utilityApplied
          );
          broughtForwardCreditApplicationTotals.taxApplied = round2(
            broughtForwardCreditApplicationTotals.taxApplied + taxApplied
          );

          // Recognise this as an actual collection for THIS period — this is the period
          // the prepayment is first attributed to a real charge, so it belongs in Paid /
          // collections / net remittance now. Under "on_invoice_allocation" it was held out
          // of those totals in the period it was received (a prepayment credit then), so
          // this is its single recognition. Under "on_receipt" the cash was already counted
          // when it landed, so skip this pass to avoid counting it twice.
          if (prepaymentRecognition === "on_invoice_allocation") {
            const rentRecognized = round2(Number(impact.rentAmount || 0));
            const utilityRecognized = round2(Number(impact.utilityAmount || 0));
            const taxRecognized = round2(Number(impact.taxAmount || 0));

            if (rentRecognized !== 0) {
              row.paidRent += rentRecognized;
              if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += rentRecognized;
              else totalRentReceivedManager += rentRecognized;
            }

            if (utilityRecognized !== 0) {
              const impactUtilities = Array.isArray(impact.utilities) ? impact.utilities : [];
              if (impactUtilities.length > 0) {
                impactUtilities.forEach((item) => {
                  applyUtility(
                    row,
                    "receipt",
                    Number(item.amount || 0),
                    item.label || appliedDocumentReference || "",
                    {
                      utilityType: item.label,
                      meterUtilityType: item.label,
                      statementUtilityType: item.label,
                    }
                  );
                });
              } else {
                applyUtility(row, "receipt", utilityRecognized, appliedDocumentReference || "");
              }

              if (receipt.paidDirectToLandlord) totalUtilityReceivedLandlord += utilityRecognized;
              else totalUtilityReceivedManager += utilityRecognized;
            }

            if (taxRecognized !== 0) {
              row.paidTax += taxRecognized;
              if (receipt.paidDirectToLandlord) totalInvoiceTaxReceivedLandlord += taxRecognized;
              else totalInvoiceTaxReceivedManager += taxRecognized;
            }
          }
        }
      });
      continue;
    }

    if (!alreadyReflectedInSnapshot) {
      defaultRow.balanceBF = round2(defaultRow.balanceBF - Number(receipt.amount || 0));
    }
  }

  // Receipts whose paymentDate was in a previously approved period but whose booking date
  // was subsequently moved into the current period. The saved snapshot already reflects
  // their credit, so reverse them out of Bal B/F to avoid double-counting.
  if (snapshotDate) {
    for (const receipt of receiptsInPeriod) {
      if (!receipt.bookingDate) continue;
      const payTime = new Date(receipt.paymentDate || 0).getTime();
      if (payTime >= periodStart.getTime()) continue;
      const row = ensureRow(receipt.tenant, receipt.unit);
      row.balanceBF = round2(row.balanceBF + Number(receipt.amount || 0));
    }
  }

  for (const invoice of invoicesInPeriod) {
    // Deposit charges carry includeInLandlordStatement:false (that flag keeps them out of
    // the ledger entries / general rent totals below) — but the dedicated Deposit memo
    // column must still reflect them, so this is handled and short-circuited before the
    // gate rather than falling into pushEntry with everything else.
    if (invoice.category === "DEPOSIT_CHARGE") {
      // Only feed the display-only Deposit column here — never the deposit memo buckets
      // (those drive the "Deposits You Now Hold" remittance addition, which must reflect
      // deposits actually COLLECTED via a receipt; a merely-billed, unpaid deposit invoice
      // must never inflate what the manager owes to remit).
      const depositRow = ensureRow(invoice.tenant, invoice.unit);
      registerDepositAmount(depositRow, "invoice", Number(invoice.amount || 0));
      continue;
    }

    if (!shouldIncludeInvoiceInLandlordStatement(invoice)) continue;

    const row = ensureRow(invoice.tenant, invoice.unit);
    const amount = Number(invoice.amount || 0);
    const taxSplit = getInvoiceTaxSplit({ amount, taxSnapshot: invoice?.taxSnapshot || {} });
    const combinedSplit =
      String(invoice?.category || "").toUpperCase() === "RENT_CHARGE"
        ? getCombinedInvoiceStatementSplit({
            amount,
            metadata: invoice.metadata || {},
            taxSnapshot: invoice?.taxSnapshot || {},
            row,
          })
        : null;

    if (invoice.category === "RENT_CHARGE") {
      row.invoicedTax += Number(taxSplit.taxAmount || 0);

      if (combinedSplit) {
        row.invoicedRent += Number(combinedSplit.rentAmount || 0);
        (combinedSplit.utilities || []).forEach((item) => {
          applyUtility(
            row,
            "invoice",
            Number(item.amount || 0),
            item.label || invoice.description || invoice.invoiceNumber || "",
            {
              utilityType: item.label,
              meterUtilityType: item.label,
              statementUtilityType: item.label,
            }
          );
        });
      } else {
        row.invoicedRent += Number(taxSplit.netAmount || 0);
      }
    } else if (invoice.category === "UTILITY_CHARGE") {
      row.invoicedTax += Number(taxSplit.taxAmount || 0);
      applyUtility(
        row,
        "invoice",
        Number(taxSplit.netAmount || 0),
        invoice.description || invoice.invoiceNumber || "",
        invoice.metadata || {}
      );
    }

    if (invoice.invoiceNumber) row.referenceNumbers.push(invoice.invoiceNumber);

    const invoiceUtilityIdentity =
      invoice.category === "UTILITY_CHARGE"
        ? resolveUtilityIdentity(
            invoice.description || invoice.invoiceNumber || "",
            invoice.metadata || {},
            row
          )
        : null;

    pushEntry({
      tenantId: invoice.tenant,
      unitId: invoice.unit,
      transactionDate: getInvoiceStatementDate(invoice),
      category: invoice.category,
      amount,
      direction: "credit",
      description: buildTenantStatementInvoiceDescription({
        invoice,
        row,
        combinedSplit,
      }) || invoice.description || invoice.invoiceNumber || "Tenant invoice",
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      metadata: {
        tenantName: row.tenantName,
        unit: row.unit,
        tenantCode: row.accountNo,
        taxSnapshot: invoice?.taxSnapshot || {},
        statementNetAmount: Number(taxSplit.netAmount || 0),
        statementTaxAmount: Number(taxSplit.taxAmount || 0),
        ...(invoiceUtilityIdentity
          ? {
              utilityType: invoiceUtilityIdentity.label,
              statementUtilityType: invoiceUtilityIdentity.label,
              statementUtilityKey: invoiceUtilityIdentity.key,
            }
          : {}),
      },
    });
  }

  let directToLandlordOffset = 0;
  const additionRows = [];
  const extraDeductionRows = [];
  const advanceRecoveryRows = [];
  const earlyPayoutRows = [];
  let totalAdditions = 0;
  let totalExtraDeductions = 0;
  let totalAdvanceRecoveries = 0;
  let totalEarlyPayouts = 0;
  // Display-only: the portion of totalAdditions that is a landlord-held deposit
  // recognition (category "deposit_remittance"). It's already shown once, correctly, in
  // the Deposit Remittance / "Deposits You Now Hold" section, so it's excluded from the
  // generic Additions total shown to the landlord (see displayAdditionsTotal below).
  let depositRemittanceAdditionsTotal = 0;

  for (const note of notesInPeriod) {
    // Same reasoning as the invoicesInPeriod loop above: deposit debit/credit notes must
    // still populate the Deposit memo column even though they carry
    // includeInLandlordStatement:false and must NOT reach the pushEntry ledger below.
    if (note.category === "DEPOSIT_CHARGE") {
      // See the matching comment in the invoicesInPeriod loop above — the deposit memo
      // buckets stay receipt-driven only; this feeds just the display-only column.
      const depositRow = ensureRow(note.tenant, note.unit);
      registerDepositAmount(depositRow, "invoice", getSignedNoteAmount(note));
      continue;
    }

    if (!shouldIncludeNoteInLandlordStatement(note)) continue;

    const row = ensureRow(note.tenant, note.unit);
    const amount = getSignedNoteAmount(note);
    const noteMetadata = mergeNoteUtilityMetadata(note);

    if (note.category === "RENT_CHARGE") {
      row.invoicedRent += amount;
    } else if (note.category === "UTILITY_CHARGE") {
      applyUtility(
        row,
        "invoice",
        amount,
        note.description || note.noteNumber || note?.sourceInvoice?.description || "",
        noteMetadata
      );
    } else if (["OTHER_CHARGE", "LATE_PENALTY_CHARGE"].includes(String(note.category || "").toUpperCase())) {
      if (amount > 0) {
        totalAdditions = round2(totalAdditions + amount);
        additionRows.push({
          date: getNoteStatementDate(note) || note.noteDate,
          description: note.description || noteMetadata?.billItemLabel || note.noteNumber || "Tenant debit note",
          amount,
          category: String(note.category || "").toLowerCase(),
          sourceId: String(note._id),
        });
      } else if (amount < 0) {
        const reductionAmount = round2(Math.abs(amount));
        totalExtraDeductions = round2(totalExtraDeductions + reductionAmount);
        extraDeductionRows.push({
          date: getNoteStatementDate(note) || note.noteDate,
          description: note.description || note.noteNumber || "Credit note reversal",
          amount: reductionAmount,
          category: String(note.category || "").toLowerCase(),
          sourceId: String(note._id),
        });
      }
    }

    if (note.noteNumber) row.referenceNumbers.push(note.noteNumber);

    const noteUtilityIdentity =
      note.category === "UTILITY_CHARGE"
        ? resolveUtilityIdentity(
            note.description || note.noteNumber || note?.sourceInvoice?.description || "",
            noteMetadata,
            row
          )
        : null;

    pushEntry({
      tenantId: note.tenant,
      unitId: note.unit,
      transactionDate: getNoteStatementDate(note) || note.noteDate,
      category: note.category,
      amount: Math.abs(amount),
      direction: amount >= 0 ? "credit" : "debit",
      description: note.description || note.noteNumber || "Tenant invoice note",
      sourceTransactionType: String(note.noteType || "").toLowerCase(),
      sourceTransactionId: String(note._id),
      metadata: {
        tenantName: row.tenantName,
        unit: row.unit,
        tenantCode: row.accountNo,
        noteType: note.noteType,
        ...(noteUtilityIdentity
          ? {
              utilityType: noteUtilityIdentity.label,
              statementUtilityType: noteUtilityIdentity.label,
              statementUtilityKey: noteUtilityIdentity.key,
            }
          : {}),
      },
    });
  }

  for (const receipt of receiptsInPeriod) {
    const row = ensureRow(receipt.tenant, receipt.unit);
    const amount = Number(receipt.amount || 0);
    const allocationRows = getReceiptAllocationRows(receipt);
    const description = buildGroupedReceiptDescription({
      receipt,
      allocationRows,
      invoiceStatementMap,
      row,
    }) || receipt.description || receipt.referenceNumber || receipt.receiptNumber || "Tenant receipt";
    const depositAllocated = getReceiptSummaryAmount(receipt, "deposit");
    const unappliedAllocated = getReceiptSummaryAmount(receipt, "unapplied");
    let rentAllocated = 0;
    let utilityAllocated = 0;
    let taxAllocated = 0;
    // Portion of this in-period receipt that pays a rent invoice dated AFTER the cutoff —
    // held as a prepayment credit rather than counted as paid-this-period (under the
    // default "on_invoice_allocation" policy). The period that invoice belongs to picks it
    // up once, via the receiptsBefore "sourceInCurrentPeriod" recognition below.
    let deferredPrepaymentCredit = 0;

    if (allocationRows.length > 0) {
      allocationRows.forEach((allocationRow) => {
        const sourceInvoice = invoiceStatementMap.get(String(allocationRow?.invoice || allocationRow?.invoiceId || ""));
        const impact = getReceiptAllocationStatementImpact({
          allocationRow,
          sourceInvoice,
          row,
        });

        if (!impact.isStatementRelevant) return;

        if (prepaymentRecognition === "on_invoice_allocation") {
          // The invoice this allocation pays. Its own recognition date is authoritative
          // when the invoice is loaded; otherwise the allocation row carries the invoice
          // date (the invoice may be future-dated and outside the fetch window, so it
          // isn't in invoiceStatementMap).
          const srcDate =
            (sourceInvoice ? getInvoiceStatementDate(sourceInvoice) : null) ||
            allocationRow?.invoiceDate ||
            allocationRow?.bookingDate ||
            null;
          const srcTime = srcDate ? new Date(srcDate).getTime() : Number.NaN;
          if (Number.isFinite(srcTime) && srcTime > periodEndTime) {
            deferredPrepaymentCredit = round2(
              deferredPrepaymentCredit + Number(impact.statementRelevantAmount || 0)
            );
            return; // ahead of the billing — recognise it in the invoice's own period, not here
          }
        }

        let impactRent = Number(impact.rentAmount || 0);
        // An allocation may be over-applied — more than the invoice's outstanding at the
        // time (beforeOutstanding). Under "on_invoice_allocation" the portion beyond the
        // invoice is paid ahead of the billing: hold it as a prepayment credit rather than
        // count it as rent this period. Only positive over-applications are trimmed, and
        // only when beforeOutstanding is a usable number.
        if (prepaymentRecognition === "on_invoice_allocation" && impactRent > 0) {
          const invoiceOutstanding = Number(allocationRow?.beforeOutstanding);
          if (Number.isFinite(invoiceOutstanding) && invoiceOutstanding >= 0 && impactRent > invoiceOutstanding) {
            row.unappliedCredits += round2(impactRent - invoiceOutstanding);
            impactRent = invoiceOutstanding;
          }
        }

        rentAllocated = round2(rentAllocated + impactRent);
        utilityAllocated = round2(utilityAllocated + Number(impact.utilityAmount || 0));
        taxAllocated = round2(taxAllocated + Number(impact.taxAmount || 0));

        (Array.isArray(impact.utilities) ? impact.utilities : []).forEach((item) => {
          applyUtility(
            row,
            "receipt",
            Number(item.amount || 0),
            item.label || allocationRow?.description || receipt.description || "",
            {
              utilityType: item.label,
              meterUtilityType: item.label,
              statementUtilityType: item.label,
            }
          );
        });
      });
    } else {
      rentAllocated = getReceiptSummaryAmount(receipt, "rent");
      utilityAllocated = getReceiptSummaryAmount(receipt, "utility");
    }

    // No per-invoice allocation rows — the receipt only says "rent: X" with no way to
    // know which bill it covers. Under "on_invoice_allocation", cap that lump at what the
    // tenant actually owes in rent (this period's rent invoiced + b/f arrears, less what
    // earlier receipts this period already covered); anything beyond is paid ahead of the
    // billing and held as a prepayment credit, so it never inflates commission or the
    // remittance the manager owes this period. Only positive over-payments are trimmed.
    // When allocation rows ARE present they already say exactly what each portion covers
    // (and future-dated allocations are deferred above), so no cap is applied there —
    // that path can legitimately span several of the tenant's units.
    let cappedPrepayment = false;
    if (
      allocationRows.length === 0 &&
      prepaymentRecognition === "on_invoice_allocation" &&
      rentAllocated > 0
    ) {
      const rentDueForRow = round2(
        Math.max(0, Number(row.invoicedRent || 0) + Math.max(0, Number(row.balanceBF || 0)) - Number(row.paidRent || 0))
      );
      if (rentAllocated > rentDueForRow) {
        const excess = round2(rentAllocated - rentDueForRow);
        rentAllocated = rentDueForRow;
        row.unappliedCredits += excess;
        cappedPrepayment = true;
      }
    }

    if (rentAllocated !== 0) {
      row.paidRent += rentAllocated;
      if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += rentAllocated;
      else totalRentReceivedManager += rentAllocated;
    }

    if (utilityAllocated !== 0) {
      if (allocationRows.length === 0) {
        const utilityBreakdown = Array.isArray(receipt.breakdown?.utilities)
          ? receipt.breakdown.utilities
          : [];

        if (utilityBreakdown.length > 0) {
          const sign = getReceiptSign(receipt);
          utilityBreakdown.forEach((util) => {
            applyUtility(
              row,
              "receipt",
              Number(util.amount || 0) * sign,
              util.name || util.utility || receipt.description || ""
            );
          });
        } else {
          applyUtility(row, "receipt", utilityAllocated, receipt.description || "");
        }
      }

      if (receipt.paidDirectToLandlord) {
        totalUtilityReceivedLandlord += utilityAllocated;
      } else {
        totalUtilityReceivedManager += utilityAllocated;
      }
    }

    if (taxAllocated !== 0) {
      row.paidTax += taxAllocated;
      if (receipt.paidDirectToLandlord) {
        totalInvoiceTaxReceivedLandlord += taxAllocated;
      } else {
        totalInvoiceTaxReceivedManager += taxAllocated;
      }
    }

    if (unappliedAllocated !== 0) {
      row.unappliedCredits += unappliedAllocated;
      // "on_receipt": all cash is recognised as it lands, so an unapplied overpayment
      // counts toward collections now (and never again when it is later allocated —
      // the receiptsBefore recognition pass is skipped in this mode). "on_invoice_
      // allocation" leaves it purely as a credit until its rent is billed.
      if (prepaymentRecognition === "on_receipt") {
        row.paidRent += unappliedAllocated;
        if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += unappliedAllocated;
        else totalRentReceivedManager += unappliedAllocated;
      }
    }

    // Rent paid ahead of its bill sits as a prepayment credit this period — same balance
    // effect as an unapplied receipt; recognised as collected in the invoice's own period.
    if (deferredPrepaymentCredit !== 0) {
      row.unappliedCredits += deferredPrepaymentCredit;
    }

    // Legacy fallback for receipts with no allocation breakdown at all (no allocations
    // array, no allocationSummary) — treat the whole amount as rent/utility collected,
    // since there's no way to know otherwise. Gated on unappliedAllocated === 0 so a
    // receipt that DOES carry a summary explicitly marking itself as an unapplied
    // prepayment (allocationSummary.unapplied > 0, everything else 0) is correctly left
    // out of Paid/collections instead of being double-booked here.
    if (
      allocationRows.length === 0 &&
      rentAllocated === 0 &&
      !cappedPrepayment &&
      utilityAllocated === 0 &&
      depositAllocated === 0 &&
      unappliedAllocated === 0 &&
      receipt.paymentType === "rent"
    ) {
      // No breakdown at all — assume rent, but still hold anything beyond what the tenant
      // owes in rent as a prepayment credit under "on_invoice_allocation".
      let fallbackRent = amount;
      if (prepaymentRecognition === "on_invoice_allocation" && fallbackRent > 0) {
        const rentDueForRow = round2(
          Math.max(0, Number(row.invoicedRent || 0) + Math.max(0, Number(row.balanceBF || 0)) - Number(row.paidRent || 0))
        );
        if (fallbackRent > rentDueForRow) {
          row.unappliedCredits += round2(fallbackRent - rentDueForRow);
          fallbackRent = rentDueForRow;
        }
      }
      row.paidRent += fallbackRent;
      if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += fallbackRent;
      else totalRentReceivedManager += fallbackRent;
    } else if (
      allocationRows.length === 0 &&
      rentAllocated === 0 &&
      !cappedPrepayment &&
      utilityAllocated === 0 &&
      depositAllocated === 0 &&
      unappliedAllocated === 0 &&
      receipt.paymentType === "utility"
    ) {
      applyUtility(row, "receipt", amount, receipt.description || "");
      if (receipt.paidDirectToLandlord) totalUtilityReceivedLandlord += amount;
      else totalUtilityReceivedManager += amount;
    }

    if (receipt.referenceNumber) row.referenceNumbers.push(receipt.referenceNumber);
    if (receipt.receiptNumber) row.referenceNumbers.push(receipt.receiptNumber);

    const receiptEntryCategory = getReceiptCategory(
      utilityAllocated !== 0 && rentAllocated === 0 ? "utility" : "rent",
      receipt.paidDirectToLandlord
    );
    const receiptUtilitySource =
      allocationRows.find((item) => String(item?.priorityGroup || "") === "utility") ||
      (Array.isArray(receipt.breakdown?.utilities) && receipt.breakdown.utilities.length > 0
        ? receipt.breakdown.utilities[0]
        : null);
    const receiptUtilityIdentity =
      receiptEntryCategory === "UTILITY_RECEIPT_MANAGER" ||
      receiptEntryCategory === "UTILITY_RECEIPT_LANDLORD"
        ? resolveUtilityIdentity(
            receiptUtilitySource?.utilityType ||
              receiptUtilitySource?.name ||
              receiptUtilitySource?.utility ||
              receipt.description ||
              "",
            {
              utilityType:
                receiptUtilitySource?.utilityType ||
                receiptUtilitySource?.name ||
                receiptUtilitySource?.utility ||
                "",
            },
            row
          )
        : null;

    pushEntry({
      tenantId: receipt.tenant,
      unitId: receipt.unit,
      transactionDate: getReceiptStatementDate(receipt) || receipt.paymentDate,
      category: receiptEntryCategory,
      amount: Math.abs(amount),
      direction: amount >= 0 ? "credit" : "debit",
      description,
      sourceTransactionType: "receipt",
      sourceTransactionId: String(receipt._id),
      metadata: {
        tenantName: row.tenantName,
        unit: row.unit,
        tenantCode: row.accountNo,
        paidDirectToLandlord: !!receipt.paidDirectToLandlord,
        statementTaxAmount: taxAllocated,
        ...(receiptUtilityIdentity
          ? {
              utilityType: receiptUtilityIdentity.label,
              statementUtilityType: receiptUtilityIdentity.label,
              statementUtilityKey: receiptUtilityIdentity.key,
            }
          : {}),
      },
    });

    if (receipt.paidDirectToLandlord) {
      directToLandlordOffset += amount;

      pushEntry({
        tenantId: receipt.tenant,
        unitId: receipt.unit,
        transactionDate: getReceiptStatementDate(receipt) || receipt.paymentDate,
        category: "ADJUSTMENT",
        amount: Math.abs(amount),
        direction: amount >= 0 ? "debit" : "credit",
        description: `Direct to landlord collection - ${row.tenantName}`,
        sourceTransactionType: "receipt",
        sourceTransactionId: String(receipt._id),
        metadata: {
          statementBucket: "direct_to_landlord",
          tenantName: row.tenantName,
          unit: row.unit,
          tenantCode: row.accountNo,
          statementTaxAmount: taxAllocated,
        },
      });
    }
  }

  for (const receipt of allDepositReceiptsInPeriod) {
    const depositBreakdown = getReceiptDepositAllocationBreakdown(receipt, resolveDepositHolderForRecord);

    if (depositBreakdown.manager > 0) {
      applyDepositReceiptToMemo({ ...receipt, depositHeldBy: "manager" }, depositBreakdown.manager, "current");
    }
    if (depositBreakdown.landlord > 0) {
      applyDepositReceiptToMemo({ ...receipt, depositHeldBy: "landlord" }, depositBreakdown.landlord, "current");
    }
    // Deposit paid this period, on the tenant's row — whichever party ends up holding it.
    // A memo column only (see registerDepositAmount); never affects the rent-ledger balance.
    if (depositBreakdown.total > 0) {
      registerDepositAmount(ensureRow(receipt.tenant, receipt.unit), "receipt", depositBreakdown.total);
    }

    const amount = round2(Number(depositBreakdown.landlord || 0));
    if (amount <= 0) continue;

    const depositHolder = "landlord";
    const row = ensureRow(receipt.tenant, receipt.unit);
    const sourceId = String(receipt._id || "");
    const additionDescription = receipt.paidDirectToLandlord
      ? `Landlord-held deposit recognised from direct landlord receipt - ${row.tenantName}`
      : `Landlord-held deposit remittance - ${row.tenantName}`;

    totalAdditions = round2(totalAdditions + amount);
    depositRemittanceAdditionsTotal = round2(depositRemittanceAdditionsTotal + amount);
    additionRows.push({
      date: getReceiptStatementDate(receipt) || receipt.paymentDate,
      description: additionDescription,
      amount,
      category: "deposit_remittance",
      sourceId,
    });
    pushDepositSettlementRow({
      date: getReceiptStatementDate(receipt) || receipt.paymentDate,
      description: additionDescription,
      amount,
      effect: "addition",
      holder: depositHolder,
      paidDirectToLandlord: !!receipt.paidDirectToLandlord,
      sourceId,
      unit: row.unit,
    });

    pushEntry({
      tenantId: receipt.tenant,
      unitId: receipt.unit,
      transactionDate: getReceiptStatementDate(receipt) || receipt.paymentDate,
      category: "ADJUSTMENT",
      amount,
      direction: "credit",
      description: additionDescription,
      sourceTransactionType: "deposit_receipt",
      sourceTransactionId: sourceId,
      metadata: {
        statementBucket: "addition",
        depositHolder,
        depositSettlement: true,
        paidDirectToLandlord: !!receipt.paidDirectToLandlord,
      },
    });

    if (receipt.paidDirectToLandlord) {
      const offsetDescription = `Offset for landlord-direct deposit receipt - ${row.tenantName}`;
      totalExtraDeductions = round2(totalExtraDeductions + amount);
      extraDeductionRows.push({
        date: getReceiptStatementDate(receipt) || receipt.paymentDate,
        description: offsetDescription,
        amount,
        category: "deposit_direct_offset",
        sourceId: `${sourceId}-offset`,
      });
      pushDepositSettlementRow({
        date: getReceiptStatementDate(receipt) || receipt.paymentDate,
        description: offsetDescription,
        amount,
        effect: "offset",
        holder: depositHolder,
        paidDirectToLandlord: true,
        sourceId: `${sourceId}-offset`,
        unit: row.unit,
      });

      pushEntry({
        tenantId: receipt.tenant,
        unitId: receipt.unit,
        transactionDate: getReceiptStatementDate(receipt) || receipt.paymentDate,
        category: "ADJUSTMENT",
        amount,
        direction: "debit",
        description: offsetDescription,
        sourceTransactionType: "deposit_receipt",
        sourceTransactionId: sourceId,
        metadata: {
          statementBucket: "deduction",
          depositHolder,
          depositSettlement: true,
          paidDirectToLandlord: true,
          depositDirectOffset: true,
        },
      });
    }
  }

  // For deposit-type receipts that also cover non-deposit charges (e.g., a debit note
  // paid on the same receipt as a security deposit), the deposit loop above only processes
  // the deposit allocations. Process the remaining allocations here so they count toward
  // paidRent / paidUtility on the statement.
  for (const receipt of allDepositReceiptsInPeriod) {
    if (receipt.paymentType !== "deposit") continue; // rent/utility receipts handled above

    // Leftover cash on a deposit-type receipt that isn't allocated to any deposit charge
    // (tagged either the old way, priorityGroup "unapplied", or the newer way,
    // isPrepayment:true placeholder rows excluded from getReceiptAllocationStatementImpact
    // above) is still real cash collected. Nothing else processes allocationSummary.
    // unapplied for a deposit-type receipt, so it must be recognised here — same rule as
    // the main receiptsInPeriod loop: always an unapplied credit, and under "on_receipt"
    // also counted as paidRent immediately.
    const unappliedRow = ensureRow(receipt.tenant, receipt.unit);
    const depositReceiptUnapplied = getReceiptSummaryAmount(receipt, "unapplied");
    if (depositReceiptUnapplied !== 0) {
      unappliedRow.unappliedCredits += depositReceiptUnapplied;
      // Real cash, just not deposit — counts toward Total Paid / raw Bal C/F same as any
      // other in-period cash (see the receiptsInPeriod loop's rawReceivedThisPeriod).
      unappliedRow.rawReceivedThisPeriod = round2(Number(unappliedRow.rawReceivedThisPeriod || 0) + depositReceiptUnapplied);
      if (prepaymentRecognition === "on_receipt") {
        unappliedRow.paidRent += depositReceiptUnapplied;
        if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += depositReceiptUnapplied;
        else totalRentReceivedManager += depositReceiptUnapplied;
      }
    }

    const mixedAllocRows = getReceiptAllocationRows(receipt);
    if (mixedAllocRows.length === 0) continue;

    const mixedHasNonDeposit = mixedAllocRows.some((a) => {
      const pg = String(a?.priorityGroup || "").toLowerCase();
      return pg && pg !== "deposit" && pg !== "unapplied";
    });
    if (!mixedHasNonDeposit) continue;

    const mixedRow = ensureRow(receipt.tenant, receipt.unit);
    let mixedRent = 0;
    let mixedUtility = 0;
    let mixedTax = 0;

    mixedAllocRows.forEach((allocationRow) => {
      const pg = String(allocationRow?.priorityGroup || "").toLowerCase();
      if (!pg || pg === "deposit" || pg === "unapplied") return;

      const sourceInvoice = invoiceStatementMap.get(String(allocationRow?.invoice || allocationRow?.invoiceId || ""));
      const impact = getReceiptAllocationStatementImpact({ allocationRow, sourceInvoice, row: mixedRow });
      if (!impact.isStatementRelevant) return;

      mixedRent    = round2(mixedRent    + Number(impact.rentAmount    || 0));
      mixedUtility = round2(mixedUtility + Number(impact.utilityAmount || 0));
      mixedTax     = round2(mixedTax     + Number(impact.taxAmount     || 0));

      (Array.isArray(impact.utilities) ? impact.utilities : []).forEach((item) => {
        applyUtility(mixedRow, "receipt", Number(item.amount || 0), item.label || allocationRow?.description || "", {
          utilityType: item.label,
          meterUtilityType: item.label,
          statementUtilityType: item.label,
        });
      });
    });

    const mixedNonDepositCash = round2(mixedRent + mixedUtility + mixedTax);
    if (mixedNonDepositCash !== 0) {
      // Same reasoning as the unapplied portion above — this is real, non-deposit cash
      // that was just bundled onto a deposit-type receipt; it belongs in Total Paid /
      // raw Bal C/F like any other in-period cash.
      mixedRow.rawReceivedThisPeriod = round2(Number(mixedRow.rawReceivedThisPeriod || 0) + mixedNonDepositCash);
    }

    if (mixedRent !== 0) {
      mixedRow.paidRent += mixedRent;
      if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += mixedRent;
      else totalRentReceivedManager += mixedRent;
    }
    if (mixedUtility !== 0) {
      if (receipt.paidDirectToLandlord) totalUtilityReceivedLandlord += mixedUtility;
      else totalUtilityReceivedManager += mixedUtility;
    }
    if (mixedTax !== 0) {
      mixedRow.paidTax += mixedTax;
      if (receipt.paidDirectToLandlord) totalInvoiceTaxReceivedLandlord += mixedTax;
      else totalInvoiceTaxReceivedManager += mixedTax;
    }
  }

  // Opening deposit balances that have never been settled in a prior statement.
  //
  // For the FIRST statement (!snapshotDate): pre-period deposit receipts appear as
  // "opening" in the memo because they predate the period start, but they have never
  // flowed through any approved statement's additionRows. Include them in this period's
  // remittance so the landlord is paid for ALL deposits they hold.
  //
  // For SUBSEQUENT statements: the opening balance came from a prior statement's snapshot
  // and was already settled in that period — do NOT include again (double-count).
  const isFirstStatement = !snapshotDate;

  const managerDepositOpening = round2(depositMemoBuckets.manager.openingBalance || 0);
  if (managerDepositOpening > 0) {
    const carryDesc = "Manager-held deposit carry-forward remittance";
    totalAdditions = round2(totalAdditions + managerDepositOpening);
    additionRows.push({
      date: periodStart,
      description: carryDesc,
      amount: managerDepositOpening,
      category: "deposit_carryforward",
      sourceId: `deposit-cf-mgr-${String(propertyObjectId)}`,
    });
    pushDepositSettlementRow({
      date: periodStart,
      description: carryDesc,
      amount: managerDepositOpening,
      effect: "addition",
      holder: "manager",
      paidDirectToLandlord: false,
      sourceId: `deposit-cf-mgr-${String(propertyObjectId)}`,
    });
    depositMemoBuckets.manager.closingBalance = round2(
      depositMemoBuckets.manager.closingBalance - managerDepositOpening
    );
  }

  // Landlord-held opening balance on the first statement: deposits collected directly by
  // the landlord before this statement period — never settled via any statement yet.
  const landlordDepositOpening = isFirstStatement
    ? round2(depositMemoBuckets.landlord.openingBalance || 0)
    : 0;
  if (landlordDepositOpening > 0) {
    const carryDesc = "Landlord-held deposit carry-forward (pre-period)";
    totalAdditions = round2(totalAdditions + landlordDepositOpening);
    additionRows.push({
      date: periodStart,
      description: carryDesc,
      amount: landlordDepositOpening,
      category: "deposit_carryforward",
      sourceId: `deposit-cf-lld-${String(propertyObjectId)}`,
    });
    pushDepositSettlementRow({
      date: periodStart,
      description: carryDesc,
      amount: landlordDepositOpening,
      effect: "addition",
      holder: "landlord",
      paidDirectToLandlord: false,
      sourceId: `deposit-cf-lld-${String(propertyObjectId)}`,
    });
  }

  for (const adjustment of statementAdjustments) {
    const amount = Number(
      adjustment.amount || adjustment.credit || adjustment.debit || 0
    );
    if (amount <= 0) continue;

    const bucket = String(adjustment?.metadata?.statementBucket || "").toLowerCase();
    const isAdvanceRecovery = bucket === "advance_recovery";
    const isAdvancePayment = bucket === "advance_payment";
    const isAddition =
      bucket === "addition" ||
      (!isAdvanceRecovery &&
        !isAdvancePayment &&
        (Number(adjustment.credit || 0) > 0 || adjustment.direction === "credit"));

    const isStandingOrderDeduction =
      String(adjustment?.metadata?.postingKind || "").toLowerCase() === "standing_order_run" ||
      String(adjustment?.sourceTransactionType || "").toLowerCase() === "recurring_deduction";

    const description =
      adjustment.notes ||
      adjustment?.metadata?.description ||
      (isAdvancePayment
        ? "Early payout already paid to landlord"
        : isAdvanceRecovery
        ? "Recoverable landlord advance recovery"
        : isStandingOrderDeduction
        ? "Standing order deduction"
        : isAddition
        ? "Statement addition"
        : "Statement deduction");

    if (isAdvancePayment) {
      totalEarlyPayouts = round2(totalEarlyPayouts + amount);
      earlyPayoutRows.push({
        date: adjustment.transactionDate,
        description,
        amount: round2(amount),
        category: "advance_payment",
        sourceId: String(adjustment._id),
      });

      pushEntry({
        tenantId: adjustment.tenant || null,
        unitId: adjustment.unit || null,
        transactionDate: adjustment.transactionDate,
        category: "ADVANCE_TO_LANDLORD",
        amount,
        direction: "debit",
        description,
        sourceTransactionType:
          adjustment.sourceTransactionType || "advance",
        sourceTransactionId:
          adjustment.sourceTransactionId || String(adjustment._id),
        metadata: {
          statementBucket: "advance_payment",
          postingKind: String(adjustment?.metadata?.postingKind || "landlord_advance_against_payable"),
          advancementId: adjustment?.metadata?.advancementId || null,
        },
      });
    } else if (isAdvanceRecovery) {
      totalAdvanceRecoveries = round2(totalAdvanceRecoveries + amount);
      advanceRecoveryRows.push({
        date: adjustment.transactionDate,
        description,
        amount: round2(amount),
        category: "advance_recovery",
        sourceId: String(adjustment._id),
      });

      pushEntry({
        tenantId: adjustment.tenant || null,
        unitId: adjustment.unit || null,
        transactionDate: adjustment.transactionDate,
        category: "ADJUSTMENT",
        amount,
        direction: "debit",
        description,
        sourceTransactionType:
          adjustment.sourceTransactionType || "advance",
        sourceTransactionId:
          adjustment.sourceTransactionId || String(adjustment._id),
        metadata: {
          statementBucket: "advance_recovery",
          postingKind: String(adjustment?.metadata?.postingKind || "landlord_advancement_recovery"),
          advancementId: adjustment?.metadata?.advancementId || null,
        },
      });
    } else if (isAddition) {
      totalAdditions += amount;
      additionRows.push({
        date: adjustment.transactionDate,
        description,
        amount: round2(amount),
        category: "addition",
        sourceId: String(adjustment._id),
      });

      pushEntry({
        tenantId: adjustment.tenant || null,
        unitId: adjustment.unit || null,
        transactionDate: adjustment.transactionDate,
        category: "ADJUSTMENT",
        amount,
        direction: "credit",
        description,
        sourceTransactionType:
          adjustment.sourceTransactionType || "manual_adjustment",
        sourceTransactionId:
          adjustment.sourceTransactionId || String(adjustment._id),
        metadata: { statementBucket: "addition" },
      });
    } else {
      totalExtraDeductions += amount;
      extraDeductionRows.push({
        date: adjustment.transactionDate,
        description,
        amount: round2(amount),
        category: isStandingOrderDeduction ? "standing_order_deduction" : "adjustment_deduction",
        sourceId: String(adjustment._id),
      });

      pushEntry({
        tenantId: adjustment.tenant || null,
        unitId: adjustment.unit || null,
        transactionDate: adjustment.transactionDate,
        category: "ADJUSTMENT",
        amount,
        direction: "debit",
        description,
        sourceTransactionType:
          adjustment.sourceTransactionType || "manual_adjustment",
        sourceTransactionId:
          adjustment.sourceTransactionId || String(adjustment._id),
        metadata: {
          statementBucket: "deduction",
          ...(isStandingOrderDeduction ? { postingKind: "standing_order_run" } : {}),
        },
      });
    }
  }

  const expenseRecordIdsInPeriod = new Set(
    expensesInPeriod.map((expense) => String(expense?._id || "")).filter(Boolean)
  );

  const voucherExpenseRows = vouchersInPeriod
    .map((voucher) => {
      const voucherCategory = getVoucherExpenseCategory(voucher?.category);
      if (!voucherCategory) return null;

      const effectiveDate = resolveVoucherStatementDate(voucher);
      if (!effectiveDate) return null;
      if (effectiveDate.getTime() < periodStart.getTime() || effectiveDate.getTime() > periodEnd.getTime()) {
        return null;
      }

      const expenseRecordId = String(voucher?.expenseRecord || "");
      if (expenseRecordId && expenseRecordIdsInPeriod.has(expenseRecordId)) {
        return null;
      }

      return {
        date: effectiveDate,
        description:
          String(voucher?.narration || voucher?.reference || `Payment voucher ${voucher?.voucherNo || ""}`).trim() ||
          `Payment voucher ${voucher?.voucherNo || ""}`.trim(),
        amount: round2(voucher?.amount),
        category: voucherCategory,
        sourceId: String(voucher?._id || ""),
        unit: "",
        sourceTransactionType: "payment_voucher",
        metadata: {
          voucherNo: voucher?.voucherNo || "",
          voucherCategory: voucher?.category || "",
          expenseRecordId,
        },
      };
    })
    .filter(Boolean);

  const rawExpenseRows = [
    ...expensesInPeriod.map((expense) => ({
      date: expense.date,
      description: expense.description || `Property expense - ${expense.category}`,
      amount: round2(expense.amount),
      category: expense.category || "expense",
      sourceId: String(expense._id),
      unit: expense.unit ? String(expense.unit) : "",
      sourceTransactionType: "expense",
      metadata: {
        expenseCategory: expense.category,
      },
    })),
    ...voucherExpenseRows,
  ];

  const cleanedPropertyExpenseRows = dedupeExpenseRowsAgainstAdditions({
    expenseRows: rawExpenseRows,
    additionRows,
  });

  let totalExpenses = 0;

  for (const expense of cleanedPropertyExpenseRows) {
    const amount = Number(expense.amount || 0);
    if (amount <= 0) continue;

    totalExpenses += amount;

    pushEntry({
      tenantId: null,
      unitId: expense.unit || null,
      transactionDate: expense.date,
      category: "EXPENSE_DEDUCTION",
      amount,
      direction: "debit",
      description: expense.description || `Property expense - ${expense.category}`,
      sourceTransactionType: expense.sourceTransactionType || "expense",
      sourceTransactionId: String(expense.sourceId || ""),
      metadata: {
        expenseCategory: expense.category,
        ...(expense.metadata && typeof expense.metadata === "object" ? expense.metadata : {}),
      },
    });
  }

  // Bal B/F / Bal C/F show the tenant's TRUE running balance — the same figure their own
  // Tenant Statement and Paid & Balance report already show — computed as a plain raw
  // ledger (gross invoices minus gross cash received, no allocation-row tracing) so the
  // two always reconcile with each other by construction. This is purely a balance/
  // display figure: commission and remittance totals are computed separately, above, from
  // row.paidRent / unappliedCredits (which stay capped/deferred under "on_invoice_
  // allocation" so a manager never earns commission on cash before it's actually rent, or
  // remits a prepayment twice) — nothing about that math changes here. Total Paid follows
  // the same logic: it shows the real cash received this period, not the capped/recognised
  // paidRent figure.
  for (const invoice of invoicesBefore) {
    if (!shouldIncludeInvoiceInLandlordStatement(invoice)) continue;
    if (invoice.category !== "RENT_CHARGE" && invoice.category !== "UTILITY_CHARGE") continue;
    const row = ensureRow(invoice.tenant, invoice.unit);
    row.rawBalanceBF = round2(Number(row.rawBalanceBF || 0) + Number(invoice.amount || 0));
  }
  for (const note of notesBefore) {
    if (!shouldIncludeNoteInLandlordStatement(note)) continue;
    if (note.category !== "RENT_CHARGE" && note.category !== "UTILITY_CHARGE") continue;
    const row = ensureRow(note.tenant, note.unit);
    row.rawBalanceBF = round2(Number(row.rawBalanceBF || 0) + Number(getSignedNoteAmount(note) || 0));
  }
  // A receipt's FULL amount is not automatically rent-ledger cash — it may also cover a
  // deposit, a late penalty, or some other non-rent charge bundled onto the same receipt
  // (e.g. "first month rent + security deposit" paid together, tagged paymentType "rent"
  // as a whole even though part of it is really a deposit). Only the portion that is
  // actually rent/utility (or genuinely unapplied, still real rent-ledger cash just not
  // yet matched to a bill) belongs here — reusing the same per-row classification the
  // invoiced side already uses so the two never drift apart.
  const getReceiptRentLedgerCash = (receipt) => {
    const allocationRows = getReceiptAllocationRows(receipt);
    // Every invoice:null row (isPrepayment-tagged or not — a receipt can carry a plain,
    // untagged unapplied row too) is already summed into allocationSummary.unapplied at
    // save time. Seeding `cash` from that AND then also walking every such row in the
    // loop below double-counts it — the loop below must only ever look at rows that
    // target a real invoice.
    let cash = round2(Number(getReceiptSummaryAmount(receipt, "unapplied") || 0));
    if (allocationRows.length > 0) {
      allocationRows.forEach((allocationRow) => {
        if (!allocationRow?.invoice) return;
        const sourceInvoice = invoiceStatementMap.get(String(allocationRow?.invoice || allocationRow?.invoiceId || ""));
        const impact = getReceiptAllocationStatementImpact({ allocationRow, sourceInvoice, row: null });
        cash = round2(cash + Number(impact.statementRelevantAmount || 0));
      });
    } else {
      cash = round2(
        cash +
          Number(getReceiptSummaryAmount(receipt, "rent") || 0) +
          Number(getReceiptSummaryAmount(receipt, "utility") || 0)
      );
    }
    return cash;
  };

  for (const receipt of receiptsBefore) {
    // When a balance snapshot exists, rawBalanceBF is seeded straight from the snapshot's
    // balanceCF (see ensureRow above) — a receipt whose own recognition date is already
    // before that snapshot's cutoff was fully accounted for when the snapshot was taken,
    // so deducting its cash again here would double-count it. It only appears in
    // receiptsBefore at all (via the uncapped `updatedAt` fetch clause) because it gained
    // a fresh allocation afterward — real receiptsBefore GAP receipts (dated between the
    // snapshot cutoff and this period's start) still need deducting as before.
    const recognitionDate = getReceiptStatementDate(receipt);
    const recognitionTime = recognitionDate ? new Date(recognitionDate).getTime() : NaN;
    if (snapshotDate && Number.isFinite(recognitionTime) && recognitionTime < snapshotDate.getTime()) {
      continue;
    }
    const row = ensureRow(receipt.tenant, receipt.unit);
    row.rawBalanceBF = round2(Number(row.rawBalanceBF || 0) - getReceiptRentLedgerCash(receipt));
  }
  for (const receipt of receiptsInPeriod) {
    const row = ensureRow(receipt.tenant, receipt.unit);
    row.rawReceivedThisPeriod = round2(Number(row.rawReceivedThisPeriod || 0) + getReceiptRentLedgerCash(receipt));
  }

  const tenantRows = Array.from(rowsMap.values())
    .map((row) => {
      row.balanceBF = round2(Number(row.rawBalanceBF || 0));
      row.invoicedRent = round2(row.invoicedRent);
      row.invoicedGarbage = round2(row.invoicedGarbage);
      row.invoicedWater = round2(row.invoicedWater);
      row.invoicedTax = round2(row.invoicedTax);
      row.paidRent = round2(row.paidRent);
      row.paidGarbage = round2(row.paidGarbage);
      row.paidWater = round2(row.paidWater);
      row.paidTax = round2(row.paidTax);
      row.unappliedCredits = round2(row.unappliedCredits);
      row.utilities = Object.fromEntries(
        Object.entries(row.utilities || {}).map(([key, item]) => [
          key,
          {
            key: normalizeUtilityKey(item?.key || key),
            label:
              item?.label ||
              titleCase(String(item?.key || key).replace(/_/g, " ")) ||
              defaultUtilityLabel,
            invoiced: round2(Number(item?.invoiced || 0)),
            paid: round2(Number(item?.paid || 0)),
          },
        ])
      );
      row.totalUtilityInvoiced = round2(sumUtilityPhase(row, "invoice"));
      row.totalUtilityPaid = round2(sumUtilityPhase(row, "receipt"));
      // Deposit is a memo column only — normalised the same way as utilities, but
      // deliberately excluded from balanceCF below (it is a liability, not rent-ledger
      // income, so it must never change what the tenant owes in rent).
      row.deposits = Object.fromEntries(
        Object.entries(row.deposits || {}).map(([key, item]) => [
          key,
          {
            key: item?.key || key,
            label: item?.label || "Deposit",
            invoiced: round2(Number(item?.invoiced || 0)),
            paid: round2(Number(item?.paid || 0)),
          },
        ])
      );
      row.totalDepositInvoiced = round2(sumDepositPhase(row, "invoice"));
      row.totalDepositPaid = round2(sumDepositPhase(row, "receipt"));
      // Raw ledger: gross invoiced minus gross cash actually received this period —
      // deliberately NOT row.paidRent (that figure stays capped/deferred by the
      // recognition logic above, which protects commission/remittance math only).
      row.balanceCF = round2(
        row.balanceBF + row.invoicedRent + row.totalUtilityInvoiced + row.invoicedTax - Number(row.rawReceivedThisPeriod || 0)
      );
      row.referenceNumbers = Array.from(
        new Set((row.referenceNumbers || []).filter(Boolean))
      );
      row.hasTransactionInPeriod = false;
      return row;
    });

  const rowsByTenantId = new Map();
  tenantRows.forEach((row) => {
    const tenantId = String(row?.tenantId || "").trim();
    if (!tenantId) return;
    if (!rowsByTenantId.has(tenantId)) rowsByTenantId.set(tenantId, []);
    rowsByTenantId.get(tenantId).push(row);
  });

  entries.forEach((entry) => {
    const tenantId = String(entry?.tenant || "").trim();
    if (!tenantId) return;

    const entryDate = entry?.transactionDate ? new Date(entry.transactionDate) : null;
    if (!entryDate || Number.isNaN(entryDate.getTime())) return;
    if (entryDate.getTime() < periodStart.getTime() || entryDate.getTime() > periodEnd.getTime()) return;

    const tenantRowsForEntry = rowsByTenantId.get(tenantId) || [];
    tenantRowsForEntry.forEach((row) => {
      row.hasTransactionInPeriod = true;
    });
  });

  // A tenant who occupies several units (tenant.unit + tenant.additionalUnits, all within
  // this property) has ONE ledger, not one per unit — a rent payment is recorded against a
  // single unit, so the per-(unit,tenant) rows built above would show that unit hugely
  // overpaid and the others unpaid even though the tenant's real position nets out. This
  // folds those rows into one consolidated row (all figures summed, units listed together),
  // matching how the Tenant Paid & Balance report presents multi-unit tenants, so the
  // schedule grid, its PDF, and the stored processed-statement rows all show the true
  // position. The underlying per-transaction LandlordStatementLine records and every
  // summary aggregate are built from `entries`, not these rows, so they are unaffected —
  // merging preserves all column sums by construction. Per-unit invoiced detail is kept on
  // `unitBreakdown` for an expandable view. VACANT and single-unit rows pass through as-is.
  const consolidateMultiUnitTenantRows = (rows) => {
    const SUM_FIELDS = [
      "balanceBF", "invoicedRent", "invoicedGarbage", "invoicedWater", "invoicedTax",
      "paidRent", "paidGarbage", "paidWater", "paidTax", "unappliedCredits",
      "totalUtilityInvoiced", "totalUtilityPaid", "totalDepositInvoiced", "totalDepositPaid", "perMonth",
      "rawReceivedThisPeriod",
    ];
    const groups = new Map();
    const passthrough = [];
    for (const row of rows) {
      const tenantId = String(row?.tenantId || "").trim();
      if (!tenantId || Number(row?.multiUnitCount || 1) <= 1) {
        passthrough.push(row);
        continue;
      }
      if (!groups.has(tenantId)) groups.set(tenantId, []);
      groups.get(tenantId).push(row);
    }

    const mergedRows = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        // Their other units live in another property — nothing to consolidate here.
        mergedRows.push(group[0]);
        continue;
      }

      const base = { ...group[0] };
      SUM_FIELDS.forEach((f) => {
        base[f] = round2(group.reduce((sum, r) => sum + Number(r[f] || 0), 0));
      });

      const utilities = {};
      for (const r of group) {
        for (const [key, item] of Object.entries(r.utilities || {})) {
          if (!utilities[key]) {
            utilities[key] = { key: item?.key || key, label: item?.label || key, invoiced: 0, paid: 0 };
          }
          utilities[key].invoiced = round2(utilities[key].invoiced + Number(item?.invoiced || 0));
          utilities[key].paid = round2(utilities[key].paid + Number(item?.paid || 0));
        }
      }
      base.utilities = utilities;

      const deposits = {};
      for (const r of group) {
        for (const [key, item] of Object.entries(r.deposits || {})) {
          if (!deposits[key]) {
            deposits[key] = { key: item?.key || key, label: item?.label || key, invoiced: 0, paid: 0 };
          }
          deposits[key].invoiced = round2(deposits[key].invoiced + Number(item?.invoiced || 0));
          deposits[key].paid = round2(deposits[key].paid + Number(item?.paid || 0));
        }
      }
      base.deposits = deposits;

      base.balanceCF = round2(
        base.balanceBF + base.invoicedRent + base.totalUtilityInvoiced + base.invoicedTax - base.rawReceivedThisPeriod
      );

      const unitLabels = (
        Array.isArray(group[0].multiUnitLabels) && group[0].multiUnitLabels.length > 0
          ? [...group[0].multiUnitLabels]
          : Array.from(new Set(group.map((r) => r.unit).filter(Boolean)))
      ).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      base.unit = unitLabels.join(", ");
      base.unitNumber = base.unit;
      base.referenceNumbers = Array.from(
        new Set(group.flatMap((r) => r.referenceNumbers || []).filter(Boolean))
      );
      base.hasTransactionInPeriod = group.some((r) => r.hasTransactionInPeriod === true);
      base.consolidatedUnitCount = group.length;
      base.unitBreakdown = group.map((r) => ({
        unit: r.unit,
        unitId: r.unitId,
        balanceBF: round2(Number(r.balanceBF || 0)),
        invoicedRent: round2(Number(r.invoicedRent || 0)),
        invoicedTax: round2(Number(r.invoicedTax || 0)),
        totalUtilityInvoiced: round2(Number(r.totalUtilityInvoiced || 0)),
        paidRent: round2(Number(r.paidRent || 0)),
        totalUtilityPaid: round2(Number(r.totalUtilityPaid || 0)),
        paidTax: round2(Number(r.paidTax || 0)),
        balanceCF: round2(Number(r.balanceCF || 0)),
      }));

      mergedRows.push(base);
    }

    return [...passthrough, ...mergedRows].sort((a, b) =>
      String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true })
    );
  };

  let filteredTenantRows = tenantRows
    .filter((row) => {
      if (String(row?.tenantName || "").toUpperCase() === "VACANT") return true;

      const tenantRecord = tenantMap.get(String(row?.tenantId || "")) || null;
      const tenantStatus = safeName(tenantRecord?.status || "");

      // Keep occupied / active tenant rows visible even when the current period has
      // no new activity so the next statement grid remains continuous and truthful.
      // Former / terminated tenants should still only appear when they had statement
      // activity in the current window.
      if (tenantStatus !== "terminated") return true;
      return row.hasTransactionInPeriod === true;
    })
    .map((row) => {
      if (String(row?.tenantName || "").toUpperCase() === "VACANT") return row;

      const tenantRecord = tenantMap.get(String(row?.tenantId || "")) || null;
      const tenantStatus = safeName(tenantRecord?.status || "");
      if (tenantStatus === "terminated") {
        return {
          ...row,
          tenantName: row.tenantName.includes("(Former Tenant)")
            ? row.tenantName
            : `${row.tenantName} (Former Tenant)`,
        };
      }

      return row;
    })
    .sort((a, b) =>
      String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true })
    );

  filteredTenantRows = consolidateMultiUnitTenantRows(filteredTenantRows);

  const utilityColumns = buildUtilityColumns(filteredTenantRows);
  const utilityTotalsMap = utilityColumns.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});

  const depositColumns = buildDepositColumns(filteredTenantRows);

  const totalRentInvoiced = round2(
    filteredTenantRows.reduce((sum, row) => sum + row.invoicedRent, 0)
  );
  const totalGarbageInvoiced = round2(
    Number(utilityTotalsMap.garbage?.invoiced || 0)
  );
  const totalWaterInvoiced = round2(
    Number(utilityTotalsMap.water?.invoiced || 0)
  );
  const totalRentReceived = round2(
    filteredTenantRows.reduce((sum, row) => sum + row.paidRent, 0)
  );
  const totalInvoiceVatInvoiced = round2(
    filteredTenantRows.reduce((sum, row) => sum + Number(row.invoicedTax || 0), 0)
  );
  const totalInvoiceVatReceived = round2(
    filteredTenantRows.reduce((sum, row) => sum + Number(row.paidTax || 0), 0)
  );
  const totalGarbageReceived = round2(
    Number(utilityTotalsMap.garbage?.paid || 0)
  );
  const totalWaterReceived = round2(
    Number(utilityTotalsMap.water?.paid || 0)
  );
  const totalUtilityInvoiced = round2(
    utilityColumns.reduce((sum, item) => sum + Number(item.invoiced || 0), 0)
  );
  const totalUtilityCollected = round2(
    utilityColumns.reduce((sum, item) => sum + Number(item.paid || 0), 0)
  );
  const totalDepositInvoiced = round2(
    depositColumns.reduce((sum, item) => sum + Number(item.invoiced || 0), 0)
  );
  const totalDepositCollected = round2(
    depositColumns.reduce((sum, item) => sum + Number(item.paid || 0), 0)
  );
  const totalBalanceBF = round2(
    filteredTenantRows.reduce((sum, row) => sum + row.balanceBF, 0)
  );
  const totalBalanceCF = round2(
    filteredTenantRows.reduce((sum, row) => sum + row.balanceCF, 0)
  );
  const totalRawReceived = round2(
    filteredTenantRows.reduce((sum, row) => sum + Number(row.rawReceivedThisPeriod || 0), 0)
  );

  // No manager, no management commission — force to 0 regardless of whatever stray
  // commissionPercentage/commissionFixedAmount the property record happens to carry
  // (e.g. left over from a mode switch), rather than trusting that data is always clean.
  const commissionPct = selfManaged ? 0 : Number(property.commissionPercentage || 0);
  const recognitionBasis = normalizeCommissionRecognitionBasis(
    property.commissionRecognitionBasis || "received"
  );
  const commissionPaymentMode = String(
    property.commissionPaymentMode || "percentage"
  ).toLowerCase();
  const commissionFixedAmount = selfManaged ? 0 : Number(property.commissionFixedAmount || 0);

  let commissionBase = totalRentReceived;
  let commissionBaseLabel = "Total rent received";
  if (recognitionBasis === "invoiced") {
    commissionBase = totalRentInvoiced;
    commissionBaseLabel = "Rent invoiced";
  }
  if (recognitionBasis === "received_manager_only") {
    commissionBase = totalRentReceivedManager;
    commissionBaseLabel = "Manager-held rent received";
  }

  const occupiedRentRoll = round2(
    filteredTenantRows.reduce((sum, row) => {
      if (String(row?.tenantName || "").toUpperCase() === "VACANT") return sum;
      return sum + Number(row?.perMonth || 0);
    }, 0)
  );

  const commissionAmount =
    round2(commissionBase) > 0
      ? calculateCommissionAmount({
          paymentMode: commissionPaymentMode,
          percentage: commissionPct,
          fixedAmount: commissionFixedAmount,
          commissionBase,
        })
      : 0;

  const commissionDescription = buildCommissionDescription({
    paymentMode: commissionPaymentMode,
    percentage: commissionPct,
    fixedAmount: commissionFixedAmount,
  });

  const companyTaxConfig =
    commissionAmount > 0 ? await getCompanyTaxConfiguration(businessId) : null;
  const commissionTaxSnapshot =
    commissionAmount > 0
      ? buildCommissionTaxSnapshot({
          commissionAmount,
          propertyTaxSettings: property.commissionTaxSettings || {},
          companyTaxConfig,
        })
      : {
          taxAmount: 0,
          grossAmount: commissionAmount,
        };
  const commissionTaxAmount = round2(commissionTaxSnapshot.taxAmount || 0);
  const commissionGrossAmount = round2(
    commissionTaxSnapshot.grossAmount || commissionAmount
  );

  if (commissionAmount > 0) {
    pushEntry({
      transactionDate: periodEnd,
      category: "COMMISSION_CHARGE",
      amount: commissionAmount,
      direction: "debit",
      description: commissionDescription,
      sourceTransactionType: "statement_commission",
      sourceTransactionId: `${propertyObjectId}-${periodStart.toISOString()}`,
      metadata: {
        commissionPercentage: commissionPct,
        commissionBasis: recognitionBasis,
        commissionPaymentMode,
        commissionFixedAmount: round2(commissionFixedAmount),
        commissionTaxSnapshot,
      },
    });

    if (commissionTaxAmount > 0) {
      pushEntry({
        transactionDate: periodEnd,
        category: "COMMISSION_CHARGE",
        amount: commissionTaxAmount,
        direction: "debit",
        description: `VAT on management commission (${commissionTaxSnapshot.taxRate}%)`,
        sourceTransactionType: "statement_commission_tax",
        sourceTransactionId: `${propertyObjectId}-${periodStart.toISOString()}-tax`,
        metadata: {
          commissionTaxSnapshot,
          postingRole: "commission_output_vat",
        },
      });
    }
  }

  const managerCollections = round2(
    totalRentReceivedManager + totalUtilityReceivedManager + totalInvoiceTaxReceivedManager
  );
  const directToLandlordCollections = round2(
    totalRentReceivedLandlord + totalUtilityReceivedLandlord + totalInvoiceTaxReceivedLandlord
  );
  const directRentCollections = round2(totalRentReceivedLandlord);
  const directUtilityCollections = round2(totalUtilityReceivedLandlord + totalInvoiceTaxReceivedLandlord);
  const totalCollections = round2(
    managerCollections + directToLandlordCollections
  );
  const expectedCollections = round2(
    totalRentInvoiced + totalUtilityInvoiced + totalInvoiceVatInvoiced
  );

  const usesExpectedRentSettlement = recognitionBasis === "invoiced";
  const settlementBasisAmount = round2(
    usesExpectedRentSettlement ? totalRentInvoiced : managerCollections
  );
  const settlementBasisLabel = usesExpectedRentSettlement
    ? "Rent expected (Invoiced/Accrual)"
    : (selfManaged ? "Total collections" : "Manager-held collections")
  ;
  const utilityPassThroughAmount = round2(
    usesExpectedRentSettlement ? totalUtilityInvoiced : 0
  );
  const utilityPassThroughLabel = usesExpectedRentSettlement
    ? "Utilities (added as billed)"
    : "";
  const invoiceVatPassThroughAmount = round2(
    usesExpectedRentSettlement ? totalInvoiceVatInvoiced : 0
  );
  const invoiceVatPassThroughLabel = usesExpectedRentSettlement
    ? "Invoice VAT (pass-through)"
    : "";
  const settlementCollections = round2(
    settlementBasisAmount + utilityPassThroughAmount + invoiceVatPassThroughAmount
  );
  const settlementCollectionsLabel = usesExpectedRentSettlement
    ? "Expected rent + utilities + VAT"
    : (selfManaged ? "Total collections" : "Manager-held collections");
  const basisCollections = settlementBasisAmount;
  const basisCollectionsLabel = settlementBasisLabel;

  const nonCommissionDeductions = round2(totalExpenses + totalExtraDeductions);
  const deductions = round2(nonCommissionDeductions + commissionGrossAmount);
  const landlordOffsets = round2(directToLandlordOffset);
  const additionsTotal = round2(totalAdditions || 0);
  const extraDeductionsTotal = round2(totalExtraDeductions || 0);
  // Display-only figures for the Additions / Expenses & Deductions breakdowns (and the
  // workspace Expenses KPI): a landlord-direct deposit receipt is booked as BOTH an
  // addition (money now recognised as held by the landlord) AND an equal offsetting
  // deduction (since the manager never actually held it) — the pair always nets to zero
  // and never changes netRemittance below, but showing both halves separately made the
  // Additions and Expenses totals look inflated by the exact same deposit amount, and the
  // "Offset for landlord-direct deposit receipt" line reads like money being taken from
  // the landlord. That deposit is already shown once, correctly, in the Deposit
  // Remittance / "Deposits You Now Hold" section — so it's excluded here.
  const displayAdditionsTotal = round2(
    Math.max(additionsTotal - depositRemittanceAdditionsTotal, 0)
  );
  const displayNonCommissionDeductions = round2(
    Math.max(nonCommissionDeductions - (depositSettlementTotals.offsets || 0), 0)
  );
  const advanceRecoveriesTotal = round2(totalAdvanceRecoveries || 0);
  const earlyPayoutsTotal = round2(totalEarlyPayouts || 0);
  const openingSettlementBalance = round2(openingLandlordSettlementBalance);
  const netRemittance = round2(
    openingSettlementBalance +
      settlementCollections +
      additionsTotal -
      deductions -
      advanceRecoveriesTotal -
      earlyPayoutsTotal
  );

  const depositMemoRows = Object.values(depositMemoBuckets)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      openingBalance: round2(bucket.openingBalance),
      billed: round2(bucket.billed),
      received: round2(bucket.received),
      closingBalance: round2(bucket.closingBalance),
    }))
    .filter(
      (bucket) => Number(bucket.billed || 0) !== 0 || Number(bucket.received || 0) !== 0
    );

  const depositMemoTotals = depositMemoRows.reduce(
    (acc, bucket) => ({
      openingBalance: round2(acc.openingBalance + bucket.openingBalance),
      billed: round2(acc.billed + bucket.billed),
      received: round2(acc.received + bucket.received),
      closingBalance: round2(acc.closingBalance + bucket.closingBalance),
    }),
    { openingBalance: 0, billed: 0, received: 0, closingBalance: 0 }
  );

  const depositSettlementNet = round2(
    depositSettlementTotals.additions - depositSettlementTotals.offsets
  );

  const depositsHeldByManager = round2(depositMemoBuckets.manager.closingBalance);
  const depositsHeldByLandlord = round2(depositMemoBuckets.landlord.closingBalance);

  let occupiedUnits = 0;
  let vacantUnits = 0;
  for (const row of filteredTenantRows) {
    if (row.tenantName === "VACANT") vacantUnits++;
    // A consolidated multi-unit tenant row still represents several occupied units.
    else occupiedUnits += Number(row.consolidatedUnitCount || 1);
  }

  const expenseRows = [
    ...cleanedPropertyExpenseRows,
    ...extraDeductionRows,
    ...(commissionAmount > 0
      ? [
          {
            date: periodEnd,
            description: commissionDescription,
            amount: commissionAmount,
            category: "commission",
            sourceId: `commission-${propertyObjectId}-${periodStart.toISOString()}`,
          },
          ...(commissionTaxAmount > 0
            ? [{
                date: periodEnd,
                description: `VAT on management commission (${commissionTaxSnapshot.taxRate}%)`,
                amount: commissionTaxAmount,
                category: "commission_tax",
                sourceId: `commission-tax-${propertyObjectId}-${periodStart.toISOString()}`,
              }]
            : []),
        ]
      : []),
  ];

  const directToLandlordRows = receiptsInPeriod
    .filter((r) => r.paidDirectToLandlord)
    .sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate))
    .map((r) => {
      const row = ensureRow(r.tenant, r.unit);
      const paymentType = String(r.paymentType || "rent").toLowerCase();
      const typeLabel = paymentType === "utility" ? "Utilities" : "Rent";
      return {
        date: r.paymentDate,
        description: `${row.tenantName} — ${typeLabel} (Direct)`,
        amount: round2(Math.abs(r.amount)),
        category: "direct_to_landlord",
        sourceId: String(r._id),
        tenantName: row.tenantName,
        tenantCode: row.accountNo,
        unit: row.unit,
        paymentType,
        typeLabel,
        receiptRef: r.referenceNumber || r.receiptNumber || "",
      };
    });

  const statementPeriodLabel = buildStatementPeriodLabel(periodStart, periodEnd);

  const workspace = {
    periodLabel: statementPeriodLabel,
    statementPeriodLabel,
    statementPeriodStart: periodStart,
    statementPeriodEnd: periodEnd,
    statementMonthLabel: `${periodStart.toLocaleString("en-KE", {
      month: "long",
    })} ${periodStart.getFullYear()}`,
    propertyLabel: `${property.propertyCode ? `[${property.propertyCode}] ` : ""}${
      property.propertyName || property.name || "Property"
    }`,
    landlordLabel: (() => {
      const ll =
        (property.landlords || []).find(
          (l) => String(l.landlordId) === String(landlordId)
        ) || {};
      return (
        ll.name ||
        landlordRecord?.landlordName ||
        landlordRecord?.email ||
        landlordRecord?.phoneNumber ||
        "Landlord"
      );
    })(),
    utilityColumns,
    depositColumns,
    rows: filteredTenantRows.map((row) => ({
      ...row,
      unitNumber: row.unit,
      openingBalance: row.balanceBF,
      closingBalance: row.balanceCF,
      // Every shilling actually received this period — rent, utility, tax, deposit, and
      // any leftover unapplied cash — matching what "Total Paid" means on the Tenant
      // Statement / Paid & Balance report. Not row.paidRent alone (that stays capped for
      // commission purposes) and not rawReceivedThisPeriod alone (that deliberately
      // excludes deposit so it never feeds Bal C/F, a rent-ledger-only figure) — this is
      // the true grand total, so it visibly reconciles against Total Invoiced (rent +
      // deposit) the way Bal C/F's own math already does internally.
      totalPaid: round2(Number(row.rawReceivedThisPeriod || 0) + Number(row.totalDepositPaid || 0)),
      unappliedCredits: round2(row.unappliedCredits || 0),
      balance: row.balanceCF,
    })),
    totals: {
      perMonth: round2(filteredTenantRows.reduce((sum, row) => sum + row.perMonth, 0)),
      openingBalance: totalBalanceBF,
      invoicedRent: totalRentInvoiced,
      invoicedGarbage: totalGarbageInvoiced,
      invoicedWater: totalWaterInvoiced,
      invoicedTax: totalInvoiceVatInvoiced,
      paidRent: totalRentReceived,
      rentPaid: totalRentReceived,
      paidGarbage: totalGarbageReceived,
      paidWater: totalWaterReceived,
      paidTax: totalInvoiceVatReceived,
      utilities: utilityColumns,
      utilityPaid: totalUtilityCollected,
      utilityInvoiced: totalUtilityInvoiced,
      deposits: depositColumns,
      depositPaid: totalDepositCollected,
      depositInvoiced: totalDepositInvoiced,
      expenses: displayNonCommissionDeductions,
      totalPaid: round2(totalRawReceived + totalDepositCollected),
      closingBalance: totalBalanceCF,
    },
    expenseRows,
    deductionRows: expenseRows,
    additionRows,
    advanceRecoveryRows,
    earlyPayoutRows,
    directToLandlordRows,
    depositMemo: {
      rows: depositMemoRows,
      totals: depositMemoTotals,
    },
    depositSettlement: {
      rows: depositSettlementRows,
      totals: {
        additions: round2(depositSettlementTotals.additions),
        offsets: round2(depositSettlementTotals.offsets),
        netImpact: depositSettlementNet,
      },
    },
    broughtForwardCreditApplications: {
      rows: broughtForwardCreditApplicationRows.sort(
        (a, b) => new Date(a.chargeDate || a.date || 0) - new Date(b.chargeDate || b.date || 0)
      ),
      totals: {
        totalApplied: round2(broughtForwardCreditApplicationTotals.totalApplied),
        rentApplied: round2(broughtForwardCreditApplicationTotals.rentApplied),
        utilityApplied: round2(broughtForwardCreditApplicationTotals.utilityApplied),
        taxApplied: round2(broughtForwardCreditApplicationTotals.taxApplied),
      },
    },
    rowCount: filteredTenantRows.length,
    summary: {
      openingBalance: totalBalanceBF,
      closingBalance: totalBalanceCF,
      rentInvoiced: totalRentInvoiced,
      totalRentInvoiced: totalRentInvoiced,
      utilityInvoiced: totalUtilityInvoiced,
      totalUtilityInvoiced: totalUtilityInvoiced,
      depositColumns,
      totalDepositInvoiced,
      totalInvoiceVatInvoiced,
      expectedCollections,
      basisCollections,
      basisCollectionsLabel,
      settlementCollections,
      settlementCollectionsLabel,
      settlementBasisAmount,
      settlementBasisLabel,
      utilityPassThroughAmount,
      utilityPassThroughLabel,
      invoiceVatPassThroughAmount,
      invoiceVatPassThroughLabel,
      managerCollections,
      totalCollections,
      totalRentReceived: totalRentReceived,
      totalRentReceivedManager: totalRentReceivedManager,
      totalRentReceivedLandlord: totalRentReceivedLandlord,
      totalInvoiceVatReceived,
      totalInvoiceVatReceivedManager: round2(totalInvoiceTaxReceivedManager),
      totalInvoiceVatReceivedLandlord: round2(totalInvoiceTaxReceivedLandlord),
      totalUtilityCollected,
      totalDepositCollected,
      unappliedPayments: round2(filteredTenantRows.reduce((sum, row) => sum + Number(row.unappliedCredits || 0), 0)),
      directToLandlordCollections,
      totalDirectToLandlordCollections: directToLandlordCollections,
      directRentCollections,
      directUtilityCollections,
      openingLandlordSettlementBalance: openingSettlementBalance,
      openingSettlementBalance,
      additions: displayAdditionsTotal,
      totalAdditions: displayAdditionsTotal,
      deductions,
      totalDeductions: deductions,
      nonCommissionDeductions: displayNonCommissionDeductions,
      totalExpenses: round2(totalExpenses),
      advanceRecoveries: advanceRecoveriesTotal,
      totalAdvanceRecoveries: advanceRecoveriesTotal,
      alreadyPaidToLandlord: earlyPayoutsTotal,
      totalEarlyPayouts: earlyPayoutsTotal,
      netBeforeAdvancePayments: round2(
        openingSettlementBalance + settlementCollections + additionsTotal - deductions - advanceRecoveriesTotal
      ),
      directToLandlordOffsets: landlordOffsets,
      netStatement: netRemittance,
      amountPayableToLandlord: netRemittance > 0 ? netRemittance : 0,
      netPayableToLandlord: netRemittance > 0 ? netRemittance : 0,
      isNegativeStatement: netRemittance < 0,
      amountPayableByLandlordToManager:
        netRemittance < 0 ? Math.abs(netRemittance) : 0,
      settlementAmount:
        netRemittance < 0 ? Math.abs(netRemittance) : netRemittance,
      settlementLabel: selfManaged
        ? "Net Operating Income This Period"
        : (netRemittance < 0 ? "Landlord owes manager" : "Net payable to landlord"),
      isSelfManaged: selfManaged,
      propertyExpenses: round2(totalExpenses),
      extraDeductions: extraDeductionsTotal,
      depositsHeldByManager,
      depositsHeldByLandlord,
      depositOpeningLiability: depositMemoTotals.openingBalance,
      depositCharges: depositMemoTotals.billed,
      depositReceipts: depositMemoTotals.received,
      depositClosingLiability: depositMemoTotals.closingBalance,
      depositSettlementAdditions: round2(depositSettlementTotals.additions),
      depositSettlementOffsets: round2(depositSettlementTotals.offsets),
      depositSettlementNet,
      broughtForwardCreditsApplied: round2(broughtForwardCreditApplicationTotals.totalApplied),
      broughtForwardCreditsAppliedRent: round2(broughtForwardCreditApplicationTotals.rentApplied),
      broughtForwardCreditsAppliedUtility: round2(broughtForwardCreditApplicationTotals.utilityApplied),
      broughtForwardCreditsAppliedTax: round2(broughtForwardCreditApplicationTotals.taxApplied),
      commissionPercentage: commissionPct,
      commissionBasis: recognitionBasis,
      prepaymentRecognition,
      commissionBaseAmount: round2(commissionBase),
      commissionBaseLabel,
      commissionPaymentMode,
      commissionFixedAmount: round2(commissionFixedAmount),
      commissionAmount,
      commissionTaxAmount,
      commissionTaxRate: commissionTaxSnapshot.taxRate ?? 0,
      commissionGrossAmount,
      occupiedUnits,
      vacantUnits,
      previousCutoffAt,
      latestProcessedStatementId: latestProcessedStatement?._id ? String(latestProcessedStatement._id) : null,
      statementStartAt: periodStart,
      statementEndAt: periodEnd,
    },
    previousCutoffAt,
    statementStartAt: periodStart,
    statementEndAt: periodEnd,
  };

  const totalsByCategory = {
    RENT_CHARGE: {
      count: invoicesInPeriod.filter(
        (i) =>
          i.category === "RENT_CHARGE" &&
          shouldIncludeInvoiceInLandlordStatement(i)
      ).length,
      totalAmount: totalRentInvoiced,
      totalDebit: 0,
      totalCredit: totalRentInvoiced,
    },
    UTILITY_CHARGE: {
      count: invoicesInPeriod.filter(
        (i) =>
          i.category === "UTILITY_CHARGE" &&
          shouldIncludeInvoiceInLandlordStatement(i)
      ).length,
      totalAmount: round2(totalUtilityInvoiced),
      totalDebit: 0,
      totalCredit: round2(totalUtilityInvoiced),
    },
    RENT_RECEIPT_MANAGER: {
      count: receiptsInPeriod.filter(
        (r) => r.paymentType === "rent" && !r.paidDirectToLandlord
      ).length,
      totalAmount: round2(totalRentReceivedManager),
      totalDebit: 0,
      totalCredit: round2(totalRentReceivedManager),
    },
    RENT_RECEIPT_LANDLORD: {
      count: receiptsInPeriod.filter(
        (r) => r.paymentType === "rent" && r.paidDirectToLandlord
      ).length,
      totalAmount: round2(totalRentReceivedLandlord),
      totalDebit: 0,
      totalCredit: round2(totalRentReceivedLandlord),
    },
    UTILITY_RECEIPT_MANAGER: {
      count: receiptsInPeriod.filter(
        (r) => r.paymentType === "utility" && !r.paidDirectToLandlord
      ).length,
      totalAmount: round2(totalUtilityReceivedManager),
      totalDebit: 0,
      totalCredit: round2(totalUtilityReceivedManager),
    },
    UTILITY_RECEIPT_LANDLORD: {
      count: receiptsInPeriod.filter(
        (r) => r.paymentType === "utility" && r.paidDirectToLandlord
      ).length,
      totalAmount: round2(totalUtilityReceivedLandlord),
      totalDebit: 0,
      totalCredit: round2(totalUtilityReceivedLandlord),
    },
    EXPENSE_DEDUCTION: {
      count: expenseRows.length,
      totalAmount: round2(-deductions),
      totalDebit: deductions,
      totalCredit: 0,
    },
    COMMISSION_CHARGE: {
      count: commissionAmount > 0 ? 1 : 0,
      totalAmount: round2(-commissionGrossAmount),
      totalDebit: commissionGrossAmount,
      totalCredit: 0,
    },
    ADJUSTMENT: {
      count:
        additionRows.length +
        extraDeductionRows.length +
        advanceRecoveryRows.length +
        earlyPayoutRows.length +
        directToLandlordRows.length,
      totalAmount: round2(
        additionsTotal - extraDeductionsTotal - advanceRecoveriesTotal - earlyPayoutsTotal - landlordOffsets
      ),
      totalDebit: round2(totalExtraDeductions + totalAdvanceRecoveries + totalEarlyPayouts + landlordOffsets),
      totalCredit: additionsTotal,
    },
  };

  return {
    propertyId,
    landlordId,
    periodStart,
    periodEnd,
    openingBalance: totalBalanceBF,
    entries: entries.sort(
      (a, b) => new Date(a.transactionDate) - new Date(b.transactionDate)
    ),
    totalsByCategory,
    periodNet: netRemittance,
    closingBalance: totalBalanceCF,
    currency: "KES",
    generatedAt: new Date(),
    source: "operational_statement",
    metadata: workspace,
  };
};

export default { generateLandlordStatement };