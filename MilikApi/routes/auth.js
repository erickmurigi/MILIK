import express from 'express';
import { validateRequest } from '../utils/validateRequest.js';
import { loginSchema, createUserSchema } from '../utils/validationSchemas.js';
import {
  loginUser,
  registerUser,
  getCurrentUser,
  logoutUser,
  createSuperAdmin,
  switchCompany,
  getAccessibleCompanies,
  changePasswordFirstLogin,
} from '../controllers/authController.js';
import { verifyUser } from '../controllers/verifyToken.js';

const router = express.Router();

router.post('/login', validateRequest(loginSchema), loginUser);
router.post('/super-admin', createSuperAdmin);

router.post('/', verifyUser, validateRequest(createUserSchema), registerUser);
router.get('/me', verifyUser, getCurrentUser);
router.post('/logout', verifyUser, logoutUser);
router.get('/accessible-companies', verifyUser, getAccessibleCompanies);
router.post('/switch-company', verifyUser, switchCompany);
router.post('/change-password-first-login', verifyUser, changePasswordFirstLogin);

export default router;