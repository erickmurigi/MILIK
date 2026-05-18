import express from 'express';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRAppraisal from '../models/HRAppraisal.js';
import { resolveCompanyId, currentUserId, escapeRegex, parsePage, parseLimit } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser);

// GET /api/hr/appraisals?cycleId=&status=&search=&page=&limit=
router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { cycleId, status, search, page, limit } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit);
    const query = { company: companyId };
    if (cycleId) query.cycle  = cycleId;
    if (status)  query.status = status;
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: 'i' };
      query.$or = [
        { 'snapshot.name':           rx },
        { 'snapshot.employeeNumber': rx },
        { 'snapshot.department':     rx },
      ];
    }
    const [appraisals, total] = await Promise.all([
      HRAppraisal.find(query)
        .populate('cycle',    'name year periodType status')
        .populate('employee', 'surname otherNames employeeNumber profilePicture')
        .sort({ 'snapshot.name': 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      HRAppraisal.countDocuments(query),
    ]);
    res.json({ appraisals, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/hr/appraisals/:id
router.get('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const appraisal = await HRAppraisal.findOne({ _id: req.params.id, company: companyId })
      .populate('cycle',    'name year periodType status startDate endDate')
      .populate('employee', 'surname otherNames employeeNumber profilePicture')
      .populate('ratings.kpi', 'name category unit')
      .lean();
    if (!appraisal) return res.status(404).json({ message: 'Appraisal not found' });
    res.json(appraisal);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/hr/appraisals/:id  — save scores & notes
router.put('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const appraisal = await HRAppraisal.findOne({ _id: req.params.id, company: companyId });
    if (!appraisal) return res.status(404).json({ message: 'Appraisal not found' });
    if (appraisal.status === 'Submitted') return res.status(400).json({ message: 'Submitted appraisals cannot be edited' });

    const { ratings, reviewerNotes, employeeComments } = req.body;
    if (ratings) {
      appraisal.ratings = ratings;
      const weighted = ratings.reduce((sum, r) => {
        const pct = r.maxScore > 0 ? (r.score / r.maxScore) * 100 : 0;
        return sum + pct * (r.weight / 100);
      }, 0);
      appraisal.overallScore = Math.round(weighted * 100) / 100;
    }
    if (reviewerNotes     !== undefined) appraisal.reviewerNotes    = reviewerNotes;
    if (employeeComments  !== undefined) appraisal.employeeComments = employeeComments;
    if (appraisal.status  === 'Pending') appraisal.status           = 'InProgress';
    appraisal.updatedBy = currentUserId(req);
    await appraisal.save();
    res.json(appraisal);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/hr/appraisals/:id/submit
router.post('/:id/submit', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const appraisal = await HRAppraisal.findOne({ _id: req.params.id, company: companyId });
    if (!appraisal) return res.status(404).json({ message: 'Appraisal not found' });
    if (appraisal.status === 'Submitted') return res.status(400).json({ message: 'Already submitted' });
    appraisal.status      = 'Submitted';
    appraisal.submittedAt = new Date();
    appraisal.updatedBy   = currentUserId(req);
    await appraisal.save();
    res.json(appraisal);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
