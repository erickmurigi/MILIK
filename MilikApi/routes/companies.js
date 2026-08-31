import express from 'express';
import { validateRequest } from '../utils/validateRequest.js';
import {
  createCompanySchema,
  testCompanyEmailProfileSchema,
  updateCompanySchema,
} from '../utils/validationSchemas.js';
import {
  createCompany,
  deleteCompany,
  getAccessibleCompanies,
  getAllCompanies,
  getCompany,
  getCompanyUsers,
  testCompanyEmailProfile,
  toggleCompanyLock,
  updateCompany,
} from '../controllers/company.js';
import { verifyUser, verifySuperAdmin } from '../controllers/verifyToken.js';

const router = express.Router();

router.get('/accessible', verifyUser, getAccessibleCompanies);
router.post('/', verifyUser, validateRequest(createCompanySchema), createCompany);
router.get('/', verifyUser, getAllCompanies);
router.post('/:id/email-profiles/test', verifyUser, validateRequest(testCompanyEmailProfileSchema), testCompanyEmailProfile);
router.get('/:id', verifyUser, getCompany);
router.put('/:id', verifyUser, validateRequest(updateCompanySchema), updateCompany);
router.patch('/:id/toggle-lock', verifySuperAdmin, toggleCompanyLock);
router.delete('/:id', verifySuperAdmin, deleteCompany);
router.get('/:id/users', verifyUser, getCompanyUsers);

export default router;
