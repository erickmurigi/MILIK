import express from 'express';
import mongoose from 'mongoose';
import { verifyUser, requireCompanyModule } from '../../../controllers/verifyToken.js';
import HRPayComponent from '../models/HRPayComponent.js';
import { resolveCompanyId } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('hr'));

router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const filter = { company: companyId };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.active === 'true') filter.isActive = true;
    const components = await HRPayComponent.find(filter).sort({ type: 1, sortOrder: 1, name: 1 }).lean();
    res.json(components);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { type, name, code, isTaxable, isStatutory, sortOrder } = req.body;
    if (!type || !name?.trim() || !code?.trim()) {
      return res.status(400).json({ message: 'type, name, and code are required' });
    }
    const comp = await HRPayComponent.create({
      company: oid, type,
      name: name.trim(), code: code.trim().toUpperCase(),
      isTaxable: !!isTaxable, isStatutory: !!isStatutory,
      sortOrder: Number(sortOrder) || 0,
    });
    res.status(201).json(comp);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: 'A component with this code already exists' });
    res.status(500).json({ message: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { name, code, isTaxable, isStatutory, isActive, sortOrder } = req.body;
    const update = {};
    if (name !== undefined)        update.name        = name.trim();
    if (code !== undefined)        update.code        = code.trim().toUpperCase();
    if (isTaxable !== undefined)   update.isTaxable   = !!isTaxable;
    if (isStatutory !== undefined) update.isStatutory = !!isStatutory;
    if (isActive !== undefined)    update.isActive    = !!isActive;
    if (sortOrder !== undefined)   update.sortOrder   = Number(sortOrder) || 0;

    const comp = await HRPayComponent.findOneAndUpdate(
      { _id: req.params.id, company: oid },
      { $set: update },
      { new: true, runValidators: true }
    ).lean();
    if (!comp) return res.status(404).json({ message: 'Component not found' });
    res.json(comp);
  } catch (e) {
    if (e.code === 11000) return res.status(400).json({ message: 'A component with this code already exists' });
    res.status(500).json({ message: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    await HRPayComponent.deleteOne({ _id: req.params.id, company: oid });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

export default router;
