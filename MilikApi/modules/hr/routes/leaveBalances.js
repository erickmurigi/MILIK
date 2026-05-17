import express from 'express';
import mongoose from 'mongoose';
import { verifyUser } from '../../../controllers/verifyToken.js';
import HREmployee from '../models/HREmployee.js';
import HRLeaveType from '../models/HRLeaveType.js';
import HRLeaveApplication from '../models/HRLeaveApplication.js';
import { resolveCompanyId } from '../services/hrScope.js';

const router = express.Router();
router.use(verifyUser);

// GET /api/hr/leave-balances?year=&departmentId=&leaveTypeId=
router.get('/', async (req, res) => {
  try {
    const companyId   = resolveCompanyId(req);
    const companyOid  = new mongoose.Types.ObjectId(companyId);
    const yr          = Math.max(2000, Math.min(2100, Number(req.query.year) || new Date().getFullYear()));
    const { departmentId, leaveTypeId } = req.query;

    const startOfYear = new Date(`${yr}-01-01T00:00:00.000Z`);
    const endOfYear   = new Date(`${yr}-12-31T23:59:59.999Z`);

    // Employees (active / probation / suspended — not terminated)
    const empQuery = { company: companyId, status: { $ne: 'Terminated' } };
    if (departmentId) empQuery.department = new mongoose.Types.ObjectId(departmentId);

    // Leave types
    const ltQuery = { company: companyId, isActive: true, daysPerYear: { $gt: 0 } };
    if (leaveTypeId) ltQuery._id = new mongoose.Types.ObjectId(leaveTypeId);

    const [employees, leaveTypes] = await Promise.all([
      HREmployee.find(empQuery)
        .populate('department', 'name')
        .sort({ surname: 1, otherNames: 1 })
        .lean(),
      HRLeaveType.find(ltQuery).sort({ name: 1 }).lean(),
    ]);

    if (!employees.length || !leaveTypes.length) return res.json([]);

    const empIds = employees.map((e) => e._id);
    const ltIds  = leaveTypes.map((t) => t._id);

    // Aggregate approved and pending usage in one query
    const usageAgg = await HRLeaveApplication.aggregate([
      {
        $match: {
          company:   companyOid,
          employee:  { $in: empIds },
          leaveType: { $in: ltIds },
          startDate: { $gte: startOfYear, $lte: endOfYear },
          status:    { $in: ['Approved', 'Pending', 'Draft'] },
        },
      },
      {
        $group: {
          _id:     { employee: '$employee', leaveType: '$leaveType', status: '$status' },
          days:    { $sum: '$days' },
        },
      },
    ]);

    // Build lookup:  empId_ltId => { used, pending }
    const map = {};
    for (const { _id, days } of usageAgg) {
      const key = `${_id.employee}_${_id.leaveType}`;
      if (!map[key]) map[key] = { used: 0, pending: 0 };
      if (_id.status === 'Approved') map[key].used    += days;
      else                            map[key].pending += days;
    }

    const rows = [];
    for (const emp of employees) {
      for (const lt of leaveTypes) {
        const key       = `${emp._id}_${lt._id}`;
        const usage     = map[key] || { used: 0, pending: 0 };
        const entitlement = lt.daysPerYear || 0;
        rows.push({
          employeeId:     emp._id,
          employeeName:   `${emp.surname} ${emp.otherNames}`,
          employeeNumber: emp.employeeNumber || '',
          department:     emp.department?.name || '—',
          leaveTypeId:    lt._id,
          leaveTypeName:  lt.name,
          isPaid:         lt.isPaid,
          entitlement,
          used:           usage.used,
          pending:        usage.pending,
          remaining:      Math.max(0, entitlement - usage.used),
        });
      }
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
