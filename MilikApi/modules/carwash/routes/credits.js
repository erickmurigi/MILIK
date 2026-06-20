import express from 'express';
import { verifyUser, requireCompanyModule, requireCompanyPermission } from '../../../controllers/verifyToken.js';
import { validateParamId } from '../middleware/validateObjectId.js';
import {
  listCredits,
  getCreditByPlate,
  applyCredit,
  writeOffCredit,
  undoWriteOff,
  refundCredit,
} from '../controllers/creditsController.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('carwash'));

// Plate credit lookup — used in payment modal (any user who can record payments)
router.get('/plate/:plate', requireCompanyPermission('carwash-payments', 'view', 'carwash'), getCreditByPlate);

// List credits (active / written_off) — manager view
router.get('/', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), listCredits);

// Apply credit to a job
router.post('/:id/apply', validateParamId(), requireCompanyPermission('carwash-payments', 'record', 'carwash'), applyCredit);

// Write off single or bulk
router.post('/write-off', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), writeOffCredit);
router.post('/:id/write-off', validateParamId(), requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), writeOffCredit);

// Undo write-off
router.post('/:id/undo-write-off', validateParamId(), requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), undoWriteOff);

// Refund credit as cash
router.post('/:id/refund', validateParamId(), requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), refundCredit);

export default router;
