import express from 'express';
import { verifyUser, requireCompanyModule } from '../../../controllers/verifyToken.js';
import HRDepartment from '../models/HRDepartment.js';
import HREmployee from '../models/HREmployee.js';
import { resolveCompanyId, currentUserId, escapeRegex } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('hr'));

// GET /api/hr/departments
router.get('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { search, includeInactive } = req.query;
    const query = { company: companyId };
    if (!includeInactive) query.isActive = true;
    if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };

    const departments = await HRDepartment.find(query)
      .populate('manager', 'surname otherNames employeeNumber')
      .sort({ name: 1 })
      .lean();

    // Attach headcount per department
    const ids = departments.map((d) => d._id);
    const counts = await HREmployee.aggregate([
      { $match: { company: departments[0]?.company, department: { $in: ids }, status: { $ne: 'Terminated' } } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));

    res.json(departments.map((d) => ({ ...d, headcount: countMap[String(d._id)] || 0 })));
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/departments/:id
router.get('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const dept = await HRDepartment.findOne({ _id: req.params.id, company: companyId })
      .populate('manager', 'surname otherNames employeeNumber')
      .lean();
    if (!dept) return res.status(404).json({ message: 'Department not found' });
    res.json(dept);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/departments
router.post('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name, code, description, manager } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Department name is required' });

    const existing = await HRDepartment.findOne({ company: companyId, name: name.trim() }).lean();
    if (existing) return res.status(400).json({ message: 'A department with this name already exists' });

    const dept = await HRDepartment.create({
      company: companyId,
      name: name.trim(),
      code: String(code || '').trim().toUpperCase(),
      description: String(description || '').trim(),
      manager: manager || null,
      createdBy: currentUserId(req),
    });
    res.status(201).json(dept);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PUT /api/hr/departments/:id
router.put('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name, code, description, manager, isActive } = req.body;

    const dept = await HRDepartment.findOne({ _id: req.params.id, company: companyId });
    if (!dept) return res.status(404).json({ message: 'Department not found' });

    if (name?.trim() && name.trim() !== dept.name) {
      const dup = await HRDepartment.findOne({ company: companyId, name: name.trim(), _id: { $ne: dept._id } }).lean();
      if (dup) return res.status(400).json({ message: 'A department with this name already exists' });
      dept.name = name.trim();
    }
    if (code !== undefined) dept.code = String(code || '').trim().toUpperCase();
    if (description !== undefined) dept.description = String(description || '').trim();
    if (manager !== undefined) dept.manager = manager || null;
    if (isActive !== undefined) dept.isActive = Boolean(isActive);
    dept.updatedBy = currentUserId(req);

    await dept.save();
    res.json(dept);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/departments/:id
router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const dept = await HRDepartment.findOne({ _id: req.params.id, company: companyId });
    if (!dept) return res.status(404).json({ message: 'Department not found' });

    const headcount = await HREmployee.countDocuments({ company: companyId, department: dept._id, status: { $ne: 'Terminated' } });
    if (headcount > 0) return res.status(400).json({ message: `Cannot delete — ${headcount} active employee(s) are assigned to this department` });

    await dept.deleteOne();
    res.json({ message: 'Department deleted' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
