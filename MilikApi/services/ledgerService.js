import FinancialLedgerEntry from "../models/FinancialLedgerEntry.js";
import mongoose from "mongoose";

/**
 * Double-entry posting service for Milik.
 * Creates two FinancialLedgerEntry records for each transaction,
 * ensures SUM(debit) === SUM(credit), and assigns one journalGroupId
 * so linked entries can be queried and reversed together.
 */
export async function postDoubleEntry({
  business,
  property,
  landlord,
  tenant,
  unit,
  sourceTransactionType,
  sourceTransactionId,
  transactionDate,
  statementPeriodStart,
  statementPeriodEnd,
  category,
  entries,
  notes,
  status = "approved",
  createdBy,
  approvedBy,
  metadata = {},
}) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw new Error("Double-entry posting requires exactly two entries.");
  }

  const totalDebit = entries.reduce((sum, entry) => sum + Number(entry?.debit || 0), 0);
  const totalCredit = entries.reduce((sum, entry) => sum + Number(entry?.credit || 0), 0);

  if (Number(totalDebit.toFixed(2)) !== Number(totalCredit.toFixed(2))) {
    throw new Error("Double-entry transaction is not balanced.");
  }

  const journalGroupId = new mongoose.Types.ObjectId();
  const common = {
    business,
    property,
    landlord,
    tenant,
    unit,
    sourceTransactionType,
    sourceTransactionId,
    transactionDate,
    statementPeriodStart,
    statementPeriodEnd,
    category,
    notes,
    status,
    createdBy,
    approvedBy,
    journalGroupId,
    metadata,
  };

  const records = entries.map((entry) => new FinancialLedgerEntry({
    ...common,
    accountId: entry.accountId,
    debit: Number(entry.debit || 0),
    credit: Number(entry.credit || 0),
  }));

  await FinancialLedgerEntry.insertMany(records);

  return records;
}
