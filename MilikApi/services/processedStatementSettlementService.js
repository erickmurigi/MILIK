import mongoose from "mongoose";
import PaymentVoucher from "../models/PaymentVoucher.js";
import ProcessedStatement from "../models/ProcessedStatement.js";
import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import { round2 } from "../utils/math.js";

const normalizeDate = (value, fallback = null) => {
  const parsed = value ? new Date(value) : fallback ? new Date(fallback) : null;
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
};

const toComparableHistory = (rows = []) =>
  rows.map((row) => ({
    amount: round2(row?.amount || 0),
    paymentDate: row?.paymentDate ? new Date(row.paymentDate).toISOString() : null,
    paymentMethod: row?.paymentMethod || null,
    paymentReference: row?.paymentReference || null,
    notes: row?.notes || null,
    createdBy: row?.createdBy ? String(row.createdBy) : null,
    entryId: row?.entryId ? String(row.entryId) : null,
  }));

const historiesDiffer = (currentRows = [], nextRows = []) =>
  JSON.stringify(toComparableHistory(currentRows)) !== JSON.stringify(toComparableHistory(nextRows));

const buildPositiveStatementStatus = ({ statement, amountPaid }) => {
  const netAmountDue = round2(statement?.netAmountDue || 0);
  const balanceDue = Math.max(round2(netAmountDue - amountPaid), 0);

  if (netAmountDue <= 0) {
    return { status: "processed", balanceDue };
  }

  if (amountPaid <= 0) {
    return { status: "unpaid", balanceDue };
  }

  if (balanceDue <= 0) {
    return { status: "paid", balanceDue: 0 };
  }

  return { status: "part_paid", balanceDue };
};

const mapVoucherToHistoryRow = (voucher) => ({
  amount: round2(voucher?.amount || 0),
  paymentDate: normalizeDate(voucher?.paidDate || voucher?.paidAt || voucher?.approvedAt || voucher?.createdAt, new Date()),
  paymentMethod: null,
  paymentReference: voucher?.voucherNo || null,
  notes: voucher?.narration || null,
  createdBy: voucher?.paidBy || voucher?.approvedBy || null,
  entryId: voucher?._id ? String(voucher._id) : null,
});

const mapRecoveryEntryToHistoryRow = (entry) => ({
  amount: round2(entry?.debit || entry?.amount || 0),
  paymentDate: normalizeDate(entry?.transactionDate || entry?.createdAt, new Date()),
  paymentMethod: entry?.metadata?.paymentMethod || null,
  paymentReference: entry?.metadata?.referenceNumber || null,
  notes: entry?.notes || null,
  createdBy: entry?.createdBy || null,
  entryId: entry?.sourceTransactionId ? String(entry.sourceTransactionId) : null,
});

export const computeProcessedStatementSettlementState = async ({ statementId, businessId = null, statementDocument = null } = {}) => {
  const statement =
    statementDocument ||
    (await ProcessedStatement.findOne({
      _id: statementId,
      ...(businessId ? { business: businessId } : {}),
    }));

  if (!statement?._id) {
    return null;
  }

  const scopedBusinessId = String(statement.business || businessId || "");
  const scopedStatementId = String(statement._id);
  const isNegativeStatement =
    Boolean(statement.isNegativeStatement) || Number(statement.amountPayableByLandlordToManager || 0) > 0;

  const [activeVouchers, activeRecoveryEntries] = await Promise.all([
    PaymentVoucher.find({
      business: scopedBusinessId,
      $or: [
        { reference: String(scopedStatementId) },
        { sourceProcessedStatement: new mongoose.Types.ObjectId(String(scopedStatementId)) },
      ],
      status: { $ne: "reversed" },
    })
      .select("_id amount status voucherNo narration paidDate paidAt approvedAt approvedBy paidBy createdAt")
      .sort({ paidDate: 1, approvedAt: 1, createdAt: 1 })
      .lean(),
    FinancialLedgerEntry.find({
      business: scopedBusinessId,
      sourceTransactionType: "processed_statement_payment",
      status: "approved",
      reversalOf: null,
      "metadata.processedStatementId": scopedStatementId,
      "metadata.postingKind": "landlord_recovery",
      "metadata.postingRole": "cashbook_inflow",
    })
      .select("_id sourceTransactionId amount debit transactionDate createdAt notes metadata createdBy")
      .sort({ transactionDate: 1, createdAt: 1 })
      .lean(),
  ]);

  const settledPaymentVouchers = activeVouchers.filter((voucher) => ["approved", "paid"].includes(String(voucher?.status || "").toLowerCase()));
  const paymentHistory = settledPaymentVouchers.map(mapVoucherToHistoryRow);
  const amountPaid = round2(paymentHistory.reduce((sum, row) => sum + round2(row.amount), 0));
  const latestPayment = paymentHistory[paymentHistory.length - 1] || null;

  const recoveryHistory = activeRecoveryEntries.map(mapRecoveryEntryToHistoryRow);
  const amountRecovered = round2(recoveryHistory.reduce((sum, row) => sum + round2(row.amount), 0));
  const latestRecovery = recoveryHistory[recoveryHistory.length - 1] || null;
  const recoveryBalance = Math.max(
    round2(Number(statement.amountPayableByLandlordToManager || 0) - amountRecovered),
    0
  );

  const nextPositiveState = buildPositiveStatementStatus({ statement, amountPaid });

  return {
    statement,
    isNegativeStatement,
    activePaymentVoucherCount: activeVouchers.length,
    activeSettledPaymentCount: settledPaymentVouchers.length,
    activeRecoveryCount: recoveryHistory.length,
    hasRecoveryActivity: amountRecovered > 0 || recoveryHistory.length > 0,
    nextState: {
      amountPaid,
      balanceDue: isNegativeStatement ? round2(statement.balanceDue || 0) : nextPositiveState.balanceDue,
      status: isNegativeStatement ? String(statement.status || "processed") : nextPositiveState.status,
      paidDate: latestPayment?.paymentDate || null,
      paymentMethod: isNegativeStatement
        ? latestRecovery?.paymentMethod || statement.paymentMethod || null
        : latestPayment?.paymentMethod || null,
      paymentReference: isNegativeStatement
        ? latestRecovery?.paymentReference || statement.paymentReference || null
        : latestPayment?.paymentReference || null,
      paymentHistory,
      amountRecovered,
      recoveryBalance,
      recoveryDate: latestRecovery?.paymentDate || null,
      recoveryHistory,
    },
  };
};

export const syncProcessedStatementSettlementState = async ({ statementId, businessId = null, statementDocument = null } = {}) => {
  const computed = await computeProcessedStatementSettlementState({ statementId, businessId, statementDocument });
  if (!computed?.statement) {
    return null;
  }

  const { statement, nextState } = computed;
  let dirty = false;

  const assignScalar = (field, nextValue) => {
    const currentValue = statement[field];
    const currentComparable = currentValue instanceof Date
      ? currentValue.toISOString()
      : currentValue != null
      ? String(currentValue)
      : null;
    const nextComparable = nextValue instanceof Date
      ? nextValue.toISOString()
      : nextValue != null
      ? String(nextValue)
      : null;

    if (currentComparable !== nextComparable) {
      statement[field] = nextValue;
      dirty = true;
    }
  };

  assignScalar("amountPaid", nextState.amountPaid);
  assignScalar("balanceDue", nextState.balanceDue);
  if (String(statement.status || "") !== String(nextState.status || "")) {
    statement.status = nextState.status;
    dirty = true;
  }
  assignScalar("paidDate", nextState.paidDate);
  assignScalar("paymentMethod", nextState.paymentMethod);
  assignScalar("paymentReference", nextState.paymentReference);
  assignScalar("amountRecovered", nextState.amountRecovered);
  assignScalar("recoveryBalance", nextState.recoveryBalance);
  assignScalar("recoveryDate", nextState.recoveryDate);

  if (historiesDiffer(statement.paymentHistory, nextState.paymentHistory)) {
    statement.paymentHistory = nextState.paymentHistory;
    dirty = true;
  }

  if (historiesDiffer(statement.recoveryHistory, nextState.recoveryHistory)) {
    statement.recoveryHistory = nextState.recoveryHistory;
    dirty = true;
  }

  if (dirty) {
    await statement.save();
  }

  return {
    ...computed,
    dirty,
    statement,
  };
};
