import mongoose from "mongoose";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import {
  ensureSystemChartOfAccounts,
  findSystemAccountByCode,
} from "../../services/chartOfAccountsService.js";
import {
  resolvePropertyAccountingContext,
  resolveLandlordRemittancePayableAccount,
  ensurePropertyControlAccount,
} from "../../services/propertyAccountingService.js";
import { syncProcessedStatementSettlementState } from "../../services/processedStatementSettlementService.js";
import { createError } from "../../utils/error.js";
import { parsePagination } from "../../utils/pagination.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const normalizeDate = (value, fallback = new Date()) => {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback) : date;
};

const buildStatementPeriod = (value) => {
  const dt = normalizeDate(value, new Date());
  const year = dt.getFullYear();
  const month = dt.getMonth();
  return {
    start: new Date(year, month, 1, 0, 0, 0, 0),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  };
};

const resolveVoucherPostingDate = ({ voucher = {}, statementDate = null } = {}) => {
  const candidates = [
    statementDate,
    voucher?.paidDate,
    voucher?.paidAt,
    voucher?.approvedAt,
    voucher?.createdAt,
    voucher?.updatedAt,
    voucher?.dueDate,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = normalizeDate(candidate, null);
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
};

const resolveBusinessId = async (req) => {
  const direct =
    req?.query?.business ||
    req?.query?.company ||
    req?.body?.business ||
    req?.body?.company ||
    req?.user?.company?._id ||
    req?.user?.company ||
    null;

  if (direct) return direct;

  if (req?.params?.id && isValidObjectId(req.params.id)) {
    const existing = await PaymentVoucher.findById(req.params.id).select("business").lean();
    if (existing?.business) return existing.business;
  }

  return null;
};

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for voucher posting.",
  });

const resolveVoucherLandlordContext = async ({
  businessId,
  propertyId,
  landlordId = null,
  voucherCategory = "",
} = {}) => {
  if (!propertyId && !voucherRequiresProperty(voucherCategory)) {
    return {
      property: null,
      propertyId: null,
      businessId,
      landlordId: null,
      controlAccountId: null,
      unscoped: true,
    };
  }

  return resolvePropertyAccountingContext({
    propertyId,
    landlordId,
    businessId,
  });
};

const generateVoucherNo = async (businessId) => {
  const prefix = "PM";
  const lastVoucher = await PaymentVoucher.findOne(
    { business: businessId, voucherNo: { $regex: `^${prefix}\\d+$` } },
    { voucherNo: 1 },
    { sort: { createdAt: -1 } }
  ).lean();

  let seq = 1;
  if (lastVoucher?.voucherNo) {
    seq = (parseInt(lastVoucher.voucherNo.replace(prefix, ""), 10) || 0) + 1;
  }

  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const ensureLiabilityAccount = async ({ businessId, liabilityAccountId }) => {
  if (!liabilityAccountId || !isValidObjectId(liabilityAccountId)) {
    throw new Error("A valid liability posting account is required.");
  }

  const account = await ChartOfAccount.findOne({
    _id: liabilityAccountId,
    business: businessId,
    isPosting: { $ne: false },
    $or: [
      { type: "liability" },
      { type: "Liability" },
      { accountType: "liability" },
      { accountType: "Liability" },
      { nature: "liability" },
      { nature: "Liability" },
      { accountNature: "liability" },
      { accountNature: "Liability" },
    ],
  }).lean();

  if (!account) {
    throw new Error("Selected liability posting account was not found for this business.");
  }

  return account;
};

const ensureExplicitDebitAccount = async ({ businessId, debitAccountId, voucherCategory }) => {
  if (!debitAccountId || !isValidObjectId(debitAccountId)) {
    throw new Error("A valid debit posting account is required for this voucher category.");
  }

  const account = await ChartOfAccount.findOne({
    _id: debitAccountId,
    business: businessId,
    isPosting: { $ne: false },
  }).lean();

  if (!account) {
    throw new Error("Selected debit posting account was not found for this business.");
  }

  const normalizedCategory = String(voucherCategory || "");
  if (normalizedCategory === "petty_cash_float") {
    if (account.type !== "asset" || !isCashbookLikeAccount(account)) {
      throw new Error("Petty cash float vouchers must debit a petty-cash or cashbook asset account.");
    }
    return account;
  }

  if (account.type !== "expense") {
    throw new Error("Selected debit posting account must be an expense account for this voucher category.");
  }

  return account;
};

const ensureSettlementAccount = async ({ businessId, settlementAccountId }) => {
  if (!settlementAccountId || !isValidObjectId(settlementAccountId)) {
    throw new Error("A valid settlement cashbook account is required to mark a voucher as paid.");
  }

  const account = await ChartOfAccount.findOne({
    _id: settlementAccountId,
    business: businessId,
    isPosting: { $ne: false },
    type: "asset",
  }).lean();

  if (!account) {
    throw new Error("Selected settlement account was not found for this business.");
  }

  if (!isCashbookLikeAccount(account)) {
    throw new Error("Settlement account must be a cash, bank, M-Pesa, wallet, till, or petty-cash asset account.");
  }

  return account;
};

const findAccountByFlexibleShape = async ({
  businessId,
  codes = [],
  namePatterns = [],
  typeHints = [],
  groupHints = [],
}) => {
  const or = [];

  if (codes.length > 0) {
    or.push({ code: { $in: codes } });
    or.push({ accountCode: { $in: codes } });
  }

  for (const pattern of namePatterns) {
    or.push({ name: { $regex: pattern, $options: "i" } });
    or.push({ accountName: { $regex: pattern, $options: "i" } });
    or.push({ title: { $regex: pattern, $options: "i" } });
  }

  const typeOr = [];
  for (const hint of typeHints) {
    typeOr.push({ type: hint });
    typeOr.push({ type: hint.toLowerCase() });
    typeOr.push({ type: hint.toUpperCase() });
    typeOr.push({ accountType: hint });
    typeOr.push({ accountType: hint.toLowerCase() });
    typeOr.push({ accountType: hint.toUpperCase() });
    typeOr.push({ nature: hint });
    typeOr.push({ nature: hint.toLowerCase() });
    typeOr.push({ nature: hint.toUpperCase() });
    typeOr.push({ accountNature: hint });
    typeOr.push({ accountNature: hint.toLowerCase() });
    typeOr.push({ accountNature: hint.toUpperCase() });
  }

  const groupOr = [];
  for (const hint of groupHints) {
    groupOr.push({ group: hint });
    groupOr.push({ group: hint.toLowerCase() });
    groupOr.push({ group: hint.toUpperCase() });
    groupOr.push({ accountGroup: hint });
    groupOr.push({ accountGroup: hint.toLowerCase() });
    groupOr.push({ accountGroup: hint.toUpperCase() });
    groupOr.push({ category: hint });
    groupOr.push({ category: hint.toLowerCase() });
    groupOr.push({ category: hint.toUpperCase() });
    groupOr.push({ subType: hint });
    groupOr.push({ subType: hint.toLowerCase() });
    groupOr.push({ subType: hint.toUpperCase() });
  }

  const baseAnd = [
    { business: businessId },
    { isPosting: { $ne: false } },
  ];

  if (typeOr.length > 0) {
    baseAnd.push({ $or: typeOr });
  }

  if (groupOr.length > 0) {
    baseAnd.push({ $or: groupOr });
  }

  if (or.length > 0) {
    baseAnd.push({ $or: or });
  }

  return ChartOfAccount.findOne({ $and: baseAnd }).sort({ createdAt: 1 }).lean();
};

const findAnyExpensePostingAccount = async (businessId) => {
  const account = await ChartOfAccount.findOne({
    business: businessId,
    isPosting: { $ne: false },
    $or: [
      { type: "expense" },
      { type: "Expense" },
      { type: "EXPENSE" },
      { accountType: "expense" },
      { accountType: "Expense" },
      { accountType: "EXPENSE" },
      { nature: "expense" },
      { nature: "Expense" },
      { nature: "EXPENSE" },
      { accountNature: "expense" },
      { accountNature: "Expense" },
      { accountNature: "EXPENSE" },
      { group: "expense" },
      { group: "Expense" },
      { group: "EXPENSE" },
      { accountGroup: "expense" },
      { accountGroup: "Expense" },
      { accountGroup: "EXPENSE" },
      { category: "expense" },
      { category: "Expense" },
      { category: "EXPENSE" },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();

  if (account) return account;

  const nameFallback = await ChartOfAccount.findOne({
    business: businessId,
    isPosting: { $ne: false },
    $or: [
      { name: { $regex: "expense|cost|repair|maintenance|deduction", $options: "i" } },
      { accountName: { $regex: "expense|cost|repair|maintenance|deduction", $options: "i" } },
      { title: { $regex: "expense|cost|repair|maintenance|deduction", $options: "i" } },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();

  return nameFallback || null;
};

const resolveVoucherDebitAccount = async ({ voucher, businessId, accountingContext = null }) => {
  await ensureSystemChartOfAccounts(businessId);

  if (voucherRequiresExplicitDebitAccount(voucher.category)) {
    return ensureExplicitDebitAccount({
      businessId,
      debitAccountId: voucher.debitAccount,
      voucherCategory: voucher.category,
    });
  }

  if (voucher.category === "deposit_refund") {
    return resolveLandlordRemittancePayableAccount(businessId);
  }

  if (["landlord_maintenance", "landlord_other"].includes(voucher.category)) {
    const context =
      accountingContext ||
      (await resolvePropertyAccountingContext({
        propertyId: voucher.property,
        landlordId: voucher.landlord || null,
        businessId,
      }));

    const propertyDoc = context?.property || {};
    const controlAccount = await ensurePropertyControlAccount({
      businessId,
      propertyId: context.propertyId || voucher.property,
      propertyCode: propertyDoc.propertyCode,
      propertyName: propertyDoc.propertyName,
    });

    if (!controlAccount?._id) {
      throw new Error("Property control account could not be resolved for this voucher.");
    }

    return controlAccount;
  }

  let account = null;

  if (voucher.category === "landlord_maintenance") {
    account =
      (await findAccountByFlexibleShape({
        businessId,
        codes: ["5100", "5101", "510", "EXP-MAINT", "MAINT-EXP"],
        namePatterns: [
          "^maintenance expense$",
          "maintenance",
          "repair",
          "repairs",
          "repairs expense",
          "maintenance cost",
        ],
        typeHints: ["expense"],
        groupHints: ["expense", "maintenance"],
      })) ||
      (await findAccountByFlexibleShape({
        businessId,
        namePatterns: ["expense", "cost"],
        typeHints: ["expense"],
        groupHints: ["expense"],
      }));
  } else {
    account =
      (await findAccountByFlexibleShape({
        businessId,
        codes: ["5200", "5201", "520", "GEN-EXP", "OTHER-EXP"],
        namePatterns: [
          "^management expense$",
          "other expense",
          "general expense",
          "administrative expense",
          "landlord expense",
          "expense",
        ],
        typeHints: ["expense"],
        groupHints: ["expense", "other"],
      })) ||
      (await findAccountByFlexibleShape({
        businessId,
        namePatterns: ["expense", "cost"],
        typeHints: ["expense"],
        groupHints: ["expense"],
      }));
  }

  if (!account?._id) {
    account = await findAnyExpensePostingAccount(businessId);
  }

  if (!account?._id) {
    throw new Error(
      "A posting expense account could not be resolved for this voucher. Please create at least one posting expense account in Chart of Accounts for this business."
    );
  }

  return account;
};

const LANDLORD_STATEMENT_CATEGORIES = new Set(["landlord_maintenance", "landlord_other"]);
const PROPERTY_REQUIRED_CATEGORIES = new Set([
  "landlord_maintenance",
  "deposit_refund",
  "landlord_other",
  "manager_property",
]);
const EXPLICIT_DEBIT_ACCOUNT_CATEGORIES = new Set([
  "manager_property",
  "company_operational",
  "petty_cash_float",
  "petty_cash_expense",
]);

const getExpenseCategory = (voucherCategory) => {
  if (voucherCategory === "landlord_maintenance") return "maintenance";
  if (voucherCategory === "landlord_other") return "other";
  return null;
};

const voucherRequiresProperty = (voucherCategory) =>
  PROPERTY_REQUIRED_CATEGORIES.has(String(voucherCategory || ""));

const voucherRequiresExplicitDebitAccount = (voucherCategory) =>
  EXPLICIT_DEBIT_ACCOUNT_CATEGORIES.has(String(voucherCategory || ""));

const isCashbookLikeAccount = (account = {}) => {
  const text = `${account?.name || ""} ${account?.group || ""} ${account?.subGroup || ""}`.toLowerCase();
  return account?.type === "asset" && /cash|bank|m-?pesa|mobile|wallet|petty|till|collection/.test(text);
};



const syncLinkedProcessedStatementForVoucher = async ({ voucher, businessId = null } = {}) => {
  // Prefer the dedicated field; fall back to legacy reference-as-ObjectId for old records.
  const referenceId = String(
    voucher?.sourceProcessedStatement || voucher?.reference || ""
  ).trim();
  if (!referenceId || !mongoose.Types.ObjectId.isValid(referenceId)) return null;

  try {
    return await syncProcessedStatementSettlementState({
      statementId: referenceId,
      businessId: businessId || voucher?.business || null,
    });
  } catch (error) {
    console.error("Failed to sync processed statement after voucher change:", error);
    return null;
  }
};

const populateVoucherQuery = (query) =>
  query
    .populate("property", "propertyName name")
    .populate("landlord", "name landlordName")
    .populate("approvedBy", "surname otherNames email")
    .populate("paidBy", "surname otherNames email")
    .populate("reversedBy", "surname otherNames email")
    .populate("liabilityAccount", "code name type accountType nature accountNature")
    .populate("debitAccount", "code name type accountType nature accountNature")
    .populate("settlementAccount", "code name type accountType nature accountNature group subGroup")
    .populate("expenseRecord", "property unit category amount description date receiptNumber receiptImage paidBy paymentMethod cashbook")
    .populate("sourceRequisition", "requisitionNo referenceNo status title amount property linkedVoucher");

const createExpenseRecordForVoucher = async (voucher, { statementDate = null } = {}) => {
  const expenseCategory = getExpenseCategory(voucher.category);
  if (!expenseCategory || !LANDLORD_STATEMENT_CATEGORIES.has(String(voucher.category || ""))) return null;

  const effectiveDate = normalizeDate(resolveVoucherPostingDate({ voucher, statementDate }));
  const description = String(voucher.narration || voucher.reference || `Payment voucher ${voucher.voucherNo}`).trim();

  if (voucher.expenseRecord) {
    const existingExpense = await ExpenseProperty.findById(voucher.expenseRecord);
    if (!existingExpense) return null;

    let dirty = false;
    if (String(existingExpense.property || "") !== String(voucher.property || "")) {
      existingExpense.property = voucher.property;
      dirty = true;
    }
    if (String(existingExpense.business || "") !== String(voucher.business || "")) {
      existingExpense.business = voucher.business;
      dirty = true;
    }
    if (existingExpense.category !== expenseCategory) {
      existingExpense.category = expenseCategory;
      dirty = true;
    }
    if (Number(existingExpense.amount || 0) !== Number(voucher.amount || 0)) {
      existingExpense.amount = Number(voucher.amount || 0);
      dirty = true;
    }
    if (String(existingExpense.description || "").trim() !== description) {
      existingExpense.description = description;
      dirty = true;
    }
    if (normalizeDate(existingExpense.date).getTime() !== effectiveDate.getTime()) {
      existingExpense.date = effectiveDate;
      dirty = true;
    }

    if (dirty) await existingExpense.save();
    return existingExpense.toObject();
  }

  const expense = await ExpenseProperty.create({
    property: voucher.property,
    category: expenseCategory,
    amount: Number(voucher.amount || 0),
    description,
    date: effectiveDate,
    business: voucher.business,
  });

  return expense;
};

const resolveVoucherSourceRequisition = async ({
  businessId,
  requisitionId = null,
  propertyId = null,
  currentVoucherId = null,
}) => {
  if (!requisitionId || !isValidObjectId(requisitionId)) {
    return null;
  }

  const requisition = await ExpenseRequisition.findOne({
    _id: requisitionId,
    business: businessId,
  });

  if (!requisition) {
    throw new Error("Source expense requisition was not found.");
  }

  if (!["approved", "converted"].includes(String(requisition.status || ""))) {
    throw new Error("Only approved expense requisitions can be converted into payment vouchers.");
  }

  if (propertyId && String(requisition.property || "") !== String(propertyId || "")) {
    throw new Error("Selected property must match the approved source requisition.");
  }

  if (requisition.linkedVoucher) {
    const sameVoucher = currentVoucherId && String(requisition.linkedVoucher) === String(currentVoucherId);
    if (!sameVoucher) {
      const linkedVoucher = await PaymentVoucher.findOne({
        _id: requisition.linkedVoucher,
        business: businessId,
      })
        .select("_id status voucherNo")
        .lean();

      if (linkedVoucher && linkedVoucher.status !== "reversed") {
        throw new Error(`Expense requisition ${requisition.requisitionNo || requisition.referenceNo} is already linked to voucher ${linkedVoucher.voucherNo}.`);
      }
    }
  }

  return requisition;
};

const syncRequisitionAfterVoucherLink = async ({ requisition, voucher, actorUserId = null }) => {
  if (!requisition || !voucher) return;
  requisition.linkedVoucher = voucher._id;
  requisition.status = "converted";
  requisition.convertedAt = new Date();
  requisition.convertedBy = actorUserId || requisition.convertedBy || null;
  await requisition.save();
};

const releaseSourceRequisitionFromVoucher = async ({ voucher, businessId }) => {
  if (!voucher?.sourceRequisition) return;

  const requisition = await ExpenseRequisition.findOne({
    _id: voucher.sourceRequisition,
    business: businessId,
  });

  if (!requisition) return;
  if (String(requisition.linkedVoucher || "") !== String(voucher._id || "")) return;

  requisition.linkedVoucher = null;
  if (requisition.status === "converted") {
    requisition.status = "approved";
  }
  requisition.convertedAt = null;
  requisition.convertedBy = null;
  await requisition.save();
};

const deleteExpenseRecordForVoucher = async (voucher) => {
  if (voucher?.expenseRecord && isValidObjectId(voucher.expenseRecord)) {
    await ExpenseProperty.findByIdAndDelete(voucher.expenseRecord);
    return;
  }

  const expenseCategory = getExpenseCategory(voucher?.category);
  if (!expenseCategory) return;

  await ExpenseProperty.findOneAndDelete({
    property: voucher.property,
    business: voucher.business,
    category: expenseCategory,
    amount: Number(voucher.amount || 0),
    description: String(voucher.narration || voucher.reference || `Payment voucher ${voucher.voucherNo}`).trim(),
  });
};

const reverseVoucherLedgerEntries = async ({ voucher, userId, reason }) => {
  const originalEntries = await FinancialLedgerEntry.find({
    business: voucher.business,
    sourceTransactionType: "payment_voucher",
    sourceTransactionId: String(voucher._id),
    $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    status: "approved",
  }).select("_id accountId journalGroupId metadata").lean();

  if (!originalEntries.length) return [];

  const reversalResults = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const entry of originalEntries) {
        const result = await postReversal({
          entryId: entry._id,
          reason: reason || `Voucher ${voucher.voucherNo} reversed`,
          userId,
          session,
        });
        reversalResults.push(result);
      }
    });
  } finally {
    await session.endSession();
  }

  const touchedAccountIds = new Set();
  originalEntries.forEach((entry) => {
    if (entry?.accountId) touchedAccountIds.add(String(entry.accountId));
  });
  reversalResults.forEach((result) => {
    if (result?.reversalEntry?.accountId) {
      touchedAccountIds.add(String(result.reversalEntry.accountId));
    }
  });

  if (touchedAccountIds.size > 0) {
    await aggregateChartOfAccountBalances(voucher.business, Array.from(touchedAccountIds));
  }

  return reversalResults;
};

const ensureVoucherAccrualPosting = async ({ voucher, actorUserId, statementDate = null }) => {
  // If the voucher was created from a requisition that already generated GL entries,
  // skip the accrual step — expense + AP liability were already posted at requisition approval.
  if (voucher.sourceRequisition) {
    const reqGlCount = await FinancialLedgerEntry.countDocuments({
      business: voucher.business,
      sourceTransactionType: "expense_requisition",
      sourceTransactionId: String(voucher.sourceRequisition),
      status: "approved",
    });
    if (reqGlCount > 0) {
      return { voucher, entries: [], expenseRecord: voucher.expenseRecord || null, journalGroupId: voucher.journalGroupId || null, reused: false, skippedForRequisition: true };
    }
  }

  const existingEntries = await FinancialLedgerEntry.find({
    business: voucher.business,
    sourceTransactionType: "payment_voucher",
    sourceTransactionId: String(voucher._id),
    $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    status: "approved",
  }).select("_id accountId journalGroupId").lean();

  if (existingEntries.length > 0) {
    return {
      voucher,
      entries: existingEntries,
      expenseRecord: voucher.expenseRecord || null,
      journalGroupId: existingEntries[0]?.journalGroupId || voucher.journalGroupId || null,
      reused: true,
    };
  }

  const accountingContext = await resolveVoucherLandlordContext({
    propertyId: voucher.property || null,
    landlordId: voucher.landlord || null,
    businessId: voucher.business,
    voucherCategory: voucher.category,
  });

  const liabilityAccount = await ensureLiabilityAccount({
    businessId: voucher.business,
    liabilityAccountId: voucher.liabilityAccount,
  });

  const debitAccount = await resolveVoucherDebitAccount({
    voucher,
    businessId: voucher.business,
    accountingContext,
  });

  const postingDate = normalizeDate(resolveVoucherPostingDate({ voucher, statementDate }));

  let expenseRecord = null;
  if (voucher.category !== "deposit_refund") {
    expenseRecord = await createExpenseRecordForVoucher(voucher, { statementDate: postingDate });
  }

  const { start, end } = buildStatementPeriod(postingDate);
  const txDate = postingDate;
  const journalGroupId = new mongoose.Types.ObjectId();
  const _voucherCategoryLabel = {
    landlord_maintenance: "Landlord Maintenance",
    landlord_other: "Landlord Expense",
    deposit_refund: "Deposit Refund",
    manager_property: "Property Expense",
    company_operational: "Company Operational Expense",
    petty_cash_float: "Petty Cash Float",
    petty_cash_expense: "Petty Cash Expense",
    service_provider: "Service Provider Payment",
    landlord_advance: "Landlord Advance",
    landlord_standing_order: "Landlord Standing Order",
  }[voucher.category] || "Payment Voucher";
  const narration = String(voucher.narration || voucher.reference || `${_voucherCategoryLabel} — ${voucher.voucherNo}`).trim();
  const amount = Math.abs(Number(voucher.amount || 0));

  let debitLeg;
  try {
    const accrualBase = {
      business: accountingContext.businessId,
      property: accountingContext.propertyId || null,
      landlord: accountingContext.landlordId || null,
      allowUnscoped: Boolean(accountingContext.unscoped),
      serviceProvider: voucher.serviceProvider || null,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(voucher._id),
      transactionDate: txDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: voucher.category === "deposit_refund" ? "ADJUSTMENT" : "EXPENSE_DEDUCTION",
      amount,
      journalGroupId,
      payer: "manager",
      notes: narration,
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: new Date(),
      status: "approved",
    };

    debitLeg = await postEntry({
      ...accrualBase,
      direction: "debit",
      debit: amount,
      credit: 0,
      accountId: debitAccount._id,
      receiver: voucher.category === "deposit_refund" ? "landlord" : "vendor",
      metadata: {
        voucherNo: voucher.voucherNo,
        voucherCategory: voucher.category,
        postingRole: voucher.category === "deposit_refund" ? "landlord_payable_reduction" : ["landlord_maintenance", "landlord_other"].includes(voucher.category) ? "property_control_deduction" : "expense_or_deduction",
        includeInLandlordStatement: false,
        expenseRecordId: expenseRecord?._id ? String(expenseRecord._id) : null,
      },
    });

    const creditLeg = await postEntry({
      ...accrualBase,
      direction: "credit",
      debit: 0,
      credit: amount,
      accountId: liabilityAccount._id,
      receiver: voucher.category === "deposit_refund" ? "tenant" : "vendor",
      metadata: {
        voucherNo: voucher.voucherNo,
        voucherCategory: voucher.category,
        postingRole: "liability_accrual",
        includeInLandlordStatement: false,
        offsetOfEntryId: String(debitLeg._id),
        expenseRecordId: expenseRecord?._id ? String(expenseRecord._id) : null,
      },
    });

    voucher.landlord = accountingContext.landlordId;
    voucher.debitAccount = debitAccount._id;
    voucher.journalGroupId = journalGroupId;
    voucher.ledgerEntries = [debitLeg._id, creditLeg._id];
    voucher.expenseRecord = expenseRecord?._id || null;
    await voucher.save();

    await aggregateChartOfAccountBalances(voucher.business, [
      String(debitAccount._id),
      String(liabilityAccount._id),
    ]);

    return {
      voucher,
      entries: [debitLeg, creditLeg],
      expenseRecord,
      journalGroupId,
      reused: false,
    };
  } catch (error) {
    if (debitLeg?._id) {
      await postReversal({ entryId: debitLeg._id, reason: `Auto-reversal: GL balance protection for voucher accrual ${voucher.voucherNo}`, userId: actorUserId }).catch(() => null);
    }
    if (expenseRecord?._id) {
      await ExpenseProperty.findByIdAndDelete(expenseRecord._id).catch(() => null);
    }
    throw error;
  }
};

const ensureVoucherSettlementPosting = async ({ voucher, actorUserId, paidDate = null }) => {
  const existingSettlementEntries = await FinancialLedgerEntry.find({
    business: voucher.business,
    sourceTransactionType: "payment_voucher",
    sourceTransactionId: String(voucher._id),
    $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
    status: "approved",
    "metadata.postingRole": { $in: ["liability_settlement", "cashbook_outflow"] },
  }).select("_id accountId journalGroupId metadata").lean();

  if (existingSettlementEntries.length > 0) {
    return {
      voucher,
      entries: existingSettlementEntries,
      journalGroupId: existingSettlementEntries[0]?.journalGroupId || null,
      reused: true,
    };
  }

  const [liabilityAccount, settlementAccount, accountingContext] = await Promise.all([
    ensureLiabilityAccount({
      businessId: voucher.business,
      liabilityAccountId: voucher.liabilityAccount,
    }),
    ensureSettlementAccount({
      businessId: voucher.business,
      settlementAccountId: voucher.settlementAccount,
    }),
    resolveVoucherLandlordContext({
      propertyId: voucher.property || null,
      landlordId: voucher.landlord || null,
      businessId: voucher.business,
      voucherCategory: voucher.category,
    }),
  ]);

  const txDate = normalizeDate(paidDate || voucher.paidDate || voucher.paidAt || new Date());
  const { start, end } = buildStatementPeriod(txDate);
  const journalGroupId = voucher.journalGroupId || new mongoose.Types.ObjectId();
  const _voucherCategoryLabel = {
    landlord_maintenance: "Landlord Maintenance",
    landlord_other: "Landlord Expense",
    deposit_refund: "Deposit Refund",
    manager_property: "Property Expense",
    company_operational: "Company Operational Expense",
    petty_cash_float: "Petty Cash Float",
    petty_cash_expense: "Petty Cash Expense",
    service_provider: "Service Provider Payment",
    landlord_advance: "Landlord Advance",
    landlord_standing_order: "Landlord Standing Order",
  }[voucher.category] || "Payment Voucher";
  const narration = String(voucher.narration || voucher.reference || `${_voucherCategoryLabel} — ${voucher.voucherNo}`).trim();
  const amount = Math.abs(Number(voucher.amount || 0));
  const whtAmount = Math.max(0, Math.round(Number(voucher.whtAmount || 0) * 100) / 100);
  const netCashAmount = Math.max(0, Math.round((amount - whtAmount) * 100) / 100);

  const baseEntry = {
    business: accountingContext.businessId,
    property: accountingContext.propertyId || null,
    landlord: accountingContext.landlordId || null,
    allowUnscoped: Boolean(accountingContext.unscoped),
    serviceProvider: voucher.serviceProvider || null,
    sourceTransactionType: "payment_voucher",
    sourceTransactionId: String(voucher._id),
    transactionDate: txDate,
    statementPeriodStart: start,
    statementPeriodEnd: end,
    category: voucher.category === "petty_cash_float" ? "ADJUSTMENT" : "EXPENSE_DEDUCTION",
    journalGroupId,
    payer: "manager",
    receiver: "vendor",
    notes: narration,
    createdBy: actorUserId,
    approvedBy: actorUserId,
    approvedAt: new Date(),
    status: "approved",
  };

  let debitLeg, creditLeg, whtLeg;
  try {
    debitLeg = await postEntry({
      ...baseEntry,
      amount,
      direction: "debit",
      accountId: liabilityAccount._id,
      metadata: {
        voucherNo: voucher.voucherNo,
        voucherCategory: voucher.category,
        postingRole: "liability_settlement",
        includeInLandlordStatement: false,
      },
    });

    // Cr Cashbook — net cash paid to vendor (gross - WHT if applicable)
    creditLeg = await postEntry({
      ...baseEntry,
      amount: whtAmount > 0 ? netCashAmount : amount,
      direction: "credit",
      accountId: settlementAccount._id,
      metadata: {
        voucherNo: voucher.voucherNo,
        voucherCategory: voucher.category,
        postingRole: "cashbook_outflow",
        includeInLandlordStatement: false,
        offsetOfEntryId: String(debitLeg._id),
      },
    });

    // Cr WHT Payable — tax withheld from vendor
    whtLeg = null;
    const touchedAccounts = [String(liabilityAccount._id), String(settlementAccount._id)];
    if (whtAmount > 0) {
      const whtAccount = voucher.whtAccountId
        ? await ChartOfAccount.findById(voucher.whtAccountId).lean()
        : await findSystemAccountByCode(String(accountingContext.businessId), "2141").catch(() => null);

      if (whtAccount) {
        whtLeg = await postEntry({
          ...baseEntry,
          amount: whtAmount,
          direction: "credit",
          accountId: whtAccount._id,
          metadata: {
            voucherNo: voucher.voucherNo,
            voucherCategory: voucher.category,
            postingRole: "wht_payable",
            includeInLandlordStatement: false,
          },
        });
        touchedAccounts.push(String(whtAccount._id));
      } else {
        console.warn("[PaymentVoucher] WHT Payable account (2141) not found for business=%s — WHT leg skipped", accountingContext.businessId);
      }
    }

    voucher.journalGroupId = journalGroupId;
    voucher.ledgerEntries = Array.from(new Set([
      ...(Array.isArray(voucher.ledgerEntries) ? voucher.ledgerEntries.map((entry) => String(entry)) : []),
      String(debitLeg._id),
      String(creditLeg._id),
      ...(whtLeg ? [String(whtLeg._id)] : []),
    ]));
    await voucher.save();

    await aggregateChartOfAccountBalances(voucher.business, touchedAccounts);

    return {
      voucher,
      entries: [debitLeg, creditLeg, ...(whtLeg ? [whtLeg] : [])],
      journalGroupId,
      reused: false,
    };
  } catch (error) {
    const rollbackIds = [debitLeg?._id, creditLeg?._id, whtLeg?._id].filter(Boolean);
    for (const id of rollbackIds) {
      await postReversal({ entryId: id, reason: `Auto-reversal: GL balance protection for voucher settlement ${voucher.voucherNo}`, userId: actorUserId }).catch(() => null);
    }
    throw error;
  }
};

export const createPaymentVoucher = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "User must have a company context"));
    }

    const voucherCategory = String(req.body?.category || "").trim();
    if (!voucherCategory) {
      return next(createError(400, "Voucher category is required"));
    }

    if (voucherRequiresProperty(voucherCategory) && (!req.body?.property || !isValidObjectId(req.body.property))) {
      return next(createError(400, "Property is required for this voucher category"));
    }

    if (!voucherRequiresProperty(voucherCategory) && req.body?.property && !isValidObjectId(req.body.property)) {
      return next(createError(400, "Invalid property supplied"));
    }

    if (voucherRequiresExplicitDebitAccount(voucherCategory) && (!req.body?.debitAccount || !isValidObjectId(req.body.debitAccount))) {
      return next(createError(400, "Debit posting account is required for this voucher category"));
    }

    if (!req.body?.liabilityAccount || !isValidObjectId(req.body.liabilityAccount)) {
      return next(createError(400, "Liability posting account is required"));
    }

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return next(createError(400, "Valid voucher amount is required"));
    }

    const sourceRequisition = await resolveVoucherSourceRequisition({
      businessId,
      requisitionId: req.body?.sourceRequisition || null,
      propertyId: req.body?.property || null,
    });

    const voucherNo = await generateVoucherNo(businessId);
    const accountingContext = await resolveVoucherLandlordContext({
      businessId,
      propertyId: req.body?.property || null,
      landlordId: req.body?.landlord || null,
      voucherCategory,
    });

    const whtAmt = Math.max(0, Math.round(Number(req.body?.whtAmount || 0) * 100) / 100);
    const payload = {
      category: voucherCategory,
      property: req.body?.property || null,
      landlord: accountingContext.landlordId || null,
      liabilityAccount: req.body.liabilityAccount,
      debitAccount: req.body?.debitAccount || null,
      settlementAccount: req.body?.settlementAccount || null,
      amount,
      whtAmount:    whtAmt,
      whtNetAmount: Math.max(0, Math.round((amount - whtAmt) * 100) / 100),
      whtAccountId: req.body?.whtAccountId || null,
      serviceProvider: req.body?.serviceProvider && isValidObjectId(req.body.serviceProvider) ? req.body.serviceProvider : null,
      dueDate: req.body.dueDate,
      paidDate: req.body.paidDate || null,
      reference: req.body.reference,
      narration: req.body.narration,
      status: req.body.status || "draft",
      voucherNo,
      business: businessId,
      sourceRequisition: sourceRequisition?._id || null,
    };

    const voucher = await new PaymentVoucher(payload).save();
    const actorUserId = await resolveActorUserId(req, businessId);

    if (sourceRequisition) {
      await syncRequisitionAfterVoucherLink({
        requisition: sourceRequisition,
        voucher,
        actorUserId,
      });
    }

    if (voucher.status === "approved" || voucher.status === "paid") {
      const postingDate = voucher.status === "paid"
        ? normalizeDate(voucher.paidDate || new Date())
        : new Date();

      if (voucher.status === "approved") {
        voucher.approvedBy = actorUserId;
        voucher.approvedAt = voucher.approvedAt || postingDate;
      }

      if (voucher.status === "paid") {
        voucher.approvedBy = voucher.approvedBy || actorUserId;
        voucher.approvedAt = voucher.approvedAt || postingDate;
        voucher.paidBy = actorUserId;
        voucher.paidAt = voucher.paidAt || postingDate;
        voucher.paidDate = voucher.paidDate || postingDate;
      }

      await ensureVoucherAccrualPosting({ voucher, actorUserId, statementDate: postingDate });
      if (voucher.status === "paid") {
        await ensureVoucherSettlementPosting({ voucher, actorUserId, paidDate: postingDate });
      }
      await voucher.save();
    }

    emitToCompany(businessId, "voucher:new", { voucherId: voucher._id });
    const populated = await populateVoucherQuery(PaymentVoucher.findById(voucher._id)).lean();
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const getPaymentVouchers = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    const { category, status, property, landlord, search } = req.query;
    const filter = { business };

    if (category) filter.category = category;
    if (status) filter.status = status;
    if (property) filter.property = property;
    if (landlord) filter.landlord = landlord;

    if (search) {
      const term = String(search).trim();
      filter.$or = [
        { voucherNo: { $regex: term, $options: "i" } },
        { reference: { $regex: term, $options: "i" } },
        { narration: { $regex: term, $options: "i" } },
      ];
    }

    const { page: pageNum, limit: limitNum, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const [rows, total] = await Promise.all([
      populateVoucherQuery(
        PaymentVoucher.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum)
      ).lean(),
      PaymentVoucher.countDocuments(filter),
    ]);

    res.status(200).json({ success: true, data: rows, total, page: pageNum, pages: Math.max(1, Math.ceil(total / limitNum)) });
  } catch (err) {
    next(err);
  }
};

export const getPaymentVoucher = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    const row = await populateVoucherQuery(
      PaymentVoucher.findOne({ _id: req.params.id, business })
    ).lean();

    if (!row) return next(createError(404, "Payment voucher not found"));
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
};

export const updatePaymentVoucher = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    const allowedFields = [
      "category",
      "property",
      "landlord",
      "liabilityAccount",
      "debitAccount",
      "settlementAccount",
      "amount",
      "dueDate",
      "paidDate",
      "reference",
      "narration",
      "sourceRequisition",
    ];

    const payload = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.prototype.hasOwnProperty.call(payload, "landlord") && !payload.landlord) {
      payload.landlord = null;
    }

    const existing = await PaymentVoucher.findOne({ _id: req.params.id, business }).lean();
    if (!existing) return next(createError(404, "Payment voucher not found"));

    if (existing.status !== "draft") {
      return next(createError(400, "Only draft vouchers can be edited."));
    }

    const requestedSourceRequisitionId = Object.prototype.hasOwnProperty.call(payload, "sourceRequisition")
      ? payload.sourceRequisition
      : existing.sourceRequisition;

    if (existing.sourceRequisition && Object.prototype.hasOwnProperty.call(payload, "sourceRequisition")) {
      payload.sourceRequisition = existing.sourceRequisition;
    }

    const effectiveCategory = payload.category || existing.category || "";
    const propertyId = Object.prototype.hasOwnProperty.call(payload, "property")
      ? payload.property || null
      : existing.property || null;

    if (voucherRequiresProperty(effectiveCategory) && !isValidObjectId(propertyId)) {
      return next(createError(400, "Property is required for this voucher category."));
    }

    if (voucherRequiresExplicitDebitAccount(effectiveCategory) && !isValidObjectId(payload.debitAccount || existing.debitAccount || null)) {
      return next(createError(400, "Debit posting account is required for this voucher category."));
    }
    const sourceRequisition = await resolveVoucherSourceRequisition({
      businessId: business,
      requisitionId: requestedSourceRequisitionId || null,
      propertyId,
      currentVoucherId: existing._id,
    });

    const accountingContext = await resolveVoucherLandlordContext({
      businessId: business,
      propertyId: propertyId || null,
      landlordId: payload.landlord || existing.landlord || null,
      voucherCategory: payload.category || existing.category || "",
    });

    payload.landlord = accountingContext.landlordId || null;
    payload.sourceRequisition = sourceRequisition?._id || existing.sourceRequisition || null;

    const updated = await populateVoucherQuery(
      PaymentVoucher.findOneAndUpdate(
        { _id: req.params.id, business },
        { $set: payload },
        { new: true }
      )
    ).lean();

    if (sourceRequisition) {
      const actorUserId = await resolveActorUserId(req, business);
      await syncRequisitionAfterVoucherLink({
        requisition: sourceRequisition,
        voucher: updated,
        actorUserId,
      });
    }

    emitToCompany(updated.business, "voucher:updated", { voucherId: updated._id });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

export const updatePaymentVoucherStatus = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    const { status, reason } = req.body || {};
    if (!["draft", "approved", "paid", "reversed"].includes(status)) {
      return next(createError(400, "Invalid status"));
    }

    const voucher = await PaymentVoucher.findOne({ _id: req.params.id, business });
    if (!voucher) return next(createError(404, "Payment voucher not found"));

    const actorUserId = await resolveActorUserId(req, business);

    if (status === "draft") {
      if (voucher.status !== "draft") {
        return next(createError(400, "Approved, paid, or reversed vouchers cannot be moved back to draft."));
      }
      voucher.status = "draft";
    }

    if (status === "approved") {
      if (voucher.status === "reversed") {
        return next(createError(400, "Reversed vouchers cannot be approved again."));
      }
      if (voucher.status === "paid") {
        return next(createError(400, "Paid vouchers are already fully processed."));
      }

      const approvalDate = new Date();
      voucher.approvedAt = approvalDate;
      voucher.approvedBy = actorUserId;
      await ensureVoucherAccrualPosting({ voucher, actorUserId, statementDate: approvalDate });
      voucher.status = "approved";
    }

    if (status === "paid") {
      if (voucher.status === "reversed") {
        return next(createError(400, "Reversed vouchers cannot be marked as paid."));
      }

      // Allow settlement account to be provided inline (e.g. from the "Mark Paid" quick modal)
      const inlineSettlementId = req.body?.settlementAccount || null;
      if (inlineSettlementId && isValidObjectId(inlineSettlementId) && !voucher.settlementAccount) {
        voucher.settlementAccount = inlineSettlementId;
      }

      if (!voucher.settlementAccount || !isValidObjectId(voucher.settlementAccount)) {
        return next(createError(400, "Select a settlement cashbook account on the voucher before marking it as paid."));
      }

      const paidDate = normalizeDate(req.body?.paidDate || new Date());
      voucher.approvedAt = voucher.approvedAt || paidDate;
      voucher.approvedBy = voucher.approvedBy || actorUserId;
      voucher.paidAt = paidDate;
      voucher.paidBy = actorUserId;
      voucher.paidDate = paidDate;
      await ensureVoucherAccrualPosting({ voucher, actorUserId, statementDate: voucher.approvedAt || paidDate });
      await ensureVoucherSettlementPosting({ voucher, actorUserId, paidDate });
      voucher.status = "paid";
    }

    if (status === "reversed") {
      if (voucher.status === "reversed") {
        return next(createError(400, "Voucher already reversed"));
      }

      await reverseVoucherLedgerEntries({
        voucher,
        userId: actorUserId,
        reason: reason || "Voucher reversed",
      });

      await deleteExpenseRecordForVoucher(voucher);

      voucher.status = "reversed";
      voucher.reversedAt = new Date();
      voucher.reversedBy = actorUserId;
      voucher.reversalReason = reason || "Voucher reversed";
      voucher.expenseRecord = null;

      await releaseSourceRequisitionFromVoucher({ voucher, businessId: business });
    }

    await voucher.save();
    await syncLinkedProcessedStatementForVoucher({ voucher, businessId: business });

    const updated = await populateVoucherQuery(PaymentVoucher.findById(voucher._id)).lean();

    emitToCompany(updated.business, "voucher:status", {
      voucherId: updated._id,
      status,
    });

    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
};

export const deletePaymentVoucher = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    const row = await PaymentVoucher.findOne({ _id: req.params.id, business });
    if (!row) return next(createError(404, "Payment voucher not found"));

    if (row.status !== "draft") {
      const actorUserId = await resolveActorUserId(req, business);

      if (row.status === "reversed") {
        // Already reversed — financial entries already undone; safe to hard-delete the voucher row.
        await deleteExpenseRecordForVoucher(row);
        await releaseSourceRequisitionFromVoucher({ voucher: row, businessId: business });
        await PaymentVoucher.findOneAndDelete({ _id: req.params.id, business });
        await syncLinkedProcessedStatementForVoucher({ voucher: row, businessId: business });
        emitToCompany(row.business, "voucher:deleted", { voucherId: row._id });
        return res.status(200).json({ success: true, message: "Reversed payment voucher deleted" });
      }

      // approved or paid — reverse the GL entries first, keep the row for audit trail
      await reverseVoucherLedgerEntries({
        voucher: row,
        userId: actorUserId,
        reason: `Voucher ${row.voucherNo} removed from active voucher list`,
      });

      row.status = "reversed";
      row.reversedAt = new Date();
      row.reversedBy = actorUserId;
      row.reversalReason = `Voucher removed from active list instead of hard deletion for audit safety.`;

      await deleteExpenseRecordForVoucher(row);
      await releaseSourceRequisitionFromVoucher({ voucher: row, businessId: business });
      await row.save();
      await syncLinkedProcessedStatementForVoucher({ voucher: row, businessId: business });

      emitToCompany(row.business, "voucher:reversed", { voucherId: row._id });

      return res.status(200).json({
        success: true,
        message: "Posted voucher reversed and retained in the audit trail. Draft vouchers only are physically deleted.",
        voucher: row,
      });
    }

    await releaseSourceRequisitionFromVoucher({ voucher: row, businessId: business });

    await PaymentVoucher.findOneAndDelete({ _id: req.params.id, business });
    await syncLinkedProcessedStatementForVoucher({ voucher: row, businessId: business });
    emitToCompany(row.business, "voucher:deleted", { voucherId: row._id });

    return res.status(200).json({ success: true, message: "Draft payment voucher deleted" });
  } catch (err) {
    next(err);
  }
};
