import express from 'express';
import mongoose from 'mongoose';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRLetter from '../models/HRLetter.js';
import HREmployee from '../models/HREmployee.js';
import { resolveCompanyId, currentUserId } from '../services/hrScope.js';
import { LETTER_META, renderLetterBody } from '../utils/letterTemplates.js';

const router = express.Router();
router.use(verifyUser);

// ── Letter type metadata (fields needed per type) ────────────────────────────
router.get('/meta', (req, res) => {
  res.json(LETTER_META);
});

// ── List letters ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { employeeId, letterType, status, page = 1, limit = 25 } = req.query;

    const filter = { company: oid };
    if (employeeId)  filter.employee   = new mongoose.Types.ObjectId(employeeId);
    if (letterType)  filter.letterType = letterType;
    if (status)      filter.status     = status;

    const skip = (Math.max(1, Number(page)) - 1) * Math.min(100, Number(limit));
    const lim  = Math.min(100, Number(limit));

    const [letters, total] = await Promise.all([
      HRLetter.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .populate('employee', 'surname otherNames employeeNumber department designation')
        .lean(),
      HRLetter.countDocuments(filter),
    ]);

    res.json({ letters, total, page: Number(page), pages: Math.ceil(total / lim) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Get single letter ────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid })
      .populate({
        path: 'employee',
        select: 'surname otherNames employeeNumber department designation physicalAddress kraPin nhifNo nssfNo',
        populate: [
          { path: 'department',   select: 'name' },
          { path: 'designation',  select: 'name' },
        ],
      })
      .lean();

    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    res.json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Create letter (generate from template) ───────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const userId = currentUserId(req);
    const { employeeId, letterType, metadata, customSubject } = req.body;

    if (!employeeId || !letterType) {
      return res.status(400).json({ message: 'employeeId and letterType are required' });
    }
    if (!LETTER_META[letterType]) {
      return res.status(400).json({ message: `Unknown letter type: ${letterType}` });
    }

    const [employee, company] = await Promise.all([
      HREmployee.findOne({ _id: employeeId, company: oid })
        .populate('department',  'name')
        .populate('designation', 'name')
        .lean(),
      mongoose.model('Company').findById(oid).lean(),
    ]);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const typeMeta = LETTER_META[letterType];
    const subject  = customSubject?.trim() || `${typeMeta.label} — ${employee.surname} ${employee.otherNames}`;
    const body     = renderLetterBody(letterType, employee, metadata || {}, company || {});

    const letter = await HRLetter.create({
      company: oid,
      employee: employee._id,
      letterType,
      subject,
      body,
      metadata: metadata || {},
      status: 'draft',
      createdBy: userId,
    });

    res.status(201).json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Update draft letter (edit body/subject/metadata) ─────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const userId = currentUserId(req);

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid });
    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    if (letter.status === 'issued') return res.status(400).json({ message: 'Issued letters cannot be edited' });

    const { subject, body, metadata } = req.body;
    if (subject) letter.subject  = subject.trim();
    if (body)    letter.body     = body;
    if (metadata) letter.metadata = { ...letter.metadata, ...metadata };
    letter.updatedBy = userId;

    await letter.save();
    res.json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Regenerate body from template (if metadata changed) ───────────────────────
router.post('/:id/regenerate', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const userId = currentUserId(req);

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid });
    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    if (letter.status === 'issued') return res.status(400).json({ message: 'Issued letters cannot be regenerated' });

    const [employee, company] = await Promise.all([
      HREmployee.findOne({ _id: letter.employee, company: oid })
        .populate('department',  'name')
        .populate('designation', 'name')
        .lean(),
      mongoose.model('Company').findById(oid).lean(),
    ]);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const newMeta = req.body.metadata ? { ...letter.metadata, ...req.body.metadata } : letter.metadata;
    letter.body = renderLetterBody(letter.letterType, employee, newMeta, company || {});
    if (req.body.metadata) letter.metadata = newMeta;
    letter.updatedBy = userId;

    await letter.save();
    res.json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Issue letter ──────────────────────────────────────────────────────────────
router.patch('/:id/issue', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const userId = currentUserId(req);

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid });
    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    if (letter.status === 'issued') return res.status(400).json({ message: 'Letter is already issued' });

    letter.status     = 'issued';
    letter.issuedDate = new Date();
    letter.issuedBy   = userId;
    letter.updatedBy  = userId;

    await letter.save();
    res.json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Delete draft letter ───────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid });
    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    if (letter.status === 'issued') return res.status(400).json({ message: 'Issued letters cannot be deleted' });

    await letter.deleteOne();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
