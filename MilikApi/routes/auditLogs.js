import express from "express";
import AuditLog from "../models/AuditLog.js";
import User from "../models/User.js";
import RentPayment from "../models/RentPayment.js";
import Tenant from "../models/Tenant.js";
import { verifyUser } from "../controllers/verifyToken.js";

const router = express.Router();

const isSystemAdmin = (user = {}) => Boolean(user?.isSystemAdmin || user?.superAdminAccess);
const actorName = (user = {}) =>
  [user?.surname, user?.otherNames].filter(Boolean).join(" ").trim() ||
  user?.email ||
  "System";

const receiptName = (payment = {}) => payment?.receiptNumber || payment?.referenceNumber || String(payment?._id || "receipt");

const canViewCompanyAudit = (user = {}, companyId = "") => {
  if (isSystemAdmin(user)) return true;
  if (!companyId) return false;
  const assignedIds = [
    user?.company?._id || user?.company,
    user?.primaryCompany?._id || user?.primaryCompany,
    ...(Array.isArray(user?.accessibleCompanies) ? user.accessibleCompanies.map((item) => item?._id || item) : []),
    ...(Array.isArray(user?.companyAssignments) ? user.companyAssignments.map((item) => item?.company?._id || item?.company) : []),
  ].filter(Boolean).map(String);

  const hasAdminRole = Boolean(user?.adminAccess || user?.setupAccess || user?.companySetupAccess || user?.userControl);
  return hasAdminRole && assignedIds.includes(String(companyId));
};

const shouldIncludeCategory = (categoryFilter, category) =>
  categoryFilter === "all" || categoryFilter === category;

const shouldIncludeSeverity = (severityFilter, severity) =>
  severityFilter === "all" || severityFilter === severity;

const buildDerivedCriticalEvents = async ({ companyId, category, severity, limit }) => {
  const events = [];

  if (shouldIncludeCategory(category, "finance") && shouldIncludeSeverity(severity, "critical")) {
    const reversedReceipts = await RentPayment.find({
      business: companyId,
      isReversed: true,
      reversedAt: { $ne: null },
    })
      .populate("reversedBy", "surname otherNames email")
      .populate("tenant", "name tenantCode")
      .sort({ reversedAt: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    reversedReceipts.forEach((payment) => {
      events.push({
        _id: `derived-receipt-reversal-${payment._id}`,
        company: companyId,
        actor: payment.reversedBy?._id || null,
        actorName: actorName(payment.reversedBy),
        actorEmail: payment.reversedBy?.email || "",
        action: "receipts.reverse",
        category: "finance",
        severity: "critical",
        targetType: "Receipt",
        targetId: String(payment._id),
        targetName: receiptName(payment),
        message: `Reversed receipt ${receiptName(payment)}`,
        metadata: {
          source: "receipt_record",
          amount: payment.amount,
          reason: payment.reversalReason || "",
          tenant: payment.tenant?.name || payment.tenant?.tenantCode || payment.tenant || "",
          reversalEntry: payment.reversalEntry || null,
        },
        createdAt: payment.reversedAt || payment.updatedAt,
        updatedAt: payment.updatedAt,
      });
    });
  }

  if (shouldIncludeCategory(category, "property") && shouldIncludeSeverity(severity, "critical")) {
    const terminatedTenants = await Tenant.find({
      business: companyId,
      status: { $in: ["terminated", "moved_out"] },
      $or: [{ terminationDate: { $ne: null } }, { moveOutDate: { $ne: null } }],
    })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    terminatedTenants.forEach((tenant) => {
      events.push({
        _id: `derived-tenant-termination-${tenant._id}`,
        company: companyId,
        actor: null,
        actorName: "System",
        actorEmail: "",
        action: "tenants.terminate",
        category: "property",
        severity: "critical",
        targetType: "Tenant",
        targetId: String(tenant._id),
        targetName: tenant.name || tenant.tenantCode || String(tenant._id),
        message: `Terminated tenant ${tenant.name || tenant.tenantCode || tenant._id}`,
        metadata: {
          source: "tenant_record",
          terminationDate: tenant.terminationDate || tenant.moveOutDate || null,
          terminationReason: tenant.terminationReason || "",
          depositRefundAmount: tenant.depositRefundAmount || 0,
          depositRefundStatus: tenant.depositRefundStatus || "",
          unit: tenant.unit || null,
        },
        createdAt: tenant.updatedAt || tenant.terminationDate || tenant.moveOutDate,
        updatedAt: tenant.updatedAt,
      });
    });

    const transferredTenants = await Tenant.find({
      business: companyId,
      "unitTransferHistory.0": { $exists: true },
    })
      .populate("unitTransferHistory.transferredBy", "surname otherNames email")
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    transferredTenants.forEach((tenant) => {
      (tenant.unitTransferHistory || []).forEach((transfer) => {
        events.push({
          _id: `derived-tenant-transfer-${tenant._id}-${transfer._id || transfer.effectiveDate || transfer.toUnit}`,
          company: companyId,
          actor: transfer.transferredBy?._id || null,
          actorName: actorName(transfer.transferredBy),
          actorEmail: transfer.transferredBy?.email || "",
          action: "tenants.transfer_unit",
          category: "property",
          severity: "critical",
          targetType: "Tenant",
          targetId: String(tenant._id),
          targetName: tenant.name || tenant.tenantCode || String(tenant._id),
          message: `Transferred tenant ${tenant.name || tenant.tenantCode || tenant._id} to another unit`,
          metadata: {
            source: "tenant_transfer_history",
            fromUnit: transfer.fromUnit || null,
            toUnit: transfer.toUnit || null,
            effectiveDate: transfer.effectiveDate || null,
            reason: transfer.reason || "",
          },
          createdAt: transfer.effectiveDate || tenant.updatedAt,
          updatedAt: tenant.updatedAt,
        });
      });
    });
  }

  return events;
};

router.get("/", verifyUser, async (req, res, next) => {
  try {
    const companyId = String(req.query.companyId || req.user?.company?._id || req.user?.company || "");
    if (!canViewCompanyAudit(req.user, companyId)) {
      return res.status(403).json({ message: "You are not allowed to view this company activity log" });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const category = String(req.query.category || "all");
    const severity = String(req.query.severity || "all");
    const query = { company: companyId };
    if (category !== "all") query.category = category;
    if (severity !== "all") query.severity = severity;

    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const derivedEvents = await buildDerivedCriticalEvents({ companyId, category, severity, limit });
    const explicitEventKeys = new Set(
      logs.map((log) => `${log.action}:${String(log.targetId || "")}`)
    );
    const mergedLogs = [
      ...logs,
      ...derivedEvents.filter((event) => !explicitEventKeys.has(`${event.action}:${String(event.targetId || "")}`)),
    ]
      .filter((event) => event.createdAt)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    res.json({ logs: mergedLogs });
  } catch (error) {
    next(error);
  }
});

router.get("/sessions", verifyUser, async (req, res, next) => {
  try {
    const companyId = String(req.query.companyId || req.user?.company?._id || req.user?.company || "");
    if (!canViewCompanyAudit(req.user, companyId)) {
      return res.status(403).json({ message: "You are not allowed to view this company sessions page" });
    }

    const users = await User.find({
      isSystemAuditUser: { $ne: true },
      $or: [
        { company: companyId },
        { primaryCompany: companyId },
        { accessibleCompanies: companyId },
      ],
    })
      .select("surname otherNames email profile adminAccess setupAccess companySetupAccess userControl isActive locked lastLogin updatedAt createdAt")
      .sort({ lastLogin: -1, updatedAt: -1 })
      .lean();

    res.json({ sessions: users });
  } catch (error) {
    next(error);
  }
});

export default router;
