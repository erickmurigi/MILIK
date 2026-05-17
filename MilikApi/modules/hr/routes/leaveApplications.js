import express from 'express';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRLeaveApplication from '../models/HRLeaveApplication.js';
import HRLeaveType from '../models/HRLeaveType.js';
import HREmployee from '../models/HREmployee.js';
import { resolveCompanyId, currentUserId, escapeRegex, parsePage, parseLimit } from '../services/hrScope.js';

const router = express.Router();

const POPULATE = [
  { path: 'employee',  select: 'surname otherNames employeeNumber department designation' },
  { path: 'leaveType', select: 'name code isPaid' },
  { path: 'approvedBy', select: 'surname otherNames' },
  { path: 'rejectedBy', select: 'surname otherNames' },
];

// Compute working days between two dates (excl. Sat/Sun)
const workingDays = (start, end) => {
  let count = 0;
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count || 1;
};

// GET /api/hr/leave-applications/stats
router.get('/stats', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    const [statusCounts, pending] = await Promise.all([
      HRLeaveApplication.aggregate([
        { $match: { company: HRLeaveApplication.schema.path('company').cast(companyId), createdAt: { $gte: yearStart } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      HRLeaveApplication.find({ company: companyId, status: 'Pending' })
        .sort({ createdAt: 1 })
        .limit(10)
        .populate(POPULATE)
        .lean(),
    ]);

    const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
    res.json({ byStatus, pending });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/leave-applications
router.get('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { employee, leaveType, status, page, limit } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit);

    const query = { company: companyId };
    if (employee)  query.employee  = employee;
    if (leaveType) query.leaveType = leaveType;
    if (status && status !== 'all') query.status = status;

    const [applications, total] = await Promise.all([
      HRLeaveApplication.find(query)
        .populate(POPULATE)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HRLeaveApplication.countDocuments(query),
    ]);

    res.json({ applications, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/leave-applications/:id
router.get('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const app = await HRLeaveApplication.findOne({ _id: req.params.id, company: companyId })
      .populate(POPULATE).lean();
    if (!app) return res.status(404).json({ message: 'Leave application not found' });
    res.json(app);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/leave-applications
router.post('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { employee, leaveType, startDate, endDate, reason } = req.body;

    if (!employee)  return res.status(400).json({ message: 'Employee is required' });
    if (!leaveType) return res.status(400).json({ message: 'Leave type is required' });
    if (!startDate) return res.status(400).json({ message: 'Start date is required' });
    if (!endDate)   return res.status(400).json({ message: 'End date is required' });

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (end < start) return res.status(400).json({ message: 'End date must be on or after start date' });

    // Check employee exists
    const emp = await HREmployee.findOne({ _id: employee, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    // Check leave type exists and is active
    const lt = await HRLeaveType.findOne({ _id: leaveType, company: companyId, isActive: true });
    if (!lt) return res.status(404).json({ message: 'Leave type not found or inactive' });

    // Check for overlapping approved/pending applications
    const overlap = await HRLeaveApplication.findOne({
      company: companyId,
      employee,
      status: { $in: ['Pending', 'Approved'] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } },
      ],
    });
    if (overlap) return res.status(400).json({ message: 'Employee already has an overlapping leave application for this period' });

    const days = workingDays(start, end);
    const application = new HRLeaveApplication({
      company: companyId,
      employee,
      leaveType,
      startDate: start,
      endDate: end,
      days,
      reason: reason?.trim() || '',
      status: lt.requiresApproval ? 'Pending' : 'Approved',
      createdBy: currentUserId(req),
    });

    await application.save();
    await application.populate(POPULATE);
    res.status(201).json(application);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/leave-applications/:id/approve
router.patch('/:id/approve', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const app = await HRLeaveApplication.findOne({ _id: req.params.id, company: companyId });
    if (!app) return res.status(404).json({ message: 'Application not found' });
    if (app.status !== 'Pending') return res.status(400).json({ message: `Cannot approve a ${app.status} application` });

    app.status        = 'Approved';
    app.approvedAt    = new Date();
    app.approvalNotes = String(req.body.notes || '').trim();
    app.updatedBy     = currentUserId(req);
    await app.save();
    await app.populate(POPULATE);
    res.json({ message: 'Leave approved', application: app });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/leave-applications/:id/reject
router.patch('/:id/reject', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const app = await HRLeaveApplication.findOne({ _id: req.params.id, company: companyId });
    if (!app) return res.status(404).json({ message: 'Application not found' });
    if (app.status !== 'Pending') return res.status(400).json({ message: `Cannot reject a ${app.status} application` });

    app.status          = 'Rejected';
    app.rejectedAt      = new Date();
    app.rejectionReason = String(req.body.reason || '').trim();
    app.updatedBy       = currentUserId(req);
    await app.save();
    await app.populate(POPULATE);
    res.json({ message: 'Leave rejected', application: app });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/leave-applications/:id/cancel
router.patch('/:id/cancel', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const app = await HRLeaveApplication.findOne({ _id: req.params.id, company: companyId });
    if (!app) return res.status(404).json({ message: 'Application not found' });
    if (['Cancelled', 'Rejected'].includes(app.status)) {
      return res.status(400).json({ message: `Application is already ${app.status}` });
    }

    app.status       = 'Cancelled';
    app.cancelledAt  = new Date();
    app.cancelReason = String(req.body.reason || '').trim();
    app.updatedBy    = currentUserId(req);
    await app.save();
    res.json({ message: 'Leave cancelled', application: app });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/leave-applications/:id (draft/pending only)
router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const app = await HRLeaveApplication.findOne({ _id: req.params.id, company: companyId });
    if (!app) return res.status(404).json({ message: 'Application not found' });
    if (app.status === 'Approved') {
      return res.status(400).json({ message: 'Cannot delete an approved application. Cancel it first.' });
    }
    await app.deleteOne();
    res.json({ message: 'Application deleted' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
