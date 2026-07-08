import express from 'express';
import { verifyUser, requireCompanyModule, requireCompanyPermission } from '../../../controllers/verifyToken.js';
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
  getCustomerStatement,
  sendCustomerSms,
  bulkSendCustomerSms,
  findDuplicateCustomers,
  mergeCustomers,
  backfillCustomerStats,
  backfillCustomersAndStamps,
  migrateToPerCustomerCards,
  awardManualStamp,
} from '../controllers/loyaltyController.js';
import { validateParamId } from '../middleware/validateObjectId.js';

const router = express.Router();

router.use(verifyUser, requireCompanyModule("carwash"));

// Loyalty program config
router.get('/program', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), getLoyaltyProgram);
router.post('/program', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), upsertLoyaltyProgram);

// Plate lookup (used when opening a job)
router.get('/plate/:plate', requireCompanyPermission('carwash-jobs', 'view', 'carwash'), lookupPlate);

// Customers
router.get('/customers', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), listCustomers);
router.get('/customers/enriched', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), listCustomersEnriched);
router.get('/customers/duplicates', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), findDuplicateCustomers);
router.post('/customers/bulk-sms', requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), bulkSendCustomerSms);
router.post('/customers/merge', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), mergeCustomers);
router.post('/customers', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), registerCustomer);
router.put('/customers/:id', validateParamId(), requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), updateCustomer);
router.get('/customers/:customerId/card', validateParamId('customerId'), requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), getCustomerCard);
router.get('/customers/:id/statement', validateParamId(), requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), getCustomerStatement);
router.post('/customers/:id/sms', validateParamId(), requireCompanyPermission('carwash-loyalty', 'view', 'carwash'), sendCustomerSms);
router.post('/customers/:id/stamp', validateParamId(), requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), awardManualStamp);

// Redeem a reward on a specific job
router.patch('/jobs/:jobId/redeem', validateParamId('jobId'), requireCompanyPermission('carwash-jobs', 'update', 'carwash'), redeemReward);

// Backfill: create missing customers + award stamps for all existing jobs
router.post('/admin/backfill', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), backfillCustomersAndStamps);
// Backfill denormalized stats on all CarWashCustomer documents (one-time migration)
router.post('/admin/backfill-stats', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), backfillCustomerStats);
// One-time migration: merge per-plate cards into per-customer cards
router.post('/admin/migrate-per-customer', requireCompanyPermission('carwash-loyalty', 'manage', 'carwash'), migrateToPerCustomerCards);

export default router;
