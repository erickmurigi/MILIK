import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import HREmployee from '../models/HREmployee.js';
import Company from '../../../models/Company.js';

const router = express.Router();

const getJWTSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is required');
  return s;
};
const JWT_OPTS = { issuer: 'milik-api', audience: 'milik-client', expiresIn: '12h' };

const essLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: "Too many login attempts, please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// POST /api/hr/ess/auth/login
router.post('/login', essLoginLimiter, async (req, res) => {
  try {
    const { companyCode, employeeNumber, password } = req.body;
    if (!companyCode || !employeeNumber || !password) {
      return res.status(400).json({ message: 'Company code, employee number, and password are required' });
    }

    const company = await Company.findOne({
      companyCode: String(companyCode).trim().toUpperCase(),
    }).lean();
    if (!company) return res.status(401).json({ message: 'Invalid company code or credentials' });

    const emp = await HREmployee.findOne({
      company: company._id,
      employeeNumber: String(employeeNumber).trim().toUpperCase(),
    }).lean();

    if (!emp || !emp.essEnabled) {
      return res.status(401).json({ message: 'ESS access not enabled or invalid credentials' });
    }

    if (!emp.essPassword) {
      return res.status(401).json({ message: 'No ESS password set. Contact your HR administrator.' });
    }

    const valid = await bcrypt.compare(password, emp.essPassword);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    if (emp.status === 'Terminated') {
      return res.status(403).json({ message: 'Your account has been deactivated. Contact HR.' });
    }

    const payload = {
      essEmployeeId: emp._id.toString(),
      companyId:     company._id.toString(),
      role:          'hrEmployee',
    };
    const token = jwt.sign(payload, getJWTSecret(), JWT_OPTS);

    res.json({
      token,
      employee: {
        _id:            emp._id,
        surname:        emp.surname,
        otherNames:     emp.otherNames,
        employeeNumber: emp.employeeNumber,
        email:          emp.email,
        profilePicture: emp.profilePicture,
        status:         emp.status,
      },
      company: {
        _id:         company._id,
        companyName: company.companyName,
        companyCode: company.companyCode,
      },
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/hr/ess/auth/change-password  (requires ESS token)
router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ message: 'Not authenticated' });

    let decoded;
    try {
      decoded = jwt.verify(authHeader.slice(7), getJWTSecret(), { issuer: 'milik-api', audience: 'milik-client' });
    } catch {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }
    if (decoded.role !== 'hrEmployee') return res.status(403).json({ message: 'Forbidden' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new passwords are required' });
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ message: 'New password must be at least 8 characters with at least one uppercase letter and one digit' });
    }

    const emp = await HREmployee.findOne({
      _id:     decoded.essEmployeeId,
      company: decoded.companyId,
    });
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const valid = await bcrypt.compare(currentPassword, emp.essPassword || '');
    if (!valid) return res.status(400).json({ message: 'Current password is incorrect' });

    emp.essPassword = await bcrypt.hash(newPassword, 10);
    await emp.save();

    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
