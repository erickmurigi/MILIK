import mongoose from 'mongoose';
import Zone from '../../models/Zone.js';
import Property from '../../models/Property.js';
import User from '../../models/User.js';
import Unit from '../../models/Unit.js';
import Tenant from '../../models/Tenant.js';
import TenantInvoice from '../../models/TenantInvoice.js';
import RentPayment from '../../models/RentPayment.js';
import { getFieldOfficerPropertyIds } from '../../utils/fieldOfficerScope.js';
import { resolveBusinessId } from '../../utils/requestContext.js';
import { createError } from '../../utils/error.js';

const requireAdmin = (req, next) => {
  if (req.user?.isSystemAdmin || req.user?.superAdminAccess || req.user?.adminAccess) return false;
  next(createError(403, 'Admin access required'));
  return true;
};

const toId = (v) => new mongoose.Types.ObjectId(String(v));

const generateZoneCode = async (companyId) => {
  const result = await Zone.aggregate([
    { $match: { company: toId(companyId), code: { $regex: /^ZN-\d+$/ } } },
    { $addFields: { num: { $toInt: { $substr: ['$code', 3, -1] } } } },
    { $group: { _id: null, max: { $max: '$num' } } },
  ]);
  const seq = (result[0]?.max ?? 0) + 1;
  return `ZN-${String(seq).padStart(3, '0')}`;
};

// GET /api/zones
export const getZones = async (req, res, next) => {
  try {
    const companyId = resolveBusinessId(req);
    if (!companyId) return next(createError(400, 'Company context required'));

    const { search, type, isActive, page = 1, limit = 100 } = req.query;

    const match = { company: toId(companyId) };
    if (type) match.type = type;
    if (isActive !== undefined) match.isActive = isActive === 'true';
    if (search) match.$or = [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];

    const pageNum  = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const skip     = (pageNum - 1) * limitNum;

    const [zones, total] = await Promise.all([
      Zone.find(match)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum)
        .populate('fieldOfficers', 'surname otherNames email profile')
        .populate('supervisors',   'surname otherNames email profile')
        .lean(),
      Zone.countDocuments(match),
    ]);

    // attach property count per zone — properties store zone as zoneRegion (name string)
    const zoneNamesLower = zones.map((z) => z.name.toLowerCase());
    const propCounts = await Property.aggregate([
      { $match: { business: toId(companyId), zoneRegion: { $exists: true, $nin: [null, ''] } } },
      { $addFields: { _zrLower: { $toLower: '$zoneRegion' } } },
      { $match: { _zrLower: { $in: zoneNamesLower } } },
      { $group: { _id: '$_zrLower', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(propCounts.map((r) => [r._id, r.count]));

    const enriched = zones.map((z) => ({
      ...z,
      propertyCount:    countMap[z.name.toLowerCase()] || 0,
      fieldOfficerCount: (z.fieldOfficers || []).length,
    }));

    return res.json({ zones: enriched, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) {
    next(err);
  }
};

// GET /api/zones/:id
export const getZone = async (req, res, next) => {
  try {
    const companyId = resolveBusinessId(req);
    const zone = await Zone.findOne({ _id: req.params.id, company: toId(companyId) })
      .populate('fieldOfficers', 'surname otherNames email profile')
      .populate('supervisors',   'surname otherNames email profile')
      .lean();
    if (!zone) return next(createError(404, 'Zone not found'));
    return res.json(zone);
  } catch (err) {
    next(err);
  }
};

// POST /api/zones
export const createZone = async (req, res, next) => {
  if (requireAdmin(req, next)) return;
  try {
    const companyId = resolveBusinessId(req);
    if (!companyId) return next(createError(400, 'Company context required'));

    const { name, code, description, type, color, fieldOfficers = [], supervisors = [] } = req.body;

    if (!name?.trim()) return next(createError(400, 'Zone name is required'));

    const duplicate = await Zone.findOne({
      company: toId(companyId),
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
    });
    if (duplicate) return next(createError(409, `A zone named "${name.trim()}" already exists`));

    const resolvedCode = code?.trim()
      ? code.trim().toUpperCase()
      : await generateZoneCode(companyId);

    const codeConflict = await Zone.findOne({ company: toId(companyId), code: resolvedCode });
    if (codeConflict) return next(createError(409, `Zone code "${resolvedCode}" is already in use`));

    const zone = await Zone.create({
      company:       toId(companyId),
      name:          name.trim(),
      code:          resolvedCode,
      description:   description?.trim() || '',
      type:          type || 'geographic',
      color:         color || '#0B3B2E',
      fieldOfficers: fieldOfficers.filter((id) => mongoose.Types.ObjectId.isValid(id)),
      supervisors:   supervisors.filter((id) => mongoose.Types.ObjectId.isValid(id)),
      createdBy:     req.user?._id || null,
    });

    const populated = await Zone.findById(zone._id)
      .populate('fieldOfficers', 'surname otherNames email profile')
      .populate('supervisors',   'surname otherNames email profile')
      .lean();

    return res.status(201).json(populated);
  } catch (err) {
    next(err);
  }
};

// PUT /api/zones/:id
export const updateZone = async (req, res, next) => {
  if (requireAdmin(req, next)) return;
  try {
    const companyId = resolveBusinessId(req);
    const zone = await Zone.findOne({ _id: req.params.id, company: toId(companyId) });
    if (!zone) return next(createError(404, 'Zone not found'));

    const { name, code, description, type, color, fieldOfficers, supervisors, isActive } = req.body;

    if (name !== undefined) {
      const trimmed = name.trim();
      const duplicate = await Zone.findOne({
        company: toId(companyId),
        name: { $regex: `^${trimmed}$`, $options: 'i' },
        _id: { $ne: zone._id },
      });
      if (duplicate) return next(createError(409, `A zone named "${trimmed}" already exists`));
      zone.name = trimmed;
    }

    if (code !== undefined) {
      const upper = code.trim().toUpperCase();
      const codeConflict = await Zone.findOne({
        company: toId(companyId),
        code: upper,
        _id: { $ne: zone._id },
      });
      if (codeConflict) return next(createError(409, `Zone code "${upper}" is already in use`));
      zone.code = upper;
    }

    if (description !== undefined) zone.description = description.trim();
    if (type        !== undefined) zone.type         = type;
    if (color       !== undefined) zone.color        = color;
    if (isActive    !== undefined) zone.isActive     = Boolean(isActive);
    if (Array.isArray(fieldOfficers))
      zone.fieldOfficers = fieldOfficers.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (Array.isArray(supervisors))
      zone.supervisors = supervisors.filter((id) => mongoose.Types.ObjectId.isValid(id));

    await zone.save();

    const populated = await Zone.findById(zone._id)
      .populate('fieldOfficers', 'surname otherNames email profile')
      .populate('supervisors',   'surname otherNames email profile')
      .lean();

    return res.json(populated);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/zones/:id
export const deleteZone = async (req, res, next) => {
  if (requireAdmin(req, next)) return;
  try {
    const companyId = resolveBusinessId(req);
    const zone = await Zone.findOne({ _id: req.params.id, company: toId(companyId) });
    if (!zone) return next(createError(404, 'Zone not found'));

    const propCount = await Property.countDocuments({
      business: toId(companyId),
      zoneRegion: { $regex: `^${zone.name.trim()}$`, $options: 'i' },
    });

    if (propCount > 0) {
      return next(createError(409, `Cannot delete zone "${zone.name}" — it has ${propCount} propert${propCount === 1 ? 'y' : 'ies'} assigned. Reassign them first.`));
    }

    await zone.deleteOne();
    return res.json({ message: 'Zone deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// GET /api/zones/officers — users in this company eligible as field officers
export const getEligibleOfficers = async (req, res, next) => {
  if (requireAdmin(req, next)) return;
  try {
    const companyId = resolveBusinessId(req);
    if (!companyId) return next(createError(400, 'Company context required'));

    const users = await User.find({
      $or: [
        { company: toId(companyId) },
        { accessibleCompanies: toId(companyId) },
        { 'companyAssignments.company': toId(companyId) },
      ],
      isActive: { $ne: false },
      locked:   { $ne: true },
    })
      .select('surname otherNames email profile')
      .sort({ surname: 1, otherNames: 1 })
      .limit(500)
      .lean();

    return res.json({ users });
  } catch (err) {
    next(err);
  }
};

// ── helpers shared by report endpoints ───────────────────────────────────────
const parseReportDate = (value, endOfDay = false) => {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return new Date();
  endOfDay ? d.setHours(23, 59, 59, 999) : d.setHours(0, 0, 0, 0);
  return d;
};

// GET /api/zones/reports/collection?startDate=&endDate=
export const getZoneCollectionReport = async (req, res, next) => {
  try {
    const companyId = resolveBusinessId(req);
    if (!companyId) return next(createError(400, 'Company context required'));

    const start = parseReportDate(req.query.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const end   = parseReportDate(req.query.endDate, true);

    const [zones, properties, units] = await Promise.all([
      Zone.find({ company: toId(companyId), isActive: true }).sort({ name: 1 }).lean(),
      Property.find({ business: toId(companyId) }, { _id: 1, zoneRegion: 1, propertyName: 1 }).lean(),
      Unit.find({ business: toId(companyId) }, { _id: 1, property: 1 }).lean(),
    ]);

    const propById     = Object.fromEntries(properties.map((p) => [String(p._id), p]));
    const unitPropMap  = Object.fromEntries(units.map((u) => [String(u._id), String(u.property)]));
    const zoneKeyMap   = Object.fromEntries(zones.map((z) => [z.name.toLowerCase(), z]));

    const [invoiceAgg, payments] = await Promise.all([
      TenantInvoice.aggregate([
        {
          $match: {
            business: toId(companyId),
            status: { $nin: ['cancelled', 'reversed'] },
            $or: [
              { bookingDate: { $gte: start, $lte: end } },
              { bookingDate: { $exists: false }, invoiceDate: { $gte: start, $lte: end } },
              { bookingDate: null, invoiceDate: { $gte: start, $lte: end } },
            ],
          },
        },
        { $group: { _id: '$property', expected: { $sum: '$amount' } } },
      ]),
      RentPayment.find(
        { business: toId(companyId), paymentDate: { $gte: start, $lte: end } },
        { amount: 1, unit: 1 }
      ).lean(),
    ]);

    const expectedByProp  = Object.fromEntries(invoiceAgg.map((r) => [String(r._id), Number(r.expected) || 0]));
    const collectedByProp = {};
    payments.forEach((p) => {
      const pid = unitPropMap[String(p.unit)];
      if (pid) collectedByProp[pid] = (collectedByProp[pid] || 0) + (Number(p.amount) || 0);
    });

    const zoneData = Object.fromEntries(zones.map((z) => [String(z._id), { zone: z, expected: 0, collected: 0, propertyCount: 0 }]));

    properties.forEach((prop) => {
      const zone = zoneKeyMap[(prop.zoneRegion || '').toLowerCase()];
      if (!zone) return;
      const zd  = zoneData[String(zone._id)];
      const pid = String(prop._id);
      zd.expected   += expectedByProp[pid]   || 0;
      zd.collected  += collectedByProp[pid]  || 0;
      zd.propertyCount++;
    });

    const rows = Object.values(zoneData).map(({ zone, expected, collected, propertyCount }) => ({
      zoneId:         zone._id,
      zoneName:       zone.name,
      zoneCode:       zone.code,
      zoneColor:      zone.color,
      expected,
      collected,
      outstanding:    Math.max(expected - collected, 0),
      collectionRate: expected > 0 ? Math.round((collected / expected) * 1000) / 10 : null,
      propertyCount,
    }));

    const totals = rows.reduce((acc, r) => ({
      expected:    acc.expected    + r.expected,
      collected:   acc.collected   + r.collected,
      outstanding: acc.outstanding + r.outstanding,
    }), { expected: 0, collected: 0, outstanding: 0 });
    totals.collectionRate = totals.expected > 0
      ? Math.round((totals.collected / totals.expected) * 1000) / 10 : null;

    return res.json({ rows, totals, period: { startDate: start, endDate: end } });
  } catch (err) {
    next(err);
  }
};

// GET /api/zones/reports/arrears
export const getZoneArrearsReport = async (req, res, next) => {
  try {
    const companyId = resolveBusinessId(req);
    if (!companyId) return next(createError(400, 'Company context required'));

    const [zones, properties, units, tenants] = await Promise.all([
      Zone.find({ company: toId(companyId), isActive: true }).sort({ name: 1 }).lean(),
      Property.find({ business: toId(companyId) }, { _id: 1, zoneRegion: 1, propertyName: 1 }).lean(),
      Unit.find({ business: toId(companyId) }, { _id: 1, property: 1, unitNumber: 1 }).lean(),
      Tenant.find(
        { business: toId(companyId), balance: { $gt: 0 }, status: { $in: ['active', 'overdue', 'inactive'] } },
        { name: 1, balance: 1, unit: 1, rent: 1, status: 1, phone: 1, email: 1 }
      ).lean(),
    ]);

    const propById   = Object.fromEntries(properties.map((p) => [String(p._id), p]));
    const unitById   = Object.fromEntries(units.map((u) => [String(u._id), u]));
    const zoneKeyMap = Object.fromEntries(zones.map((z) => [z.name.toLowerCase(), z]));

    const rows = tenants.map((t) => {
      const unit  = unitById[String(t.unit)];
      const prop  = unit ? propById[String(unit.property)] : null;
      const zr    = prop?.zoneRegion || '';
      const zone  = zoneKeyMap[zr.toLowerCase()];
      return {
        tenantId:     t._id,
        tenantName:   t.name,
        tenantPhone:  t.phone || '',
        tenantStatus: t.status,
        balance:      Number(t.balance) || 0,
        rent:         Number(t.rent) || 0,
        unitNumber:   unit?.unitNumber || '—',
        propertyName: prop?.propertyName || '—',
        zoneName:     zone?.name || 'Unassigned',
        zoneCode:     zone?.code || '—',
        zoneColor:    zone?.color || '#94a3b8',
        zoneId:       zone?._id || null,
      };
    }).sort((a, b) => a.zoneName.localeCompare(b.zoneName) || b.balance - a.balance);

    const summaryMap = {};
    rows.forEach((r) => {
      if (!summaryMap[r.zoneName]) {
        summaryMap[r.zoneName] = { zoneName: r.zoneName, zoneCode: r.zoneCode, zoneColor: r.zoneColor, zoneId: r.zoneId, totalArrears: 0, tenantCount: 0 };
      }
      summaryMap[r.zoneName].totalArrears += r.balance;
      summaryMap[r.zoneName].tenantCount++;
    });

    const zoneSummary   = Object.values(summaryMap).sort((a, b) => b.totalArrears - a.totalArrears);
    const totalArrears  = rows.reduce((s, r) => s + r.balance, 0);

    return res.json({ rows, zoneSummary, totalArrears, tenantCount: rows.length });
  } catch (err) {
    next(err);
  }
};

// GET /api/zones/reports/vacancy
export const getZoneVacancyReport = async (req, res, next) => {
  try {
    const companyId = resolveBusinessId(req);
    if (!companyId) return next(createError(400, 'Company context required'));

    const foPropertyIds = await getFieldOfficerPropertyIds(req);
    const foSet = foPropertyIds !== null ? new Set(foPropertyIds.map(String)) : null;

    const [zones, properties, allUnits] = await Promise.all([
      Zone.find({ company: toId(companyId), isActive: true }).sort({ name: 1 }).lean(),
      foSet
        ? Property.find({ business: toId(companyId), _id: { $in: foPropertyIds } }, { _id: 1, zoneRegion: 1, propertyName: 1 }).lean()
        : Property.find({ business: toId(companyId) }, { _id: 1, zoneRegion: 1, propertyName: 1 }).lean(),
      foSet
        ? Unit.find(
            { business: toId(companyId), status: { $ne: 'archived' }, property: { $in: foPropertyIds } },
            { _id: 1, property: 1, unitNumber: 1, unitType: 1, status: 1, rent: 1, vacantSince: 1, daysVacant: 1 }
          ).lean()
        : Unit.find(
            { business: toId(companyId), status: { $ne: 'archived' } },
            { _id: 1, property: 1, unitNumber: 1, unitType: 1, status: 1, rent: 1, vacantSince: 1, daysVacant: 1 }
          ).lean(),
    ]);

    const propById   = Object.fromEntries(properties.map((p) => [String(p._id), p]));
    const zoneKeyMap = Object.fromEntries(zones.map((z) => [z.name.toLowerCase(), z]));
    const today      = new Date();

    const zoneTotals = {};
    const vacantRows = [];

    allUnits.forEach((u) => {
      const prop = propById[String(u.property)];
      if (!prop) return;
      const zr   = prop.zoneRegion || '';
      const zone = zoneKeyMap[zr.toLowerCase()];
      const key  = zone?.name || 'Unassigned';

      if (!zoneTotals[key]) {
        zoneTotals[key] = { zoneName: key, zoneCode: zone?.code || '—', zoneColor: zone?.color || '#94a3b8', zoneId: zone?._id || null, totalUnits: 0, vacantUnits: 0, potentialRent: 0 };
      }
      zoneTotals[key].totalUnits++;

      if (u.status === 'vacant') {
        const vs         = u.vacantSince ? new Date(u.vacantSince) : null;
        const daysVacant = vs ? Math.floor((today - vs) / 86400000) : (u.daysVacant || 0);
        zoneTotals[key].vacantUnits++;
        zoneTotals[key].potentialRent += Number(u.rent) || 0;
        vacantRows.push({
          unitId:       u._id,
          unitNumber:   u.unitNumber,
          unitType:     u.unitType || '—',
          rent:         Number(u.rent) || 0,
          vacantSince:  vs,
          daysVacant,
          propertyName: prop.propertyName,
          propertyId:   prop._id,
          zoneName:     key,
          zoneCode:     zone?.code || '—',
          zoneColor:    zone?.color || '#94a3b8',
          zoneId:       zone?._id || null,
        });
      }
    });

    vacantRows.sort((a, b) => a.zoneName.localeCompare(b.zoneName) || b.daysVacant - a.daysVacant);

    const zoneSummary = Object.values(zoneTotals).map((z) => ({
      ...z,
      vacancyRate:   z.totalUnits > 0 ? Math.round((z.vacantUnits / z.totalUnits) * 1000) / 10 : 0,
      occupancyRate: z.totalUnits > 0 ? Math.round(((z.totalUnits - z.vacantUnits) / z.totalUnits) * 1000) / 10 : 100,
    })).sort((a, b) => b.vacantUnits - a.vacantUnits);

    const totalPotentialRent = vacantRows.reduce((s, r) => s + r.rent, 0);

    return res.json({
      rows: vacantRows,
      zoneSummary,
      totalVacant:         vacantRows.length,
      totalUnits:          allUnits.length,
      totalPotentialRent,
    });
  } catch (err) {
    next(err);
  }
};
