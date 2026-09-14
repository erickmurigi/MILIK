import express from 'express';
import { verifyUser, requireCompanyModule } from '../../../controllers/verifyToken.js';
import HRLeaveType from '../models/HRLeaveType.js';
import { resolveCompanyId, currentUserId, escapeRegex } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('hr'));

// GET /api/hr/leave-types
router.get('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { search, includeInactive } = req.query;

    const query = { company: companyId };
    if (!includeInactive) query.isActive = true;
    if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };

    const types = await HRLeaveType.find(query).sort({ name: 1 }).lean();
    res.json(types);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /api/hr/leave-types/:id
router.get('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const lt = await HRLeaveType.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!lt) return res.status(404).json({ message: 'Leave type not found' });
    res.json(lt);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/leave-types
router.post('/', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Leave type name is required' });

    const existing = await HRLeaveType.findOne({ company: companyId, name: name.trim() }).lean();
    if (existing) return res.status(400).json({ message: `Leave type "${name}" already exists` });

    const lt = new HRLeaveType({ ...req.body, company: companyId, createdBy: currentUserId(req) });
    delete lt._id;
    await lt.save();
    res.status(201).json(lt);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PUT /api/hr/leave-types/:id
router.put('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const lt = await HRLeaveType.findOne({ _id: req.params.id, company: companyId });
    if (!lt) return res.status(404).json({ message: 'Leave type not found' });

    if (req.body.name && req.body.name.trim() !== lt.name) {
      const clash = await HRLeaveType.findOne({ company: companyId, name: req.body.name.trim(), _id: { $ne: lt._id } }).lean();
      if (clash) return res.status(400).json({ message: `Leave type "${req.body.name}" already exists` });
    }

    const forbidden = ['company', '_id', 'createdBy'];
    Object.entries(req.body)
      .filter(([k]) => !forbidden.includes(k))
      .forEach(([k, v]) => { lt[k] = v; });
    lt.updatedBy = currentUserId(req);
    await lt.save();
    res.json(lt);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/leave-types/:id
router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const lt = await HRLeaveType.findOne({ _id: req.params.id, company: companyId });
    if (!lt) return res.status(404).json({ message: 'Leave type not found' });

    const { default: HRLeaveApplication } = await import('../models/HRLeaveApplication.js');
    const inUse = await HRLeaveApplication.exists({ leaveType: lt._id });
    if (inUse) return res.status(400).json({ message: 'Cannot delete — leave applications exist for this type. Deactivate it instead.' });

    await lt.deleteOne();
    res.json({ message: 'Leave type deleted' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
