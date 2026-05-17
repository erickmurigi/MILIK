import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import mongoose from 'mongoose';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HREmployee from '../models/HREmployee.js';
import HRDepartment from '../models/HRDepartment.js';
import { resolveCompanyId, currentUserId, escapeRegex, parsePage, parseLimit } from '../services/hrScope.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PHOTOS_DIR = path.join(__dirname, '../../../uploads/hr/photos');
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PHOTOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${req.params.id}${ext}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
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
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    const [statusCounts, typeCounts, deptCounts, recentJoiners, terminatedYTD] = await Promise.all([
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
        .select('surname otherNames employeeNumber dateJoined department designation')
        .lean(),
      HREmployee.countDocuments({ company: companyId, status: 'Terminated', terminationDate: { $gte: yearStart } }),
    ]);

    const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
    const byType = Object.fromEntries(typeCounts.map((t) => [t._id, t.count]));

    res.json({
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      active: byStatus.Active || 0,
      probation: byStatus.Probation || 0,
      suspended: byStatus.Suspended || 0,
      terminated: byStatus.Terminated || 0,
      terminatedYTD,
      byType,
      byDepartment: deptCounts,
      recentJoiners,
    });
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
      const rx = { $regex: escapeRegex(search), $options: 'i' };
      query.$or = [
        { surname: rx }, { otherNames: rx },
        { email: rx }, { phoneNumber: rx },
        { employeeNumber: rx }, { nationalId: rx },
      ];
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

      // Remove old photo if it has a different filename (different extension)
      if (emp.profilePicture) {
        const oldFilePath = path.join(PHOTOS_DIR, path.basename(emp.profilePicture));
        if (oldFilePath !== req.file.path && fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      emp.profilePicture = `/uploads/hr/photos/${req.file.filename}`;
      emp.updatedBy = currentUserId(req);
      await emp.save();

      res.json({ profilePicture: emp.profilePicture });
    } catch (e) {
      res.status(500).json({ message: e.message });
    }
  });
});

// DELETE /api/hr/employees/:id/photo
router.delete('/:id/photo', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const emp = await HREmployee.findOne({ _id: req.params.id, company: companyId });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    if (emp.profilePicture) {
      const filePath = path.join(PHOTOS_DIR, path.basename(emp.profilePicture));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
