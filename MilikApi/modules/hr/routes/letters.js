import express from 'express';
import mongoose from 'mongoose';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRLetter from '../models/HRLetter.js';
import HREmployee from '../models/HREmployee.js';
import HRSignatory from '../models/HRSignatory.js';
import HRLetterTemplate from '../models/HRLetterTemplate.js';
import Company from '../../../models/Company.js';
import { resolveCompanyId, currentUserId, escapeRegex, requireOid, toOid } from '../services/hrScope.js';
import { isSystemAdminUser } from '../../../utils/permissionControl.js';
import { LETTER_META, renderLetterBody, applyCustomTemplate, renderWithCustomBody } from '../utils/letterTemplates.js';

const router = express.Router();
router.use(verifyUser);

// Resolve signatory: type-specific first, then default, in one query
async function resolveSignatory(companyOid, letterType) {
  const results = await HRSignatory.find({
    company: companyOid,
    $or: [{ letterTypes: letterType }, { isDefault: true }],
  }).lean();
  return (
    results.find((s) => s.letterTypes?.includes(letterType)) ||
    results.find((s) => s.isDefault) ||
    null
  );
}

// Load all related data needed to build a letter body (shared by POST + regenerate)
async function loadLetterResources(oid, employeeId, letterType) {
  const [employee, company, customTemplate, signatory] = await Promise.all([
    HREmployee.findOne({ _id: employeeId, company: oid })
      .populate('department',  'name')
      .populate('designation', 'name')
      .lean(),
    Company.findById(oid).lean(),
    HRLetterTemplate.findOne({ company: oid, letterType }).populate('signatory', 'name title').lean(),
    resolveSignatory(oid, letterType),
  ]);
  return { employee, company, customTemplate, signatory };
}

// Build letter body: custom template if one exists, otherwise hardcoded switch
function buildBody(letterType, employee, metadata, company, signatory, customTemplate) {
  if (customTemplate?.bodyHtml) {
    const resolvedSignatory = customTemplate.signatory || signatory;
    const renderedBody = applyCustomTemplate(customTemplate.bodyHtml, employee, metadata, company);
    return renderWithCustomBody(employee, company, resolvedSignatory, renderedBody, letterType);
  }
  return renderLetterBody(letterType, employee, metadata, company, signatory);
}

// ── Letter type metadata (fields needed per type) ────────────────────────────
router.get('/meta', (req, res) => {
  res.json(LETTER_META);
});

// ── List letters ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { employeeId, letterType, status, page = 1, limit = 25, search } = req.query;

    const filter = { company: oid };
    const empOid = toOid(employeeId);
    if (empOid)      filter.employee   = empOid;
    else if (employeeId) return res.status(400).json({ message: 'Invalid employeeId' });
    if (letterType)  filter.letterType = letterType;
    if (status)      filter.status     = status;

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const empMatches = await HREmployee.find({
        company: oid,
        $or: [{ surname: regex }, { otherNames: regex }],
      }).select('_id').lean();
      const searchConds = [{ subject: regex }];
      if (empMatches.length > 0) searchConds.push({ employee: { $in: empMatches.map((e) => e._id) } });
      filter.$or = searchConds;
    }

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
    requireOid(req.params.id, 'letter ID');
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid })
      .populate({
        path: 'employee',
        select: 'surname otherNames employeeNumber email department designation physicalAddress kraPin nhifNo nssfNo',
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
    if (!mongoose.Types.ObjectId.isValid(String(employeeId))) {
      return res.status(400).json({ message: 'Invalid employeeId' });
    }
    if (!LETTER_META[letterType]) {
      return res.status(400).json({ message: `Unknown letter type: ${letterType}` });
    }

    const { employee, company, customTemplate, signatory } = await loadLetterResources(oid, employeeId, letterType);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const typeMeta = LETTER_META[letterType];
    const subject  = customSubject?.trim() || `${typeMeta.label} — ${employee.surname} ${employee.otherNames}`;
    const body     = buildBody(letterType, employee, metadata || {}, company || {}, signatory, customTemplate);

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

    await letter.populate('employee', 'surname otherNames employeeNumber department designation');
    res.status(201).json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Update draft letter (edit body/subject/metadata) ─────────────────────────
router.put('/:id', async (req, res) => {
  try {
    requireOid(req.params.id, 'letter ID');
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
    requireOid(req.params.id, 'letter ID');
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const userId = currentUserId(req);

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid });
    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    if (letter.status === 'issued') return res.status(400).json({ message: 'Issued letters cannot be regenerated' });

    const { employee, company, customTemplate, signatory } = await loadLetterResources(oid, letter.employee, letter.letterType);
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const newMeta = req.body.metadata ? { ...letter.metadata, ...req.body.metadata } : letter.metadata;
    letter.body = buildBody(letter.letterType, employee, newMeta, company || {}, signatory, customTemplate);
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
    requireOid(req.params.id, 'letter ID');
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
    await letter.populate('employee', 'surname otherNames employeeNumber department designation');
    res.json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Revoke issued letter (admin only) ────────────────────────────────────────
router.patch('/:id/revoke', async (req, res) => {
  try {
    requireOid(req.params.id, 'letter ID');
    if (!req.user?.adminAccess && !isSystemAdminUser(req.user)) {
      return res.status(403).json({ message: 'Only administrators can revoke an issued letter' });
    }
    const companyId = await resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const userId = currentUserId(req);
    const { reason } = req.body || {};

    const letter = await HRLetter.findOne({ _id: req.params.id, company: oid });
    if (!letter) return res.status(404).json({ message: 'Letter not found' });
    if (letter.status !== 'issued') return res.status(400).json({ message: 'Only issued letters can be revoked' });

    letter.status        = 'revoked';
    letter.revokedBy     = userId;
    letter.revokedAt     = new Date();
    letter.revokedReason = reason || '';
    letter.updatedBy     = userId;

    await letter.save();
    await letter.populate('employee', 'surname otherNames employeeNumber department designation');
    res.json(letter);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── Delete draft letter ───────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    requireOid(req.params.id, 'letter ID');
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
