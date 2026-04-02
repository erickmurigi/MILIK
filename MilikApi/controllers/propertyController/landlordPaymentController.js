import mongoose from "mongoose";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import { createError } from "../../utils/error.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { getCompanyTaxConfiguration, resolveOutputVatAccount } from "../../services/taxCalculationService.js";
import { ensurePropertyControlAccount, resolveLandlordRemittancePayableAccount } from "../../services/propertyAccountingService.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const normalizePaymentMethod = (value) => {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) return null;
  if (["bank transfer", "bank_transfer", "transfer", "bank"].includes(raw)) return "bank_transfer";
  if (["cheque", "check"].includes(raw)) return "cheque";
  if (["cash"].includes(raw)) return "cash";
  if (["mpesa", "m-pesa", "mobile money", "mobile_money"].includes(raw)) return "mpesa";
  if (["paypal"].includes(raw)) return "paypal";
  if (["pesapal"].includes(raw)) return "pesapal";
  if (["other"].includes(raw)) return null;

  return null;
};

const resolveBusinessId = async (req, statementId = null) => {
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

  if (isValidObjectId(direct)) {
    return String(direct);
  }

  if (statementId && isValidObjectId(statementId)) {
    const existing = await ProcessedStatement.findById(statementId).select("business").lean();
    if (existing?.business && isValidObjectId(existing.business)) {
      return String(existing.business);
    }
  }

  return null;
};

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for processed statement posting.",
  });

const resolveCashbookAccount = async ({ businessId, cashbook, paymentMethod }) => {
  await ensureSystemChartOfAccounts(businessId);

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
    const safePattern = rawCashbook.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  const fallbackCode =
    paymentMethod === "cash"
      ? "1100"
      : paymentMethod === "mpesa"
      ? "1130"
      : "1110";

  const systemFallback = await findSystemAccountByCode(businessId, fallbackCode);
  if (systemFallback) return systemFallback;

  return ChartOfAccount.findOne(baseQuery).sort({ createdAt: 1 }).lean();
};

const resolveCommissionIncomeAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const exact = await findSystemAccountByCode(businessId, "4210");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    isPosting: { $ne: false },
    $or: [
      { type: "income" },
      { type: "Income" },
      { accountType: "income" },
      { accountType: "Income" },
      { nature: "income" },
      { nature: "Income" },
      { accountNature: "income" },
      { accountNature: "Income" },
    ],
    $and: [
      {
        $or: [
          { name: { $regex: "^commission income$", $options: "i" } },
          { name: { $regex: "management fee income", $options: "i" } },
          { accountName: { $regex: "commission income", $options: "i" } },
        ],
      },
    ],
  }).lean();

  if (!fallback) {
    throw new Error("Commission Income account was not found for this business.");
  }

  return fallback;
};


const findAccountLinkedCommissionAccrualEntries = async (statement) => {
  if (!statement?._id) return [];

  return FinancialLedgerEntry.find({
    business: statement.business,
    property: statement.property,
    landlord: statement.landlord,
    sourceTransactionType: "processed_statement",
    sourceTransactionId: String(statement._id),
    category: "COMMISSION_CHARGE",
    status: { $ne: "reversed" },
    accountId: { $ne: null },
    "metadata.postingKind": "commission_accrual",
  })
    .select("_id accountId")
    .lean();
};

const postCommissionAccrualIfMissing = async ({ statement, actorUserId, transactionDate, notes }) => {
  const commissionAmount = Number(statement?.commissionAmount || 0);
  const commissionTaxAmount = Number(statement?.commissionTaxAmount || 0);
  const commissionGrossAmount = Number(statement?.commissionGrossAmount || commissionAmount + commissionTaxAmount || 0);
  if (!statement?._id || !actorUserId || commissionGrossAmount <= 0) {
    return { alreadyPosted: false, entries: [] };
  }

  const existingEntries = await findAccountLinkedCommissionAccrualEntries(statement);
  const expectedEntryCount = commissionTaxAmount > 0 ? 3 : 2;
  if (existingEntries.length >= expectedEntryCount) {
    return { alreadyPosted: true, entries: existingEntries };
  }

  const { postEntry } = await import("../../services/ledgerPostingService.js");
  const propertyControlAccount = await ensurePropertyControlAccount({
    businessId: statement.business,
    propertyId: statement.property,
  });
  const commissionIncomeAccount = await resolveCommissionIncomeAccount(statement.business);
  const companyTaxConfig = await getCompanyTaxConfiguration(statement.business);
  const outputVatAccount = commissionTaxAmount > 0
    ? await resolveOutputVatAccount({ businessId: statement.business, companyTaxConfig })
    : null;
  const journalGroupId = new mongoose.Types.ObjectId();

  const commonMetadata = {
    processedStatementId: String(statement._id),
    postingKind: "commission_accrual",
    commissionBasis: statement.commissionBasis || "received",
    commissionTaxMode: statement.commissionTaxMode || "exclusive",
    commissionTaxRate: Number(statement.commissionTaxRate || 0),
    commissionTaxCodeKey: statement.commissionTaxCodeKey || "no_tax",
  };

  const debitLeg = await postEntry({
    business: statement.business,
    property: statement.property,
    landlord: statement.landlord,
    sourceTransactionType: "processed_statement",
    sourceTransactionId: String(statement._id),
    transactionDate,
    statementPeriodStart: statement.periodStart,
    statementPeriodEnd: statement.periodEnd,
    category: "COMMISSION_CHARGE",
    amount: commissionGrossAmount,
    debit: commissionGrossAmount,
    credit: 0,
    direction: "debit",
    accountId: propertyControlAccount._id,
    journalGroupId,
    payer: "manager",
    receiver: "landlord",
    notes: notes || `Commission accrued for processed statement ${statement._id}` ,
    metadata: {
      ...commonMetadata,
      postingRole: "property_control_charge",
    },
    createdBy: actorUserId,
    approvedBy: actorUserId,
    approvedAt: transactionDate,
    status: "approved",
  });

  const creditLeg = await postEntry({
    business: statement.business,
    property: statement.property,
    landlord: statement.landlord,
    sourceTransactionType: "processed_statement",
    sourceTransactionId: String(statement._id),
    transactionDate,
    statementPeriodStart: statement.periodStart,
    statementPeriodEnd: statement.periodEnd,
    category: "COMMISSION_CHARGE",
    amount: commissionAmount,
    debit: 0,
    credit: commissionAmount,
    direction: "credit",
    accountId: commissionIncomeAccount._id,
    journalGroupId,
    payer: "manager",
    receiver: "system",
    notes: notes || `Commission income accrued for processed statement ${statement._id}` ,
    metadata: {
      ...commonMetadata,
      postingRole: "commission_income_accrual",
      offsetOfEntryId: String(debitLeg._id),
    },
    createdBy: actorUserId,
    approvedBy: actorUserId,
    approvedAt: transactionDate,
    status: "approved",
  });

  const entries = [debitLeg, creditLeg];
  const touchedAccounts = [String(propertyControlAccount._id), String(commissionIncomeAccount._id)];

  if (commissionTaxAmount > 0 && outputVatAccount?._id) {
    const taxLeg = await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "processed_statement",
      sourceTransactionId: String(statement._id),
      transactionDate,
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "COMMISSION_CHARGE",
      amount: commissionTaxAmount,
      debit: 0,
      credit: commissionTaxAmount,
      direction: "credit",
      accountId: outputVatAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes: notes || `Commission VAT accrued for processed statement ${statement._id}` ,
      metadata: {
        ...commonMetadata,
        postingRole: "commission_output_vat",
        offsetOfEntryId: String(debitLeg._id),
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: transactionDate,
      status: "approved",
    });
    entries.push(taxLeg);
    touchedAccounts.push(String(outputVatAccount._id));
  }

  await aggregateChartOfAccountBalances(statement.business, touchedAccounts);

  return { alreadyPosted: false, entries };
};

const buildStatementLookup = (statementId, businessId) => {
  const query = { _id: statementId };
  if (isValidObjectId(businessId)) {
    query.business = businessId;
  }
  return query;
};

const getOutstandingRecoveryBalance = (statement) => {
  const totalRecovery = Math.max(Number(statement?.amountPayableByLandlordToManager || 0), 0);
  const recovered = Math.max(Number(statement?.amountRecovered || 0), 0);
  return Math.max(totalRecovery - recovered, 0);
};

/**
 * Record payment to landlord for a processed statement
 * POST /api/landlord-payments/pay
 */
export const payLandlord = async (req, res, next) => {
  try {
    const {
      statementId,
      paymentDate,
      amount,
      paymentMethod,
      cashbook,
      referenceNumber,
      notes,
    } = req.body;

    if (!statementId) {
      return next(createError(400, "statementId is required"));
    }

    const businessId = await resolveBusinessId(req, statementId);
    const paymentAmount = Number(amount || 0);
    if (!paymentAmount || paymentAmount <= 0) {
      return next(createError(400, "Valid payment amount is required"));
    }

    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    const postingDate = paymentDate ? new Date(paymentDate) : new Date();

    if (Number.isNaN(postingDate.getTime())) {
      return next(createError(400, "Invalid paymentDate"));
    }

    const statement = await ProcessedStatement.findOne(buildStatementLookup(statementId, businessId));

    if (!statement) {
      return next(createError(404, "Processed statement not found or access denied"));
    }

    const isNegativeStatement =
      Boolean(statement.isNegativeStatement) || Number(statement.amountPayableByLandlordToManager || 0) > 0;

    if (isNegativeStatement) {
      return next(
        createError(
          400,
          `This processed statement is negative. The landlord owes the manager ${Number(
            statement.amountPayableByLandlordToManager || 0
          ).toFixed(2)}, so landlord payment is not allowed.`
        )
      );
    }

    const actorUserId = await resolveActorUserId(req, String(statement.business || businessId || ""));

    await postCommissionAccrualIfMissing({
      statement,
      actorUserId,
      transactionDate: postingDate,
      notes: `Commission accrued during landlord payment for processed statement ${statement._id}`,
    });

    const netAmountDue = Number(statement.netAmountDue || 0);
    const alreadyPaid = Number(statement.amountPaid || 0);
    const outstandingBalance = Math.max(
      Number(statement.balanceDue ?? netAmountDue - alreadyPaid),
      0
    );

    if (paymentAmount > outstandingBalance && outstandingBalance > 0) {
      return next(
        createError(
          400,
          `Payment amount (${paymentAmount}) cannot exceed outstanding balance (${outstandingBalance})`
        )
      );
    }

    const newAmountPaid = alreadyPaid + paymentAmount;
    const newBalanceDue = Math.max(netAmountDue - newAmountPaid, 0);

    let newStatus = "unpaid";
    if (newAmountPaid <= 0) {
      newStatus = "unpaid";
    } else if (newBalanceDue <= 0 && netAmountDue > 0) {
      newStatus = "paid";
    } else if (newAmountPaid > 0 && newBalanceDue > 0) {
      newStatus = "part_paid";
    } else if (netAmountDue <= 0) {
      newStatus = "processed";
    }

    statement.amountPaid = newAmountPaid;
    statement.balanceDue = newBalanceDue;
    statement.status = newStatus;
    statement.paidDate = postingDate;
    statement.paymentMethod = normalizedPaymentMethod;
    statement.paymentReference = referenceNumber || null;
    statement.notes = notes || statement.notes || null;

    statement.paymentHistory = Array.isArray(statement.paymentHistory)
      ? statement.paymentHistory
      : [];

    statement.paymentHistory.push({
      amount: paymentAmount,
      paymentDate: postingDate,
      paymentMethod: normalizedPaymentMethod,
      paymentReference: referenceNumber || null,
      notes: notes || null,
      createdBy: actorUserId,
    });

    await statement.save();

    const PaymentVoucher = (await import("../../models/PaymentVoucher.js")).default;

    const generateVoucherNo = async (bizId) => {
      const prefix = "PV";
      const lastVoucher = await PaymentVoucher.findOne(
        { business: bizId, voucherNo: { $regex: `^${prefix}\\d+$` } },
        { voucherNo: 1 },
        { sort: { createdAt: -1 } }
      );

      let seq = 1;
      if (lastVoucher?.voucherNo) {
        seq = (parseInt(lastVoucher.voucherNo.replace(prefix, ""), 10) || 0) + 1;
      }

      return `${prefix}${String(seq).padStart(5, "0")}`;
    };

    const voucherNo = await generateVoucherNo(statement.business);
    const landlordPayableAccount = await resolveLandlordRemittancePayableAccount(statement.business);
    const cashbookAccount = await resolveCashbookAccount({
      businessId: statement.business,
      cashbook,
      paymentMethod: normalizedPaymentMethod,
    });

    if (!cashbookAccount?._id) {
      return next(createError(400, "A valid cashbook account could not be resolved for this payment."));
    }

    const voucher = await PaymentVoucher.create({
      voucherNo,
      category: "landlord_other",
      status: "approved",
      property: statement.property,
      landlord: statement.landlord,
      amount: paymentAmount,
      dueDate: postingDate,
      paidDate: postingDate,
      reference: String(statement._id),
      narration: `Landlord payment for processed statement ${statement._id}${
        cashbookAccount?.name ? ` from ${cashbookAccount.name}` : ""
      }`,
      liabilityAccount: landlordPayableAccount?._id || null,
      debitAccount: cashbookAccount?._id || null,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      paidBy: actorUserId,
      paidAt: postingDate,
      business: statement.business,
    });

    const { postEntry } = await import("../../services/ledgerPostingService.js");
    const journalGroupId = new mongoose.Types.ObjectId();

    const debitLeg = await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(voucher._id),
      transactionDate: postingDate,
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "EXPENSE_DEDUCTION",
      amount: paymentAmount,
      debit: paymentAmount,
      credit: 0,
      direction: "debit",
      accountId: landlordPayableAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "landlord",
      notes: `Landlord payment voucher ${voucherNo}${cashbookAccount?.name ? ` via ${cashbookAccount.name}` : ""}`,
      metadata: {
        processedStatementId: String(statement._id),
        paymentMethod: normalizedPaymentMethod,
        referenceNumber: referenceNumber || null,
        cashbook: cashbookAccount?.name || cashbook || null,
        cashbookAccountId: cashbookAccount?._id ? String(cashbookAccount._id) : null,
        postingRole: "landlord_payable_reduction",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      status: "approved",
    });

    const creditLeg = await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "payment_voucher",
      sourceTransactionId: String(voucher._id),
      transactionDate: postingDate,
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "EXPENSE_DEDUCTION",
      amount: paymentAmount,
      debit: 0,
      credit: paymentAmount,
      direction: "credit",
      accountId: cashbookAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes: `Landlord payment voucher ${voucherNo}${cashbookAccount?.name ? ` via ${cashbookAccount.name}` : ""}`,
      metadata: {
        processedStatementId: String(statement._id),
        paymentMethod: normalizedPaymentMethod,
        referenceNumber: referenceNumber || null,
        cashbook: cashbookAccount?.name || cashbook || null,
        cashbookAccountId: cashbookAccount?._id ? String(cashbookAccount._id) : null,
        offsetOfEntryId: String(debitLeg._id),
        postingRole: "cashbook_outflow",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      status: "approved",
    });

    voucher.ledgerEntries = [debitLeg._id, creditLeg._id];
    voucher.journalGroupId = journalGroupId;
    await voucher.save();

    await aggregateChartOfAccountBalances(statement.business, [
      String(landlordPayableAccount._id),
      String(cashbookAccount._id),
    ]);

    res.status(200).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        statement,
        voucher,
      },
    });
  } catch (err) {
    next(err);
  }
};


/**
 * Record recovery from landlord for a negative processed statement
 * POST /api/landlord-payments/record-recovery
 */
export const recordRecoveryFromLandlord = async (req, res, next) => {
  try {
    const {
      statementId,
      recoveryDate,
      amount,
      paymentMethod,
      cashbook,
      referenceNumber,
      notes,
    } = req.body;

    if (!statementId) {
      return next(createError(400, "statementId is required"));
    }

    const businessId = await resolveBusinessId(req, statementId);
    const statement = await ProcessedStatement.findOne(buildStatementLookup(statementId, businessId));

    if (!statement) {
      return next(createError(404, "Processed statement not found or access denied"));
    }

    if (statement.status === "reversed") {
      return next(createError(400, "Reversed processed statements cannot accept recovery postings."));
    }

    const isNegativeStatement =
      Boolean(statement.isNegativeStatement) || Number(statement.amountPayableByLandlordToManager || 0) > 0;

    if (!isNegativeStatement) {
      return next(createError(400, "This processed statement is not a negative landlord recovery statement."));
    }

    const recoveryAmount = Number(amount || 0);
    if (!recoveryAmount || recoveryAmount <= 0) {
      return next(createError(400, "Valid recovery amount is required"));
    }

    const postingDate = recoveryDate ? new Date(recoveryDate) : new Date();
    if (Number.isNaN(postingDate.getTime())) {
      return next(createError(400, "Invalid recoveryDate"));
    }

    const outstandingRecovery = getOutstandingRecoveryBalance(statement);
    if (outstandingRecovery <= 0) {
      return next(createError(400, "This processed statement has already been fully recovered."));
    }

    if (recoveryAmount > outstandingRecovery) {
      return next(
        createError(
          400,
          `Recovery amount (${recoveryAmount}) cannot exceed outstanding recovery balance (${outstandingRecovery})`
        )
      );
    }

    const actorUserId = await resolveActorUserId(req, String(statement.business || businessId || ""));
    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    const cashbookAccount = await resolveCashbookAccount({
      businessId: statement.business,
      cashbook,
      paymentMethod: normalizedPaymentMethod,
    });

    if (!cashbookAccount?._id) {
      return next(createError(400, "A valid cashbook account could not be resolved for this recovery."));
    }

    const propertyControlAccount = await ensurePropertyControlAccount({
      businessId: statement.business,
      propertyId: statement.property,
    });

    if (!propertyControlAccount?._id) {
      return next(createError(400, "A valid property control account could not be resolved for this recovery."));
    }

    const { postEntry } = await import("../../services/ledgerPostingService.js");
    const journalGroupId = new mongoose.Types.ObjectId();
    const recoveryEntryId = new mongoose.Types.ObjectId();

    const debitLeg = await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "processed_statement_payment",
      sourceTransactionId: String(recoveryEntryId),
      transactionDate: postingDate,
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "ADJUSTMENT",
      amount: recoveryAmount,
      debit: recoveryAmount,
      credit: 0,
      direction: "debit",
      accountId: cashbookAccount._id,
      journalGroupId,
      payer: "landlord",
      receiver: "manager",
      notes: `Recovery received from landlord for processed statement ${statement._id}${cashbookAccount?.name ? ` via ${cashbookAccount.name}` : ""}`,
      metadata: {
        processedStatementId: String(statement._id),
        postingKind: "landlord_recovery",
        postingRole: "cashbook_inflow",
        paymentMethod: normalizedPaymentMethod,
        referenceNumber: referenceNumber || null,
        cashbook: cashbookAccount?.name || cashbook || null,
        cashbookAccountId: cashbookAccount?._id ? String(cashbookAccount._id) : null,
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      status: "approved",
    });

    const creditLeg = await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "processed_statement_payment",
      sourceTransactionId: String(recoveryEntryId),
      transactionDate: postingDate,
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "ADJUSTMENT",
      amount: recoveryAmount,
      debit: 0,
      credit: recoveryAmount,
      direction: "credit",
      accountId: propertyControlAccount._id,
      journalGroupId,
      payer: "landlord",
      receiver: "system",
      notes: `Recovery cleared against property control for processed statement ${statement._id}`,
      metadata: {
        processedStatementId: String(statement._id),
        postingKind: "landlord_recovery",
        postingRole: "property_control_recovery",
        paymentMethod: normalizedPaymentMethod,
        referenceNumber: referenceNumber || null,
        cashbook: cashbookAccount?.name || cashbook || null,
        cashbookAccountId: cashbookAccount?._id ? String(cashbookAccount._id) : null,
        offsetOfEntryId: String(debitLeg._id),
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: postingDate,
      status: "approved",
    });

    statement.amountRecovered = Number(statement.amountRecovered || 0) + recoveryAmount;
    statement.recoveryBalance = Math.max(
      Number(statement.amountPayableByLandlordToManager || 0) - Number(statement.amountRecovered || 0),
      0
    );
    statement.recoveryDate = postingDate;
    statement.paymentMethod = normalizedPaymentMethod || statement.paymentMethod || null;
    statement.paymentReference = referenceNumber || statement.paymentReference || null;
    statement.recoveryHistory = Array.isArray(statement.recoveryHistory) ? statement.recoveryHistory : [];
    statement.recoveryHistory.push({
      amount: recoveryAmount,
      paymentDate: postingDate,
      paymentMethod: normalizedPaymentMethod,
      paymentReference: referenceNumber || null,
      notes: notes || null,
      createdBy: actorUserId,
      entryId: String(recoveryEntryId),
    });
    if (notes) {
      statement.notes = notes;
    }

    await statement.save();
    await statement.populate([
      { path: "landlord", select: "landlordName firstName lastName" },
      { path: "property", select: "propertyCode propertyName name" },
      { path: "business", select: "companyName name" },
      { path: "sourceStatement", select: "statementNumber status approvedAt" },
      { path: "reversedBy", select: "username email surname otherNames" },
    ]);

    await aggregateChartOfAccountBalances(statement.business, [
      String(cashbookAccount._id),
      String(propertyControlAccount._id),
    ]);

    res.status(200).json({
      success: true,
      message: "Recovery from landlord recorded successfully",
      data: {
        statement,
        ledgerEntries: [debitLeg, creditLeg],
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Post commission income for a processed statement
 * POST /api/landlord-payments/post-commission
 */
export const postCommission = async (req, res, next) => {
  try {
    const { statementId, postingDate, amount, notes } = req.body;

    if (!statementId) {
      return next(createError(400, "statementId is required"));
    }

    const businessId = await resolveBusinessId(req, statementId);
    const statement = await ProcessedStatement.findOne(buildStatementLookup(statementId, businessId));

    if (!statement) {
      return next(createError(404, "Processed statement not found or access denied"));
    }

    const actorUserId = await resolveActorUserId(req, String(statement.business || businessId || ""));
    const commissionAmount = Number(amount || statement.commissionAmount || 0);
    if (!commissionAmount || commissionAmount <= 0) {
      return next(createError(400, "Valid commission amount is required"));
    }

    const transactionDate = postingDate ? new Date(postingDate) : new Date();
    if (Number.isNaN(transactionDate.getTime())) {
      return next(createError(400, "Invalid postingDate"));
    }

    const existingEntries = await findAccountLinkedCommissionAccrualEntries(statement);

    if (existingEntries.length >= 2) {
      return res.status(200).json({
        success: true,
        message: "Commission had already been posted for this processed statement",
        data: {
          statement,
          alreadyPosted: true,
        },
      });
    }

    const { postEntry } = await import("../../services/ledgerPostingService.js");
    const propertyControlAccount = await ensurePropertyControlAccount({
      businessId: statement.business,
      propertyId: statement.property,
    });
    const commissionIncomeAccount = await resolveCommissionIncomeAccount(statement.business);
    const journalGroupId = new mongoose.Types.ObjectId();

    const debitLeg = await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "processed_statement",
      sourceTransactionId: String(statement._id),
      transactionDate,
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "COMMISSION_CHARGE",
      amount: commissionAmount,
      debit: commissionAmount,
      credit: 0,
      direction: "debit",
      accountId: propertyControlAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "landlord",
      notes: `Commission posting for processed statement ${statement._id}`,
      metadata: {
        processedStatementId: String(statement._id),
        postingKind: "commission_accrual",
        notes: notes || "",
        postingRole: "property_control_charge",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: transactionDate,
      status: "approved",
    });

    const creditLeg = await postEntry({
      business: statement.business,
      property: statement.property,
      landlord: statement.landlord,
      sourceTransactionType: "processed_statement",
      sourceTransactionId: String(statement._id),
      transactionDate,
      statementPeriodStart: statement.periodStart,
      statementPeriodEnd: statement.periodEnd,
      category: "COMMISSION_CHARGE",
      amount: commissionAmount,
      debit: 0,
      credit: commissionAmount,
      direction: "credit",
      accountId: commissionIncomeAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes: `Commission posting for processed statement ${statement._id}`,
      metadata: {
        processedStatementId: String(statement._id),
        postingKind: "commission_accrual",
        notes: notes || "",
        offsetOfEntryId: String(debitLeg._id),
        postingRole: "commission_income_accrual",
      },
      createdBy: actorUserId,
      approvedBy: actorUserId,
      approvedAt: transactionDate,
      status: "approved",
    });

    await aggregateChartOfAccountBalances(statement.business, [
      String(propertyControlAccount._id),
      String(commissionIncomeAccount._id),
    ]);

    res.status(200).json({
      success: true,
      message: "Commission posted successfully",
      data: {
        statement,
        entries: [debitLeg, creditLeg],
      },
    });
  } catch (err) {
    next(err);
  }
};

export default {
  payLandlord,
  recordRecoveryFromLandlord,
  postCommission,
};
