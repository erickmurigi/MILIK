import mongoose from "mongoose";
import ProcessedStatement from "../../models/ProcessedStatement.js";
import Property from "../../models/Property.js";
import ChartOfAccount from "../../models/ChartOfAccount.js";
import LandlordStatement from "../../models/LandlordStatement.js";
import { aggregateChartOfAccountBalances } from "../../services/chartAccountAggregationService.js";
import FinancialLedgerEntry from "../../models/FinancialLedgerEntry.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import { ensurePropertyControlAccount } from "../../services/propertyAccountingService.js";
import { ensureSystemChartOfAccounts, findSystemAccountByCode } from "../../services/chartOfAccountsService.js";
import { getCompanyTaxConfiguration, resolveOutputVatAccount } from "../../services/taxCalculationService.js";
import { generateLandlordStatement } from "../../services/landlordStatementService.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const toObjectId = (value) => (isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null);

const resolveAuthenticatedBusinessId = (req) =>
  req?.user?.company?._id || req?.user?.company || req?.user?.businessId || null;

const resolveScopedBusinessId = (req, explicitBusinessId = null) => {
  const requested = explicitBusinessId ? String(explicitBusinessId) : "";
  const authenticated = resolveAuthenticatedBusinessId(req);
  const authenticatedStr = authenticated ? String(authenticated) : "";
  const isPrivileged = Boolean(req?.user?.isSystemAdmin || req?.user?.superAdminAccess);

  if (requested) {
    if (authenticatedStr && requested !== authenticatedStr) {
      const error = new Error("Cross-company access to processed statements is not allowed in the current session.");
      error.statusCode = 403;
      throw error;
    }
    return requested;
  }

  if (authenticatedStr) return authenticatedStr;
  if (isPrivileged) return null;

  const error = new Error("No active company selected for this request.");
  error.statusCode = 403;
  throw error;
};

const findScopedProcessedStatementById = async (req, statementId, populate = null) => {
  if (!isValidObjectId(statementId)) {
    const error = new Error("Invalid processed statement id.");
    error.statusCode = 400;
    throw error;
  }

  const scopedBusinessId = resolveScopedBusinessId(req);
  const query = { _id: statementId };
  if (scopedBusinessId) query.business = scopedBusinessId;

  let statementQuery = ProcessedStatement.findOne(query);
  if (populate) {
    statementQuery = statementQuery.populate(populate);
  }

  return statementQuery;
};

const resolveActorUserId = async (req, businessId) =>
  resolveAuditActorUserId({
    req,
    businessId,
    fallbackErrorMessage: "No valid company user could be resolved for processed statement attribution.",
  });

const resolvePropertyLandlord = async (propertyId) => {
  if (!isValidObjectId(propertyId)) return null;
  const property = await Property.findById(propertyId).select("business landlords").lean();
  if (!property) return null;
  const landlords = Array.isArray(property.landlords) ? property.landlords : [];
  const primary = landlords.find((item) => item?.isPrimary && item?.landlordId);
  const fallback = landlords.find((item) => item?.landlordId);
  return {
    property,
    businessId: property.business ? String(property.business) : null,
    landlordId: primary?.landlordId ? String(primary.landlordId) : fallback?.landlordId ? String(fallback.landlordId) : null,
  };
};

const startOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const numberOrZero = (value) => Number(value || 0);

const sumUtilityAmountsFromRow = (row = {}, phase = "invoiced") => {
  const utilities = Array.isArray(row?.utilities)
    ? row.utilities
    : row?.utilities && typeof row.utilities === "object"
    ? Object.values(row.utilities)
    : [];

  return utilities.reduce((sum, item) => {
    const fieldValue = phase === "paid" ? item?.paid : item?.invoiced;
    return sum + numberOrZero(fieldValue);
  }, 0);
};

const resolveRowUtilityTotal = (row = {}, phase = "invoiced") => {
  const explicitTotal = numberOrZero(
    phase === "paid" ? row?.totalUtilityPaid : row?.totalUtilityInvoiced
  );
  if (explicitTotal > 0) return explicitTotal;

  const summedUtilities = sumUtilityAmountsFromRow(row, phase);
  if (summedUtilities > 0) return summedUtilities;

  return phase === "paid"
    ? numberOrZero(row?.paidGarbage) + numberOrZero(row?.paidWater)
    : numberOrZero(row?.invoicedGarbage) + numberOrZero(row?.invoicedWater);
};

const startOfMonth = (value) => {
  const date = startOfDay(value);
  if (!date) return null;
  date.setDate(1);
  return date;
};

const endOfMonth = (value) => {
  const date = endOfDay(value);
  if (!date) return null;
  date.setMonth(date.getMonth() + 1, 0);
  return date;
};

const formatMonthYearLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "selected month";
  return date.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
};

const resolveProcessedStatementCutoffAt = (periodEndValue, explicitCutoffAt = null) => {
  const selectedPeriodEnd = endOfDay(periodEndValue);
  if (!selectedPeriodEnd) return null;

  if (explicitCutoffAt) {
    const explicitDate = new Date(explicitCutoffAt);
    if (!Number.isNaN(explicitDate.getTime())) {
      return explicitDate.getTime() <= selectedPeriodEnd.getTime() ? explicitDate : selectedPeriodEnd;
    }
  }

  const now = new Date();
  return selectedPeriodEnd.getTime() > now.getTime() ? now : selectedPeriodEnd;
};


const resolveStoredStatementWindow = (statement = {}) => {
  const endAtRaw = statement?.cutoffAt || statement?.closedAt || statement?.periodEnd || null;
  const endAt = endAtRaw ? new Date(endAtRaw) : null;
  if (!endAt || Number.isNaN(endAt.getTime())) return null;

  const previousCutoff = statement?.previousCutoffAt ? new Date(statement.previousCutoffAt) : null;
  const periodStart = statement?.periodStart ? new Date(statement.periodStart) : null;
  const hasPreviousCutoff = previousCutoff && !Number.isNaN(previousCutoff.getTime());
  const hasPeriodStart = periodStart && !Number.isNaN(periodStart.getTime());

  const startAt = hasPreviousCutoff
    ? new Date(previousCutoff.getTime() + 1)
    : hasPeriodStart
    ? periodStart
    : new Date(endAt);

  if (startAt.getTime() > endAt.getTime()) return null;
  return { startAt, endAt };
};

const windowsOverlap = (left = null, right = null) => {
  if (!left || !right) return false;
  return left.startAt.getTime() <= right.endAt.getTime() && left.endAt.getTime() >= right.startAt.getTime();
};


const resolveCommissionIncomeAccount = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const exact = await findSystemAccountByCode(businessId, "4210");
  if (exact) return exact;

  const fallback = await ChartOfAccount.findOne({
    business: businessId,
    isPosting: { $ne: false },
    isHeader: { $ne: true },
    type: "income",
    $or: [
      { name: { $regex: "^commission income$", $options: "i" } },
      { name: { $regex: "management fee income", $options: "i" } },
      { name: { $regex: "commission", $options: "i" } },
    ],
  }).lean();

  if (!fallback) {
    throw new Error("Commission Income account was not found for this business.");
  }

  return fallback;
};

const postCommissionAccrualForProcessedStatement = async ({ processedStatement, approvedStatement, userId }) => {
  const commissionAmount = numberOrZero(processedStatement?.commissionAmount);
  const commissionTaxAmount = numberOrZero(processedStatement?.commissionTaxAmount);
  const commissionGrossAmount = numberOrZero(processedStatement?.commissionGrossAmount || commissionAmount + commissionTaxAmount);
  if (!processedStatement?._id || !approvedStatement?._id || !userId || commissionGrossAmount <= 0) {
    return;
  }

  const { postEntry } = await import("../../services/ledgerPostingService.js");
  const transactionDate = processedStatement.cutoffAt || processedStatement.closedAt || new Date();
  const propertyControlAccount = await ensurePropertyControlAccount({
    businessId: processedStatement.business,
    propertyId: processedStatement.property,
  });
  const commissionIncomeAccount = await resolveCommissionIncomeAccount(processedStatement.business);
  const companyTaxConfig = await getCompanyTaxConfiguration(processedStatement.business);
  const outputVatAccount = commissionTaxAmount > 0
    ? await resolveOutputVatAccount({ businessId: processedStatement.business, companyTaxConfig })
    : null;
  const journalGroupId = new mongoose.Types.ObjectId();
  const metadata = {
    commissionBasis: processedStatement.commissionBasis || "received",
    processedStatementId: String(processedStatement._id),
    sourceStatementNumber: processedStatement.sourceStatementNumber || approvedStatement.statementNumber || "",
    autoPostedOnProcessing: true,
    postingKind: "commission_accrual",
    commissionTaxMode: processedStatement.commissionTaxMode || "exclusive",
    commissionTaxRate: numberOrZero(processedStatement.commissionTaxRate),
    commissionTaxCodeKey: processedStatement.commissionTaxCodeKey || "no_tax",
  };

  const debitLeg = await postEntry({
    business: processedStatement.business,
    property: processedStatement.property,
    landlord: processedStatement.landlord,
    sourceTransactionType: "processed_statement",
    sourceTransactionId: processedStatement._id,
    transactionDate,
    statementPeriodStart: processedStatement.periodStart,
    statementPeriodEnd: processedStatement.periodEnd,
    category: "COMMISSION_CHARGE",
    amount: commissionGrossAmount,
    debit: commissionGrossAmount,
    credit: 0,
    direction: "debit",
    accountId: propertyControlAccount._id,
    journalGroupId,
    payer: "manager",
    receiver: "landlord",
    notes: `Commission accrued on statement processing ${processedStatement.sourceStatementNumber || approvedStatement.statementNumber || processedStatement._id}`,
    metadata: {
      ...metadata,
      postingRole: "property_control_charge",
    },
    createdBy: userId,
    approvedBy: userId,
    approvedAt: transactionDate,
    status: "approved",
  });

  const creditLeg = await postEntry({
    business: processedStatement.business,
    property: processedStatement.property,
    landlord: processedStatement.landlord,
    sourceTransactionType: "processed_statement",
    sourceTransactionId: processedStatement._id,
    transactionDate,
    statementPeriodStart: processedStatement.periodStart,
    statementPeriodEnd: processedStatement.periodEnd,
    category: "COMMISSION_CHARGE",
    amount: commissionAmount,
    debit: 0,
    credit: commissionAmount,
    direction: "credit",
    accountId: commissionIncomeAccount._id,
    journalGroupId,
    payer: "manager",
    receiver: "system",
    notes: `Commission income accrued on statement processing ${processedStatement.sourceStatementNumber || approvedStatement.statementNumber || processedStatement._id}`,
    metadata: {
      ...metadata,
      offsetOfEntryId: String(debitLeg._id),
      postingRole: "commission_income_accrual",
    },
    createdBy: userId,
    approvedBy: userId,
    approvedAt: transactionDate,
    status: "approved",
  });

  const entries = [debitLeg, creditLeg];
  const touchedAccounts = [String(propertyControlAccount._id), String(commissionIncomeAccount._id)];

  if (commissionTaxAmount > 0 && outputVatAccount?._id) {
    const taxLeg = await postEntry({
      business: processedStatement.business,
      property: processedStatement.property,
      landlord: processedStatement.landlord,
      sourceTransactionType: "processed_statement",
      sourceTransactionId: processedStatement._id,
      transactionDate,
      statementPeriodStart: processedStatement.periodStart,
      statementPeriodEnd: processedStatement.periodEnd,
      category: "COMMISSION_CHARGE",
      amount: commissionTaxAmount,
      debit: 0,
      credit: commissionTaxAmount,
      direction: "credit",
      accountId: outputVatAccount._id,
      journalGroupId,
      payer: "manager",
      receiver: "system",
      notes: `Commission VAT accrued on statement processing ${processedStatement.sourceStatementNumber || approvedStatement.statementNumber || processedStatement._id}`,
      metadata: {
        ...metadata,
        offsetOfEntryId: String(debitLeg._id),
        postingRole: "commission_output_vat",
      },
      createdBy: userId,
      approvedBy: userId,
      approvedAt: transactionDate,
      status: "approved",
    });
    entries.push(taxLeg);
    touchedAccounts.push(String(outputVatAccount._id));
  }

  await aggregateChartOfAccountBalances(processedStatement.business, touchedAccounts);

  return entries;
};

const reverseProcessedStatementLedgerEntries = async ({ statement, userId, reason }) => {
  if (!statement?._id || !userId) return [];

  const { postReversal } = await import("../../services/ledgerPostingService.js");
  const originalEntries = await FinancialLedgerEntry.find({
    business: statement.business,
    sourceTransactionType: "processed_statement",
    sourceTransactionId: String(statement._id),
    reversalOf: null,
    status: "approved",
  }).select("_id accountId");

  if (!originalEntries.length) return [];

  const results = [];
  for (const entry of originalEntries) {
    const result = await postReversal({
      entryId: entry._id,
      reason: reason || `Processed statement ${statement._id} reversed`,
      userId,
    });
    results.push(result);
  }

  const touchedAccountIds = new Set();
  originalEntries.forEach((entry) => {
    if (entry?.accountId) touchedAccountIds.add(String(entry.accountId));
  });
  results.forEach((result) => {
    if (result?.reversalEntry?.accountId) {
      touchedAccountIds.add(String(result.reversalEntry.accountId));
    }
  });

  if (touchedAccountIds.size > 0) {
    await aggregateChartOfAccountBalances(String(statement.business), Array.from(touchedAccountIds));
  }

  return results;
};

const hasActiveDownstreamPayments = async (statement) => {
  if (!statement?._id) return { blocked: false, count: 0, hasRecoveryActivity: false };

  const paymentVoucherCount = await PaymentVoucher.countDocuments({
    business: statement.business,
    reference: String(statement._id),
    status: { $ne: "reversed" },
  });

  const paymentHistoryCount = Array.isArray(statement.paymentHistory)
    ? statement.paymentHistory.filter((row) => Number(row?.amount || 0) > 0).length
    : 0;

  const recoveryHistoryCount = Array.isArray(statement.recoveryHistory)
    ? statement.recoveryHistory.filter((row) => Number(row?.amount || 0) > 0).length
    : 0;

  const recoveryEntryCount = await FinancialLedgerEntry.countDocuments({
    business: statement.business,
    sourceTransactionType: "processed_statement_payment",
    status: "approved",
    reversalOf: null,
    "metadata.processedStatementId": String(statement._id),
    "metadata.postingKind": "landlord_recovery",
  });

  const hasRecoveryActivity =
    recoveryHistoryCount > 0 || recoveryEntryCount > 0 || Number(statement.amountRecovered || 0) > 0;

  return {
    blocked:
      paymentVoucherCount > 0 ||
      paymentHistoryCount > 0 ||
      Number(statement.amountPaid || 0) > 0 ||
      hasRecoveryActivity,
    count: paymentVoucherCount + paymentHistoryCount + recoveryHistoryCount + recoveryEntryCount,
    hasRecoveryActivity,
  };
};

const buildStatementSnapshotPayload = (statement, payload = {}) => {
  const workspace = statement?.metadata?.workspace || statement?.metadata || {};
  const summary = workspace?.summary || {};
  const totals = workspace?.totals || {};
  const expenseRows = workspace?.expenseRows || workspace?.deductionRows || [];
  const rows = workspace?.rows || [];
  const directToLandlordRows = workspace?.directToLandlordRows || [];

  return {
    statementType: payload.statementType || "final",
    totalRentInvoiced: numberOrZero(payload.totalRentInvoiced ?? summary.rentInvoiced ?? totals.invoicedRent),
    totalRentReceived: numberOrZero(
      payload.totalRentReceived ??
        numberOrZero(totals.paidRent) +
        numberOrZero(totals.utilityPaid) +
        (numberOrZero(totals.utilityPaid) > 0
          ? 0
          : numberOrZero(totals.paidGarbage) + numberOrZero(totals.paidWater))
    ),
    totalRentReceivedByManager: numberOrZero(payload.totalRentReceivedByManager ?? summary.managerCollections),
    totalRentReceivedByLandlord: numberOrZero(
      payload.totalRentReceivedByLandlord ?? summary.directToLandlordCollections
    ),
    totalUtilitiesCollected: numberOrZero(
      payload.totalUtilitiesCollected ??
        numberOrZero(totals.utilityPaid) +
        (numberOrZero(totals.utilityPaid) > 0
          ? 0
          : numberOrZero(totals.paidGarbage) + numberOrZero(totals.paidWater))
    ),
    depositsHeldByManager: numberOrZero(
      payload.depositsHeldByManager ?? summary.depositsHeldByManager
    ),
    depositsHeldByLandlord: numberOrZero(
      payload.depositsHeldByLandlord ?? summary.depositsHeldByLandlord
    ),
    unappliedPayments: numberOrZero(payload.unappliedPayments),
    commissionPercentage: numberOrZero(payload.commissionPercentage ?? summary.commissionPercentage),
    commissionBasis: payload.commissionBasis || summary.commissionBasis || "received",
    commissionAmount: numberOrZero(payload.commissionAmount ?? summary.commissionAmount),
    commissionTaxAmount: numberOrZero(payload.commissionTaxAmount ?? summary.commissionTaxAmount),
    commissionGrossAmount: numberOrZero(payload.commissionGrossAmount ?? summary.commissionGrossAmount ?? (summary.commissionAmount || 0) + (summary.commissionTaxAmount || 0)),
    commissionTaxMode: payload.commissionTaxMode || summary.commissionTaxMode || "exclusive",
    commissionTaxRate: numberOrZero(payload.commissionTaxRate ?? summary.commissionTaxRate),
    commissionTaxCodeKey: payload.commissionTaxCodeKey || summary.commissionTaxCodeKey || "no_tax",
    netAmountDue: numberOrZero(payload.netAmountDue ?? summary.amountPayableToLandlord ?? statement.closingBalance),
    totalExpenses: numberOrZero(payload.totalExpenses ?? summary.propertyExpenses),
    recurringDeductions: numberOrZero(payload.recurringDeductions),
    advanceRecoveries: numberOrZero(payload.advanceRecoveries),
    expensesByCategory:
      payload.expensesByCategory ||
      expenseRows.reduce((acc, item) => {
        const key = item?.category || "other";
        acc[key] = numberOrZero(acc[key]) + numberOrZero(item?.amount);
        return acc;
      }, {}),
    netAfterExpenses: numberOrZero(payload.netAfterExpenses ?? summary.netStatement ?? statement.closingBalance),
    amountPayableByLandlordToManager: numberOrZero(
      payload.amountPayableByLandlordToManager ?? summary.amountPayableByLandlordToManager
    ),
    summaryBuckets: payload.summaryBuckets || summary,
    workspaceSnapshot: payload.workspaceSnapshot || workspace || {},
    financialEvents:
      payload.financialEvents ||
      expenseRows.map((item) => ({
        eventType: item?.category || "expense",
        bucket: "statement_deduction",
        amount: numberOrZero(item?.amount),
        date: item?.date || statement.periodEnd,
        reference: item?.sourceId || null,
        meta: { description: item?.description || item?.name || "Expense" },
      })),
    isNegativeStatement: Boolean(payload.isNegativeStatement ?? summary.isNegativeStatement),
    occupiedUnits: numberOrZero(payload.occupiedUnits ?? summary.occupiedUnits),
    vacantUnits: numberOrZero(payload.vacantUnits ?? summary.vacantUnits),
    tenantRows:
      payload.tenantRows ||
      rows.map((row) => ({
        unit: row?.unit || row?.unitNumber || "",
        tenantName: row?.tenantName || "",
        rentPerMonth: numberOrZero(row?.perMonth),
        openingBalance: numberOrZero(row?.openingBalance),
        totalInvoiced: numberOrZero(row?.invoicedRent) + resolveRowUtilityTotal(row, "invoiced"),
        txnNo: Array.isArray(row?.referenceNumbers) ? row.referenceNumbers.join(", ") : row?.txnNo || "",
        totalReceived: numberOrZero(row?.paidRent) + resolveRowUtilityTotal(row, "paid"),
        closingBalance: numberOrZero(row?.closingBalance),
      })),
    notes: payload.notes || `${payload.statementType || "final"} statement processed from live cut-off snapshot`,
    managerDirectReceiptsCount: directToLandlordRows.length,
  };
};

const normalizeProcessedStatementSnapshot = (snapshot = {}) => {
  const rawNetAmountDue = numberOrZero(snapshot.netAmountDue);
  const rawNetAfterExpenses =
    snapshot.netAfterExpenses !== undefined ? Number(snapshot.netAfterExpenses || 0) : rawNetAmountDue;
  const explicitNegativeRecovery = Math.max(numberOrZero(snapshot.amountPayableByLandlordToManager), 0);
  const isNegative =
    Boolean(snapshot.isNegativeStatement) ||
    explicitNegativeRecovery > 0 ||
    rawNetAmountDue < 0 ||
    rawNetAfterExpenses < 0;

  return {
    ...snapshot,
    netAmountDue: isNegative ? 0 : Math.max(rawNetAmountDue, 0),
    netAfterExpenses: rawNetAfterExpenses,
    isNegativeStatement: isNegative,
    amountPayableByLandlordToManager: isNegative
      ? explicitNegativeRecovery || Math.abs(Math.min(rawNetAmountDue, rawNetAfterExpenses, 0))
      : 0,
  };
};

export const closeStatement = async (req, res) => {
  try {
    const payload = req.body || {};
    const statementId = payload.statementId || payload.sourceStatement || payload.sourceStatementId || null;

    let approvedStatement = null;
    let business = payload.business || payload.businessId || req.user?.company || null;
    let landlord = payload.landlord || payload.landlordId || null;
    let property = payload.property || payload.propertyId || null;
    let periodStart = payload.periodStart;
    let periodEnd = payload.periodEnd;

    let scopedBusinessId = null;
    try {
      scopedBusinessId = resolveScopedBusinessId(req, business || null);
      if (scopedBusinessId) {
        business = scopedBusinessId;
      }
    } catch (scopeError) {
      return res.status(scopeError.statusCode || 403).json({ message: scopeError.message });
    }

    if (statementId) {
      const scopedStatementQuery = { _id: statementId };
      if (scopedBusinessId) {
        scopedStatementQuery.business = scopedBusinessId;
      }

      approvedStatement = await LandlordStatement.findOne(scopedStatementQuery).lean();
      if (!approvedStatement) {
        return res.status(404).json({ message: "Approved statement snapshot not found" });
      }
      if (!["approved", "sent"].includes(String(approvedStatement.status || ""))) {
        return res.status(400).json({ message: "Only approved or sent statements can be processed" });
      }

      business = business || approvedStatement.business;

      try {
        const verifiedBusinessId = resolveScopedBusinessId(req, business || approvedStatement.business || null);
        if (verifiedBusinessId) {
          business = verifiedBusinessId;
        }
      } catch (scopeError) {
        return res.status(scopeError.statusCode || 403).json({ message: scopeError.message });
      }

      landlord = landlord || approvedStatement.landlord;
      property = property || approvedStatement.property;
      periodStart = periodStart || approvedStatement.periodStart;
      periodEnd = periodEnd || approvedStatement.periodEnd;
    }

    if ((!landlord || !business) && property) {
      const propertyContext = await resolvePropertyLandlord(property);
      if (propertyContext) {
        business = business || propertyContext.businessId;
        landlord = landlord || propertyContext.landlordId;
      }
    }

    const userId = await resolveActorUserId(req, business);

    if (!business || !landlord || !property || !periodStart || !periodEnd || !userId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const start = startOfDay(periodStart);
    const end = endOfDay(periodEnd);
    if (!start || !end) {
      return res.status(400).json({ message: "Invalid periodStart or periodEnd" });
    }

    if (start.getTime() > end.getTime()) {
      return res.status(400).json({ message: "periodStart cannot be after periodEnd" });
    }

    const processingCutoffAt = resolveProcessedStatementCutoffAt(
      end,
      payload.cutoffAt || payload.closedAt || null
    );

    if (!processingCutoffAt) {
      return res.status(400).json({ message: "Unable to resolve a valid statement cut-off time." });
    }

    const now = new Date();
    if (processingCutoffAt.getTime() > now.getTime()) {
      return res.status(400).json({
        message: "Statement dates cannot be in the future. Process statements only up to the current moment.",
      });
    }

    if (approvedStatement?._id) {
      await ProcessedStatement.updateMany(
        {
          business,
          sourceStatement: approvedStatement._id,
          status: "reversed",
        },
        {
          $set: {
            reversedSourceStatement: approvedStatement._id,
            reversedSourceStatementNumber:
              approvedStatement.statementNumber || approvedStatement.sourceStatementNumber || null,
            sourceStatement: null,
          },
        }
      );

      const duplicateBySource = await ProcessedStatement.findOne({
        business,
        sourceStatement: approvedStatement._id,
        status: { $ne: "reversed" },
      });

      if (duplicateBySource) {
        return res.status(400).json({
          message: "This approved statement has already been processed",
          statement: duplicateBySource,
        });
      }
    }

    let generatedStatementData = null;
    if (approvedStatement?._id) {
      generatedStatementData = await generateLandlordStatement({
        propertyId: property,
        landlordId: landlord,
        statementPeriodStart: start,
        statementPeriodEnd: end,
        cutoffAt: processingCutoffAt,
      });
    }

    const actualPeriodStart = generatedStatementData?.periodStart || start;
    const actualPeriodEnd = generatedStatementData?.periodEnd || processingCutoffAt || end;

    if (
      !actualPeriodStart ||
      !actualPeriodEnd ||
      Number.isNaN(new Date(actualPeriodStart).getTime()) ||
      Number.isNaN(new Date(actualPeriodEnd).getTime())
    ) {
      return res.status(400).json({ message: "Resolved processed statement period is invalid." });
    }

    const requestedWindow = {
      startAt: new Date(actualPeriodStart),
      endAt: new Date(actualPeriodEnd),
    };

    if (requestedWindow.startAt.getTime() > requestedWindow.endAt.getTime()) {
      return res.status(400).json({ message: "Resolved processed statement period is invalid." });
    }

    const candidateStatements = await ProcessedStatement.find({
      business,
      landlord,
      property,
      status: { $ne: "reversed" },
      $or: [
        { cutoffAt: { $gte: startOfDay(actualPeriodStart) || actualPeriodStart } },
        { periodEnd: { $gte: startOfDay(actualPeriodStart) || actualPeriodStart } },
      ],
    })
      .select("_id periodStart periodEnd previousCutoffAt sourceStatement status cutoffAt closedAt")
      .sort({ cutoffAt: -1, closedAt: -1, periodEnd: -1 })
      .lean();

    const overlappingStatement = candidateStatements.find((item) =>
      windowsOverlap(resolveStoredStatementWindow(item), requestedWindow)
    );

    if (overlappingStatement) {
      return res.status(400).json({
        message: "A processed statement already exists that overlaps this cut-off period. Reverse the overlapping statement first.",
        statement: overlappingStatement,
      });
    }

    const snapshotData = normalizeProcessedStatementSnapshot(
      approvedStatement
        ? buildStatementSnapshotPayload(
            {
              ...approvedStatement,
              openingBalance: numberOrZero(
                generatedStatementData?.openingBalance ?? approvedStatement?.openingBalance
              ),
              closingBalance: numberOrZero(
                generatedStatementData?.closingBalance ?? approvedStatement?.closingBalance
              ),
              metadata: {
                ...(approvedStatement?.metadata || {}),
                workspace: generatedStatementData?.metadata || approvedStatement?.metadata?.workspace || {},
              },
            },
            payload
          )
        : {
            statementType: payload.statementType || "provisional",
            totalRentInvoiced: numberOrZero(payload.totalRentInvoiced),
            totalRentReceived: numberOrZero(payload.totalRentReceived),
            totalRentReceivedByManager: numberOrZero(payload.totalRentReceivedByManager),
            totalRentReceivedByLandlord: numberOrZero(payload.totalRentReceivedByLandlord),
            totalUtilitiesCollected: numberOrZero(payload.totalUtilitiesCollected),
            depositsHeldByManager: numberOrZero(payload.depositsHeldByManager),
            depositsHeldByLandlord: numberOrZero(payload.depositsHeldByLandlord),
            unappliedPayments: numberOrZero(payload.unappliedPayments),
            commissionPercentage: numberOrZero(payload.commissionPercentage),
            commissionBasis: payload.commissionBasis || "received",
            commissionAmount: numberOrZero(payload.commissionAmount),
            commissionTaxAmount: numberOrZero(payload.commissionTaxAmount),
            commissionGrossAmount: numberOrZero(payload.commissionGrossAmount ?? (payload.commissionAmount || 0) + (payload.commissionTaxAmount || 0)),
            commissionTaxMode: payload.commissionTaxMode || "exclusive",
            commissionTaxRate: numberOrZero(payload.commissionTaxRate),
            commissionTaxCodeKey: payload.commissionTaxCodeKey || "no_tax",
            netAmountDue: numberOrZero(payload.netAmountDue),
            totalExpenses: numberOrZero(payload.totalExpenses),
            recurringDeductions: numberOrZero(payload.recurringDeductions),
            advanceRecoveries: numberOrZero(payload.advanceRecoveries),
            expensesByCategory: payload.expensesByCategory || {},
            netAfterExpenses: numberOrZero(payload.netAfterExpenses ?? payload.netAmountDue),
            amountPayableByLandlordToManager: numberOrZero(payload.amountPayableByLandlordToManager),
            summaryBuckets: payload.summaryBuckets || {},
            financialEvents: Array.isArray(payload.financialEvents) ? payload.financialEvents : [],
            isNegativeStatement: Boolean(payload.isNegativeStatement),
            occupiedUnits: numberOrZero(payload.occupiedUnits),
            vacantUnits: numberOrZero(payload.vacantUnits),
            tenantRows: Array.isArray(payload.tenantRows) ? payload.tenantRows : [],
            notes: payload.notes || null,
          }
    );

    const newStatement = new ProcessedStatement({
      business,
      landlord,
      property,
      sourceStatement: approvedStatement?._id || null,
      sourceStatementNumber: approvedStatement?.statementNumber || null,
      periodStart: actualPeriodStart,
      periodEnd: actualPeriodEnd,
      cutoffAt: actualPeriodEnd,
      previousCutoffAt: generatedStatementData?.metadata?.previousCutoffAt || null,
      ...snapshotData,
      status: snapshotData.netAmountDue > 0 ? "unpaid" : "processed",
      amountPaid: 0,
      balanceDue: snapshotData.netAmountDue > 0 ? snapshotData.netAmountDue : 0,
      paymentHistory: [],
      closedBy: userId,
      closedAt: now,
    });

    const savedStatement = await newStatement.save();

    if (approvedStatement?._id && numberOrZero(snapshotData.commissionAmount) > 0) {
      await postCommissionAccrualForProcessedStatement({
        processedStatement: savedStatement,
        approvedStatement,
        userId,
      });
    }

    await savedStatement.populate([
      { path: "landlord", select: "landlordName firstName lastName email contact" },
      { path: "property", select: "propertyCode propertyName name commissionPaymentMode commissionFixedAmount commissionPercentage commissionRecognitionBasis" },
      { path: "business", select: "companyName name" },
      { path: "closedBy", select: "username email surname otherNames" },
      { path: "sourceStatement", select: "statementNumber status periodStart periodEnd approvedAt" },
      { path: "reversedSourceStatement", select: "statementNumber status periodStart periodEnd approvedAt" },
    ]);

    res.status(201).json({
      success: true,
      message: "Statement processed successfully",
      statement: savedStatement,
    });
  } catch (error) {
    console.error("Close statement error:", error);
    res.status(500).json({ message: "Error closing statement", error: error.message });
  }
};

export const getStatementsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, landlord, property, month } = req.query;
    const scopedBusinessId = resolveScopedBusinessId(req, businessId);
    const query = { business: scopedBusinessId };

    if (status && ["paid", "unpaid", "processed", "part_paid", "reversed"].includes(status)) query.status = status;
    if (landlord) query.landlord = landlord;
    if (property) query.property = property;
    if (month) {
      const [year, monthNum] = String(month).split("-");
      query.periodEnd = {
        $gte: new Date(year, Number(monthNum) - 1, 1),
        $lte: new Date(year, Number(monthNum), 0, 23, 59, 59, 999),
      };
    }

    const statements = await ProcessedStatement.find(query)
      .populate([
        { path: "landlord", select: "landlordName firstName lastName" },
        { path: "property", select: "propertyCode propertyName name commissionPaymentMode commissionFixedAmount commissionPercentage commissionRecognitionBasis" },
        { path: "business", select: "companyName name" },
        { path: "sourceStatement", select: "statementNumber status approvedAt" },
        { path: "reversedSourceStatement", select: "statementNumber status approvedAt" },
        { path: "reversedBy", select: "username email surname otherNames" },
      ])
      .sort({ closedAt: -1 });

    res.status(200).json({ success: true, count: statements.length, statements });
  } catch (error) {
    console.error("Get statements error:", error);
    res.status(500).json({ message: "Error fetching statements", error: error.message });
  }
};

export const getStatementById = async (req, res) => {
  try {
    const { statementId } = req.params;
    const statement = await findScopedProcessedStatementById(req, statementId, [
      { path: "landlord" },
      { path: "property" },
      { path: "business", select: "companyName address phone email" },
      { path: "closedBy", select: "username email" },
      { path: "reversedBy", select: "username email surname otherNames" },
      { path: "sourceStatement", select: "statementNumber status periodStart periodEnd approvedAt" },
      { path: "reversedSourceStatement", select: "statementNumber status periodStart periodEnd approvedAt" },
    ]);
    if (!statement) return res.status(404).json({ message: "Statement not found" });
    res.status(200).json({ success: true, statement });
  } catch (error) {
    console.error("Get statement error:", error);
    res.status(500).json({ message: "Error fetching statement", error: error.message });
  }
};

export const updateStatement = async (req, res) => {
  try {
    const { statementId } = req.params;
    const { status, amountPaid, paidDate, paymentMethod, paymentReference, notes } = req.body;
    const statement = await findScopedProcessedStatementById(req, statementId);
    if (!statement) return res.status(404).json({ message: "Statement not found" });

    if (statement.status === "reversed") {
      return res.status(400).json({ message: "Reversed statements cannot be edited" });
    }

    const nextAmountPaid = amountPaid !== undefined ? numberOrZero(amountPaid) : numberOrZero(statement.amountPaid);
    const due = numberOrZero(statement.netAmountDue);
    const actorUserId = await resolveActorUserId(req, String(statement.business || ""));
    const isNegativeStatement =
      Boolean(statement.isNegativeStatement) || numberOrZero(statement.amountPayableByLandlordToManager) > 0;

    if (isNegativeStatement && (amountPaid !== undefined || ["paid", "unpaid", "part_paid"].includes(status))) {
      return res.status(400).json({
        message:
          "This processed statement is negative. The landlord owes the manager, so landlord payment status updates are not allowed here.",
      });
    }

    if (status && ["paid", "unpaid", "processed", "part_paid"].includes(status)) {
      statement.status = isNegativeStatement ? "processed" : status;
    }

    if (amountPaid !== undefined) {
      statement.amountPaid = nextAmountPaid;

      if (nextAmountPaid > 0) {
        statement.paymentHistory = [
          ...(Array.isArray(statement.paymentHistory) ? statement.paymentHistory : []),
          {
            amount: nextAmountPaid,
            paymentDate: paidDate ? new Date(paidDate) : new Date(),
            paymentMethod: paymentMethod || statement.paymentMethod || null,
            paymentReference: paymentReference || null,
            notes: notes || null,
            createdBy: actorUserId || null,
          },
        ];
      }

      if (due <= 0) {
        statement.status = "processed";
      } else if (nextAmountPaid <= 0) {
        statement.status = "unpaid";
      } else if (nextAmountPaid < due) {
        statement.status = "part_paid";
      } else {
        statement.status = "paid";
      }
    }

    if (paidDate) statement.paidDate = new Date(paidDate);
    if (paymentMethod) statement.paymentMethod = paymentMethod;
    if (paymentReference) statement.paymentReference = paymentReference;
    if (notes !== undefined) statement.notes = notes;

    const updatedStatement = await statement.save();
    await updatedStatement.populate([
      { path: "landlord", select: "landlordName firstName lastName" },
      { path: "property", select: "propertyCode propertyName name commissionPaymentMode commissionFixedAmount commissionPercentage commissionRecognitionBasis" },
      { path: "business", select: "companyName name" },
      { path: "sourceStatement", select: "statementNumber status approvedAt" },
      { path: "reversedSourceStatement", select: "statementNumber status approvedAt" },
      { path: "reversedBy", select: "username email surname otherNames" },
    ]);
    res.status(200).json({ success: true, message: "Statement updated successfully", statement: updatedStatement });
  } catch (error) {
    console.error("Update statement error:", error);
    res.status(500).json({ message: "Error updating statement", error: error.message });
  }
};

export const reverseStatement = async (req, res) => {
  try {
    const { statementId } = req.params;
    const reason = String(req.body?.reason || "Processed statement reversed").trim();
    const statement = await findScopedProcessedStatementById(req, statementId);

    if (!statement) return res.status(404).json({ message: "Statement not found" });
    if (statement.status === "reversed") {
      return res.status(400).json({ message: "Statement is already reversed" });
    }

    const { blocked, hasRecoveryActivity } = await hasActiveDownstreamPayments(statement);
    if (blocked) {
      return res.status(400).json({
        message: hasRecoveryActivity
          ? "This processed statement already has landlord recovery activity. Reverse the related recovery posting(s) first."
          : "This processed statement already has landlord payment activity. Reverse the related payment voucher(s) first.",
      });
    }

    const actorUserId = await resolveActorUserId(req, String(statement.business || ""));
    const reversals = await reverseProcessedStatementLedgerEntries({
      statement,
      userId: actorUserId,
      reason,
    });

    statement.status = "reversed";
    statement.reversedAt = new Date();
    statement.reversedBy = actorUserId;
    statement.reversalReason = reason || "Processed statement reversed";
    if (!statement.reversedSourceStatement && statement.sourceStatement) {
      statement.reversedSourceStatement = statement.sourceStatement;
    }
    if (!statement.reversedSourceStatementNumber && statement.sourceStatementNumber) {
      statement.reversedSourceStatementNumber = statement.sourceStatementNumber;
    }
    statement.sourceStatement = null;
    await statement.save();

    await statement.populate([
      { path: "landlord", select: "landlordName firstName lastName" },
      { path: "property", select: "propertyCode propertyName name commissionPaymentMode commissionFixedAmount commissionPercentage commissionRecognitionBasis" },
      { path: "business", select: "companyName name" },
      { path: "sourceStatement", select: "statementNumber status approvedAt" },
      { path: "reversedSourceStatement", select: "statementNumber status approvedAt" },
      { path: "reversedBy", select: "username email surname otherNames" },
    ]);

    res.status(200).json({
      success: true,
      message: "Processed statement reversed successfully",
      statement,
      reversedLedgerEntries: reversals.map((row) => row?.reversalEntry?._id).filter(Boolean),
    });
  } catch (error) {
    console.error("Reverse statement error:", error);
    res.status(500).json({ message: "Error reversing statement", error: error.message });
  }
};

export const deleteStatement = async (req, res) => {
  try {
    return res.status(400).json({
      success: false,
      message: "Processed statements cannot be deleted. Reverse the statement instead to preserve the audit trail.",
    });
  } catch (error) {
    console.error("Delete statement error:", error);
    res.status(500).json({ message: "Error deleting statement", error: error.message });
  }
};

export const getStatementStats = async (req, res) => {
  try {
    const { businessId } = req.params;
    const scopedBusinessId = resolveScopedBusinessId(req, businessId);
    const stats = await ProcessedStatement.aggregate([
      { $match: { business: toObjectId(scopedBusinessId) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$netAmountDue" },
          totalPaid: { $sum: "$amountPaid" },
          totalBalanceDue: { $sum: "$balanceDue" },
        },
      },
    ]);
    res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error("Get stats error:", error);
    res.status(500).json({ message: "Error fetching stats", error: error.message });
  }
};