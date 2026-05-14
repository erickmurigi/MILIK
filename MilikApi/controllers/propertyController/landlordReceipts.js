import mongoose from "mongoose";
import LandlordReceipt, { RECEIPT_CATEGORIES, PAYMENT_METHODS } from "../../models/LandlordReceipt.js";
import Landlord from "../../models/Landlord.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { createError } from "../../utils/error.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { resolvePropertyAccountingContext } from "../../services/propertyAccountingService.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const escapeRegExp = (value = "") => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveBusinessId = (req) => {
  const direct =
    req?.body?.business ||
    req?.body?.businessId ||
    req?.body?.company ||
    req?.query?.business ||
    req?.query?.businessId ||
    req?.query?.company ||
    req?.user?.company?._id ||
    req?.user?.company ||
    null;
  return isValidObjectId(direct) ? String(direct) : null;
};

const normalizePaymentMethod = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (["bank transfer", "bank_transfer", "transfer", "bank"].includes(raw)) return "bank_transfer";
  if (["mobile money", "mobile_money", "mpesa", "m-pesa"].includes(raw)) return "mobile_money";
  if (["cash"].includes(raw)) return "cash";
  if (["check", "cheque"].includes(raw)) return "check";
  if (["credit card", "credit_card", "card"].includes(raw)) return "credit_card";
  return PAYMENT_METHODS.includes(raw) ? raw : "";
};

const populateQuery = (query) =>
  query
    .populate("landlord", "landlordName landlordCode email phoneNumber")
    .populate("property", "propertyName propertyCode landlords")
    .populate("createdBy", "surname otherNames email")
    .populate("updatedBy", "surname otherNames email")
    .populate("postedBy", "surname otherNames email")
    .populate("reversedBy", "surname otherNames email");

const generateReceiptNumber = async (businessId) => {
  const prefix = "LRC";
  const latest = await LandlordReceipt.findOne({
    business: businessId,
    receiptNumber: { $regex: `^${prefix}\\d+$` },
  })
    .sort({ createdAt: -1 })
    .select("receiptNumber")
    .lean();

  let nextSeq = 1;
  if (latest?.receiptNumber) {
    nextSeq = (parseInt(String(latest.receiptNumber).replace(prefix, ""), 10) || 0) + 1;
  }

  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
};

const resolveCashbookAccount = async ({ businessId, cashbook, paymentMethod }) => {
  await ensureSystemChartOfAccounts(businessId);
  const ChartOfAccount = (await import("../../models/ChartOfAccount.js")).default;

  const baseQuery = {
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
    $or: [
      { type: "asset" },
      { type: "Asset" },
      { accountType: "asset" },
      { accountType: "Asset" },
      { nature: "asset" },
      { nature: "Asset" },
      { accountNature: "asset" },
      { accountNature: "Asset" },
    ],
  };

  if (isValidObjectId(cashbook)) {
    const byId = await ChartOfAccount.findOne({ ...baseQuery, _id: cashbook }).lean();
    if (byId) return byId;
  }

  const rawCashbook = String(cashbook || "").trim();
  if (rawCashbook) {
    const safePattern = escapeRegExp(rawCashbook);
    const byText = await ChartOfAccount.findOne({
      ...baseQuery,
      $and: [
        { $or: baseQuery.$or },
        {
          $or: [
            { code: rawCashbook.toUpperCase() },
            { accountCode: rawCashbook.toUpperCase() },
            { name: { $regex: `^${safePattern}$`, $options: "i" } },
            { accountName: { $regex: `^${safePattern}$`, $options: "i" } },
          ],
        },
      ],
    }).lean();

    if (byText) return byText;
  }

  const fallbackCode = paymentMethod === "cash" ? "1100" : paymentMethod === "mobile_money" ? "1130" : "1110";
  return findSystemAccountByCode(businessId, fallbackCode);
};

const resolveCategoryAccount = async (businessId, category) => {
  await ensureSystemChartOfAccounts(businessId);
  const normalized = String(category || "").trim().toLowerCase();
  if (["owner_float", "utility_funding", "deposit_funding"].includes(normalized)) {
    return findSystemAccountByCode(businessId, "2150");
  }
  if (["expense_reimbursement", "advance_settlement"].includes(normalized)) {
    return findSystemAccountByCode(businessId, "1210");
  }
  return findSystemAccountByCode(businessId, "2110");
};

const buildPostingRole = (category) => {
  const normalized = String(category || "").trim().toLowerCase();
  if (["owner_float", "utility_funding", "deposit_funding"].includes(normalized)) return "landlord_funds_held";
  if (["expense_reimbursement", "advance_settlement"].includes(normalized)) return "landlord_recovery_clearance";
  return "landlord_current_account_credit";
};

const resolveReceiptContext = async ({ businessId, propertyId, landlordId = null }) => {
  if (!businessId || !isValidObjectId(businessId)) {
    throw createError(400, "Valid business is required.");
  }
  if (!propertyId || !isValidObjectId(propertyId)) {
    throw createError(400, "Valid property is required.");
  }

  const accountingContext = await resolvePropertyAccountingContext({
    businessId,
    propertyId,
    landlordId: isValidObjectId(landlordId) ? landlordId : null,
  });

  const landlord = await Landlord.findOne({
    _id: accountingContext.landlordId,
    company: businessId,
  })
    .select("_id landlordName landlordCode company")
    .lean();

  if (!landlord) {
    throw createError(404, "Landlord linked to the selected property was not found.");
  }

  return {
    landlord,
    landlordId: String(landlord._id),
    propertyId: String(accountingContext.propertyId),
  };
};

const buildListFilter = (req, businessId) => {
  const filter = { business: businessId };
  const { landlord, property, status, category, search } = req.query || {};

  if (isValidObjectId(landlord)) filter.landlord = landlord;
  if (isValidObjectId(property)) filter.property = property;
  if (status && ["draft", "posted", "reversed"].includes(String(status))) filter.status = status;
  if (category && RECEIPT_CATEGORIES.includes(String(category))) filter.category = category;
  if (search) {
    const pattern = escapeRegExp(String(search).trim());
    filter.$or = [
      { receiptNumber: { $regex: pattern, $options: "i" } },
      { referenceNumber: { $regex: pattern, $options: "i" } },
      { narration: { $regex: pattern, $options: "i" } },
      { linkedDocumentRef: { $regex: pattern, $options: "i" } },
    ];
  }

  return filter;
};

export const createLandlordReceipt = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const {
      landlord,
      property,
      amount,
      receiptDate,
      paymentMethod,
      cashbook,
      referenceNumber,
      narration,
      category,
      linkedDocumentType,
      linkedDocumentId,
      linkedDocumentRef,
      metadata,
    } = req.body || {};

    const { landlordId, propertyId } = await resolveReceiptContext({ businessId, propertyId: property, landlordId: landlord });

    const normalizedCategory = String(category || "").trim();
    if (!RECEIPT_CATEGORIES.includes(normalizedCategory)) {
      return next(createError(400, "A valid landlord receipt category is required."));
    }

    const receiptAmount = Number(amount || 0);
    if (!receiptAmount || receiptAmount <= 0) {
      return next(createError(400, "Valid receipt amount is required."));
    }

    const normalizedMethod = normalizePaymentMethod(paymentMethod);
    if (!normalizedMethod) {
      return next(createError(400, "Valid payment method is required."));
    }

    const normalizedCashbook = String(cashbook || "").trim();
    if (!normalizedCashbook) {
      return next(createError(400, "Cashbook is required for landlord receipts."));
    }

    const normalizedReference = String(referenceNumber || "").trim();
    if (!normalizedReference) {
      return next(createError(400, "Reference number is required for landlord receipts."));
    }

    const duplicateRef = await LandlordReceipt.findOne({ business: businessId, referenceNumber: normalizedReference })
      .select("_id")
      .lean();
    if (duplicateRef) {
      return next(createError(400, "Reference number already exists in this company."));
    }

    const parsedReceiptDate = receiptDate ? new Date(receiptDate) : new Date();
    if (Number.isNaN(parsedReceiptDate.getTime())) {
      return next(createError(400, "Valid receipt date is required."));
    }

    const actorUserId = await resolveAuditActorUserId({
      req,
      businessId,
      fallbackErrorMessage: "Authenticated user is required for landlord receipt creation.",
    });

    let receiptNumber = String(req.body?.receiptNumber || "").trim();
    if (!receiptNumber) {
      receiptNumber = await generateReceiptNumber(businessId);
    } else {
      const duplicateReceiptNo = await LandlordReceipt.findOne({ business: businessId, receiptNumber })
        .select("_id")
        .lean();
      if (duplicateReceiptNo) {
        return next(createError(400, "Receipt number already exists in this company."));
      }
    }

    const created = await LandlordReceipt.create({
      business: businessId,
      landlord: landlordId,
      property: propertyId,
      receiptNumber,
      receiptDate: parsedReceiptDate,
      amount: receiptAmount,
      category: normalizedCategory,
      paymentMethod: normalizedMethod,
      cashbook: normalizedCashbook,
      referenceNumber: normalizedReference,
      narration: String(narration || "").trim(),
      linkedDocumentType: String(linkedDocumentType || "").trim(),
      linkedDocumentId: String(linkedDocumentId || "").trim(),
      linkedDocumentRef: String(linkedDocumentRef || "").trim(),
      status: "draft",
      ledgerEntries: [],
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    await created.populate([
      { path: "landlord", select: "landlordName landlordCode email phoneNumber" },
      { path: "property", select: "propertyName propertyCode landlords" },
      { path: "createdBy", select: "surname otherNames email" },
      { path: "updatedBy", select: "surname otherNames email" },
    ]);
    return res.status(200).json({ success: true, data: created });
  } catch (error) {
    next(error);
  }
};

export const getLandlordReceipts = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return next(createError(400, "Business context is required to fetch landlord receipts."));
    }

    const receipts = await populateQuery(LandlordReceipt.find(buildListFilter(req, businessId)).sort({ receiptDate: -1, createdAt: -1 }));
    return res.status(200).json({ success: true, data: receipts });
  } catch (error) {
    next(error);
  }
};

export const getLandlordReceipt = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const receipt = await populateQuery(LandlordReceipt.findOne({ _id: req.params.id, business: businessId }));
    if (!receipt) {
      return next(createError(404, "Landlord receipt not found."));
    }
    return res.status(200).json({ success: true, data: receipt });
  } catch (error) {
    next(error);
  }
};

export const updateLandlordReceipt = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const existing = await LandlordReceipt.findOne({ _id: req.params.id, business: businessId });
    if (!existing) {
      return next(createError(404, "Landlord receipt not found."));
    }
    if (existing.status !== "draft") {
      return next(createError(400, "Only draft landlord receipts can be edited."));
    }

    const nextProperty = req.body?.property || existing.property;
    const requestedLandlord = req.body?.landlord || existing.landlord;
    const { landlordId, propertyId } = await resolveReceiptContext({ businessId, propertyId: nextProperty, landlordId: requestedLandlord });

    const normalizedCategory = String(req.body?.category || existing.category || "").trim();
    if (!RECEIPT_CATEGORIES.includes(normalizedCategory)) {
      return next(createError(400, "A valid landlord receipt category is required."));
    }

    const normalizedMethod = normalizePaymentMethod(req.body?.paymentMethod || existing.paymentMethod || "");
    if (!normalizedMethod) {
      return next(createError(400, "Valid payment method is required."));
    }

    const normalizedCashbook = String(req.body?.cashbook || existing.cashbook || "").trim();
    if (!normalizedCashbook) {
      return next(createError(400, "Cashbook is required for landlord receipts."));
    }

    const normalizedReference = String(req.body?.referenceNumber || existing.referenceNumber || "").trim();
    if (!normalizedReference) {
      return next(createError(400, "Reference number is required for landlord receipts."));
    }

    const duplicateRef = await LandlordReceipt.findOne({
      _id: { $ne: existing._id },
      business: businessId,
      referenceNumber: normalizedReference,
    })
      .select("_id")
      .lean();
    if (duplicateRef) {
      return next(createError(400, "Reference number already exists in this company."));
    }

    const actorUserId = await resolveAuditActorUserId({
      req,
      businessId,
      fallbackErrorMessage: "Authenticated user is required for landlord receipt update.",
    });

    existing.landlord = landlordId;
    existing.property = propertyId;
    existing.receiptDate = req.body?.receiptDate ? new Date(req.body.receiptDate) : existing.receiptDate;
    existing.amount = Number(req.body?.amount ?? existing.amount ?? 0);
    existing.category = normalizedCategory;
    existing.paymentMethod = normalizedMethod;
    existing.cashbook = normalizedCashbook;
    existing.referenceNumber = normalizedReference;
    existing.narration = String(req.body?.narration ?? existing.narration ?? "").trim();
    existing.linkedDocumentType = String(req.body?.linkedDocumentType ?? existing.linkedDocumentType ?? "").trim();
    existing.linkedDocumentId = String(req.body?.linkedDocumentId ?? existing.linkedDocumentId ?? "").trim();
    existing.linkedDocumentRef = String(req.body?.linkedDocumentRef ?? existing.linkedDocumentRef ?? "").trim();
    existing.metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : existing.metadata || {};
    existing.updatedBy = actorUserId;

    if (Number(existing.amount || 0) <= 0) {
      return next(createError(400, "Valid receipt amount is required."));
    }
    if (Number.isNaN(new Date(existing.receiptDate).getTime())) {
      return next(createError(400, "Valid receipt date is required."));
    }

    await existing.save();
    await existing.populate([
      { path: "landlord", select: "landlordName landlordCode email phoneNumber" },
      { path: "property", select: "propertyName propertyCode landlords" },
      { path: "createdBy", select: "surname otherNames email" },
      { path: "updatedBy", select: "surname otherNames email" },
    ]);
    return res.status(200).json({ success: true, data: existing });
  } catch (error) {
    next(error);
  }
};

export const postLandlordReceipt = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const receipt = await LandlordReceipt.findOne({ _id: req.params.id, business: businessId });
    if (!receipt) {
      return next(createError(404, "Landlord receipt not found."));
    }
    if (receipt.status === "posted") {
      const populated = await populateQuery(LandlordReceipt.findById(receipt._id));
      return res.status(200).json({ success: true, data: populated, message: "Landlord receipt is already posted." });
    }
    if (receipt.status === "reversed") {
      return next(createError(400, "Reversed landlord receipts cannot be reposted."));
    }

    const { landlordId, propertyId } = await resolveReceiptContext({ businessId, propertyId: receipt.property, landlordId: receipt.landlord });
    receipt.landlord = landlordId;
    receipt.property = propertyId;

    const actorUserId = await resolveAuditActorUserId({
      req,
      businessId,
      fallbackErrorMessage: "Authenticated user is required for landlord receipt posting.",
    });

    const cashbookAccount = await resolveCashbookAccount({ businessId, cashbook: receipt.cashbook, paymentMethod: receipt.paymentMethod });
    if (!cashbookAccount?._id) {
      return next(createError(400, "A valid cashbook account could not be resolved for this landlord receipt."));
    }

    const categoryAccount = await resolveCategoryAccount(businessId, receipt.category);
    if (!categoryAccount?._id) {
      return next(createError(400, "A valid landlord receipt destination account could not be resolved."));
    }

    const postingDate = new Date(receipt.receiptDate || receipt.createdAt || new Date());
    const periodDate = new Date(postingDate);
    const amount = Number(receipt.amount || 0);
    const journalGroupId = new mongoose.Types.ObjectId();
    const postingRole = buildPostingRole(receipt.category);
    const narration = receipt.narration || `Landlord receipt ${receipt.receiptNumber}`;

    const debitLeg = await postEntry({
      business: receipt.business,
      property: receipt.property,
      landlord: receipt.landlord,
      sourceTransactionType: "landlord_receipt",
      sourceTransactionId: String(receipt._id),
      transactionDate: postingDate,
      statementPeriodStart: periodDate,
      statementPeriodEnd: periodDate,
      category: "LANDLORD_RECEIPT",
      amount,
      direction: "debit",
      accountId: cashbookAccount._id,
      journalGroupId,
      payer: "landlord",
      receiver: "manager",
      notes: narration,
      metadata: {
        category: receipt.category,
        referenceNumber: receipt.referenceNumber,
        receiptNumber: receipt.receiptNumber,
        cashbook: receipt.cashbook,
        cashbookAccountId: String(cashbookAccount._id),
        linkedDocumentType: receipt.linkedDocumentType || "",
        linkedDocumentId: receipt.linkedDocumentId || "",
        linkedDocumentRef: receipt.linkedDocumentRef || "",
        postingRole: "cashbook_inflow",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      status: "approved",
    });

    const creditLeg = await postEntry({
      business: receipt.business,
      property: receipt.property,
      landlord: receipt.landlord,
      sourceTransactionType: "landlord_receipt",
      sourceTransactionId: String(receipt._id),
      transactionDate: postingDate,
      statementPeriodStart: periodDate,
      statementPeriodEnd: periodDate,
      category: "LANDLORD_RECEIPT",
      amount,
      direction: "credit",
      accountId: categoryAccount._id,
      journalGroupId,
      payer: "landlord",
      receiver: "system",
      notes: narration,
      metadata: {
        category: receipt.category,
        referenceNumber: receipt.referenceNumber,
        receiptNumber: receipt.receiptNumber,
        cashbook: receipt.cashbook,
        cashbookAccountId: String(cashbookAccount._id),
        linkedDocumentType: receipt.linkedDocumentType || "",
        linkedDocumentId: receipt.linkedDocumentId || "",
        linkedDocumentRef: receipt.linkedDocumentRef || "",
        postingRole,
        offsetOfEntryId: String(debitLeg._id),
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      status: "approved",
    });

    receipt.status = "posted";
    receipt.postedBy = actorUserId;
    receipt.postedAt = new Date();
    receipt.updatedBy = actorUserId;
    receipt.journalGroupId = journalGroupId;
    receipt.ledgerEntries = [debitLeg._id, creditLeg._id];
    await receipt.save();

    await aggregateChartOfAccountBalances(receipt.business, [String(cashbookAccount._id), String(categoryAccount._id)]);

    const populated = await populateQuery(LandlordReceipt.findById(receipt._id));
    return res.status(200).json({ success: true, data: populated, message: "Landlord receipt posted successfully." });
  } catch (error) {
    next(error);
  }
};

export const reverseLandlordReceipt = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const receipt = await LandlordReceipt.findOne({ _id: req.params.id, business: businessId });
    if (!receipt) {
      return next(createError(404, "Landlord receipt not found."));
    }
    if (receipt.status !== "posted") {
      return next(createError(400, "Only posted landlord receipts can be reversed."));
    }

    const actorUserId = await resolveAuditActorUserId({
      req,
      businessId,
      fallbackErrorMessage: "Authenticated user is required for landlord receipt reversal.",
    });

    const reason = String(req.body?.reason || "Landlord receipt reversed").trim();
    const originalEntries = await FinancialLedgerEntry.find({
      business: receipt.business,
      sourceTransactionType: "landlord_receipt",
      sourceTransactionId: String(receipt._id),
      status: "approved",
      category: { $ne: "REVERSAL" },
    });

    const reversedEntries = [];
    for (const entry of originalEntries) {
      if (entry.reversedByEntry || entry.status === "reversed") continue;
      const result = await postReversal({ entryId: entry._id, reason, userId: actorUserId });
      reversedEntries.push(result.reversalEntry);
    }

    receipt.status = "reversed";
    receipt.reversedBy = actorUserId;
    receipt.reversedAt = new Date();
    receipt.reversalReason = reason;
    receipt.updatedBy = actorUserId;
    await receipt.save();

    const touchedAccountIds = [
      ...new Set([...originalEntries, ...reversedEntries].map((entry) => String(entry?.accountId || "")).filter(Boolean)),
    ];
    if (touchedAccountIds.length) {
      await aggregateChartOfAccountBalances(receipt.business, touchedAccountIds);
    }

    const populated = await populateQuery(LandlordReceipt.findById(receipt._id));
    return res.status(200).json({ success: true, data: populated, message: "Landlord receipt reversed successfully." });
  } catch (error) {
    next(error);
  }
};

export const deleteLandlordReceipt = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const receipt = await LandlordReceipt.findOne({ _id: req.params.id, business: businessId });
    if (!receipt) {
      return next(createError(404, "Landlord receipt not found."));
    }
    if (receipt.status !== "draft") {
      return next(createError(400, "Only draft landlord receipts can be deleted."));
    }

    await LandlordReceipt.deleteOne({ _id: receipt._id });
    return res.status(200).json({ success: true, message: "Landlord receipt deleted successfully." });
  } catch (error) {
    next(error);
  }
};
