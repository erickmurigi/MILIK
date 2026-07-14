import mongoose from "mongoose";
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import MpesaCollection from "../../models/MpesaCollection.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import {
  applyIncrementalBalanceDelta,
  computeTenantInvoiceSnapshots,
  recomputeInvoiceStatusesForTenant,
  recomputeTenantFinancialState,
} from "./tenantInvoices.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import {
  resolveLandlordRemittancePayableAccount,
  resolvePropertyAccountingContext,
} from "../../services/propertyAccountingService.js";
import {
  postPropertyLedgerEntry,
  resolvePropertyLedgerAccounts,
} from "../../services/propertyLedgerService.js";
import { resolveConfiguredAccountingDefaultAccount } from "../../services/companyAccountingDefaultsService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { logAuditEvent } from "../../utils/auditLogger.js";
import SequenceCounter from "../../models/SequenceCounter.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const escapeRegExp = (value = "") => String(value || "").replace(/[|\\{}()\[\]^$+*?.]/g, "\\$&");

const CATEGORY_TO_SUMMARY = {
  RENT_CHARGE: "rent", DEPOSIT_CHARGE: "deposit", UTILITY_CHARGE: "utility",
  LATE_PENALTY_CHARGE: "latePenalty", OTHER_CHARGE: "other", DEBIT_NOTE: "debitNote",
};

const populateReceiptQuery = (query) =>
  query
    .populate("tenant", "name email phone unit business")
    .populate({
      path: "unit",
      select: "unitNumber property business",
      populate: { path: "property", select: "propertyName propertyCode business landlords" },
    })
    .populate("confirmedBy", "surname otherNames email")
    .populate("reversedBy", "surname otherNames email")
    .populate("ledgerEntries")
    .lean();

const populateReceiptListQuery = (query) =>
  query
    .populate("tenant", "name email phone unit business")
    .populate({
      path: "unit",
      select: "unitNumber property business",
      populate: { path: "property", select: "propertyName propertyCode business" },
    })
    .populate("confirmedBy", "surname otherNames email")
    .populate("reversedBy", "surname otherNames email")
    .lean();

const safeLower = (value = "") => String(value || "").trim().toLowerCase();

const receiptLabel = (payment = {}) =>
  payment?.receiptNumber || payment?.referenceNumber || String(payment?._id || "receipt");

const normalizeDepositHolder = (value = "") => {
  const normalized = safeLower(value);
  if (["landlord", "held_by_landlord"].includes(normalized)) return "landlord";
  if (
    [
      "management company",
      "management_company",
      "propertymanager",
      "property manager",
      "property_manager",
      "manager",
    ].includes(normalized)
  ) {
    return "manager";
  }
  return "";
};


const buildResolvedDepositMetadata = ({ tenant = null, property = null, metadata = {}, paymentType = "", allocationData = null }) => {
  const nextMetadata = metadata && typeof metadata === "object" ? { ...metadata } : {};
  const resolvedFromAllocations = Array.isArray(allocationData?.allocations)
    ? allocationData.allocations.reduce((resolved, row) => {
        const enriched = enrichDepositAllocationMetadata(row);
        return resolved || enriched.depositHeldBy || "";
      }, "")
    : "";

  const hasDepositPortion = safeLower(paymentType) === "deposit" || Number(allocationData?.allocationSummary?.deposit || 0) > 0;
  const candidateHolder =
    normalizeDepositHolder(nextMetadata?.depositHeldBy) ||
    normalizeDepositHolder(resolvedFromAllocations) ||
    normalizeDepositHolder(tenant?.depositHeldBy) ||
    normalizeDepositHolder(property?.depositHeldBy) ||
    (hasDepositPortion ? "manager" : "");

  if (!candidateHolder) {
    return {
      metadata: nextMetadata,
      allocations: Array.isArray(allocationData?.allocations) ? allocationData.allocations : [],
    };
  }

  nextMetadata.depositHeldBy = candidateHolder;
  if (candidateHolder === "landlord") {
    nextMetadata.ledgerMode = "off_ledger";
  }

  const nextAllocations = Array.isArray(allocationData?.allocations)
    ? allocationData.allocations.map((row) => {
        if (String(row?.priorityGroup || "").toLowerCase() !== "deposit") return row;
        const enriched = enrichDepositAllocationMetadata({
          ...row,
          depositHeldBy: row?.depositHeldBy || candidateHolder,
          invoiceLedgerMode: row?.invoiceLedgerMode || (candidateHolder === "landlord" ? "off_ledger" : ""),
          metadata: {
            ...(row?.metadata && typeof row.metadata === "object" ? row.metadata : {}),
            depositHeldBy: row?.depositHeldBy || candidateHolder,
            ledgerMode: row?.invoiceLedgerMode || (candidateHolder === "landlord" ? "off_ledger" : ""),
          },
        });
        return {
          ...row,
          depositHeldBy: enriched.depositHeldBy || candidateHolder,
          invoiceLedgerMode: enriched.invoiceLedgerMode || (candidateHolder === "landlord" ? "off_ledger" : ""),
        };
      })
    : [];

  return {
    metadata: nextMetadata,
    allocations: nextAllocations,
  };
};


const enrichDepositAllocationMetadata = (row = {}) => {
  const normalizedHolder =
    normalizeDepositHolder(row?.depositHeldBy) ||
    normalizeDepositHolder(row?.metadata?.depositHeldBy) ||
    normalizeDepositHolder(row?.sourceInvoice?.depositHeldBy) ||
    normalizeDepositHolder(row?.sourceInvoice?.metadata?.depositHeldBy);

  const normalizedLedgerMode = safeLower(
    row?.invoiceLedgerMode ||
      row?.ledgerMode ||
      row?.metadata?.ledgerMode ||
      row?.sourceInvoice?.ledgerMode ||
      row?.sourceInvoice?.metadata?.ledgerMode ||
      ""
  );

  const resolvedLedgerMode =
    normalizedLedgerMode || (normalizedHolder === "landlord" ? "off_ledger" : "");

  return {
    depositHeldBy: normalizedHolder,
    invoiceLedgerMode: resolvedLedgerMode,
  };
};

const normalizeTakeOnBillItemKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeUtilityMatch = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getPaymentMetadata = (payment = {}) =>
  payment?.metadata && typeof payment.metadata === "object" ? payment.metadata : {};

const isTakeOnBalanceReceipt = (payment = {}) => {
  const metadata = getPaymentMetadata(payment);
  return metadata?.isTakeOnBalance === true || safeLower(metadata?.sourceTransactionType) === "tenant_take_on_balance";
};

const isTakeOnCreditReceipt = (payment = {}) => {
  if (!isTakeOnBalanceReceipt(payment)) return false;
  const metadata = getPaymentMetadata(payment);
  return ["credit", "negative"].includes(safeLower(metadata?.takeOnType || metadata?.entryDirection));
};

const getTakeOnAllocationRule = (metadata = {}) => {
  const billItemKey = normalizeTakeOnBillItemKey(metadata?.takeOnBillItemKey || metadata?.billItemKey || "");
  const explicitUtility = normalizeUtilityMatch(
    metadata?.utilityType || metadata?.utilityName || metadata?.takeOnUtilityType || metadata?.takeOnBillItemLabel || ""
  );

  if (!billItemKey) {
    return {
      priorityGroups: null,
      utilityType: explicitUtility,
      paymentType: explicitUtility ? "utility" : "rent",
    };
  }

  if (billItemKey.startsWith("utility:")) {
    return {
      priorityGroups: ["utility"],
      utilityType: explicitUtility || normalizeUtilityMatch(billItemKey.split(":").slice(1).join(":")),
      paymentType: "utility",
    };
  }

  if (billItemKey === "utility") {
    return {
      priorityGroups: ["utility"],
      utilityType: explicitUtility,
      paymentType: "utility",
    };
  }

  if (billItemKey === "deposit") {
    return { priorityGroups: ["deposit"], utilityType: "", paymentType: "deposit" };
  }

  if (billItemKey === "late_penalty") {
    return { priorityGroups: ["late_penalty"], utilityType: "", paymentType: "late_fee" };
  }

  if (billItemKey === "other") {
    return { priorityGroups: ["debit_note", "other"], utilityType: "", paymentType: "other" };
  }

  return { priorityGroups: ["rent"], utilityType: "", paymentType: "rent" };
};

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

const resolveBusinessId = (req) => {
  const explicitBusiness =
    req?.query?.business ||
    req?.query?.company ||
    req?.body?.business ||
    req?.body?.company ||
    null;

  if (explicitBusiness) {
    return explicitBusiness;
  }

  return req?.user?.company?._id || req?.user?.company || req?.user?.business || null;
};

const authorizePaymentAccess = async (req, payment) => {
  if (!payment) {
    return { allowed: false, status: 404, message: "Payment not found" };
  }

  if (req.user?.isSystemAdmin) {
    return { allowed: true };
  }

  const businessId = resolveBusinessId(req);
  if (!businessId || String(payment.business) !== String(businessId)) {
    return {
      allowed: false,
      status: 403,
      message: "Not authorized to access this receipt",
    };
  }

  return { allowed: true };
};

const resolveActorUserId = async ({ req, business, fallbackUserId = null }) =>
  resolveAuditActorUserId({
    req,
    businessId: business,
    candidateUserIds: [fallbackUserId],
    fallbackErrorMessage:
      "No valid company user could be resolved for receipt posting. Create at least one real user under this company, or submit a valid User ObjectId.",
  });

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const generateReceiptNumber = async (businessId) => {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business: String(businessId), key: "rent_receipt" },
    { $inc: { sequence: 1 } },
    { upsert: true, new: true }
  ).lean();
  const candidate = `REC${String(counter.sequence).padStart(5, "0")}`;

  const conflict = await RentPayment.exists({ business: businessId, receiptNumber: candidate });
  if (!conflict) return candidate;

  // Counter is behind existing data (e.g. after a partial DB reset) — find the true max and jump past it
  const [agg] = await RentPayment.aggregate([
    {
      $match: {
        business: new mongoose.Types.ObjectId(String(businessId)),
        receiptNumber: { $regex: /^REC\d+$/ },
      },
    },
    { $group: { _id: null, maxSeq: { $max: { $toInt: { $substr: ["$receiptNumber", 3, -1] } } } } },
  ]);
  const nextSeq = (agg?.maxSeq ?? counter.sequence) + 1;
  await SequenceCounter.updateOne(
    { business: String(businessId), key: "rent_receipt" },
    { $max: { sequence: nextSeq } }
  );
  return `REC${String(nextSeq).padStart(5, "0")}`;
};

const getStatementPeriodFromPayment = (payment) => {
  const paymentDate = normalizeDate(payment?.paymentDate, new Date());
  const fallbackMonth = paymentDate.getMonth() + 1;
  const fallbackYear = paymentDate.getFullYear();

  const month = Number(payment?.month || fallbackMonth);
  const year = Number(payment?.year || fallbackYear);

  const start = new Date(year, Math.max(month - 1, 0), 1, 0, 0, 0, 0);
  const end = new Date(year, Math.max(month, 1), 0, 23, 59, 59, 999);

  return { start, end };
};

const resolvePropertyAndLandlord = async (payment) => {
  const unit = await Unit.findOne({
    _id: payment.unit,
    business: payment.business,
  })
    .select("property business")
    .lean();

  if (!unit?.property) {
    throw new Error("Unit is not linked to a property.");
  }

  const property = await Property.findOne({
    _id: unit.property,
    business: payment.business,
  })
    .select("landlords business")
    .lean();

  if (!property) {
    throw new Error("Property not found for the selected unit.");
  }

  const landlords = Array.isArray(property.landlords) ? property.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  const landlordId = primary?.landlordId || fallback?.landlordId || null;

  if (!landlordId) {
    throw new Error("Property has no landlord linked. Receipt cannot be posted.");
  }

  return {
    propertyId: unit.property,
    landlordId,
  };
};

const findFirstAccount = async (businessId, candidates = []) => {
  for (const candidate of candidates) {
    const query = { business: businessId };
    const and = [];

    if (candidate._id) {
      query._id = candidate._id;
    } else {
      if (candidate.type) and.push({ type: candidate.type });
      if (candidate.code) and.push({ code: candidate.code });
      if (candidate.group) and.push({ group: candidate.group });
      if (candidate.nameRegex) and.push({ name: { $regex: candidate.nameRegex, $options: "i" } });
      if (and.length > 0) query.$and = and;
    }

    const account = await ChartOfAccount.findOne(query).lean();
    if (account) return account;
  }

  console.warn("[findFirstAccount] No matching account found for candidates:", JSON.stringify(candidates));
  return null;
};

const resolveCashbookAccount = async (businessId, payment) => {
  if (payment?.paidDirectToLandlord) {
    return null;
  }

  const metadata = getPaymentMetadata(payment);
  if (isTakeOnCreditReceipt(payment)) {
    const openingBalanceAccountValue =
      metadata?.openingBalanceAccountId ||
      metadata?.openingBalanceAccount ||
      metadata?.openingBalanceAccountCode ||
      metadata?.chartAccountId ||
      metadata?.chartAccount ||
      metadata?.chartAccountCode ||
      metadata?.accountCode ||
      metadata?.account ||
      "";

    if (!openingBalanceAccountValue) {
      throw new Error("Select an opening balance posting account for credit take-on balances.");
    }

    let openingBalanceAccount = null;
    if (isValidObjectId(openingBalanceAccountValue)) {
      openingBalanceAccount = await ChartOfAccount.findOne({
        _id: openingBalanceAccountValue,
        business: businessId,
      }).lean();
    }

    if (!openingBalanceAccount) {
      openingBalanceAccount = await ChartOfAccount.findOne({
        business: businessId,
        $or: [
          { code: String(openingBalanceAccountValue).trim() },
          {
            name: {
              $regex: `^${escapeRegExp(String(openingBalanceAccountValue).trim())}$`,
              $options: "i",
            },
          },        ],
      }).lean();
    }

    if (!openingBalanceAccount) {
      throw new Error("Selected opening balance posting account was not found for this company.");
    }

    return openingBalanceAccount;
  }

  const cashbook = String(payment?.cashbook || "").trim();
  const paymentMethod = String(payment?.paymentMethod || "").trim();

  const exactByCashbook = cashbook
    ? await ChartOfAccount.findOne({
        business: businessId,
        name: {
          $regex: `^${cashbook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      }).lean()
    : null;

  if (exactByCashbook) return exactByCashbook;

  const candidates = [];

  if (/mpesa|m-pesa|mobile/i.test(cashbook) || paymentMethod === "mobile_money") {
    candidates.push(
      { nameRegex: "m-?pesa", type: "asset" },
      { nameRegex: "mobile money", type: "asset" }
    );
  }

  if (/bank/i.test(cashbook) || paymentMethod === "bank_transfer") {
    candidates.push({ nameRegex: "bank", type: "asset" });
  }

  if (/cash/i.test(cashbook) || paymentMethod === "cash") {
    candidates.push({ nameRegex: "^cash", type: "asset" });
  }

  candidates.push(
    { nameRegex: cashbook || "main cashbook", type: "asset" },
    { nameRegex: "main cashbook", type: "asset" },
    { nameRegex: "cashbook", type: "asset" },
    { nameRegex: "^cash$", type: "asset" }
  );

  const account = await findFirstAccount(businessId, candidates);
  if (!account) {
    throw new Error(
      `Cashbook account not found for '${cashbook || paymentMethod || "receipt"}'. Create the matching Chart of Account first.`
    );
  }

  return account;
};

const resolveCreditAccount = async (businessId, payment) => {
  switch (payment?.paymentType) {
    case "rent":
    case "utility": {
      const configuredReceivable = await resolveConfiguredAccountingDefaultAccount({
        businessId,
        field: "tenantReceivableAccount",
      });
      if (configuredReceivable) return configuredReceivable;

      const account = await findFirstAccount(businessId, [
        { code: "1200", type: "asset" },
        { nameRegex: "^tenant receivable", type: "asset" },
        { nameRegex: "accounts receivable", type: "asset" },
        { nameRegex: "receivable", type: "asset" },
      ]);

      if (!account) {
        throw new Error("Tenant receivable account not found. Receipt cannot reduce receivables correctly.");
      }
      return account;
    }

    case "deposit": {
      const configuredDepositLiability = await resolveConfiguredAccountingDefaultAccount({
        businessId,
        field: "depositLiabilityAccount",
      });
      if (configuredDepositLiability) return configuredDepositLiability;

      const account = await findFirstAccount(businessId, [
        { nameRegex: "deposit liability", type: "liability" },
        { nameRegex: "tenant deposit", type: "liability" },
        { nameRegex: "security deposit", type: "liability" },
      ]);

      if (!account) {
        throw new Error("Tenant deposit liability account not found. Deposit receipt cannot be posted correctly.");
      }
      return account;
    }

    case "late_fee":
    case "other":
    default: {
      const configuredPenaltyIncome = await resolveConfiguredAccountingDefaultAccount({
        businessId,
        field: "penaltyIncomeAccount",
      });
      if (configuredPenaltyIncome) return configuredPenaltyIncome;

      const account = await findFirstAccount(businessId, [
        { nameRegex: "other income", type: "income" },
        { nameRegex: "late fee", type: "income" },
        { nameRegex: "miscellaneous income", type: "income" },
        { nameRegex: "rent income", type: "income" },
      ]);

      if (!account) {
        throw new Error("Income account for late fee/other receipt was not found.");
      }
      return account;
    }
  }
};

const getReceiptAllocationRows = (payment) => (Array.isArray(payment?.allocations) ? payment.allocations : []);

const getPrimaryPaymentTypeFromAllocations = (payment) => {
  const summary = payment?.allocationSummary || {};
  if (Number(summary.rent || 0) > 0) return "rent";
  if (Number(summary.deposit || 0) > 0) return "deposit";
  if (Number(summary.utility || 0) > 0) return "utility";
  if (Number(summary.latePenalty || 0) > 0) return "late_fee";
  return String(payment?.paymentType || "rent").toLowerCase();
};

const getNormalizedAllocationSummary = (summary = {}) => ({
  rent: round2(Number(summary?.rent || 0)),
  deposit: round2(Number(summary?.deposit || 0)),
  utility: round2(Number(summary?.utility || 0)),
  latePenalty: round2(Number(summary?.latePenalty || 0)),
  debitNote: round2(Number(summary?.debitNote || 0)),
  other: round2(Number(summary?.other || 0)),
  unapplied: round2(Number(summary?.unapplied || 0)),
});

const hasStoredAllocationSnapshot = (payment = {}) => {
  const rows = getReceiptAllocationRows(payment);
  if (rows.length > 0) return true;

  const summary = getNormalizedAllocationSummary(payment?.allocationSummary);
  return (
    Number(summary.rent || 0) > 0 ||
    Number(summary.deposit || 0) > 0 ||
    Number(summary.utility || 0) > 0 ||
    Number(summary.latePenalty || 0) > 0 ||
    Number(summary.debitNote || 0) > 0 ||
    Number(summary.other || 0) > 0 ||
    Number(summary.unapplied || 0) > 0
  );
};

const getNormalizedReceiptBreakdown = (breakdown = {}, fallbackTotal = 0) => ({
  rent: round2(Number(breakdown?.rent || 0)),
  utilities: Array.isArray(breakdown?.utilities)
    ? breakdown.utilities.map((utility) => ({
        utility: utility?.utility || null,
        name: utility?.name || "",
        amount: round2(Number(utility?.amount || 0)),
        billingCycle: utility?.billingCycle || "",
      }))
    : [],
  total: round2(Number(breakdown?.total || fallbackTotal || 0)),
});

const buildStoredReceiptAllocationData = (payment = {}) => {
  const receiptAmount = round2(Math.abs(Number(payment?.amount || 0)));
  const rows = getReceiptAllocationRows(payment).map((row) => ({
    invoice: row?.invoice || row?.invoiceId || null,
    invoiceNumber: row?.invoiceNumber || "",
    category: row?.category || "",
    priorityGroup: row?.priorityGroup || "other",
    utilityType: row?.utilityType || "",
    depositHeldBy: row?.depositHeldBy || "",
    invoiceLedgerMode: row?.invoiceLedgerMode || row?.ledgerMode || "",
    metadata: row?.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {},
    appliedAmount: round2(Math.abs(Number(row?.appliedAmount || 0))),
    beforeOutstanding: round2(Math.abs(Number(row?.beforeOutstanding || 0))),
    afterOutstanding: round2(Math.abs(Number(row?.afterOutstanding || 0))),
    invoiceDate: row?.invoiceDate || null,
    dueDate: row?.dueDate || null,
    description: row?.description || "",
  }));

  if (rows.length > 0) {
    const summarized = summarizeAllocationRows({
      rows,
      receiptAmount,
      metadata: getPaymentMetadata(payment),
      paymentTypeOverride: payment?.paymentType || "",
    });

    return {
      allocations: rows,
      allocationSummary: summarized.allocationSummary,
      breakdown: summarized.breakdown,
      primaryPaymentType: summarized.primaryPaymentType,
    };
  }

  return {
    allocations: [],
    allocationSummary: getNormalizedAllocationSummary(payment?.allocationSummary),
    breakdown: getNormalizedReceiptBreakdown(payment?.breakdown, receiptAmount),
    primaryPaymentType: getPrimaryPaymentTypeFromAllocations(payment),
  };
};

const shouldIncludeInLandlordStatement = (payment) => {
  if (isTakeOnBalanceReceipt(payment)) return false;
  const summary = payment?.allocationSummary || {};
  return Number(summary.rent || 0) > 0 || Number(summary.utility || 0) > 0;
};

const getReceiptStatementCategoryForGroup = (group, paidDirectToLandlord) => {
  const normalized = String(group || "").toLowerCase();
  if (normalized === "utility") return paidDirectToLandlord ? "UTILITY_RECEIPT_LANDLORD" : "UTILITY_RECEIPT_MANAGER";
  if (normalized === "deposit" || normalized === "deposit_landlord") return "DEPOSIT_RECEIVED";
  if (["unapplied", "late_penalty", "debit_note", "other"].includes(normalized)) return "ADJUSTMENT";
  return paidDirectToLandlord ? "RENT_RECEIPT_LANDLORD" : "RENT_RECEIPT_MANAGER";
};

const isLandlordHeldDepositAllocationRow = (row = {}) => {
  const priorityGroup = safeLower(row?.priorityGroup || "");
  if (priorityGroup !== "deposit") return false;

  const depositHolder =
    normalizeDepositHolder(row?.depositHeldBy) ||
    normalizeDepositHolder(row?.metadata?.depositHeldBy) ||
    normalizeDepositHolder(row?.sourceInvoice?.depositHeldBy) ||
    normalizeDepositHolder(row?.sourceInvoice?.metadata?.depositHeldBy);

  const ledgerMode = safeLower(
    row?.invoiceLedgerMode ||
      row?.ledgerMode ||
      row?.sourceInvoice?.ledgerMode ||
      row?.sourceInvoice?.metadata?.ledgerMode ||
      ""
  );

  return depositHolder === "landlord" || ledgerMode === "off_ledger";
};

const getReceiptPostingBucketFromAllocationRow = (row = {}) => {
  const priorityGroup = safeLower(row?.priorityGroup || "other");
  if (priorityGroup === "deposit" && isLandlordHeldDepositAllocationRow(row)) {
    return "deposit_landlord";
  }
  return priorityGroup || "other";
};

const resolveUnallocatedReceiptsLiabilityAccount = async (businessId) => {
  const account = await findFirstAccount(businessId, [
    { nameRegex: "unallocated receipt", type: "liability" },
    { nameRegex: "tenant advance", type: "liability" },
    { nameRegex: "advance rent", type: "liability" },
    { nameRegex: "deferred rent", type: "liability" },
    { nameRegex: "tenant credit", type: "liability" },
    { nameRegex: "receipt clearing", type: "liability" },
    { nameRegex: "customer deposit", type: "liability" },
  ]);

  if (!account) {
    throw new Error(
      "Tenant advance / unallocated receipts liability account not found. Create one before posting prepayments or overpayments."
    );
  }

  return account;
};

const resolveCreditAccountForAllocationGroup = async (businessId, groupKey) => {
  const normalized = String(groupKey || "").trim().toLowerCase();

  if (normalized === "unapplied") {
    return resolveUnallocatedReceiptsLiabilityAccount(businessId);
  }

  if (normalized === "deposit_landlord") {
    const account = await resolveLandlordRemittancePayableAccount(businessId);

    if (!account?._id) {
      throw new Error("Landlord Remittance Payable account not found. Landlord-held deposit receipt cannot be posted correctly.");
    }

    return account;
  }

  // Manager-held deposits are recognized as a liability when the deposit invoice is raised.
  // A receipt allocated to that invoice should therefore clear tenant receivable,
  // not create the deposit liability a second time.
  return resolveCreditAccount(businessId, { paymentType: "rent" });
};

const getPostingRoleForAllocationGroup = (groupKey) => {
  const normalized = String(groupKey || "").trim().toLowerCase();
  if (normalized === "utility") return "tenant_receivable_utility";
  if (normalized === "unapplied") return "tenant_advance_liability";
  if (normalized === "deposit_landlord") return "landlord_deposit_remittance";
  return "tenant_receivable";
};

const buildReceiptAllocationData = async ({ businessId, tenantId, amount, paymentTypeOverride = "", metadata = {}, prepaymentLines = [] }) => {
  const receiptAmount = Math.abs(Number(amount || 0));
  const allocationSummary = {
    rent: 0,
    deposit: 0,
    utility: 0,
    latePenalty: 0,
    debitNote: 0,
    other: 0,
    unapplied: 0,
  };

  const takeOnRule = isTakeOnBalanceReceipt({ metadata })
    ? getTakeOnAllocationRule(metadata || {})
    : { priorityGroups: null, utilityType: "", paymentType: safeLower(paymentTypeOverride || "") };

  const normalizedOverrideType = safeLower(
    paymentTypeOverride || takeOnRule.paymentType || metadata?.paymentType || ""
  );

  if (!businessId || !tenantId || receiptAmount <= 0) {
    allocationSummary.unapplied = receiptAmount;
    return {
      allocations: [],
      allocationSummary,
      breakdown: {
        rent: 0,
        utilities: normalizedOverrideType === "utility" && takeOnRule.utilityType
          ? [{
              name: metadata?.takeOnBillItemLabel || metadata?.utilityType || "Utility",
              utility: null,
              amount: 0,
              billingCycle: "",
            }]
          : [],
        total: receiptAmount,
      },
      primaryPaymentType: normalizedOverrideType || "rent",
    };
  }

  const { invoiceSnapshots } = await computeTenantInvoiceSnapshots({ businessId, tenantId });
  let remaining = receiptAmount;
  const allocations = [];
  const utilityMap = new Map();

  for (const snapshot of invoiceSnapshots) {
    if (remaining <= 0) break;

    const priorityGroup = String(snapshot.priorityGroup || "other").toLowerCase();
    if (Array.isArray(takeOnRule.priorityGroups) && takeOnRule.priorityGroups.length > 0) {
      if (!takeOnRule.priorityGroups.includes(priorityGroup)) continue;
      if (priorityGroup === "utility" && takeOnRule.utilityType) {
        const snapshotUtilityType = normalizeUtilityMatch(snapshot.utilityType || "");
        if (!snapshotUtilityType || snapshotUtilityType !== takeOnRule.utilityType) continue;
      }
    }

    const outstanding = Math.max(0, Number(snapshot.outstanding || 0));
    if (outstanding <= 0) continue;

    const appliedAmount = Math.min(outstanding, remaining);
    if (appliedAmount <= 0) continue;

    const utilityType = String(snapshot.utilityType || "").trim();
    const depositMeta = enrichDepositAllocationMetadata({
      depositHeldBy: snapshot?.depositHeldBy || snapshot?.metadata?.depositHeldBy || "",
      invoiceLedgerMode: snapshot?.ledgerMode || snapshot?.metadata?.ledgerMode || "",
      metadata: snapshot?.metadata || {},
      sourceInvoice: snapshot,
    });

    allocations.push({
      invoice: snapshot._id,
      invoiceNumber: snapshot.invoiceNumber || "",
      category: snapshot.category || "",
      priorityGroup,
      utilityType,
      depositHeldBy: depositMeta.depositHeldBy || "",
      invoiceLedgerMode: depositMeta.invoiceLedgerMode || "",
      appliedAmount,
      beforeOutstanding: outstanding,
      afterOutstanding: Math.max(0, outstanding - appliedAmount),
      invoiceDate: snapshot.invoiceDate || null,
      dueDate: snapshot.dueDate || null,
      description: snapshot.description || "",
    });

    if (priorityGroup === "rent") allocationSummary.rent += appliedAmount;
    else if (priorityGroup === "deposit") allocationSummary.deposit += appliedAmount;
    else if (priorityGroup === "utility") {
      allocationSummary.utility += appliedAmount;
      const key = utilityType || metadata?.takeOnBillItemLabel || metadata?.utilityType || "Utility";
      utilityMap.set(key, Number(utilityMap.get(key) || 0) + appliedAmount);
    } else if (priorityGroup === "late_penalty") allocationSummary.latePenalty += appliedAmount;
    else if (priorityGroup === "debit_note") allocationSummary.debitNote += appliedAmount;
    else allocationSummary.other += appliedAmount;

    remaining -= appliedAmount;
  }

  // Tag unapplied excess with prepayment type so auto-allocation knows where to apply it later
  if (remaining > 0.005) {
    const lines = Array.isArray(prepaymentLines) && prepaymentLines.length > 0
      ? prepaymentLines
      : [{ billItemKey: "rent", label: "Rent Prepayment", amount: remaining }];

    let excessPool = remaining;
    for (const line of lines) {
      if (excessPool <= 0.005) break;
      const lineAmt = round2(Math.min(Number(line.amount || 0), excessPool));
      if (lineAmt <= 0.005) continue;

      const isUtility = String(line.billItemKey || "").startsWith("utility:");
      const utType = isUtility ? String(line.billItemKey).replace("utility:", "") : "";

      allocations.push({
        invoice: null,
        invoiceNumber: "",
        category: isUtility ? "UTILITY_CHARGE" : "RENT_CHARGE",
        priorityGroup: isUtility ? "utility" : "rent",
        utilityType: utType,
        billItemKey: line.billItemKey || "rent",
        prepaymentLabel: line.label || (isUtility ? `${utType} Prepayment` : "Rent Prepayment"),
        isPrepayment: true,
        appliedAmount: lineAmt,
        beforeOutstanding: 0,
        afterOutstanding: 0,
        description: line.label || "Prepayment",
      });
      excessPool = round2(excessPool - lineAmt);
    }
    // Absorb any residual (rounding) into the first rent prepayment line or create one
    if (excessPool > 0.005) {
      const rentLine = allocations.find((a) => !a.invoice && a.isPrepayment && a.billItemKey === "rent");
      if (rentLine) {
        rentLine.appliedAmount = round2(rentLine.appliedAmount + excessPool);
      } else {
        allocations.push({
          invoice: null, invoiceNumber: "",
          category: "RENT_CHARGE", priorityGroup: "rent", utilityType: "",
          billItemKey: "rent", prepaymentLabel: "Rent Prepayment", isPrepayment: true,
          appliedAmount: round2(excessPool), beforeOutstanding: 0, afterOutstanding: 0,
          description: "Rent Prepayment",
        });
      }
    }
  }
  allocationSummary.unapplied = Math.max(0, remaining);

  const breakdown = {
    rent: Number(allocationSummary.rent || 0),
    utilities: Array.from(utilityMap.entries()).map(([name, value]) => ({
      name,
      utility: null,
      amount: Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100,
      billingCycle: "",
    })),
    total: receiptAmount,
  };

  if (breakdown.utilities.length === 0 && normalizedOverrideType === "utility" && (metadata?.takeOnBillItemLabel || metadata?.utilityType)) {
    breakdown.utilities.push({
      name: metadata?.takeOnBillItemLabel || metadata?.utilityType || "Utility",
      utility: null,
      amount: 0,
      billingCycle: "",
    });
  }

  const primaryPaymentType =
    allocationSummary.rent > 0
      ? "rent"
      : allocationSummary.deposit > 0
      ? "deposit"
      : allocationSummary.utility > 0
      ? "utility"
      : allocationSummary.latePenalty > 0
      ? "late_fee"
      : normalizedOverrideType || "rent";

  return {
    allocations,
    allocationSummary,
    breakdown,
    primaryPaymentType,
  };
};

const summarizeAllocationRows = ({ rows = [], receiptAmount = 0, metadata = {}, paymentTypeOverride = "" }) => {
  const allocationSummary = {
    rent: 0,
    deposit: 0,
    utility: 0,
    latePenalty: 0,
    debitNote: 0,
    other: 0,
    unapplied: 0,
  };

  const utilityMap = new Map();

  rows.forEach((row) => {
    const priorityGroup = String(row?.priorityGroup || "other").toLowerCase();
    const appliedAmount = round2(Math.abs(Number(row?.appliedAmount || 0)));
    if (appliedAmount <= 0) return;

    if (priorityGroup === "rent") allocationSummary.rent += appliedAmount;
    else if (priorityGroup === "deposit") allocationSummary.deposit += appliedAmount;
    else if (priorityGroup === "utility") {
      allocationSummary.utility += appliedAmount;
      const key = String(row?.utilityType || row?.description || metadata?.takeOnBillItemLabel || metadata?.utilityType || "Utility").trim() || "Utility";
      utilityMap.set(key, round2(Number(utilityMap.get(key) || 0) + appliedAmount));
    } else if (priorityGroup === "late_penalty") allocationSummary.latePenalty += appliedAmount;
    else if (priorityGroup === "debit_note") allocationSummary.debitNote += appliedAmount;
    else allocationSummary.other += appliedAmount;
  });

  allocationSummary.unapplied = round2(Math.max(0, round2(receiptAmount) - round2(
    Number(allocationSummary.rent || 0) +
    Number(allocationSummary.deposit || 0) +
    Number(allocationSummary.utility || 0) +
    Number(allocationSummary.latePenalty || 0) +
    Number(allocationSummary.debitNote || 0) +
    Number(allocationSummary.other || 0)
  )));

  const breakdown = {
    rent: round2(allocationSummary.rent || 0),
    utilities: Array.from(utilityMap.entries()).map(([name, value]) => ({
      name,
      utility: null,
      amount: round2(value),
      billingCycle: "",
    })),
    total: round2(receiptAmount),
  };

  const normalizedOverrideType = safeLower(paymentTypeOverride || metadata?.paymentType || "");
  if (breakdown.utilities.length === 0 && normalizedOverrideType === "utility" && (metadata?.takeOnBillItemLabel || metadata?.utilityType)) {
    breakdown.utilities.push({
      name: metadata?.takeOnBillItemLabel || metadata?.utilityType || "Utility",
      utility: null,
      amount: 0,
      billingCycle: "",
    });
  }

  const primaryPaymentType =
    allocationSummary.rent > 0
      ? "rent"
      : allocationSummary.deposit > 0
      ? "deposit"
      : allocationSummary.utility > 0
      ? "utility"
      : allocationSummary.latePenalty > 0
      ? "late_fee"
      : normalizedOverrideType || "rent";

  return {
    allocationSummary: {
      rent: round2(allocationSummary.rent),
      deposit: round2(allocationSummary.deposit),
      utility: round2(allocationSummary.utility),
      latePenalty: round2(allocationSummary.latePenalty),
      debitNote: round2(allocationSummary.debitNote),
      other: round2(allocationSummary.other),
      unapplied: round2(allocationSummary.unapplied),
    },
    breakdown,
    primaryPaymentType,
  };
};

const buildReceiptAllocationWorkspace = async (payment) => {
  if (!payment?.business || !payment?.tenant) {
    const initialUnapplied = round2(Math.abs(Number(payment?.allocationSummary?.unapplied || 0)));
    const initialPostedConfirmed = Boolean(payment?.isConfirmed && payment?.postingStatus === "posted");
    return {
      receiptAmount: round2(Math.abs(Number(payment?.amount || 0))),
      invoiceOptions: [],
      currentRows: [],
      lockedAllocatedTotal: 0,
      currentUnapplied: initialUnapplied,
      appendOnlyUnappliedForConfirmed: initialPostedConfirmed && initialUnapplied > 0.009,
      lockedUnappliedForConfirmed: initialPostedConfirmed && initialUnapplied <= 0.009,
    };
  }

  const { invoiceSnapshots, receiptAllocations } = await computeTenantInvoiceSnapshots({
    businessId: payment.business,
    tenantId: payment.tenant,
  });

  const receiptAmount = round2(Math.abs(Number(payment?.amount || 0)));
  const isPostedConfirmed = Boolean(payment?.isConfirmed && payment?.postingStatus === "posted");
  const currentReceiptAllocation = receiptAllocations.find((item) => String(item?.receiptId || "") === String(payment?._id || ""));
  const currentRows = Array.isArray(currentReceiptAllocation?.rows)
    ? currentReceiptAllocation.rows
    : Array.isArray(payment?.allocations)
    ? payment.allocations
        .map((row) => ({
          invoice: String(row?.invoice || row?.invoiceId || ""),
          invoiceNumber: row?.invoiceNumber || "",
          category: row?.category || "",
          priorityGroup: row?.priorityGroup || "other",
          utilityType: row?.utilityType || "",
          depositHeldBy: row?.depositHeldBy || "",
          invoiceLedgerMode: row?.invoiceLedgerMode || row?.ledgerMode || "",
          appliedAmount: round2(Math.abs(Number(row?.appliedAmount || 0))),
          beforeOutstanding: round2(Math.abs(Number(row?.beforeOutstanding || 0))),
          afterOutstanding: round2(Math.abs(Number(row?.afterOutstanding || 0))),
          invoiceDate: row?.invoiceDate || null,
          dueDate: row?.dueDate || null,
          description: row?.description || "",
        }))
        .filter((row) => row.invoice && row.appliedAmount > 0)
    : [];

  const currentAllocatedByInvoice = new Map();
  currentRows.forEach((row) => {
    const key = String(row?.invoice || "");
    if (!key) return;
    currentAllocatedByInvoice.set(key, round2(Number(currentAllocatedByInvoice.get(key) || 0) + Number(row?.appliedAmount || 0)));
  });

  const invoiceOptions = invoiceSnapshots
    .map((snapshot) => {
      const invoiceId = String(snapshot?._id || "");
      const currentAllocation = round2(Number(currentAllocatedByInvoice.get(invoiceId) || 0));
      const currentOutstanding = round2(Math.max(0, Number(snapshot?.outstanding || 0)));
      const maxAllocatable = round2(currentOutstanding + currentAllocation);
      return {
        invoiceId,
        invoiceNumber: snapshot?.invoiceNumber || "",
        category: snapshot?.category || "",
        priorityGroup: snapshot?.priorityGroup || "other",
        utilityType: snapshot?.utilityType || "",
        depositHeldBy: snapshot?.depositHeldBy || snapshot?.metadata?.depositHeldBy || "",
        invoiceLedgerMode: snapshot?.ledgerMode || snapshot?.metadata?.ledgerMode || "",
        description: snapshot?.description || "",
        invoiceDate: snapshot?.invoiceDate || null,
        dueDate: snapshot?.dueDate || null,
        amount: round2(Math.abs(Number(snapshot?.amount || 0))),
        outstanding: currentOutstanding,
        currentAllocation,
        maxAllocatable,
        status: snapshot?.computedStatus || snapshot?.status || "pending",
      };
    })
    .filter((option) => {
      // Keep the support allocation workspace focused on real allocation targets only.
      // Fully-paid invoices are not selectable for new allocations because they have no
      // remaining tenant receivable to clear. Existing allocations are kept visible so
      // an already-linked receipt can still be audited without losing its locked line.
      return String(option.invoiceId || "").trim() && round2(Number(option.maxAllocatable || 0)) > 0;
    });
  const lockedAllocatedTotal = round2(currentRows.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
  const currentUnapplied = round2(Math.max(0, receiptAmount - lockedAllocatedTotal));

  return {
    receiptAmount,
    invoiceOptions,
    currentRows,
    lockedAllocatedTotal,
    currentUnapplied,
    appendOnlyUnappliedForConfirmed: isPostedConfirmed && currentUnapplied > 0.009,
    lockedUnappliedForConfirmed: isPostedConfirmed && currentUnapplied <= 0.009,
  };
};

const buildManualReceiptAllocationData = async ({ payment, requestedAllocations = [] }) => {
  const workspace = await buildReceiptAllocationWorkspace(payment);
  const receiptAmount = round2(workspace.receiptAmount || Math.abs(Number(payment?.amount || 0)));
  const invoiceOptionMap = new Map((workspace.invoiceOptions || []).map((item) => [String(item.invoiceId), item]));

  const mergedRequested = new Map();
  (Array.isArray(requestedAllocations) ? requestedAllocations : []).forEach((row) => {
    const invoiceId = String(row?.invoice || row?.invoiceId || "").trim();
    if (!invoiceId) return;
    const amount = round2(Math.abs(Number(row?.appliedAmount || row?.amount || 0)));
    if (amount <= 0) return;
    mergedRequested.set(invoiceId, round2(Number(mergedRequested.get(invoiceId) || 0) + amount));
  });

  const requestedTotal = round2(Array.from(mergedRequested.values()).reduce((sum, value) => sum + Number(value || 0), 0));
  if (requestedTotal > receiptAmount + 0.009) {
    const error = new Error("Allocated amount cannot exceed the receipt amount.");
    error.statusCode = 400;
    throw error;
  }

  const existingLockedByInvoice = new Map();
  (Array.isArray(workspace.currentRows) ? workspace.currentRows : []).forEach((row) => {
    const invoiceId = String(row?.invoice || row?.invoiceId || "").trim();
    if (!invoiceId) return;
    existingLockedByInvoice.set(
      invoiceId,
      round2(Number(existingLockedByInvoice.get(invoiceId) || 0) + Number(row?.appliedAmount || 0))
    );
  });

  const isPostedConfirmed = Boolean(payment?.isConfirmed && payment?.postingStatus === "posted");
  if (isPostedConfirmed) {
    for (const [invoiceId, lockedAmount] of existingLockedByInvoice.entries()) {
      const requestedAmount = round2(Number(mergedRequested.get(invoiceId) || 0));
      if (requestedAmount + 0.009 < lockedAmount) {
        const lockedLabel = invoiceOptionMap.get(invoiceId)?.invoiceNumber || invoiceId;
        const error = new Error(
          `Confirmed receipt allocations already applied to ${lockedLabel} are locked at KES ${lockedAmount.toLocaleString()}. Only the remaining unapplied balance can be allocated from this workspace.`
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const appendableTotal = round2(Math.max(0, Number(workspace.currentUnapplied || 0)));
    const addedTotal = round2(requestedTotal - Number(workspace.lockedAllocatedTotal || 0));

    if (addedTotal < -0.009) {
      const error = new Error("Confirmed receipt allocations cannot be reduced from this workspace. Reverse and recreate instead.");
      error.statusCode = 400;
      throw error;
    }

    if (addedTotal > appendableTotal + 0.009) {
      const error = new Error(
        `This confirmed receipt only has KES ${appendableTotal.toLocaleString()} of unapplied balance available for new allocation.`
      );
      error.statusCode = 400;
      throw error;
    }
  } else if (workspace.lockedUnappliedForConfirmed) {
    if (Math.abs(requestedTotal - Number(workspace.lockedAllocatedTotal || 0)) > 0.009) {
      const error = new Error(
        `This posted receipt can only reallocate its already allocated amount of KES ${Number(workspace.lockedAllocatedTotal || 0).toLocaleString()}. Its unapplied portion is locked to protect ledger integrity.`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  const rows = [];
  for (const [invoiceId, appliedAmountRaw] of mergedRequested.entries()) {
    const option = invoiceOptionMap.get(invoiceId);
    if (!option) {
      const error = new Error("One or more selected invoices are not valid for this receipt.");
      error.statusCode = 400;
      throw error;
    }

    const appliedAmount = round2(appliedAmountRaw);
    const maxAllocatable = round2(Number(option.maxAllocatable || 0));
    const currentOutstanding = round2(Number(option.outstanding || 0));
    const currentLockedAllocation = round2(Number(option.currentAllocation || 0));

    if (currentOutstanding <= 0.009 && currentLockedAllocation <= 0.009) {
      const label = option.invoiceNumber || option.description || invoiceId;
      const error = new Error(`Cannot allocate receipt to ${label} because the invoice is already fully paid.`);
      error.statusCode = 400;
      throw error;
    }

    if (appliedAmount > maxAllocatable + 0.009) {
      const label = option.invoiceNumber || option.description || invoiceId;
      const error = new Error(`Allocation for ${label} exceeds its available amount of KES ${maxAllocatable.toLocaleString()}.`);
      error.statusCode = 400;
      throw error;
    }
    const depositMeta = enrichDepositAllocationMetadata({
      depositHeldBy: option.depositHeldBy || "",
      invoiceLedgerMode: option.invoiceLedgerMode || "",
      sourceInvoice: option,
    });

    rows.push({
      invoice: invoiceId,
      invoiceNumber: option.invoiceNumber || "",
      category: option.category || "",
      priorityGroup: option.priorityGroup || "other",
      utilityType: option.utilityType || "",
      depositHeldBy: depositMeta.depositHeldBy || "",
      invoiceLedgerMode: depositMeta.invoiceLedgerMode || "",
      appliedAmount,
      beforeOutstanding: maxAllocatable,
      afterOutstanding: round2(Math.max(0, maxAllocatable - appliedAmount)),
      invoiceDate: option.invoiceDate || null,
      dueDate: option.dueDate || null,
      description: option.description || "",
    });
  }

  rows.sort((a, b) => {
    const aDue = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    const aInvoice = a?.invoiceDate ? new Date(a.invoiceDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bInvoice = b?.invoiceDate ? new Date(b.invoiceDate).getTime() : Number.MAX_SAFE_INTEGER;
    if (aInvoice !== bInvoice) return aInvoice - bInvoice;
    return String(a.invoice || "").localeCompare(String(b.invoice || ""));
  });

  const metadata = getPaymentMetadata(payment);
  const summarized = summarizeAllocationRows({
    rows,
    receiptAmount,
    metadata,
    paymentTypeOverride: isTakeOnCreditReceipt(payment) ? metadata?.paymentType || payment?.paymentType || "" : payment?.paymentType || "",
  });

  return {
    ...summarized,
    allocations: rows,
    workspace,
    requestedTotal,
  };
};

const recomputeTenantBalance = async (tenantId, businessId) =>
  recomputeTenantFinancialState({ businessId, tenantId });

const confirmNonCashDirectToLandlordReceipt = async (payment, actorId) => {
  const amount = Math.abs(Number(payment.amount || 0));
  if (amount <= 0) {
    throw new Error("Receipt amount must be greater than zero for ledger posting.");
  }

  const { propertyId, landlordId } = await resolvePropertyAndLandlord(payment);
  const remittanceAccount = await resolveLandlordRemittancePayableAccount(payment.business);

  if (!remittanceAccount?._id) {
    throw new Error("Landlord Remittance Payable account not found for direct-to-landlord receipt posting.");
  }

  // Resolve property-specific receivable account for In-GL properties
  const propCtx = await resolvePropertyAccountingContext({
    propertyId,
    businessId: payment.business,
  }).catch(() => null);

  if (propCtx?.isPropertyGL) {
    if (propCtx.isPropertyLedgerActive) {
      try {
        const plAccounts = await resolvePropertyLedgerAccounts(payment.business);
        const totalAmt = Math.abs(Number(payment.amount || 0));
        if (plAccounts.receivables && totalAmt > 0) {
          const cashAccount = await resolveCashbookAccount(payment.business, payment).catch(() => null);
          await postPropertyLedgerEntry({
            businessId:      payment.business,
            propertyId,
            debitAccountId:  cashAccount?._id || plAccounts.receivables,
            creditAccountId: plAccounts.receivables,
            amount:          totalAmt,
            date:            payment.paymentDate,
            narration:       `Receipt — ${payment.receiptNumber || payment.reference || ""}`.trim(),
            reference:       payment.receiptNumber || payment.reference || "",
            category:        "receipt",
            tenantId:        payment.tenant,
            paymentId:       payment._id,
          });
          payment.postingStatus = "posted";
          payment.postingError  = null;
        } else {
          payment.postingStatus = "not_applicable";
          payment.postingError  = "Property ledger accounts not configured";
        }
      } catch (plErr) {
        payment.postingStatus = "not_applicable";
        payment.postingError  = `Property ledger posting failed: ${plErr.message}`;
      }
    } else {
      payment.postingStatus = "not_applicable";
      payment.postingError  = null;
    }
    await payment.save();
    return { journalGroupId: null, entries: [] };
  }

  const propertyReceivableId = propCtx?.receivablesAccountId || null;

  const receiver = "landlord";
  const { start, end } = getStatementPeriodFromPayment(payment);
  const txDate = normalizeDate(payment.paymentDate);
  const journalGroupId = new mongoose.Types.ObjectId();
  const allocationRows = getReceiptAllocationRows(payment);
  const includeInStatement = shouldIncludeInLandlordStatement(payment);
  const creditLegEntries = [];

  const postingGroups = [];
  const grouped = new Map();

  allocationRows.forEach((row) => {
    const key = getReceiptPostingBucketFromAllocationRow(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  ["rent", "deposit", "deposit_landlord", "utility", "late_penalty", "debit_note", "other"].forEach((key) => {
    const rows = grouped.get(key) || [];
    const total = rows.reduce((sum, row) => sum + Math.abs(Number(row?.appliedAmount || 0)), 0);
    if (total > 0) postingGroups.push({ key, total, rows });
  });

  const unappliedTotal = Math.abs(Number(payment?.allocationSummary?.unapplied || 0));
  if (unappliedTotal > 0) {
    postingGroups.push({ key: "unapplied", total: unappliedTotal, rows: [] });
  }

  if (postingGroups.length === 0 && amount > 0) {
    postingGroups.push({ key: "unapplied", total: amount, rows: [] });
  }

  const _directGroupAccountMap = new Map(
    await Promise.all(
      [...new Set(postingGroups.map((g) => g.key))].map(async (key) => {
        if (key === "unapplied" || key === "deposit_landlord") {
          return [key, await resolveCreditAccountForAllocationGroup(payment.business, key)];
        }
        return [key, propertyReceivableId
          ? { _id: propertyReceivableId }
          : await resolveCreditAccountForAllocationGroup(payment.business, key)];
      })
    )
  );

  for (const group of postingGroups) {
    const category = getReceiptStatementCategoryForGroup(group.key, true);
    const postingRole = getPostingRoleForAllocationGroup(group.key);
    const creditAccount = _directGroupAccountMap.get(group.key);
    const includeGroupInStatement = ["rent", "utility"].includes(String(group.key || "").toLowerCase());

    const leg = await postEntry({
      business: payment.business,
      property: propertyId,
      landlord: landlordId,
      tenant: payment.tenant || null,
      unit: payment.unit || null,
      sourceTransactionType: "rent_payment",
      sourceTransactionId: String(payment._id),
      transactionDate: txDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category,
      amount: group.total,
      direction: "credit",
      debit: 0,
      credit: group.total,
      accountId: creditAccount._id,
      journalGroupId,
      payer: "tenant",
      receiver,
      notes: `Direct-to-landlord receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
      metadata: {
        includeInLandlordStatement: includeInStatement && includeGroupInStatement,
        includeInCategoryTotals: includeInStatement && includeGroupInStatement,
        postingRole,
        paymentType: getPrimaryPaymentTypeFromAllocations(payment),
        paymentMethod: payment.paymentMethod,
        cashbook: null,
        paidDirectToLandlord: true,
        ledgerType: "receipts",
        receiptNumber: payment.receiptNumber || null,
        referenceNumber: payment.referenceNumber || null,
        allocationGroup: group.key,
        allocationSummary: payment.allocationSummary || {},
        allocations: group.rows,
      },
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: new Date(),
      status: "approved",
    });

    creditLegEntries.push(leg);
  }

  const balancingLeg = await postEntry({
    business: payment.business,
    property: propertyId,
    landlord: landlordId,
    tenant: payment.tenant || null,
    unit: payment.unit || null,
    sourceTransactionType: "rent_payment",
    sourceTransactionId: String(payment._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "ADJUSTMENT",
    amount,
    direction: "debit",
    debit: amount,
    credit: 0,
    accountId: remittanceAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver,
    notes: `Direct-to-landlord settlement leg for receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
    metadata: {
      includeInLandlordStatement: false,
      includeInCategoryTotals: false,
      postingRole: "landlord_settlement",
      paymentType: getPrimaryPaymentTypeFromAllocations(payment),
      paymentMethod: payment.paymentMethod,
      cashbook: null,
      paidDirectToLandlord: true,
      ledgerType: "receipts",
      receiptNumber: payment.receiptNumber || null,
      referenceNumber: payment.referenceNumber || null,
      allocationSummary: payment.allocationSummary || {},
      offsetOfEntryIds: creditLegEntries.map((entry) => String(entry._id)),
    },
    createdBy: actorId,
    approvedBy: actorId,
    approvedAt: new Date(),
    status: "approved",
  });

  payment.journalGroupId = journalGroupId;
  payment.ledgerEntries = [...creditLegEntries.map((entry) => entry._id), balancingLeg._id];
  payment.postingStatus = "posted";
  payment.postingError = null;
  await payment.save();

  return {
    journalGroupId,
    entries: [...creditLegEntries, balancingLeg],
  };
};

const postReceiptJournal = async (payment, actorId) => {
  const amount = Math.abs(Number(payment.amount || 0));
  if (amount <= 0) {
    throw new Error("Receipt amount must be greater than zero for ledger posting.");
  }

  const { propertyId, landlordId } = await resolvePropertyAndLandlord(payment);
  const balancingAccount = await resolveCashbookAccount(payment.business, payment);

  // Resolve property-specific receivable account for In-GL properties
  const propCtx = await resolvePropertyAccountingContext({
    propertyId,
    businessId: payment.business,
  }).catch(() => null);

  // Property GL — route to property ledger or mark not_applicable
  if (propCtx?.isPropertyGL) {
    if (propCtx.isPropertyLedgerActive) {
      try {
        const plAccounts = await resolvePropertyLedgerAccounts(payment.business);
        const totalAmt = Math.abs(Number(payment.amount || 0));
        if (plAccounts.receivables && totalAmt > 0) {
          await postPropertyLedgerEntry({
            businessId:      payment.business,
            propertyId,
            debitAccountId:  balancingAccount?._id || plAccounts.receivables,
            creditAccountId: plAccounts.receivables,
            amount:          totalAmt,
            date:            payment.paymentDate,
            narration:       `Receipt — ${payment.receiptNumber || payment.reference || ""}`.trim(),
            reference:       payment.receiptNumber || payment.reference || "",
            category:        "receipt",
            tenantId:        payment.tenant,
            paymentId:       payment._id,
          });
          payment.postingStatus = "posted";
          payment.postingError  = null;
        } else {
          payment.postingStatus = "not_applicable";
          payment.postingError  = "Property ledger accounts not configured";
        }
      } catch (plErr) {
        payment.postingStatus = "not_applicable";
        payment.postingError  = `Property ledger posting failed: ${plErr.message}`;
      }
    } else {
      payment.postingStatus = "not_applicable";
      payment.postingError  = null;
    }
    await payment.save();
    return { journalGroupId: null, entries: [] };
  }

  const propertyReceivableId = propCtx?.receivablesAccountId || null;

  const receiver = payment?.paidDirectToLandlord ? "landlord" : "manager";
  const { start, end } = getStatementPeriodFromPayment(payment);
  const txDate = normalizeDate(payment.paymentDate);
  const journalGroupId = new mongoose.Types.ObjectId();
  const includeInStatement = shouldIncludeInLandlordStatement(payment);
  const allocationRows = getReceiptAllocationRows(payment);
  const creditLegEntries = [];

  const postingGroups = [];
  const grouped = new Map();
  allocationRows.forEach((row) => {
    const key = getReceiptPostingBucketFromAllocationRow(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  ["rent", "deposit", "deposit_landlord", "utility", "late_penalty", "debit_note", "other"].forEach((key) => {
    const rows = grouped.get(key) || [];
    const total = rows.reduce((sum, row) => sum + Math.abs(Number(row?.appliedAmount || 0)), 0);
    if (total > 0) postingGroups.push({ key, total, rows });
  });

  const unappliedTotal = Math.abs(Number(payment?.allocationSummary?.unapplied || 0));
  if (unappliedTotal > 0) {
    postingGroups.push({ key: "unapplied", total: unappliedTotal, rows: [] });
  }

  if (postingGroups.length === 0 && amount > 0) {
    postingGroups.push({ key: "unapplied", total: amount, rows: [] });
  }

  const _normalGroupAccountMap = new Map(
    await Promise.all(
      [...new Set(postingGroups.map((g) => g.key))].map(async (key) => {
        // Special accounts are always resolved at business level
        if (key === "unapplied" || key === "deposit_landlord") {
          return [key, await resolveCreditAccountForAllocationGroup(payment.business, key)];
        }
        // All other groups clear tenant receivable — use property-specific account if available
        return [key, propertyReceivableId
          ? { _id: propertyReceivableId }
          : await resolveCreditAccountForAllocationGroup(payment.business, key)];
      })
    )
  );

  for (const group of postingGroups) {
    const category = getReceiptStatementCategoryForGroup(group.key, !!payment?.paidDirectToLandlord);
    const postingRole = getPostingRoleForAllocationGroup(group.key);
    const creditAccount = _normalGroupAccountMap.get(group.key);
    const includeGroupInStatement = ["rent", "utility"].includes(String(group.key || "").toLowerCase());

    const leg = await postEntry({
      business: payment.business,
      property: propertyId,
      landlord: landlordId,
      tenant: payment.tenant || null,
      unit: payment.unit || null,
      sourceTransactionType: "rent_payment",
      sourceTransactionId: String(payment._id),
      transactionDate: txDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category,
      amount: group.total,
      direction: "credit",
      debit: 0,
      credit: group.total,
      accountId: creditAccount._id,
      journalGroupId,
      payer: "tenant",
      receiver,
      notes: (() => {
        const bucketLabel = { rent: "Rent", deposit: "Deposit", deposit_landlord: "Deposit", utility: "Utility", late_penalty: "Penalty", debit_note: "Debit note", other: "Other", unapplied: "Unapplied" }[group.key] || "Payment";
        const ref = payment.referenceNumber ? ` [${payment.referenceNumber}]` : "";
        return `${bucketLabel} · ${payment.receiptNumber || payment.referenceNumber || "receipt"}${ref}`;
      })(),
      metadata: {
        includeInLandlordStatement: includeInStatement && includeGroupInStatement,
        includeInCategoryTotals: includeInStatement && includeGroupInStatement,
        postingRole,
        paymentType: getPrimaryPaymentTypeFromAllocations(payment),
        paymentMethod: payment.paymentMethod,
        cashbook: payment?.paidDirectToLandlord ? null : payment.cashbook || "",
        paidDirectToLandlord: !!payment.paidDirectToLandlord,
        ledgerType: "receipts",
        receiptNumber: payment.receiptNumber || null,
        referenceNumber: payment.referenceNumber || null,
        allocationGroup: group.key,
        allocationSummary: payment.allocationSummary || {},
        allocations: group.rows,
      },
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: new Date(),
      status: "approved",
    });

    creditLegEntries.push(leg);
  }

  const balancingLeg = await postEntry({
    business: payment.business,
    property: propertyId,
    landlord: landlordId,
    tenant: payment.tenant || null,
    unit: payment.unit || null,
    sourceTransactionType: "rent_payment",
    sourceTransactionId: String(payment._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: "ADJUSTMENT",
    amount,
    direction: "debit",
    debit: amount,
    credit: 0,
    accountId: balancingAccount._id,
    journalGroupId,
    payer: "tenant",
    receiver,
    notes: (() => {
      const num = payment.receiptNumber || payment.referenceNumber || "receipt";
      const ref = payment.referenceNumber ? ` [${payment.referenceNumber}]` : "";
      return payment?.paidDirectToLandlord
        ? `Direct payout · ${num}${ref}`
        : `Cashbook · ${num}${ref}`;
    })(),
    metadata: {
      includeInLandlordStatement: false,
      includeInCategoryTotals: false,
      postingRole: payment?.paidDirectToLandlord ? "landlord_settlement" : "cashbook",
      paymentType: getPrimaryPaymentTypeFromAllocations(payment),
      paymentMethod: payment.paymentMethod,
      cashbook: payment?.paidDirectToLandlord ? null : payment.cashbook || "",
      paidDirectToLandlord: !!payment.paidDirectToLandlord,
      ledgerType: "receipts",
      receiptNumber: payment.receiptNumber || null,
      referenceNumber: payment.referenceNumber || null,
      allocationSummary: payment.allocationSummary || {},
      offsetOfEntryIds: creditLegEntries.map((entry) => String(entry._id)),
    },
    createdBy: actorId,
    approvedBy: actorId,
    approvedAt: new Date(),
    status: "approved",
  });

  payment.journalGroupId = journalGroupId;
  payment.ledgerEntries = [...creditLegEntries.map((entry) => entry._id), balancingLeg._id];
  payment.postingStatus = "posted";
  payment.postingError = null;
  await payment.save();

  return {
    journalGroupId,
    entries: [...creditLegEntries, balancingLeg],
  };
};

const reverseAllLedgerEntriesForPayment = async (payment, userId, reason) => {
  const originalEntries = await FinancialLedgerEntry.find({
    business: payment.business,
    sourceTransactionType: "rent_payment",
    sourceTransactionId: String(payment._id),
    status: "approved",
    category: { $ne: "REVERSAL" },
  }).lean();

  if (!originalEntries.length) {
    return [];
  }

  const reversalResults = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const entry of originalEntries) {
        if (entry.reversedByEntry || entry.status === "reversed") continue;
        const result = await postReversal({
          entryId: entry._id,
          reason: reason || "Payment reversed",
          userId,
          session,
        });
        reversalResults.push(result.reversalEntry);
      }
    });
  } finally {
    await session.endSession();
  }

  return reversalResults;
};

const rollbackFailedReceiptPosting = async ({ payment, actorId, reason = "" }) => {
  if (!payment?._id || !payment?.business) return [];

  try {
    const reversalEntries = await reverseAllLedgerEntriesForPayment(
      payment,
      actorId || null,
      reason || "Auto-reversal of incomplete receipt posting"
    );

    const touchedAccountIds = reversalEntries
      .map((entry) => entry?.accountId)
      .filter(Boolean);

    if (touchedAccountIds.length > 0) {
      await aggregateChartOfAccountBalances(payment.business, touchedAccountIds);
    }

    return reversalEntries;
  } catch (rollbackError) {
    console.error("Receipt posting rollback failed — voiding orphan entries directly:", rollbackError);

    // Reversal failed (e.g. account deactivated). Void any entries that were saved so they
    // are excluded from buildLedgerMap (which only includes "approved" and "reversed" status).
    try {
      await FinancialLedgerEntry.updateMany(
        {
          business: payment.business,
          sourceTransactionType: "rent_payment",
          sourceTransactionId: String(payment._id),
          status: "approved",
          category: { $ne: "REVERSAL" },
        },
        { $set: { status: "void" } }
      );
    } catch (voidError) {
      console.error("Failed to void orphan ledger entries after rollback failure:", voidError);
    }

    return [];
  }
};

const rollbackPostedAllocationReleaseEntries = async ({ entryIds = [], actorId = null, reason = "" }) => {
  const normalizedEntryIds = [...new Set((Array.isArray(entryIds) ? entryIds : []).filter(Boolean).map(String))];
  if (!normalizedEntryIds.length || !actorId) return [];

  const reversalEntries = [];
  for (const entryId of normalizedEntryIds) {
    try {
      const result = await postReversal({
        entryId,
        reason: reason || "Auto-reversal of incomplete unapplied receipt release",
        userId: actorId,
      });
      if (result?.reversalEntry) reversalEntries.push(result.reversalEntry);
    } catch (rollbackError) {
      console.error("Failed to rollback unapplied release ledger entry:", rollbackError);
    }
  }

  return reversalEntries;
};

// Auto-applies tagged prepayment lines from confirmed receipts to a newly-raised invoice.
// Called from createTenantInvoiceRecord after GL posting and before full recompute.
// Non-fatal: PMS allocation state is primary; GL release failure is logged but not thrown.
export const autoApplyPrepayments = async ({ businessId, tenantId, invoice, actorId = null }) => {
  const invoiceCategory = String(invoice.category || "").toUpperCase();
  if (!["RENT_CHARGE", "UTILITY_CHARGE"].includes(invoiceCategory)) return;

  const utType = normalizeUtilityMatch(invoice.metadata?.utilityType || "");
  const billItemKey = invoiceCategory === "RENT_CHARGE" ? "rent" : `utility:${utType}`;

  const receipts = await RentPayment.find({
    business: invoice.business,
    tenant: invoice.tenant,
    isConfirmed: true,
    isReversed: { $ne: true },
    isCancelled: { $ne: true },
    allocations: { $elemMatch: { invoice: null, isPrepayment: true, billItemKey } },
  }).sort({ paymentDate: 1, createdAt: 1 });

  if (!receipts.length) return;

  let remaining = round2(Math.max(0, Number(invoice.outstanding ?? invoice.amount ?? 0)));
  if (remaining <= 0) return;

  for (const receipt of receipts) {
    if (remaining <= 0) break;

    const matchingLines = receipt.allocations.filter(
      (a) => !a.invoice && a.isPrepayment && a.billItemKey === billItemKey && Number(a.appliedAmount || 0) > 0.005
    );
    if (!matchingLines.length) continue;

    const releaseRows = [];

    for (let i = matchingLines.length - 1; i >= 0; i--) {
      if (remaining <= 0) break;
      const line = matchingLines[i];
      const lineAmt = round2(Number(line.appliedAmount || 0));
      const applyAmt = round2(Math.min(lineAmt, remaining));

      // Remove original line and replace with reduced remainder (if any)
      const allocIdx = receipt.allocations.findIndex(
        (a) => a === line || (a._id && String(a._id) === String(line._id))
      );
      if (allocIdx !== -1) receipt.allocations.splice(allocIdx, 1);

      const leftover = round2(lineAmt - applyAmt);
      if (leftover > 0.005) {
        receipt.allocations.push({
          invoice: null, invoiceNumber: "",
          category: line.category, priorityGroup: line.priorityGroup,
          utilityType: line.utilityType || "", billItemKey: line.billItemKey,
          prepaymentLabel: line.prepaymentLabel, isPrepayment: true,
          appliedAmount: leftover, beforeOutstanding: 0, afterOutstanding: 0,
          description: line.description || line.prepaymentLabel || "Prepayment",
          metadata: line.metadata || {},
        });
      }

      const beforeOutstanding = remaining;
      const afterOutstanding = round2(Math.max(0, remaining - applyAmt));

      receipt.allocations.push({
        invoice: invoice._id,
        invoiceNumber: invoice.invoiceNumber || "",
        category: invoiceCategory,
        priorityGroup: invoiceCategory === "RENT_CHARGE" ? "rent" : "utility",
        utilityType: utType || "",
        appliedAmount: applyAmt,
        beforeOutstanding,
        afterOutstanding,
        invoiceDate: invoice.invoiceDate || null,
        dueDate: invoice.dueDate || null,
        description: invoice.description || "",
        metadata: { autoPrepaymentApply: true, billItemKey },
      });

      releaseRows.push({
        invoice: invoice._id, invoiceNumber: invoice.invoiceNumber || "",
        category: invoiceCategory,
        priorityGroup: invoiceCategory === "RENT_CHARGE" ? "rent" : "utility",
        utilityType: utType || "", appliedAmount: applyAmt,
        beforeOutstanding, afterOutstanding,
      });

      remaining = afterOutstanding;
    }

    if (!releaseRows.length) continue;

    // Rebuild allocationSummary from new allocations array
    const summary = { rent: 0, deposit: 0, utility: 0, latePenalty: 0, debitNote: 0, other: 0, unapplied: 0 };
    for (const a of receipt.allocations) {
      const key = a.invoice ? (CATEGORY_TO_SUMMARY[a.category] || "other") : "unapplied";
      summary[key] = round2(summary[key] + Number(a.appliedAmount || 0));
    }
    receipt.allocationSummary = summary;
    receipt.markModified("allocations");
    receipt.markModified("allocationSummary");
    await receipt.save();

    // Post GL release journal — non-fatal
    if (receipt.journalGroupId && actorId) {
      try {
        await postReceiptUnappliedAllocationReleaseJournal({
          payment: receipt,
          releaseRows,
          actorId,
          reason: `Auto-applied prepayment to invoice ${invoice.invoiceNumber || invoice._id}`,
        });
      } catch (glErr) {
        console.error("[autoApplyPrepayments] GL release failed:", glErr.message);
      }
    }
  }

  // Update invoice outstanding in-memory — caller's recomputeTenantFinancialState persists it via full replay
  invoice.outstanding = remaining;
  invoice.status = remaining <= 0 ? "paid" : remaining < Number(invoice.amount) ? "partially_paid" : "pending";
};

export const postReceiptUnappliedAllocationReleaseJournal = async ({
  payment,
  releaseRows = [],
  actorId,
  reason = "",
  session = null,
}) => {
  const rows = Array.isArray(releaseRows)
    ? releaseRows
        .map((row) => ({
          ...row,
          appliedAmount: round2(Math.abs(Number(row?.appliedAmount || 0))),
        }))
        .filter((row) => row?.invoice && Number(row?.appliedAmount || 0) > 0)
    : [];

  if (!rows.length) {
    return { journalGroupId: null, entries: [], touchedAccountIds: [] };
  }

  if (!actorId) {
    throw new Error("A valid actor is required to release confirmed receipt prepayments into tenant charges.");
  }

  const releaseTotal = round2(rows.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
  if (releaseTotal <= 0) {
    return { journalGroupId: null, entries: [], touchedAccountIds: [] };
  }

  const { propertyId, landlordId } = await resolvePropertyAndLandlord(payment);
  const receiver = payment?.paidDirectToLandlord ? "landlord" : "manager";
  const transactionDate = new Date();
  const { start, end } = getStatementPeriodFromPayment({
    ...payment,
    paymentDate: transactionDate,
  });
  const journalGroupId = new mongoose.Types.ObjectId();
  const releaseAccount = await resolveUnallocatedReceiptsLiabilityAccount(payment.business);
  const grouped = new Map();

  rows.forEach((row) => {
    const key = getReceiptPostingBucketFromAllocationRow(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const postingGroups = [];
  ["rent", "deposit", "deposit_landlord", "utility", "late_penalty", "debit_note", "other"].forEach((key) => {
    const groupedRows = grouped.get(key) || [];
    const total = round2(groupedRows.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
    if (total > 0) postingGroups.push({ key, total, rows: groupedRows });
  });

  const createdEntries = [];
  const touchedAccountIds = new Set();

  const createEntries = async () => {
    const debitLeg = await postEntry({
      session,
      business: payment.business,
      property: propertyId,
      landlord: landlordId,
      tenant: payment.tenant || null,
      unit: payment.unit || null,
      sourceTransactionType: "rent_payment",
      sourceTransactionId: String(payment._id),
      transactionDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: "ADJUSTMENT",
      amount: releaseTotal,
      direction: "debit",
      debit: releaseTotal,
      credit: 0,
      accountId: releaseAccount._id,
      journalGroupId,
      payer: "tenant",
      receiver,
      notes: `Apply unapplied balance from receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
      metadata: {
        includeInLandlordStatement: false,
        includeInCategoryTotals: false,
        postingRole: "tenant_advance_release",
        paymentType: getPrimaryPaymentTypeFromAllocations(payment),
        paymentMethod: payment.paymentMethod,
        cashbook: payment?.paidDirectToLandlord ? null : payment.cashbook || "",
        paidDirectToLandlord: !!payment.paidDirectToLandlord,
        ledgerType: "receipts",
        receiptNumber: payment.receiptNumber || null,
        referenceNumber: payment.referenceNumber || null,
        allocationRelease: true,
        releaseReason: reason || "Apply unapplied receipt balance to tenant charges",
        releasedAmount: releaseTotal,
        allocations: rows,
      },
      createdBy: actorId,
      approvedBy: actorId,
      approvedAt: new Date(),
      status: "approved",
    });

    createdEntries.push(debitLeg);
    if (debitLeg?.accountId) touchedAccountIds.add(String(debitLeg.accountId));

    const _releaseGroupAccountMap = new Map(
      await Promise.all(
        [...new Set(postingGroups.map((g) => g.key))].map(async (key) => [
          key, await resolveCreditAccountForAllocationGroup(payment.business, key),
        ])
      )
    );

    for (const group of postingGroups) {
      const creditAccount = _releaseGroupAccountMap.get(group.key);
      const leg = await postEntry({
        session,
        business: payment.business,
        property: propertyId,
        landlord: landlordId,
        tenant: payment.tenant || null,
        unit: payment.unit || null,
        sourceTransactionType: "rent_payment",
        sourceTransactionId: String(payment._id),
        transactionDate,
        statementPeriodStart: start,
        statementPeriodEnd: end,
        category: "ADJUSTMENT",
        amount: group.total,
        direction: "credit",
        debit: 0,
        credit: group.total,
        accountId: creditAccount._id,
        journalGroupId,
        payer: "tenant",
        receiver,
        notes: `Release unapplied balance from receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
        metadata: {
          includeInLandlordStatement: false,
          includeInCategoryTotals: false,
          postingRole: `tenant_advance_release_${String(group.key || 'other').toLowerCase()}`,
          paymentType: getPrimaryPaymentTypeFromAllocations(payment),
          paymentMethod: payment.paymentMethod,
          cashbook: payment?.paidDirectToLandlord ? null : payment.cashbook || "",
          paidDirectToLandlord: !!payment.paidDirectToLandlord,
          ledgerType: "receipts",
          receiptNumber: payment.receiptNumber || null,
          referenceNumber: payment.referenceNumber || null,
          allocationGroup: group.key,
          allocationRelease: true,
          releaseReason: reason || "Apply unapplied receipt balance to tenant charges",
          releasedAmount: group.total,
          allocations: group.rows,
        },
        createdBy: actorId,
        approvedBy: actorId,
        approvedAt: new Date(),
        status: "approved",
      });

      createdEntries.push(leg);
      if (leg?.accountId) touchedAccountIds.add(String(leg.accountId));
    }
  };

  if (session) {
    await createEntries();
  } else {
    try {
      await createEntries();
    } catch (postingError) {
      await rollbackPostedAllocationReleaseEntries({
        entryIds: createdEntries.map((entry) => entry?._id).filter(Boolean),
        actorId,
        reason: `Auto-reversal of incomplete unapplied release for receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
      });
      throw postingError;
    }
  }

  return {
    journalGroupId,
    entries: createdEntries,
    touchedAccountIds: [...touchedAccountIds],
  };
};

export const createPayment = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId || !isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: "Valid business is required to create a receipt." });
    }

    const tenantId = req.body?.tenant;
    const unitId = req.body?.unit;
    if (!isValidObjectId(tenantId) || !isValidObjectId(unitId)) {
      return res.status(400).json({ success: false, message: "Valid tenant and unit are required." });
    }

    // Derive all req.body values synchronously — before any async work
    const baseMetadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    const isTakeOnCredit = isTakeOnCreditReceipt({ metadata: baseMetadata });
    const isConfirmedOnCreate = req.body?.isConfirmed === true;
    const isDirectToLandlord = req.body?.paidDirectToLandlord === true;
    const refNumber = String(req.body?.referenceNumber || "").trim();
    const normalizedCashbook = isDirectToLandlord || isTakeOnCredit ? "" : String(req.body?.cashbook || "").trim();
    const useManualAllocations =
      String(req.body?.allocationMode || "").trim().toLowerCase() === "manual" ||
      Array.isArray(req.body?.allocations);
    const metadata = { ...baseMetadata, allocationMode: useManualAllocations ? "manual" : "auto" };
    const providedReceiptNumber = String(req.body?.receiptNumber || "").trim();

    // Non-DB validations first — fail fast before hitting the database
    if (!refNumber) {
      return res.status(400).json({ success: false, message: "Reference number is required for tenant receipts." });
    }
    if (!isDirectToLandlord && !isTakeOnCredit && !normalizedCashbook) {
      return res.status(400).json({ success: false, message: "Cashbook is required unless this receipt was paid directly to the landlord." });
    }
    if (isTakeOnCredit && !isConfirmedOnCreate) {
      return res.status(400).json({ success: false, message: "Credit take-on balances must be saved as confirmed receipts so the opening balance posting stays auditable." });
    }

    // Phase 1: parallel — tenant lookup, unit lookup, duplicate ref check
    const [tenant, unit, duplicateRef] = await Promise.all([
      Tenant.findOne({ _id: tenantId, business: businessId }).select("_id unit business depositHeldBy").lean(),
      Unit.findOne({ _id: unitId, business: businessId }).select("_id property business").lean(),
      RentPayment.findOne({ business: businessId, referenceNumber: refNumber }).lean(),
    ]);

    if (!tenant) return res.status(404).json({ success: false, message: "Tenant not found for the selected company." });
    if (!unit) return res.status(404).json({ success: false, message: "Unit not found for the selected company." });
    if (String(tenant.unit) !== String(unit._id)) {
      return res.status(400).json({ success: false, message: "Selected tenant does not belong to the selected unit." });
    }
    if (duplicateRef) {
      return res.status(400).json({ success: false, message: "Reference number already exists in this company." });
    }

    // resolveActorUserId throws with a user-facing message — keep its own try/catch
    let actorUserId = null;
    if (isConfirmedOnCreate) {
      try {
        actorUserId = await resolveActorUserId({
          req,
          business: businessId,
          fallbackUserId: req.body?.confirmedBy || req.body?.createdBy || null,
        });
      } catch (actorError) {
        return res.status(400).json({ success: false, message: actorError.message });
      }
    }

    // Phase 2: parallel — allocation data, property fetch, receipt number generation
    const [allocationData, property, autoReceiptNumber] = await Promise.all([
      useManualAllocations
        ? buildManualReceiptAllocationData({
            payment: { business: businessId, tenant: tenantId, amount: req.body?.amount, paymentType: req.body?.paymentType, metadata, isConfirmed: false, postingStatus: "unposted" },
            requestedAllocations: req.body?.allocations,
          })
        : buildReceiptAllocationData({
            businessId,
            tenantId,
            amount: req.body?.amount,
            paymentTypeOverride: isTakeOnCredit ? (metadata?.paymentType || req.body?.paymentType || "") : "",
            metadata,
            prepaymentLines: Array.isArray(req.body?.prepaymentLines) ? req.body.prepaymentLines : [],
          }),
      unit?.property
        ? Property.findOne({ _id: unit.property, business: businessId }).select("_id depositHeldBy").lean()
        : Promise.resolve(null),
      !providedReceiptNumber ? generateReceiptNumber(businessId) : Promise.resolve(null),
    ]);

    let receiptNumber = providedReceiptNumber || autoReceiptNumber;
    // Provided receipt numbers are uncommon — check dup only when supplied
    if (providedReceiptNumber) {
      const duplicateReceipt = await RentPayment.findOne({ business: businessId, receiptNumber: providedReceiptNumber }).lean();
      if (duplicateReceipt) {
        return res.status(400).json({ success: false, message: "Receipt number already exists in this company." });
      }
    }

    const depositContext = buildResolvedDepositMetadata({
      tenant,
      property,
      metadata,
      paymentType: allocationData.primaryPaymentType || req.body?.paymentType || "",
      allocationData,
    });

    const payment = new RentPayment({
      ...req.body,
      tenant: tenantId,
      unit: unitId,
      cashbook: normalizedCashbook,
      paidDirectToLandlord: isDirectToLandlord,
      paymentType: allocationData.primaryPaymentType,
      breakdown: allocationData.breakdown,
      allocations: depositContext.allocations,
      allocationSummary: allocationData.allocationSummary,
      ledgerType: "receipts",
      referenceNumber: refNumber,
      receiptNumber,
      bankingDate: req.body?.bankingDate || req.body?.paymentDate,
      recordDate: req.body?.recordDate || new Date(),
      business: businessId,
      isConfirmed: isConfirmedOnCreate,
      confirmedBy: isConfirmedOnCreate ? actorUserId : null,
      confirmedAt: isConfirmedOnCreate ? new Date() : null,
      postingStatus: "unposted",
      postingError: null,
      ledgerEntries: [],
      metadata: depositContext.metadata,
    });

    const savedPayment = await payment.save();

    if (savedPayment.isConfirmed) {
      try {
        const posting = savedPayment.paidDirectToLandlord
          ? await confirmNonCashDirectToLandlordReceipt(savedPayment, actorUserId)
          : await postReceiptJournal(savedPayment, actorUserId);

        // Fast incremental balance update, then parallel full recompute + chart account aggregate
        await applyIncrementalBalanceDelta({ tenantId: savedPayment.tenant, businessId: savedPayment.business, delta: -Math.abs(Number(savedPayment.amount || 0)) });
        await Promise.all([
          recomputeTenantBalance(savedPayment.tenant, savedPayment.business),
          posting.entries?.length
            ? aggregateChartOfAccountBalances(savedPayment.business, posting.entries.map((e) => e.accountId))
            : Promise.resolve(),
        ]);
      } catch (postingError) {
        const rollbackEntries = await rollbackFailedReceiptPosting({
          payment: savedPayment,
          actorId: actorUserId,
          reason: `Auto-reversal of incomplete posting for receipt ${savedPayment.receiptNumber || savedPayment.referenceNumber || savedPayment._id}`,
        });

        await RentPayment.findByIdAndUpdate(savedPayment._id, {
          $set: {
            isConfirmed: false,
            confirmedBy: null,
            confirmedAt: null,
            postingStatus: "failed",
            postingError: postingError.message || "Ledger posting failed on create",
            journalGroupId: null,
            ledgerEntries: [],
          },
        });

        try {
          await Promise.all([
            recomputeTenantBalance(savedPayment.tenant, savedPayment.business),
            rollbackEntries.length > 0
              ? aggregateChartOfAccountBalances(savedPayment.business, rollbackEntries.map((e) => e?.accountId).filter(Boolean))
              : Promise.resolve(),
          ]);
        } catch (recoveryError) {
          console.error("Failed to recompute receipt state after create-posting rollback:", recoveryError);
        }

        return res.status(500).json({
          success: false,
          message: `Receipt was saved but confirmation posting failed: ${postingError.message}`,
        });
      }
    }

    emitToCompany(businessId, "payment:new", savedPayment);

    const populated = await populateReceiptQuery(RentPayment.findById(savedPayment._id));
    return res.status(200).json(populated);
  } catch (err) {
    if (err?.code === 11000) {
      const duplicateFields = Object.keys(err.keyPattern || {});
      if (duplicateFields.includes("referenceNumber")) {
        return res.status(400).json({ success: false, message: "Reference number already exists in this company." });
      }
      if (duplicateFields.includes("receiptNumber")) {
        return res.status(400).json({ success: false, message: "Receipt number already exists in this company." });
      }
    }
    return next(err);
  }
};

/**
 * POST /api/rent-payments/batch
 * Create up to 100 receipts in one request. Each item succeeds or fails
 * independently — a single bad row never aborts the whole batch.
 *
 * Body:
 *   {
 *     business?: ObjectId,        // fallback to req.user.company
 *     cashbook: string,           // shared default (overridable per item)
 *     paymentMethod: string,      // shared default
 *     paymentDate: Date,          // shared default
 *     month: number,              // shared default
 *     year: number,               // shared default
 *     isConfirmed?: boolean,      // default true
 *     items: [{
 *       tenant: ObjectId,
 *       unit: ObjectId,
 *       amount: number,
 *       referenceNumber: string,
 *       cashbook?: string,        // per-item override
 *       paymentMethod?: string,
 *       paymentDate?: Date,
 *       month?: number,
 *       year?: number,
 *       description?: string,
 *       collectionId?: ObjectId,  // MpesaCollection to mark as captured
 *     }]
 *   }
 */
export const batchCreatePayments = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId || !isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: "Valid business is required." });
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: "No items provided in the batch." });
    }
    if (items.length > 100) {
      return res.status(400).json({ success: false, message: "Batch limit is 100 receipts per request." });
    }

    // Shared defaults (each item can override individually)
    const sharedCashbook            = String(req.body?.cashbook || "").trim();
    const sharedMethod              = String(req.body?.paymentMethod || "mobile_money");
    const sharedPaymentDate         = req.body?.paymentDate;
    const sharedMonth               = req.body?.month;
    const sharedYear                = req.body?.year;
    const sharedPaidDirectToLandlord = req.body?.paidDirectToLandlord === true;
    const isConfirmedOnCreate        = req.body?.isConfirmed !== false; // default true for batch

    // Validate: catch within-batch duplicate refNumbers early
    const batchRefs = items.map((it) => String(it?.referenceNumber || "").trim()).filter(Boolean);
    if (new Set(batchRefs).size !== batchRefs.length) {
      return res.status(400).json({ success: false, message: "Batch contains duplicate reference numbers." });
    }

    // Resolve actor and shared cashbook account once for the whole batch
    let actorUserId = null;
    if (isConfirmedOnCreate) {
      try {
        actorUserId = await resolveActorUserId({ req, business: businessId });
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
    }

    let sharedCashbookAccount = null;
    if (!sharedPaidDirectToLandlord && sharedCashbook && isConfirmedOnCreate) {
      try {
        sharedCashbookAccount = await resolveCashbookAccount(businessId, {
          cashbook: sharedCashbook,
          paymentMethod: sharedMethod,
          paidDirectToLandlord: false,
        });
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
    }

    // One query to find all ref-number conflicts in the DB at once
    const existingRefs = await RentPayment.find(
      { business: businessId, referenceNumber: { $in: batchRefs } },
      { referenceNumber: 1 }
    ).lean();
    const usedRefSet = new Set(existingRefs.map((p) => p.referenceNumber));

    // Atomically reserve N receipt numbers in one findOneAndUpdate
    const counter = await SequenceCounter.findOneAndUpdate(
      { business: String(businessId), key: "rent_receipt" },
      { $inc: { sequence: items.length } },
      { upsert: true, new: true }
    ).lean();
    const firstSeq = counter.sequence - items.length + 1;
    const receiptNumbers = items.map((_, i) => `REC${String(firstSeq + i).padStart(5, "0")}`);

    // Process each item sequentially (preserves invoice-snapshot accuracy for same-tenant items)
    const succeeded = [];
    const failed    = [];
    const tenantDeltas      = new Map(); // tenantId → cumulative negative delta
    const affectedAccountIds = new Set();
    const capturedCollections = [];    // { collectionId, receiptId, tenantId }

    for (let i = 0; i < items.length; i++) {
      const item          = items[i];
      const receiptNumber = receiptNumbers[i];

      try {
        const tenantId  = item?.tenant;
        const unitId    = item?.unit;
        const refNumber = String(item?.referenceNumber || "").trim();
        const itemAmount  = Number(item?.amount || 0);
        const itemCashbook = String(item?.cashbook || sharedCashbook).trim();
        const itemMethod   = String(item?.paymentMethod || sharedMethod);
        const itemDate     = item?.paymentDate || sharedPaymentDate;
        const itemMonth    = item?.month != null ? Number(item.month) : (sharedMonth != null ? Number(sharedMonth) : undefined);
        const itemYear     = item?.year  != null ? Number(item.year)  : (sharedYear  != null ? Number(sharedYear)  : undefined);
        const collectionId = item?.collectionId && isValidObjectId(item.collectionId) ? item.collectionId : null;
        const itemPaidDirectToLandlord = item?.paidDirectToLandlord != null
          ? item.paidDirectToLandlord === true
          : sharedPaidDirectToLandlord;

        if (!isValidObjectId(tenantId) || !isValidObjectId(unitId)) {
          throw Object.assign(new Error("Valid tenant and unit are required."), { statusCode: 400 });
        }
        if (!refNumber) {
          throw Object.assign(new Error("Reference number is required."), { statusCode: 400 });
        }
        if (itemAmount <= 0) {
          throw Object.assign(new Error("Amount must be greater than 0."), { statusCode: 400 });
        }
        if (!itemPaidDirectToLandlord && !itemCashbook) {
          throw Object.assign(new Error("Cashbook is required."), { statusCode: 400 });
        }
        if (usedRefSet.has(refNumber)) {
          throw Object.assign(new Error(`Reference number "${refNumber}" already exists.`), { statusCode: 400 });
        }

        // Tenant + unit lookup in parallel
        const [tenant, unit] = await Promise.all([
          Tenant.findOne({ _id: tenantId, business: businessId }).select("_id unit business depositHeldBy").lean(),
          Unit.findOne({ _id: unitId, business: businessId }).select("_id property business").lean(),
        ]);

        if (!tenant) throw Object.assign(new Error("Tenant not found."), { statusCode: 404 });
        if (!unit)   throw Object.assign(new Error("Unit not found."), { statusCode: 404 });
        if (String(tenant.unit) !== String(unit._id)) {
          throw Object.assign(new Error("Tenant does not belong to the selected unit."), { statusCode: 400 });
        }

        // Allocation + property in parallel
        const baseMetadata = { allocationMode: "auto" };
        const [allocationData, property] = await Promise.all([
          buildReceiptAllocationData({
            businessId,
            tenantId,
            amount: itemAmount,
            metadata: baseMetadata,
            prepaymentLines: [],
          }),
          unit.property
            ? Property.findOne({ _id: unit.property, business: businessId }).select("_id depositHeldBy").lean()
            : Promise.resolve(null),
        ]);

        const depositContext = buildResolvedDepositMetadata({
          tenant,
          property,
          metadata: baseMetadata,
          paymentType: allocationData.primaryPaymentType,
          allocationData,
        });

        // Reuse shared cashbook account when possible; resolve fresh only on per-item override
        let cashbookAccount = sharedCashbookAccount;
        if (!itemPaidDirectToLandlord && (!cashbookAccount || itemCashbook !== sharedCashbook)) {
          cashbookAccount = await resolveCashbookAccount(businessId, {
            cashbook: itemCashbook,
            paymentMethod: itemMethod,
            paidDirectToLandlord: false,
          });
        }

        const paymentDate = normalizeDate(itemDate);
        const month = itemMonth || (paymentDate.getMonth() + 1);
        const year  = itemYear  || paymentDate.getFullYear();

        const mpesaMeta = collectionId
          ? { mpesa: { collectionId: String(collectionId), transactionCode: refNumber, source: "batch_receipt" } }
          : {};

        const payment = new RentPayment({
          business:          businessId,
          tenant:            tenantId,
          unit:              unitId,
          cashbook:          itemPaidDirectToLandlord ? "" : itemCashbook,
          paidDirectToLandlord: itemPaidDirectToLandlord,
          paymentType:       allocationData.primaryPaymentType,
          breakdown:         allocationData.breakdown,
          allocations:       depositContext.allocations,
          allocationSummary: allocationData.allocationSummary,
          ledgerType:        "receipts",
          referenceNumber:   refNumber,
          receiptNumber,
          paymentDate,
          paymentMethod:     itemMethod,
          bankingDate:       paymentDate,
          recordDate:        new Date(),
          month,
          year,
          description:       item?.description || item?.notes || "",
          isConfirmed:       isConfirmedOnCreate,
          confirmedBy:       isConfirmedOnCreate ? actorUserId : null,
          confirmedAt:       isConfirmedOnCreate ? new Date() : null,
          postingStatus:     "unposted",
          postingError:      null,
          ledgerEntries:     [],
          metadata:          { ...depositContext.metadata, ...mpesaMeta },
        });

        const savedPayment = await payment.save();
        usedRefSet.add(refNumber); // prevent subsequent items in the same batch from reusing it

        if (savedPayment.isConfirmed) {
          const posting = itemPaidDirectToLandlord
            ? await confirmNonCashDirectToLandlordReceipt(savedPayment, actorUserId)
            : await postReceiptJournal(savedPayment, actorUserId);
          (posting.entries || []).forEach((e) => {
            if (e?.accountId) affectedAccountIds.add(String(e.accountId));
          });
        }

        // Accumulate per-tenant balance delta (deferred to batch end)
        const tKey = String(tenantId);
        tenantDeltas.set(tKey, round2((tenantDeltas.get(tKey) || 0) - Math.abs(itemAmount)));

        if (collectionId) {
          capturedCollections.push({ collectionId, receiptId: savedPayment._id, tenantId: tKey });
        }

        succeeded.push({
          index:           i,
          receiptId:       String(savedPayment._id),
          receiptNumber:   savedPayment.receiptNumber,
          referenceNumber: refNumber,
          amount:          itemAmount,
          tenantId:        tKey,
          tenantName:      tenant?.name || "",
        });
      } catch (itemErr) {
        failed.push({
          index:           i,
          referenceNumber: String(items[i]?.referenceNumber || ""),
          tenantId:        String(items[i]?.tenant || ""),
          error:           itemErr.message || "Unknown error",
        });
      }
    }

    // Batch post-processing — all in parallel after the loop
    await Promise.all([
      // Recompute all touched tenant balances concurrently
      ...[...tenantDeltas.keys()].map((tenantId) =>
        recomputeTenantBalance(tenantId, businessId).catch((err) =>
          console.error(`[batchReceipts] recompute failed for tenant ${tenantId}:`, err)
        )
      ),
      // One aggregation call for all touched GL accounts
      affectedAccountIds.size > 0
        ? aggregateChartOfAccountBalances(businessId, [...affectedAccountIds]).catch((err) =>
            console.error("[batchReceipts] chart account aggregation failed:", err)
          )
        : Promise.resolve(),
      // Mark MpesaCollection rows as captured in one bulkWrite
      capturedCollections.length > 0
        ? MpesaCollection.bulkWrite(
            capturedCollections.map(({ collectionId, receiptId, tenantId }) => ({
              updateOne: {
                filter: { _id: collectionId, business: businessId },
                update: { $set: { matchingStatus: "captured", matchedReceipt: receiptId, tenant: tenantId } },
              },
            }))
          ).catch((err) => console.error("[batchReceipts] MpesaCollection bulkWrite failed:", err))
        : Promise.resolve(),
    ]);

    if (succeeded.length > 0) {
      emitToCompany(businessId, "receipts:batch_posted", {
        count:       succeeded.length,
        totalAmount: succeeded.reduce((sum, s) => sum + (s.amount || 0), 0),
      });
    }

    return res.status(200).json({
      success:     true,
      succeeded,
      failed,
      totalPosted: succeeded.length,
      totalFailed: failed.length,
    });
  } catch (err) {
    return next(err);
  }
};

export const getPayments = async (req, res, next) => {
  const {
    tenant,
    unit,
    month,
    year,
    paymentType,
    ledger,
    page,
    limit,
    property,
    status,
    from,
    to,
    search,
    tenantSearch,
    paidDirectToLandlord,
    hasUnapplied,
    includeTotals,
  } = req.query;

  try {
    const business = resolveBusinessId(req);

    if (!business) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch receipts.",
      });
    }

    const requestedStatus =
      status === undefined || status === null || String(status).trim() === "" ? "active" : status;
    const normalizedStatus = safeLower(requestedStatus);
    const wantsPagedResponse = [
      page,
      limit,
      property,
      status,
      from,
      to,
      search,
      tenantSearch,
      paidDirectToLandlord,
      hasUnapplied,
      includeTotals,
    ].some((value) => value !== undefined && value !== null && String(value).trim() !== "");

    const filter = {
      business,
      ledgerType: "receipts",
      $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    };

    if (tenant) {
      if (isValidObjectId(tenant)) {
        filter.tenant = tenant;
      } else {
        const matchedTenants = await Tenant.find({
          business,
          name: { $regex: new RegExp(`^${escapeRegExp(String(tenant))}$`, "i") },
        })
          .select("_id")
          .lean();
        filter.tenant = { $in: matchedTenants.map((row) => row._id) };
      }
    }

    let scopedPropertyIds = [];
    if (property) {
      const propertyQuery = { business };
      if (isValidObjectId(property)) {
        propertyQuery._id = property;
      } else {
        propertyQuery.propertyName = {
          $regex: new RegExp(`^${escapeRegExp(String(property))}$`, "i"),
        };
      }
      const matchedProperties = await Property.find(propertyQuery).select("_id").lean();
      scopedPropertyIds = matchedProperties.map((row) => row._id);
      if (scopedPropertyIds.length === 0) {
        return res.status(200).json(
          wantsPagedResponse
            ? {
                items: [],
                pagination: {
                  page: Math.max(1, Number.parseInt(page || "1", 10) || 1),
                  limit: Math.max(1, Number.parseInt(limit || "50", 10) || 50),
                  totalItems: 0,
                  totalPages: 1,
                  hasPreviousPage: false,
                  hasNextPage: false,
                },
              }
            : []
        );
      }
    }

    if (unit || scopedPropertyIds.length > 0) {
      const unitQuery = { business };
      if (scopedPropertyIds.length > 0) {
        unitQuery.property = { $in: scopedPropertyIds };
      }
      if (unit) {
        if (isValidObjectId(unit)) {
          unitQuery._id = unit;
        } else {
          unitQuery.unitNumber = {
            $regex: new RegExp(`^${escapeRegExp(String(unit))}$`, "i"),
          };
        }
      }
      const matchedUnits = await Unit.find(unitQuery).select("_id").lean();
      filter.unit = { $in: matchedUnits.map((row) => row._id) };
    }

    if (month) filter.month = parseInt(month, 10);
    if (year) filter.year = parseInt(year, 10);
    if (paymentType) filter.paymentType = paymentType;
    if (ledger && ledger === "receipts") filter.ledgerType = "receipts";
    if (paidDirectToLandlord !== undefined && paidDirectToLandlord !== "") {
      filter.paidDirectToLandlord = String(paidDirectToLandlord).toLowerCase() === "true";
    }
    if (String(hasUnapplied || "").toLowerCase() === "true") {
      filter["allocationSummary.unapplied"] = { $gt: 0 };
    }

    if (from || to) {
      const paymentDate = {};
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) {
          fromDate.setHours(0, 0, 0, 0);
          paymentDate.$gte = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          paymentDate.$lte = toDate;
        }
      }
      if (Object.keys(paymentDate).length > 0) {
        filter.paymentDate = paymentDate;
      }
    }

    if (["active", "confirmed", "pending", "failed"].includes(normalizedStatus)) {
      filter.isCancelled = { $ne: true };
      filter.isReversed = { $ne: true };
    }

    if (normalizedStatus === "active") {
      filter.postingStatus = { $ne: "failed" };
    } else if (normalizedStatus === "confirmed") {
      filter.isConfirmed = true;
      filter.postingStatus = { $ne: "failed" };
    } else if (normalizedStatus === "pending") {
      filter.isConfirmed = { $ne: true };
      filter.postingStatus = { $ne: "failed" };
    } else if (normalizedStatus === "failed") {
      filter.postingStatus = "failed";
    } else if (normalizedStatus === "reversed") {
      filter.isCancelled = { $ne: true };
      filter.isReversed = true;
    }

    const searchRegex = search ? new RegExp(escapeRegExp(String(search)), "i") : null;
    const tenantSearchRegex = tenantSearch ? new RegExp(escapeRegExp(String(tenantSearch)), "i") : null;
    const tenantIdsForSearch = [];

    if (tenantSearchRegex || searchRegex) {
      const tenantOr = [];
      if (tenantSearchRegex) tenantOr.push({ name: tenantSearchRegex });
      if (searchRegex) tenantOr.push({ name: searchRegex });
      if (tenantOr.length > 0) {
        const matchedTenants = await Tenant.find({ business, $or: tenantOr }).select("_id").lean();
        tenantIdsForSearch.push(...matchedTenants.map((row) => row._id));
      }
    }

    const orFilters = [];
    if (searchRegex) {
      orFilters.push({ receiptNumber: searchRegex });
      orFilters.push({ referenceNumber: searchRegex });
      orFilters.push({ description: searchRegex });
    }
    if (tenantIdsForSearch.length > 0) {
      orFilters.push({ tenant: { $in: tenantIdsForSearch } });
    }
    if (orFilters.length > 0) {
      filter.$and = [...(Array.isArray(filter.$and) ? filter.$and : []), { $or: orFilters }];
    }

    const query = RentPayment.find(filter).sort({ paymentDate: -1, createdAt: -1 });

    if (!wantsPagedResponse) {
      const payments = await populateReceiptListQuery(query);
      return res.status(200).json(payments);
    }

    const parsedPage = Math.max(1, Number.parseInt(page || "1", 10) || 1);
    const parsedLimit = Math.min(200, Math.max(1, Number.parseInt(limit || "50", 10) || 50));
    const [totalItems, items] = await Promise.all([
      RentPayment.countDocuments(filter),
      populateReceiptListQuery(query.clone().skip((parsedPage - 1) * parsedLimit).limit(parsedLimit)),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalItems / parsedLimit));
    const safePage = Math.min(parsedPage, totalPages);

    let summary = null;
    if (String(includeTotals || "").toLowerCase() === "true") {
      const aggregateFilter = {
        ...filter,
        business: isValidObjectId(business) ? new mongoose.Types.ObjectId(String(business)) : business,
      };

      const [totalsRow] = await RentPayment.aggregate([
        { $match: aggregateFilter },
        {
          $group: {
            _id: null,
            rowCount: { $sum: 1 },
            totalReceiptAmount: { $sum: { $abs: { $ifNull: ["$amount", 0] } } },
            totalUnapplied: { $sum: { $abs: { $ifNull: ["$allocationSummary.unapplied", 0] } } },
            totalAllocated: {
              $sum: {
                $max: [
                  0,
                  {
                    $subtract: [
                      { $abs: { $ifNull: ["$amount", 0] } },
                      { $abs: { $ifNull: ["$allocationSummary.unapplied", 0] } },
                    ],
                  },
                ],
              },
            },
            confirmedRows: {
              $sum: {
                $cond: [{ $eq: ["$isConfirmed", true] }, 1, 0],
              },
            },
          },
        },
      ]);

      summary = {
        rowCount: Number(totalsRow?.rowCount || 0),
        totalReceiptAmount: round2(Number(totalsRow?.totalReceiptAmount || 0)),
        totalUnapplied: round2(Number(totalsRow?.totalUnapplied || 0)),
        totalAllocated: round2(Number(totalsRow?.totalAllocated || 0)),
        confirmedRows: Number(totalsRow?.confirmedRows || 0),
      };
    }

    return res.status(200).json({
      items,
      pagination: {
        page: safePage,
        limit: parsedLimit,
        totalItems,
        totalPages,
        hasPreviousPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      },
      summary,
    });
  } catch (err) {
    return next(err);
  }
};

export const getPayment = async (req, res, next) => {
  try {
    const payment = await populateReceiptQuery(RentPayment.findById(req.params.id));

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    return res.status(200).json(payment);
  } catch (err) {
    return next(err);
  }
};

export const getPaymentAllocationOptions = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (!payment || payment.ledgerType !== "receipts") {
      return res.status(404).json({ success: false, message: "Receipt not found." });
    }

    const workspace = await buildReceiptAllocationWorkspace(payment);
    return res.status(200).json({
      success: true,
      data: {
        paymentId: payment._id,
        receiptNumber: payment.receiptNumber || null,
        amount: round2(Math.abs(Number(payment.amount || 0))),
        isConfirmed: payment.isConfirmed === true,
        postingStatus: payment.postingStatus || "unposted",
        rules: {
          appendOnlyUnappliedForConfirmed: workspace.appendOnlyUnappliedForConfirmed === true,
          lockedUnappliedForConfirmed: workspace.lockedUnappliedForConfirmed,
          lockedAllocatedTotal: round2(workspace.lockedAllocatedTotal || 0),
          currentUnapplied: round2(workspace.currentUnapplied || 0),
        },
        currentAllocations: workspace.currentRows || [],
        invoiceOptions: workspace.invoiceOptions || [],
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const updatePaymentAllocations = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "update"),
      });
    }

    if (!payment || payment.ledgerType !== "receipts") {
      return res.status(404).json({ success: false, message: "Receipt not found." });
    }

    if (payment.isCancelled || payment.isReversed || payment.reversalOf || String(payment.postingStatus || "").toLowerCase() === "reversed") {
      return res.status(400).json({
        success: false,
        message: "Reversed or cancelled receipts cannot be reallocated.",
      });
    }

    const hasPostedLedger =
      String(payment.postingStatus || "").toLowerCase() === "posted" ||
      (Array.isArray(payment.ledgerEntries) && payment.ledgerEntries.length > 0);
    const isPostedConfirmed = payment.isConfirmed === true && hasPostedLedger;

    if (payment.isConfirmed === true && !isPostedConfirmed) {
      return res.status(400).json({
        success: false,
        message:
          "Confirmed receipts with incomplete posting state cannot be reallocated directly. Reverse and recreate instead.",
      });
    }

    const allocationData = await buildManualReceiptAllocationData({
      payment,
      requestedAllocations: req.body?.allocations,
    });

    const previousAllocations = Array.isArray(payment.allocations) ? payment.allocations : [];
    const previousSummary = payment.allocationSummary || {};
    const previousType = payment.paymentType || "rent";
    const previousBreakdown = payment.breakdown || {};
    const previousMetadata = payment.metadata && typeof payment.metadata === "object" ? { ...payment.metadata } : {};
    const previousLedgerEntries = Array.isArray(payment.ledgerEntries) ? [...payment.ledgerEntries] : [];
    const nextMetadata = {
      ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
      allocationMode: "manual",
    };
    const history = Array.isArray(nextMetadata.allocationHistory) ? nextMetadata.allocationHistory : [];

    let actorUserId = null;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: payment.business,
        fallbackUserId: req.user?.id || req.user?._id || payment.confirmedBy || payment.createdBy || null,
      });
    } catch (actorError) {
      actorUserId = null;
    }

    history.push({
      changedAt: new Date(),
      changedBy: actorUserId,
      reason: String(req.body?.reason || "Receipt allocation updated").trim() || "Receipt allocation updated",
      previousPaymentType: previousType,
      nextPaymentType: allocationData.primaryPaymentType,
      previousSummary,
      nextSummary: allocationData.allocationSummary,
      previousAllocations,
      nextAllocations: allocationData.allocations,
    });

    nextMetadata.allocationHistory = history.slice(-25);
    nextMetadata.lastAllocationChangeAt = new Date();
    if (actorUserId) nextMetadata.lastAllocationChangedBy = actorUserId;
    if (req.body?.reason) nextMetadata.lastAllocationChangeReason = String(req.body.reason).trim();

    const [linkedTenant, linkedUnit] = await Promise.all([
      Tenant.findOne({ _id: payment.tenant, business: payment.business }).select("_id depositHeldBy").lean(),
      payment.unit
        ? Unit.findOne({ _id: payment.unit, business: payment.business }).select("_id property").lean()
        : Promise.resolve(null),
    ]);
    const linkedProperty = linkedUnit?.property
      ? await Property.findOne({ _id: linkedUnit.property, business: payment.business }).select("_id depositHeldBy").lean()
      : null;
    const depositContext = buildResolvedDepositMetadata({
      tenant: linkedTenant,
      property: linkedProperty,
      metadata: nextMetadata,
      paymentType: allocationData.primaryPaymentType || payment.paymentType || "",
      allocationData,
    });

    const previousByInvoice = new Map();
    previousAllocations.forEach((row) => {
      const invoiceId = String(row?.invoice || row?.invoiceId || "").trim();
      if (!invoiceId) return;
      previousByInvoice.set(invoiceId, round2(Number(previousByInvoice.get(invoiceId) || 0) + Number(row?.appliedAmount || 0)));
    });

    const releaseRows = (Array.isArray(depositContext.allocations) ? depositContext.allocations : [])
      .map((row) => {
        const invoiceId = String(row?.invoice || row?.invoiceId || "").trim();
        if (!invoiceId) return null;
        const previousAmount = round2(Number(previousByInvoice.get(invoiceId) || 0));
        const nextAmount = round2(Number(row?.appliedAmount || 0));
        const delta = round2(nextAmount - previousAmount);
        if (delta <= 0.009) return null;
        return {
          ...row,
          invoice: invoiceId,
          appliedAmount: delta,
        };
      })
      .filter(Boolean);
    const releaseTotal = round2(releaseRows.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));

    if (isPostedConfirmed && releaseTotal > 0 && !actorUserId) {
      return res.status(400).json({
        success: false,
        message: "A valid user is required to apply confirmed receipt prepayments to tenant charges.",
      });
    }

    if (isPostedConfirmed && releaseTotal <= 0 && JSON.stringify(previousAllocations) === JSON.stringify(depositContext.allocations)) {
      const populatedNoop = await populateReceiptQuery(RentPayment.findById(payment._id));
      return res.status(200).json({
        success: true,
        data: populatedNoop,
        message: "Receipt allocations already match the saved state.",
      });
    }

    const applyNextState = () => {
      payment.allocations = depositContext.allocations;
      payment.allocationSummary = allocationData.allocationSummary;
      payment.breakdown = allocationData.breakdown;
      payment.paymentType = allocationData.primaryPaymentType;
      payment.metadata = depositContext.metadata;
    };

    const restorePreviousState = () => {
      payment.allocations = previousAllocations;
      payment.allocationSummary = previousSummary;
      payment.breakdown = previousBreakdown;
      payment.paymentType = previousType;
      payment.metadata = previousMetadata;
      payment.ledgerEntries = previousLedgerEntries;
    };

    let releasePosting = { journalGroupId: null, entries: [], touchedAccountIds: [] };

    const persistChanges = async (session = null) => {
      applyNextState();

      if (isPostedConfirmed && releaseTotal > 0) {
        releasePosting = await postReceiptUnappliedAllocationReleaseJournal({
          payment,
          releaseRows,
          actorId: actorUserId,
          reason:
            String(req.body?.reason || "").trim() ||
            "Apply confirmed receipt unapplied balance to open tenant charges",
          session,
        });

        const priorLedgerEntryIds = previousLedgerEntries.map((entry) => String(entry?._id || entry));
        const nextLedgerEntries = [
          ...previousLedgerEntries,
          ...releasePosting.entries.filter(Boolean).map((entry) => entry?._id).filter(Boolean),
        ];
        payment.ledgerEntries = nextLedgerEntries.filter(
          (value, index, arr) => arr.findIndex((item) => String(item?._id || item) === String(value?._id || value)) === index
        );

        const releaseHistory = Array.isArray(payment?.metadata?.allocationReleaseHistory)
          ? payment.metadata.allocationReleaseHistory
          : [];
        releaseHistory.push({
          releasedAt: new Date(),
          releasedBy: actorUserId,
          reason:
            String(req.body?.reason || "").trim() ||
            "Apply confirmed receipt unapplied balance to open tenant charges",
          releasedAmount: releaseTotal,
          journalGroupId: releasePosting.journalGroupId,
          allocations: releaseRows,
        });
        payment.metadata = {
          ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
          allocationReleaseHistory: releaseHistory.slice(-25),
          lastAllocationReleaseAt: new Date(),
          lastAllocationReleaseAmount: releaseTotal,
        };
        if (actorUserId) payment.metadata.lastAllocationReleaseBy = actorUserId;
      }

      await payment.save(session ? { session } : undefined);
    };

    let session = null;
    let usedTransaction = false;
    try {
      try {
        session = await mongoose.startSession();
      } catch (sessionError) {
        session = null;
      }

      if (session) {
        try {
          await session.withTransaction(async () => {
            usedTransaction = true;
            await persistChanges(session);
          });
        } catch (transactionError) {
          const message = String(transactionError?.message || "").toLowerCase();
          const canFallback =
            !usedTransaction &&
            (message.includes("transaction numbers are only allowed") ||
              message.includes("replica set") ||
              message.includes("sharded cluster") ||
              message.includes("transactions are not supported"));

          if (canFallback) {
            await persistChanges(null);
          } else {
            throw transactionError;
          }
        }
      } else {
        await persistChanges(null);
      }
    } catch (persistError) {
      if (!usedTransaction && releasePosting.entries?.length > 0 && actorUserId) {
        await rollbackPostedAllocationReleaseEntries({
          entryIds: releasePosting.entries.map((entry) => entry?._id).filter(Boolean),
          actorId: actorUserId,
          reason: `Auto-reversal of failed unapplied allocation release for receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
        });
      }
      restorePreviousState();
      throw persistError;
    } finally {
      if (session) {
        await session.endSession().catch(() => {});
      }
    }

    await applyIncrementalBalanceDelta({ tenantId: payment.tenant, businessId: payment.business, delta: Math.abs(Number(payment.amount || 0)) });
    await recomputeTenantBalance(payment.tenant, payment.business);

    if (releasePosting.touchedAccountIds?.length > 0) {
      await aggregateChartOfAccountBalances(payment.business, releasePosting.touchedAccountIds);
    }

    const populated = await populateReceiptQuery(RentPayment.findById(payment._id));
    return res.status(200).json({
      success: true,
      data: populated,
      message: isPostedConfirmed && releaseTotal > 0
        ? "Confirmed receipt unapplied balance allocated successfully."
        : "Receipt allocations updated successfully.",
    });
  } catch (err) {
    return next(err);
  }
};

export const updatePayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "update"),
      });
    }

    if (payment.isConfirmed && payment.postingStatus === "posted") {
      return res.status(400).json({
        success: false,
        message: "Confirmed and posted receipts cannot be edited directly. Reverse and recreate instead.",
      });
    }

    const tenantId = req.body?.tenant || payment.tenant;
    const unitId = req.body?.unit || payment.unit;

    const tenant = await Tenant.findOne({ _id: tenantId, business: payment.business }).select("_id unit depositHeldBy").lean();
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found for the selected company.",
      });
    }

    const unit = await Unit.findOne({ _id: unitId, business: payment.business }).select("_id property").lean();
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: "Unit not found for the selected company.",
      });
    }

    if (String(tenant.unit) !== String(unit._id)) {
      return res.status(400).json({
        success: false,
        message: "Selected tenant does not belong to the selected unit.",
      });
    }

    const incomingMetadata = req.body?.metadata && typeof req.body.metadata === "object"
      ? req.body.metadata
      : getPaymentMetadata(payment);
    const requestedConfirmedValue = Object.prototype.hasOwnProperty.call(req.body || {}, "isConfirmed")
      ? req.body?.isConfirmed === true
      : null;

    if (requestedConfirmedValue !== null && requestedConfirmedValue !== Boolean(payment.isConfirmed)) {
      return res.status(400).json({
        success: false,
        message: "Receipt confirmation state cannot be changed through edit. Use the confirm/unconfirm actions instead.",
      });
    }

    const isTakeOnCredit = isTakeOnCreditReceipt({ metadata: incomingMetadata });
    const isDirectToLandlord = req.body?.paidDirectToLandlord === true;
    const normalizedCashbook = isDirectToLandlord || isTakeOnCredit
      ? ""
      : String(req.body?.cashbook || payment.cashbook || "").trim();

    const referenceNumber = String(req.body?.referenceNumber || payment.referenceNumber || "").trim();
    if (!referenceNumber) {
      return res.status(400).json({
        success: false,
        message: "Reference number is required for tenant receipts.",
      });
    }

    const duplicateRef = await RentPayment.findOne({
      business: payment.business,
      referenceNumber,
      _id: { $ne: payment._id },
    }).lean();

    if (duplicateRef) {
      return res.status(400).json({
        success: false,
        message: "Reference number already exists in this company.",
      });
    }

    const requestedReceiptNumber = String(
      req.body?.receiptNumber || payment.receiptNumber || ""
    ).trim();

    if (requestedReceiptNumber) {
      const duplicateReceipt = await RentPayment.findOne({
        business: payment.business,
        receiptNumber: requestedReceiptNumber,
        _id: { $ne: payment._id },
      }).lean();

      if (duplicateReceipt) {
        return res.status(400).json({
          success: false,
          message: "Receipt number already exists in this company.",
        });
      }
    }

    if (!isDirectToLandlord && !isTakeOnCredit && !normalizedCashbook) {
      return res.status(400).json({
        success: false,
        message: "Cashbook is required unless this receipt was paid directly to the landlord.",
      });
    }

    const isConfirmedAfterUpdate = Boolean(payment.isConfirmed);
    if (isTakeOnCredit && !isConfirmedAfterUpdate) {
      return res.status(400).json({
        success: false,
        message: "Credit take-on balances must remain confirmed so the opening balance posting stays auditable.",
      });
    }

    const useManualAllocations =
      String(req.body?.allocationMode || "").trim().toLowerCase() === "manual" ||
      Array.isArray(req.body?.allocations);
    const metadata = {
      ...incomingMetadata,
      allocationMode: useManualAllocations ? "manual" : "auto",
    };

    const allocationData = useManualAllocations
      ? await buildManualReceiptAllocationData({
          payment: {
            ...payment.toObject(),
            business: payment.business,
            tenant: tenantId,
            unit: unitId,
            amount: req.body?.amount ?? payment.amount,
            paymentType: req.body?.paymentType || payment.paymentType,
            metadata,
            isConfirmed: Boolean(payment.isConfirmed),
            postingStatus: payment.postingStatus || "unposted",
          },
          requestedAllocations: req.body?.allocations,
        })
      : await buildReceiptAllocationData({
          businessId: payment.business,
          tenantId,
          amount: req.body?.amount ?? payment.amount,
          paymentTypeOverride: isTakeOnCredit ? (metadata?.paymentType || req.body?.paymentType || payment.paymentType || "") : "",
          metadata,
        });

    const property = unit?.property
      ? await Property.findOne({ _id: unit.property, business: payment.business }).select("_id depositHeldBy").lean()
      : null;

    const depositContext = buildResolvedDepositMetadata({
      tenant,
      property,
      metadata,
      paymentType: allocationData.primaryPaymentType || req.body?.paymentType || payment.paymentType || "",
      allocationData,
    });

    const safeUpdate = {
      ...req.body,
      tenant: tenantId,
      unit: unitId,
      cashbook: normalizedCashbook,
      paidDirectToLandlord: isDirectToLandlord,
      referenceNumber,
      receiptNumber: requestedReceiptNumber || payment.receiptNumber,
      paymentType: allocationData.primaryPaymentType,
      breakdown: allocationData.breakdown,
      allocations: depositContext.allocations,
      allocationSummary: allocationData.allocationSummary,
      ledgerType: "receipts",
      metadata: depositContext.metadata,
    };

    delete safeUpdate.business;
    delete safeUpdate.ledgerEntries;
    delete safeUpdate.journalGroupId;
    delete safeUpdate.postingStatus;
    delete safeUpdate.postingError;
    delete safeUpdate.allocationMode;
    delete safeUpdate.reversalEntry;
    delete safeUpdate.reversalOf;
    delete safeUpdate.confirmedBy;
    delete safeUpdate.confirmedAt;
    delete safeUpdate.isConfirmed;

    const updatedPayment = await populateReceiptQuery(
      RentPayment.findByIdAndUpdate(req.params.id, { $set: safeUpdate }, { new: true })
    );

    return res.status(200).json(updatedPayment);
  } catch (err) {
    if (err?.code === 11000) {
      const duplicateFields = Object.keys(err.keyPattern || {});

      if (duplicateFields.includes("referenceNumber")) {
        return res.status(400).json({
          success: false,
          message: "Reference number already exists in this company.",
        });
      }

      if (duplicateFields.includes("receiptNumber")) {
        return res.status(400).json({
          success: false,
          message: "Receipt number already exists in this company.",
        });
      }
    }

    return next(err);
  }
};

export const confirmPayment = async (req, res, next) => {
  try {
    const existingPayment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, existingPayment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (existingPayment.isConfirmed && existingPayment.postingStatus === "posted") {
      const populated = await populateReceiptQuery(RentPayment.findById(existingPayment._id));
      return res.status(200).json(populated);
    }

    if (
      existingPayment.isCancelled ||
      existingPayment.isReversed ||
      existingPayment.reversalOf ||
      String(existingPayment.postingStatus || "").toLowerCase() === "reversed"
    ) {
      return res.status(400).json({
        success: false,
        message: "Cancelled or reversed receipts cannot be confirmed.",
      });
    }

    let actorUserId;
    try {
      actorUserId = await resolveActorUserId({
        req,
        business: existingPayment.business,
        fallbackUserId: req.body?.confirmedBy || existingPayment.confirmedBy || null,
      });
    } catch (actorError) {
      return res.status(400).json({ success: false, message: actorError.message });
    }

    const confirmationMetadata = getPaymentMetadata(existingPayment);
    const allocationData = hasStoredAllocationSnapshot(existingPayment)
      ? buildStoredReceiptAllocationData(existingPayment)
      : await buildReceiptAllocationData({
          businessId: existingPayment.business,
          tenantId: existingPayment.tenant,
          amount: existingPayment.amount,
          paymentTypeOverride: isTakeOnCreditReceipt(existingPayment)
            ? confirmationMetadata?.paymentType || existingPayment.paymentType || ""
            : "",
          metadata: confirmationMetadata,
        });

    const linkedTenant = await Tenant.findOne({ _id: existingPayment.tenant, business: existingPayment.business }).select("_id depositHeldBy").lean();
    const linkedUnit = existingPayment.unit
      ? await Unit.findOne({ _id: existingPayment.unit, business: existingPayment.business }).select("_id property").lean()
      : null;
    const linkedProperty = linkedUnit?.property
      ? await Property.findOne({ _id: linkedUnit.property, business: existingPayment.business }).select("_id depositHeldBy").lean()
      : null;
    const depositContext = buildResolvedDepositMetadata({
      tenant: linkedTenant,
      property: linkedProperty,
      metadata: confirmationMetadata,
      paymentType: allocationData.primaryPaymentType || existingPayment.paymentType || "",
      allocationData,
    });

    existingPayment.isConfirmed = true;
    existingPayment.confirmedBy = actorUserId;
    existingPayment.confirmedAt = new Date();
    existingPayment.paymentType = allocationData.primaryPaymentType;
    existingPayment.breakdown = allocationData.breakdown;
    existingPayment.allocations = depositContext.allocations;
    existingPayment.allocationSummary = allocationData.allocationSummary;
    existingPayment.metadata = depositContext.metadata;
    existingPayment.postingStatus = "unposted";
    existingPayment.postingError = null;
    existingPayment.ledgerType = "receipts";
    await existingPayment.save();

    try {
      const posting = existingPayment.paidDirectToLandlord
        ? await confirmNonCashDirectToLandlordReceipt(existingPayment, actorUserId)
        : await postReceiptJournal(existingPayment, actorUserId);

      await applyIncrementalBalanceDelta({ tenantId: existingPayment.tenant, businessId: existingPayment.business, delta: -Math.abs(Number(existingPayment.amount || 0)) });
      await recomputeTenantBalance(existingPayment.tenant, existingPayment.business);

      if (posting.entries?.length) {
        await aggregateChartOfAccountBalances(
          existingPayment.business,
          posting.entries.map((entry) => entry.accountId)
        );
      }
    } catch (postingError) {
      const rollbackEntries = await rollbackFailedReceiptPosting({
        payment: existingPayment,
        actorId: actorUserId,
        reason: `Auto-reversal of incomplete posting for receipt ${existingPayment.receiptNumber || existingPayment.referenceNumber || existingPayment._id}`,
      });

      existingPayment.isConfirmed = false;
      existingPayment.confirmedBy = null;
      existingPayment.confirmedAt = null;
      existingPayment.postingStatus = "failed";
      existingPayment.postingError = postingError.message || "Ledger posting failed on confirm";
      existingPayment.journalGroupId = null;
      existingPayment.ledgerEntries = [];
      await existingPayment.save();

      try {
        await recomputeTenantBalance(existingPayment.tenant, existingPayment.business);

        if (rollbackEntries.length > 0) {
          await aggregateChartOfAccountBalances(
            existingPayment.business,
            rollbackEntries.map((entry) => entry?.accountId).filter(Boolean)
          );
        }
      } catch (recoveryError) {
        console.error("Failed to recompute receipt state after confirm-posting rollback:", recoveryError);
      }

      return res.status(500).json({
        success: false,
        message: `Receipt confirmation failed because ledger posting did not complete: ${postingError.message}`,
      });
    }

    const populated = await populateReceiptQuery(RentPayment.findById(existingPayment._id));
    await logAuditEvent({
      req,
      company: existingPayment.business,
      action: "receipts.confirm",
      category: "finance",
      severity: "critical",
      targetType: "Receipt",
      targetId: existingPayment._id,
      targetName: receiptLabel(existingPayment),
      message: `Confirmed receipt ${receiptLabel(existingPayment)}`,
      metadata: { amount: existingPayment.amount, tenant: existingPayment.tenant, unit: existingPayment.unit },
    });
    return res.status(200).json(populated);
  } catch (err) {
    return next(err);
  }
};

export const unconfirmPayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (!payment.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "This payment is not confirmed.",
      });
    }

    if (
      payment.postingStatus === "posted" ||
      (Array.isArray(payment.ledgerEntries) && payment.ledgerEntries.length > 0)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This receipt has already been posted to the ledger. Use reversal instead of unconfirming it.",
      });
    }

    payment.isConfirmed = false;
    payment.confirmedBy = null;
    payment.confirmedAt = null;
    payment.postingStatus = "unposted";
    payment.postingError = null;
    await payment.save();

    await applyIncrementalBalanceDelta({ tenantId: payment.tenant, businessId: payment.business, delta: Math.abs(Number(payment.amount || 0)) });
    await recomputeTenantBalance(payment.tenant, payment.business);
    await logAuditEvent({
      req,
      company: payment.business,
      action: "receipts.unconfirm",
      category: "finance",
      severity: "critical",
      targetType: "Receipt",
      targetId: payment._id,
      targetName: receiptLabel(payment),
      message: `Unconfirmed receipt ${receiptLabel(payment)}`,
      metadata: { amount: payment.amount, tenant: payment.tenant, unit: payment.unit },
    });

    return res.status(200).json({
      success: true,
      message: "Payment unconfirmed successfully.",
      data: payment,
    });
  } catch (err) {
    return next(err);
  }
};

export const deletePayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message.replace("access", "delete"),
      });
    }

    if (!payment || payment.ledgerType !== "receipts") {
      return res.status(404).json({ success: false, message: "Receipt not found." });
    }

    if (payment.isCancelled || payment.isReversed || payment.reversalOf) {
      return res.status(400).json({
        success: false,
        message: "Reversed or cancelled receipts remain in the audit trail and cannot be deleted.",
      });
    }

    if (
      payment.isConfirmed ||
      payment.postingStatus === "posted" ||
      (Array.isArray(payment.ledgerEntries) && payment.ledgerEntries.length > 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a confirmed/posted receipt. Reverse it instead.",
      });
    }

    await RentPayment.findByIdAndDelete(req.params.id);
    await recomputeInvoiceStatusesForTenant({
      businessId: payment.business,
      tenantId: payment.tenant,
    });
    await logAuditEvent({
      req,
      company: payment.business,
      action: "receipts.delete",
      category: "finance",
      severity: "critical",
      targetType: "Receipt",
      targetId: payment._id,
      targetName: receiptLabel(payment),
      message: `Deleted unposted receipt ${receiptLabel(payment)}`,
      metadata: { amount: payment.amount, tenant: payment.tenant, unit: payment.unit },
    });

    return res.status(200).json({ message: "Payment deleted successfully" });
  } catch (err) {
    return next(err);
  }
};

export const getPaymentSummary = async (req, res, next) => {
  const { business, month, year } = req.query;

  try {
    const scopedBusiness =
      req.user?.isSystemAdmin && business ? business : resolveBusinessId(req);

    if (!scopedBusiness) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch receipt summary.",
      });
    }

    const matchStage = {
      business: new mongoose.Types.ObjectId(String(scopedBusiness)),
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
      $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    };

    if (month) matchStage.month = parseInt(month, 10);
    if (year) matchStage.year = parseInt(year, 10);

    const [summary] = await RentPayment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          rent: { $sum: { $ifNull: ["$allocationSummary.rent", 0] } },
          deposits: { $sum: { $ifNull: ["$allocationSummary.deposit", 0] } },
          utilities: { $sum: { $ifNull: ["$allocationSummary.utility", 0] } },
          lateFees: { $sum: { $ifNull: ["$allocationSummary.latePenalty", 0] } },
          debitNotes: { $sum: { $ifNull: ["$allocationSummary.debitNote", 0] } },
          other: { $sum: { $ifNull: ["$allocationSummary.other", 0] } },
          unapplied: { $sum: { $ifNull: ["$allocationSummary.unapplied", 0] } },
        },
      },
    ]);

    const totals = {
      rent: Number(summary?.rent || 0),
      deposits: Number(summary?.deposits || 0),
      utilities: Number(summary?.utilities || 0),
      lateFees: Number(summary?.lateFees || 0),
      other: Number(summary?.debitNotes || 0) + Number(summary?.other || 0),
      unapplied: Number(summary?.unapplied || 0),
    };

    return res.status(200).json({
      totalPayments: Number(summary?.totalPayments || 0),
      totalAmount:
        Number(totals.rent || 0) +
        Number(totals.deposits || 0) +
        Number(totals.utilities || 0) +
        Number(totals.lateFees || 0) +
        Number(totals.other || 0) +
        Number(totals.unapplied || 0),
      breakdown: {
        rent: round2(totals.rent),
        deposits: round2(totals.deposits),
        utilities: round2(totals.utilities),
        lateFees: round2(totals.lateFees),
        other: round2(totals.other),
        unapplied: round2(totals.unapplied),
      },
      month: month || "All",
      year: year || "All",
    });
  } catch (err) {
    return next(err);
  }
};

export const reversePayment = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (!payment.isConfirmed) {
      return res.status(400).json({
        success: false,
        message: "Only confirmed receipts can be reversed.",
      });
    }

    if (payment.isCancelled || payment.reversalOf) {
      return res.status(400).json({
        success: false,
        message: "Only original confirmed receipts can be reversed.",
      });
    }

    if (payment.isReversed) {
      return res.status(400).json({
        success: false,
        message: "Receipt is already reversed.",
      });
    }

    const reason = req.body?.reason || "Receipt reversed";
    const businessId = payment.business || resolveBusinessId(req);

    let reversedBy;
    try {
      reversedBy = await resolveActorUserId({
        req,
        business: businessId,
        fallbackUserId: payment.confirmedBy || payment.createdBy || null,
      });
    } catch (actorError) {
      return res.status(400).json({ success: false, message: actorError.message });
    }

    const reversalReceiptNumber = await generateReceiptNumber(businessId);
    const reversalRef = `REV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const reversalPayload = {
      tenant: payment.tenant,
      unit: payment.unit,
      amount: Math.abs(Number(payment.amount || 0)),
      paymentType: payment.paymentType,
      breakdown: payment.breakdown || {
        rent: 0,
        utilities: [],
        total: Math.abs(Number(payment.amount || 0)),
      },
      allocations: payment.allocations || [],
      allocationSummary: payment.allocationSummary || {},
      paymentDate: new Date(),
      bankingDate: new Date(),
      recordDate: new Date(),
      dueDate: payment.dueDate || new Date(),
      referenceNumber: reversalRef,
      description: `Reversal of ${payment.receiptNumber || payment.referenceNumber}. ${reason}`,
      isConfirmed: true,
      confirmedBy: reversedBy,
      confirmedAt: new Date(),
      paymentMethod: payment.paymentMethod,
      receiptNumber: reversalReceiptNumber,
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      business: businessId,
      ledgerType: "receipts",
      reversalOf: payment._id,
      cashbook: payment.paidDirectToLandlord ? "" : payment.cashbook,
      paidDirectToLandlord: payment.paidDirectToLandlord,
      postingStatus: "unposted",
      postingError: null,
      ledgerEntries: [],
    };

    const reversalEntry = await new RentPayment(reversalPayload).save();

    try {
      const reversalEntries = await reverseAllLedgerEntriesForPayment(payment, reversedBy, reason);

      payment.isReversed = true;
      payment.reversedAt = new Date();
      payment.reversedBy = reversedBy;
      payment.reversalReason = reason;
      payment.reversalEntry = reversalEntry._id;
      payment.postingStatus = "reversed";
      await payment.save();

      reversalEntry.postingStatus = "posted";
      reversalEntry.postingError = null;
      reversalEntry.journalGroupId = reversalEntries[0]?.journalGroupId || null;
      reversalEntry.ledgerEntries = reversalEntries.map((entry) => entry._id);
      await reversalEntry.save();

      await recomputeTenantBalance(payment.tenant, payment.business);

      const touchedAccountIds = reversalEntries
        .map((entry) => entry?.accountId)
        .filter(Boolean);

      if (touchedAccountIds.length > 0) {
        await aggregateChartOfAccountBalances(payment.business, touchedAccountIds);
      }
    } catch (reversalError) {
      reversalEntry.isCancelled = true;
      reversalEntry.cancelledAt = new Date();
      reversalEntry.cancelledBy = reversedBy;
      reversalEntry.cancellationReason = `Auto-cancelled because reversal posting failed: ${reversalError.message}`;
      reversalEntry.postingStatus = "failed";
      reversalEntry.postingError = reversalError.message || "Ledger reversal failed";
      await reversalEntry.save();

      return res.status(500).json({
        success: false,
        message: `Receipt reversal failed because ledger reversal did not complete: ${reversalError.message}`,
      });
    }

    emitToCompany(businessId, "payment:reversed", {
      paymentId: payment._id,
      reversalId: reversalEntry._id,
    });

    const populatedOriginal = await populateReceiptQuery(RentPayment.findById(payment._id));
    const populatedReversal = await populateReceiptQuery(RentPayment.findById(reversalEntry._id));
    await logAuditEvent({
      req,
      company: businessId,
      action: "receipts.reverse",
      category: "finance",
      severity: "critical",
      targetType: "Receipt",
      targetId: payment._id,
      targetName: receiptLabel(payment),
      message: `Reversed receipt ${receiptLabel(payment)}`,
      metadata: {
        amount: payment.amount,
        reason,
        reversalReceipt: receiptLabel(reversalEntry),
        reversalId: reversalEntry._id,
        tenant: payment.tenant,
        unit: payment.unit,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Receipt reversed successfully",
      data: {
        original: populatedOriginal,
        reversal: populatedReversal,
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const cancelReversal = async (req, res, next) => {
  try {
    const payment = await RentPayment.findById(req.params.id);

    const access = await authorizePaymentAccess(req, payment);
    if (!access.allowed) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    if (!payment.isReversed || !payment.reversalEntry) {
      return res.status(400).json({
        success: false,
        message: "Receipt does not have an active reversal.",
      });
    }

    return res.status(400).json({
      success: false,
      message:
        "Cancellation of posted reversals is blocked for audit safety. Create a new correcting receipt instead.",
    });
  } catch (err) {
    return next(err);
  }
};
