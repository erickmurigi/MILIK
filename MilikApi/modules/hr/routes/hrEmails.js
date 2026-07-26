import express from 'express';
import mongoose from 'mongoose';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HRPayslip from '../models/HRPayslip.js';
import HRPayrollPeriod from '../models/HRPayrollPeriod.js';
import HRLetter from '../models/HRLetter.js';
import HREmployee from '../models/HREmployee.js';
import Company from '../../../models/Company.js';
import { resolveCompanyId } from '../services/hrScope.js';
import { buildSmtpTransporter, hasSmtpConfig, resolveMailSender } from '../../../utils/smtpMailer.js';
import { buildPayslipEmail, buildLetterEmail, buildRegisterEmail } from '../utils/hrEmailTemplates.js';

const router = express.Router();
router.use(verifyUser);

function noSmtp(res) {
  return res.status(503).json({ message: 'Email service is not configured on this server' });
}

async function resolveToEmail(req, fallbacks = []) {
  const override = req.body?.email?.trim();
  if (override) return override;
  for (const e of fallbacks) {
    const v = typeof e === 'function' ? await e() : e;
    if (v) return String(v).trim();
  }
  return null;
}

// POST /api/hr/emails/payslip/:payslipId
router.post('/payslip/:payslipId', async (req, res) => {
  try {
    if (!hasSmtpConfig()) return noSmtp(res);
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);

    const [payslip, company] = await Promise.all([
      HRPayslip.findOne({ _id: req.params.payslipId, company: oid })
        .populate('payrollPeriod', 'name label month year status')
        .populate('employee', 'workEmail email')
        .lean(),
      Company.findById(oid).lean(),
    ]);

    if (!payslip) return res.status(404).json({ message: 'Payslip not found' });

    const snap = payslip.snapshot || {};
    const toEmail = await resolveToEmail(req, [
      snap.email,
      payslip.employee?.workEmail || payslip.employee?.email,
    ]);

    if (!toEmail) return res.status(400).json({ message: 'No email address found for this employee' });

    const { subject, html, text } = buildPayslipEmail({ payslip, company: company || {} });
    await buildSmtpTransporter().sendMail({ from: resolveMailSender('SMTP_FROM_EMAIL'), to: toEmail, subject, html, text });

    res.json({ sent: true, to: toEmail, subject });
  } catch (err) {
    console.error('[HR Email] send failed: %s', err?.message || err);
    res.status(500).json({ message: 'Email could not be sent. Check server email configuration.' });
  }
});

// POST /api/hr/emails/letter/:letterId
router.post('/letter/:letterId', async (req, res) => {
  try {
    if (!hasSmtpConfig()) return noSmtp(res);
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);

    const [letter, company] = await Promise.all([
      HRLetter.findOne({ _id: req.params.letterId, company: oid })
        .populate('employee', 'surname otherNames email workEmail')
        .lean(),
      Company.findById(oid).lean(),
    ]);

    if (!letter) return res.status(404).json({ message: 'Letter not found' });

    const emp = letter.employee || {};
    const toEmail = await resolveToEmail(req, [emp.workEmail, emp.email]);

    if (!toEmail) return res.status(400).json({ message: 'No email address found for this employee' });

    const { subject, html, text } = buildLetterEmail({ letter, company: company || {} });
    await buildSmtpTransporter().sendMail({ from: resolveMailSender('SMTP_FROM_EMAIL'), to: toEmail, subject, html, text });

    res.json({ sent: true, to: toEmail, subject });
  } catch (err) {
    console.error('[HR Email] send failed: %s', err?.message || err);
    res.status(500).json({ message: 'Email could not be sent. Check server email configuration.' });
  }
});

// POST /api/hr/emails/payroll-register  — send register to management
// body: { periodId, email }
router.post('/payroll-register', async (req, res) => {
  try {
    if (!hasSmtpConfig()) return noSmtp(res);
    const companyId = resolveCompanyId(req);
    const oid = new mongoose.Types.ObjectId(companyId);
    const { periodId, email: toEmail } = req.body || {};

    if (!toEmail) return res.status(400).json({ message: 'Recipient email is required' });
    if (!periodId) return res.status(400).json({ message: 'Period ID is required' });

    const [period, payslips, company] = await Promise.all([
      HRPayrollPeriod.findOne({ _id: periodId, company: oid }).lean(),
      HRPayslip.find({ payrollPeriod: periodId, company: oid }).lean(),
      Company.findById(oid).lean(),
    ]);

    if (!period) return res.status(404).json({ message: 'Payroll period not found' });

    const rows = payslips.map((p) => ({
      employeeNumber: p.snapshot?.employeeNumber || '',
      name: p.snapshot?.name || '',
      department: p.snapshot?.department || '',
      grossSalary: p.grossSalary || 0,
      totalDeductions: p.totalDeductions || 0,
      netSalary: p.netSalary || 0,
    }));

    const totals = rows.reduce((acc, r) => ({
      grossSalary: acc.grossSalary + r.grossSalary,
      totalDeductions: acc.totalDeductions + r.totalDeductions,
      netSalary: acc.netSalary + r.netSalary,
    }), { grossSalary: 0, totalDeductions: 0, netSalary: 0 });

    const { subject, html, text } = buildRegisterEmail({
      register: { period, rows, totals },
      company: company || {},
    });

    await buildSmtpTransporter().sendMail({ from: resolveMailSender('SMTP_FROM_EMAIL'), to: toEmail, subject, html, text });

    res.json({ sent: true, to: toEmail, subject });
  } catch (err) {
    console.error('[HR Email] send failed: %s', err?.message || err);
    res.status(500).json({ message: 'Email could not be sent. Check server email configuration.' });
  }
});

export default router;
