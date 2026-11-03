import mongoose from "mongoose";
import Tenant from "../../models/Tenant.js";
import Unit from "../../models/Unit.js";
import Property from "../../models/Property.js";
import RentPayment from "../../models/RentPayment.js";
import PaymentVoucher from "../../models/PaymentVoucher.js";
import { createError } from "../../utils/error.js";
import { round2 } from "../../utils/math.js";
import { resolveBusinessId } from "../../utils/requestContext.js";
import { getFieldOfficerPropertyIds } from "../../utils/fieldOfficerScope.js";
import { resolveAuditActorUserId } from "../../utils/systemActor.js";
import { logAuditEvent } from "../../utils/auditLogger.js";
import {
  activeLandlordRefunds,
  computeTenantDepositPosition,
  normalizeTenantDepositHolder,
  resolveDepositForfeitTo,
  syncTenantDepositRefundState,
} from "../../services/tenantDepositService.js";

// Move-out deposit settlement. The postings themselves go through the flows that already own them —
// deposit_applied receipts (deposit against charges), debit notes / invoices (move-out charges and
// forfeits) and tenant-linked deposit_refund vouchers (cash back to the tenant). This controller only
// reports the position and records the one event with no cash leg: a landlord-held deposit the
// landlord refunded to the tenant directly.

const loadScopedTenant = async (req) => {
  const tenantId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(String(tenantId || ""))) throw createError(400, "Invalid tenant id");

  const tenant = await Tenant.findById(tenantId).lean();
  if (!tenant) throw createError(404, "Tenant not found");

  if (!req.user?.isSystemAdmin) {
    const businessId = resolveBusinessId(req);
    if (!businessId || String(tenant.business) !== String(businessId)) {
      throw createError(403, "Not authorized to access this tenant");
    }
  }

  const unit = tenant.unit ? await Unit.findById(tenant.unit).select("_id unitNumber property").lean() : null;
  const foPropertyIds = await getFieldOfficerPropertyIds(req);
  if (foPropertyIds !== null && !foPropertyIds.map(String).includes(String(unit?.property || ""))) {
    throw createError(403, "Not authorized to access this tenant");
  }

  const property = unit?.property
    ? await Property.findById(unit.property).select("_id propertyName propertyCode depositHeldBy depositForfeitTo").lean()
    : null;

  return { tenant, unit, property };
};

const buildSettlementPayload = async ({ tenant, unit, property }) => {
  const businessId = tenant.business;
  const [position, applications, refunds] = await Promise.all([
    computeTenantDepositPosition(tenant._id, businessId),
    RentPayment.find({
      business: businessId,
      tenant: tenant._id,
      paymentMethod: "deposit_applied",
      isConfirmed: true,
      isCancelled: { $ne: true },
      isReversed: { $ne: true },
    })
      .select("_id receiptNumber amount paymentDate description")
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean(),
    PaymentVoucher.find({ business: businessId, tenant: tenant._id, category: "deposit_refund", status: { $in: ["paid", "reversed"] } })
      .select("_id voucherNo amount paidDate paymentMethod reference status depositHeldBy narration")
      .sort({ paidDate: 1, createdAt: 1 })
      .lean(),
  ]);

  return {
    tenant: {
      _id: tenant._id,
      name: tenant.name,
      tenantCode: tenant.tenantCode || "",
      status: tenant.status,
      terminationDate: tenant.terminationDate || null,
      moveOutDate: tenant.moveOutDate || null,
      phone: tenant.phone || "",
      unit: unit ? { _id: unit._id, unitNumber: unit.unitNumber } : null,
      property: property ? { _id: property._id, propertyName: property.propertyName, propertyCode: property.propertyCode } : null,
    },
    depositHeldBy: normalizeTenantDepositHolder(tenant.depositHeldBy),
    forfeitTo: resolveDepositForfeitTo({ tenant, property }),
    forfeitToSource: tenant.depositForfeitTo ? "tenant" : "property",
    position,
    applications: applications.map((row) => ({
      _id: row._id,
      receiptNumber: row.receiptNumber,
      amount: round2(row.amount),
      date: row.paymentDate,
      description: row.description || "",
    })),
    refunds: refunds.map((row) => ({
      _id: row._id,
      voucherNo: row.voucherNo,
      amount: round2(row.amount),
      date: row.paidDate,
      paymentMethod: row.paymentMethod,
      reference: row.reference || "",
      status: row.status,
      depositHeldBy: row.depositHeldBy,
    })),
    landlordRefunds: (tenant.depositLandlordRefunds || []).map((row) => ({
      _id: row._id,
      amount: round2(row.amount),
      date: row.date,
      reference: row.reference || "",
      notes: row.notes || "",
      reversedAt: row.reversedAt || null,
    })),
  };
};

export const getDepositSettlement = async (req, res, next) => {
  try {
    const context = await loadScopedTenant(req);
    return res.status(200).json({ success: true, data: await buildSettlementPayload(context) });
  } catch (error) {
    next(error);
  }
};

export const recordLandlordDirectRefund = async (req, res, next) => {
  try {
    const { tenant, unit, property } = await loadScopedTenant(req);
    if (normalizeTenantDepositHolder(tenant.depositHeldBy) !== "Landlord") {
      return next(createError(400, "Only a landlord-held deposit can be refunded by the landlord directly. Refund a manager-held deposit with a refund payment instead."));
    }

    const amount = round2(Math.abs(Number(req.body?.amount || 0)));
    if (!(amount > 0)) return next(createError(400, "Enter the amount the landlord refunded"));

    const date = req.body?.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(date.getTime())) return next(createError(400, "A valid refund date is required"));

    const position = await computeTenantDepositPosition(tenant._id, tenant.business);
    if (amount > position.available + 0.009) {
      return next(createError(400, `Only KES ${position.available.toLocaleString()} of deposit is still held for this tenant.`));
    }

    const actorUserId = await resolveAuditActorUserId({ req, businessId: tenant.business });
    const entry = {
      _id: new mongoose.Types.ObjectId(),
      amount,
      date,
      reference: String(req.body?.reference || "").trim().slice(0, 100),
      notes: String(req.body?.notes || "").trim().slice(0, 500),
      recordedBy: actorUserId,
      recordedAt: new Date(),
    };
    await Tenant.updateOne({ _id: tenant._id }, { $push: { depositLandlordRefunds: entry } });
    await syncTenantDepositRefundState(tenant._id, tenant.business);

    await logAuditEvent({
      req,
      company: tenant.business,
      action: "tenants.deposit.landlord_refund",
      category: "property",
      severity: "high",
      targetType: "Tenant",
      targetId: tenant._id,
      targetName: tenant.name,
      message: `Recorded landlord direct deposit refund of KES ${amount.toLocaleString()} for ${tenant.name}`,
      metadata: { amount, reference: entry.reference, date },
    });

    const refreshed = await Tenant.findById(tenant._id).lean();
    return res.status(201).json({ success: true, data: await buildSettlementPayload({ tenant: refreshed, unit, property }) });
  } catch (error) {
    next(error);
  }
};

export const reverseLandlordDirectRefund = async (req, res, next) => {
  try {
    const { tenant, unit, property } = await loadScopedTenant(req);
    const entryId = String(req.params.entryId || "");
    const entry = activeLandlordRefunds(tenant).find((row) => String(row._id) === entryId);
    if (!entry) return next(createError(404, "Landlord refund record not found or already reversed"));

    const actorUserId = await resolveAuditActorUserId({ req, businessId: tenant.business });
    await Tenant.updateOne(
      { _id: tenant._id, "depositLandlordRefunds._id": entry._id },
      { $set: { "depositLandlordRefunds.$.reversedAt": new Date(), "depositLandlordRefunds.$.reversedBy": actorUserId } }
    );
    await syncTenantDepositRefundState(tenant._id, tenant.business);

    await logAuditEvent({
      req,
      company: tenant.business,
      action: "tenants.deposit.landlord_refund_reversed",
      category: "property",
      severity: "high",
      targetType: "Tenant",
      targetId: tenant._id,
      targetName: tenant.name,
      message: `Reversed landlord direct deposit refund of KES ${Number(entry.amount).toLocaleString()} for ${tenant.name}`,
      metadata: { amount: entry.amount, reference: entry.reference },
    });

    const refreshed = await Tenant.findById(tenant._id).lean();
    return res.status(200).json({ success: true, data: await buildSettlementPayload({ tenant: refreshed, unit, property }) });
  } catch (error) {
    next(error);
  }
};
