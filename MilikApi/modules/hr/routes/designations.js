import express from 'express';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRDesignation from '../models/HRDesignation.js';
import HREmployee from '../models/HREmployee.js';
import { resolveCompanyId, currentUserId, escapeRegex } from '../services/hrScope.js';

const router = express.Router();

// GET /api/hr/designations
router.get('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { department, search, includeInactive } = req.query;
    const query = { company: companyId };
    if (!includeInactive) query.isActive = true;
    if (department) query.department = department;
    if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };

    const designations = await HRDesignation.find(query)
      .populate('department', 'name code')
      .sort({ name: 1 })
      .lean();

    res.json(designations);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/designations
router.post('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name, department, gradeLevel, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Designation name is required' });

    const desig = await HRDesignation.create({
      company: companyId,
      name: name.trim(),
      department: department || null,
      gradeLevel: String(gradeLevel || '').trim(),
      description: String(description || '').trim(),
      createdBy: currentUserId(req),
    });
    res.status(201).json(desig);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PUT /api/hr/designations/:id
router.put('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name, department, gradeLevel, description, isActive } = req.body;

    const desig = await HRDesignation.findOne({ _id: req.params.id, company: companyId });
    if (!desig) return res.status(404).json({ message: 'Designation not found' });

    if (name?.trim()) desig.name = name.trim();
    if (department !== undefined) desig.department = department || null;
    if (gradeLevel !== undefined) desig.gradeLevel = String(gradeLevel || '').trim();
    if (description !== undefined) desig.description = String(description || '').trim();
    if (isActive !== undefined) desig.isActive = Boolean(isActive);
    desig.updatedBy = currentUserId(req);

    await desig.save();
    res.json(desig);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/designations/:id
router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const desig = await HRDesignation.findOne({ _id: req.params.id, company: companyId });
    if (!desig) return res.status(404).json({ message: 'Designation not found' });

    const inUse = await HREmployee.countDocuments({ company: companyId, designation: desig._id, status: { $ne: 'Terminated' } });
    if (inUse > 0) return res.status(400).json({ message: `Cannot delete — ${inUse} employee(s) hold this designation` });

    await desig.deleteOne();
    res.json({ message: 'Designation deleted' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
