import express from 'express';
import mongoose from 'mongoose';
import { verifyUser, requireCompanyModule } from '../../../controllers/verifyToken.js';
import HRAttendance from '../models/HRAttendance.js';
import HREmployee from '../models/HREmployee.js';
import { resolveCompanyId, currentUserId, parsePage, parseLimit, requireOid, toOid } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser, requireCompanyModule('hr'));

// GET /api/hr/attendance?employee=&month=&year=&date=&page=&limit=
router.get('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { employee, month, year, date, page, limit } = req.query;
    const safePage  = parsePage(page);
    const safeLimit = parseLimit(limit, 50);

    const query = { company: companyId };
    const empOid = toOid(employee);
    if (empOid) query.employee = empOid;

    if (date) {
      query.date = date; // exact YYYY-MM-DD
    } else if (month && year) {
      const y = Number(year);
      const m = Number(month) - 1;
      const from = new Date(y, m, 1);
      const to   = new Date(y, m + 1, 0, 23, 59, 59);
      query.checkIn = { $gte: from, $lte: to };
    } else if (year) {
      query.checkIn = {
        $gte: new Date(Number(year), 0, 1),
        $lte: new Date(Number(year), 11, 31, 23, 59, 59),
      };
    }

    const [records, total] = await Promise.all([
      HRAttendance.find(query)
        .sort({ checkIn: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .populate('employee', 'surname otherNames employeeNumber department')
        .lean(),
      HRAttendance.countDocuments(query),
    ]);

    res.json({ records, total, totalPages: Math.ceil(total / safeLimit), currentPage: safePage });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /api/hr/attendance  — manual admin entry
router.post('/', async (req, res) => {
  try {
    const companyId = resolveCompanyId(req);
    const { employee, date, checkIn, checkOut, note } = req.body;

    if (!employee)  return res.status(400).json({ message: 'Employee is required' });
    if (!date)      return res.status(400).json({ message: 'Date is required' });
    if (!checkIn)   return res.status(400).json({ message: 'Check-in time is required' });
    if (!toOid(employee)) return res.status(400).json({ message: 'Invalid employee ID' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Date must be YYYY-MM-DD' });

    const emp = await HREmployee.findOne({ _id: employee, company: companyId }).lean();
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const checkInDate  = new Date(checkIn);
    const checkOutDate = checkOut ? new Date(checkOut) : null;
    if (isNaN(checkInDate.getTime())) return res.status(400).json({ message: 'Invalid check-in time' });
    if (checkOutDate && isNaN(checkOutDate.getTime())) return res.status(400).json({ message: 'Invalid check-out time' });
    if (checkOutDate && checkOutDate <= checkInDate) {
      return res.status(400).json({ message: 'Check-out must be after check-in' });
    }

    const duration = checkOutDate ? Math.round((checkOutDate - checkInDate) / 60000) : null;

    const record = await HRAttendance.create({
      company:  companyId,
      employee,
      date,
      checkIn:  checkInDate,
      checkOut: checkOutDate,
      duration,
      note:     String(note || '').trim(),
      source:   'admin',
    });

    await record.populate('employee', 'surname otherNames employeeNumber');
    res.status(201).json(record);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Attendance record already exists for this employee on this date' });
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /api/hr/attendance/:id  — edit an existing record
router.patch('/:id', async (req, res) => {
  try {
    requireOid(req.params.id, 'attendance ID');
    const companyId = resolveCompanyId(req);
    const record = await HRAttendance.findOne({ _id: req.params.id, company: companyId });
    if (!record) return res.status(404).json({ message: 'Attendance record not found' });

    const { checkIn, checkOut, note } = req.body;

    if (checkIn !== undefined) {
      const d = new Date(checkIn);
      if (isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid check-in time' });
      record.checkIn = d;
    }
    if (checkOut !== undefined) {
      if (checkOut === null || checkOut === '') {
        record.checkOut = null;
        record.duration = null;
      } else {
        const d = new Date(checkOut);
        if (isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid check-out time' });
        if (d <= record.checkIn) return res.status(400).json({ message: 'Check-out must be after check-in' });
        record.checkOut = d;
        record.duration = Math.round((d - record.checkIn) / 60000);
      }
    }
    if (note !== undefined) record.note = String(note).trim();

    await record.save();
    await record.populate('employee', 'surname otherNames employeeNumber');
    res.json(record);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// DELETE /api/hr/attendance/:id
router.delete('/:id', async (req, res) => {
  try {
    requireOid(req.params.id, 'attendance ID');
    const companyId = resolveCompanyId(req);
    const record = await HRAttendance.findOne({ _id: req.params.id, company: companyId });
    if (!record) return res.status(404).json({ message: 'Attendance record not found' });
    await record.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

export default router;
