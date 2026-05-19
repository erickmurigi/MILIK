import mongoose from 'mongoose';
import JournalEntry from '../../../models/JournalEntry.js';
import SequenceCounter from '../../../models/SequenceCounter.js';
import { ensureSystemChartOfAccounts } from '../../../services/chartOfAccountsService.js';
import { resolveConfiguredHrAccountingDefaultAccount } from '../../../services/companyAccountingDefaultsService.js';

const resolvePayrollAccounts = async (businessId) => {
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
  if (!salaryExpense) missing.push('Salary Expense Account (5400)');
  if (!payePayable) missing.push('PAYE Payable Account (2170)');
  if (!nhifPayable) missing.push('NHIF Payable Account (2171)');
  if (!nssfPayable) missing.push('NSSF Payable Account (2172)');
  if (!ahlPayable) missing.push('AHL Payable Account (2173)');
  if (!otherDeductionsPayable) missing.push('Other Deductions Payable Account (2174)');
  if (!netPayable) missing.push('Net Salaries Payable Account (2175)');

  if (missing.length > 0) {
    throw new Error(
      `Cannot post payroll journal — GL accounts not resolved: ${missing.join(', ')}. ` +
      `Configure HR accounting defaults in Company Settings → Accounting Defaults.`
    );
  }

  return { salaryExpense, payePayable, nhifPayable, nssfPayable, ahlPayable, otherDeductionsPayable, netPayable };
};

const nextPayrollJournalBatchBase = async (businessId) => {
  const counter = await SequenceCounter.findOneAndUpdate(
    { business: businessId, key: 'journal_entry' },
    { $inc: { sequence: 1 } },
    { upsert: true, new: true }
  );
  return `JRN${String(counter.sequence).padStart(4, '0')}`;
};

/**
 * Posts aggregated payroll GL journal entries for a payroll period.
 *
 * Each deduction component is posted as DR Salary Expense / CR <liability> so that
 * the sum of debits across all entries equals the period gross salary.
 *
 * Entries are grouped by journalGroupId and tagged sourceModule: "hr".
 *
 * @param {Object}   period       - HRPayrollPeriod document (must be Approved)
 * @param {ObjectId} companyId
 * @param {ObjectId} postedByUserId
 * @returns {{ journalGroupId: ObjectId, entryCount: number }}
 */
export const postPayrollGLJournals = async (period, companyId, postedByUserId) => {
  const businessId = new mongoose.Types.ObjectId(String(companyId));
  const postedById = postedByUserId ? new mongoose.Types.ObjectId(String(postedByUserId)) : null;
  const periodDate = new Date(period.year, period.month - 1, 28);

  const accounts = await resolvePayrollAccounts(businessId);
  const journalGroupId = new mongoose.Types.ObjectId();
  const baseRef = `PAYROLL-${period.label.replace(/\s+/g, '-').toUpperCase()}`;

  const components = [
    {
      creditAccount: accounts.payePayable._id,
      amount: Math.round(period.totalPAYE || 0),
      narration: `PAYE tax withheld — ${period.label}`,
    },
    {
      creditAccount: accounts.nhifPayable._id,
      amount: Math.round(period.totalNHIF || 0),
      narration: `NHIF/SHA employee contributions — ${period.label}`,
    },
    {
      creditAccount: accounts.nssfPayable._id,
      amount: Math.round(period.totalNSSF || 0),
      narration: `NSSF employee contributions — ${period.label}`,
    },
    {
      creditAccount: accounts.ahlPayable._id,
      amount: Math.round(period.totalAHL || 0),
      narration: `AHL levy — ${period.label}`,
    },
    {
      creditAccount: accounts.otherDeductionsPayable._id,
      amount: Math.round(period.totalOtherDeductions || 0),
      narration: `Other payroll deductions — ${period.label}`,
    },
    {
      creditAccount: accounts.netPayable._id,
      amount: Math.round(period.totalNet || 0),
      narration: `Net salaries payable — ${period.label}`,
    },
  ].filter((c) => c.amount > 0);

  if (components.length === 0) {
    throw new Error(`No payroll amounts to post for ${period.label} — all components are zero.`);
  }

  const baseNo = await nextPayrollJournalBatchBase(businessId);
  const postedAt = new Date();

  const entries = components.map((component, i) => ({
    journalNo: `${baseNo}-${String(i + 1).padStart(2, '0')}`,
    date: periodDate,
    journalType: 'payroll_posting',
    sourceModule: 'hr',
    sourceDocumentType: 'Payslip',
    sourceDocumentId: period._id,
    debitAccount: accounts.salaryExpense._id,
    creditAccount: component.creditAccount,
    amount: component.amount,
    narration: component.narration,
    reference: baseRef,
    status: 'posted',
    journalGroupId,
    business: businessId,
    postedBy: postedById,
    postedAt,
    createdBy: postedById,
  }));

  await JournalEntry.insertMany(entries, { ordered: true });

  return { journalGroupId, entryCount: entries.length };
};
