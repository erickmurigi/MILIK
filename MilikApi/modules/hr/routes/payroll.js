import express from 'express';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRPayrollPeriod from '../models/HRPayrollPeriod.js';
import HRPayslip from '../models/HRPayslip.js';
import HREmployee from '../models/HREmployee.js';
import { resolveCompanyId, currentUserId, parsePage, parseLimit } from '../services/hrScope.js';
import { computeStatutory, cfgFromDoc } from '../services/hrStatutory.js';
import HRStatutoryConfig from '../models/HRStatutoryConfig.js';
import { postPayrollGLJournals, resolvePayrollAccounts, reversePayrollGLJournals } from '../services/hrPayrollGLService.js';
import { isSystemAdminUser } from '../../../utils/permissionControl.js';

const router = express.Router();

// ── Helper ───────────────────────────────────────────────────────────────────
function buildPayslip(emp, periodId, companyId, userId, cfg) {
  const basic = Math.max(0, Number(emp.basicSalary) || 0);

  const components = emp.salaryComponents || [];

  // Pass 1: resolve fixed allowances + percentage-of-basic allowances
  const allowances = components
    .filter((c) => c.type === 'Allowance')
    .map((c) => ({
      name: c.name,
      amount: c.isPercentage && c.percentageBase !== 'Gross'
        ? Math.round((basic * Number(c.amount)) / 100)
        : c.isPercentage ? null  // percentage-of-gross: resolved in pass 2
        : Math.round(Number(c.amount)),
      _raw: Number(c.amount),
      _pctGross: c.isPercentage && c.percentageBase === 'Gross',
    }));

  // Preliminary gross from non-pending allowances (for resolving % of gross)
  const grossPrelim = basic + allowances.reduce((s, a) => s + (a.amount ?? 0), 0);

  const allowancesResolved = allowances.map(({ name, amount, _raw, _pctGross }) => ({
    name,
    amount: _pctGross ? Math.round((grossPrelim * _raw) / 100) : amount,
  }));

  const gross = basic + allowancesResolved.reduce((s, a) => s + a.amount, 0);

  const { paye, nhif, nssf, ahl } = computeStatutory(gross, cfg);

  const otherDeductions = components
    .filter((c) => c.type === 'Deduction')
    .map((c) => ({
      name: c.name,
      amount: c.isPercentage
        ? Math.round(((c.percentageBase === 'Basic' ? basic : gross) * Number(c.amount)) / 100)
        : Math.round(Number(c.amount)),
    }));

  const totalDeductions = paye + nhif + nssf + ahl + otherDeductions.reduce((s, d) => s + d.amount, 0);
  const netSalary = Math.max(0, gross - totalDeductions);

  return {
    company: companyId,
    payrollPeriod: periodId,
    employee: emp._id,
    snapshot: {
      name: `${emp.surname} ${emp.otherNames}`,
      employeeNumber: emp.employeeNumber || '',
      department: emp.department?.name || '',
      designation: emp.designation?.name || '',
      kraPin: emp.kraPin || '',
      nhifNo: emp.nhifNo || '',
      nssfNo: emp.nssfNo || '',
      paymentMethod: emp.paymentMethod || '',
      bankName: emp.bankName || '',
      bankAccountNumber: emp.bankAccountNumber || '',
      bankBranch: emp.bankBranch || '',
      mpesaNumber: emp.mpesaNumber || '',
    },
    basicSalary: basic,
    allowances: allowancesResolved,
    grossSalary: gross,
    paye,
    nhif,
    nssf,
    ahl,
    otherDeductions,
    totalDeductions,
    netSalary,
    status: 'Draft',
    createdBy: userId,
  };
}

function sumPayslips(slips) {
  return slips.reduce(
    (acc, p) => ({
      employeeCount:        acc.employeeCount + 1,
      totalBasic:           acc.totalBasic + p.basicSalary,
      totalGross:           acc.totalGross + p.grossSalary,
      totalPAYE:            acc.totalPAYE + p.paye,
      totalNHIF:            acc.totalNHIF + p.nhif,
      totalNSSF:            acc.totalNSSF + p.nssf,
      totalAHL:             acc.totalAHL + p.ahl,
      totalOtherDeductions: acc.totalOtherDeductions + (p.otherDeductions || []).reduce((s, d) => s + d.amount, 0),
      totalDeductions:      acc.totalDeductions + p.totalDeductions,
      totalNet:             acc.totalNet + p.netSalary,
    }),
    { employeeCount: 0, totalBasic: 0, totalGross: 0, totalPAYE: 0, totalNHIF: 0, totalNSSF: 0, totalAHL: 0, totalOtherDeductions: 0, totalDeductions: 0, totalNet: 0 }
  );
}

// ── Payroll Periods ───────────────────────────────────────────────────────────

// GET /api/hr/payroll/periods
router.get('/periods', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { page, limit, year, status } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit, 20);

    const filter = { company: companyId };
    if (year)   filter.year   = Number(year);
    if (status) filter.status = status;

    const [periods, total] = await Promise.all([
      HRPayrollPeriod.find(filter)
        .sort({ year: -1, month: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HRPayrollPeriod.countDocuments(filter),
    ]);

    res.json({ periods, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/payroll/periods
router.post('/periods', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { month, year, notes } = req.body;

    if (!month || !year) return res.status(400).json({ message: 'Month and year are required' });
    if (month < 1 || month > 12) return res.status(400).json({ message: 'Invalid month' });

    const existing = await HRPayrollPeriod.findOne({ company: companyId, month, year });
    if (existing) return res.status(409).json({ message: `Payroll period for this month already exists (${existing.label})` });

    const period = new HRPayrollPeriod({ company: companyId, month, year, notes, createdBy: currentUserId(req) });
    await period.save();
    res.status(201).json(period);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Payroll period already exists for this month' });
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/payroll/periods/:id
router.get('/periods/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });
    res.json(period);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/payroll/periods/:id/run  — calculate and create payslips
router.post('/periods/:id/run', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const userId    = currentUserId(req);
    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId });
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });
    if (['Approved', 'Paid', 'Closed'].includes(period.status)) {
      return res.status(400).json({ message: `Cannot re-run a ${period.status} payroll period` });
    }

    period.status = 'Processing';
    await period.save();

    // Fetch statutory config and employees in parallel
    const [cfgDoc, employees] = await Promise.all([
      HRStatutoryConfig.findOne({ company: companyId }).lean(),
      HREmployee.find({ company: companyId, status: { $ne: 'Terminated' } })
        .populate('department', 'name')
        .populate('designation', 'name')
        .lean(),
    ]);
    const cfg = cfgFromDoc(cfgDoc);

    // Delete existing Draft payslips for this period
    await HRPayslip.deleteMany({ payrollPeriod: period._id, status: 'Draft' });

    // Build and insert payslips
    const payslipDocs = employees.map((emp) => buildPayslip(emp, period._id, companyId, userId, cfg));
    if (payslipDocs.length > 0) {
      await HRPayslip.insertMany(payslipDocs, { ordered: false });
    }

    // Compute totals from DB to account for any partial insertMany failures
    const inserted = await HRPayslip.find({ payrollPeriod: period._id, company: companyId }).lean();
    const totals = sumPayslips(inserted);
    Object.assign(period, totals, { status: 'Draft', updatedBy: userId });
    await period.save();

    res.json({ message: `Payroll run complete — ${payslipDocs.length} payslip(s) generated`, period });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/payroll/periods/:id/approve
router.patch('/periods/:id/approve', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const userId    = currentUserId(req);
    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId });
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });
    if (period.status !== 'Draft') return res.status(400).json({ message: `Period is ${period.status} — cannot approve` });
    if (period.employeeCount === 0) return res.status(400).json({ message: 'Run payroll first before approving' });

    // Pre-validate GL accounts before committing the approval — fail early with a clear message
    try {
      await resolvePayrollAccounts(companyId);
    } catch (accountErr) {
      return res.status(400).json({
        message: `Cannot approve payroll — ${accountErr.message}`,
      });
    }

    period.status     = 'Approved';
    period.approvedBy = userId;
    period.approvedAt = new Date();
    period.updatedBy  = userId;
    await period.save();

    await HRPayslip.updateMany({ payrollPeriod: period._id, status: 'Draft' }, { $set: { status: 'Approved', updatedBy: userId } });

    // Post GL — accounts are confirmed to exist so failures here are DB-level errors
    try {
      const { entryCount, alreadyPosted } = await postPayrollGLJournals(period, companyId, userId);
      period.glPosted    = true;
      period.glPostedAt  = new Date();
      period.glError     = '';
      await period.save();
      const msg = alreadyPosted
        ? `Payroll period approved (GL was already posted — ${entryCount} entries)`
        : `Payroll period approved and ${entryCount} GL entries posted`;
      return res.json({ message: msg, period });
    } catch (glErr) {
      period.glPosted = false;
      period.glError  = glErr.message || 'GL posting failed';
      await period.save();
      return res.status(500).json({
        message: `Payroll approved but GL posting failed: ${glErr.message}. Use the resync endpoint to retry.`,
        glError: period.glError,
        period,
      });
    }
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/payroll/periods/:id/resync-gl — retry GL posting for an approved period
router.patch('/periods/:id/resync-gl', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const userId    = currentUserId(req);
    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId });
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });
    if (!['Approved', 'Paid', 'Closed'].includes(period.status)) {
      return res.status(400).json({ message: 'Only approved, paid, or closed periods can resync GL' });
    }

    const { entryCount, alreadyPosted } = await postPayrollGLJournals(period, companyId, userId);
    period.glPosted   = true;
    period.glPostedAt = new Date();
    period.glError    = '';
    await period.save();

    const msg = alreadyPosted
      ? `GL already posted — ${entryCount} entries found (no duplicates created)`
      : `GL resync complete — ${entryCount} entries posted`;
    res.json({ message: msg, period });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/payroll/periods/:id/mark-paid
router.patch('/periods/:id/mark-paid', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const userId    = currentUserId(req);
    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId });
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });
    if (period.status !== 'Approved') return res.status(400).json({ message: 'Period must be Approved before marking as Paid' });

    period.status    = 'Paid';
    period.paidAt    = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
    period.updatedBy = userId;
    await period.save();

    await HRPayslip.updateMany({ payrollPeriod: period._id, status: 'Approved' }, { $set: { status: 'Paid', updatedBy: userId } });

    res.json({ message: 'Payroll marked as paid', period });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/payroll/periods/:id/reverse  — reverse an Approved or Paid period (admin only)
router.patch('/periods/:id/reverse', verifyUser, async (req, res) => {
  try {
    if (!req.user?.adminAccess && !isSystemAdminUser(req.user)) {
      return res.status(403).json({ message: 'Only administrators can reverse a payroll period' });
    }
    const companyId = resolveCompanyId(req);
    const userId    = currentUserId(req);
    const { reason } = req.body || {};

    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId });
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });
    if (!['Approved', 'Paid'].includes(period.status)) {
      return res.status(400).json({ message: `Only Approved or Paid periods can be reversed (current status: ${period.status})` });
    }

    // Reverse GL entries first
    let glReversalResult = { reversedCount: 0 };
    if (period.glPosted) {
      try {
        glReversalResult = await reversePayrollGLJournals(period, companyId, userId);
        period.glReversed   = true;
        period.glReversedAt = new Date();
      } catch (glErr) {
        return res.status(500).json({ message: `GL reversal failed: ${glErr.message}. Period not reversed.` });
      }
    }

    // Reverse all payslips
    await HRPayslip.updateMany(
      { payrollPeriod: period._id, status: { $in: ['Approved', 'Paid'] } },
      { $set: { status: 'Reversed', updatedBy: userId } }
    );

    period.status         = 'Reversed';
    period.reversedBy     = userId;
    period.reversedAt     = new Date();
    period.reversalReason = reason || '';
    period.updatedBy      = userId;
    await period.save();

    res.json({
      message: `Payroll period reversed. ${glReversalResult.reversedCount} GL entries reversed.`,
      period,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/payroll/periods/:id  — only Draft periods
router.delete('/periods/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId });
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });
    if (period.status !== 'Draft') return res.status(400).json({ message: 'Only Draft periods can be deleted' });

    await HRPayslip.deleteMany({ payrollPeriod: period._id });
    await period.deleteOne();
    res.json({ message: 'Payroll period deleted' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// ── Payslips ──────────────────────────────────────────────────────────────────

// GET /api/hr/payroll/periods/:id/payslips
router.get('/periods/:id/payslips', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const period = await HRPayrollPeriod.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });

    const payslips = await HRPayslip.find({ payrollPeriod: req.params.id, company: companyId })
      .sort({ 'snapshot.name': 1 })
      .lean();

    res.json({ period, payslips });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/payroll/payslips/:id
router.get('/payslips/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const payslip = await HRPayslip.findOne({ _id: req.params.id, company: companyId })
      .populate('payrollPeriod', 'label month year status')
      .populate('employee', 'surname otherNames employeeNumber email profilePicture')
      .lean();
    if (!payslip) return res.status(404).json({ message: 'Payslip not found' });
    res.json(payslip);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
