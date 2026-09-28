import mongoose from "mongoose";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import Company from "../../models/Company.js";
import ExpenseRequisition from "../../models/ExpenseRequisition.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
// models this controller populates: imported here so the refs are always registered, whatever else has been loaded
import "../../models/Property.js";
import "../../models/Landlord.js";
import "../../models/User.js";
import "../../models/ServiceProvider.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { ensureSystemChartOfAccounts } from "../../services/chartOfAccountsService.js";
import {
  resolvePropertyAccountingContext,
  resolveLandlordRemittancePayableAccount,
  ensurePropertyControlAccount,
} from "../../services/propertyAccountingService.js";
import { syncProcessedStatementSettlementState } from "../../services/processedStatementSettlementService.js";
import { createError } from "../../utils/error.js";
import { hasCompanyActionPermission } from "../../utils/permissionControl.js";
import { escapeRegex } from "../../utils/escapeRegex.js";
import { resolveWhtPayableAccount } from "../../services/withholdingTaxService.js";
import { assertVoucherReferenceUnused } from "../../services/voucherReference.js";
import { cleanVoucherReference, voucherReferenceKey } from "../../utils/voucherReference.js";
import { parsePagination } from "../../utils/pagination.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const VOUCHER_CATEGORIES = PaymentVoucher.schema.path("category").enumValues;
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const MAX_VOUCHER_AMOUNT = 1e12;
const roundMoney = (value) => Math.round(Number(value) * 100) / 100;

const optionalId = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const raw = typeof value === "object" && value?._id ? value._id : value;
  if (!OBJECT_ID.test(String(raw))) throw createError(400, `Invalid ${label}.`);
  return String(raw);
};

const optionalDate = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object" && !(value instanceof Date)) throw createError(400, `${label} is not a valid date.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000 || date.getFullYear() > 2100) throw createError(400, `${label} is not a valid date.`);
  return date;
};

// a payment can't have been made tomorrow (a day of slack for time zones)
const assertNotFuture = (date, label) => {
  if (date && date.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw createError(400, `${label} cannot be in the future.`);
};

const cleanText = (value, max, label) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") throw createError(400, `${label} is not valid.`);
  const text = String(value).trim();
  if (text.length > max) throw createError(400, `${label} is too long (at most ${max} characters).`);
  return text;
};

/** Validates and normalises the voucher fields present in a request body. Only fields that were sent are returned. */
const sanitizeVoucherFields = (body = {}) => {
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const out = {};

  if (has("category")) {
    const category = String(body.category || "").trim();
    if (category && !VOUCHER_CATEGORIES.includes(category)) throw createError(400, "Invalid voucher category");
    out.category = category;
  }
  for (const [key, label] of [
    ["property", "property"], ["landlord", "landlord"], ["liabilityAccount", "liability account"], ["debitAccount", "debit account"],
    ["settlementAccount", "settlement account"], ["whtAccountId", "withholding tax account"], ["sourceRequisition", "source requisition"],
    ["serviceProvider", "service provider"],
  ]) {
    if (has(key)) out[key] = optionalId(body[key], label);
  }
  if (has("amount")) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_VOUCHER_AMOUNT) throw createError(400, "Valid voucher amount is required");
    out.amount = roundMoney(amount);
  }
  if (has("whtAmount")) {
    const wht = Number(body.whtAmount || 0);
    if (!Number.isFinite(wht) || wht < 0 || wht > MAX_VOUCHER_AMOUNT) throw createError(400, "Withholding tax amount is not valid");
    out.whtAmount = roundMoney(wht);
  }
  if (has("dueDate")) {
    out.dueDate = optionalDate(body.dueDate, "Due date");
    if (!out.dueDate) throw createError(400, "Due date is required");
  }
  if (has("paidDate")) {
    out.paidDate = optionalDate(body.paidDate, "Paid date");
    assertNotFuture(out.paidDate, "Paid date");
  }
  if (has("reference")) {
    cleanText(body.reference, 100, "Reference");
    out.reference = cleanVoucherReference(body.reference);
  }
  if (has("narration")) out.narration = cleanText(body.narration, 1000, "Narration");
  if (has("payeeName")) out.payeeName = cleanText(body.payeeName, 150, "Payee name");
  return out;
};

/**
 * Runs a voucher edit / status change / removal while holding a short "processing" claim on the voucher, so a double click
 * (or two users) can't post the same voucher, or reverse it, twice at the same moment.
 */
const withVoucherLock = (handler) => async (req, res, next) => {
  let claimedId = null;
  try {
    if (!OBJECT_ID.test(String(req.params?.id || ""))) return next(createError(404, "Payment voucher not found"));
    const business = await resolveBusinessId(req);
    if (business) {
      const claimed = await PaymentVoucher.findOneAndUpdate(
        { _id: req.params.id, business, $or: [{ processingAt: null }, { processingAt: { $lt: new Date(Date.now() - 60 * 1000) } }] },
        { $set: { processingAt: new Date() } },
        { new: true, timestamps: false }
      ).select("_id").lean();
      if (claimed) claimedId = claimed._id;
      else if (await PaymentVoucher.exists({ _id: req.params.id, business })) {
        return next(createError(409, "This voucher is being processed by another request. Wait a moment and try again."));
      }
    }
  } catch (err) {
    return next(err);
  }
  // the claim is let go BEFORE the response goes out, so a follow-up request sent the moment this one returns never finds it held
  let released = false;
  const release = async () => {
    if (released || !claimedId) return;
    released = true;
    await PaymentVoucher.updateOne({ _id: claimedId }, { $set: { processingAt: null } }, { timestamps: false }).catch(() => null);
  };
  const sendJson = res.json.bind(res);
  res.json = (body) => { release().then(() => sendJson(body)); return res; };
  try {
    await handler(req, res, (err) => release().then(() => next(err)));
  } finally {
    await release();
  }
};

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

// req.user.company is always trusted first — a client-supplied business/company
// value is only used as a fallback for requests with no authenticated company
// context (mirrors resolveBusinessId in controllers/propertyController/
// statementController.js). Previously the client-supplied value was checked
// FIRST, so any authenticated user could read/create/approve/pay another
// company's payment vouchers just by passing its id.
const resolveBusinessId = async (req) => {
  const direct =
    req?.user?.company?._id ||
    req?.user?.company ||
    req?.query?.business ||
    req?.query?.company ||
    req?.body?.business ||
    req?.body?.company ||
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

// A switched-off account takes no new postings: say so up front, before any leg of the voucher is written.
const assertAccountActive = (account, label) => {
  if (account?.active === false || account?.isActive === false) {
    throw createError(400, `${label} ${account.code || ""} ${account.name || ""} is inactive. Reactivate it in Chart of Accounts or choose another account.`.replace(/s+/g, " "));
  }
  return account;
};

const ensureLiabilityAccount = async ({ businessId, liabilityAccountId }) => {
  if (!liabilityAccountId || !isValidObjectId(liabilityAccountId)) {
    throw createError(400, "A valid liability posting account is required.");
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
    throw createError(400, "Selected liability posting account was not found for this business.");
  }

  return assertAccountActive(account, "Liability account");
};

const ensureExplicitDebitAccount = async ({ businessId, debitAccountId, voucherCategory }) => {
  if (!debitAccountId || !isValidObjectId(debitAccountId)) {
    throw createError(400, "A valid debit posting account is required for this voucher category.");
  }

  const account = await ChartOfAccount.findOne({
    _id: debitAccountId,
    business: businessId,
    isPosting: { $ne: false },
  }).lean();

  if (!account) {
    throw createError(400, "Selected debit posting account was not found for this business.");
  }

  const normalizedCategory = String(voucherCategory || "");
  if (normalizedCategory === "petty_cash_float") {
    if (account.type !== "asset" || !isCashbookLikeAccount(account)) {
      throw createError(400, "Petty cash float vouchers must debit a petty-cash or cashbook asset account.");
    }
    return assertAccountActive(account, "Debit account");
  }

  if (account.type !== "expense") {
    throw createError(400, "Selected debit posting account must be an expense account for this voucher category.");
  }

  return assertAccountActive(account, "Expense account");
};

const ensureSettlementAccount = async ({ businessId, settlementAccountId }) => {
  if (!settlementAccountId || !isValidObjectId(settlementAccountId)) {
    throw createError(400, "A valid settlement cashbook account is required to mark a voucher as paid.");
  }

  const account = await ChartOfAccount.findOne({
    _id: settlementAccountId,
    business: businessId,
    isPosting: { $ne: false },
    type: "asset",
  }).lean();

  if (!account) {
    throw createError(400, "Selected settlement account was not found for this business.");
  }

  if (!isCashbookLikeAccount(account)) {
    throw createError(400, "Settlement account must be a cash, bank, M-Pesa, wallet, till, or petty-cash asset account.");
  }

  return assertAccountActive(account, "Settlement account");
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
      throw createError(400, "Property control account could not be resolved for this voucher.");
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
    throw createError(400, 
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
    .populate("sourceRequisition", "requisitionNo referenceNo status title amount property linkedVoucher")
    .populate("serviceProvider", "name subjectToWht whtRate");

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
    throw createError(400, "Source expense requisition was not found.");
  }

  if (!["approved", "converted"].includes(String(requisition.status || ""))) {
    throw createError(400, "Only approved expense requisitions can be converted into payment vouchers.");
  }

  if (propertyId && String(requisition.property || "") !== String(propertyId || "")) {
    throw createError(400, "Selected property must match the approved source requisition.");
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
        throw createError(400, `Expense requisition ${requisition.requisitionNo || requisition.referenceNo} is already linked to voucher ${linkedVoucher.voucherNo}.`);
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

const liveVoucherEntries = (voucher) => FinancialLedgerEntry.find({
  business: voucher.business,
  sourceTransactionType: "payment_voucher",
  sourceTransactionId: String(voucher._id),
  $or: [{ reversalOf: { $exists: false } }, { reversalOf: null }],
  status: "approved",
}).select("_id accountId").lean();

/**
 * Runs a posting step (accrual and/or settlement) so that a failure part-way leaves nothing behind: whatever legs this step
 * wrote are reversed and the voucher goes back to the fields it had, instead of sitting "paid" with half its entries.
 */
const withPostingRollback = async ({ voucher, actorUserId, work }) => {
  const before = voucher.toObject();
  const keep = new Set((await liveVoucherEntries(voucher)).map((e) => String(e._id)));
  try {
    return await work();
  } catch (error) {
    try {
      const fresh = (await liveVoucherEntries(voucher)).filter((e) => !keep.has(String(e._id)));
      for (const entry of fresh) {
        await postReversal({ entryId: entry._id, reason: `Auto-reversal: posting of voucher ${voucher.voucherNo} failed`, userId: actorUserId }).catch(() => null);
      }
      if (fresh.length) {
        await aggregateChartOfAccountBalances(voucher.business, [...new Set(fresh.map((e) => String(e.accountId)).filter(Boolean))]).catch(() => null);
      }
      if (keep.size === 0) await deleteExpenseRecordForVoucher(voucher).catch(() => null);
      await PaymentVoucher.updateOne({ _id: voucher._id }, {
        $set: {
          status: before.status,
          ledgerEntries: before.ledgerEntries || [],
          journalGroupId: before.journalGroupId || null,
          expenseRecord: before.expenseRecord || null,
          approvedAt: before.approvedAt || null,
          approvedBy: before.approvedBy || null,
          paidAt: before.paidAt || null,
          paidBy: before.paidBy || null,
          paidDate: before.paidDate || null,
        },
      });
    } catch (rollbackError) {
      console.error("[PaymentVoucher] rollback after failed posting also failed for %s:", voucher.voucherNo, rollbackError?.message);
    }
    throw error;
  }
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

  // Tax withheld is a credit leg too: without its account the entry would not balance, so refuse before posting anything.
  let whtAccount = null;
  if (whtAmount > 0) {
    if (whtAmount >= amount) throw createError(400, "Withholding tax must be less than the voucher amount.");
    whtAccount = await resolveWhtPayableAccount({ businessId: voucher.business, accountId: voucher.whtAccountId });
  }

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

    const fields = sanitizeVoucherFields(req.body || {});
    const input = { ...(req.body || {}), ...fields };

    const status = input.status === undefined || input.status === null || input.status === "" ? "draft" : input.status;
    if (!["draft", "approved", "paid"].includes(status)) {
      return next(createError(400, "A new voucher can only be saved as draft, approved or paid."));
    }

    const voucherCategory = String(input.category || "").trim();
    if (!voucherCategory) {
      return next(createError(400, "Voucher category is required"));
    }

    if (voucherRequiresProperty(voucherCategory) && (!input.property || !isValidObjectId(input.property))) {
      return next(createError(400, "Property is required for this voucher category"));
    }

    if (!voucherRequiresProperty(voucherCategory) && input.property && !isValidObjectId(input.property)) {
      return next(createError(400, "Invalid property supplied"));
    }

    if (voucherRequiresExplicitDebitAccount(voucherCategory) && (!input.debitAccount || !isValidObjectId(input.debitAccount))) {
      return next(createError(400, "Debit posting account is required for this voucher category"));
    }

    if (!input.liabilityAccount || !isValidObjectId(input.liabilityAccount)) {
      return next(createError(400, "Liability posting account is required"));
    }

    const amount = Number(input.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return next(createError(400, "Valid voucher amount is required"));
    }

    if (!input.dueDate) {
      return next(createError(400, "Due date is required"));
    }

    const sourceRequisition = await resolveVoucherSourceRequisition({
      businessId,
      requisitionId: input.sourceRequisition || null,
      propertyId: input.property || null,
    });

    const accountingContext = await resolveVoucherLandlordContext({
      businessId,
      propertyId: input.property || null,
      landlordId: input.landlord || null,
      voucherCategory,
    });

    const whtAmt = Math.max(0, Math.round(Number(input.whtAmount || 0) * 100) / 100);
    const payload = {
      category: voucherCategory,
      property: input.property || null,
      landlord: accountingContext.landlordId || null,
      liabilityAccount: input.liabilityAccount,
      debitAccount: input.debitAccount || null,
      settlementAccount: input.settlementAccount || null,
      amount,
      whtAmount:    whtAmt,
      whtNetAmount: Math.max(0, Math.round((amount - whtAmt) * 100) / 100),
      whtAccountId: input.whtAccountId || null,
      serviceProvider: input.serviceProvider && isValidObjectId(input.serviceProvider) ? input.serviceProvider : null,
      // Only kept when there's no registered service provider — that name is the
      // source of truth for the Payee display once one is linked.
      payeeName: input.serviceProvider && isValidObjectId(input.serviceProvider) ? "" : String(input.payeeName || "").trim(),
      dueDate: input.dueDate,
      paidDate: input.paidDate || null,
      narration: input.narration,
      status,
      reference: input.reference || "",
      business: businessId,
      sourceRequisition: sourceRequisition?._id || null,
    };

    const whtLimit = Number(payload.whtAmount || 0);
    if (whtLimit > 0 && whtLimit >= amount) {
      return next(createError(400, "Withholding tax must be less than the voucher amount."));
    }

    // a voucher that will be posted needs usable accounts: say so now, before it is saved
    if (status === "approved" || status === "paid") {
      await ensureLiabilityAccount({ businessId, liabilityAccountId: payload.liabilityAccount });
      if (voucherRequiresExplicitDebitAccount(voucherCategory)) {
        await ensureExplicitDebitAccount({ businessId, debitAccountId: payload.debitAccount, voucherCategory });
      }
      if (status === "paid") {
        await ensureSettlementAccount({ businessId, settlementAccountId: payload.settlementAccount });
      }
    }

    await assertVoucherReferenceUnused({ business: businessId, reference: payload.reference });

    // two people saving at once can be handed the same next number: the unique index refuses the second, which simply asks for another
    let voucher = null;
    for (let attempt = 0; attempt < 5 && !voucher; attempt += 1) {
      const voucherNo = await generateVoucherNo(businessId);
      try {
        voucher = await new PaymentVoucher({ ...payload, voucherNo }).save();
      } catch (saveError) {
        if (saveError?.code !== 11000) throw saveError;
        if (saveError?.keyPattern?.referenceKey) {
          throw createError(409, `Reference "${payload.reference}" is already used by another payment voucher. Each payment voucher must have its own reference.`);
        }
        if (!saveError?.keyPattern?.voucherNo) throw saveError;
      }
    }
    if (!voucher) throw createError(503, "Could not allocate a voucher number. Please try again.");
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

      try {
        await withPostingRollback({
          voucher,
          actorUserId,
          work: async () => {
            if (voucher.status === "paid") {
              await ensureSettlementAccount({ businessId, settlementAccountId: voucher.settlementAccount });
              await ensureLiabilityAccount({ businessId, liabilityAccountId: voucher.liabilityAccount });
            }
            await ensureVoucherAccrualPosting({ voucher, actorUserId, statementDate: postingDate });
            if (voucher.status === "paid") {
              await ensureVoucherSettlementPosting({ voucher, actorUserId, paidDate: postingDate });
            }
            await voucher.save();
          },
        });
      } catch (postingError) {
        // posting failed: don't leave a saved voucher that claims to be approved/paid with no (or half) its entries
        await releaseSourceRequisitionFromVoucher({ voucher, businessId }).catch(() => null);
        await PaymentVoucher.deleteOne({ _id: voucher._id }).catch(() => null);
        throw postingError;
      }
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

    // filters arrive from the query string: only plain, valid values are accepted (no objects, no malformed ids)
    if (category) {
      if (typeof category !== "string" || !VOUCHER_CATEGORIES.includes(category)) return next(createError(400, "Invalid category filter"));
      filter.category = category;
    }
    if (status) {
      if (typeof status !== "string" || !["draft", "approved", "paid", "reversed"].includes(status)) return next(createError(400, "Invalid status filter"));
      filter.status = status;
    } else if (req.query.includeReversed !== "true") {
      // reversed vouchers are kept for the audit trail but stay out of the working list unless asked for
      filter.status = { $ne: "reversed" };
    }
    if (property) {
      if (typeof property !== "string" || !OBJECT_ID.test(property)) return next(createError(400, "Invalid property filter"));
      filter.property = property;
    }
    if (landlord) {
      if (typeof landlord !== "string" || !OBJECT_ID.test(landlord)) return next(createError(400, "Invalid landlord filter"));
      filter.landlord = landlord;
    }

    const term = typeof search === "string" ? search.trim().slice(0, 100) : "";
    if (term) {
      const re = new RegExp(escapeRegex(term), "i");
      filter.$or = [{ voucherNo: re }, { reference: re }, { narration: re }, { payeeName: re }];
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

    if (!OBJECT_ID.test(String(req.params.id || ""))) return next(createError(404, "Payment voucher not found"));

    const row = await populateVoucherQuery(
      PaymentVoucher.findOne({ _id: req.params.id, business })
    ).lean();

    if (!row) return next(createError(404, "Payment voucher not found"));
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
};

const updatePaymentVoucherHandler = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    // sanitizeVoucherFields only ever returns the editable fields (status, ledger links and audit fields can't be set from here)
    const payload = sanitizeVoucherFields(req.body || {});
    if (Object.prototype.hasOwnProperty.call(payload, "category") && !payload.category) {
      return next(createError(400, "Voucher category is required"));
    }
    if (Object.prototype.hasOwnProperty.call(payload, "liabilityAccount") && !payload.liabilityAccount) {
      return next(createError(400, "Liability posting account is required"));
    }

    if (Object.prototype.hasOwnProperty.call(payload, "landlord") && !payload.landlord) {
      payload.landlord = null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "serviceProvider")) {
      payload.serviceProvider = payload.serviceProvider && isValidObjectId(payload.serviceProvider) ? payload.serviceProvider : null;
      // A linked service provider's own name is the source of truth for Payee display —
      // clear any free-text payeeName so the two can't disagree.
      payload.payeeName = payload.serviceProvider ? "" : String(payload.payeeName || "").trim();
    } else if (Object.prototype.hasOwnProperty.call(payload, "payeeName")) {
      payload.payeeName = String(payload.payeeName || "").trim();
    }

    const existing = await PaymentVoucher.findOne({ _id: req.params.id, business }).lean();
    if (!existing) return next(createError(404, "Payment voucher not found"));

    if (existing.status !== "draft") {
      return next(createError(400, "Only draft vouchers can be edited."));
    }

    const effectiveAmount = payload.amount ?? Number(existing.amount || 0);
    const effectiveWht = payload.whtAmount ?? Number(existing.whtAmount || 0);
    if (effectiveWht > 0 && effectiveWht >= effectiveAmount) {
      return next(createError(400, "Withholding tax must be less than the voucher amount."));
    }
    if (payload.amount !== undefined || payload.whtAmount !== undefined) {
      payload.whtNetAmount = Math.max(0, roundMoney(effectiveAmount - effectiveWht));
    }

    if (Object.prototype.hasOwnProperty.call(payload, "reference")) {
      const key = voucherReferenceKey(payload.reference);
      if (key !== (existing.referenceKey || voucherReferenceKey(existing.reference))) {
        await assertVoucherReferenceUnused({ business, reference: payload.reference, excludeId: existing._id });
      }
      payload.referenceKey = key;
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
    const [sourceRequisition, accountingContext] = await Promise.all([
      resolveVoucherSourceRequisition({
        businessId: business,
        requisitionId: requestedSourceRequisitionId || null,
        propertyId,
        currentVoucherId: existing._id,
      }),
      resolveVoucherLandlordContext({
        businessId: business,
        propertyId: propertyId || null,
        landlordId: payload.landlord || existing.landlord || null,
        voucherCategory: payload.category || existing.category || "",
      }),
    ]);

    payload.landlord = accountingContext.landlordId || null;
    payload.sourceRequisition = sourceRequisition?._id || existing.sourceRequisition || null;

    const updated = await populateVoucherQuery(
      PaymentVoucher.findOneAndUpdate(
        { _id: req.params.id, business },
        { $set: payload },
        { new: true, runValidators: true }
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

const updatePaymentVoucherStatusHandler = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    const { status } = req.body || {};
    const reason = cleanText(req.body?.reason, 500, "Reason");
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
      await withPostingRollback({
        voucher,
        actorUserId,
        work: async () => {
          await ensureVoucherAccrualPosting({ voucher, actorUserId, statementDate: approvalDate });
          voucher.status = "approved";
          await voucher.save();
        },
      });
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

      const paidDate = optionalDate(req.body?.paidDate, "Paid date") || new Date();
      assertNotFuture(paidDate, "Paid date");
      voucher.approvedAt = voucher.approvedAt || paidDate;
      voucher.approvedBy = voucher.approvedBy || actorUserId;
      voucher.paidAt = paidDate;
      voucher.paidBy = actorUserId;
      voucher.paidDate = paidDate;
      await withPostingRollback({
        voucher,
        actorUserId,
        work: async () => {
          await ensureSettlementAccount({ businessId: business, settlementAccountId: voucher.settlementAccount });
          await ensureLiabilityAccount({ businessId: business, liabilityAccountId: voucher.liabilityAccount });
          await ensureVoucherAccrualPosting({ voucher, actorUserId, statementDate: voucher.approvedAt || paidDate });
          await ensureVoucherSettlementPosting({ voucher, actorUserId, paidDate });
          voucher.status = "paid";
          await voucher.save();
        },
      });
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

const deletePaymentVoucherHandler = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return next(createError(400, "User must have a company context"));
    }

    const row = await PaymentVoucher.findOne({ _id: req.params.id, business });
    if (!row) return next(createError(404, "Payment voucher not found"));

    if (row.status !== "draft") {
      // removing a posted voucher reverses it, so it needs the same permission as an explicit reversal
      const company = req.companyContext || await Company.findById(business).select("modules").lean();
      if (!hasCompanyActionPermission({ user: req.user, company, moduleKey: "accounts", resource: "paymentVouchers", action: "reverse" })) {
        return next(createError(403, "You do not have permission to reverse payment vouchers."));
      }
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

export const updatePaymentVoucher = withVoucherLock(updatePaymentVoucherHandler);
export const updatePaymentVoucherStatus = withVoucherLock(updatePaymentVoucherStatusHandler);
export const deletePaymentVoucher = withVoucherLock(deletePaymentVoucherHandler);
