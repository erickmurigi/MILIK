import express from 'express';
import mongoose from 'mongoose';
import { verifyUser, requireCompanyModule } from '../../../controllers/verifyToken.js';
import HRAppraisalCycle from '../models/HRAppraisalCycle.js';
import HRAppraisal from '../models/HRAppraisal.js';
import HREmployee from '../models/HREmployee.js';
import { resolveCompanyId, currentUserId } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('hr'));

// GET /api/hr/appraisal-cycles
router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { year, status } = req.query;
    const query = { company: companyId };
    if (year) query.year = Number(year);
    if (status) query.status = status;
    const cycles = await HRAppraisalCycle.find(query)
      .populate('kpis.kpi', 'name category unit maxScore')
      .sort({ year: -1, startDate: -1 })
      .lean();
    res.json(cycles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/hr/appraisal-cycles/:id
router.get('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const cycle = await HRAppraisalCycle.findOne({ _id: req.params.id, company: companyId })
      .populate('kpis.kpi', 'name category unit maxScore')
      .lean();
    if (!cycle) return res.status(404).json({ message: 'Cycle not found' });
    res.json(cycle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/hr/appraisal-cycles
router.post('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { name, year, periodType, startDate, endDate, kpis, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Cycle name is required' });
    if (!year)         return res.status(400).json({ message: 'Year is required' });
    if (!startDate || !endDate) return res.status(400).json({ message: 'Start and end dates are required' });
    if (new Date(startDate) >= new Date(endDate)) return res.status(400).json({ message: 'End date must be after start date' });
    if (kpis?.length) {
      const total = kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
      if (Math.abs(total - 100) > 0.01) return res.status(400).json({ message: `KPI weights must sum to 100 (currently ${total.toFixed(1)})` });
    }
    const cycle = new HRAppraisalCycle({
      company:    companyId,
      name:       name.trim(),
      year:       Number(year),
      periodType: periodType || 'Annual',
      startDate,
      endDate,
      kpis:       kpis || [],
      notes:      notes?.trim(),
      createdBy:  currentUserId(req),
    });
    await cycle.save();
    await cycle.populate('kpis.kpi', 'name category unit maxScore');
    res.status(201).json(cycle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/hr/appraisal-cycles/:id
router.put('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const cycle = await HRAppraisalCycle.findOne({ _id: req.params.id, company: companyId });
    if (!cycle) return res.status(404).json({ message: 'Cycle not found' });
    if (cycle.status !== 'Draft') return res.status(400).json({ message: 'Only Draft cycles can be edited' });
    const { name, year, periodType, startDate, endDate, kpis, notes } = req.body;
    if (kpis?.length) {
      const total = kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0);
      if (Math.abs(total - 100) > 0.01) return res.status(400).json({ message: `KPI weights must sum to 100 (currently ${total.toFixed(1)})` });
    }
    if (name       !== undefined) cycle.name       = name.trim();
    if (year       !== undefined) cycle.year       = Number(year);
    if (periodType !== undefined) cycle.periodType = periodType;
    if (startDate  !== undefined) cycle.startDate  = startDate;
    if (endDate    !== undefined) cycle.endDate    = endDate;
    if (kpis       !== undefined) cycle.kpis       = kpis;
    if (notes      !== undefined) cycle.notes      = notes?.trim();
    cycle.updatedBy = currentUserId(req);
    await cycle.save();
    await cycle.populate('kpis.kpi', 'name category unit maxScore');
    res.json(cycle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/hr/appraisal-cycles/:id
router.delete('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const cycle = await HRAppraisalCycle.findOne({ _id: req.params.id, company: companyId });
    if (!cycle) return res.status(404).json({ message: 'Cycle not found' });
    if (cycle.status !== 'Draft') return res.status(400).json({ message: 'Only Draft cycles can be deleted' });
    await HRAppraisal.deleteMany({ cycle: cycle._id });
    await cycle.deleteOne();
    res.json({ message: 'Cycle deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/hr/appraisal-cycles/:id/open  — generate appraisals for all active employees
router.post('/:id/open', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const cycle = await HRAppraisalCycle.findOne({ _id: req.params.id, company: companyId })
      .populate('kpis.kpi', 'name maxScore');
    if (!cycle) return res.status(404).json({ message: 'Cycle not found' });
    if (cycle.status !== 'Draft') return res.status(400).json({ message: 'Only Draft cycles can be opened' });
    if (!cycle.kpis.length) return res.status(400).json({ message: 'Add at least one KPI before opening the cycle' });
    const total = cycle.kpis.reduce((s, k) => s + (k.weight || 0), 0);
    if (Math.abs(total - 100) > 0.01) return res.status(400).json({ message: `KPI weights must sum to 100 (currently ${total.toFixed(1)})` });

    const employees = await HREmployee.find({
      company: companyId,
      status:  { $in: ['Active', 'Probation'] },
    }).populate('department', 'name').populate('designation', 'name').lean();

    const ratingTemplate = cycle.kpis.map((ck) => ({
      kpi:      ck.kpi._id,
      kpiName:  ck.kpi.name,
      maxScore: ck.kpi.maxScore,
      weight:   ck.weight,
      score:    0,
      notes:    '',
    }));

    if (employees.length) {
      const ops = employees.map((emp) => ({
        insertOne: {
          document: {
            company:  new mongoose.Types.ObjectId(companyId),
            cycle:    cycle._id,
            employee: emp._id,
            snapshot: {
              name:           `${emp.surname} ${emp.otherNames}`,
              employeeNumber: emp.employeeNumber || '',
              department:     emp.department?.name || '',
              designation:    emp.designation?.name || '',
            },
            ratings:   ratingTemplate.map((r) => ({ ...r })),
            status:    'Pending',
            createdBy: currentUserId(req),
          },
        },
      }));
      // ordered:false so duplicate-key errors (re-opens) are skipped silently
      await HRAppraisal.bulkWrite(ops, { ordered: false });
    }

    cycle.status        = 'Open';
    cycle.employeeCount = employees.length;
    cycle.updatedBy     = currentUserId(req);
    await cycle.save();

    res.json({ message: `Cycle opened. ${employees.length} appraisals generated.`, cycle });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/hr/appraisal-cycles/:id/close
router.post('/:id/close', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const cycle = await HRAppraisalCycle.findOne({ _id: req.params.id, company: companyId });
    if (!cycle) return res.status(404).json({ message: 'Cycle not found' });
    if (cycle.status !== 'Open') return res.status(400).json({ message: 'Only Open cycles can be closed' });
    cycle.status    = 'Closed';
    cycle.updatedBy = currentUserId(req);
    await cycle.save();
    res.json({ message: 'Cycle closed', cycle });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
