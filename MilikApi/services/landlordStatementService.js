import mongoose from "mongoose";
import Property from "../models/Property.js";
import Unit from "../models/Unit.js";
import Tenant from "../models/Tenant.js";
import TenantInvoice from "../models/TenantInvoice.js";
import RentPayment from "../models/RentPayment.js";
import ExpenseProperty from "../models/ExpenseProperty.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import TenantInvoiceNote from "../models/TenantInvoiceNote.js";
import ProcessedStatement from "../models/ProcessedStatement.js";
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

const oid = (value) =>
  typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : value;

const isValidObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId ||
  (typeof value === "string" && mongoose.Types.ObjectId.isValid(value));

const safeName = (value = "") => String(value || "").trim().toLowerCase();

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
      "_id cutoffAt closedAt periodStart periodEnd balanceDue isNegativeStatement amountPayableByLandlordToManager amountRecovered recoveryBalance status"
    )
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
    effectiveStartAt = new Date(effectiveEndAt);
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

const sumUtilityPhase = (row = {}, phase = "invoice") =>
  Object.values(row?.utilities || {}).reduce((sum, item) => {
    const amount =
      phase === "invoice"
        ? Number(item?.invoiced || 0)
        : Number(item?.paid || 0);
    return sum + amount;
  }, 0);

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

  const property = await Property.findById(propertyObjectId)
    .select(
      "dateAcquired propertyCode propertyName name address city commissionPercentage commissionRecognitionBasis commissionPaymentMode commissionFixedAmount commissionTaxSettings totalUnits business landlords"
    )
    .lean();

  if (!property) throw new Error("Property not found");
  if (!property.business) {
    throw new Error("Property is missing business scope. Cannot generate landlord statement safely.");
  }

  const businessId = String(property.business);
  const businessObjectId = oid(property.business);

  const {
    effectiveStartAt,
    effectiveEndAt,
    previousCutoffAt,
    latestProcessedStatement,
    openingLandlordSettlementBalance,
  } = await resolveEffectiveStatementWindow({
    businessId: businessObjectId,
    propertyId: propertyObjectId,
    landlordId: landlordObjectId,
    statementPeriodStart,
    statementPeriodEnd,
    cutoffAt,
    propertyDateAcquired: property.dateAcquired || null,
  });

  const periodStart = effectiveStartAt;
  const periodEnd = effectiveEndAt;

  const landlordLinkedToProperty = (Array.isArray(property.landlords) ? property.landlords : []).some(
    (item) => String(item?.landlordId || "") === String(landlordObjectId)
  );

  if (!landlordLinkedToProperty) {
    throw new Error("Landlord is not linked to the supplied property.");
  }

  const units = await Unit.find({ property: propertyObjectId, business: businessObjectId })
    .select("_id unitNumber name rent utilities status isVacant property")
    .lean();

  const unitIds = units.map((u) => u._id);

  const tenants = await Tenant.find({
    unit: { $in: unitIds },
    business: businessObjectId,
    status: { $nin: ["inactive", "moved_out", "evicted"] },
  })
    .select(
      "_id name tenantCode rent status unit utilities paymentMethod balance moveInDate createdAt depositHeldBy"
    )
    .lean();

  const [
    invoicesBefore,
    invoicesInPeriod,
    notesBefore,
    notesInPeriod,
    receiptsBefore,
    receiptsInPeriod,
    depositReceiptsBefore,
    depositReceiptsInPeriod,
    expensesInPeriod,
    statementAdjustments,
  ] = await Promise.all([
    TenantInvoice.find({
      property: propertyObjectId,
      business: businessObjectId,
      invoiceDate: { $lt: periodStart },
      status: { $nin: ["cancelled", "reversed"] },
    })
      .select(
        "_id tenant unit category amount description invoiceDate invoiceNumber landlord metadata depositHeldBy"
      )
      .lean(),

    TenantInvoice.find({
      property: propertyObjectId,
      business: businessObjectId,
      invoiceDate: { $gte: periodStart, $lte: periodEnd },
      status: { $nin: ["cancelled", "reversed"] },
    })
      .select(
        "_id tenant unit category amount description invoiceDate invoiceNumber landlord metadata depositHeldBy"
      )
      .lean(),

    TenantInvoiceNote.find({
      property: propertyObjectId,
      business: businessObjectId,
      noteDate: { $lt: periodStart },
      status: { $nin: ["cancelled", "reversed"] },
      postingStatus: { $nin: ["failed", "reversed"] },
    })
      .select(
        "_id tenant unit category amount description noteDate noteNumber noteType metadata sourceInvoice"
      )
      .lean(),

    TenantInvoiceNote.find({
      property: propertyObjectId,
      business: businessObjectId,
      noteDate: { $gte: periodStart, $lte: periodEnd },
      status: { $nin: ["cancelled", "reversed"] },
      postingStatus: { $nin: ["failed", "reversed"] },
    })
      .select(
        "_id tenant unit category amount description noteDate noteNumber noteType metadata sourceInvoice"
      )
      .lean(),

    RentPayment.find({
      business: businessObjectId,
      unit: { $in: unitIds },
      paymentDate: { $lt: periodStart },
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null,
      isCancellationEntry: { $ne: true },
      paymentType: { $in: ["rent", "utility"] },
    })
      .select(
        "_id tenant unit amount paymentType paymentDate paidDirectToLandlord description referenceNumber receiptNumber breakdown utilities allocations allocationSummary"
      )
      .lean(),

    RentPayment.find({
      business: businessObjectId,
      unit: { $in: unitIds },
      paymentDate: { $gte: periodStart, $lte: periodEnd },
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null,
      isCancellationEntry: { $ne: true },
      paymentType: { $in: ["rent", "utility"] },
    })
      .select(
        "_id tenant unit amount paymentType paymentDate paidDirectToLandlord description referenceNumber receiptNumber breakdown utilities allocations allocationSummary metadata"
      )
      .lean(),

    RentPayment.find({
      business: businessObjectId,
      unit: { $in: unitIds },
      paymentDate: { $lt: periodStart },
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null,
      isCancellationEntry: { $ne: true },
      paymentType: "deposit",
    })
      .select(
        "_id tenant unit amount paymentType paymentDate paidDirectToLandlord description referenceNumber receiptNumber allocations allocationSummary metadata"
      )
      .lean(),

    RentPayment.find({
      business: businessObjectId,
      unit: { $in: unitIds },
      paymentDate: { $gte: periodStart, $lte: periodEnd },
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null,
      isCancellationEntry: { $ne: true },
      paymentType: "deposit",
    })
      .select(
        "_id tenant unit amount paymentType paymentDate paidDirectToLandlord description referenceNumber receiptNumber allocations allocationSummary metadata"
      )
      .lean(),

    ExpenseProperty.find({
      property: propertyObjectId,
      business: businessObjectId,
      date: { $gte: periodStart, $lte: periodEnd },
    })
      .select("_id amount description date category unit")
      .lean(),

    FinancialLedgerEntry.find({
      property: propertyObjectId,
      business: businessObjectId,
      landlord: landlordObjectId,
      category: "ADJUSTMENT",
      transactionDate: { $gte: periodStart, $lte: periodEnd },
      status: "approved",
      sourceTransactionType: {
        $in: ["manual_adjustment", "other", "processed_statement"],
      },
      $or: [
        { "metadata.includeInLandlordStatement": true },
        { "metadata.statementBucket": { $in: ["addition", "deduction"] } },
      ],
    })
      .select(
        "_id amount debit credit direction transactionDate notes sourceTransactionType sourceTransactionId metadata tenant unit"
      )
      .lean(),
  ]);

  const unitMap = new Map(units.map((u) => [String(u._id), u]));
  const tenantMap = new Map(tenants.map((t) => [String(t._id), t]));
  const tenantsByUnit = new Map();

  tenants.forEach((tenant) => {
    const key = String(tenant.unit);
    if (!tenantsByUnit.has(key)) tenantsByUnit.set(key, []);
    tenantsByUnit.get(key).push(tenant);
  });

  const rowsMap = new Map();

  const ensureRow = (tenantId, unitId, fallback = {}) => {
    const resolvedUnitId = String(unitId || fallback.unitId || fallback.unit || "");
    const unit = unitMap.get(resolvedUnitId) || {};
    const tenant = tenantId
      ? tenantMap.get(String(tenantId)) || {}
      : {};
    const key = `${resolvedUnitId}:${String(tenant._id || tenantId || "vacant")}`;

    if (!rowsMap.has(key)) {
      rowsMap.set(key, {
        key,
        tenantId: String(tenant._id || tenantId || ""),
        unitId: resolvedUnitId,
        unit: unit.unitNumber || unit.name || fallback.unitLabel || "-",
        accountNo: tenant.tenantCode || fallback.accountNo || "-",
        tenantName: tenant.name || fallback.tenantName || "VACANT",
        perMonth: Number(tenant.rent || unit.rent || fallback.perMonth || 0),
        balanceBF: 0,
        invoicedRent: 0,
        invoicedGarbage: 0,
        invoicedWater: 0,
        paidRent: 0,
        paidGarbage: 0,
        paidWater: 0,
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
    if (String(invoice?.category || "").toUpperCase() === "LATE_PENALTY_CHARGE") {
      return false;
    }
    return true;
  };

  const shouldIncludeNoteInLandlordStatement = (note = {}) => {
    const metadata = note?.metadata || {};
    if (typeof metadata.includeInLandlordStatement === "boolean") {
      return metadata.includeInLandlordStatement;
    }
    if (String(note?.category || "").toUpperCase() === "LATE_PENALTY_CHARGE") {
      return false;
    }
    return true;
  };

  const getSignedNoteAmount = (note = {}) => {
    const amount = Math.abs(Number(note?.amount || 0));
    return String(note?.noteType || "").toUpperCase() === "CREDIT_NOTE"
      ? -amount
      : amount;
  };

  const normalizeDepositHolder = (value = "") => {
    const normalized = safeName(value);
    if (!normalized) return "";
    if (["landlord", "held_by_landlord"].includes(normalized)) return "landlord";
    if (["management company", "management_company", "propertymanager", "property manager", "property_manager", "manager"].includes(normalized)) {
      return "manager";
    }
    return "";
  };

  const resolveDepositHolderForRecord = (record = {}) => {
    const tenant = record?.tenant ? tenantMap.get(String(record.tenant)) || {} : {};
    const resolved =
      normalizeDepositHolder(record?.depositHeldBy) ||
      normalizeDepositHolder(record?.metadata?.depositHeldBy) ||
      normalizeDepositHolder(tenant?.depositHeldBy) ||
      normalizeDepositHolder(property?.depositHeldBy);
    return resolved || "manager";
  };

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
    });

    if (normalizedEffect === "offset") {
      depositSettlementTotals.offsets = round2(depositSettlementTotals.offsets + value);
    } else {
      depositSettlementTotals.additions = round2(depositSettlementTotals.additions + value);
    }
  };

  const applyDepositChargeToMemo = (record = {}, amount = 0, phase = "current") => {
    const value = round2(amount);
    if (value === 0) return;
    const bucket = depositMemoBuckets[resolveDepositHolderForRecord(record)] || depositMemoBuckets.manager;
    if (phase === "opening") bucket.openingBalance = round2(bucket.openingBalance + value);
    else bucket.billed = round2(bucket.billed + value);
    bucket.closingBalance = round2(bucket.closingBalance + value);
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

  for (const invoice of invoicesBefore) {
    if (!shouldIncludeInvoiceInLandlordStatement(invoice)) continue;

    const row = ensureRow(invoice.tenant, invoice.unit);
    const amount = Number(invoice.amount || 0);

    if (invoice.category === "RENT_CHARGE") {
      row.balanceBF += amount;
    } else if (invoice.category === "UTILITY_CHARGE") {
      row.balanceBF += amount;
    } else if (invoice.category === "DEPOSIT_CHARGE") {
      applyDepositChargeToMemo(invoice, amount, "opening");
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
    } else if (note.category === "DEPOSIT_CHARGE") {
      applyDepositChargeToMemo(note, amount, "opening");
    }
  }

  for (const receipt of depositReceiptsBefore) {
    applyDepositReceiptToMemo(receipt, receipt.amount, "opening");
  }

  for (const receipt of receiptsBefore) {
    const row = ensureRow(receipt.tenant, receipt.unit);
    row.balanceBF -= Number(receipt.amount || 0);
  }

  for (const invoice of invoicesInPeriod) {
    if (!shouldIncludeInvoiceInLandlordStatement(invoice)) continue;

    const row = ensureRow(invoice.tenant, invoice.unit);
    const amount = Number(invoice.amount || 0);

    if (invoice.category === "RENT_CHARGE") {
      row.invoicedRent += amount;
    } else if (invoice.category === "UTILITY_CHARGE") {
      applyUtility(
        row,
        "invoice",
        amount,
        invoice.description || invoice.invoiceNumber || "",
        invoice.metadata || {}
      );
    } else if (invoice.category === "DEPOSIT_CHARGE") {
      applyDepositChargeToMemo(invoice, amount, "current");
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
      transactionDate: invoice.invoiceDate,
      category: invoice.category,
      amount,
      direction: "credit",
      description: invoice.description || invoice.invoiceNumber || "Tenant invoice",
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      metadata: {
        tenantName: row.tenantName,
        unit: row.unit,
        tenantCode: row.accountNo,
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

  for (const note of notesInPeriod) {
    if (!shouldIncludeNoteInLandlordStatement(note)) continue;

    const row = ensureRow(note.tenant, note.unit);
    const amount = getSignedNoteAmount(note);

    if (note.category === "RENT_CHARGE") {
      row.invoicedRent += amount;
    } else if (note.category === "UTILITY_CHARGE") {
      applyUtility(
        row,
        "invoice",
        amount,
        note.description || note.noteNumber || "",
        note.metadata || {}
      );
    } else if (note.category === "DEPOSIT_CHARGE") {
      applyDepositChargeToMemo(note, amount, "current");
    }

    if (note.noteNumber) row.referenceNumbers.push(note.noteNumber);

    const noteUtilityIdentity =
      note.category === "UTILITY_CHARGE"
        ? resolveUtilityIdentity(
            note.description || note.noteNumber || "",
            note.metadata || {},
            row
          )
        : null;

    pushEntry({
      tenantId: note.tenant,
      unitId: note.unit,
      transactionDate: note.noteDate,
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

  let totalRentReceivedManager = 0;
  let totalRentReceivedLandlord = 0;
  let totalUtilityReceivedManager = 0;
  let totalUtilityReceivedLandlord = 0;
  let directToLandlordOffset = 0;
  const additionRows = [];
  const extraDeductionRows = [];
  let totalAdditions = 0;
  let totalExtraDeductions = 0;

  for (const receipt of receiptsInPeriod) {
    const row = ensureRow(receipt.tenant, receipt.unit);
    const amount = Number(receipt.amount || 0);
    const description =
      receipt.description ||
      receipt.referenceNumber ||
      receipt.receiptNumber ||
      "Tenant receipt";

    const allocationRows = getReceiptAllocationRows(receipt);
    const rentAllocated = getReceiptSummaryAmount(receipt, "rent");
    const depositAllocated = getReceiptSummaryAmount(receipt, "deposit");
    const utilityAllocated = getReceiptSummaryAmount(receipt, "utility");

    if (rentAllocated !== 0) {
      row.paidRent += rentAllocated;
      if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += rentAllocated;
      else totalRentReceivedManager += rentAllocated;
    }

    if (utilityAllocated !== 0) {
      if (allocationRows.length > 0) {
        allocationRows
          .filter((item) => String(item?.priorityGroup || "") === "utility")
          .forEach((util) => {
            applyUtility(
              row,
              "receipt",
              Number(util.appliedAmount || 0),
              util.utilityType || util.description || receipt.description || "",
              {
                utilityType: util.utilityType || "",
                meterUtilityType: util.utilityType || "",
              }
            );
          });
      } else {
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

    if (
      rentAllocated === 0 &&
      utilityAllocated === 0 &&
      depositAllocated === 0 &&
      receipt.paymentType === "rent"
    ) {
      row.paidRent += amount;
      if (receipt.paidDirectToLandlord) totalRentReceivedLandlord += amount;
      else totalRentReceivedManager += amount;
    } else if (
      rentAllocated === 0 &&
      utilityAllocated === 0 &&
      depositAllocated === 0 &&
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
      transactionDate: receipt.paymentDate,
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
        transactionDate: receipt.paymentDate,
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
        },
      });
    }
  }

  for (const receipt of depositReceiptsInPeriod) {
    applyDepositReceiptToMemo(receipt, receipt.amount, "current");

    const depositHolder = resolveDepositHolderForRecord(receipt);
    if (depositHolder !== "landlord") continue;

    const row = ensureRow(receipt.tenant, receipt.unit);
    const amount = round2(Math.abs(Number(receipt.amount || 0)));
    if (amount === 0) continue;

    const sourceId = String(receipt._id || "");
    const additionDescription = receipt.paidDirectToLandlord
      ? `Landlord-held deposit recognised from direct landlord receipt - ${row.tenantName}`
      : `Landlord-held deposit remittance - ${row.tenantName}`;

    totalAdditions = round2(totalAdditions + amount);
    additionRows.push({
      date: receipt.paymentDate,
      description: additionDescription,
      amount,
      category: "deposit_remittance",
      sourceId,
    });
    pushDepositSettlementRow({
      date: receipt.paymentDate,
      description: additionDescription,
      amount,
      effect: "addition",
      holder: depositHolder,
      paidDirectToLandlord: !!receipt.paidDirectToLandlord,
      sourceId,
    });

    pushEntry({
      tenantId: receipt.tenant,
      unitId: receipt.unit,
      transactionDate: receipt.paymentDate,
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
        date: receipt.paymentDate,
        description: offsetDescription,
        amount,
        category: "deposit_direct_offset",
        sourceId: `${sourceId}-offset`,
      });
      pushDepositSettlementRow({
        date: receipt.paymentDate,
        description: offsetDescription,
        amount,
        effect: "offset",
        holder: depositHolder,
        paidDirectToLandlord: true,
        sourceId: `${sourceId}-offset`,
      });

      pushEntry({
        tenantId: receipt.tenant,
        unitId: receipt.unit,
        transactionDate: receipt.paymentDate,
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

  for (const adjustment of statementAdjustments) {
    const amount = Number(
      adjustment.amount || adjustment.credit || adjustment.debit || 0
    );
    if (amount <= 0) continue;

    const bucket = String(adjustment?.metadata?.statementBucket || "").toLowerCase();
    const isAddition =
      bucket === "addition" ||
      Number(adjustment.credit || 0) > 0 ||
      adjustment.direction === "credit";

    const description =
      adjustment.notes ||
      adjustment?.metadata?.description ||
      (isAddition ? "Statement addition" : "Statement deduction");

    if (isAddition) {
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
        category: "adjustment_deduction",
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
        metadata: { statementBucket: "deduction" },
      });
    }
  }

  const rawExpenseRows = expensesInPeriod.map((expense) => ({
    date: expense.date,
    description: expense.description || `Property expense - ${expense.category}`,
    amount: round2(expense.amount),
    category: expense.category || "expense",
    sourceId: String(expense._id),
    unit: expense.unit ? String(expense.unit) : "",
  }));

  const cleanedPropertyExpenseRows = dedupeExpenseRowsAgainstAdditions({
    expenseRows: rawExpenseRows,
    additionRows,
  });

  const propertyExpenseSourceIds = new Set(
    cleanedPropertyExpenseRows.map((row) => row.sourceId).filter(Boolean)
  );

  let totalExpenses = 0;

  for (const expense of expensesInPeriod) {
    if (!propertyExpenseSourceIds.has(String(expense._id))) continue;

    const amount = Number(expense.amount || 0);
    totalExpenses += amount;

    pushEntry({
      tenantId: null,
      unitId: expense.unit || null,
      transactionDate: expense.date,
      category: "EXPENSE_DEDUCTION",
      amount,
      direction: "debit",
      description: expense.description || `Property expense - ${expense.category}`,
      sourceTransactionType: "expense",
      sourceTransactionId: String(expense._id),
      metadata: {
        expenseCategory: expense.category,
      },
    });
  }

  const tenantRows = Array.from(rowsMap.values())
    .map((row) => {
      row.balanceBF = round2(row.balanceBF);
      row.invoicedRent = round2(row.invoicedRent);
      row.invoicedGarbage = round2(row.invoicedGarbage);
      row.invoicedWater = round2(row.invoicedWater);
      row.paidRent = round2(row.paidRent);
      row.paidGarbage = round2(row.paidGarbage);
      row.paidWater = round2(row.paidWater);
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
      row.balanceCF = round2(
        row.balanceBF +
          row.invoicedRent +
          row.totalUtilityInvoiced -
          row.paidRent -
          row.totalUtilityPaid
      );
      row.referenceNumbers = Array.from(
        new Set((row.referenceNumbers || []).filter(Boolean))
      );
      return row;
    })
    .sort((a, b) =>
      String(a.unit).localeCompare(String(b.unit), undefined, { numeric: true })
    );

  const utilityColumns = buildUtilityColumns(tenantRows);
  const utilityTotalsMap = utilityColumns.reduce((acc, item) => {
    acc[item.key] = item;
    return acc;
  }, {});

  const totalRentInvoiced = round2(
    tenantRows.reduce((sum, row) => sum + row.invoicedRent, 0)
  );
  const totalGarbageInvoiced = round2(
    Number(utilityTotalsMap.garbage?.invoiced || 0)
  );
  const totalWaterInvoiced = round2(
    Number(utilityTotalsMap.water?.invoiced || 0)
  );
  const totalRentReceived = round2(
    tenantRows.reduce((sum, row) => sum + row.paidRent, 0)
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
  const totalBalanceBF = round2(
    tenantRows.reduce((sum, row) => sum + row.balanceBF, 0)
  );
  const totalBalanceCF = round2(
    tenantRows.reduce((sum, row) => sum + row.balanceCF, 0)
  );

  const commissionPct = Number(property.commissionPercentage || 0);
  const recognitionBasis = normalizeCommissionRecognitionBasis(
    property.commissionRecognitionBasis || "received"
  );
  const commissionPaymentMode = String(
    property.commissionPaymentMode || "percentage"
  ).toLowerCase();
  const commissionFixedAmount = Number(property.commissionFixedAmount || 0);

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
    tenantRows.reduce((sum, row) => {
      if (String(row?.tenantName || "").toUpperCase() === "VACANT") return sum;
      return sum + Number(row?.perMonth || 0);
    }, 0)
  );
  const hasNonBlankSettlementActivity =
    round2(
      Math.abs(totalRentInvoiced) +
        Math.abs(totalRentReceived) +
        Math.abs(totalUtilityInvoiced) +
        Math.abs(totalUtilityCollected) +
        Math.abs(totalExpenses) +
        Math.abs(totalExtraDeductions) +
        Math.abs(totalAdditions) +
        Math.abs(openingLandlordSettlementBalance)
    ) > 0;

  if (commissionBase <= 0 && occupiedRentRoll > 0 && hasNonBlankSettlementActivity) {
    commissionBase = occupiedRentRoll;
    commissionBaseLabel =
      recognitionBasis === "invoiced"
        ? "Occupied rent roll fallback (accrual recovery)"
        : recognitionBasis === "received_manager_only"
        ? "Occupied rent roll fallback (manager recovery)"
        : "Occupied rent roll fallback (landlord recovery)";
  }

  const commissionAmount = calculateCommissionAmount({
    paymentMode: commissionPaymentMode,
    percentage: commissionPct,
    fixedAmount: commissionFixedAmount,
    commissionBase,
  });

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
        description: `VAT on ${commissionDescription.toLowerCase()}`,
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
    totalRentReceivedManager + totalUtilityReceivedManager
  );
  const directToLandlordCollections = round2(
    totalRentReceivedLandlord + totalUtilityReceivedLandlord
  );
  const totalCollections = round2(
    managerCollections + directToLandlordCollections
  );
  const expectedCollections = round2(
    totalRentInvoiced + totalUtilityInvoiced
  );

  const usesExpectedRentSettlement = recognitionBasis === "invoiced";
  const settlementBasisAmount = round2(
    usesExpectedRentSettlement ? totalRentInvoiced : managerCollections
  );
  const settlementBasisLabel = usesExpectedRentSettlement
    ? "Rent expected (Invoiced/Accrual)"
    : "Manager-held collections";
  const utilityPassThroughAmount = round2(
    usesExpectedRentSettlement ? totalUtilityInvoiced : 0
  );
  const utilityPassThroughLabel = usesExpectedRentSettlement
    ? "Utilities (added as billed)"
    : "";
  const settlementCollections = round2(
    settlementBasisAmount + utilityPassThroughAmount
  );
  const settlementCollectionsLabel = usesExpectedRentSettlement
    ? "Expected rent + utilities"
    : "Manager-held collections";
  const basisCollections = settlementBasisAmount;
  const basisCollectionsLabel = settlementBasisLabel;

  const nonCommissionDeductions = round2(totalExpenses + totalExtraDeductions);
  const deductions = round2(nonCommissionDeductions + commissionGrossAmount);
  const landlordOffsets = round2(directToLandlordOffset);
  const additionsTotal = round2(totalAdditions || 0);
  const extraDeductionsTotal = round2(totalExtraDeductions || 0);
  const openingSettlementBalance = round2(openingLandlordSettlementBalance);
  const netRemittance = round2(
    openingSettlementBalance + settlementCollections + additionsTotal - deductions
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
    .filter((bucket) =>
      [bucket.openingBalance, bucket.billed, bucket.received, bucket.closingBalance].some((value) => value !== 0)
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

  const occupiedUnits = tenantRows.filter(
    (row) => row.tenantName !== "VACANT"
  ).length;
  const vacantUnits = tenantRows.filter(
    (row) => row.tenantName === "VACANT"
  ).length;

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
                description: `VAT on ${commissionDescription.toLowerCase()}`,
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
    .map((r) => {
      const row = ensureRow(r.tenant, r.unit);
      return {
        date: r.paymentDate,
        description: `Direct to landlord collection - ${row.tenantName}`,
        amount: round2(Math.abs(r.amount)),
        category: "direct_to_landlord",
        sourceId: String(r._id),
      };
    });

  const workspace = {
    periodLabel: `${periodStart.toLocaleString("en-KE", {
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
      return ll.name || "Landlord";
    })(),
    utilityColumns,
    rows: tenantRows.map((row) => ({
      ...row,
      unitNumber: row.unit,
      openingBalance: row.balanceBF,
      closingBalance: row.balanceCF,
      totalPaid: round2(row.paidRent + row.totalUtilityPaid),
      balance: row.balanceCF,
    })),
    totals: {
      perMonth: round2(tenantRows.reduce((sum, row) => sum + row.perMonth, 0)),
      openingBalance: totalBalanceBF,
      invoicedRent: totalRentInvoiced,
      invoicedGarbage: totalGarbageInvoiced,
      invoicedWater: totalWaterInvoiced,
      paidRent: totalRentReceived,
      rentPaid: totalRentReceived,
      paidGarbage: totalGarbageReceived,
      paidWater: totalWaterReceived,
      utilities: utilityColumns,
      utilityPaid: totalUtilityCollected,
      utilityInvoiced: totalUtilityInvoiced,
      expenses: nonCommissionDeductions,
      totalPaid: round2(totalRentReceived + totalUtilityCollected),
      closingBalance: totalBalanceCF,
    },
    expenseRows,
    deductionRows: expenseRows,
    additionRows,
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
    rowCount: tenantRows.length,
    summary: {
      openingBalance: totalBalanceBF,
      closingBalance: totalBalanceCF,
      rentInvoiced: totalRentInvoiced,
      totalRentInvoiced: totalRentInvoiced,
      utilityInvoiced: totalUtilityInvoiced,
      totalUtilityInvoiced: totalUtilityInvoiced,
      expectedCollections,
      basisCollections,
      basisCollectionsLabel,
      settlementCollections,
      settlementCollectionsLabel,
      settlementBasisAmount,
      settlementBasisLabel,
      utilityPassThroughAmount,
      utilityPassThroughLabel,
      managerCollections,
      totalCollections,
      totalRentReceived: totalRentReceived,
      totalRentReceivedManager: totalRentReceivedManager,
      totalRentReceivedLandlord: totalRentReceivedLandlord,
      totalUtilityCollected,
      directToLandlordCollections,
      totalDirectToLandlordCollections: directToLandlordCollections,
      openingLandlordSettlementBalance: openingSettlementBalance,
      openingSettlementBalance,
      additions: additionsTotal,
      totalAdditions: additionsTotal,
      deductions,
      totalDeductions: deductions,
      nonCommissionDeductions,
      totalExpenses: round2(totalExpenses),
      directToLandlordOffsets: landlordOffsets,
      netStatement: netRemittance,
      amountPayableToLandlord: netRemittance > 0 ? netRemittance : 0,
      netPayableToLandlord: netRemittance > 0 ? netRemittance : 0,
      isNegativeStatement: netRemittance < 0,
      amountPayableByLandlordToManager:
        netRemittance < 0 ? Math.abs(netRemittance) : 0,
      settlementAmount:
        netRemittance < 0 ? Math.abs(netRemittance) : netRemittance,
      settlementLabel:
        netRemittance < 0 ? "Landlord owes manager" : "Net payable to landlord",
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
      commissionPercentage: commissionPct,
      commissionBasis: recognitionBasis,
      commissionBaseAmount: round2(commissionBase),
      commissionBaseLabel,
      commissionPaymentMode,
      commissionFixedAmount: round2(commissionFixedAmount),
      commissionAmount,
      commissionTaxAmount,
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
        directToLandlordRows.length,
      totalAmount: round2(
        additionsTotal - extraDeductionsTotal - landlordOffsets
      ),
      totalDebit: round2(totalExtraDeductions + landlordOffsets),
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