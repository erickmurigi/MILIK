/**
 * HR Payroll GL posting service.
 *
 * Posts to FinancialLedgerEntry (same model as all other modules) so that
 * payroll salary expense and liability entries appear on the income statement
 * and trial balance. Previous versions posted to JournalEntry — historical
 * JournalEntry records remain untouched; all new postings go here.
 *
 * Journal structure per payroll component:
 *   Dr Salary Expense (5400)     — gross salary split by component
 *   Cr PAYE Payable (2170)       — employee PAYE withheld
 *   Cr NHIF Payable (2171)       — employee NHIF/SHA contribution
 *   Cr NSSF Payable (2172)       — employee NSSF contribution
 *   Cr AHL Payable (2173)        — AHL levy
 *   Cr Other Deductions (2174)   — other payroll deductions
 *   Cr Net Salaries Payable (2175) — net pay owed to employees
 */

import mongoose from 'mongoose';
import FinancialLedgerEntry from '../../../models/FinancialLedgerEntry.js';
import { postEntry } from '../../../services/ledgerPostingService.js';
import { ensureSystemChartOfAccounts } from '../../../services/chartOfAccountsService.js';
import { resolveConfiguredHrAccountingDefaultAccount } from '../../../services/companyAccountingDefaultsService.js';

const dayRange = (value = new Date()) => {
  const d = value ? new Date(value) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

// ─── Account resolution ───────────────────────────────────────────────────────

export const resolvePayrollAccounts = async (businessId) => {
  await ensureSystemChartOfAccounts(businessId);

  const [
    salaryExpense,
    payePayable,
    nhifPayable,
    nssfPayable,
    ahlPayable,
    otherDeductionsPayable,
    netPayable,
  ] = await Promise.all([
    resolveConfiguredHrAccountingDefaultAccount({ businessId, field: 'salaryExpenseAccount' }),
    resolveConfiguredHrAccountingDefaultAccount({ businessId, field: 'payePayableAccount' }),
    resolveConfiguredHrAccountingDefaultAccount({ businessId, field: 'nhifPayableAccount' }),
    resolveConfiguredHrAccountingDefaultAccount({ businessId, field: 'nssfPayableAccount' }),
    resolveConfiguredHrAccountingDefaultAccount({ businessId, field: 'ahlPayableAccount' }),
    resolveConfiguredHrAccountingDefaultAccount({ businessId, field: 'otherDeductionsPayableAccount' }),
    resolveConfiguredHrAccountingDefaultAccount({ businessId, field: 'netPayableAccount' }),
  ]);

  const missing = [];
  if (!salaryExpense)          missing.push('Salary Expense (5400)');
  if (!payePayable)            missing.push('PAYE Payable (2170)');
  if (!nhifPayable)            missing.push('NHIF Payable (2171)');
  if (!nssfPayable)            missing.push('NSSF Payable (2172)');
  if (!ahlPayable)             missing.push('AHL Payable (2173)');
  if (!otherDeductionsPayable) missing.push('Other Deductions Payable (2174)');
  if (!netPayable)             missing.push('Net Salaries Payable (2175)');

  if (missing.length > 0) {
    throw new Error(
      `GL accounts not configured: ${missing.join(', ')}. ` +
      `Go to Company Settings → Accounting Defaults → HR to set these up.`
    );
  }

  return { salaryExpense, payePayable, nhifPayable, nssfPayable, ahlPayable, otherDeductionsPayable, netPayable };
};

// ─── Main posting function ────────────────────────────────────────────────────

/**
 * Posts payroll GL double-entries to FinancialLedgerEntry for a payroll period.
 * Idempotent — safe to call again if a previous attempt partially failed.
 *
 * @returns {{ entryCount: number, alreadyPosted: boolean }}
 */
export const postPayrollGLJournals = async (period, companyId, postedByUserId) => {
  const businessId = new mongoose.Types.ObjectId(String(companyId));
  const postedById = postedByUserId ? new mongoose.Types.ObjectId(String(postedByUserId)) : null;

  // Idempotency — skip if entries already exist for this period
  const existing = await FinancialLedgerEntry.countDocuments({
    business: businessId,
    sourceTransactionType: 'payroll_period',
    sourceTransactionId: String(period._id),
    status: { $ne: 'reversed' },
  });
  if (existing > 0) return { entryCount: existing, alreadyPosted: true };

  const accounts = await resolvePayrollAccounts(businessId);

  // Day 0 of the following month = last day of the payroll month
  const periodDate = new Date(period.year, period.month, 0);
  const { start, end } = dayRange(periodDate);

  const components = [
    { account: accounts.payePayable,            amount: Math.round(period.totalPAYE || 0),            label: `PAYE tax withheld — ${period.label}` },
    { account: accounts.nhifPayable,            amount: Math.round(period.totalNHIF || 0),            label: `NHIF/SHA employee contributions — ${period.label}` },
    { account: accounts.nssfPayable,            amount: Math.round(period.totalNSSF || 0),            label: `NSSF employee contributions — ${period.label}` },
    { account: accounts.ahlPayable,             amount: Math.round(period.totalAHL || 0),             label: `AHL levy — ${period.label}` },
    { account: accounts.otherDeductionsPayable, amount: Math.round(period.totalOtherDeductions || 0), label: `Other payroll deductions — ${period.label}` },
    { account: accounts.netPayable,             amount: Math.round(period.totalNet || 0),             label: `Net salaries payable — ${period.label}` },
  ].filter((c) => c.amount > 0);

  if (components.length === 0) {
    throw new Error(`No payroll amounts to post for ${period.label} — all components are zero.`);
  }

  let entryCount = 0;

  for (const component of components) {
    const journalGroupId = new mongoose.Types.ObjectId();
    const base = {
      business: businessId,
      sourceTransactionType: 'payroll_period',
      sourceTransactionId: String(period._id),
      transactionDate: periodDate,
      statementPeriodStart: start,
      statementPeriodEnd: end,
      journalGroupId,
      category: 'PAYROLL_JOURNAL',
      amount: component.amount,
      notes: component.label,
      createdBy: postedById,
      allowUnscoped: true,
    };

    await Promise.all([
      postEntry({ ...base, accountId: accounts.salaryExpense._id, direction: 'debit' }),
      postEntry({ ...base, accountId: component.account._id,      direction: 'credit' }),
    ]);

    entryCount += 2;
  }

  return { entryCount, alreadyPosted: false };
};

// ─── Reversal function ────────────────────────────────────────────────────────

/**
 * Reverses all active GL entries posted for a payroll period by creating
 * offsetting debit/credit pairs and marking the originals as 'reversed'.
 *
 * @returns {{ reversedCount: number }}
 */
export const reversePayrollGLJournals = async (period, companyId, reversedByUserId) => {
  const businessId = new mongoose.Types.ObjectId(String(companyId));
  const reversedById = reversedByUserId ? new mongoose.Types.ObjectId(String(reversedByUserId)) : null;

  const originals = await FinancialLedgerEntry.find({
    business: businessId,
    sourceTransactionType: 'payroll_period',
    sourceTransactionId: String(period._id),
    status: { $ne: 'reversed' },
  }).lean();

  if (originals.length === 0) return { reversedCount: 0 };

  const reversalDate = new Date();
  const { start, end } = dayRange(reversalDate);

  for (const entry of originals) {
    const reversalGroupId = new mongoose.Types.ObjectId();
    await Promise.all([
      // Offsetting entry — flips direction to zero out the original
      postEntry({
        business: businessId,
        accountId: entry.accountId,
        direction: entry.direction === 'debit' ? 'credit' : 'debit',
        amount: entry.amount,
        transactionDate: reversalDate,
        statementPeriodStart: start,
        statementPeriodEnd: end,
        journalGroupId: reversalGroupId,
        sourceTransactionType: 'payroll_reversal',
        sourceTransactionId: String(period._id),
        category: 'PAYROLL_REVERSAL',
        notes: `REVERSAL: ${entry.notes || period.label}`,
        createdBy: reversedById,
        allowUnscoped: true,
      }),
    ]);
  }

  // Mark all originals as reversed
  await FinancialLedgerEntry.updateMany(
    {
      business: businessId,
      sourceTransactionType: 'payroll_period',
      sourceTransactionId: String(period._id),
      status: { $ne: 'reversed' },
    },
    { $set: { status: 'reversed' } }
  );

  return { reversedCount: originals.length };
};
