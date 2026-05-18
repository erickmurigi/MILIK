import express from 'express';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRKpi from '../models/HRKpi.js';
import HRAppraisalCycle from '../models/HRAppraisalCycle.js';
import { resolveCompanyId, currentUserId, escapeRegex } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser);

// GET /api/hr/kpis
router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { search, isActive, category } = req.query;
    const query = { company: companyId };
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (category) query.category = category;
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: 'i' };
      query.$or = [{ name: rx }, { description: rx }];
    }
    const kpis = await HRKpi.find(query).sort({ category: 1, name: 1 }).lean();
    res.json(kpis);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/hr/kpis
router.post('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name, description, category, unit, maxScore } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'KPI name is required' });
    const kpi = new HRKpi({
      company:     companyId,
      name:        name.trim(),
      description: description?.trim(),
      category,
      unit,
      maxScore:    maxScore || 100,
      createdBy:   currentUserId(req),
    });
    await kpi.save();
    res.status(201).json(kpi);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'A KPI with this name already exists' });
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/hr/kpis/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const kpi = await HRKpi.findOne({ _id: req.params.id, company: companyId });
    if (!kpi) return res.status(404).json({ message: 'KPI not found' });
    const allowed = ['name', 'description', 'category', 'unit', 'maxScore', 'isActive'];
    for (const k of allowed) {
      if (req.body[k] !== undefined) kpi[k] = typeof req.body[k] === 'string' ? req.body[k].trim() : req.body[k];
    }
    kpi.updatedBy = currentUserId(req);
    await kpi.save();
    res.json(kpi);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'A KPI with this name already exists' });
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/hr/kpis/:id
router.delete('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const kpi = await HRKpi.findOne({ _id: req.params.id, company: companyId });
    if (!kpi) return res.status(404).json({ message: 'KPI not found' });
    const inUse = await HRAppraisalCycle.exists({ company: companyId, 'kpis.kpi': kpi._id });
    if (inUse) return res.status(400).json({ message: 'KPI is used in an appraisal cycle. Deactivate it instead.' });
    await kpi.deleteOne();
    res.json({ message: 'KPI deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
