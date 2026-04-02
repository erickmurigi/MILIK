import mongoose from "mongoose";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import ExpenseProperty from "../../models/ExpenseProperty.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import { emitToCompany } from "../../utils/socketManager.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import {
  ensureSystemChartOfAccounts,
} from "../../services/chartOfAccountsService.js";
import {
  resolvePropertyAccountingContext,
  resolveLandlordRemittancePayableAccount,
  ensurePropertyControlAccount,
} from "../../services/propertyAccountingService.js";

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

const generateVoucherNo = async (businessId) => {
  const prefix = "PM";
  const lastVoucher = await PaymentVoucher.findOne(
    { business: businessId, voucherNo: { $regex: `^${prefix}\\d+$` } },
    { voucherNo: 1 },
    { sort: { createdAt: -1 } }
  );

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

const getExpenseCategory = (voucherCategory) => {
  if (voucherCategory === "landlord_maintenance") return "maintenance";
  if (voucherCategory === "landlord_other") return "other";
  return null;
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
    .populate("expenseRecord");

const createExpenseRecordForVoucher = async (voucher) => {
  const expenseCategory = getExpenseCategory(voucher.category);
  if (!expenseCategory) return null;
  if (voucher.expenseRecord) {
    return ExpenseProperty.findById(voucher.expenseRecord).lean();
  }

  const expense = await ExpenseProperty.create({
    property: voucher.property,
    category: expenseCategory,
    amount: Number(voucher.amount || 0),
    description: String(voucher.narration || voucher.reference || `Payment voucher ${voucher.voucherNo}`).trim(),
    date: normalizeDate(voucher.dueDate || voucher.createdAt || new Date()),
    business: voucher.business,
  });

  return expense;
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
    reversalOf: null,
    status: "approved",
  }).select("_id accountId journalGroupId");

  if (!originalEntries.length) return [];

  const reversalResults = [];
  for (const entry of originalEntries) {
    const result = await postReversal({
      entryId: entry._id,
      reason: reason || `Voucher ${voucher.voucherNo} reversed`,
      userId,
    });
    reversalResults.push(result);
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

const ensureVoucherAccrualPosting = async ({ voucher, actorUserId }) => {
  const existingEntries = await FinancialLedgerEntry.find({
    business: voucher.business,
    sourceTransactionType: "payment_voucher",
    sourceTransactionId: String(voucher._id),
    reversalOf: null,
    status: "approved",
  }).select("_id accountId journalGroupId");

  if (existingEntries.length > 0) {
    return {
      voucher,
      entries: existingEntries,
      expenseRecord: voucher.expenseRecord || null,
      journalGroupId: existingEntries[0]?.journalGroupId || voucher.journalGroupId || null,
      reused: true,
    };
  }

  const accountingContext = await resolvePropertyAccountingContext({
    propertyId: voucher.property,
    landlordId: voucher.landlord || null,
    businessId: voucher.business,
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

  let expenseRecord = null;
  if (voucher.category !== "deposit_refund") {
    expenseRecord = await createExpenseRecordForVoucher(voucher);
  }

  const { start, end } = buildStatementPeriod(voucher.dueDate || voucher.createdAt || new Date());
  const txDate = normalizeDate(voucher.dueDate || new Date());
  const journalGroupId = new mongoose.Types.ObjectId();
  const narration = String(voucher.narration || voucher.reference || `Payment voucher ${voucher.voucherNo}`).trim();
  const amount = Math.abs(Number(voucher.amount || 0));

  try {
    const debitLeg = await postEntry({
      business: accountingContext.businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(voucher._id),
      transactionDate: txDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: voucher.category === "deposit_refund" ? "ADJUSTMENT" : "EXPENSE_DEDUCTION",
      amount,
      direction: "debit",
      debit: amount,
      credit: 0,
      accountId: debitAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: voucher.category === "deposit_refund" ? "landlord" : "vendor",
      notes: narration,
      metadata: {
        voucherNo: voucher.voucherNo,
        voucherCategory: voucher.category,
        postingRole: voucher.category === "deposit_refund" ? "landlord_payable_reduction" : ["landlord_maintenance", "landlord_other"].includes(voucher.category) ? "property_control_deduction" : "expense_or_deduction",
        includeInLandlordStatement: false,
        expenseRecordId: expenseRecord?._id ? String(expenseRecord._id) : null,
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: new Date(),
      status: "approved",
    });

    const creditLeg = await postEntry({
      business: accountingContext.businessId,
      property: accountingContext.propertyId,
      landlord: accountingContext.landlordId,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(voucher._id),
      transactionDate: txDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      category: voucher.category === "deposit_refund" ? "ADJUSTMENT" : "EXPENSE_DEDUCTION",
      amount,
      direction: "credit",
      debit: 0,
      credit: amount,
      accountId: liabilityAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: voucher.category === "deposit_refund" ? "tenant" : "vendor",
      notes: narration,
      metadata: {
        voucherNo: voucher.voucherNo,
        voucherCategory: voucher.category,
        postingRole: "liability_accrual",
        includeInLandlordStatement: false,
        offsetOfEntryId: String(debitLeg._id),
        expenseRecordId: expenseRecord?._id ? String(expenseRecord._id) : null,
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: new Date(),
      status: "approved",
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
    if (expenseRecord?._id) {
      await ExpenseProperty.findByIdAndDelete(expenseRecord._id).catch(() => null);
    }
    throw error;
  }
};

export const createPaymentVoucher = async (req, res, next) => {
  try {
    const businessId = await resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    if (!req.body?.property || !isValidObjectId(req.body.property)) {
      return res.status(400).json({ success: false, message: "Property is required" });
    }

    if (!req.body?.liabilityAccount || !isValidObjectId(req.body.liabilityAccount)) {
      return res.status(400).json({ success: false, message: "Liability posting account is required" });
    }

    const amount = Number(req.body?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid voucher amount is required" });
    }

    const voucherNo = await generateVoucherNo(businessId);
    const payload = {
      category: req.body.category,
      property: req.body.property,
      landlord: req.body.landlord || null,
      liabilityAccount: req.body.liabilityAccount,
      amount,
      dueDate: req.body.dueDate,
      paidDate: req.body.paidDate || null,
      reference: req.body.reference,
      narration: req.body.narration,
      status: req.body.status || "draft",
      voucherNo,
      business: businessId,
    };

    const voucher = await new PaymentVoucher(payload).save();

    if (voucher.status === "approved" || voucher.status === "paid") {
      const actorUserId = await resolveActorUserId(req, businessId);
      await ensureVoucherAccrualPosting({ voucher, actorUserId });

      if (voucher.status === "approved") {
        voucher.approvedBy = actorUserId;
        voucher.approvedAt = voucher.approvedAt || new Date();
      }

      if (voucher.status === "paid") {
        voucher.approvedBy = voucher.approvedBy || actorUserId;
        voucher.approvedAt = voucher.approvedAt || new Date();
        voucher.paidBy = actorUserId;
        voucher.paidAt = voucher.paidAt || new Date();
        voucher.paidDate = voucher.paidDate || new Date();
      }

      await voucher.save();
    }

    emitToCompany(businessId, "voucher:new", { voucherId: voucher._id });
    const populated = await populateVoucherQuery(PaymentVoucher.findById(voucher._id));
    res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

export const getPaymentVouchers = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
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

    const rows = await populateVoucherQuery(
      PaymentVoucher.find(filter).sort({ createdAt: -1 })
    );

    res.status(200).json(rows);
  } catch (err) {
    next(err);
  }
};

export const getPaymentVoucher = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const row = await populateVoucherQuery(
      PaymentVoucher.findOne({ _id: req.params.id, business })
    );

    if (!row) return res.status(404).json({ message: "Payment voucher not found" });
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
};

export const updatePaymentVoucher = async (req, res, next) => {
  try {
    const business = await resolveBusinessId(req);
    if (!business) {
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const allowedFields = [
      "category",
      "property",
      "landlord",
      "liabilityAccount",
      "amount",
      "dueDate",
      "paidDate",
      "reference",
      "narration",
    ];

    const payload = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.includes(key))
    );

    if (Object.prototype.hasOwnProperty.call(payload, "landlord") && !payload.landlord) {
      payload.landlord = null;
    }

    const existing = await PaymentVoucher.findOne({ _id: req.params.id, business });
    if (!existing) return res.status(404).json({ message: "Payment voucher not found" });

    if (existing.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft vouchers can be edited.",
      });
    }

    const updated = await populateVoucherQuery(
      PaymentVoucher.findOneAndUpdate(
        { _id: req.params.id, business },
        { $set: payload },
        { new: true }
      )
    );

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
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const { status, reason } = req.body || {};
    if (!["draft", "approved", "paid", "reversed"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const voucher = await PaymentVoucher.findOne({ _id: req.params.id, business });
    if (!voucher) return res.status(404).json({ message: "Payment voucher not found" });

    const actorUserId = await resolveActorUserId(req, business);

    if (status === "draft") {
      voucher.status = "draft";
    }

    if (status === "approved") {
      await ensureVoucherAccrualPosting({ voucher, actorUserId });
      voucher.status = "approved";
      voucher.approvedAt = new Date();
      voucher.approvedBy = actorUserId;
    }

    if (status === "paid") {
      if (voucher.status === "reversed") {
        return res.status(400).json({
          success: false,
          message: "Reversed vouchers cannot be marked as paid.",
        });
      }

      await ensureVoucherAccrualPosting({ voucher, actorUserId });
      voucher.status = "paid";
      voucher.approvedAt = voucher.approvedAt || new Date();
      voucher.approvedBy = voucher.approvedBy || actorUserId;
      voucher.paidAt = new Date();
      voucher.paidBy = actorUserId;
      voucher.paidDate = new Date();
    }

    if (status === "reversed") {
      if (voucher.status === "reversed") {
        return res.status(400).json({ success: false, message: "Voucher already reversed" });
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
    }

    await voucher.save();

    const updated = await populateVoucherQuery(PaymentVoucher.findById(voucher._id));

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
      return res.status(400).json({ success: false, message: "User must have a company context" });
    }

    const row = await PaymentVoucher.findOne({ _id: req.params.id, business });
    if (!row) return res.status(404).json({ message: "Payment voucher not found" });

    if (row.status !== "draft") {
      const actorUserId = await resolveActorUserId(req, business);

      if (row.status !== "reversed") {
        await reverseVoucherLedgerEntries({
          voucher: row,
          userId: actorUserId,
          reason: `Voucher ${row.voucherNo} deleted`,
        });
      }

      await deleteExpenseRecordForVoucher(row);
    }

    await PaymentVoucher.findOneAndDelete({ _id: req.params.id, business });
    emitToCompany(row.business, "voucher:deleted", { voucherId: row._id });

    res.status(200).json({ success: true, message: "Payment voucher deleted" });
  } catch (err) {
    next(err);
  }
};