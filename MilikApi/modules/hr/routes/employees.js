import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HREmployee from '../models/HREmployee.js';
import HRDepartment from '../models/HRDepartment.js';
import HRLeaveApplication from '../models/HRLeaveApplication.js';
import HRPayrollPeriod from '../models/HRPayrollPeriod.js';
import HRPayslip from '../models/HRPayslip.js';
import { resolveCompanyId, currentUserId, parsePage, parseLimit } from '../services/hrScope.js';
import Company from '../../../models/Company.js';
import { buildSmtpTransporter, hasSmtpConfig, resolveMailSender } from '../../../utils/smtpMailer.js';
import { buildESSInviteEmail } from '../utils/hrEmailTemplates.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function uploadToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    }).end(buffer);
  });
}

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|gif|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
}).single('photo');

const router = express.Router();

const POPULATE_OPTS = [
  { path: 'department', select: 'name code' },
  { path: 'designation', select: 'name gradeLevel' },
  { path: 'reportsTo', select: 'surname otherNames employeeNumber' },
];

// GET /api/hr/employees/stats  — dashboard summary
router.get('/stats', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const in30Days = new Date(now.getTime() + 30 * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      statusCounts, typeCounts, deptCounts, recentJoiners, terminatedYTD,
      genderCounts, probationEndingSoon,
      pendingLeave, onLeaveToday,
      latestPeriod,
    ] = await Promise.all([
      HREmployee.aggregate([
        { $match: { company: oid } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      HREmployee.aggregate([
        { $match: { company: oid, status: { $ne: 'Terminated' } } },
        { $group: { _id: '$employmentType', count: { $sum: 1 } } },
      ]),
      HREmployee.aggregate([
        { $match: { company: oid, status: { $ne: 'Terminated' } } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $lookup: { from: 'hrdepartments', localField: '_id', foreignField: '_id', as: 'dept' } },
        { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
        { $project: { name: { $ifNull: ['$dept.name', 'Unassigned'] }, count: 1 } },
        { $sort: { count: -1 } },
      ]),
      HREmployee.find({ company: companyId, status: { $ne: 'Terminated' } })
        .sort({ dateJoined: -1 })
        .limit(5)
        .populate('department', 'name')
        .populate('designation', 'name')
        .select('surname otherNames employeeNumber dateJoined department designation gender')
        .lean(),
      HREmployee.countDocuments({ company: companyId, status: 'Terminated', terminationDate: { $gte: yearStart } }),
      // gender breakdown
      HREmployee.aggregate([
        { $match: { company: oid, status: { $ne: 'Terminated' } } },
        { $group: { _id: '$gender', count: { $sum: 1 } } },
      ]),
      // probation ending within 30 days
      HREmployee.find({
        company: companyId, status: 'Probation',
        probationEndDate: { $gte: now, $lte: in30Days },
      }).select('surname otherNames probationEndDate department').populate('department', 'name').lean(),
      // pending leave approvals
      HRLeaveApplication.countDocuments({ company: companyId, status: 'Pending' }),
      // on leave today
      HRLeaveApplication.countDocuments({
        company: companyId, status: 'Approved',
        startDate: { $lte: now }, endDate: { $gte: now },
      }),
      // latest payroll period with summary
      HRPayrollPeriod.findOne({ company: companyId }).sort({ year: -1, month: -1 }).lean(),
    ]);

    const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
    const byType   = Object.fromEntries(typeCounts.map((t)   => [t._id, t.count]));
    const byGender = Object.fromEntries(genderCounts.map((g) => [g._id || 'Unknown', g.count]));

    // payroll summary for latest period — totals are stored on the period document
    let payrollSummary = null;
    if (latestPeriod) {
      payrollSummary = {
        periodName: latestPeriod.label,
        status:     latestPeriod.status,
        grossTotal: latestPeriod.totalGross        || 0,
        netTotal:   latestPeriod.totalNet          || 0,
        count:      latestPeriod.employeeCount     || 0,
      };
    }

    res.json({
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      active: byStatus.Active || 0,
      probation: byStatus.Probation || 0,
      suspended: byStatus.Suspended || 0,
      terminated: byStatus.Terminated || 0,
      terminatedYTD,
      byType,
      byGender,
      byDepartment: deptCounts,
      recentJoiners,
      probationEndingSoon,
      pendingLeave,
      onLeaveToday,
      payrollSummary,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/employees/directory  — unpaginated, for printing
router.get('/directory', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { search, department, status, employmentType } = req.query;

    const query = { company: companyId };
    if (status && status !== 'all') query.status = status;
    if (department && department !== 'all') query.department = department;
    if (employmentType && employmentType !== 'all') query.employmentType = employmentType;
    if (search) query.$text = { $search: search };

    const employees = await HREmployee.find(query)
      .populate([
        { path: 'department',  select: 'name' },
        { path: 'designation', select: 'name' },
      ])
      .select('surname otherNames employeeNumber department designation employmentType status dateJoined gender phoneNumber email')
      .sort({ department: 1, surname: 1, otherNames: 1 })
      .limit(1000)
      .lean();

    res.json({ employees, total: employees.length });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/employees
router.get('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { search, department, status, employmentType, page, limit } = req.query;
    const safePage = parsePage(page);
    const safeLimit = parseLimit(limit);

    const query = { company: companyId };
    if (status && status !== 'all') query.status = status;
    if (department && department !== 'all') query.department = department;
    if (employmentType && employmentType !== 'all') query.employmentType = employmentType;
    if (search) {
      query.$text = { $search: search };
    }

    const [employees, total] = await Promise.all([
      HREmployee.find(query)
        .populate(POPULATE_OPTS)
        .sort({ surname: 1, otherNames: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HREmployee.countDocuments(query),
    ]);

    res.json({ employees, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/employees/:id
router.get('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId })
      .populate(POPULATE_OPTS)
      .lean();
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    res.json(emp);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/employees
router.post('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { surname, otherNames, phoneNumber, employmentType, dateJoined } = req.body;

    if (!surname?.trim()) return res.status(400).json({ message: 'Surname is required' });
    if (!otherNames?.trim()) return res.status(400).json({ message: 'Other names are required' });
    if (!phoneNumber?.trim()) return res.status(400).json({ message: 'Phone number is required' });
    if (!employmentType) return res.status(400).json({ message: 'Employment type is required' });
    if (!dateJoined) return res.status(400).json({ message: 'Date joined is required' });

    const payload = { ...req.body, company: companyId, createdBy: currentUserId(req) };
    delete payload._id;

    const emp = new HREmployee(payload);
    await emp.save();
    await emp.populate(POPULATE_OPTS);

    res.status(201).json(emp);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'An employee with this number already exists' });
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PUT /api/hr/employees/:id
router.put('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const forbidden = ['company', 'employeeNumber', 'createdBy', '_id'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => !forbidden.includes(k))
    );
    Object.assign(emp, updates);
    emp.updatedBy = currentUserId(req);

    await emp.save();
    await emp.populate(POPULATE_OPTS);
    res.json(emp);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/employees/:id/terminate
router.patch('/:id/terminate', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    if (emp.status === 'Terminated') return res.status(400).json({ message: 'Employee is already terminated' });

    emp.status = 'Terminated';
    emp.terminationDate = req.body.terminationDate ? new Date(req.body.terminationDate) : new Date();
    emp.terminationReason = String(req.body.terminationReason || '').trim();
    emp.updatedBy = currentUserId(req);
    await emp.save();
    res.json({ message: 'Employee terminated', employee: emp });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/employees/:id/reinstate
router.patch('/:id/reinstate', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    emp.status = 'Active';
    emp.terminationDate = null;
    emp.terminationReason = '';
    emp.updatedBy = currentUserId(req);
    await emp.save();
    res.json({ message: 'Employee reinstated', employee: emp });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/employees/:id
router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    await emp.deleteOne();
    res.json({ message: 'Employee record deleted' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/employees/:id/photo
router.post('/:id/photo', verifyUser, (req, res) => {
  photoUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    try {
      const companyId = resolveCompanyId(req);
      const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
      if (!emp) return res.status(404).json({ message: 'Employee not found' });

      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'hr/employees',
        public_id: req.params.id,
        overwrite: true,
        resource_type: 'image',
      });

      emp.profilePicture = result.secure_url;
      emp.updatedBy = currentUserId(req);
      await emp.save();

      res.json({ profilePicture: emp.profilePicture });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
});

// shared helper — resolve portal URL from request origin or env
function resolvePortalUrl(req) {
  const env = process.env.FRONTEND_URL || process.env.ESS_PORTAL_URL || '';
  if (env) return `${env.replace(/\/$/, '')}/ess/login`;
  const origin = req.headers.origin || req.headers.referer || '';
  if (origin) {
    try { return `${new URL(origin).origin}/ess/login`; } catch {}
  }
  return '';
}

// PATCH /api/hr/employees/:id/ess-access  — enable/disable ESS + set password
router.patch('/:id/ess-access', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const { enabled, password, sendInvite } = req.body;
    if (typeof enabled === 'boolean') emp.essEnabled = enabled;

    let plainPassword = null;
    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }
      plainPassword = String(password);
      emp.essPassword = await bcrypt.hash(plainPassword, 10);
    }

    emp.updatedBy = currentUserId(req);
    await emp.save();

    // Auto-send invite email if requested and employee has an email address
    let emailSent = false;
    let emailError = null;
    if (sendInvite && plainPassword && emp.email && emp.essEnabled && hasSmtpConfig()) {
      try {
        const company = await Company.findById(companyId).lean();
        const { subject, html, text } = buildESSInviteEmail({
          employee: emp,
          company:  company || {},
          password: plainPassword,
          portalUrl: resolvePortalUrl(req),
        });
        await buildSmtpTransporter().sendMail({
          from: resolveMailSender('SMTP_FROM_EMAIL'),
          to:   emp.email,
          subject, html, text,
        });
        emailSent = true;
      } catch (e) {
        emailError = e.message;
      }
    }

    res.json({
      message:     'ESS access updated',
      essEnabled:  emp.essEnabled,
      hasPassword: !!emp.essPassword,
      emailSent,
      emailError,
      noEmail: sendInvite && !emp.email ? true : undefined,
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/employees/:id/ess-invite  — (re)send invite email
router.post('/:id/ess-invite', verifyUser, async (req, res) => {
  try {
    if (!hasSmtpConfig()) {
      return res.status(503).json({ message: 'Email service is not configured on this server' });
    }
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!emp)           return res.status(404).json({ message: 'Employee not found' });
    if (!emp.essEnabled) return res.status(400).json({ message: 'ESS access is not enabled for this employee' });

    const toEmail = req.body?.email?.trim() || emp.email;
    if (!toEmail) {
      return res.status(400).json({
        message: 'This employee has no email address on file. Please provide one or update their profile.',
        noEmail: true,
      });
    }

    const { password: plainPassword } = req.body || {};
    if (!plainPassword) {
      return res.status(400).json({ message: 'A temporary password is required to send the invite' });
    }
    if (String(plainPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Hash password but don't write it yet — send email first
    const hashed = await bcrypt.hash(String(plainPassword), 10);
    const company = await Company.findById(companyId).lean();
    const { subject, html, text } = buildESSInviteEmail({
      employee: emp,
      company:  company || {},
      password: plainPassword,
      portalUrl: resolvePortalUrl(req),
    });

    try {
      await buildSmtpTransporter().sendMail({
        from: resolveMailSender('SMTP_FROM_EMAIL'),
        to:   toEmail,
        subject, html, text,
      });
    } catch (e) {
      return res.json({ success: false, emailError: e.message });
    }

    // Email succeeded — now persist the new password hash
    await HREmployee.updateOne({ _id: emp._id }, { essPassword: hashed, updatedBy: currentUserId(req) });

    res.json({ sent: true, to: toEmail, subject });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/employees/:id/photo
router.delete('/:id/photo', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    if (emp.profilePicture) {
      await cloudinary.uploader.destroy(`hr/employees/${req.params.id}`).catch(() => {});
      emp.profilePicture = '';
      emp.updatedBy = currentUserId(req);
      await emp.save();
    }

    res.json({ message: 'Photo removed' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
