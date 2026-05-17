import express from 'express';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRStatutoryConfig from '../models/HRStatutoryConfig.js';
import { DEFAULT_CONFIG } from '../services/hrStatutory.js';
import { resolveCompanyId, currentUserId } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser);

// GET /api/hr/statutory-config
router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const doc = await HRStatutoryConfig.findOne({ company: companyId }).lean();
    if (!doc) return res.json({ ...DEFAULT_CONFIG, _isDefault: true });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/hr/statutory-config
router.put('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const userId    = currentUserId(req);
    const { personalRelief, payeBands, shaRate, shaMin, nssfLower, nssfUpper, nssfRate, ahlRate } = req.body;

    if (!Array.isArray(payeBands) || payeBands.length < 1) {
      return res.status(400).json({ message: 'At least one PAYE band is required' });
    }
    for (const b of payeBands) {
      if (typeof b.rate !== 'number' || b.rate < 0 || b.rate > 1) {
        return res.status(400).json({ message: 'Each PAYE band must have a rate between 0 and 1' });
      }
    }

    const doc = await HRStatutoryConfig.findOneAndUpdate(
      { company: companyId },
      { $set: { personalRelief, payeBands, shaRate, shaMin, nssfLower, nssfUpper, nssfRate, ahlRate, updatedBy: userId } },
      { upsert: true, new: true, runValidators: true }
    );
    res.json(doc);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/statutory-config  — reset to Kenya defaults
router.delete('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    await HRStatutoryConfig.deleteOne({ company: companyId });
    res.json({ message: 'Statutory config reset to Kenya defaults', ...DEFAULT_CONFIG, _isDefault: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
