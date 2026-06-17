import mongoose from "mongoose";
import CarWashCommissionRule from "../models/CarWashCommissionRule.js";
import CarWashStaffCommission from "../models/CarWashStaffCommission.js";
import CarWashCommissionPayout from "../models/CarWashCommissionPayout.js";
import { resolveAuditActorUserId } from "../../../utils/systemActor.js";
import { createError } from "../../../utils/error.js";
import {
  postCarWashCommissionAccrual,
  reverseCarWashCommissionAccrual,
  cancelCarWashCommissionList,
} from "./carwashAccountingService.js";

const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const dayRange = (value = new Date()) => {
  const date = value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const start = new Date(safe);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const calculateAmount = ({ type, rate, baseAmount }) => {
  const normalizedType = String(type || "fixed").toLowerCase();
  const numericRate = Number(rate || 0);
  if (normalizedType === "percentage") return round2((Number(baseAmount || 0) * numericRate) / 100);
  return round2(numericRate);
};

// Resolve the best matching rule from a pre-loaded rule set (in-memory, no DB call).
// Priority scoring: specific-staff > specific-service > catch-all, then tiebreak by priority field.
const resolveRuleFromCache = (rules, serviceId, staffId) => {
  const svc  = serviceId ? String(serviceId) : null;
  const stf  = String(staffId);
  return rules
    .filter((r) =>
      (r.staff  === null || String(r.staff)  === stf) &&
      (r.service === null || String(r.service) === svc)
    )
    .map((r) => ({ ...r, score: (r.staff ? 4 : 0) + (r.service ? 2 : 0) + Number(r.priority || 0) / 1000 }))
    .sort((a, b) => b.score - a.score)[0] || null;
};

// Async wrapper kept for backward-compat callers that pass a single (business, service, staff) tuple.
const resolveCommissionRuleForLine = async (business, serviceId, staffId) => {
  const rules = await CarWashCommissionRule.find({ business, active: true }).lean();
  return resolveRuleFromCache(rules, serviceId, staffId);
};

// Exported for backward compat — used by commissions list controller
export const resolveCommissionRuleForJob = async (job = {}) => {
  if (!job?.business || !job?.assignedStaff) return null;
  const rawStaff = Array.isArray(job.assignedStaff) ? job.assignedStaff[0] : job.assignedStaff;
  const staffId = rawStaff?._id || rawStaff;
  if (!staffId) return null;
  return resolveCommissionRuleForLine(job.business, job.service || null, staffId);
};

// Build highest-amount-first allocation map for service lines.
// Returns a Set of serviceName values whose lines are fully covered by totalPaid.
export const buildPaidLineSet = (serviceLines, totalPaid) => {
  if (!Array.isArray(serviceLines) || !serviceLines.length) return null;
  // Sort descending by price so the most valuable service is covered first
  const sorted = [...serviceLines].sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  let remaining = round2(Number(totalPaid || 0));
  const paid = new Set();
  for (const line of sorted) {
    const price = Number(line.price || 0);
    if (remaining >= price - 0.01) {
      paid.add(line.serviceName);
      remaining = round2(remaining - price);
    }
  }
  return paid;
};

export const accrueCommissionForJob = async ({ req = null, job, paidLineSet = null }) => {
  if (!job || String(job.status || "").toLowerCase() !== "paid") return null;

  const rawStaff = Array.isArray(job.assignedStaff) ? job.assignedStaff : (job.assignedStaff ? [job.assignedStaff] : []);
  const jobStaffIds = rawStaff
    .map((s) => String(s?._id || s))
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

  const lines = Array.isArray(job.serviceLines) && job.serviceLines.length
    ? job.serviceLines
    : [{ service: job.service || null, serviceName: job.serviceName || "", vehicleType: job.vehicleType || "", price: Number(job.price || 0), lineStaff: null }];

  const [actorUserId, allRules] = await Promise.all([
    req ? resolveAuditActorUserId({ req, businessId: job.business }) : Promise.resolve(null),
    CarWashCommissionRule.find({ business: job.business, active: true }).lean(),
  ]);

  // Build per-staff commission breakdown respecting per-line staff assignment.
  // Rule: if a service line has lineStaff set → only that staff earns commission for that line (no split).
  //       if lineStaff is null → all job-level staff share the commission equally.
  const staffMap = new Map(); // staffId → { lineBreakdown[], totalAmount }

  for (const line of lines) {
    if (paidLineSet !== null && !paidLineSet.has(line.serviceName)) continue;

    // lineStaff is an array of staff assigned to this specific line.
    // If populated → only those staff earn commission (split among them).
    // If empty → fall back to job-level staff (backward compat).
    const lineStaffIds = Array.isArray(line.lineStaff) && line.lineStaff.length
      ? line.lineStaff.map(s => String(s?._id || s)).filter(id => mongoose.Types.ObjectId.isValid(id))
      : [];
    const recipients = lineStaffIds.length ? lineStaffIds : jobStaffIds;
    const splitCount = recipients.length;
    if (!splitCount) continue;

    for (const staffId of recipients) {
      const rule = resolveRuleFromCache(allRules, line.service || null, staffId);
      if (!rule || Number(rule.rate || 0) <= 0) continue;

      const totalLineCommission = calculateAmount({ type: rule.commissionType, rate: rule.rate, baseAmount: Number(line.price || 0) });
      const perStaffAmount = round2(totalLineCommission / splitCount);
      if (perStaffAmount <= 0) continue;

      if (!staffMap.has(staffId)) staffMap.set(staffId, { lineBreakdown: [], totalAmount: 0 });
      const entry = staffMap.get(staffId);
      entry.lineBreakdown.push({
        service: line.service || null,
        serviceName: line.serviceName || "",
        linePrice: Number(line.price || 0),
        commissionType: rule.commissionType,
        commissionRate: Number(rule.rate || 0),
        lineCommissionAmount: perStaffAmount,
        rule: rule._id,
      });
      entry.totalAmount = round2(entry.totalAmount + perStaffAmount);
    }
  }

  // Cancel commissions for staff no longer receiving anything from this job
  const allRelevantIds = new Set([...jobStaffIds, ...staffMap.keys()]);
  const activeComms = await CarWashStaffCommission.find({
    business: job.business,
    job: job._id,
    status: { $in: ["earned", "payable"] },
  });
  const removedStaffComms = activeComms.filter((c) => !allRelevantIds.has(String(c.staff)));
  if (removedStaffComms.length) {
    await cancelCarWashCommissionList({
      req,
      businessId: job.business,
      commissions: removedStaffComms,
      reason: "Cancelled because the staff member was removed from the Car Wash job.",
    });
  }

  if (!staffMap.size) return null;
  const results = [];

  for (const [staffId, { lineBreakdown, totalAmount }] of staffMap) {
    if (!lineBreakdown.length || totalAmount <= 0) continue;

    const firstLine = lineBreakdown[0];
    const newFields = {
      service: firstLine.service || null,
      rule: firstLine.rule || null,
      jobNumber: job.jobNumber || "",
      serviceName: lineBreakdown.length === 1 ? firstLine.serviceName : `${firstLine.serviceName} +${lineBreakdown.length - 1} more`,
      baseAmount: round2(lines.reduce((s, l) => s + Number(l.price || 0), 0)),
      commissionType: firstLine.commissionType,
      commissionRate: firstLine.commissionRate,
      commissionAmount: totalAmount,
      lineBreakdown,
      updatedBy: actorUserId,
    };

    const existing = await CarWashStaffCommission.findOne({
      business: job.business,
      job: job._id,
      staff: staffId,
    });

    if (existing) {
      if (existing.status === "paid") {
        results.push(existing);
        continue;
      }

      const amountChanged = Math.abs(Number(existing.commissionAmount || 0) - totalAmount) > 0.01;
      const hasActiveLedger = existing.status !== "cancelled" &&
        Array.isArray(existing.accrualLedgerEntries) &&
        existing.accrualLedgerEntries.length > 0;

      if (amountChanged && hasActiveLedger) {
        await reverseCarWashCommissionAccrual({ req, commission: existing });
      }

      Object.assign(existing, newFields);

      if (existing.status === "cancelled") {
        existing.status = job.paymentStatus === "paid" ? "payable" : "earned";
        existing.earnedAt = existing.earnedAt || new Date();
      }
      if (existing.status !== "paid" && existing.status !== "payable" && job.paymentStatus === "paid") {
        existing.status = "payable";
        existing.payableAt = existing.payableAt || new Date();
      }

      await existing.save();
      if (existing.status !== "cancelled") {
        await postCarWashCommissionAccrual({ req, commission: existing }).catch((err) =>
          console.error("[CW Commission] Accrual post failed commission=%s: %s", existing._id, err?.message || err)
        );
      }
      results.push(existing);
    } else {
      const commission = await CarWashStaffCommission.create({
        business: job.business,
        branch: job.branch || null,
        job: job._id,
        staff: staffId,
        ...newFields,
        status: job.paymentStatus === "paid" ? "payable" : "earned",
        earnedAt: new Date(),
        payableAt: job.paymentStatus === "paid" ? new Date() : null,
        createdBy: actorUserId,
      });
      await postCarWashCommissionAccrual({ req, commission }).catch((err) =>
        console.error("[CW Commission] Accrual post failed commission=%s: %s", commission._id, err?.message || err)
      );
      results.push(commission);
    }
  }

  return results.length ? results : null;
};

export const markJobCommissionsPayable = async ({ business, jobId }) => {
  await CarWashStaffCommission.updateMany(
    { business, job: jobId, status: "earned" },
    { $set: { status: "payable", payableAt: new Date() } }
  );
};

export const handleJobPaymentStatusAfterPaymentChange = async ({ business, job, checkOnly = false }) => {
  if (!business || !job?._id) return;
  if (String(job.paymentStatus || "").toLowerCase() === "paid") {
    if (checkOnly) return;
    await markJobCommissionsPayable({ business, jobId: job._id });
    return;
  }

  const paidCommission = await CarWashStaffCommission.findOne({
    business,
    job: job._id,
    status: "paid",
  }).select("_id payout jobNumber");
  if (paidCommission) {
    throw createError(400, "Cannot delete this payment because staff commission has already been paid out.");
  }
  if (checkOnly) return;

  await CarWashStaffCommission.updateMany(
    { business, job: job._id, status: "payable" },
    { $set: { status: "earned", payableAt: null } }
  );
};

export const cancelJobCommissions = async ({
  req = null,
  business,
  jobId,
  excludeStaff = null,
  reason = "Cancelled because the Car Wash job was cancelled.",
}) => {
  const filter = {
    business,
    job: jobId,
    status: { $in: ["earned", "payable"] },
  };
  if (excludeStaff) filter.staff = { $ne: excludeStaff };
  const commissions = await CarWashStaffCommission.find(filter);
  await cancelCarWashCommissionList({ req, businessId: business, commissions, reason });
};

export const generatePayoutNumber = async (business) => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CWP-${stamp}-`;
  const latest = await CarWashCommissionPayout.findOne(
    { business, payoutNumber: { $regex: `^${prefix}` } },
    { payoutNumber: 1 },
    { sort: { payoutNumber: -1 } }
  ).lean();
  const nextNum = latest ? parseInt(latest.payoutNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
};

// dayRange re-exported for any callers that imported it from here
export { dayRange };
