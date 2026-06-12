import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import HREmployee from '../models/HREmployee.js';
import HRPayslip from '../models/HRPayslip.js';
import HRPayrollPeriod from '../models/HRPayrollPeriod.js';
import HRLeaveApplication from '../models/HRLeaveApplication.js';
import HRLeaveType from '../models/HRLeaveType.js';
import HRLetter from '../models/HRLetter.js';
import HRAttendance from '../models/HRAttendance.js';
import { parsePage, parseLimit } from '../services/hrScope.js';

const router = express.Router();

const getJWTSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required');
  return s;
};

// ── ESS auth middleware ───────────────────────────────────────────────────────
function verifyESS(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), getJWTSecret(), {
      issuer: 'milik-api',
      audience: 'milik-client',
    });
    if (decoded.role !== 'hrEmployee') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    req.essEmployee = {
      id:        decoded.essEmployeeId,
      companyId: decoded.companyId,
    };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session. Please log in again.' });
  }
}

router.use(verifyESS);

// ── GET /api/hr/ess/me ────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const emp = await HREmployee.findOne({
      _id:     req.essEmployee.id,
      company: req.essEmployee.companyId,
    })
      .populate('department',  'name')
      .populate('designation', 'name')
      .populate('reportsTo',   'surname otherNames employeeNumber')
      .select('-essPassword')
      .lean();

    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    res.json(emp);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/payslips ───────────────────────────────────────────────
router.get('/my/payslips', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const { page, limit } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit);
    const oid = new mongoose.Types.ObjectId(companyId);

    const [payslips, total] = await Promise.all([
      HRPayslip.find({ company: oid, employee: id })
        .populate('payrollPeriod', 'label month year status')
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HRPayslip.countDocuments({ company: oid, employee: id }),
    ]);

    res.json({ payslips, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/payslips/:id ──────────────────────────────────────────
router.get('/my/payslips/:payslipId', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const ps = await HRPayslip.findOne({
      _id:      req.params.payslipId,
      company:  companyId,
      employee: id,
    })
      .populate('payrollPeriod', 'label month year status')
      .lean();

    if (!ps) return res.status(404).json({ message: 'Payslip not found' });
    res.json(ps);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/leave-applications ─────────────────────────────────────
router.get('/my/leave-applications', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const { status, page, limit } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit);

    const query = { company: companyId, employee: id };
    if (status && status !== 'all') query.status = status;

    const [applications, total] = await Promise.all([
      HRLeaveApplication.find(query)
        .populate('leaveType',   'name code isPaid')
        .populate('approvedBy',  'surname otherNames')
        .populate('rejectedBy',  'surname otherNames')
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HRLeaveApplication.countDocuments(query),
    ]);

    res.json({ applications, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/hr/ess/my/leave-applications ────────────────────────────────────
router.post('/my/leave-applications', async (req, res) => {
  try {
    const { id: employee, companyId } = req.essEmployee;
    const { leaveType, startDate, endDate, reason } = req.body;

    if (!leaveType) return res.status(400).json({ message: 'Leave type is required' });
    if (!startDate) return res.status(400).json({ message: 'Start date is required' });
    if (!endDate)   return res.status(400).json({ message: 'End date is required' });

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (end < start) return res.status(400).json({ message: 'End date must be on or after start date' });

    const [emp, lt] = await Promise.all([
      HREmployee.findOne({ _id: employee, company: companyId }).lean(),
      HRLeaveType.findOne({ _id: leaveType, company: companyId, isActive: true }).lean(),
    ]);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    if (!lt)  return res.status(404).json({ message: 'Leave type not found or inactive' });

    const overlap = await HRLeaveApplication.findOne({
      company: companyId, employee,
      status: { $in: ['Pending', 'Approved'] },
      startDate: { $lte: end }, endDate: { $gte: start },
    });
    if (overlap) {
      return res.status(400).json({ message: 'You already have an overlapping leave application for this period' });
    }

    // Compute working days
    let days = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const d = cur.getDay();
      if (d !== 0 && d !== 6) days++;
      cur.setDate(cur.getDate() + 1);
    }
    days = days || 1;

    const application = await HRLeaveApplication.create({
      company: companyId,
      employee,
      leaveType,
      startDate: start,
      endDate:   end,
      days,
      reason:    reason?.trim() || '',
      status:    lt.requiresApproval ? 'Pending' : 'Approved',
      createdBy: null,
    });

    await application.populate('leaveType', 'name code isPaid');
    res.status(201).json(application);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/hr/ess/my/leave-applications/:id/cancel ────────────────────────
router.patch('/my/leave-applications/:leaveId/cancel', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const app = await HRLeaveApplication.findOne({
      _id: req.params.leaveId, company: companyId, employee: id,
    });
    if (!app) return res.status(404).json({ message: 'Application not found' });
    if (['Cancelled', 'Rejected', 'Approved'].includes(app.status)) {
      return res.status(400).json({ message: `Cannot cancel a ${app.status} application` });
    }

    app.status       = 'Cancelled';
    app.cancelledAt  = new Date();
    app.cancelReason = String(req.body.reason || '').trim();
    await app.save();
    res.json({ message: 'Application cancelled', application: app });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/leave-balances ─────────────────────────────────────────
router.get('/my/leave-balances', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const yr = Number(req.query.year) || new Date().getFullYear();
    const oid = new mongoose.Types.ObjectId(companyId);
    const empOid = new mongoose.Types.ObjectId(id);

    const startOfYear = new Date(`${yr}-01-01T00:00:00.000Z`);
    const endOfYear   = new Date(`${yr}-12-31T23:59:59.999Z`);

    const [leaveTypes, usageAgg] = await Promise.all([
      HRLeaveType.find({ company: companyId, isActive: true, daysPerYear: { $gt: 0 } })
        .select('name code isPaid daysPerYear requiresApproval')
        .lean(),
      HRLeaveApplication.aggregate([
        {
          $match: {
            company:   oid,
            employee:  empOid,
            startDate: { $gte: startOfYear, $lte: endOfYear },
            status:    { $in: ['Approved', 'Pending'] },
          },
        },
        { $group: { _id: { leaveType: '$leaveType', status: '$status' }, days: { $sum: '$days' } } },
      ]),
    ]);

    const usageMap = {};
    for (const { _id, days } of usageAgg) {
      const key = _id.leaveType.toString();
      if (!usageMap[key]) usageMap[key] = { used: 0, pending: 0 };
      if (_id.status === 'Approved') usageMap[key].used    += days;
      else                            usageMap[key].pending += days;
    }

    const balances = leaveTypes.map((lt) => {
      const usage = usageMap[lt._id.toString()] || { used: 0, pending: 0 };
      return {
        leaveType:   lt,
        entitlement: lt.daysPerYear,
        used:        usage.used,
        pending:     usage.pending,
        remaining:   Math.max(0, lt.daysPerYear - usage.used),
      };
    });

    res.json({ balances, year: yr });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/letters ────────────────────────────────────────────────
router.get('/my/letters', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const { page, limit } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit);

    const query = { company: companyId, employee: id, status: 'issued' };

    const [letters, total] = await Promise.all([
      HRLetter.find(query)
        .sort({ issuedDate: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HRLetter.countDocuments(query),
    ]);

    res.json({ letters, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/letters/:id ────────────────────────────────────────────
router.get('/my/letters/:letterId', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const letter = await HRLetter.findOne({
      _id: req.params.letterId, company: companyId, employee: id, status: 'issued',
    }).lean();
    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    res.json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/attendance ─────────────────────────────────────────────
router.get('/my/attendance', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const { month, year, page, limit } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit, 31);

    const query = { company: companyId, employee: id };
    if (month && year) {
      const y = Number(year);
      const m = Number(month) - 1;
      const from = new Date(y, m, 1);
      const to   = new Date(y, m + 1, 0, 23, 59, 59);
      query.checkIn = { $gte: from, $lte: to };
    }

    const [records, total] = await Promise.all([
      HRAttendance.find(query)
        .sort({ checkIn: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HRAttendance.countDocuments(query),
    ]);

    res.json({ records, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/hr/ess/my/attendance/check-in ───────────────────────────────────
router.post('/my/attendance/check-in', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const now  = new Date();
    const date = now.toISOString().slice(0, 10);

    // Prevent duplicate check-in on the same calendar day if still open
    const open = await HRAttendance.findOne({
      company: companyId, employee: id, date, checkOut: null,
    });
    if (open) {
      return res.status(400).json({ message: 'You already have an open check-in for today. Please check out first.' });
    }

    const record = await HRAttendance.create({
      company:  companyId,
      employee: id,
      date,
      checkIn:  now,
      note:     String(req.body.note || '').trim(),
      source:   'ess',
    });

    res.status(201).json(record);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── PATCH /api/hr/ess/my/attendance/:id/check-out ─────────────────────────────
router.patch('/my/attendance/:attendanceId/check-out', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const record = await HRAttendance.findOne({
      _id: req.params.attendanceId, company: companyId, employee: id,
    });
    if (!record) return res.status(404).json({ message: 'Attendance record not found' });
    if (record.checkOut) return res.status(400).json({ message: 'Already checked out' });

    const now = new Date();
    record.checkOut = now;
    record.duration = Math.round((now - record.checkIn) / 60000); // minutes
    if (req.body.note) record.note = String(req.body.note).trim();
    await record.save();

    res.json(record);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/attendance/today ───────────────────────────────────────
router.get('/my/attendance/today', async (req, res) => {
  try {
    const { id, companyId } = req.essEmployee;
    const date = new Date().toISOString().slice(0, 10);
    const record = await HRAttendance.findOne({
      company: companyId, employee: id, date,
    }).lean();
    res.json({ record: record || null });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/hr/ess/my/leave-types ────────────────────────────────────────────
router.get('/my/leave-types', async (req, res) => {
  try {
    const { companyId } = req.essEmployee;
    const types = await HRLeaveType.find({ company: companyId, isActive: true })
      .select('name code isPaid requiresApproval maxDaysPerYear')
      .lean();
    res.json({ types });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
