import express from 'express';
import { verifyUser } from '../../controllers/verifyToken.js';
import {
  getZones,
  getZone,
  createZone,
  updateZone,
  deleteZone,
  getEligibleOfficers,
  getZoneVacancyReport,
} from '../../controllers/propertyController/zones.js';

const router = express.Router();

// static paths before /:id
router.get('/officers',        verifyUser, getEligibleOfficers);
router.get('/reports/vacancy', verifyUser, getZoneVacancyReport);

router.get('/',        verifyUser, getZones);
router.get('/:id',     verifyUser, getZone);
router.post('/',       verifyUser, createZone);
router.put('/:id',     verifyUser, updateZone);
router.delete('/:id',  verifyUser, deleteZone);

export default router;
