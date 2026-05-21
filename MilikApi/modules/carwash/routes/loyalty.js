import express from 'express';
import { requireCompanyPermission } from '../../../controllers/verifyToken.js';
import {
  getLoyaltyProgram,
  upsertLoyaltyProgram,
  listCustomers,
  registerCustomer,
  updateCustomer,
  lookupPlate,
  redeemReward,
  getCustomerCard,
} from '../controllers/loyaltyController.js';

const router = express.Router();

// Loyalty program config
router.get('/program', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), getLoyaltyProgram);
router.post('/program', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), upsertLoyaltyProgram);

// Plate lookup (used when opening a job)
router.get('/plate/:plate', requireCompanyPermission('carwash-jobs', 'view', 'carwash'), lookupPlate);

// Customers
router.get('/customers', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), listCustomers);
router.post('/customers', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), registerCustomer);
router.put('/customers/:id', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), updateCustomer);
router.get('/customers/:customerId/card', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), getCustomerCard);

// Redeem a reward on a specific job
router.patch('/jobs/:jobId/redeem', requireCompanyPermission('carwash-jobs', 'update', 'carwash'), redeemReward);

export default router;
