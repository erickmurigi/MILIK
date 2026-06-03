import mongoose from "mongoose";
import TenantInvoice, { TENANT_INVOICE_CATEGORIES } from "../../models/TenantInvoice.js";
import TenantInvoiceNote, { TENANT_NOTE_TYPES } from "../../models/TenantInvoiceNote.js";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import Company from "../../models/Company.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import RentPayment from "../../models/RentPayment.js";
import MeterReading from "../../models/MeterReading.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import SequenceCounter from "../../models/SequenceCounter.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import {
  resolvePropertyAccountingContext,
  resolveTenantDepositPayableAccount,
} from "../../services/propertyAccountingService.js";
import { resolveConfiguredAccountingDefaultAccount } from "../../services/companyAccountingDefaultsService.js";
import { buildInvoiceTaxSnapshot, getCompanyTaxConfiguration, resolveOutputVatAccount } from "../../services/taxCalculationService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { COMPANY_OPERATING_MODES, normalizeCompanyOperatingMode } from "../../utils/companyModules.js";
import LatePenaltyBatch from "../../models/LatePenaltyBatch.js";

const TENANT_INVOICE_NOTE_SOURCE_TYPE = "invoice_note";

const SINGLE_INVOICE_ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000;
const singleInvoiceAccountCache = new Map();

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const safeLower = (value = "") => String(value || "").trim().toLowerCase();
const normalizeUtilityMatch = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const resolveTenantOperationalStatus = ({ tenant = null, invoiceSnapshots = [] }) => {
  const currentStatus = safeLower(tenant?.status || "active");
  if (["inactive", "terminated", "evicted", "moved_out"].includes(currentStatus)) {
    return currentStatus === "moved_out" ? "terminated" : currentStatus;
  }

  const today = new Date();
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const hasOverdueOutstanding = invoiceSnapshots.some((snapshot) => {
    const outstanding = Math.max(0, Number(snapshot?.outstanding || 0));
    if (outstanding <= 0) return false;
    const dueDate = snapshot?.dueDate ? new Date(snapshot.dueDate) : null;
    if (!dueDate || Number.isNaN(dueDate.getTime())) return false;
    const dueKey = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();
    return dueKey < todayKey;
  });

  return hasOverdueOutstanding ? "overdue" : "active";
};

const escapeRegExp = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const resolvePrimaryLandlordId = ({ sourceInvoice = null, property = null, tenant = null } = {}) => {
  const directCandidates = [
    sourceInvoice?.landlord,
    property?.landlord,
    property?.landlordId,
    tenant?.landlord,
    tenant?.landlordId,
  ];

  for (const candidate of directCandidates) {
    if (isValidObjectId(candidate)) return candidate;
  }

  const propertyLandlords = Array.isArray(property?.landlords) ? property.landlords : [];
  const primaryLandlord =
    propertyLandlords.find((entry) => entry?.isPrimary && isValidObjectId(entry?.landlordId)) ||
    propertyLandlords.find((entry) => isValidObjectId(entry?.landlordId));

  return primaryLandlord?.landlordId || null;
};

const isDuplicateKeyError = (error) =>
  Boolean(error) &&
  (error?.code === 11000 || error?.name === "MongoServerError" || /E11000 duplicate key/i.test(String(error?.message || "")));

const findExistingInvoiceByIdempotencyKey = async (businessId, idempotencyKey) => {
  const normalizedKey = String(idempotencyKey || "").trim();
  if (!normalizedKey) return null;

  return TenantInvoice.findOne({
    business: businessId,
    idempotencyKey: normalizedKey,
  })
    .populate("chartAccount", "code name type")
    .populate("ledgerEntries")
    .populate("createdBy", "surname otherNames email profile")
    .lean();
};

const isIdempotencyKeyDuplicateError = (error) => {
  if (!isDuplicateKeyError(error)) return false;

  const duplicateFields = Object.keys(error?.keyPattern || {});
  if (duplicateFields.includes("idempotencyKey")) return true;

  return /idempotencyKey/i.test(String(error?.message || ""));
};

const resolveDepositHolderLabel = ({ requestedValue = null, tenantValue = null, propertyValue = null, companyMode = "" } = {}) => {
  const normalizeHolder = (value = "") => {
    const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (["landlord", "held_by_landlord"].includes(normalized)) return "Landlord";
    if (["management_company", "management", "property_manager", "propertymanager", "manager"].includes(normalized)) {
      return "Management Company";
    }
    return "";
  };

  return (
    normalizeHolder(requestedValue) ||
    normalizeHolder(tenantValue) ||
    normalizeHolder(propertyValue) ||
    (normalizeCompanyOperatingMode(companyMode) === COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD
      ? "Landlord"
      : "Management Company")
  );
};

const resolveInvoiceLedgerMode = ({ category, depositHeldBy = null }) => {
  const normalizedCategory = String(category || "").toUpperCase();
  if (normalizedCategory !== "DEPOSIT_CHARGE") return "on_ledger";

  return String(depositHeldBy || "").trim().toLowerCase() === "landlord"
    ? "off_ledger"
    : "on_ledger";
};
const resolveAuthorizedBusinessId = (req, explicitBusiness = null) => {
  const requested = explicitBusiness || req?.body?.business || req?.query?.business || null;
  const authenticated = req?.user?.company?._id || req?.user?.company || req?.user?.businessId || null;

  if (req?.user?.isSystemAdmin || req?.user?.superAdminAccess) {
    return requested || authenticated || null;
  }

  return authenticated || requested || null;
};

const ensureBusinessAccess = (req, businessId) => {
  const authenticated = String(req?.user?.company?._id || req?.user?.company || req?.user?.businessId || "");
  const requested = String(businessId || "");

  if (!requested) {
    const error = new Error("Business context is required.");
    error.statusCode = 400;
    throw error;
  }

  if (req?.user?.isSystemAdmin || req?.user?.superAdminAccess) {
    return requested;
  }

  if (!authenticated || authenticated !== requested) {
    const error = new Error("Not authorized to access records for this business.");
    error.statusCode = 403;
    throw error;
  }

  return requested;
};

const normalizeEntityId = (value) => {
  if (value && typeof value === "object" && value._id) return String(value._id);
  return String(value || "");
};


const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const getMonthStart = (value = new Date()) => {
  const dt = normalizeDate(value, new Date());
  return new Date(dt.getFullYear(), dt.getMonth(), 1, 0, 0, 0, 0);
};

const getMonthDueDate = (value = new Date(), preferredDay = 5) => {
  const dt = normalizeDate(value, new Date());
  const maxDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  const safePreferredDay = Number.isFinite(Number(preferredDay)) ? Math.trunc(Number(preferredDay)) : 5;
  const dueDay = Math.min(Math.max(safePreferredDay, 1), maxDay);
  return new Date(dt.getFullYear(), dt.getMonth(), dueDay, 23, 59, 59, 999);
};

const resolveMonthlyBillingDueDate = ({ invoiceDate, dueDate }) => {
  const monthStart = getMonthStart(invoiceDate);
  const defaultDueDate = getMonthDueDate(monthStart, 5);
  if (!dueDate) return defaultDueDate;

  const requestedDueDate = normalizeDate(dueDate, defaultDueDate);
  return getMonthDueDate(monthStart, requestedDueDate.getDate());
};

const canonicalizeBillingPeriodKey = (value) => {
  const normalized = String(value || "monthly")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (!normalized) return "monthly";
  if (["monthly", "month", "1_month", "1m"].includes(normalized)) return "monthly";
  if (["quarterly", "quarter", "3_months", "3m"].includes(normalized)) return "quarterly";
  if (["semi_annual", "semiannual", "semi_annually", "semi_annually", "biannual", "half_yearly", "6_months", "6m"].includes(normalized)) return "semi_annual";
  if (["annual", "annually", "yearly", "12_months", "12m"].includes(normalized)) return "annual";
  return normalized;
};

const resolveInvoiceBillingPeriodKey = (metadata = {}) => canonicalizeBillingPeriodKey(
  metadata?.billingPeriodKey || metadata?.periodicityKey || metadata?.frequencyKey || metadata?.billingFrequency || "monthly"
);

const shouldUseRecurringBillingDateAlignment = ({ category, metadata }) => {
  const normalizedCategory = String(category || "").toUpperCase();
  if (!["RENT_CHARGE", "UTILITY_CHARGE"].includes(normalizedCategory)) return false;

  const sourceTransactionType = String(metadata?.sourceTransactionType || metadata?.source || metadata?.bookingSource || "")
    .trim()
    .toLowerCase();

  return sourceTransactionType !== "meter_reading";
};

const resolveRecurringBillingDates = ({ category, invoiceDate, dueDate, metadata = {} }) => {
  const requestedInvoiceDate = normalizeDate(invoiceDate);
  const requestedDueDate = dueDate ? normalizeDate(dueDate, requestedInvoiceDate) : null;

  if (!shouldUseRecurringBillingDateAlignment({ category, metadata })) {
    return {
      invoiceDate: requestedInvoiceDate,
      dueDate: requestedDueDate || requestedInvoiceDate,
    };
  }

  const billingPeriodKey = resolveInvoiceBillingPeriodKey(metadata);
  const periodStartCandidate = metadata?.periodStartDate || metadata?.periodFromDate || null;
  const alignedInvoiceDate = periodStartCandidate
    ? normalizeDate(periodStartCandidate, requestedInvoiceDate)
    : billingPeriodKey === "monthly"
    ? getMonthStart(requestedInvoiceDate)
    : requestedInvoiceDate;

  const alignedDueDate = requestedDueDate
    ? normalizeDate(requestedDueDate, alignedInvoiceDate)
    : billingPeriodKey === "monthly"
    ? resolveMonthlyBillingDueDate({ invoiceDate: alignedInvoiceDate, dueDate: null })
    : alignedInvoiceDate;

  return {
    invoiceDate: alignedInvoiceDate,
    dueDate: alignedDueDate,
  };
};

const resolveRequestedBookingDate = (bookingDate, fallbackDate) =>
  bookingDate ? normalizeDate(bookingDate, fallbackDate) : null;

const buildStatementPeriod = (invoiceDate) => {
  const dt = normalizeDate(invoiceDate, new Date());
  const year = dt.getFullYear();
  const month = dt.getMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
};

const isFutureInvoiceDate = (value) => {
  const date = normalizeDate(value, new Date());
  return date.getTime() > Date.now();
};

const isActiveInvoiceStatus = (status = "") => !["cancelled", "reversed"].includes(safeLower(status));

const releaseMeterReadingLinkedToInvoice = async (invoice, actorUserId = null, reason = "") => {
  const meterReadingId =
    invoice?.metadata?.meterReadingId ||
    invoice?.metadata?.meterReading?._id ||
    invoice?.metadata?.meterReading ||
    null;

  if (!meterReadingId || !mongoose.Types.ObjectId.isValid(String(meterReadingId))) {
    return null;
  }

  const reading = await MeterReading.findById(meterReadingId);
  if (!reading) return null;

  const linkedInvoiceId = reading?.billedInvoice ? String(reading.billedInvoice) : null;
  if (linkedInvoiceId && linkedInvoiceId !== String(invoice?._id || "")) {
    return reading;
  }

  reading.status = "draft";
  reading.billedInvoice = null;
  reading.billedAt = null;
  if (actorUserId) {
    reading.updatedBy = actorUserId;
  }

  const auditNote = String(reason || "").trim() || `Released from invoice ${invoice?.invoiceNumber || invoice?._id || ""}`;
  const existingNotes = String(reading.notes || "").trim();
  reading.notes = existingNotes
    ? `${existingNotes}
[Rebill enabled] ${auditNote}`
    : `[Rebill enabled] ${auditNote}`;

  await reading.save();
  return reading;
};

const isLegacyCombinedInvoiceMetadata = (metadata = {}) =>
  safeLower(metadata?.billItemKey) === "rent_utility:combined";

const getInvoiceDuplicateBucket = ({ category, metadata = {} } = {}) => {
  const normalizedCategory = String(category || "").toUpperCase();

  if (normalizedCategory === "RENT_CHARGE") {
    return isLegacyCombinedInvoiceMetadata(metadata) ? "combined" : "rent";
  }

  if (normalizedCategory === "UTILITY_CHARGE") {
    const utilityKey = normalizeUtilityMatch(
      metadata?.utilityType ||
        metadata?.meterUtilityType ||
        metadata?.statementUtilityType ||
        metadata?.utilityName ||
        metadata?.utility ||
        ""
    );

    return utilityKey ? `utility:${utilityKey}` : "utility";
  }

  return "";
};

const isUtilityDuplicateBucket = (bucket = "") => bucket === "utility" || String(bucket).startsWith("utility:");

const normalizeSchedulePeriodKey = (value = "") => String(value || "").trim();

const buildRecurringInvoiceCacheKey = ({ businessId, propertyId, tenantId, unitId, statementPeriod, periodKey = "" } = {}) => {
  const normalizedPeriodKey = normalizeSchedulePeriodKey(periodKey);
  return [
    String(businessId || ""),
    String(propertyId || ""),
    String(tenantId || ""),
    String(unitId || ""),
    normalizedPeriodKey || statementPeriod?.start?.toISOString?.() || "",
  ].join(":");
};

const buildRecurringInvoiceConflictFilter = ({
  businessId,
  propertyId,
  tenantId,
  unitId,
  statementPeriod,
  periodKey = "",
} = {}) => {
  const normalizedPeriodKey = normalizeSchedulePeriodKey(periodKey);
  const baseFilter = {
    business: businessId,
    property: propertyId,
    tenant: tenantId,
    unit: unitId,
    category: { $in: ["RENT_CHARGE", "UTILITY_CHARGE"] },
  };

  if (!normalizedPeriodKey) {
    return {
      ...baseFilter,
      invoiceDate: {
        $gte: statementPeriod.start,
        $lte: statementPeriod.end,
      },
    };
  }

  return {
    ...baseFilter,
    $or: [
      { "metadata.periodKey": normalizedPeriodKey },
      {
        $and: [
          { $or: [{ "metadata.periodKey": { $exists: false } }, { "metadata.periodKey": "" }, { metadata: { $exists: false } }] },
          {
            invoiceDate: {
              $gte: statementPeriod.start,
              $lte: statementPeriod.end,
            },
          },
        ],
      },
    ],
  };
};

const findConflictingMonthlyInvoice = ({ existingInvoices = [], category, metadata = {} } = {}) => {
  const requestedBucket = getInvoiceDuplicateBucket({ category, metadata });
  if (!requestedBucket) return null;

  return (
    existingInvoices.find((invoice) => {
      if (!isActiveInvoiceStatus(invoice?.status)) return false;
      if (isTakeOnBalanceInvoice(invoice)) return false;

      const existingBucket = getInvoiceDuplicateBucket({
        category: invoice?.category,
        metadata: invoice?.metadata || {},
      });

      if (!existingBucket) return false;

      if (requestedBucket === "combined") {
        return existingBucket === "combined" || existingBucket === "rent" || isUtilityDuplicateBucket(existingBucket);
      }

      if (requestedBucket === "rent") {
        return existingBucket === "combined" || existingBucket === "rent";
      }

      if (isUtilityDuplicateBucket(requestedBucket)) {
        if (existingBucket === "combined") return true;
        if (!isUtilityDuplicateBucket(existingBucket)) return false;
        if (requestedBucket === "utility" || existingBucket === "utility") return true;
        return requestedBucket === existingBucket;
      }

      return false;
    }) || null
  );
};

const findFirstAccount = async (businessId, candidates = []) => {
  for (const candidate of candidates) {
    const query = { business: businessId };

    if (candidate._id) {
      query._id = candidate._id;
    } else {
      const and = [];
      if (candidate.type) and.push({ type: candidate.type });
      if (candidate.code) and.push({ code: candidate.code });
      if (candidate.nameRegex) and.push({ name: { $regex: candidate.nameRegex, $options: "i" } });
      if (candidate.group) and.push({ group: candidate.group });
      if (and.length > 0) query.$and = and;
    }

    const account = await ChartOfAccount.findOne(query).lean();
    if (account) return account;
  }

  return null;
};

const resolveTenantReceivableAccount = async (businessId) => {
  const configured = await resolveConfiguredAccountingDefaultAccount({
    businessId,
    field: "tenantReceivableAccount",
  });
  if (configured) return configured;

  const account = await findFirstAccount(businessId, [
    { code: "1200", type: "asset" },
    { nameRegex: "^tenant receivable", type: "asset" },
    { nameRegex: "accounts receivable", type: "asset" },
    { nameRegex: "receivable", type: "asset" },
  ]);

  if (!account) {
    throw new Error(
      "Tenant receivable account not found. Create a Chart of Account such as 'Tenant Receivables' before posting invoices."
    );
  }

  return account;
};

const ensurePostingChartAccount = (account, { expectedTypes = [], purpose = "posting" } = {}) => {
  if (!account?._id) return null;

  if (account.isHeader === true || account.isPosting === false) {
    throw new Error(
      `${account.code || account.name || "Selected account"} is a header/non-posting account and cannot be used for ${purpose}.`
    );
  }

  const normalizedType = String(account.type || "").toLowerCase();
  const allowedTypes = Array.isArray(expectedTypes)
    ? expectedTypes.map((type) => String(type || "").toLowerCase()).filter(Boolean)
    : [];

  if (allowedTypes.length > 0 && !allowedTypes.includes(normalizedType)) {
    throw new Error(
      `${account.code || account.name || "Selected account"} is a ${account.type || "unknown"} account. Select a valid ${allowedTypes.join("/")} account for ${purpose}.`
    );
  }

  return account;
};

const findAnyChartAccount = async (businessId, rawValue, fallbackCandidates = []) => {
  const direct = String(rawValue || "").trim();

  if (direct) {
    if (isValidObjectId(direct)) {
      const byId = await ChartOfAccount.findOne({
        _id: direct,
        business: businessId,
        isPosting: { $ne: false },
        isHeader: { $ne: true },
      }).lean();
      if (byId) return byId;
    }

    const byCode = await ChartOfAccount.findOne({
      business: businessId,
      code: direct,
      isPosting: { $ne: false },
      isHeader: { $ne: true },
    }).lean();
    if (byCode) return byCode;

    const byName = await ChartOfAccount.findOne({
      business: businessId,
      name: { $regex: `^${escapeRegExp(direct)}$`, $options: "i" },
      isPosting: { $ne: false },
      isHeader: { $ne: true },
    }).lean();
    if (byName) return byName;
  }

  return findFirstAccount(businessId, fallbackCandidates);
};

const reserveScopedSequenceNumber = async ({
  businessId,
  key,
  prefix,
  model,
  field,
  padding = 5,
}) => {
  const businessObjectId = new mongoose.Types.ObjectId(String(businessId));

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const counter = await SequenceCounter.findOneAndUpdate(
      { business: businessObjectId, key },
      {
        $setOnInsert: { business: businessObjectId, key },
        $inc: { sequence: 1 },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    const candidate = `${prefix}${String(Number(counter?.sequence || 0)).padStart(padding, "0")}`;
    const exists = await model.exists({
      business: businessId,
      [field]: {
        $regex: `^${escapeRegExp(candidate)}$`,
        $options: "i",
      },
    });

    if (!exists) {
      return candidate;
    }

    if (attempt === 0) {
      const latest = await model.findOne({ business: businessId })
        .sort({ createdAt: -1, _id: -1 })
        .select(field)
        .lean();
      const currentValue = String(latest?.[field] || "");
      const match = currentValue.match(/(\d+)(?!.*\d)/);
      const latestSequence = match ? Number(match[1]) : 0;

      if (latestSequence > Number(counter?.sequence || 0)) {
        await SequenceCounter.updateOne(
          {
            business: businessObjectId,
            key,
            sequence: { $lt: latestSequence },
          },
          {
            $set: { sequence: latestSequence },
          }
        );
      }
    }
  }

  throw new Error(`Could not reserve a unique ${field}. Please retry.`);
};

const preallocateInvoiceNumbers = async (businessId, items) => {
  const businessObjectId = new mongoose.Types.ObjectId(String(businessId));
  const regularIndices = [];
  const depositIndices = [];

  items.forEach((item, index) => {
    if (String(item.invoiceNumber || "").trim()) return;
    const cat = String(item.category || "").toUpperCase();
    (cat === "DEPOSIT_CHARGE" ? depositIndices : regularIndices).push(index);
  });

  const result = items.map((item) => ({ ...item }));

  const bumpCounter = async (key, count) => {
    const counter = await SequenceCounter.findOneAndUpdate(
      { business: businessObjectId, key },
      { $setOnInsert: { business: businessObjectId, key }, $inc: { sequence: count } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    return Number(counter?.sequence || count);
  };

  await Promise.all([
    regularIndices.length > 0
      ? bumpCounter("tenant_invoice_number", regularIndices.length).then((endSeq) => {
          const startSeq = endSeq - regularIndices.length + 1;
          regularIndices.forEach((itemIndex, i) => {
            result[itemIndex] = { ...result[itemIndex], invoiceNumber: `INV${String(startSeq + i).padStart(5, "0")}` };
          });
        })
      : Promise.resolve(),
    depositIndices.length > 0
      ? bumpCounter("tenant_deposit_invoice_number", depositIndices.length).then((endSeq) => {
          const startSeq = endSeq - depositIndices.length + 1;
          depositIndices.forEach((itemIndex, i) => {
            result[itemIndex] = { ...result[itemIndex], invoiceNumber: `DINV${String(startSeq + i).padStart(5, "0")}` };
          });
        })
      : Promise.resolve(),
  ]);

  return result;
};

const resolveInvoiceNumber = async (businessId, providedInvoiceNumber, category = null) => {
  const normalized = String(providedInvoiceNumber || "").trim();
  if (normalized) return normalized;

  const normalizedCategory = String(category || "").toUpperCase();
  const isDepositInvoice = normalizedCategory === "DEPOSIT_CHARGE";

  return reserveScopedSequenceNumber({
    businessId,
    key: isDepositInvoice ? "tenant_deposit_invoice_number" : "tenant_invoice_number",
    prefix: isDepositInvoice ? "DINV" : "INV",
    model: TenantInvoice,
    field: "invoiceNumber",
  });
};

const resolveNoteNumber = async (businessId, noteType, providedNoteNumber) => {
  const normalized = String(providedNoteNumber || "").trim();
  if (normalized) return normalized;

  const prefix = String(noteType || "").toUpperCase() === "CREDIT_NOTE" ? "CN" : "DN";
  const sequenceKey = String(noteType || "").toUpperCase() === "CREDIT_NOTE"
    ? "tenant_credit_note_number"
    : "tenant_debit_note_number";

  return reserveScopedSequenceNumber({
    businessId,
    key: sequenceKey,
    prefix,
    model: TenantInvoiceNote,
    field: "noteNumber",
  });
};

const mapInvoiceCategoryToLedgerCategory = (invoiceCategory) => {
  const normalizedCategory = String(invoiceCategory || "").toUpperCase();

  switch (normalizedCategory) {
    case "RENT_CHARGE":
      return "RENT_INVOICE";
    case "UTILITY_CHARGE":
      return "UTILITY_INVOICE";
    case "DEPOSIT_CHARGE":
      return "DEPOSIT_CHARGE";
    case "LATE_PENALTY_CHARGE":
    case "OTHER_CHARGE":
      return "ADJUSTMENT";
    default:
      throw new Error(`Unsupported invoice category for ledger posting: ${invoiceCategory}`);
  }
};

const resolveInvoiceIncomeAccount = async ({ businessId, category, chartAccountValue }) => {
  const normalizedCategory = String(category || "").toUpperCase();

  if (normalizedCategory === "DEPOSIT_CHARGE") {
    const depositAccount = await resolveTenantDepositPayableAccount(businessId);
    return ensurePostingChartAccount(depositAccount, {
      expectedTypes: ["liability"],
      purpose: "tenant deposit posting",
    });
  }

  if (normalizedCategory === "LATE_PENALTY_CHARGE") {
    if (!String(chartAccountValue || "").trim()) {
      const configuredPenaltyIncome = await resolveConfiguredAccountingDefaultAccount({
        businessId,
        field: "penaltyIncomeAccount",
      });
      if (configuredPenaltyIncome?._id) {
        return ensurePostingChartAccount(configuredPenaltyIncome, {
          expectedTypes: ["income"],
          purpose: "late penalty posting",
        });
      }
    }

    const account = await findAnyChartAccount(businessId, chartAccountValue, [
      { nameRegex: "late penalty", type: "income" },
      { nameRegex: "late fee", type: "income" },
      { nameRegex: "penalty income", type: "income" },
      { nameRegex: "other income", type: "income" },
    ]);

    if (!account?._id) {
      throw new Error(
        "Late penalty posting account not found. Create or select a penalty income chart account before processing late penalties."
      );
    }

    return ensurePostingChartAccount(account, {
      expectedTypes: ["income"],
      purpose: "late penalty posting",
    });
  }

  if (normalizedCategory === "OTHER_CHARGE") {
    if (!String(chartAccountValue || "").trim()) {
      const configuredLeaseAgreementIncome = await resolveConfiguredAccountingDefaultAccount({
        businessId,
        field: "leaseAgreementFeeIncomeAccount",
      });
      if (configuredLeaseAgreementIncome?._id) {
        return ensurePostingChartAccount(configuredLeaseAgreementIncome, {
          expectedTypes: ["income"],
          purpose: "lease/agreement fee posting",
        });
      }
    }

    const account = await findAnyChartAccount(businessId, chartAccountValue, [
      { code: "4101", type: "income" },
      { code: "4300", type: "income" },
      { nameRegex: "lease agreement", type: "income" },
      { nameRegex: "agreement fee", type: "income" },
      { nameRegex: "lease fee", type: "income" },
      { nameRegex: "^service charge income$", type: "income" },
      { nameRegex: "service charge", type: "income" },
      { nameRegex: "service income", type: "income" },
      { nameRegex: "^other property income$", type: "income" },
      { nameRegex: "other property income", type: "income" },
      { nameRegex: "other income", type: "income" },
    ]);

    if (!account?._id) {
      throw new Error(
        "Lease/agreement fee income account not found. Configure Lease / Agreement Fee Income Account under Accounting Defaults or create a suitable income chart account before charging lease fees."
      );
    }

    return ensurePostingChartAccount(account, {
      expectedTypes: ["income"],
      purpose: "lease/agreement fee posting",
    });
  }

  const candidates =
    normalizedCategory === "UTILITY_CHARGE"
      ? [
          { code: "4102", type: "income" },
          { nameRegex: "^utility recharge income$", type: "income" },
          { nameRegex: "^utility income$", type: "income" },
          { nameRegex: "utility", type: "income" },
        ]
      : [
          { code: "4100", type: "income" },
          { nameRegex: "^rent income$", type: "income" },
          { nameRegex: "^rental income$", type: "income" },
          { nameRegex: "rent", type: "income" },
        ];

  if (!String(chartAccountValue || "").trim()) {
    const configuredIncomeAccount = await resolveConfiguredAccountingDefaultAccount({
      businessId,
      field: normalizedCategory === "UTILITY_CHARGE" ? "utilityRechargeIncomeAccount" : "rentIncomeAccount",
    });
    if (configuredIncomeAccount?._id) {
      return ensurePostingChartAccount(configuredIncomeAccount, {
        expectedTypes: ["income"],
        purpose: normalizedCategory === "UTILITY_CHARGE" ? "utility invoice posting" : "rent invoice posting",
      });
    }
  }

  const account = await findAnyChartAccount(businessId, chartAccountValue, candidates);

  if (!account?._id) {
    throw new Error(
      normalizedCategory === "UTILITY_CHARGE"
        ? "Utility income chart account not found. Create or restore the Utility Recharge Income account before invoicing."
        : "Rent income chart account not found. Create or restore the Rent Income account before invoicing."
    );
  }

  return ensurePostingChartAccount(account, {
    expectedTypes: ["income"],
    purpose: normalizedCategory === "UTILITY_CHARGE" ? "utility invoice posting" : "rent invoice posting",
  });
};


export const resolveLeaseAgreementFeeIncomeAccount = async ({ businessId, chartAccountValue = null } = {}) =>
  resolveInvoiceIncomeAccount({
    businessId,
    category: "OTHER_CHARGE",
    chartAccountValue,
  });

const resolveActorUserId = async ({ req, business, bodyCreatedBy }) =>
  resolveAuditActorUserId({
    req,
    businessId: business,
    candidateUserIds: [bodyCreatedBy],
    fallbackErrorMessage:
      "No valid company user could be resolved for createdBy. Create at least one real user under this company, or submit a valid User ObjectId.",
  });

const endOfDay = (value) => {
  const d = normalizeDate(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

const buildAsOfDateFilter = (field, asOfDate) => {
  if (!asOfDate) return {};
  return { [field]: { $lte: endOfDay(asOfDate) } };
};

const getActiveNotesForTenant = async ({ businessId, tenantId, asOfDate = null }) =>
  TenantInvoiceNote.find({
    business: businessId,
    tenant: tenantId,
    status: { $nin: ["cancelled", "reversed"] },
    postingStatus: { $in: ["posted", "not_applicable", undefined, null] },
    ...buildAsOfDateFilter("noteDate", asOfDate),
  })
    .sort({ noteDate: 1, createdAt: 1, _id: 1 })
    .lean();

const attachNoteTotalsToInvoices = (invoices = [], notes = []) => {
  const totalsByInvoice = new Map();

  notes.forEach((note) => {
    const sourceInvoiceId = String(note?.sourceInvoice || "");
    if (!sourceInvoiceId) return;

    const current = totalsByInvoice.get(sourceInvoiceId) || {
      creditNoteTotal: 0,
      debitNoteTotal: 0,
    };

    const noteType = String(note?.noteType || "").toUpperCase();
    const amount = round2(Math.abs(Number(note?.amount || 0)));

    if (noteType === "CREDIT_NOTE") current.creditNoteTotal += amount;
    if (noteType === "DEBIT_NOTE") current.debitNoteTotal += amount;

    totalsByInvoice.set(sourceInvoiceId, current);
  });

  return invoices.map((invoice) => {
    const sourceInvoiceId = String(invoice?._id || "");
    const totals = totalsByInvoice.get(sourceInvoiceId) || {
      creditNoteTotal: 0,
      debitNoteTotal: 0,
    };

    const baseAmount = round2(Math.abs(Number(invoice?.amount || 0)));
    // Credit notes reduce the source invoice balance. Debit notes are separate
    // receivable documents and are exposed as independent allocation targets
    // below, so they must not be merged into the older invoice balance.
    const adjustedAmount = round2(baseAmount - totals.creditNoteTotal);

    return {
      ...(typeof invoice?.toObject === "function" ? invoice.toObject() : invoice),
      creditNoteTotal: round2(totals.creditNoteTotal),
      debitNoteTotal: round2(totals.debitNoteTotal),
      adjustedAmount: Math.max(0, adjustedAmount),
    };
  });
};

const buildDebitNoteAllocationSnapshots = (notes = []) =>
  notes
    .filter((note) => String(note?.noteType || "").toUpperCase() === "DEBIT_NOTE")
    .map((note) => {
      const sourceInvoiceId = String(note?.sourceInvoice || "");
      const metadata = note?.metadata && typeof note.metadata === "object" ? note.metadata : {};
      const sourceInvoiceNumber =
        metadata?.sourceInvoiceNumber ||
        metadata?.sourceInvoiceRef ||
        metadata?.invoiceNumber ||
        "";
      const noteNumber = note?.noteNumber || `DN-${String(note?._id || "").slice(-6)}`;
      const description =
        note?.description ||
        (sourceInvoiceNumber
          ? `Debit note against ${sourceInvoiceNumber}`
          : "Debit note receivable");

      return {
        _id: note?._id,
        tenant: note?.tenant,
        amount: round2(Math.abs(Number(note?.amount || 0))),
        invoiceNumber: noteNumber,
        category: note?.category || metadata?.sourceInvoiceCategory || "OTHER_CHARGE",
        metadata: {
          ...metadata,
          sourceTransactionType: "invoice_note",
          invoicePriorityCategory: "debit_note",
          noteType: "DEBIT_NOTE",
          noteNumber,
          sourceInvoice: sourceInvoiceId || null,
          sourceInvoiceNumber,
        },
        status: "pending",
        postingStatus: note?.postingStatus || "posted",
        invoiceDate: note?.noteDate || note?.createdAt || null,
        dueDate: note?.noteDate || note?.createdAt || null,
        createdAt: note?.createdAt || note?.noteDate || null,
        ledgerMode: "invoice_note",
        description,
        depositHeldBy: "",
      };
    })
    .filter((snapshot) => snapshot?._id && Number(snapshot?.amount || 0) > 0);

const buildNoteStatementRow = (noteDoc) => {
  const note = typeof noteDoc?.toObject === "function" ? noteDoc.toObject() : noteDoc || {};
  const amount = round2(Math.abs(Number(note.amount || 0)));
  const noteType = String(note.noteType || "").toUpperCase();

  return {
    ...note,
    transactionType: noteType,
    debit: noteType === "DEBIT_NOTE" ? amount : 0,
    credit: noteType === "CREDIT_NOTE" ? amount : 0,
    signedAmount: noteType === "CREDIT_NOTE" ? -amount : amount,
    transactionDate: note.noteDate || note.createdAt || null,
  };
};

const summarizeTenantSnapshotState = ({ invoiceSnapshots = [], receiptAllocations = [] } = {}) => {
  const outstandingInvoices = invoiceSnapshots.reduce(
    (sum, snapshot) => sum + Math.max(0, Number(snapshot?.outstanding || 0)),
    0
  );

  const unappliedReceipts = receiptAllocations.reduce(
    (sum, allocation) => sum + Math.abs(Number(allocation?.unappliedAmount || 0)),
    0
  );

  return {
    outstandingInvoices: round2(outstandingInvoices),
    unappliedReceipts: round2(unappliedReceipts),
    balance: round2(outstandingInvoices - unappliedReceipts),
  };
};

const buildInvoiceStatusBulkOps = (invoiceSnapshots = []) =>
  invoiceSnapshots
    .filter((snapshot) => snapshot.computedStatus && snapshot.computedStatus !== snapshot.status)
    .map((snapshot) => ({
      updateOne: {
        filter: { _id: snapshot._id },
        update: { $set: { status: snapshot.computedStatus } },
      },
    }));

const applyTenantBalanceAndStatus = async ({
  businessId,
  tenantId,
  invoiceSnapshots = [],
  receiptAllocations = [],
}) => {
  const summary = summarizeTenantSnapshotState({ invoiceSnapshots, receiptAllocations });

  if (!businessId || !tenantId) {
    return {
      tenant: null,
      resolvedStatus: "",
      ...summary,
    };
  }

  const tenant = await Tenant.findOne({ _id: tenantId, business: businessId })
    .select("status")
    .lean();
  if (!tenant) {
    return {
      tenant: null,
      resolvedStatus: "",
      ...summary,
    };
  }

  const resolvedStatus = resolveTenantOperationalStatus({ tenant, invoiceSnapshots });
  const updateFields = { balance: summary.balance };
  if (resolvedStatus && resolvedStatus !== safeLower(tenant.status || "")) {
    updateFields.status = resolvedStatus;
  }

  await Tenant.findOneAndUpdate(
    { _id: tenantId, business: businessId },
    { $set: updateFields },
    { new: true }
  );

  return {
    tenant,
    resolvedStatus,
    ...summary,
  };
};

const recomputeTenantBalance = async (tenantId, businessId, options = {}) => {
  if (!tenantId || !businessId) return;

  const snapshotBundle =
    options?.snapshotBundle ||
    (await computeTenantInvoiceSnapshots({
      businessId,
      tenantId,
    }));

  const { invoiceSnapshots = [], receiptAllocations = [] } = snapshotBundle;

  await applyTenantBalanceAndStatus({
    businessId,
    tenantId,
    invoiceSnapshots,
    receiptAllocations,
  });
};

// Incremental balance update — keeps Tenant.balance approximately correct
// between full recompute cycles. recomputeTenantFinancialState remains the
// authoritative reconciler and must still be called after batch operations
// and on any balance-sensitive page load.
export const applyIncrementalBalanceDelta = async ({
  tenantId,
  businessId,
  delta,
  session = null,
}) => {
  if (!tenantId || !businessId) return null;
  try {
    const opts = { new: true, runValidators: false };
    if (session !== null) opts.session = session;
    return await Tenant.findOneAndUpdate(
      { _id: tenantId, business: businessId },
      { $inc: { balance: delta } },
      opts
    ).lean();
  } catch (err) {
    console.error("applyIncrementalBalanceDelta error:", err);
    return null;
  }
};

const getInvoicePriorityGroup = (invoice = {}) => {
  const category = String(invoice?.category || "").toUpperCase();
  const explicitPriority = String(invoice?.metadata?.invoicePriorityCategory || "")
    .trim()
    .toLowerCase();

  if (explicitPriority) return explicitPriority;
  if (category === "RENT_CHARGE") return "rent";
  if (category === "DEPOSIT_CHARGE") return "deposit";
  if (category === "UTILITY_CHARGE") return "utility";
  if (category === "LATE_PENALTY_CHARGE") return "late_penalty";
  if (category === "OTHER_CHARGE") return "other";

  const description = String(invoice?.description || "").toLowerCase();
  if (/debit\s*note/.test(description)) return "debit_note";
  return "other";
};

const getInvoiceUtilityType = (invoice = {}) => {
  const metadata = invoice?.metadata || {};
  const explicit = String(
    metadata.utilityType || metadata.meterUtilityType || metadata.statementUtilityType || ""
  ).trim();

  if (explicit) return explicit;
  return "";
};

const buildInheritedInvoiceNoteMetadata = ({
  sourceInvoice = {},
  incomingMetadata = {},
} = {}) => {
  const sourceMetadata =
    sourceInvoice?.metadata && typeof sourceInvoice.metadata === "object"
      ? sourceInvoice.metadata
      : {};
  const requestedMetadata =
    incomingMetadata && typeof incomingMetadata === "object" ? incomingMetadata : {};

  const inherited = {
    ...requestedMetadata,
    sourceInvoiceNumber: sourceInvoice?.invoiceNumber || requestedMetadata?.sourceInvoiceNumber || "",
    sourceInvoiceCategory: sourceInvoice?.category || requestedMetadata?.sourceInvoiceCategory || "",
    sourceInvoiceAmount: Number(sourceInvoice?.amount || requestedMetadata?.sourceInvoiceAmount || 0),
  };

  const passthroughKeys = [
    "utilityType",
    "meterUtilityType",
    "statementUtilityType",
    "utilityName",
    "utility",
    "name",
    "billItemKey",
    "billItemLabel",
    "invoicePriorityCategory",
    "sourceTransactionType",
    "statementClassification",
    "includeInLandlordStatement",
    "includeInCategoryTotals",
  ];

  passthroughKeys.forEach((key) => {
    const requestedValue = requestedMetadata?.[key];
    const sourceValue = sourceMetadata?.[key];
    if (requestedValue !== undefined && requestedValue !== null && requestedValue !== "") {
      inherited[key] = requestedValue;
      return;
    }
    if (sourceValue !== undefined && sourceValue !== null && sourceValue !== "") {
      inherited[key] = sourceValue;
    }
  });

  if (!inherited.sourceTransactionType) {
    inherited.sourceTransactionType = "invoice_note";
  }

  return inherited;
};

const isTakeOnBalanceInvoice = (invoice = {}) => {
  const metadata = invoice?.metadata || {};
  const explicitFlag =
    metadata?.isTakeOnBalance === true ||
    metadata?.takeOnBalance === true ||
    metadata?.openingBalance === true;

  if (explicitFlag) return true;

  const sourceType = String(
    metadata?.sourceTransactionType || metadata?.source || metadata?.entryType || ""
  )
    .trim()
    .toLowerCase();

  if (["tenant_take_on_balance", "tenant_opening_balance", "opening_balance"].includes(sourceType)) {
    return true;
  }

  const description = String(invoice?.description || "").toLowerCase();
  return /\bopening\b|take\s*-?\s*on/.test(description);
};

const getTakeOnBillItemInfo = (invoice = {}) => {
  const metadata = invoice?.metadata || {};
  const explicitLabel = String(metadata?.billItemLabel || "").trim();
  const explicitKey = String(metadata?.billItemKey || "").trim();

  if (explicitLabel || explicitKey) {
    return {
      billItemKey: explicitKey || explicitLabel.toLowerCase().replace(/\s+/g, "_"),
      billItemLabel: explicitLabel || explicitKey || "Bill Item",
    };
  }

  const category = String(invoice?.category || "").toUpperCase();
  if (category === "RENT_CHARGE") return { billItemKey: "rent", billItemLabel: "Rent" };
  if (category === "DEPOSIT_CHARGE") return { billItemKey: "deposit", billItemLabel: "Deposit" };
  if (category === "LATE_PENALTY_CHARGE") return { billItemKey: "late_penalty", billItemLabel: "Late Penalty" };
  if (category === "UTILITY_CHARGE") {
    const utilityType = getInvoiceUtilityType(invoice);
    const normalizedUtilityType = String(utilityType || "").trim();
    if (normalizedUtilityType) {
      return {
        billItemKey: `utility:${normalizedUtilityType.toLowerCase().replace(/\s+/g, "_")}`,
        billItemLabel: normalizedUtilityType,
      };
    }
    return { billItemKey: "utility", billItemLabel: "Utility" };
  }

  return {
    billItemKey: String(category || "other").toLowerCase(),
    billItemLabel: String(category || "Other")
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  };
};

const getTakeOnType = (invoice = {}) => {
  const metadata = invoice?.metadata || {};
  const explicitType = String(metadata?.takeOnType || metadata?.entryDirection || "")
    .trim()
    .toLowerCase();
  if (["credit", "negative"].includes(explicitType)) return "Credit";
  return "Debit";
};

const priorityRankMap = {
  rent: 1,
  deposit: 2,
  utility: 3,
  late_penalty: 4,
  debit_note: 5,
  other: 6,
};

const getPriorityRank = (priorityGroup = "") =>
  priorityRankMap[String(priorityGroup || "").toLowerCase()] || 99;

const isInvoiceActiveForAllocation = (invoice = {}) =>
  !["cancelled", "reversed"].includes(String(invoice?.status || "").toLowerCase());

const buildLegacyReceiptAllocations = ({ receipt, invoiceSnapshots = [] }) => {
  const receiptAmount = Math.abs(Number(receipt?.amount || 0));
  if (receiptAmount <= 0) return [];

  const receiptMetadata = receipt?.metadata && typeof receipt.metadata === "object" ? receipt.metadata : {};
  const takeOnBillItemKey = String(receiptMetadata?.takeOnBillItemKey || receiptMetadata?.billItemKey || "")
    .trim()
    .toLowerCase();
  const takeOnUtilityType = normalizeUtilityMatch(
    receiptMetadata?.utilityType || receiptMetadata?.utilityName || receiptMetadata?.takeOnBillItemLabel || ""
  );

  const paymentType = String(receipt?.paymentType || "").toLowerCase();
  const eligiblePriorityGroups =
    takeOnBillItemKey.startsWith("utility:") || takeOnBillItemKey === "utility"
      ? ["utility"]
      : takeOnBillItemKey === "deposit"
      ? ["deposit"]
      : takeOnBillItemKey === "late_penalty"
      ? ["late_penalty"]
      : takeOnBillItemKey === "other"
      ? ["debit_note", "other"]
      : paymentType === "deposit"
      ? ["deposit"]
      : paymentType === "utility"
      ? ["utility"]
      : paymentType === "late_fee"
      ? ["late_penalty"]
      : paymentType === "other"
      ? ["debit_note", "other"]
      : ["rent"];

  let remaining = receiptAmount;
  const rows = [];

  for (const snapshot of invoiceSnapshots) {
    if (remaining <= 0) break;
    if (!eligiblePriorityGroups.includes(snapshot.priorityGroup)) continue;
    if (String(snapshot.priorityGroup || "").toLowerCase() === "utility" && takeOnUtilityType) {
      const snapshotUtility = normalizeUtilityMatch(snapshot.utilityType || "");
      if (!snapshotUtility || snapshotUtility !== takeOnUtilityType) continue;
    }

    const outstanding = Math.max(0, Number(snapshot.outstanding || 0));
    if (outstanding <= 0) continue;

    const appliedAmount = Math.min(outstanding, remaining);
    if (appliedAmount <= 0) continue;

    rows.push({
      invoice: String(snapshot._id),
      invoiceNumber: snapshot.invoiceNumber || "",
      category: snapshot.category,
      priorityGroup: snapshot.priorityGroup,
      utilityType: snapshot.utilityType || "",
      depositHeldBy: snapshot.depositHeldBy || snapshot?.metadata?.depositHeldBy || "",
      invoiceLedgerMode: snapshot.ledgerMode || snapshot?.metadata?.ledgerMode || "",
      appliedAmount,
      beforeOutstanding: outstanding,
      afterOutstanding: Math.max(0, outstanding - appliedAmount),
      invoiceDate: snapshot.invoiceDate || null,
      dueDate: snapshot.dueDate || null,
      description: snapshot.description || "",
      source: "legacy_payment_type",
    });

    snapshot.applied = Number(snapshot.applied || 0) + appliedAmount;
    snapshot.outstanding = Math.max(0, Number(snapshot.amount || 0) - snapshot.applied);
    remaining -= appliedAmount;
  }

  return rows;
};

const normalizeStoredAllocationRows = ({ receipt, invoiceMap = new Map() }) => {
  const rawRows = Array.isArray(receipt?.allocations) ? receipt.allocations : [];
  if (rawRows.length === 0) return [];

  let remainingReceipt = Math.abs(Number(receipt?.amount || 0));
  const rows = [];

  for (const raw of rawRows) {
    if (remainingReceipt <= 0) break;

    const invoiceId = String(raw?.invoice || "");
    if (!invoiceId || !invoiceMap.has(invoiceId)) continue;

    const snapshot = invoiceMap.get(invoiceId);
    const outstanding = Math.max(0, Number(snapshot.outstanding || 0));
    if (outstanding <= 0) continue;

    const requestedAmount = Math.abs(Number(raw?.appliedAmount || raw?.amount || 0));
    const appliedAmount = Math.min(requestedAmount, outstanding, remainingReceipt);

    if (appliedAmount <= 0) continue;

    rows.push({
      invoice: invoiceId,
      invoiceNumber: snapshot.invoiceNumber || raw?.invoiceNumber || "",
      category: snapshot.category,
      priorityGroup: snapshot.priorityGroup,
      utilityType: snapshot.utilityType || "",
      depositHeldBy:
        raw?.depositHeldBy ||
        snapshot.depositHeldBy ||
        snapshot?.metadata?.depositHeldBy ||
        "",
      invoiceLedgerMode:
        raw?.invoiceLedgerMode ||
        snapshot.ledgerMode ||
        snapshot?.metadata?.ledgerMode ||
        "",
      appliedAmount,
      beforeOutstanding: outstanding,
      afterOutstanding: Math.max(0, outstanding - appliedAmount),
      invoiceDate: snapshot.invoiceDate || null,
      dueDate: snapshot.dueDate || null,
      description: snapshot.description || "",
      source: "stored_allocation",
    });

    snapshot.applied = Number(snapshot.applied || 0) + appliedAmount;
    snapshot.outstanding = Math.max(0, Number(snapshot.amount || 0) - snapshot.applied);
    remainingReceipt -= appliedAmount;
  }

  return rows;
};

const buildSortedInvoiceSnapshots = (invoices = []) => {
  const MAX_MS = Number.MAX_SAFE_INTEGER;
  return invoices
    .filter(isInvoiceActiveForAllocation)
    .map((invoice) => {
      const priorityGroup = getInvoicePriorityGroup(invoice);
      return {
        ...invoice,
        priorityGroup,
        priorityRank: getPriorityRank(priorityGroup),
        utilityType: getInvoiceUtilityType(invoice),
        applied: 0,
        outstanding: Math.abs(Number(invoice?.amount || 0)),
        _dueDateMs: invoice.dueDate ? new Date(invoice.dueDate).getTime() : MAX_MS,
        _invoiceDateMs: invoice.invoiceDate ? new Date(invoice.invoiceDate).getTime() : MAX_MS,
        _createdAtMs: invoice.createdAt ? new Date(invoice.createdAt).getTime() : MAX_MS,
      };
    })
    .sort((a, b) => {
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
      if (a._dueDateMs !== b._dueDateMs) return a._dueDateMs - b._dueDateMs;
      if (a._invoiceDateMs !== b._invoiceDateMs) return a._invoiceDateMs - b._invoiceDateMs;
      if (a._createdAtMs !== b._createdAtMs) return a._createdAtMs - b._createdAtMs;
      return String(a._id).localeCompare(String(b._id));
    });
};

const TENANT_SNAPSHOT_INVOICE_FIELDS = [
  "_id",
  "tenant",
  "amount",
  "invoiceNumber",
  "category",
  "metadata",
  "status",
  "postingStatus",
  "invoiceDate",
  "dueDate",
  "createdAt",
  "ledgerMode",
  "description",
  "depositHeldBy",
].join(" ");

const TENANT_SNAPSHOT_RECEIPT_FIELDS = [
  "_id",
  "tenant",
  "amount",
  "receiptNumber",
  "referenceNumber",
  "paymentType",
  "paymentDate",
  "createdAt",
  "metadata",
  "allocations",
].join(" ");

const TENANT_SNAPSHOT_NOTE_FIELDS = [
  "_id",
  "tenant",
  "sourceInvoice",
  "noteNumber",
  "noteType",
  "category",
  "amount",
  "description",
  "noteDate",
  "createdAt",
  "postingStatus",
  "metadata",
].join(" ");

const getActiveReceiptsForTenant = async ({ businessId, tenantId, asOfDate = null }) =>
  RentPayment.find({
    business: businessId,
    tenant: tenantId,
    ledgerType: "receipts",
    isConfirmed: true,
    isCancelled: { $ne: true },
    isReversed: { $ne: true },
    reversalOf: null,
    ...buildAsOfDateFilter("paymentDate", asOfDate),
  })
    .select(TENANT_SNAPSHOT_RECEIPT_FIELDS)
    .sort({ paymentDate: 1, createdAt: 1, _id: 1 })
    .lean();

const getActiveInvoicesForTenant = async ({ businessId, tenantId, asOfDate = null }) =>
  TenantInvoice.find({
    business: businessId,
    tenant: tenantId,
    status: { $in: ["pending", "paid", "partially_paid"] },
    ...buildAsOfDateFilter("invoiceDate", asOfDate),
  })
    .select(TENANT_SNAPSHOT_INVOICE_FIELDS)
    .sort({ dueDate: 1, invoiceDate: 1, createdAt: 1, _id: 1 })
    .lean();

const getActiveInvoicesForTenants = async ({ businessId, tenantIds = [], asOfDate = null, extraQuery = {} }) => {
  const normalizedTenantIds = [...new Set((Array.isArray(tenantIds) ? tenantIds : []).filter(Boolean).map(String))];
  if (normalizedTenantIds.length === 0) return [];

  const tenantFilter = normalizedTenantIds.length === 1
    ? normalizedTenantIds[0]
    : { $in: normalizedTenantIds };

  return TenantInvoice.find({
    business: businessId,
    tenant: tenantFilter,
    status: { $in: ["pending", "paid", "partially_paid"] },
    ...buildAsOfDateFilter("invoiceDate", asOfDate),
    ...(extraQuery && typeof extraQuery === "object" ? extraQuery : {}),
  })
    .select(TENANT_SNAPSHOT_INVOICE_FIELDS)
    .sort({ tenant: 1, dueDate: 1, invoiceDate: 1, createdAt: 1, _id: 1 })
    .lean();
};

const getActiveReceiptsForTenants = async ({ businessId, tenantIds = [], asOfDate = null, extraQuery = {} }) => {
  const normalizedTenantIds = [...new Set((Array.isArray(tenantIds) ? tenantIds : []).filter(Boolean).map(String))];
  if (normalizedTenantIds.length === 0) return [];

  const tenantFilter = normalizedTenantIds.length === 1
    ? normalizedTenantIds[0]
    : { $in: normalizedTenantIds };

  return RentPayment.find({
    business: businessId,
    tenant: tenantFilter,
    ledgerType: "receipts",
    isConfirmed: true,
    isCancelled: { $ne: true },
    isReversed: { $ne: true },
    reversalOf: null,
    ...buildAsOfDateFilter("paymentDate", asOfDate),
    ...(extraQuery && typeof extraQuery === "object" ? extraQuery : {}),
  })
    .select(TENANT_SNAPSHOT_RECEIPT_FIELDS)
    .sort({ tenant: 1, paymentDate: 1, createdAt: 1, _id: 1 })
    .lean();
};

const getActiveNotesForTenants = async ({ businessId, tenantIds = [], asOfDate = null, extraQuery = {} }) => {
  const normalizedTenantIds = [...new Set((Array.isArray(tenantIds) ? tenantIds : []).filter(Boolean).map(String))];
  if (normalizedTenantIds.length === 0) return [];

  const tenantFilter = normalizedTenantIds.length === 1
    ? normalizedTenantIds[0]
    : { $in: normalizedTenantIds };

  return TenantInvoiceNote.find({
    business: businessId,
    tenant: tenantFilter,
    status: { $nin: ["cancelled", "reversed"] },
    postingStatus: { $in: ["posted", "not_applicable", undefined, null] },
    ...buildAsOfDateFilter("noteDate", asOfDate),
    ...(extraQuery && typeof extraQuery === "object" ? extraQuery : {}),
  })
    .select(TENANT_SNAPSHOT_NOTE_FIELDS)
    .sort({ tenant: 1, noteDate: 1, createdAt: 1, _id: 1 })
    .lean();
};

const groupDocsByTenantId = (docs = []) => {
  const grouped = new Map();

  docs.forEach((doc) => {
    const tenantId = normalizeEntityId(doc?.tenant);
    if (!tenantId) return;
    const bucket = grouped.get(tenantId) || [];
    bucket.push(doc);
    grouped.set(tenantId, bucket);
  });

  return grouped;
};

const buildTenantSnapshotBundle = ({ invoices = [], receipts = [], notes = [] }) => {
  const adjustedInvoices = attachNoteTotalsToInvoices(invoices, notes);
  const debitNoteSnapshots = buildDebitNoteAllocationSnapshots(notes);

  const invoiceSnapshots = buildSortedInvoiceSnapshots(
    [
      ...adjustedInvoices.map((invoice) => ({
        ...invoice,
        amount: Math.abs(Number(invoice.adjustedAmount ?? invoice.amount ?? 0)),
      })),
      ...debitNoteSnapshots,
    ]
  );

  const invoiceMap = new Map(invoiceSnapshots.map((snapshot) => [String(snapshot._id), snapshot]));
  const receiptAllocations = [];

  for (const receipt of receipts) {
    let rows = normalizeStoredAllocationRows({
      receipt,
      invoiceMap,
    });

    if (rows.length === 0) {
      rows = buildLegacyReceiptAllocations({
        receipt,
        invoiceSnapshots,
      });
    }

    const allocatedAmount = rows.reduce((sum, row) => sum + Number(row.appliedAmount || 0), 0);
    receiptAllocations.push({
      receiptId: String(receipt._id),
      receiptNumber: receipt.receiptNumber || "",
      paymentType: receipt.paymentType || "rent",
      amount: Math.abs(Number(receipt.amount || 0)),
      allocatedAmount,
      unappliedAmount: Math.max(0, Math.abs(Number(receipt.amount || 0)) - allocatedAmount),
      paymentDate: receipt.paymentDate || receipt.createdAt || null,
      rows,
    });
  }

  invoiceSnapshots.forEach((snapshot) => {
    snapshot.originalAmount =
      Math.abs(Number(snapshot?.amount || 0)) -
      Number(snapshot.debitNoteTotal || 0) +
      Number(snapshot.creditNoteTotal || 0);
    snapshot.remainingCreditableAmount = Math.max(0, round2(Number(snapshot.outstanding || 0)));
    if (snapshot.outstanding <= 0) snapshot.computedStatus = "paid";
    else if (snapshot.applied > 0) snapshot.computedStatus = "partially_paid";
    else snapshot.computedStatus = "pending";
  });

  return {
    invoiceSnapshots,
    receiptAllocations,
    notes,
  };
};

export const computeTenantInvoiceSnapshotsBatch = async ({ businessId, tenantIds = [], asOfDate = null, invoiceQuery = {}, receiptQuery = {}, noteQuery = {} }) => {
  const normalizedTenantIds = [...new Set((Array.isArray(tenantIds) ? tenantIds : []).filter(Boolean).map(String))];
  if (!businessId || normalizedTenantIds.length === 0) return new Map();

  const [invoices, receipts, notes] = await Promise.all([
    getActiveInvoicesForTenants({ businessId, tenantIds: normalizedTenantIds, asOfDate, extraQuery: invoiceQuery }),
    getActiveReceiptsForTenants({ businessId, tenantIds: normalizedTenantIds, asOfDate, extraQuery: receiptQuery }),
    getActiveNotesForTenants({ businessId, tenantIds: normalizedTenantIds, asOfDate, extraQuery: noteQuery }),
  ]);

  const invoicesByTenant = groupDocsByTenantId(invoices);
  const receiptsByTenant = groupDocsByTenantId(receipts);
  const notesByTenant = groupDocsByTenantId(notes);
  const bundles = new Map();

  normalizedTenantIds.forEach((tenantId) => {
    bundles.set(
      tenantId,
      buildTenantSnapshotBundle({
        invoices: invoicesByTenant.get(tenantId) || [],
        receipts: receiptsByTenant.get(tenantId) || [],
        notes: notesByTenant.get(tenantId) || [],
      })
    );
  });

  return bundles;
};

const computeTenantInvoiceSnapshots = async ({ businessId, tenantId, asOfDate = null }) => {
  if (!businessId || !tenantId) return { invoiceSnapshots: [], receiptAllocations: [], notes: [] };

  const [invoices, receipts, notes] = await Promise.all([
    getActiveInvoicesForTenant({ businessId, tenantId, asOfDate }),
    getActiveReceiptsForTenant({ businessId, tenantId, asOfDate }),
    getActiveNotesForTenant({ businessId, tenantId, asOfDate }),
  ]);

  return buildTenantSnapshotBundle({ invoices, receipts, notes });
};

const recomputeInvoiceStatusesForTenant = async ({ businessId, tenantId, snapshotBundle = null }) => {
  if (!businessId || !tenantId) return [];

  const { invoiceSnapshots = [] } =
    snapshotBundle || (await computeTenantInvoiceSnapshots({ businessId, tenantId }));
  if (invoiceSnapshots.length === 0) return [];

  const bulkOps = buildInvoiceStatusBulkOps(invoiceSnapshots);

  if (bulkOps.length > 0) {
    await TenantInvoice.bulkWrite(bulkOps, { ordered: false });
  }

  return invoiceSnapshots;
};

const recomputeTenantFinancialState = async ({ businessId, tenantId }) => {
  if (!businessId || !tenantId) {
    return {
      invoiceSnapshots: [],
      receiptAllocations: [],
      notes: [],
      outstandingInvoices: 0,
      unappliedReceipts: 0,
      balance: 0,
      resolvedStatus: "",
      statusUpdateCount: 0,
    };
  }

  const snapshotBundle = await computeTenantInvoiceSnapshots({ businessId, tenantId });
  const { invoiceSnapshots = [], receiptAllocations = [] } = snapshotBundle;
  const bulkOps = buildInvoiceStatusBulkOps(invoiceSnapshots);

  if (bulkOps.length > 0) {
    await TenantInvoice.bulkWrite(bulkOps, { ordered: false });
  }

  const tenantState = await applyTenantBalanceAndStatus({
    businessId,
    tenantId,
    invoiceSnapshots,
    receiptAllocations,
  });

  return {
    ...snapshotBundle,
    ...tenantState,
    statusUpdateCount: bulkOps.length,
  };
};

const postInvoiceJournal = async ({ invoice, createdBy, incomeAccount, receivableAccount: preResolvedReceivableAccount = null }) => {
  const receivableAccount = preResolvedReceivableAccount || await resolveTenantReceivableAccount(invoice.business);
  const amount = Math.abs(Number(invoice.amount || 0));
  const taxSnapshot = invoice?.taxSnapshot || {};
  const outputTaxAmount = Math.abs(Number(taxSnapshot.taxAmount || 0));
  const netAmount = outputTaxAmount > 0 ? Math.abs(Number(taxSnapshot.netAmount || amount)) : amount;
  const recognitionDate = normalizeDate(invoice.bookingDate || invoice.invoiceDate);
  const { start, end } = buildStatementPeriod(recognitionDate);
  const txDate = recognitionDate;
  const journalGroupId = new mongoose.Types.ObjectId();
  const ledgerCategory = mapInvoiceCategoryToLedgerCategory(invoice.category);

  let creditAccount = null;
  let postingRole = "income_or_charge";
  let includeInLandlordStatement = false;
  let includeInCategoryTotals = false;

  if (invoice.category === "DEPOSIT_CHARGE") {
    creditAccount = await resolveTenantDepositPayableAccount(invoice.business);
    postingRole = "tenant_deposit_liability";
    includeInLandlordStatement = false;
    includeInCategoryTotals = false;
  } else {
    creditAccount = incomeAccount;

    if (!creditAccount) {
      throw new Error("Selected invoice chart account was not found for this business.");
    }

    const invoiceMetadata = invoice?.metadata || {};
    const metadataIncludeInStatement =
      typeof invoiceMetadata.includeInLandlordStatement === "boolean"
        ? invoiceMetadata.includeInLandlordStatement
        : invoice.category !== "DEPOSIT_CHARGE" && invoice.category !== "LATE_PENALTY_CHARGE";
    const metadataIncludeInTotals =
      typeof invoiceMetadata.includeInCategoryTotals === "boolean"
        ? invoiceMetadata.includeInCategoryTotals
        : invoice.category !== "DEPOSIT_CHARGE" && invoice.category !== "LATE_PENALTY_CHARGE";

    postingRole =
      invoice.category === "LATE_PENALTY_CHARGE"
        ? "manager_penalty_income"
        : invoice.category === "OTHER_CHARGE"
          ? "manager_service_income"
          : "income_or_charge";
    includeInLandlordStatement = metadataIncludeInStatement;
    includeInCategoryTotals = metadataIncludeInTotals;
  }

  const commonMetadata = {
    includeInLandlordStatement,
    includeInCategoryTotals,
    invoiceNumber: invoice.invoiceNumber,
    invoiceCategory: invoice.category,
    depositHeldBy: invoice.depositHeldBy || null,
    ledgerMode: invoice.ledgerMode,
    taxSnapshot,
    ...(invoice.metadata || {}),
  };

  const receivableLeg = await postEntry({
    business: invoice.business,
    property: invoice.property,
    landlord: invoice.landlord,
    tenant: invoice.tenant,
    unit: invoice.unit,
    sourceTransactionType: "invoice",
    sourceTransactionId: String(invoice._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: ledgerCategory,
    amount,
    direction: "debit",
    debit: amount,
    credit: 0,
    accountId: receivableAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver: "manager",
    notes: `Invoice ${invoice.invoiceNumber}`,
    metadata: {
      ...commonMetadata,
      postingRole: "tenant_receivable",
    },
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    status: "approved",
  });

  const creditLeg = await postEntry({
    business: invoice.business,
    property: invoice.property,
    landlord: invoice.landlord,
    tenant: invoice.tenant,
    unit: invoice.unit,
    sourceTransactionType: "invoice",
    sourceTransactionId: String(invoice._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: ledgerCategory,
    amount: netAmount,
    direction: "credit",
    debit: 0,
    credit: netAmount,
    accountId: creditAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver: "manager",
    notes: `Invoice income leg ${invoice.invoiceNumber}`,
    metadata: {
      ...commonMetadata,
      postingRole,
      offsetOfEntryId: String(receivableLeg._id),
    },
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    status: "approved",
  });

  const entries = [receivableLeg, creditLeg];

  if (outputTaxAmount > 0 && invoice.category !== "DEPOSIT_CHARGE") {
    const companyTaxConfig = await getCompanyTaxConfiguration(invoice.business);
    const outputVatAccount = await resolveOutputVatAccount({
      businessId: invoice.business,
      companyTaxConfig,
    });

    const taxLeg = await postEntry({
      business: invoice.business,
      property: invoice.property,
      landlord: invoice.landlord,
      tenant: invoice.tenant,
      unit: invoice.unit,
      sourceTransactionType: "invoice",
      sourceTransactionId: String(invoice._id),
      transactionDate: txDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: ledgerCategory,
      amount: outputTaxAmount,
      direction: "credit",
      debit: 0,
      credit: outputTaxAmount,
      accountId: outputVatAccount._id,
      journalGroupId,
      payer: "tenant",
      receiver: "system",
      notes: `Invoice output VAT ${invoice.invoiceNumber}`,
      metadata: {
        ...commonMetadata,
        postingRole: "output_vat_payable",
        offsetOfEntryId: String(receivableLeg._id),
      },
      createdBy,
      approvedBy: createdBy,
      approvedAt: new Date(),
      status: "approved",
    });

    entries.push(taxLeg);
  }

  return {
    journalGroupId,
    entries,
  };
};

const postInvoiceNoteJournal = async ({ note, createdBy, sourceInvoice = null, postingAccount }) => {
  const receivableAccount = await resolveTenantReceivableAccount(note.business);
  const amount = Math.abs(Number(note.amount || 0));
  const { start, end } = buildStatementPeriod(note.noteDate);
  const txDate = normalizeDate(note.noteDate);
  const journalGroupId = new mongoose.Types.ObjectId();
  const ledgerCategory = mapInvoiceCategoryToLedgerCategory(note.category);
  const isCreditNote = String(note.noteType || "").toUpperCase() === "CREDIT_NOTE";

  const receivableLeg = await postEntry({
    business: note.business,
    property: note.property,
    landlord: note.landlord,
    tenant: note.tenant,
    unit: note.unit,
    sourceTransactionType: TENANT_INVOICE_NOTE_SOURCE_TYPE,
    sourceTransactionId: String(note._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: ledgerCategory,
    amount,
    direction: isCreditNote ? "credit" : "debit",
    debit: isCreditNote ? 0 : amount,
    credit: isCreditNote ? amount : 0,
    accountId: receivableAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver: "manager",
    notes: `${note.noteType} ${note.noteNumber}`,
    metadata: {
      noteType: note.noteType,
      noteNumber: note.noteNumber,
      sourceInvoiceId: sourceInvoice?._id ? String(sourceInvoice._id) : null,
      sourceInvoiceNumber: sourceInvoice?.invoiceNumber || null,
      postingRole: "tenant_receivable",
      ...(note.metadata || {}),
    },
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    status: "approved",
  });

  const offsetLeg = await postEntry({
    business: note.business,
    property: note.property,
    landlord: note.landlord,
    tenant: note.tenant,
    unit: note.unit,
    sourceTransactionType: TENANT_INVOICE_NOTE_SOURCE_TYPE,
    sourceTransactionId: String(note._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: ledgerCategory,
    amount,
    direction: isCreditNote ? "debit" : "credit",
    debit: isCreditNote ? amount : 0,
    credit: isCreditNote ? 0 : amount,
    accountId: postingAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver: "manager",
    notes: `${note.noteType} offset ${note.noteNumber}`,
    metadata: {
      noteType: note.noteType,
      noteNumber: note.noteNumber,
      sourceInvoiceId: sourceInvoice?._id ? String(sourceInvoice._id) : null,
      sourceInvoiceNumber: sourceInvoice?.invoiceNumber || null,
      postingRole: "income_or_charge",
      offsetOfEntryId: String(receivableLeg._id),
      ...(note.metadata || {}),
    },
    createdBy,
    approvedBy: createdBy,
    approvedAt: new Date(),
    status: "approved",
  });

  return {
    journalGroupId,
    entries: [receivableLeg, offsetLeg],
  };
};

export const getTenantInvoiceNoteChargeTypes = async (req, res) => {
  return res.status(200).json({
    chargeTypes: TENANT_INVOICE_CATEGORIES.map((category) => ({
      value: category,
      label: category,
    })),
  });
};

export const getTenantInvoiceNotes = async (req, res) => {
  try {
    const { tenant, business } = req.query;
    const query = {};
    if (tenant) query.tenant = tenant;
    if (business) query.business = business;

    if (!tenant && !business) {
      return res
        .status(400)
        .json({ error: "At least tenant or business query parameter is required" });
    }

    const notes = await TenantInvoiceNote.find(query)
      .sort({ noteDate: 1, createdAt: 1 })
      .populate("tenant", "name tenantName firstName lastName")
      .populate("unit", "unitNumber name unitName")
      .populate("property", "propertyName name")
      .populate("chartAccount", "code name type")
      .populate("createdBy", "surname otherNames email profile")
      .populate("sourceInvoice", "invoiceNumber amount category invoiceDate dueDate status")
      .lean();

    return res.status(200).json(notes.map(buildNoteStatementRow));
  } catch (error) {
    console.error("Failed to fetch tenant invoice notes:", error);
    return res.status(500).json({ error: "Failed to fetch tenant invoice notes" });
  }
};

export const getCreditableTenantInvoices = async (req, res) => {
  try {
    const { business, tenant } = req.query;
    if (!business) return res.status(400).json({ error: "business query parameter is required" });
    const businessId = String(business);

    const tenantIds = tenant
      ? [tenant]
      : await TenantInvoice.distinct("tenant", {
          business: businessId,
          status: { $nin: ["cancelled", "reversed"] },
        });

    const snapshotMap = await computeTenantInvoiceSnapshotsBatch({
      businessId,
      tenantIds,
      invoiceQuery: { postingStatus: "posted" },
    });

    const allResults = [];

    snapshotMap.forEach(({ invoiceSnapshots = [] }) => {
      invoiceSnapshots
        .filter((snapshot) => String(snapshot.postingStatus || "") === "posted")
        .filter((snapshot) =>
          ["pending", "partially_paid"].includes(
            String(snapshot.computedStatus || snapshot.status || "").toLowerCase()
          )
        )
        .filter((snapshot) => Number(snapshot.remainingCreditableAmount || 0) > 0)
        .forEach((snapshot) => {
          allResults.push({
            ...snapshot,
            sourceLineOptions: [
              {
                lineId: `invoice-line-${snapshot._id}`,
                sourceInvoiceId: snapshot._id,
                description: snapshot.description || snapshot.invoiceNumber || "Invoice line",
                category: snapshot.category,
                originalAmount: round2(Number(snapshot.originalAmount || 0)),
                netAmount: round2(Number(snapshot.amount || 0)),
                remainingCreditableAmount: round2(Number(snapshot.remainingCreditableAmount || 0)),
              },
            ],
          });
        });
    });

    return res.status(200).json(allResults);
  } catch (error) {
    console.error("Failed to fetch creditable invoices:", error);
    return res.status(500).json({ error: "Failed to fetch creditable invoices" });
  }
};

export const getTakeOnBalances = async (req, res) => {
  try {
    const businessId = ensureBusinessAccess(req, resolveAuthorizedBusinessId(req));
    const tenantId = req.query?.tenant ? String(req.query.tenant) : "";

    const invoiceQuery = { business: businessId };
    const receiptQuery = {
      business: businessId,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      reversalOf: null,
      "metadata.isTakeOnBalance": true,
    };
    if (tenantId) {
      invoiceQuery.tenant = tenantId;
      receiptQuery.tenant = tenantId;
    }

    const [invoices, takeOnReceipts] = await Promise.all([
      TenantInvoice.find(invoiceQuery)
        .sort({ invoiceDate: -1, createdAt: -1, _id: -1 })
        .populate("tenant", "name tenantName firstName lastName")
        .populate("unit", "unitNumber name unitName")
        .populate("property", "propertyName name")
        .populate("chartAccount", "code name type")
        .lean(),
      RentPayment.find(receiptQuery)
        .sort({ paymentDate: -1, createdAt: -1, _id: -1 })
        .populate("tenant", "name tenantName firstName lastName")
        .populate("unit", "unitNumber name unitName")
        .lean(),
    ]);

    const candidateInvoices = invoices.filter(isTakeOnBalanceInvoice);
    const candidateIds = new Set(candidateInvoices.map((invoice) => String(invoice._id)));
    const invoicesById = new Map(candidateInvoices.map((invoice) => [String(invoice._id), invoice]));
    const tenantIds = [...new Set([
      ...candidateInvoices.map((invoice) => String(invoice.tenant?._id || invoice.tenant || "")).filter(Boolean),
      ...takeOnReceipts.map((receipt) => String(receipt.tenant?._id || receipt.tenant || "")).filter(Boolean),
    ])];

    const rows = [];
    const snapshotMap = await computeTenantInvoiceSnapshotsBatch({
      businessId,
      tenantIds,
    });
    const takeOnReceiptsById = new Map(takeOnReceipts.map((receipt) => [String(receipt._id), receipt]));

    for (const currentTenantId of tenantIds) {
      const { invoiceSnapshots = [], receiptAllocations = [] } = snapshotMap.get(String(currentTenantId)) || {
        invoiceSnapshots: [],
        receiptAllocations: [],
      };

      invoiceSnapshots
        .filter((snapshot) => candidateIds.has(String(snapshot._id)))
        .forEach((snapshot) => {
          const sourceInvoice = invoicesById.get(String(snapshot._id)) || snapshot;
          const { billItemKey, billItemLabel } = getTakeOnBillItemInfo(sourceInvoice);
          const amount = round2(Number(snapshot.originalAmount || snapshot.amount || 0));
          const allocated = round2(Number(snapshot.applied || 0));
          const balance = round2(Number(snapshot.outstanding || 0));

          const status =
            balance <= 0
              ? "fully_allocated"
              : allocated > 0
              ? "partially_allocated"
              : "unallocated";

          rows.push({
            _id: String(snapshot._id),
            entryModel: "invoice",
            invoiceId: String(snapshot._id),
            invoiceNumber: sourceInvoice?.invoiceNumber || snapshot?.invoiceNumber || "",
            tenant: sourceInvoice?.tenant || null,
            unit: sourceInvoice?.unit || null,
            property: sourceInvoice?.property || null,
            chartAccount: sourceInvoice?.chartAccount || null,
            category: sourceInvoice?.category || snapshot?.category || "",
            type: getTakeOnType(sourceInvoice),
            amount,
            allocated,
            balance,
            effectiveDate: sourceInvoice?.invoiceDate || snapshot?.invoiceDate || null,
            dueDate: sourceInvoice?.dueDate || snapshot?.dueDate || null,
            status,
            description: sourceInvoice?.description || snapshot?.description || "",
            billItemKey,
            billItemLabel,
            metadata: sourceInvoice?.metadata || {},
            canEdit: allocated <= 0 && balance > 0,
            canDelete: allocated <= 0 && balance > 0,
          });
        });

      receiptAllocations
        .filter((allocation) => takeOnReceiptsById.has(String(allocation.receiptId)))
        .forEach((allocation) => {
          const receipt = takeOnReceiptsById.get(String(allocation.receiptId));
          const metadata = receipt?.metadata && typeof receipt.metadata === "object" ? receipt.metadata : {};
          const paymentType = String(receipt?.paymentType || metadata?.paymentType || "rent").toLowerCase();
          const billItemKey = String(metadata?.takeOnBillItemKey || metadata?.billItemKey || (paymentType === "late_fee" ? "late_penalty" : paymentType) || "rent");
          const utilityLabel = metadata?.takeOnBillItemLabel || metadata?.utilityType || metadata?.utilityName || "Utility";
          const billItemLabel =
            billItemKey.startsWith("utility:") || billItemKey === "utility"
              ? utilityLabel
              : billItemKey === "late_penalty"
              ? "Late Penalty"
              : billItemKey.charAt(0).toUpperCase() + billItemKey.slice(1).replace(/_/g, " ");
          const amount = round2(Number(receipt?.amount || 0));
          const allocated = round2(Number(allocation.allocatedAmount || 0));
          const balance = round2(Number(allocation.unappliedAmount || 0));
          const status =
            balance <= 0
              ? "fully_allocated"
              : allocated > 0
              ? "partially_allocated"
              : "unallocated";

          rows.push({
            _id: String(receipt._id),
            entryModel: "receipt",
            receiptId: String(receipt._id),
            invoiceNumber: receipt?.receiptNumber || receipt?.referenceNumber || "",
            tenant: receipt?.tenant || null,
            unit: receipt?.unit || null,
            property: null,
            chartAccount: null,
            category: "OPENING_CREDIT",
            type: "Credit",
            amount,
            allocated,
            balance,
            effectiveDate: receipt?.paymentDate || receipt?.createdAt || null,
            dueDate: receipt?.paymentDate || receipt?.createdAt || null,
            status,
            description: receipt?.description || "Tenant opening credit take-on balance",
            billItemKey,
            billItemLabel,
            metadata,
            canEdit: false,
            canDelete: allocated <= 0,
          });
        });
    }

    return res.status(200).json({
      success: true,
      data: rows.sort((a, b) => new Date(b.effectiveDate || 0) - new Date(a.effectiveDate || 0)),
    });
  } catch (error) {
    console.error("Failed to fetch tenant take-on balances:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch tenant take-on balances.",
    });
  }
};

const normalizePositiveInteger = (value, fallback, { min = 1, max = 200 } = {}) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const buildInvoiceDateRangeQuery = ({ fromDate = null, toDate = null } = {}) => {
  const range = {};

  if (fromDate) {
    const start = new Date(`${String(fromDate).trim()}T00:00:00`);
    if (!Number.isNaN(start.getTime())) {
      range.$gte = start;
    }
  }

  if (toDate) {
    const end = new Date(`${String(toDate).trim()}T23:59:59.999`);
    if (!Number.isNaN(end.getTime())) {
      range.$lte = end;
    }
  }

  if (!Object.keys(range).length) return {};

  return {
    $or: [
      { bookingDate: range },
      { bookingDate: { $exists: false }, invoiceDate: range },
      { bookingDate: null, invoiceDate: range },
    ],
  };
};

const buildTenantInvoiceListQuery = async ({ businessId, requestQuery = {} }) => {
  const {
    tenant,
    status,
    category,
    propertyId,
    property,
    unitId,
    unit,
    invoiceNumber,
    invoiceNo,
    tenantName,
    fromDate,
    toDate,
  } = requestQuery || {};

  const query = { business: businessId };
  const explicitTenantId = isValidObjectId(tenant) ? String(tenant) : null;

  if (explicitTenantId) {
    query.tenant = explicitTenantId;
  }

  const normalizedStatus = String(status || "").trim();
  if (normalizedStatus) {
    if (normalizedStatus === "ACTIVE") {
      query.status = { $nin: ["cancelled", "reversed"] };
    } else if (normalizedStatus === "Issued") {
      query.status = { $in: ["pending", "partially_paid"] };
    } else {
      query.status = safeLower(normalizedStatus);
    }
  }

  if (category) {
    query.category = String(category).toUpperCase();
  }

  const resolvedPropertyId = isValidObjectId(propertyId) ? String(propertyId) : isValidObjectId(property) ? String(property) : null;
  if (resolvedPropertyId) {
    query.property = resolvedPropertyId;
  }

  const resolvedUnitId = isValidObjectId(unitId) ? String(unitId) : isValidObjectId(unit) ? String(unit) : null;
  if (resolvedUnitId) {
    query.unit = resolvedUnitId;
  }

  const invoiceSearchValue = String(invoiceNumber || invoiceNo || "").trim();
  if (invoiceSearchValue) {
    query.invoiceNumber = { $regex: escapeRegExp(invoiceSearchValue), $options: "i" };
  }

  const tenantSearchValue = String(tenantName || "").trim();
  if (tenantSearchValue) {
    const tenantRegex = new RegExp(escapeRegExp(tenantSearchValue), "i");
    const matchingTenants = await Tenant.find({
      business: businessId,
      $or: [
        { name: tenantRegex },
        { tenantName: tenantRegex },
        { firstName: tenantRegex },
        { lastName: tenantRegex },
      ],
    })
      .select("_id")
      .limit(1000)
      .lean();

    const matchingTenantIds = matchingTenants.map((doc) => String(doc?._id || "")).filter(Boolean);
    if (!matchingTenantIds.length) {
      return { query: null, empty: true };
    }

    if (explicitTenantId && !matchingTenantIds.includes(explicitTenantId)) {
      return { query: null, empty: true };
    }

    query.tenant = explicitTenantId || { $in: matchingTenantIds };
  }

  Object.assign(query, buildInvoiceDateRangeQuery({ fromDate, toDate }));

  return { query, empty: false };
};

const buildTenantInvoiceListPayload = ({
  items = [],
  paginate = false,
  page = 1,
  limit = 50,
  totalItems = 0,
  summary = {},
}) => {
  if (!paginate) {
    return items;
  }

  return {
    data: items,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages: Math.max(1, Math.ceil(Number(totalItems || 0) / Math.max(1, Number(limit || 1)))),
    },
    summary,
  };
};

export const getTenantInvoicesList = async (req, res) => {
  try {
    const { business } = req.query;
    const includeSnapshots = ["1", "true", "yes"].includes(String(req.query?.includeSnapshots || "").trim().toLowerCase());
    const paginate = ["1", "true", "yes"].includes(String(req.query?.paginate || "").trim().toLowerCase()) || Boolean(req.query?.page || req.query?.limit);
    const page = normalizePositiveInteger(req.query?.page, 1, { min: 1, max: 100000 });
    const limit = normalizePositiveInteger(req.query?.limit, 50, { min: 1, max: 200 });
    const skip = (page - 1) * limit;
    const businessId = ensureBusinessAccess(req, resolveAuthorizedBusinessId(req, business));

    const { query, empty } = await buildTenantInvoiceListQuery({
      businessId,
      requestQuery: req.query || {},
    });

    if (empty || !query) {
      return res.status(200).json(
        buildTenantInvoiceListPayload({
          items: [],
          paginate,
          page,
          limit,
          totalItems: 0,
          summary: {
            pageItemCount: 0,
            pageTotalAmount: 0,
            pagePendingAmount: 0,
          },
        })
      );
    }

    const invoiceQuery = TenantInvoice.find(query)
      .sort(paginate ? { bookingDate: -1, invoiceDate: -1, createdAt: -1, _id: -1 } : { invoiceDate: 1, createdAt: 1 })
      .populate("tenant", "name tenantName firstName lastName")
      .populate("unit", "unitNumber name unitName")
      .populate("property", "propertyName name")
      .populate("chartAccount", "code name type")
      .lean();

    if (paginate) {
      invoiceQuery.skip(skip).limit(limit);
    }

    const [invoices, totalItems] = await Promise.all([
      invoiceQuery,
      paginate ? TenantInvoice.countDocuments(query) : Promise.resolve(0),
    ]);

    const invoiceIds = invoices.map((invoice) => invoice._id);
    const notes =
      invoiceIds.length > 0
        ? await TenantInvoiceNote.find({
            business: businessId,
            sourceInvoice: { $in: invoiceIds },
            status: { $nin: ["cancelled", "reversed"] },
          })
            .select("sourceInvoice noteType amount")
            .lean()
        : [];

    const adjustedInvoices = attachNoteTotalsToInvoices(invoices, notes);

    let hydratedInvoices = adjustedInvoices;

    if (includeSnapshots && adjustedInvoices.length > 0) {
      const tenantIds = [...new Set(
        adjustedInvoices
          .map((invoice) => normalizeEntityId(invoice?.tenant))
          .filter(Boolean)
      )];

      const snapshotMap = await computeTenantInvoiceSnapshotsBatch({
        businessId,
        tenantIds,
      });

      const snapshotByInvoiceId = new Map();
      const receiptApplicationsByInvoiceId = new Map();

      snapshotMap.forEach(({ invoiceSnapshots = [], receiptAllocations = [] }) => {
        invoiceSnapshots.forEach((snapshot) => {
          snapshotByInvoiceId.set(String(snapshot._id), snapshot);
        });

        receiptAllocations.forEach((receiptAllocation) => {
          const receiptId = String(receiptAllocation?.receiptId || "");
          const receiptNumber =
            receiptAllocation?.receiptNumber ||
            receiptAllocation?.referenceNumber ||
            "";
          const receiptDate = receiptAllocation?.paymentDate || null;
          const paymentType = receiptAllocation?.paymentType || "rent";
          const rows = Array.isArray(receiptAllocation?.rows) ? receiptAllocation.rows : [];

          rows.forEach((row) => {
            const invoiceId = String(row?.invoice || row?.invoiceId || "");
            const appliedAmount = round2(Number(row?.appliedAmount || 0));
            if (!invoiceId || appliedAmount <= 0) return;

            const current = receiptApplicationsByInvoiceId.get(invoiceId) || [];
            current.push({
              receiptId,
              receiptNumber,
              receiptDate,
              paymentType,
              appliedAmount,
              afterOutstanding: round2(Number(row?.afterOutstanding || 0)),
              chargeLabel:
                row?.description ||
                row?.utilityType ||
                row?.invoiceNumber ||
                "",
            });
            receiptApplicationsByInvoiceId.set(invoiceId, current);
          });
        });
      });

      hydratedInvoices = adjustedInvoices.map((invoice) => {
        const snapshot = snapshotByInvoiceId.get(String(invoice._id));
        if (!snapshot) return invoice;

        const receiptApplications = (receiptApplicationsByInvoiceId.get(String(invoice._id)) || [])
          .slice()
          .sort((a, b) => {
            const aTime = a?.receiptDate ? new Date(a.receiptDate).getTime() : 0;
            const bTime = b?.receiptDate ? new Date(b.receiptDate).getTime() : 0;
            return aTime - bTime;
          });

        return {
          ...invoice,
          appliedAmount: round2(Number(snapshot.applied || 0)),
          outstanding: round2(Number(snapshot.outstanding || 0)),
          remainingCreditableAmount: round2(Number(snapshot.remainingCreditableAmount || 0)),
          computedStatus: snapshot.computedStatus || invoice.status,
          receiptApplications,
        };
      });
    }

    const summary = {
      pageItemCount: hydratedInvoices.length,
      pageTotalAmount: round2(
        hydratedInvoices.reduce((sum, invoice) => sum + Number(invoice?.adjustedAmount ?? invoice?.amount ?? 0), 0)
      ),
      pagePendingAmount: round2(
        hydratedInvoices.reduce((sum, invoice) => {
          const normalizedStatus = String(invoice?.computedStatus || invoice?.status || "").toLowerCase();
          if (!["pending", "partially_paid"].includes(normalizedStatus)) return sum;
          return sum + Number(invoice?.outstanding ?? invoice?.adjustedAmount ?? invoice?.amount ?? 0);
        }, 0)
      ),
    };

    return res.status(200).json(
      buildTenantInvoiceListPayload({
        items: hydratedInvoices,
        paginate,
        page,
        limit,
        totalItems: paginate ? totalItems : hydratedInvoices.length,
        summary,
      })
    );
  } catch (err) {
    console.error("Failed to fetch tenant invoices:", err);
    return res.status(err?.statusCode || 500).json({ error: err?.message || "Failed to fetch tenant invoices" });
  }
};

export const createTenantInvoiceNote = async (req, res) => {
  try {
    const noteType = String(req.body.noteType || "").toUpperCase();
    if (!TENANT_NOTE_TYPES.includes(noteType)) {
      return res.status(400).json({ error: "Invalid note type." });
    }

    const scopedBusinessId = resolveAuthorizedBusinessId(req);
    const requestedMetadata =
      req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    let sourceInvoiceId =
      req.body.sourceInvoiceId || req.body.sourceInvoice || req.body.anchorSourceInvoiceId || null;

    const requestedNoteSourceMode = String(
      req.body.noteSourceMode || requestedMetadata?.noteSourceMode || ""
    ).trim().toLowerCase();
    const shouldAutoAnchorDebitNote =
      noteType === "DEBIT_NOTE" &&
      !isValidObjectId(sourceInvoiceId) &&
      (req.body.allowAutoAnchor === true || requestedNoteSourceMode === "invoice");

    if (shouldAutoAnchorDebitNote) {
      const requestedTenantId = req.body.tenantId || req.body.tenant || null;
      const requestedPropertyId = req.body.propertyId || req.body.property || null;
      const requestedCategory = String(req.body.category || "").toUpperCase();
      const requestedBillItemKey = String(requestedMetadata?.billItemKey || "").trim();
      const requestedUtilityType = String(
        requestedMetadata?.utilityType ||
          requestedMetadata?.meterUtilityType ||
          requestedMetadata?.statementUtilityType ||
          ""
      )
        .trim()
        .toLowerCase();

      if (isValidObjectId(requestedTenantId) && TENANT_INVOICE_CATEGORIES.includes(requestedCategory)) {
        const anchorQuery = {
          tenant: requestedTenantId,
          category: requestedCategory,
          postingStatus: "posted",
          status: { $nin: ["cancelled", "reversed"] },
          ...(scopedBusinessId ? { business: scopedBusinessId } : {}),
          ...(isValidObjectId(requestedPropertyId) ? { property: requestedPropertyId } : {}),
        };

        const anchorCandidates = await TenantInvoice.find(anchorQuery)
          .sort({ invoiceDate: -1, createdAt: -1, _id: -1 })
          .limit(100)
          .lean();

        const matchedAnchor = anchorCandidates.find((invoice) => {
          const metadata = invoice?.metadata || {};
          const invoiceBillItemKey = String(metadata?.billItemKey || "").trim();
          const invoiceUtilityType = String(
            metadata?.utilityType || metadata?.meterUtilityType || metadata?.statementUtilityType || ""
          )
            .trim()
            .toLowerCase();

          if (requestedBillItemKey) {
            return invoiceBillItemKey === requestedBillItemKey;
          }

          if (requestedUtilityType) {
            return invoiceUtilityType === requestedUtilityType;
          }

          return true;
        });

        sourceInvoiceId = matchedAnchor?._id || null;
      }
    }

    const isInvoiceLinked = isValidObjectId(sourceInvoiceId);
    if (!isInvoiceLinked && noteType === "CREDIT_NOTE") {
      return res.status(400).json({ error: "A valid source invoice is required for a credit note." });
    }

    let sourceInvoice = null;
    if (isInvoiceLinked) {
      sourceInvoice = await TenantInvoice.findOne({
        _id: sourceInvoiceId,
        ...(scopedBusinessId ? { business: scopedBusinessId } : {}),
      }).lean();

      if (!sourceInvoice) {
        return res.status(404).json({ error: "Source invoice not found." });
      }

      if (String(sourceInvoice.postingStatus || "") !== "posted") {
        return res.status(400).json({ error: "Notes can only be created against posted invoices." });
      }

      if (["cancelled", "reversed"].includes(String(sourceInvoice.status || "").toLowerCase())) {
        return res.status(400).json({ error: "Source invoice is not active." });
      }
    }

    const requestedTenantId = req.body.tenantId || req.body.tenant || sourceInvoice?.tenant || null;
    const requestedPropertyId = req.body.propertyId || req.body.property || sourceInvoice?.property || null;

    if (!isValidObjectId(requestedTenantId)) {
      return res.status(400).json({ error: "A valid tenant is required." });
    }

    if (!isValidObjectId(requestedPropertyId)) {
      return res.status(400).json({ error: "A valid property is required." });
    }

    const tenant = await Tenant.findOne({
      _id: requestedTenantId,
      ...(scopedBusinessId ? { business: scopedBusinessId } : {}),
    }).lean();

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found." });
    }

    const property = await Property.findOne({
      _id: requestedPropertyId,
      ...(scopedBusinessId ? { business: scopedBusinessId } : {}),
    }).lean();

    if (!property) {
      return res.status(404).json({ error: "Property not found." });
    }

    const resolvedBusinessId = sourceInvoice?.business || tenant.business || property.business || scopedBusinessId;
    const resolvedUnitId = sourceInvoice?.unit || tenant.unit || req.body.unitId || req.body.unit || null;

    if (!isValidObjectId(resolvedUnitId)) {
      return res.status(400).json({ error: "A valid unit could not be resolved for this tenant." });
    }

    const unit = await Unit.findOne({
      _id: resolvedUnitId,
      ...(resolvedBusinessId ? { business: resolvedBusinessId } : {}),
    }).lean();

    if (!unit) {
      return res.status(404).json({ error: "Tenant unit not found." });
    }

    const resolvedLandlordId = resolvePrimaryLandlordId({ sourceInvoice, property, tenant });
    if (!isValidObjectId(resolvedLandlordId)) {
      return res.status(400).json({
        error:
          "This property has no valid landlord linked. Open the property, add/select a landlord, mark one as primary, then save the debit note again.",
      });
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: resolvedBusinessId,
        bodyCreatedBy: req.body.createdBy || sourceInvoice?.createdBy || tenant.createdBy,
      });
    } catch (actorError) {
      return res.status(400).json({ error: actorError.message });
    }

    const noteDate = normalizeDate(req.body.noteDate || req.body.invoiceDate || new Date());
    const amount = Math.abs(Number(req.body.amount || 0));
    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be positive." });
    }

    const requestedCategory = String(req.body.category || sourceInvoice?.category || "").toUpperCase();
    if (!TENANT_INVOICE_CATEGORIES.includes(requestedCategory)) {
      return res.status(400).json({ error: "Invalid charge type/category." });
    }

    let sourceSnapshot = null;
    if (sourceInvoice) {
      const { invoiceSnapshots } = await computeTenantInvoiceSnapshots({
        businessId: sourceInvoice.business,
        tenantId: sourceInvoice.tenant,
      });
      sourceSnapshot = invoiceSnapshots.find(
        (snapshot) => String(snapshot._id) === String(sourceInvoice._id)
      );

      if (!sourceSnapshot) {
        return res.status(400).json({ error: "Source invoice snapshot could not be resolved." });
      }
    }

    if (noteType === "CREDIT_NOTE") {
      const isOpen = ["pending", "partially_paid"].includes(
        String(sourceSnapshot?.computedStatus || sourceInvoice?.status || "").toLowerCase()
      );
      if (!isOpen) {
        return res.status(400).json({ error: "Credit notes can only be created against open invoices." });
      }

      const remainingCreditableAmount = round2(
        Number(sourceSnapshot?.remainingCreditableAmount || 0)
      );
      if (remainingCreditableAmount <= 0) {
        return res.status(400).json({ error: "This invoice has no remaining creditable amount." });
      }

      if (amount > remainingCreditableAmount) {
        return res.status(400).json({
          error: `Credit amount cannot exceed remaining creditable amount of ${remainingCreditableAmount}.`,
        });
      }
    }

    let postingAccount;
    try {
      postingAccount = await resolveInvoiceIncomeAccount({
        businessId: resolvedBusinessId,
        category: requestedCategory,
        chartAccountValue:
          req.body.chartAccountId ||
          req.body.chartAccount ||
          req.body.chartAccountCode ||
          req.body.accountCode ||
          req.body.account ||
          sourceInvoice?.chartAccount,
      });
    } catch (accountError) {
      accountError.statusCode = accountError.statusCode || 400;
      throw accountError;
    }

    const noteNumber = await resolveNoteNumber(resolvedBusinessId, noteType, req.body.noteNumber);
    const duplicate = await TenantInvoiceNote.findOne({
      business: resolvedBusinessId,
      noteNumber: { $regex: `^${escapeRegExp(noteNumber)}$`, $options: "i" },
    }).lean();

    if (duplicate) {
      return res.status(409).json({ error: "Note number already exists for this business." });
    }

    const noteMetadata = sourceInvoice
      ? buildInheritedInvoiceNoteMetadata({
          sourceInvoice,
          incomingMetadata: {
            ...requestedMetadata,
            noteSourceMode: "invoice",
          },
        })
      : {
          ...requestedMetadata,
          noteSourceMode: "standalone",
          standaloneDebitNote: noteType === "DEBIT_NOTE",
          includeInLandlordStatement: true,
          includeInCategoryTotals: true,
        };

    const note = await TenantInvoiceNote.create({
      business: resolvedBusinessId,
      property: requestedPropertyId,
      landlord: resolvedLandlordId,
      tenant: requestedTenantId,
      unit: resolvedUnitId,
      sourceInvoice: sourceInvoice?._id || null,
      noteNumber,
      noteType,
      category: requestedCategory,
      amount,
      description:
        req.body.description ||
        (sourceInvoice
          ? `${noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note against ${sourceInvoice.invoiceNumber}`
          : `${noteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note - standalone charge`),
      noteDate,
      status: "posted",
      createdBy: actorUserId,
      chartAccount: postingAccount._id,
      ledgerEntries: [],
      postingStatus: "unposted",
      postingError: null,
      metadata: noteMetadata,
    });

    const posting = await postInvoiceNoteJournal({
      note,
      createdBy: actorUserId,
      sourceInvoice,
      postingAccount,
    });

    note.journalGroupId = posting.journalGroupId;
    note.ledgerEntries = posting.entries.map((entry) => entry._id);
    note.postingStatus = "posted";
    note.postingError = null;
    await note.save();

    await aggregateChartOfAccountBalances(
      note.business,
      posting.entries.map((entry) => entry.accountId)
    );

    await recomputeTenantFinancialState({
      businessId: note.business,
      tenantId: note.tenant,
    });

    const populated = await TenantInvoiceNote.findById(note._id)
      .populate("chartAccount", "code name type")
      .populate("ledgerEntries")
      .populate("createdBy", "surname otherNames email profile")
      .populate("sourceInvoice", "invoiceNumber amount category invoiceDate dueDate status")
      .lean();

    return res.status(201).json(buildNoteStatementRow(populated));
  } catch (error) {
    console.error("Tenant invoice note creation error:", error);
    if (error?.code === 11000) {
      return res.status(409).json({
        error: "Note number already exists for this business. Please retry so a new number can be reserved safely.",
      });
    }
    return res.status(error.statusCode || 500).json({
      error: error.message || `Failed to create invoice note. ${error.message}`,
    });
  }
};

export const reverseTenantInvoiceNote = async (req, res) => {
  try {
    const noteId = req.params?.id;
    if (!isValidObjectId(noteId)) {
      return res.status(400).json({ error: "A valid tenant invoice note id is required." });
    }

    const scopedBusinessId = resolveAuthorizedBusinessId(req);
    const note = await TenantInvoiceNote.findOne({
      _id: noteId,
      ...(scopedBusinessId ? { business: scopedBusinessId } : {}),
    });

    if (!note) {
      return res.status(404).json({ error: "Invoice note not found." });
    }

    const normalizedNoteType = String(note.noteType || "").toUpperCase();

    if (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(normalizedNoteType)) {
      return res.status(400).json({ error: "Only debit and credit notes can be reversed from this workspace." });
    }

    if (["cancelled", "reversed"].includes(String(note.status || "").toLowerCase())) {
      return res.status(400).json({ error: "This debit note is already inactive." });
    }

    const sourceInvoiceId = String(note.sourceInvoice || "");
    let sourceInvoice = null;

    if (isValidObjectId(sourceInvoiceId)) {
      sourceInvoice = await TenantInvoice.findOne({
        _id: sourceInvoiceId,
        business: note.business,
      }).lean();

      if (!sourceInvoice) {
        return res.status(404).json({ error: "Source invoice not found for this debit note." });
      }
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: note.business,
        bodyCreatedBy: req.body?.createdBy || note.createdBy,
      });
    } catch (actorError) {
      return res.status(400).json({ error: actorError.message });
    }

    if (sourceInvoice) {
      const { invoiceSnapshots } = await computeTenantInvoiceSnapshots({
        businessId: note.business,
        tenantId: note.tenant,
      });

      const sourceSnapshot = invoiceSnapshots.find(
        (snapshot) => String(snapshot?._id || "") === String(sourceInvoiceId)
      );

      const outstanding = Math.max(0, Number(sourceSnapshot?.outstanding || 0));
      const noteAmount = Math.abs(Number(note.amount || 0));

      if (normalizedNoteType === "DEBIT_NOTE" && outstanding + 0.009 < noteAmount) {
        return res.status(400).json({
          error: "This debit note cannot be reversed because it has already been settled fully or partially.",
        });
      }
    }

    const ledgerEntryIds = Array.isArray(note.ledgerEntries) ? note.ledgerEntries.map((entry) => String(entry)) : [];
    const originalEntries = ledgerEntryIds.length
      ? await FinancialLedgerEntry.find({ _id: { $in: ledgerEntryIds } }).select("_id accountId status reversedByEntry")
      : [];

    for (const entry of originalEntries) {
      if (entry?.status === "reversed" || entry?.reversedByEntry) {
        continue;
      }
      await postReversal({
        entryId: entry._id,
        userId: actorUserId,
        reason: req.body?.reason || `Reversal of ${normalizedNoteType === "CREDIT_NOTE" ? "credit" : "debit"} note ${note.noteNumber}`,
      });
    }

    note.status = "reversed";
    note.postingStatus = "reversed";
    note.postingError = null;
    note.metadata = {
      ...(note.metadata || {}),
      reversalReason: req.body?.reason || `${normalizedNoteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note reversed from notes workspace`,
      reversedAt: new Date(),
      reversedBy: actorUserId,
    };
    await note.save();

    const touchedAccountIds = Array.from(
      new Set(
        originalEntries
          .map((entry) => String(entry?.accountId || ""))
          .filter(Boolean)
      )
    );

    if (touchedAccountIds.length) {
      await aggregateChartOfAccountBalances(note.business, touchedAccountIds);
    }

    await recomputeTenantFinancialState({
      businessId: note.business,
      tenantId: note.tenant,
    });

    const populated = await TenantInvoiceNote.findById(note._id)
      .populate("chartAccount", "code name type")
      .populate("ledgerEntries")
      .populate("createdBy", "surname otherNames email profile")
      .populate("sourceInvoice", "invoiceNumber amount category invoiceDate dueDate status")
      .populate("tenant", "name tenantCode")
      .populate("property", "propertyName propertyCode")
      .populate("unit", "unitNumber");

    return res.status(200).json({
      message: `${normalizedNoteType === "CREDIT_NOTE" ? "Credit" : "Debit"} note reversed successfully.`,
      note: buildNoteStatementRow(populated),
    });
  } catch (error) {
    console.error("Tenant invoice note reversal error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to reverse invoice note.",
    });
  }
};

export const createTenantInvoiceRecord = async ({ req, payload, options = {} }) => {
  const {
    skipEnsureSystemAccounts = false,
    deferPostProcessing = false,
    actorUserId: preResolvedActorUserId = null,
    batchContext = null,
  } = options || {};
  const {
    business,
    property,
    landlord,
    tenant,
    unit,
    invoiceNumber,
    category,
    amount,
    description,
    invoiceDate,
    bookingDate,
    dueDate,
    createdBy,
    chartAccountId,
    metadata,
    idempotencyKey,
  } = payload || {};

  if (!business || !property || !tenant || !unit || !category || !invoiceDate || !dueDate) {
    const error = new Error("Missing required invoice fields.");
    error.statusCode = 400;
    throw error;
  }

  const businessId = ensureBusinessAccess(req, resolveAuthorizedBusinessId(req, business));

  if (!TENANT_INVOICE_CATEGORIES.includes(String(category || "").toUpperCase())) {
    const error = new Error("Invalid invoice category.");
    error.statusCode = 400;
    throw error;
  }

  if (Number(amount) <= 0) {
    const error = new Error("Amount must be positive.");
    error.statusCode = 400;
    throw error;
  }

  const requestedInvoiceDate = normalizeDate(invoiceDate);
  const requestedBookingDate = resolveRequestedBookingDate(bookingDate, requestedInvoiceDate);
  const recurringDates = resolveRecurringBillingDates({
    category,
    invoiceDate: requestedInvoiceDate,
    dueDate,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
  });
  const normalizedInvoiceDate = recurringDates.invoiceDate;
  const normalizedBookingDate = requestedBookingDate || normalizedInvoiceDate;
  let normalizedDueDate = recurringDates.dueDate;

  if (normalizedDueDate < normalizedInvoiceDate) {
    normalizedDueDate = normalizedInvoiceDate;
  }

  if (isFutureInvoiceDate(normalizedInvoiceDate) || isFutureInvoiceDate(normalizedBookingDate)) {
    const error = new Error("Future invoicing is disabled. Use the current date or an earlier billing period.");
    error.statusCode = 400;
    throw error;
  }

  if (!skipEnsureSystemAccounts) {
    await ensureSystemChartOfAccounts(businessId);
  }

  const normalizedCategory = String(category).toUpperCase();
  const normalizedMetadata = metadata && typeof metadata === "object" ? metadata : {};
  const normalizedIdempotencyKey = String(idempotencyKey || "").trim();

  if (normalizedIdempotencyKey) {
    const existingInvoice = await findExistingInvoiceByIdempotencyKey(businessId, normalizedIdempotencyKey);
    if (existingInvoice) {
      return existingInvoice;
    }
  }

  if (normalizedCategory === "RENT_CHARGE" && isLegacyCombinedInvoiceMetadata(normalizedMetadata)) {
    const error = new Error(
      "Combined rent + utility storage is disabled. Create separate rent and utility invoices under the same booking group instead."
    );
    error.statusCode = 400;
    throw error;
  }

  const normalizedInvoiceNumber = await resolveInvoiceNumber(businessId, invoiceNumber, normalizedCategory);

  const hasManualInvoiceNumber = Boolean(String(invoiceNumber || "").trim());
  if (hasManualInvoiceNumber) {
    const duplicate = await TenantInvoice.findOne({
      business: businessId,
      invoiceNumber: {
        $regex: `^${escapeRegExp(normalizedInvoiceNumber)}$`,
        $options: "i",
      },
    }).lean();

    if (duplicate) {
      const error = new Error(
        "Invoice number already exists for this business. Please use a unique number."
      );
      error.statusCode = 409;
      throw error;
    }
  }

  let actorUserId;
  try {
    actorUserId =
      preResolvedActorUserId ||
      (await resolveActorUserId({
        req,
        business: businessId,
        bodyCreatedBy: createdBy,
      }));
  } catch (actorError) {
    actorError.statusCode = actorError.statusCode || 400;
    throw actorError;
  }

  let accountingContext;
  try {
    const accountingContextCacheKey = [String(businessId), String(property), String(landlord || "")].join(":");
    accountingContext = await getOrLoadCachedValue(
      batchContext?.accountingContextCache,
      accountingContextCacheKey,
      () =>
        resolvePropertyAccountingContext({
          propertyId: property,
          landlordId: landlord || null,
          businessId: businessId,
        })
    );
  } catch (contextError) {
    contextError.statusCode = contextError.statusCode || 400;
    throw contextError;
  }

  const [propertyDoc, unitDoc, tenantDoc, companyDoc] = await Promise.all([
    getOrLoadCachedValue(
      batchContext?.propertyDocCache,
      [String(businessId), String(property)].join(":"),
      () =>
        Property.findOne({ _id: property, business: businessId })
          .select("_id business landlords depositHeldBy")
          .lean()
    ),
    getOrLoadCachedValue(
      batchContext?.unitDocCache,
      [String(businessId), String(unit)].join(":"),
      () =>
        Unit.findOne({ _id: unit, business: businessId })
          .select("_id business property")
          .lean()
    ),
    getOrLoadCachedValue(
      batchContext?.tenantDocCache,
      [String(businessId), String(tenant)].join(":"),
      () =>
        Tenant.findOne({ _id: tenant, business: businessId })
          .select("_id business unit additionalUnits depositHeldBy")
          .lean()
    ),
    getOrLoadCachedValue(
      batchContext?.companyDocCache,
      ["company", String(businessId)].join(":"),
      () => Company.findById(businessId).select("_id companyMode").lean()
    ),
  ]);

  if (!propertyDoc) {
    const error = new Error("Property not found in this business.");
    error.statusCode = 404;
    throw error;
  }

  if (!unitDoc) {
    const error = new Error("Unit not found in this business.");
    error.statusCode = 404;
    throw error;
  }

  if (!tenantDoc) {
    const error = new Error("Tenant not found.");
    error.statusCode = 404;
    throw error;
  }

  if (String(unitDoc.property || "") !== String(propertyDoc._id)) {
    const error = new Error("Selected unit does not belong to the supplied property.");
    error.statusCode = 400;
    throw error;
  }

  const tenantAssignedUnitIds = [String(tenantDoc.unit || ""), ...(Array.isArray(tenantDoc.additionalUnits) ? tenantDoc.additionalUnits.map((item) => String(item)) : [])].filter(Boolean);
  if (!tenantAssignedUnitIds.includes(String(unitDoc._id))) {
    const error = new Error("Selected tenant does not belong to the supplied unit.");
    error.statusCode = 400;
    throw error;
  }

  const depositHeldBy =
    normalizedCategory === "DEPOSIT_CHARGE"
      ? resolveDepositHolderLabel({
          requestedValue: payload?.depositHeldBy || req?.body?.depositHeldBy,
          tenantValue: tenantDoc.depositHeldBy,
          propertyValue: propertyDoc?.depositHeldBy,
          companyMode: companyDoc?.companyMode,
        })
      : null;

  let ledgerMode = resolveInvoiceLedgerMode({
    category: normalizedCategory,
    depositHeldBy,
  });

  // Off-GL properties never post to the main GL — PM module tracks internally only
  if (accountingContext.isOffGL) ledgerMode = "off_ledger";

  const requestedChartAccountValue =
    chartAccountId ||
    payload?.chartAccount ||
    payload?.chartAccountCode ||
    payload?.accountCode ||
    payload?.account ||
    req?.body?.chartAccount ||
    req?.body?.chartAccountCode ||
    req?.body?.accountCode ||
    req?.body?.account;

  const statementPeriod = buildStatementPeriod(normalizedInvoiceDate);
  const schedulePeriodKey = normalizeSchedulePeriodKey(normalizedMetadata?.periodKey);
  const recurringInvoiceCacheKey = buildRecurringInvoiceCacheKey({
    businessId,
    propertyId: accountingContext.propertyId,
    tenantId: tenant,
    unitId: unit,
    statementPeriod,
    periodKey: schedulePeriodKey,
  });
  const activeMonthlyInvoices = ["RENT_CHARGE", "UTILITY_CHARGE"].includes(normalizedCategory)
    ? await getOrLoadCachedValue(
        batchContext?.monthlyInvoiceCache,
        recurringInvoiceCacheKey,
        () =>
          TenantInvoice.find(
            buildRecurringInvoiceConflictFilter({
              businessId,
              propertyId: accountingContext.propertyId,
              tenantId: tenant,
              unitId: unit,
              statementPeriod,
              periodKey: schedulePeriodKey,
            })
          )
            .select("_id invoiceNumber category status invoiceDate metadata")
            .lean()
      )
    : [];

  const conflictingMonthlyInvoice = findConflictingMonthlyInvoice({
    existingInvoices: activeMonthlyInvoices,
    category: normalizedCategory,
    metadata: normalizedMetadata,
  });

  if (conflictingMonthlyInvoice) {
    const error = new Error(
      `A ${normalizedCategory === "UTILITY_CHARGE" ? "utility" : "rent"} invoice already exists for this tenant in the selected billing period${conflictingMonthlyInvoice?.invoiceNumber ? ` (${conflictingMonthlyInvoice.invoiceNumber})` : ""}.`
    );
    error.statusCode = 409;
    throw error;
  }

  let postingAccount;
  try {
    const postingAccountCacheKey = [
      String(businessId),
      String(normalizedCategory),
      String(requestedChartAccountValue || "auto").trim().toLowerCase(),
    ].join(":");

    if (!batchContext && normalizedCategory !== "DEPOSIT_CHARGE") {
      const cached = singleInvoiceAccountCache.get(postingAccountCacheKey);
      if (cached?.account?._id && Date.now() - cached.cachedAt < SINGLE_INVOICE_ACCOUNT_CACHE_TTL_MS) {
        postingAccount = cached.account;
      } else {
        singleInvoiceAccountCache.delete(postingAccountCacheKey);
        postingAccount = await resolveInvoiceIncomeAccount({
          businessId,
          category: normalizedCategory,
          chartAccountValue: requestedChartAccountValue,
        });
        singleInvoiceAccountCache.set(postingAccountCacheKey, { account: postingAccount, cachedAt: Date.now() });
      }
    } else {
      postingAccount = await getOrLoadCachedValue(
        batchContext?.postingAccountCache,
        postingAccountCacheKey,
        () =>
          resolveInvoiceIncomeAccount({
            businessId: businessId,
            category: normalizedCategory,
            chartAccountValue: requestedChartAccountValue,
          })
      );
    }
  } catch (accountError) {
    accountError.statusCode = accountError.statusCode || 400;
    throw accountError;
  }

  const companyTaxConfig = await getOrLoadCachedValue(
    batchContext?.companyTaxConfigCache,
    String(businessId),
    () => getCompanyTaxConfiguration(businessId)
  );

  let cachedReceivableAccount = await getOrLoadCachedValue(
    batchContext?.receivableAccountCache,
    String(businessId),
    () => resolveTenantReceivableAccount(businessId)
  );

  // Override with property-specific GL accounts for In-GL properties
  if (!accountingContext.isOffGL) {
    if (accountingContext.receivablesAccountId) {
      cachedReceivableAccount = { _id: accountingContext.receivablesAccountId };
    }
    if (normalizedCategory !== "DEPOSIT_CHARGE") {
      const propIncomeId = {
        RENT_CHARGE:         accountingContext.rentIncomeAccountId,
        UTILITY_CHARGE:      accountingContext.utilityRechargeAccountId,
        SERVICE_CHARGE:      accountingContext.serviceChargeAccountId,
        LEASE_FEE:           accountingContext.serviceChargeAccountId,
        LATE_PENALTY_CHARGE: accountingContext.penaltyIncomeAccountId,
      }[normalizedCategory];
      if (propIncomeId) postingAccount = { _id: propIncomeId };
    }
  }

  const taxSnapshot = buildInvoiceTaxSnapshot({
    amount: Math.abs(Number(amount)),
    category: normalizedCategory,
    companyTaxConfig,
    requestedTaxCodeKey: payload?.taxCodeKey || req?.body?.taxCodeKey || null,
    requestedTaxMode: payload?.taxMode || req?.body?.taxMode || null,
    overrides: {
      isTaxable:
        typeof payload?.isTaxable === "boolean"
          ? payload.isTaxable
          : typeof req?.body?.isTaxable === "boolean"
          ? req.body.isTaxable
          : undefined,
      rateOverride:
        payload?.taxRate !== undefined
          ? payload.taxRate
          : req?.body?.taxRate !== undefined
          ? req.body.taxRate
          : null,
    },
  });

  let invoice;
  try {
    invoice = await TenantInvoice.create({
      business: businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      tenant,
      unit,
      invoiceNumber: normalizedInvoiceNumber,
      category: normalizedCategory,
      amount: taxSnapshot.grossAmount,
      description: description || "",
      invoiceDate: normalizedInvoiceDate,
      bookingDate: normalizedBookingDate,
      dueDate: normalizedDueDate,
      status: "pending",
      createdBy: actorUserId,
      chartAccount: postingAccount._id,
      depositHeldBy,
      ledgerMode,
      postingStatus: "unposted",
      postingError: null,
      ledgerEntries: [],
      metadata: normalizedMetadata,
      idempotencyKey: normalizedIdempotencyKey || null,
      taxSnapshot,
    });
  } catch (createError) {
    if (isIdempotencyKeyDuplicateError(createError) && normalizedIdempotencyKey) {
      const existingInvoice = await findExistingInvoiceByIdempotencyKey(businessId, normalizedIdempotencyKey);
      if (existingInvoice) {
        return existingInvoice;
      }
    }

    if (isDuplicateKeyError(createError)) {
      const duplicateMessage =
        normalizedCategory === "LATE_PENALTY_CHARGE" &&
        normalizedMetadata?.penaltyRuleId &&
        normalizedMetadata?.penaltySourceInvoiceId &&
        normalizedMetadata?.penaltyPeriodKey
          ? "A late penalty invoice already exists for this source invoice in the selected billing period."
          : "Invoice number already exists for this business. Please retry or use a unique number.";

      const error = new Error(duplicateMessage);
      error.statusCode = 409;
      throw error;
    }

    throw createError;
  }

  if (["RENT_CHARGE", "UTILITY_CHARGE"].includes(normalizedCategory) && batchContext?.monthlyInvoiceCache) {
    const nextCachedInvoices = [
      ...activeMonthlyInvoices,
      {
        _id: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        category: invoice.category,
        status: invoice.status,
        invoiceDate: invoice.invoiceDate,
        metadata: invoice.metadata || {},
      },
    ];
    batchContext.monthlyInvoiceCache.set(recurringInvoiceCacheKey, Promise.resolve(nextCachedInvoices));
  }

  try {
    if (ledgerMode === "off_ledger") {
      invoice.postingStatus = "not_applicable";
      invoice.postingError = null;
      await invoice.save();

      if (deferPostProcessing) {
        return {
          invoice,
          touchedAccountIds: [],
          tenantId: String(invoice.tenant),
          businessId: String(invoice.business),
        };
      }

      await applyIncrementalBalanceDelta({ tenantId: invoice.tenant, businessId: invoice.business, delta: 0 });
      await recomputeTenantFinancialState({
        businessId: invoice.business,
        tenantId: invoice.tenant,
      });

      const populated = await TenantInvoice.findById(invoice._id)
        .populate("chartAccount", "code name type")
        .populate("ledgerEntries")
        .populate("createdBy", "surname otherNames email profile");

      return populated;
    }

    const posting = await postInvoiceJournal({
      invoice,
      createdBy: actorUserId,
      incomeAccount: postingAccount,
      receivableAccount: cachedReceivableAccount || null,
    });

    invoice.journalGroupId = posting.journalGroupId;
    invoice.ledgerEntries = posting.entries.map((entry) => entry._id);
    invoice.postingStatus = "posted";
    invoice.postingError = null;
    invoice.status = "pending";
    await invoice.save();

    const touchedAccountIds = posting.entries.map((entry) => String(entry.accountId)).filter(Boolean);

    if (deferPostProcessing) {
      return {
        invoice,
        touchedAccountIds,
        tenantId: String(invoice.tenant),
        businessId: String(invoice.business),
      };
    }

    await aggregateChartOfAccountBalances(
      invoice.business,
      touchedAccountIds
    );

    await applyIncrementalBalanceDelta({ tenantId: invoice.tenant, businessId: invoice.business, delta: Math.abs(Number(invoice.amount || 0)) });
    await recomputeTenantFinancialState({
      businessId: invoice.business,
      tenantId: invoice.tenant,
    });

    const populated = await TenantInvoice.findById(invoice._id)
      .populate("chartAccount", "code name type")
      .populate("ledgerEntries")
      .populate("createdBy", "surname otherNames email profile");

    return populated;
  } catch (postingError) {
    invoice.postingStatus = "failed";
    invoice.postingError = postingError.message || "Ledger posting failed";
    await invoice.save();

    const error = new Error(`Invoice created but ledger posting failed: ${postingError.message}`);
    error.statusCode = 500;
    error.invoiceId = invoice._id;
    throw error;
  }
};

export const updateTakeOnBalance = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(id || ""))) {
      return res.status(400).json({ success: false, message: "Invalid take-on balance id." });
    }

    const businessId = ensureBusinessAccess(req, resolveAuthorizedBusinessId(req));
    const invoice = await TenantInvoice.findOne({ _id: id, business: businessId });
    if (!invoice) {
      return res.status(404).json({ success: false, message: "Take-on balance not found." });
    }

    if (!isTakeOnBalanceInvoice(invoice)) {
      return res.status(400).json({ success: false, message: "Only take-on balances can be edited here." });
    }

    const { invoiceSnapshots } = await computeTenantInvoiceSnapshots({
      businessId: invoice.business,
      tenantId: invoice.tenant,
    });
    const snapshot = invoiceSnapshots.find((row) => String(row._id) === String(invoice._id));
    if (!snapshot) {
      return res.status(400).json({ success: false, message: "Take-on balance snapshot could not be resolved." });
    }

    if (Number(snapshot.applied || 0) > 0 || ["paid", "partially_paid"].includes(String(snapshot.computedStatus || invoice.status || "").toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Allocated or paid take-on balances cannot be edited. Reverse allocations first.",
      });
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: invoice.business,
        bodyCreatedBy: req.body.createdBy || invoice.createdBy,
      });
    } catch (actorError) {
      return res.status(400).json({ success: false, message: actorError.message });
    }

    const normalizedCategory = String(req.body.category || invoice.category || "").toUpperCase();
    if (!TENANT_INVOICE_CATEGORIES.includes(normalizedCategory)) {
      return res.status(400).json({ success: false, message: "Invalid take-on balance category." });
    }

    const amount = Math.abs(Number(req.body.amount || invoice.amount || 0));
    if (amount <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be positive." });
    }

    const requestedInvoiceDate = normalizeDate(req.body.invoiceDate || invoice.invoiceDate || new Date());
    const shouldForceMonthlyDates = shouldForceMonthlyBillingDates({
      category: normalizedCategory,
      metadata: req.body.metadata || invoice.metadata || {},
    });
    const normalizedInvoiceDate = shouldForceMonthlyDates
      ? getMonthStart(requestedInvoiceDate)
      : requestedInvoiceDate;
    let normalizedDueDate = shouldForceMonthlyDates
      ? resolveMonthlyBillingDueDate({
          invoiceDate: normalizedInvoiceDate,
          dueDate: req.body.dueDate || invoice.dueDate || null,
        })
      : normalizeDate(req.body.dueDate || invoice.dueDate || normalizedInvoiceDate, normalizedInvoiceDate);

    if (normalizedDueDate < normalizedInvoiceDate) {
      normalizedDueDate = normalizedInvoiceDate;
    }

    const [propertyDoc, unitDoc, tenantDoc, companyDoc] = await Promise.all([
      Property.findOne({ _id: invoice.property, business: businessId }).select("_id business landlords depositHeldBy").lean(),
      Unit.findOne({ _id: invoice.unit, business: businessId }).select("_id business property").lean(),
      Tenant.findOne({ _id: invoice.tenant, business: businessId }).select("_id business unit additionalUnits depositHeldBy").lean(),
      Company.findById(businessId).select("_id companyMode").lean(),
    ]);

    if (!propertyDoc || !unitDoc || !tenantDoc) {
      return res.status(400).json({ success: false, message: "Take-on balance property, unit, or tenant context is invalid." });
    }

    let postingAccount;
    try {
      postingAccount = await resolveInvoiceIncomeAccount({
        businessId,
        category: normalizedCategory,
        chartAccountValue:
          req.body.chartAccountId ||
          req.body.chartAccount ||
          req.body.chartAccountCode ||
          req.body.accountCode ||
          req.body.account ||
          invoice.chartAccount,
      });
    } catch (accountError) {
      return res.status(accountError.statusCode || 400).json({ success: false, message: accountError.message });
    }

    const depositHeldBy =
      normalizedCategory === "DEPOSIT_CHARGE"
        ? resolveDepositHolderLabel({
            requestedValue: req.body.depositHeldBy || invoice.depositHeldBy,
            tenantValue: tenantDoc.depositHeldBy,
            propertyValue: propertyDoc?.depositHeldBy,
            companyMode: companyDoc?.companyMode,
          })
        : null;

    const nextLedgerMode = resolveInvoiceLedgerMode({
      category: normalizedCategory,
      depositHeldBy,
    });

    const companyTaxConfig = await getCompanyTaxConfiguration(businessId);
    const nextTaxSnapshot = buildInvoiceTaxSnapshot({
      amount,
      category: normalizedCategory,
      companyTaxConfig,
      requestedTaxCodeKey:
        req.body.taxCodeKey ||
        invoice.taxSnapshot?.taxCodeKey ||
        null,
      requestedTaxMode:
        req.body.taxMode ||
        invoice.taxSnapshot?.taxMode ||
        null,
      overrides: {
        isTaxable:
          typeof req.body.isTaxable === "boolean"
            ? req.body.isTaxable
            : typeof invoice.taxSnapshot?.isTaxable === "boolean"
            ? invoice.taxSnapshot.isTaxable
            : undefined,
        rateOverride:
          req.body.taxRate !== undefined
            ? req.body.taxRate
            : invoice.taxSnapshot?.taxRate !== undefined
            ? invoice.taxSnapshot.taxRate
            : null,
      },
    });

    const touchedAccountIds = new Set();
    if (invoice.ledgerMode !== "off_ledger") {
      const originalEntries = await FinancialLedgerEntry.find({
        business: invoice.business,
        sourceTransactionType: "invoice",
        sourceTransactionId: String(invoice._id),
        status: "approved",
        category: { $ne: "REVERSAL" },
      });

      for (const entry of originalEntries) {
        if (entry?.accountId) touchedAccountIds.add(String(entry.accountId));
        if (!entry.reversedByEntry && entry.status !== "reversed") {
          const reversal = await postReversal({
            entryId: entry._id,
            reason: `Take-on balance ${invoice.invoiceNumber} updated`,
            userId: actorUserId,
          });
          if (reversal?.reversalEntry?.accountId) {
            touchedAccountIds.add(String(reversal.reversalEntry.accountId));
          }
        }
      }
    }

    const mergedMetadata = {
      ...(invoice.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {}),
      ...(req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
      isTakeOnBalance: true,
      sourceTransactionType: "tenant_take_on_balance",
    };

    invoice.category = normalizedCategory;
    invoice.amount = nextTaxSnapshot.grossAmount;
    invoice.description = req.body.description || invoice.description || "";
    invoice.invoiceDate = normalizedInvoiceDate;
    invoice.dueDate = normalizedDueDate;
    invoice.chartAccount = postingAccount._id;
    invoice.depositHeldBy = depositHeldBy;
    invoice.ledgerMode = nextLedgerMode;
    invoice.metadata = mergedMetadata;
    invoice.taxSnapshot = nextTaxSnapshot;
    invoice.status = "pending";
    invoice.journalGroupId = null;
    invoice.ledgerEntries = [];
    invoice.postingStatus = nextLedgerMode === "off_ledger" ? "not_applicable" : "unposted";
    invoice.postingError = null;
    await invoice.save();

    if (nextLedgerMode !== "off_ledger") {
      try {
        const posting = await postInvoiceJournal({
          invoice,
          createdBy: actorUserId,
          incomeAccount: postingAccount,
        });

        invoice.journalGroupId = posting.journalGroupId;
        invoice.ledgerEntries = posting.entries.map((entry) => entry._id);
        invoice.postingStatus = "posted";
        invoice.postingError = null;
        await invoice.save();

        posting.entries.forEach((entry) => {
          if (entry?.accountId) touchedAccountIds.add(String(entry.accountId));
        });
      } catch (postingError) {
        invoice.postingStatus = "failed";
        invoice.postingError = postingError.message || "Ledger reposting failed";
        await invoice.save();
        throw postingError;
      }
    }

    await recomputeTenantFinancialState({
      businessId: invoice.business,
      tenantId: invoice.tenant,
    });

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(invoice.business, Array.from(touchedAccountIds));
    }

    const populated = await TenantInvoice.findById(invoice._id)
      .populate("tenant", "name tenantName firstName lastName")
      .populate("unit", "unitNumber name unitName")
      .populate("property", "propertyName name")
      .populate("chartAccount", "code name type")
      .populate("createdBy", "surname otherNames email profile");

    return res.status(200).json({ success: true, data: populated, message: "Take-on balance updated successfully." });
  } catch (error) {
    console.error("Update take-on balance error:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update take-on balance.",
    });
  }
};

export const createTenantInvoice = async (req, res) => {
  try {
    const result = await createTenantInvoiceRecord({
      req,
      payload: {
        business: resolveAuthorizedBusinessId(req, req.body.business),
        property: req.body.property,
        landlord: req.body.landlord,
        tenant: req.body.tenant,
        unit: req.body.unit,
        invoiceNumber: req.body.invoiceNumber,
        category: req.body.category,
        amount: req.body.amount,
        description: req.body.description,
        invoiceDate: req.body.invoiceDate,
        bookingDate: req.body.bookingDate,
        dueDate: req.body.dueDate,
        createdBy: req.body.createdBy,
        chartAccountId: req.body.chartAccountId || null,
        metadata: req.body.metadata,
        chartAccount: req.body.chartAccount,
        chartAccountCode: req.body.chartAccountCode,
        accountCode: req.body.accountCode,
        account: req.body.account,
      },
      options: { deferPostProcessing: true },
    });

    let invoice;
    let availableCredits = 0;
    if (result?.tenantId) {
      const { invoice: deferredInvoice, touchedAccountIds, tenantId, businessId } = result;
      if (touchedAccountIds.length > 0) {
        await aggregateChartOfAccountBalances(businessId, touchedAccountIds);
      }
      await recomputeTenantFinancialState({ businessId, tenantId });
      invoice = await TenantInvoice.findById(deferredInvoice._id)
        .populate("chartAccount", "code name type")
        .populate("ledgerEntries")
        .populate("createdBy", "surname otherNames email profile");

      // Check if this tenant has unallocated receipts (credits on account).
      // We include the total in the response so the frontend can prompt the PM
      // to apply available credits to the new invoice immediately.
      const RentPayment = (await import("../../models/RentPayment.js")).default;
      const creditTotals = await RentPayment.aggregate([
        {
          $match: {
            tenant: new mongoose.Types.ObjectId(String(tenantId)),
            business: new mongoose.Types.ObjectId(String(businessId)),
            isConfirmed: true,
            isCancelled: { $ne: true },
            isReversed: { $ne: true },
            "allocationSummary.unapplied": { $gt: 0 },
          },
        },
        { $group: { _id: null, total: { $sum: "$allocationSummary.unapplied" } } },
      ]);
      availableCredits = creditTotals[0]?.total || 0;
    } else {
      invoice = result;
    }

    return res.status(201).json({
      ...(invoice?.toObject ? invoice.toObject() : invoice),
      availableCredits: Math.round(availableCredits * 100) / 100,
    });
  } catch (error) {
    console.error("TenantInvoice creation error:", error);

    if (error?.invoiceId) {
      return res.status(error.statusCode || 500).json({
        error: error.message,
        invoiceId: error.invoiceId,
      });
    }

    return res.status(error.statusCode || 500).json({
      error: error.message || `Failed to create invoice. ${error.message}`,
    });
  }
};

const runTasksInChunks = async (items = [], worker, chunkSize = 10) => {
  for (let index = 0; index < items.length; index += chunkSize) {
    const slice = items.slice(index, index + chunkSize);
    await Promise.all(slice.map((item) => worker(item)));
  }
};

const getOrLoadCachedValue = async (cache, key, loader) => {
  if (!cache || !key) {
    return loader();
  }

  if (!cache.has(key)) {
    const pending = Promise.resolve()
      .then(loader)
      .catch((error) => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, pending);
  }

  return cache.get(key);
};

export const createTenantInvoicesBatch = async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (items.length === 0) {
      return res.status(400).json({ error: "At least one invoice payload is required." });
    }

    if (items.length > 1000) {
      return res.status(400).json({ error: "Batch size too large. Maximum 1000 invoices per batch." });
    }

    const requestedBusinessId = resolveAuthorizedBusinessId(req, req.body.business || items[0]?.business);
    const businessId = ensureBusinessAccess(req, requestedBusinessId);

    const invalidBusinessItem = items.find(
      (item) => normalizeEntityId(item?.business || businessId) !== String(businessId)
    );

    if (invalidBusinessItem) {
      return res.status(400).json({ error: "All batched invoices must belong to the same business." });
    }

    await ensureSystemChartOfAccounts(businessId);

    const actorUserId = await resolveActorUserId({
      req,
      business: businessId,
      bodyCreatedBy: items.find((item) => item?.createdBy)?.createdBy || req.body?.createdBy,
    });

    const batchContext = {
      accountingContextCache: new Map(),
      propertyDocCache: new Map(),
      unitDocCache: new Map(),
      tenantDocCache: new Map(),
      postingAccountCache: new Map(),
      monthlyInvoiceCache: new Map(),
      companyTaxConfigCache: new Map(),
      receivableAccountCache: new Map(),
    };

    // Pre-allocate all invoice numbers in one counter bump instead of N individual bumps
    const numberedItems = await preallocateInvoiceNumbers(businessId, items);

    // Pre-fetch all unique entity docs in 3 bulk queries and warm the caches
    const uniquePropertyIds = [...new Set(numberedItems.map((item) => String(item.property || "")).filter(Boolean))];
    const uniqueUnitIds = [...new Set(numberedItems.map((item) => String(item.unit || "")).filter(Boolean))];
    const uniqueTenantIds = [...new Set(numberedItems.map((item) => String(item.tenant || "")).filter(Boolean))];

    const [propertyDocs, unitDocs, tenantDocs] = await Promise.all([
      Property.find({ _id: { $in: uniquePropertyIds }, business: businessId })
        .select("_id business landlords depositHeldBy")
        .lean(),
      Unit.find({ _id: { $in: uniqueUnitIds }, business: businessId })
        .select("_id business property")
        .lean(),
      Tenant.find({ _id: { $in: uniqueTenantIds }, business: businessId })
        .select("_id business unit additionalUnits depositHeldBy")
        .lean(),
    ]);

    propertyDocs.forEach((doc) => {
      batchContext.propertyDocCache.set([String(businessId), String(doc._id)].join(":"), Promise.resolve(doc));
    });
    unitDocs.forEach((doc) => {
      batchContext.unitDocCache.set([String(businessId), String(doc._id)].join(":"), Promise.resolve(doc));
    });
    tenantDocs.forEach((doc) => {
      batchContext.tenantDocCache.set([String(businessId), String(doc._id)].join(":"), Promise.resolve(doc));
    });

    const touchedTenantIds = new Set();
    const touchedAccountIds = new Set();
    const results = new Array(numberedItems.length);
    const indexedItems = numberedItems.map((item, index) => ({ item, index }));
    const groupsByTenant = new Map();

    indexedItems.forEach(({ item, index }) => {
      const tenantKey = String(item?.tenant || `__missing_tenant__:${index}`);
      if (!groupsByTenant.has(tenantKey)) {
        groupsByTenant.set(tenantKey, []);
      }
      groupsByTenant.get(tenantKey).push({ item, index });
    });

    const groupedItems = Array.from(groupsByTenant.values());

    await runTasksInChunks(
      groupedItems,
      async (group) => {
        for (const { item, index } of group) {
          try {
            const created = await createTenantInvoiceRecord({
              req,
              payload: {
                business: businessId,
                property: item.property,
                landlord: item.landlord,
                tenant: item.tenant,
                unit: item.unit,
                invoiceNumber: item.invoiceNumber,
                category: item.category,
                amount: item.amount,
                description: item.description,
                invoiceDate: item.invoiceDate,
                bookingDate: item.bookingDate,
                dueDate: item.dueDate,
                createdBy: item.createdBy,
                chartAccountId: item.chartAccountId || null,
                metadata: item.metadata,
                chartAccount: item.chartAccount,
                chartAccountCode: item.chartAccountCode,
                accountCode: item.accountCode,
                account: item.account,
              },
              options: {
                skipEnsureSystemAccounts: true,
                deferPostProcessing: true,
                actorUserId,
                batchContext,
              },
            });

            if (created?.tenantId) touchedTenantIds.add(String(created.tenantId));
            for (const accountId of created?.touchedAccountIds || []) {
              if (accountId) touchedAccountIds.add(String(accountId));
            }

            results[index] = {
              success: true,
              invoiceId: created?.invoice?._id || null,
              invoiceNumber: created?.invoice?.invoiceNumber || null,
              tenant: item.tenant,
              category: item.category,
            };
          } catch (error) {
            results[index] = {
              success: false,
              tenant: item?.tenant || null,
              category: item?.category || null,
              error: error?.message || "Failed to create invoice.",
              statusCode: error?.statusCode || 500,
            };
          }
        }
      },
      20
    );

    const finalizedResults = results.filter(Boolean);
    const createdCount = finalizedResults.filter((row) => row.success).length;
    const failedCount = finalizedResults.length - createdCount;

    // Send response immediately — balances are already approximately correct from
    // the incremental deltas applied during creation. Full recomputes run in the
    // background so they never block the HTTP response at scale.
    res.status(createdCount > 0 ? 201 : 200).json({
      success: createdCount > 0,
      business: businessId,
      summary: {
        total: finalizedResults.length,
        created: createdCount,
        failed: failedCount,
      },
      results: finalizedResults,
    });

    const tenantRecomputeIds = Array.from(touchedTenantIds);
    const accountRecomputeIds = Array.from(touchedAccountIds);
    setImmediate(async () => {
      try {
        await Promise.all([
          accountRecomputeIds.length > 0
            ? aggregateChartOfAccountBalances(businessId, accountRecomputeIds)
            : Promise.resolve(),
          tenantRecomputeIds.length > 0
            ? runTasksInChunks(
                tenantRecomputeIds,
                async (tenantId) => {
                  await recomputeTenantFinancialState({ businessId, tenantId });
                },
                12
              )
            : Promise.resolve(),
        ]);
      } catch (err) {
        console.error("Batch invoice background recompute error:", err);
      }
    });
  } catch (error) {
    console.error("Batch tenant invoice creation error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.message || "Failed to create tenant invoices batch.",
    });
  }
};


const syncLatePenaltyBatchItemsForInvoiceDeletion = async ({
  invoice,
  actorUserId = null,
  itemStatus = "deleted",
  reason = "",
}) => {
  if (!invoice?._id || String(invoice?.category || "").toUpperCase() !== "LATE_PENALTY_CHARGE") {
    return;
  }

  const normalizedStatus = String(itemStatus || "").toLowerCase();
  const now = new Date();
  const arrayFilters = [{ "elem.penaltyInvoice": invoice._id }];

  const setFields = {
    "items.$[elem].invoiced": false,
    "items.$[elem].reason": reason || (normalizedStatus === "reversed" ? "Late penalty invoice reversed." : "Late penalty invoice deleted."),
  };

  if (normalizedStatus === "reversed") {
    setFields["items.$[elem].status"] = "reversed";
    setFields["items.$[elem].reversedAt"] = now;
    setFields["items.$[elem].reversedBy"] = actorUserId || null;
    setFields["items.$[elem].reversalReason"] = reason || "Late penalty invoice reversed.";
  } else {
    setFields["items.$[elem].status"] = "deleted";
    setFields["items.$[elem].isDeleted"] = true;
    setFields["items.$[elem].deletedAt"] = now;
    setFields["items.$[elem].deletedBy"] = actorUserId || null;
    setFields["items.$[elem].deletionReason"] = reason || "Late penalty invoice deleted.";
  }

  await LatePenaltyBatch.updateMany(
    {
      business: invoice.business,
      "items.penaltyInvoice": invoice._id,
    },
    { $set: setFields },
    { arrayFilters }
  );
};


export const deleteTenantInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const isPrivilegedUser = Boolean(req?.user?.isSystemAdmin || req?.user?.superAdminAccess);

    if (!mongoose.Types.ObjectId.isValid(String(id || ""))) {
      return res.status(400).json({
        error: "Invalid invoice id.",
      });
    }
    const requestedBusinessId = resolveAuthorizedBusinessId(req);
    let businessId = null;

    if (requestedBusinessId) {
      businessId = ensureBusinessAccess(req, requestedBusinessId);
    }

    const invoice = businessId
      ? await TenantInvoice.findOne({
          _id: id,
          business: businessId,
        })
      : isPrivilegedUser
      ? await TenantInvoice.findById(id)
      : null;

    if (!invoice) {
      return res.status(404).json({
        error: "Invoice not found.",
      });
    }

    const invoiceBusinessId = String(invoice?.business || "");

    if (!invoiceBusinessId) {
      return res.status(400).json({
        error: "Business context is required.",
      });
    }

    if (businessId && invoiceBusinessId !== String(businessId)) {
      return res.status(404).json({
        error: "Invoice not found.",
      });
    }

    if (!isPrivilegedUser) {
      ensureBusinessAccess(req, invoiceBusinessId);
    }

    businessId = invoiceBusinessId;

    if (["cancelled", "reversed"].includes(String(invoice.status || "").toLowerCase())) {
      return res.status(400).json({
        error: "This invoice has already been cancelled or reversed.",
      });
    }

    if (["paid", "partially_paid"].includes(String(invoice.status || "").toLowerCase())) {
      return res.status(400).json({
        error: "Paid or partially paid invoices cannot be deleted. Reverse receipts first.",
      });
    }

    const activeNotesCount = await TenantInvoiceNote.countDocuments({
      business: invoice.business,
      sourceInvoice: invoice._id,
      status: { $nin: ["cancelled", "reversed"] },
    });

    if (activeNotesCount > 0) {
      return res.status(400).json({
        error: "This invoice has active debit or credit notes. Reverse or cancel those notes first.",
      });
    }

    const canHardDeleteWithoutAuditReversal =
      invoice.ledgerMode === "off_ledger" ||
      (["unposted", "failed", "not_applicable"].includes(String(invoice.postingStatus || "").toLowerCase()) &&
        Array.isArray(invoice.ledgerEntries) &&
        invoice.ledgerEntries.length === 0);

    if (canHardDeleteWithoutAuditReversal) {
      await TenantInvoice.deleteOne({ _id: invoice._id });
      await syncLatePenaltyBatchItemsForInvoiceDeletion({
        invoice,
        actorUserId: null,
        itemStatus: "deleted",
        reason: `Late penalty invoice ${invoice.invoiceNumber || invoice._id} deleted without ledger posting.`,
      });
      await releaseMeterReadingLinkedToInvoice(
        invoice,
        null,
        `Invoice ${invoice.invoiceNumber || invoice._id} was permanently deleted`
      );
      await applyIncrementalBalanceDelta({ tenantId: invoice.tenant, businessId: invoice.business, delta: -Math.abs(Number(invoice.amount || 0)) });
      await recomputeTenantFinancialState({
        businessId: invoice.business,
        tenantId: invoice.tenant,
      });

      return res.status(200).json({
        success: true,
        message: "Invoice deleted permanently.",
        deletedInvoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        auditStatus: "hard_deleted",
      });
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: invoice.business,
        bodyCreatedBy: invoice.createdBy,
      });
    } catch (actorError) {
      return res.status(400).json({
        error: actorError.message,
      });
    }

    const touchedAccountIds = new Set();

    if (invoice.ledgerMode !== "off_ledger") {
      const originalEntries = await FinancialLedgerEntry.find({
        business: invoice.business,
        sourceTransactionType: "invoice",
        sourceTransactionId: String(invoice._id),
        status: "approved",
        category: { $ne: "REVERSAL" },
      });

      for (const entry of originalEntries) {
        if (entry?.accountId) {
          touchedAccountIds.add(String(entry.accountId));
        }

        if (!entry.reversedByEntry && entry.status !== "reversed") {
          const reversal = await postReversal({
            entryId: entry._id,
            reason: `Invoice ${invoice.invoiceNumber} deleted`,
            userId: actorUserId,
          });

          if (reversal?.reversalEntry?.accountId) {
            touchedAccountIds.add(String(reversal.reversalEntry.accountId));
          }
        }
      }
    }

    const cancellationStatus = invoice.ledgerMode === "off_ledger" ? "cancelled" : "reversed";
    const nextMetadata = {
      ...(invoice.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {}),
      deletedAt: new Date(),
      deletedBy: actorUserId,
      deletionMode: "soft_delete",
      auditPreserved: true,
    };

    invoice.status = cancellationStatus;
    invoice.postingStatus = invoice.ledgerMode === "off_ledger" ? "not_applicable" : "reversed";
    invoice.postingError = null;
    invoice.metadata = nextMetadata;
    await invoice.save();

    await syncLatePenaltyBatchItemsForInvoiceDeletion({
      invoice,
      actorUserId,
      itemStatus: cancellationStatus === "reversed" ? "reversed" : "deleted",
      reason: `Late penalty invoice ${invoice.invoiceNumber || invoice._id} ${cancellationStatus}.`,
    });

    await releaseMeterReadingLinkedToInvoice(
      invoice,
      actorUserId,
      `Invoice ${invoice.invoiceNumber || invoice._id} was ${cancellationStatus}`
    );

    await applyIncrementalBalanceDelta({ tenantId: invoice.tenant, businessId: invoice.business, delta: -Math.abs(Number(invoice.amount || 0)) });
    await recomputeTenantFinancialState({
      businessId: invoice.business,
      tenantId: invoice.tenant,
    });

    if (touchedAccountIds.size > 0) {
      await aggregateChartOfAccountBalances(invoice.business, Array.from(touchedAccountIds));
    }

    return res.status(200).json({
      success: true,
      message: "Invoice deleted successfully.",
      deletedInvoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      auditStatus: cancellationStatus,
    });
  } catch (error) {
    console.error("Delete tenant invoice error:", error);
    return res.status(500).json({
      error: `Failed to delete invoice. ${error.message}`,
    });
  }
};

export {
  normalizeDate,
  buildStatementPeriod,
  resolveInvoiceNumber,
  resolveInvoiceIncomeAccount,
  resolveActorUserId,
  resolveTenantOperationalStatus,
  recomputeTenantBalance,
  recomputeTenantFinancialState,
  getInvoicePriorityGroup,
  getInvoiceUtilityType,
  computeTenantInvoiceSnapshots,
  recomputeInvoiceStatusesForTenant,
  postInvoiceJournal,
};