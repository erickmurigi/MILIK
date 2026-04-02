import mongoose from "mongoose";
import RentPayment from "../../models/RentPayment.js";
import Tenant from "../../models/Tenant.js";
import TenantInvoice from "../../models/TenantInvoice.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import {
  computeTenantInvoiceSnapshots,
  recomputeInvoiceStatusesForTenant,
  recomputeTenantBalance as recomputeSharedTenantBalance,
} from "./tenantInvoices.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveLandlordRemittancePayableAccount } from "../../services/propertyAccountingService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const escapeRegExp = (value = "") => String(value || "").replace(/[|\\{}()\[\]^$+*?.]/g, "\\$&");

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
    .populate("ledgerEntries");

const safeLower = (value = "") => String(value || "").trim().toLowerCase();

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
  const prefix = "REC";

  const lastPayment = await RentPayment.findOne(
    {
      business: businessId,
      receiptNumber: { $regex: `^${prefix}\\d+$` },
    },
    { receiptNumber: 1 },
    { sort: { receiptNumber: -1, createdAt: -1 } }
  ).lean();

  let sequence = 1;
  if (lastPayment?.receiptNumber) {
    const numericPart = parseInt(lastPayment.receiptNumber.replace(prefix, ""), 10) || 0;
    sequence = numericPart + 1;
  }

  while (true) {
    const candidate = `${prefix}${String(sequence).padStart(5, "0")}`;
    const exists = await RentPayment.exists({
      business: businessId,
      receiptNumber: candidate,
    });

    if (!exists) {
      return candidate;
    }

    sequence += 1;
  }
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

const shouldIncludeInLandlordStatement = (payment) => {
  if (isTakeOnBalanceReceipt(payment)) return false;
  const summary = payment?.allocationSummary || {};
  return Number(summary.rent || 0) > 0 || Number(summary.utility || 0) > 0;
};

const getReceiptStatementCategoryForGroup = (group, paidDirectToLandlord) => {
  const normalized = String(group || "").toLowerCase();
  if (normalized === "utility") return paidDirectToLandlord ? "UTILITY_RECEIPT_LANDLORD" : "UTILITY_RECEIPT_MANAGER";
  if (normalized === "deposit") return "DEPOSIT_RECEIVED";
  if (["unapplied", "late_penalty", "debit_note", "other"].includes(normalized)) return "ADJUSTMENT";
  return paidDirectToLandlord ? "RENT_RECEIPT_LANDLORD" : "RENT_RECEIPT_MANAGER";
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

  // Deposits are recognized as a liability when the deposit invoice is raised.
  // A receipt allocated to that invoice should therefore clear tenant receivable,
  // not create the deposit liability a second time.
  return resolveCreditAccount(businessId, { paymentType: "rent" });
};

const getPostingRoleForAllocationGroup = (groupKey) => {
  const normalized = String(groupKey || "").trim().toLowerCase();
  if (normalized === "utility") return "tenant_receivable_utility";
  if (normalized === "unapplied") return "tenant_advance_liability";
  return "tenant_receivable";
};

const buildReceiptAllocationData = async ({ businessId, tenantId, amount, paymentTypeOverride = "", metadata = {} }) => {
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

    allocations.push({
      invoice: snapshot._id,
      invoiceNumber: snapshot.invoiceNumber || "",
      category: snapshot.category || "",
      priorityGroup,
      utilityType,
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
    return {
      receiptAmount: round2(Math.abs(Number(payment?.amount || 0))),
      invoiceOptions: [],
      currentRows: [],
      lockedAllocatedTotal: 0,
      currentUnapplied: round2(Math.abs(Number(payment?.allocationSummary?.unapplied || 0))),
      lockedUnappliedForConfirmed: Boolean(payment?.isConfirmed && payment?.postingStatus === "posted"),
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

  const invoiceOptions = invoiceSnapshots.map((snapshot) => {
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
      description: snapshot?.description || "",
      invoiceDate: snapshot?.invoiceDate || null,
      dueDate: snapshot?.dueDate || null,
      amount: round2(Math.abs(Number(snapshot?.amount || 0))),
      outstanding: currentOutstanding,
      currentAllocation,
      maxAllocatable,
      status: snapshot?.computedStatus || snapshot?.status || "pending",
    };
  });

  const lockedAllocatedTotal = round2(currentRows.reduce((sum, row) => sum + Number(row?.appliedAmount || 0), 0));
  const currentUnapplied = round2(Math.max(0, receiptAmount - lockedAllocatedTotal));

  return {
    receiptAmount,
    invoiceOptions,
    currentRows,
    lockedAllocatedTotal,
    currentUnapplied,
    lockedUnappliedForConfirmed: isPostedConfirmed,
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

  if (workspace.lockedUnappliedForConfirmed) {
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
    if (appliedAmount > maxAllocatable + 0.009) {
      const label = option.invoiceNumber || option.description || invoiceId;
      const error = new Error(`Allocation for ${label} exceeds its available amount of KES ${maxAllocatable.toLocaleString()}.`);
      error.statusCode = 400;
      throw error;
    }

    rows.push({
      invoice: invoiceId,
      invoiceNumber: option.invoiceNumber || "",
      category: option.category || "",
      priorityGroup: option.priorityGroup || "other",
      utilityType: option.utilityType || "",
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
  recomputeSharedTenantBalance(tenantId, businessId);

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
    const key = String(row?.priorityGroup || "other");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  ["rent", "deposit", "utility", "late_penalty", "debit_note", "other"].forEach((key) => {
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

  for (const group of postingGroups) {
    const category = getReceiptStatementCategoryForGroup(group.key, true);
    const postingRole = getPostingRoleForAllocationGroup(group.key);
    const creditAccount = await resolveCreditAccountForAllocationGroup(payment.business, group.key);
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
    const key = String(row?.priorityGroup || "other");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  ["rent", "deposit", "utility", "late_penalty", "debit_note", "other"].forEach((key) => {
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

  for (const group of postingGroups) {
    const category = getReceiptStatementCategoryForGroup(group.key, !!payment?.paidDirectToLandlord);
    const postingRole = getPostingRoleForAllocationGroup(group.key);
    const creditAccount = await resolveCreditAccountForAllocationGroup(payment.business, group.key);
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
      notes: `Receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
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
    notes: payment?.paidDirectToLandlord
      ? `Direct-to-landlord settlement leg for receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`
      : `Cashbook leg for receipt ${payment.receiptNumber || payment.referenceNumber || payment._id}`,
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
  });

  if (!originalEntries.length) {
    return [];
  }

  const reversalResults = [];
  for (const entry of originalEntries) {
    if (entry.reversedByEntry || entry.status === "reversed") {
      continue;
    }

    const result = await postReversal({
      entryId: entry._id,
      reason: reason || "Payment reversed",
      userId,
    });

    reversalResults.push(result.reversalEntry);
  }

  return reversalResults;
};

export const createPayment = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId || !isValidObjectId(businessId)) {
      return res.status(400).json({
        success: false,
        message: "Valid business is required to create a receipt.",
      });
    }

    const tenantId = req.body?.tenant;
    const unitId = req.body?.unit;

    if (!isValidObjectId(tenantId) || !isValidObjectId(unitId)) {
      return res.status(400).json({
        success: false,
        message: "Valid tenant and unit are required.",
      });
    }

    const tenant = await Tenant.findOne({ _id: tenantId, business: businessId }).select("_id unit business");
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found for the selected company.",
      });
    }

    const unit = await Unit.findOne({ _id: unitId, business: businessId }).select("_id property business");
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

    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    const isTakeOnCredit = isTakeOnCreditReceipt({ metadata });
    const isConfirmedOnCreate = req.body?.isConfirmed === true;
    const isDirectToLandlord = req.body?.paidDirectToLandlord === true;
    const refNumber = String(req.body?.referenceNumber || "").trim();
    const normalizedCashbook = isDirectToLandlord || isTakeOnCredit ? "" : String(req.body?.cashbook || "").trim();

    if (!refNumber) {
      return res.status(400).json({
        success: false,
        message: "Reference number is required for tenant receipts.",
      });
    }

    const duplicateRef = await RentPayment.findOne({
      business: businessId,
      referenceNumber: refNumber,
    }).lean();

    if (duplicateRef) {
      return res.status(400).json({
        success: false,
        message: "Reference number already exists in this company.",
      });
    }

    if (!isDirectToLandlord && !isTakeOnCredit && !normalizedCashbook) {
      return res.status(400).json({
        success: false,
        message: "Cashbook is required unless this receipt was paid directly to the landlord.",
      });
    }

    if (isTakeOnCredit && !isConfirmedOnCreate) {
      return res.status(400).json({
        success: false,
        message: "Credit take-on balances must be saved as confirmed receipts so the opening balance posting stays auditable.",
      });
    }

    let receiptNumber = String(req.body?.receiptNumber || "").trim();
    if (!receiptNumber) {
      receiptNumber = await generateReceiptNumber(businessId);
    } else {
      const duplicateReceipt = await RentPayment.findOne({
        business: businessId,
        receiptNumber,
      }).lean();

      if (duplicateReceipt) {
        return res.status(400).json({
          success: false,
          message: "Receipt number already exists in this company.",
        });
      }
    }

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

    const allocationData = await buildReceiptAllocationData({
      businessId,
      tenantId,
      amount: req.body?.amount,
      paymentTypeOverride: isTakeOnCredit ? (metadata?.paymentType || req.body?.paymentType || "") : "",
      metadata,
    });

    const payment = new RentPayment({
      ...req.body,
      tenant: tenantId,
      unit: unitId,
      cashbook: normalizedCashbook,
      paidDirectToLandlord: isDirectToLandlord,
      paymentType: allocationData.primaryPaymentType,
      breakdown: allocationData.breakdown,
      allocations: allocationData.allocations,
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
      metadata,
    });

    const savedPayment = await payment.save();

    if (savedPayment.isConfirmed) {
      try {
        const posting = savedPayment.paidDirectToLandlord
          ? await confirmNonCashDirectToLandlordReceipt(savedPayment, actorUserId)
          : await postReceiptJournal(savedPayment, actorUserId);

        await recomputeTenantBalance(savedPayment.tenant, savedPayment.business);
        await recomputeInvoiceStatusesForTenant({
          businessId: savedPayment.business,
          tenantId: savedPayment.tenant,
        });

        if (posting.entries?.length) {
          await aggregateChartOfAccountBalances(
            savedPayment.business,
            posting.entries.map((entry) => entry.accountId)
          );
        }
      } catch (postingError) {
        await RentPayment.findByIdAndUpdate(savedPayment._id, {
          $set: {
            isConfirmed: false,
            confirmedBy: null,
            confirmedAt: null,
            postingStatus: "failed",
            postingError: postingError.message || "Ledger posting failed on create",
          },
        });

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

export const getPayments = async (req, res, next) => {
  const { tenant, unit, month, year, paymentType, ledger } = req.query;

  try {
    const business = resolveBusinessId(req);

    if (!business) {
      return res.status(400).json({
        success: false,
        message: "Business context is required to fetch receipts.",
      });
    }

    const filter = {
      business,
      ledgerType: "receipts",
    };

    if (tenant) filter.tenant = tenant;
    if (unit) filter.unit = unit;
    if (month) filter.month = parseInt(month, 10);
    if (year) filter.year = parseInt(year, 10);
    if (paymentType) filter.paymentType = paymentType;
    if (ledger && ledger === "receipts") filter.ledgerType = "receipts";

    const payments = await populateReceiptQuery(
      RentPayment.find(filter).sort({ paymentDate: -1, createdAt: -1 })
    );

    return res.status(200).json(payments);
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

    const allocationData = await buildManualReceiptAllocationData({
      payment,
      requestedAllocations: req.body?.allocations,
    });

    const previousAllocations = Array.isArray(payment.allocations) ? payment.allocations : [];
    const previousSummary = payment.allocationSummary || {};
    const previousType = payment.paymentType || "rent";
    const nextMetadata = {
      ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
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

    payment.allocations = allocationData.allocations;
    payment.allocationSummary = allocationData.allocationSummary;
    payment.breakdown = allocationData.breakdown;
    payment.paymentType = allocationData.primaryPaymentType;
    payment.metadata = nextMetadata;
    await payment.save();

    await recomputeInvoiceStatusesForTenant({
      businessId: payment.business,
      tenantId: payment.tenant,
    });

    const populated = await populateReceiptQuery(RentPayment.findById(payment._id));
    return res.status(200).json({
      success: true,
      data: populated,
      message: "Receipt allocations updated successfully.",
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

    const tenant = await Tenant.findOne({ _id: tenantId, business: payment.business }).select("_id unit");
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: "Tenant not found for the selected company.",
      });
    }

    const unit = await Unit.findOne({ _id: unitId, business: payment.business }).select("_id");
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

    const metadata = req.body?.metadata && typeof req.body.metadata === "object"
      ? req.body.metadata
      : getPaymentMetadata(payment);
    const isTakeOnCredit = isTakeOnCreditReceipt({ metadata });
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

    const isConfirmedAfterUpdate = req.body?.isConfirmed ?? payment.isConfirmed;
    if (isTakeOnCredit && !isConfirmedAfterUpdate) {
      return res.status(400).json({
        success: false,
        message: "Credit take-on balances must remain confirmed so the opening balance posting stays auditable.",
      });
    }

    const allocationData = await buildReceiptAllocationData({
      businessId: payment.business,
      tenantId,
      amount: req.body?.amount ?? payment.amount,
      paymentTypeOverride: isTakeOnCredit ? (metadata?.paymentType || req.body?.paymentType || payment.paymentType || "") : "",
      metadata,
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
      allocations: allocationData.allocations,
      allocationSummary: allocationData.allocationSummary,
      ledgerType: "receipts",
      metadata,
    };

    delete safeUpdate.business;
    delete safeUpdate.ledgerEntries;
    delete safeUpdate.journalGroupId;
    delete safeUpdate.postingStatus;
    delete safeUpdate.postingError;
    delete safeUpdate.reversalEntry;
    delete safeUpdate.reversalOf;
    delete safeUpdate.confirmedBy;
    delete safeUpdate.confirmedAt;

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
    const allocationData = await buildReceiptAllocationData({
      businessId: existingPayment.business,
      tenantId: existingPayment.tenant,
      amount: existingPayment.amount,
      paymentTypeOverride: isTakeOnCreditReceipt(existingPayment)
        ? confirmationMetadata?.paymentType || existingPayment.paymentType || ""
        : "",
      metadata: confirmationMetadata,
    });

    existingPayment.isConfirmed = true;
    existingPayment.confirmedBy = actorUserId;
    existingPayment.confirmedAt = new Date();
    existingPayment.paymentType = allocationData.primaryPaymentType;
    existingPayment.breakdown = allocationData.breakdown;
    existingPayment.allocations = allocationData.allocations;
    existingPayment.allocationSummary = allocationData.allocationSummary;
    existingPayment.postingStatus = "unposted";
    existingPayment.postingError = null;
    existingPayment.ledgerType = "receipts";
    await existingPayment.save();

    try {
      const posting = existingPayment.paidDirectToLandlord
        ? await confirmNonCashDirectToLandlordReceipt(existingPayment, actorUserId)
        : await postReceiptJournal(existingPayment, actorUserId);

      await recomputeTenantBalance(existingPayment.tenant, existingPayment.business);
      await recomputeInvoiceStatusesForTenant({
        businessId: existingPayment.business,
        tenantId: existingPayment.tenant,
      });

      if (posting.entries?.length) {
        await aggregateChartOfAccountBalances(
          existingPayment.business,
          posting.entries.map((entry) => entry.accountId)
        );
      }
    } catch (postingError) {
      existingPayment.isConfirmed = false;
      existingPayment.confirmedBy = null;
      existingPayment.confirmedAt = null;
      existingPayment.postingStatus = "failed";
      existingPayment.postingError = postingError.message || "Ledger posting failed on confirm";
      await existingPayment.save();

      return res.status(500).json({
        success: false,
        message: `Receipt confirmation failed because ledger posting did not complete: ${postingError.message}`,
      });
    }

    const populated = await populateReceiptQuery(RentPayment.findById(existingPayment._id));
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

    await recomputeTenantBalance(payment.tenant, payment.business);
    await recomputeInvoiceStatusesForTenant({
      businessId: payment.business,
      tenantId: payment.tenant,
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

    if (payment.isConfirmed || payment.postingStatus === "posted") {
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

    const filter = {
      business: scopedBusiness,
      ledgerType: "receipts",
      isConfirmed: true,
      isCancelled: { $ne: true },
    };

    if (month) filter.month = parseInt(month, 10);
    if (year) filter.year = parseInt(year, 10);

    const payments = await RentPayment.find(filter);

    const totalRent = payments
      .filter((p) => p.paymentType === "rent")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalDeposits = payments
      .filter((p) => p.paymentType === "deposit")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalUtilities = payments
      .filter((p) => p.paymentType === "utility")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalLateFees = payments
      .filter((p) => p.paymentType === "late_fee")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return res.status(200).json({
      totalPayments: payments.length,
      totalAmount: totalRent + totalDeposits + totalUtilities + totalLateFees,
      breakdown: {
        rent: totalRent,
        deposits: totalDeposits,
        utilities: totalUtilities,
        lateFees: totalLateFees,
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
      amount: -Math.abs(Number(payment.amount || 0)),
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
      await recomputeInvoiceStatusesForTenant({
        businessId: payment.business,
        tenantId: payment.tenant,
      });

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
