import mongoose from "mongoose";
import Landlord from "../../models/Landlord.js";
import LandlordPayment from "../../models/LandlordPayment.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { createError } from "../../utils/error.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { resolveLandlordRemittancePayableAccount, getLandlordBalance } from "../../services/propertyAccountingService.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { postEntry, postReversal } from "../../services/ledgerPostingService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const normalizePaymentMethod = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (["bank transfer", "bank_transfer", "transfer", "bank"].includes(raw)) return "bank_transfer";
  if (["cheque", "check"].includes(raw)) return "cheque";
  if (["cash"].includes(raw)) return "cash";
  if (["mpesa", "m-pesa", "mobile money", "mobile_money"].includes(raw)) return "mpesa";
  if (["paypal"].includes(raw)) return "paypal";
  if (["pesapal"].includes(raw)) return "pesapal";
  return "other";
};

const resolveBusinessId = (req) => {
  const direct = req?.body?.businessId || req?.body?.business || req?.body?.company || req?.query?.businessId || req?.query?.business || req?.query?.company || req?.user?.company?._id || req?.user?.company || null;
  return isValidObjectId(direct) ? String(direct) : null;
};

const resolveCashbookAccount = async ({ businessId, cashbook, paymentMethod }) => {
  await ensureSystemChartOfAccounts(businessId);
  const baseQuery = {
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
    $or: [
      { type: "asset" }, { type: "Asset" }, { accountType: "asset" }, { accountType: "Asset" },
      { nature: "asset" }, { nature: "Asset" }, { accountNature: "asset" }, { accountNature: "Asset" },
    ],
  };

  if (isValidObjectId(cashbook)) {
    const byId = await ChartOfAccount.findOne({ ...baseQuery, _id: cashbook }).lean();
    if (byId) return byId;
  }

  const rawCashbook = String(cashbook || "").trim();
  if (rawCashbook) {
    const safePattern = rawCashbook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const byText = await ChartOfAccount.findOne({
      ...baseQuery,
      $and: [
        { $or: baseQuery.$or },
        { $or: [
          { code: rawCashbook.toUpperCase() },
          { accountCode: rawCashbook.toUpperCase() },
          { name: { $regex: `^${safePattern}$`, $options: "i" } },
          { accountName: { $regex: `^${safePattern}$`, $options: "i" } },
        ] },
      ],
    }).lean();
    if (byText) return byText;
  }

  const fallbackCode = paymentMethod === "cash" ? "1100" : paymentMethod === "mpesa" ? "1130" : "1110";
  const fallback = await findSystemAccountByCode(businessId, fallbackCode);
  if (fallback) return fallback;
  return ChartOfAccount.findOne(baseQuery).sort({ createdAt: 1 }).lean();
};

export const listLandlordPayments = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const query = {};
    if (businessId) query.business = businessId;
    if (isValidObjectId(req.query.landlordId || req.query.landlord)) query.landlord = req.query.landlordId || req.query.landlord;

    const payments = await LandlordPayment.find(query)
      .populate("landlord", "landlordName landlordCode status")
      .populate("cashbook", "name code accountName accountCode")
      .sort({ date: -1, createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, data: payments, count: payments.length });
  } catch (err) {
    next(err);
  }
};

export const createLandlordPayment = async (req, res, next) => {
  try {
    const { landlordId, amount, paymentMethod, reference, referenceNumber, paymentDate, date, cashbook } = req.body;
    const businessId = resolveBusinessId(req);
    const paymentAmount = Number(amount || 0);

    if (!businessId) return next(createError(400, "businessId is required."));
    if (!isValidObjectId(landlordId)) return next(createError(400, "Valid landlordId is required."));
    if (!paymentAmount || paymentAmount <= 0) return next(createError(400, "Amount must be greater than zero."));
    if (!cashbook) return next(createError(400, "Cashbook account is required for landlord payments."));

    const landlord = await Landlord.findOne({ _id: landlordId, company: businessId }).lean();
    if (!landlord) return next(createError(404, "Landlord not found or does not belong to this business."));
    if (String(landlord.status || "").toLowerCase() === "archived") {
      return next(createError(400, "Archived landlords cannot receive new payments."));
    }

    const outstanding = await getLandlordBalance(landlordId, businessId);
    if (outstanding <= 0) return next(createError(400, "This landlord has no outstanding payable balance."));
    if (paymentAmount > outstanding) {
      return next(createError(400, `Payment amount (${paymentAmount}) cannot exceed landlord balance (${outstanding}).`));
    }

    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    const postingDate = paymentDate || date ? new Date(paymentDate || date) : new Date();
    if (Number.isNaN(postingDate.getTime())) return next(createError(400, "Invalid payment date."));

    const actorUserId = await resolveAuditActorUserId({ req, businessId, fallbackErrorMessage: "No valid company user could be resolved for landlord payment posting." });
    const payableAccount = await resolveLandlordRemittancePayableAccount(businessId);
    const cashbookAccount = await resolveCashbookAccount({ businessId, cashbook, paymentMethod: normalizedPaymentMethod });
    if (!cashbookAccount?._id) return next(createError(400, "A valid cashbook account could not be resolved."));

    const payment = await LandlordPayment.create({
      landlord: landlordId,
      business: businessId,
      amount: paymentAmount,
      paymentMethod: normalizedPaymentMethod,
      reference: reference || referenceNumber || null,
      date: postingDate,
      cashbook: cashbookAccount._id,
      createdBy: actorUserId,
      status: "confirmed",
    });

    const journalGroupId = new mongoose.Types.ObjectId();
    const common = {
      business: businessId,
      landlord: landlordId,
      sourceTransactionType: "landlord_payment",
      sourceTransactionId: String(payment._id),
      transactionDate: postingDate,
      statementPeriodStart: postingDate,
      statementPeriodEnd: postingDate,
      category: "EXPENSE_DEDUCTION",
      amount: paymentAmount,
      journalGroupId,
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      status: "approved",
      allowUnscoped: true,
    };

    const debitLeg = await postEntry({
      ...common,
      direction: "debit",
      accountId: payableAccount._id,
      payer: "manager",
      receiver: "landlord",
      notes: `Landlord payment to ${landlord.landlordName}`,
      metadata: { paymentMethod: normalizedPaymentMethod, reference: reference || referenceNumber || null, postingRole: "landlord_payable_reduction" },
    });
    const creditLeg = await postEntry({
      ...common,
      direction: "credit",
      accountId: cashbookAccount._id,
      payer: "manager",
      receiver: "system",
      notes: `Cashbook outflow for landlord payment to ${landlord.landlordName}`,
      metadata: { paymentMethod: normalizedPaymentMethod, reference: reference || referenceNumber || null, cashbookAccountId: String(cashbookAccount._id), offsetOfEntryId: String(debitLeg._id), postingRole: "cashbook_outflow" },
    });

    payment.ledgerEntryId = debitLeg._id;
    payment.ledgerEntries = [debitLeg._id, creditLeg._id];
    payment.journalGroupId = journalGroupId;
    await payment.save();

    await aggregateChartOfAccountBalances(businessId, [String(payableAccount._id), String(cashbookAccount._id)]);
    const balance = await getLandlordBalance(landlordId, businessId);

    res.status(201).json({ success: true, message: "Landlord payment recorded successfully.", data: { payment, balance } });
  } catch (err) {
    next(err);
  }
};

export const reverseLandlordPayment = async (req, res, next) => {
  try {
    const businessId = resolveBusinessId(req);
    const paymentId = req.params.id || req.body.paymentId;
    if (!businessId) return next(createError(400, "businessId is required."));
    if (!isValidObjectId(paymentId)) return next(createError(400, "Valid payment id is required."));

    const payment = await LandlordPayment.findOne({ _id: paymentId, business: businessId });
    if (!payment) return next(createError(404, "Landlord payment not found."));
    if (payment.status === "reversed") return next(createError(400, "This landlord payment is already reversed."));

    const actorUserId = await resolveAuditActorUserId({ req, businessId, fallbackErrorMessage: "No valid company user could be resolved for reversing landlord payment." });
    const reversalIds = [];
    for (const entryId of payment.ledgerEntries || []) {
      const result = await postReversal({ entryId, userId: actorUserId, reason: req.body.reason || "Landlord payment reversed" });
      if (result?.reversalEntry?._id) reversalIds.push(result.reversalEntry._id);
    }

    payment.status = "reversed";
    payment.reversedAt = new Date();
    payment.reversedBy = actorUserId;
    payment.reversalReason = req.body.reason || "Landlord payment reversed";
    payment.reversalLedgerEntries = reversalIds;
    await payment.save();

    const accountIds = await FinancialLedgerEntry.find({ _id: { $in: [...(payment.ledgerEntries || []), ...reversalIds] } }).distinct("accountId");
    await aggregateChartOfAccountBalances(businessId, accountIds.map(String).filter(Boolean));
    const balance = await getLandlordBalance(payment.landlord, businessId);

    res.status(200).json({ success: true, message: "Landlord payment reversed successfully.", data: { payment, balance } });
  } catch (err) {
    next(err);
  }
};

export default { listLandlordPayments, createLandlordPayment, reverseLandlordPayment };
