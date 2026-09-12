import express from 'express';
import mongoose from 'mongoose';
import { verifyUser, requireCompanyModule } from '../../../controllers/verifyToken.js';
import HRLetterTemplate from '../models/HRLetterTemplate.js';
import { resolveCompanyId, currentUserId } from '../services/hrScope.js';
import { LETTER_META, getDefaultBodyHtml } from '../utils/letterTemplates.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('hr'));

// GET all templates for company (sparse — only types that have been customised)
router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const templates = await HRLetterTemplate.find({ company: companyId })
      .populate('signatory', 'name title')
      .sort({ letterType: 1 })
      .lean();
    res.json(templates);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET single template by type — returns null if company uses default
router.get('/:letterType', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const template = await HRLetterTemplate.findOne({ company: companyId, letterType: req.params.letterType })
      .populate('signatory', 'name title')
      .lean();
    res.json(template || null);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET default body HTML for a type (so Setup can pre-fill the editor)
router.get('/:letterType/default', (req, res) => {
  try {
    const { letterType } = req.params;
    if (!LETTER_META[letterType]) return res.status(400).json({ message: `Unknown letter type: ${letterType}` });
    res.json({ bodyHtml: getDefaultBodyHtml(letterType) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT — upsert custom template for a letter type
router.put('/:letterType', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const userId = currentUserId(req);
    const { letterType } = req.params;
    if (!LETTER_META[letterType]) return res.status(400).json({ message: `Unknown letter type: ${letterType}` });

    const { bodyHtml, signatory, notes } = req.body;
    if (!bodyHtml?.trim()) return res.status(400).json({ message: 'Template body is required' });

    const template = await HRLetterTemplate.findOneAndUpdate(
      { company: oid, letterType },
      { $set: { bodyHtml: bodyHtml.trim(), signatory: signatory || null, notes: notes || '', updatedBy: userId } },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    res.json(template);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE — revert to default
router.delete('/:letterType', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    await HRLetterTemplate.deleteOne({ company: oid, letterType: req.params.letterType });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

export default router;
