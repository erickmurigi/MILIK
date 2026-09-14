import express from 'express';
import mongoose from 'mongoose';
import { verifyUser, requireCompanyModule } from '../../../controllers/verifyToken.js';
import HRSignatory from '../models/HRSignatory.js';
import { resolveCompanyId } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('hr'));

router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const sigs = await HRSignatory.find({ company: companyId }).sort({ isDefault: -1, name: 1 }).lean();
    res.json(sigs);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { name, title, department, isDefault, letterTypes } = req.body;
    if (!name?.trim() || !title?.trim()) return res.status(400).json({ message: 'Name and title are required' });

    if (isDefault) {
      await HRSignatory.updateMany({ company: oid, isDefault: true }, { $set: { isDefault: false } });
    }
    const sig = await HRSignatory.create({
      company: oid,
      name: name.trim(),
      title: title.trim(),
      department: department?.trim() || '',
      isDefault: !!isDefault,
      letterTypes: letterTypes || [],
    });
    res.status(201).json(sig);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { name, title, department, isDefault, letterTypes } = req.body;

    if (isDefault) {
      await HRSignatory.updateMany({ company: oid, isDefault: true, _id: { $ne: req.params.id } }, { $set: { isDefault: false } });
    }
    const sig = await HRSignatory.findOneAndUpdate(
      { _id: req.params.id, company: oid },
      { $set: { name: name?.trim(), title: title?.trim(), department: department?.trim() || '', isDefault: !!isDefault, letterTypes: letterTypes || [] } },
      { new: true, runValidators: true }
    ).lean();
    if (!sig) return res.status(404).json({ message: 'Signatory not found' });
    res.json(sig);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    await HRSignatory.deleteOne({ _id: req.params.id, company: oid });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

export default router;
