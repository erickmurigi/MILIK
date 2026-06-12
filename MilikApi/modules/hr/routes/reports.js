import express from 'express';
import mongoose from 'mongoose';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HREmployee from '../models/HREmployee.js';
import HRPayrollPeriod from '../models/HRPayrollPeriod.js';
import HRPayslip from '../models/HRPayslip.js';
import HRLeaveApplication from '../models/HRLeaveApplication.js';
import { resolveCompanyId } from '../services/hrScope.js';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const router = express.Router();
router.use(verifyUser);

// ── Headcount Report ─────────────────────────────────────────────────────────
router.get('/headcount', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);

    const [summary, byDept, byType, recentJoiners] = await Promise.all([
      HREmployee.aggregate([
        { $match: { company: oid } },
        { $group: {
          _id: null,
          total:      { $sum: 1 },
          active:     { $sum: { $cond: [{ $eq: ['$status', 'Active']     }, 1, 0] } },
          probation:  { $sum: { $cond: [{ $eq: ['$status', 'Probation']  }, 1, 0] } },
          suspended:  { $sum: { $cond: [{ $eq: ['$status', 'Suspended']  }, 1, 0] } },
          terminated: { $sum: { $cond: [{ $eq: ['$status', 'Terminated'] }, 1, 0] } },
        }},
      ]),
      HREmployee.aggregate([
        { $match: { company: oid } },
        { $lookup: { from: 'hrdepartments', localField: 'department', foreignField: '_id', as: 'dept' } },
        { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: { deptId: { $ifNull: ['$dept._id', null] }, name: { $ifNull: ['$dept.name', 'No Department'] } },
          total:      { $sum: 1 },
          active:     { $sum: { $cond: [{ $eq: ['$status', 'Active']     }, 1, 0] } },
          probation:  { $sum: { $cond: [{ $eq: ['$status', 'Probation']  }, 1, 0] } },
          suspended:  { $sum: { $cond: [{ $eq: ['$status', 'Suspended']  }, 1, 0] } },
          terminated: { $sum: { $cond: [{ $eq: ['$status', 'Terminated'] }, 1, 0] } },
        }},
        { $sort: { total: -1 } },
      ]),
      HREmployee.aggregate([
        { $match: { company: oid } },
        { $group: {
          _id: '$employmentType',
          total:  { $sum: 1 },
          active: { $sum: { $cond: [{ $ne: ['$status', 'Terminated'] }, 1, 0] } },
        }},
        { $sort: { total: -1 } },
      ]),
      HREmployee.find({ company: oid, dateJoined: { $gte: new Date(Date.now() - 90 * 86400000) } })
        .sort({ dateJoined: -1 })
        .limit(20)
        .populate('department', 'name')
        .populate('designation', 'name')
        .lean(),
    ]);

    const s = summary[0] || { total: 0, active: 0, probation: 0, suspended: 0, terminated: 0 };
    delete s._id;

    res.json({
      summary: s,
      byDepartment: byDept.map((d) => ({ name: d._id.name, total: d.total, active: d.active, probation: d.probation, suspended: d.suspended, terminated: d.terminated })),
      byType: byType.map((t) => ({ type: t._id, total: t.total, active: t.active })),
      recentJoiners,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Payroll Summary ──────────────────────────────────────────────────────────
router.get('/payroll-summary', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const periods = await HRPayrollPeriod.find({ company: oid, year, status: { $ne: 'Draft' } })
      .sort({ month: 1 })
      .lean();

    const totals = periods.reduce((acc, p) => ({
      gross:      acc.gross      + (p.totalGross || 0),
      deductions: acc.deductions + (p.totalDeductions || 0),
      net:        acc.net        + (p.totalNet || 0),
      paye:       acc.paye       + (p.totalPAYE || 0),
      nhif:       acc.nhif       + (p.totalNHIF || 0),
      nssf:       acc.nssf       + (p.totalNSSF || 0),
      ahl:        acc.ahl        + (p.totalAHL || 0),
    }), { gross: 0, deductions: 0, net: 0, paye: 0, nhif: 0, nssf: 0, ahl: 0 });

    res.json({
      year,
      months: periods.map((p) => ({
        month: p.month,
        label: MONTHS[p.month] || `Month ${p.month}`,
        status: p.status,
        employeeCount: p.employeeCount || 0,
        totalGross: p.totalGross || 0,
        totalDeductions: p.totalDeductions || 0,
        totalNet: p.totalNet || 0,
        totalPAYE: p.totalPAYE || 0,
        totalNHIF: p.totalNHIF || 0,
        totalNSSF: p.totalNSSF || 0,
        totalAHL: p.totalAHL || 0,
      })),
      totals,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Leave Summary ────────────────────────────────────────────────────────────
router.get('/leave-summary', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { startDate, endDate, leaveTypeId } = req.query;

    const match = { company: oid, status: 'Approved' };
    if (startDate || endDate) {
      match.startDate = {};
      if (startDate) match.startDate.$gte = new Date(startDate);
      if (endDate)   match.startDate.$lte = new Date(endDate);
    }
    if (leaveTypeId) match.leaveType = new mongoose.Types.ObjectId(leaveTypeId);

    const [byEmployee, byType, totalsArr] = await Promise.all([
      HRLeaveApplication.aggregate([
        { $match: match },
        { $group: { _id: '$employee', totalDays: { $sum: '$days' }, count: { $sum: 1 } } },
        { $lookup: { from: 'hremployees', localField: '_id', foreignField: '_id', as: 'emp' } },
        { $unwind: '$emp' },
        { $lookup: { from: 'hrdepartments', localField: 'emp.department', foreignField: '_id', as: 'dept' } },
        { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
        { $sort: { totalDays: -1 } },
        { $limit: 100 },
        { $project: {
          employeeNumber: '$emp.employeeNumber',
          name: { $concat: ['$emp.surname', ' ', '$emp.otherNames'] },
          department: { $ifNull: ['$dept.name', '—'] },
          totalDays: 1,
          count: 1,
        }},
      ]),
      HRLeaveApplication.aggregate([
        { $match: match },
        { $group: { _id: '$leaveType', totalDays: { $sum: '$days' }, count: { $sum: 1 } } },
        { $lookup: { from: 'hrleavetypes', localField: '_id', foreignField: '_id', as: 'lt' } },
        { $unwind: '$lt' },
        { $sort: { totalDays: -1 } },
        { $project: { name: '$lt.name', isPaid: '$lt.isPaid', code: '$lt.code', totalDays: 1, count: 1 } },
      ]),
      HRLeaveApplication.aggregate([
        { $match: match },
        { $group: { _id: null, totalDays: { $sum: '$days' }, count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      byEmployee,
      byType,
      totals: totalsArr[0] ? { totalDays: totalsArr[0].totalDays, count: totalsArr[0].count } : { totalDays: 0, count: 0 },
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── P9 Form (Annual Tax Summary) ─────────────────────────────────────────────
router.get('/p9', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { employeeId, year } = req.query;

    if (!employeeId || !year) {
      return res.status(400).json({ message: 'employeeId and year are required' });
    }

    const yr = parseInt(year);

    // Fetch only period IDs for this year up front, then join payslips at DB level
    const [employee, periodIds] = await Promise.all([
      HREmployee.findOne({ _id: employeeId, company: oid })
        .populate('department', 'name')
        .populate('designation', 'name')
        .lean(),
      HRPayrollPeriod.find({ company: oid, year: yr }).select('_id month label status').lean(),
    ]);

    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const pidSet = new Map(periodIds.map((p) => [p._id.toString(), p]));
    const payslips = await HRPayslip.find({
      employee: employeeId,
      company: oid,
      payrollPeriod: { $in: periodIds.map((p) => p._id) },
    }).lean();

    const filtered = payslips
      .map((ps) => ({ ...ps, payrollPeriod: pidSet.get(ps.payrollPeriod?.toString()) }))
      .filter((ps) => ps.payrollPeriod)
      .sort((a, b) => a.payrollPeriod.month - b.payrollPeriod.month);

    const months = filtered.map((ps) => ({
      month: ps.payrollPeriod.month,
      label: MONTHS[ps.payrollPeriod.month] || '',
      status: ps.payrollPeriod.status,
      grossSalary: ps.grossSalary || 0,
      paye: ps.paye || 0,
      nhif: ps.nhif || 0,
      nssf: ps.nssf || 0,
      ahl: ps.ahl || 0,
      netSalary: ps.netSalary || 0,
      personalRelief: 2400,
    }));

    const totals = months.reduce((acc, m) => ({
      grossSalary: acc.grossSalary + m.grossSalary,
      paye:        acc.paye        + m.paye,
      nhif:        acc.nhif        + m.nhif,
      nssf:        acc.nssf        + m.nssf,
      ahl:         acc.ahl         + m.ahl,
      netSalary:   acc.netSalary   + m.netSalary,
      personalRelief: acc.personalRelief + m.personalRelief,
    }), { grossSalary: 0, paye: 0, nhif: 0, nssf: 0, ahl: 0, netSalary: 0, personalRelief: 0 });

    res.json({ employee, year: yr, months, totals });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Employee list (for P9 selector) ─────────────────────────────────────────
router.get('/employees-list', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const employees = await HREmployee.find({ company: oid })
      .sort({ surname: 1, otherNames: 1 })
      .select('surname otherNames employeeNumber kraPin')
      .lean();
    res.json(employees);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Payroll Register ─────────────────────────────────────────────────────────
router.get('/payroll-register', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ message: 'periodId is required' });

    const [period, payslips] = await Promise.all([
      HRPayrollPeriod.findOne({ _id: periodId, company: oid }).lean(),
      HRPayslip.find({ payrollPeriod: periodId, company: oid })
        .sort({ 'snapshot.employeeNumber': 1 })
        .lean(),
    ]);
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });

    const rows = payslips.map((ps) => {
      const s = ps.snapshot || {};
      const allowancesTotal = (ps.allowances || []).reduce((sum, a) => sum + (a.amount || 0), 0);
      const otherDeductionsTotal = (ps.otherDeductions || []).reduce((sum, d) => sum + (d.amount || 0), 0);
      return {
        employeeId: ps.employee,
        employeeNumber: s.employeeNumber || '',
        name: s.name || '',
        department: s.department || '—',
        designation: s.designation || '—',
        kraPin: s.kraPin || '',
        nhifNo: s.nhifNo || '',
        nssfNo: s.nssfNo || '',
        basicSalary: ps.basicSalary || 0,
        allowances: ps.allowances || [],
        allowancesTotal,
        grossSalary: ps.grossSalary || 0,
        paye: ps.paye || 0,
        nhif: ps.nhif || 0,
        nssf: ps.nssf || 0,
        ahl: ps.ahl || 0,
        otherDeductions: ps.otherDeductions || [],
        otherDeductionsTotal,
        totalDeductions: ps.totalDeductions || 0,
        netSalary: ps.netSalary || 0,
        paymentMethod: s.paymentMethod || '',
        bankName: s.bankName || '',
        bankAccountNumber: s.bankAccountNumber || '',
        bankBranch: s.bankBranch || '',
        mpesaNumber: s.mpesaNumber || '',
        status: ps.status || '',
      };
    });

    const totals = rows.reduce((acc, r) => ({
      basicSalary:    acc.basicSalary    + r.basicSalary,
      allowancesTotal: acc.allowancesTotal + r.allowancesTotal,
      grossSalary:    acc.grossSalary    + r.grossSalary,
      paye:           acc.paye           + r.paye,
      nhif:           acc.nhif           + r.nhif,
      nssf:           acc.nssf           + r.nssf,
      ahl:            acc.ahl            + r.ahl,
      otherDeductionsTotal: acc.otherDeductionsTotal + r.otherDeductionsTotal,
      totalDeductions: acc.totalDeductions + r.totalDeductions,
      netSalary:      acc.netSalary      + r.netSalary,
    }), { basicSalary: 0, allowancesTotal: 0, grossSalary: 0, paye: 0, nhif: 0, nssf: 0, ahl: 0, otherDeductionsTotal: 0, totalDeductions: 0, netSalary: 0 });

    res.json({
      period: { ...period, label: period.label || `${MONTHS[period.month] || ''} ${period.year}` },
      rows,
      totals,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Statutory Remittance (PAYE / NHIF / NSSF / AHL / Bank) ──────────────────
const remittanceHandler = (type) => async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { periodId } = req.query;
    if (!periodId) return res.status(400).json({ message: 'periodId is required' });

    const [period, payslips] = await Promise.all([
      HRPayrollPeriod.findOne({ _id: periodId, company: oid }).lean(),
      HRPayslip.find({ payrollPeriod: periodId, company: oid })
        .sort({ 'snapshot.employeeNumber': 1 })
        .lean(),
    ]);
    if (!period) return res.status(404).json({ message: 'Payroll period not found' });

    const label = period.label || `${MONTHS[period.month] || ''} ${period.year}`;
    const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);

    let rows = [];
    let totals = {};

    if (type === 'paye') {
      rows = payslips.map(({ snapshot: s = {}, grossSalary = 0, paye = 0 }) => ({
        employeeNumber: s.employeeNumber || '',
        name:           s.name           || '',
        kraPin:         s.kraPin         || '',
        grossSalary,
        paye,
      }));
      totals = { grossSalary: sum(rows, 'grossSalary'), paye: sum(rows, 'paye') };

    } else if (type === 'nhif') {
      rows = payslips.map(({ snapshot: s = {}, grossSalary = 0, nhif = 0 }) => ({
        employeeNumber:       s.employeeNumber || '',
        name:                 s.name           || '',
        nhifNo:               s.nhifNo         || '',
        grossSalary,
        employeeContribution: nhif,
      }));
      totals = { grossSalary: sum(rows, 'grossSalary'), employeeContribution: sum(rows, 'employeeContribution') };

    } else if (type === 'nssf') {
      rows = payslips.map(({ snapshot: s = {}, grossSalary = 0, nssf = 0 }) => ({
        employeeNumber:       s.employeeNumber || '',
        name:                 s.name           || '',
        nssfNo:               s.nssfNo         || '',
        grossSalary,
        employeeContribution: nssf,
        employerContribution: nssf,
        totalContribution:    nssf * 2,
      }));
      totals = {
        grossSalary:          sum(rows, 'grossSalary'),
        employeeContribution: sum(rows, 'employeeContribution'),
        employerContribution: sum(rows, 'employerContribution'),
        totalContribution:    sum(rows, 'totalContribution'),
      };

    } else if (type === 'ahl') {
      rows = payslips.map(({ snapshot: s = {}, grossSalary = 0, ahl = 0 }) => ({
        employeeNumber: s.employeeNumber || '',
        name:           s.name           || '',
        kraPin:         s.kraPin         || '',
        grossSalary,
        employeeLevy:   ahl,
        employerLevy:   ahl,
        totalLevy:      ahl * 2,
      }));
      totals = {
        grossSalary:  sum(rows, 'grossSalary'),
        employeeLevy: sum(rows, 'employeeLevy'),
        employerLevy: sum(rows, 'employerLevy'),
        totalLevy:    sum(rows, 'totalLevy'),
      };

    } else if (type === 'bank') {
      rows = payslips
        .filter((ps) => (ps.snapshot?.paymentMethod || '') !== 'Cash')
        .map((ps) => {
          const s = ps.snapshot || {};
          return {
            employeeNumber: s.employeeNumber || '',
            name: s.name || '',
            paymentMethod: s.paymentMethod || '',
            bankName: s.bankName || '',
            bankAccountNumber: s.bankAccountNumber || '',
            bankBranch: s.bankBranch || '',
            mpesaNumber: s.mpesaNumber || '',
            netSalary: ps.netSalary || 0,
          };
        });
      totals = { netSalary: rows.reduce((a, r) => a + r.netSalary, 0) };
    }

    res.json({ period: { ...period, label }, rows, totals });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

router.get('/remittance/paye', remittanceHandler('paye'));
router.get('/remittance/nhif', remittanceHandler('nhif'));
router.get('/remittance/nssf', remittanceHandler('nssf'));
router.get('/remittance/ahl',  remittanceHandler('ahl'));
router.get('/remittance/bank', remittanceHandler('bank'));

// ── Periods list (for report selectors) ─────────────────────────────────────
router.get('/periods', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const periods = await HRPayrollPeriod.find({ company: oid })
      .sort({ year: -1, month: -1 })
      .select('month year label status employeeCount totalBasic totalGross totalPAYE totalNHIF totalNSSF totalAHL totalOtherDeductions totalDeductions totalNet')
      .lean();
    res.json(periods.map((p) => ({
      ...p,
      label: p.label || `${MONTHS[p.month] || ''} ${p.year}`,
    })));
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
