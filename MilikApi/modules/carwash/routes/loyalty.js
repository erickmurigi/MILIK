import express from 'express';
import { requireCompanyPermission } from '../../../controllers/verifyToken.js';
import {
  getLoyaltyProgram,
  upsertLoyaltyProgram,
  listCustomers,
  listCustomersEnriched,
  registerCustomer,
  updateCustomer,
  lookupPlate,
  redeemReward,
  getCustomerCard,
  sendCustomerSms,
  backfillCustomersAndStamps,
  migrateToPerCustomerCards,
} from '../controllers/loyaltyController.js';
import { validateParamId } from '../middleware/validateObjectId.js';

const router = express.Router();

// Loyalty program config
router.get('/program', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), getLoyaltyProgram);
router.post('/program', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), upsertLoyaltyProgram);

// Plate lookup (used when opening a job)
router.get('/plate/:plate', requireCompanyPermission('carwash-jobs', 'view', 'carwash'), lookupPlate);

// Customers
router.get('/customers', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), listCustomers);
router.get('/customers/enriched', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), listCustomersEnriched);
router.post('/customers', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), registerCustomer);
router.put('/customers/:id', validateParamId(), requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), updateCustomer);
router.get('/customers/:customerId/card', validateParamId('customerId'), requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), getCustomerCard);
router.post('/customers/:id/sms', validateParamId(), requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), sendCustomerSms);

// Redeem a reward on a specific job
router.patch('/jobs/:jobId/redeem', validateParamId('jobId'), requireCompanyPermission('carwash-jobs', 'update', 'carwash'), redeemReward);

// Backfill: create missing customers + award stamps for all existing jobs
router.post('/admin/backfill', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), backfillCustomersAndStamps);
// One-time migration: merge per-plate cards into per-customer cards
router.post('/admin/migrate-per-customer', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), migrateToPerCustomerCards);

export default router;
