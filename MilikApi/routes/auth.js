import express from 'express';
import rateLimit from 'express-rate-limit';
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
  refreshToken,
} from '../controllers/authController.js';
import { verifyUser } from '../controllers/verifyToken.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,                   // 15 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true, // Only count failed attempts
});

// IP-keyed alone lets a distributed attack (many IPs, one target account) through
// unthrottled — each IP gets its own fresh bucket. Key a second limiter on the
// attempted email so one account can't be brute-forced across IPs either; the two
// run together so a single IP hammering many accounts (first limiter) and many IPs
// hammering one account (this one) are both covered.
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts for this account. Please try again in 15 minutes." },
  skipSuccessfulRequests: true,
  keyGenerator: (req) => String(req.body?.email || "").trim().toLowerCase() || "unknown",
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,                   // 30 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many refresh attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

router.post('/login', loginLimiter, loginAccountLimiter, validateRequest(loginSchema), loginUser);
router.post('/refresh', refreshLimiter, refreshToken);

router.post('/', verifyUser, validateRequest(createUserSchema), registerUser);
router.get('/me', verifyUser, getCurrentUser);
router.post('/logout', verifyUser, logoutUser);
router.get('/accessible-companies', verifyUser, getAccessibleCompanies);
router.post('/switch-company', verifyUser, switchCompany);
router.post('/change-password-first-login', verifyUser, changePasswordFirstLogin);

export default router;