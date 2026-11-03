import mongoose from "mongoose";
import RentPayment from "../models/RentPayment.js";
import PaymentVoucher from "../models/PaymentVoucher.js";
import Tenant from "../models/Tenant.js";
import TenantInvoiceNote from "../models/TenantInvoiceNote.js";
import TenantInvoice from "../models/TenantInvoice.js";
import Lease from "../models/Lease.js";
import {
  DEFAULT_BILLING_PERIODS,
  addMonthsPreservingDayUTC,
  buildSchedulePeriodKey,
  canonicalizeBillingPeriodKey,
} from "./billingPeriodService.js";
import { round2 } from "../utils/math.js";

// A tenant's deposit position, the one place it is worked out:
//   available = collected - applied to charges - refunded by the manager - refunded by the landlord directly
// Collected/applied come from confirmed receipts (deposit allocations and "deposit_applied" receipts, plus
// credit notes the retired settlement screen posted against the deposit liability),
// manager refunds from paid tenant-linked deposit_refund vouchers, landlord refunds from the tenant's own
// memo records. Every later decision (receipt validation, refund limits, refund status) reads this.

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

const emptyPosition = () => ({ collected: 0, applied: 0, refunded: 0, landlordRefunded: 0, available: 0 });

export const activeLandlordRefunds = (tenant) =>
  (Array.isArray(tenant?.depositLandlordRefunds) ? tenant.depositLandlordRefunds : []).filter((row) => !row?.reversedAt);

export const computeTenantDepositPositions = async (businessId, tenantIds = []) => {
  const positions = new Map();
  const ids = [...new Set(tenantIds.map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!businessId || !ids.length) return positions;

  const business = toObjectId(businessId);
  const tenant = { $in: ids.map(toObjectId) };
  const confirmedReceipts = { business, tenant, isConfirmed: true, isCancelled: { $ne: true }, isReversed: { $ne: true } };

  const [collectedRows, appliedRows, legacyAppliedRows, refundedRows, tenantDocs] = await Promise.all([
    RentPayment.aggregate([
      { $match: confirmedReceipts },
      { $group: { _id: "$tenant", total: { $sum: "$allocationSummary.deposit" } } },
    ]),
    RentPayment.aggregate([
      { $match: { ...confirmedReceipts, paymentMethod: "deposit_applied" } },
      { $group: { _id: "$tenant", total: { $sum: "$amount" } } },
    ]),
    TenantInvoiceNote.aggregate([
      { $match: { business, tenant, noteType: "CREDIT_NOTE", "metadata.depositSettlement": true, status: { $nin: ["cancelled", "reversed"] } } },
      { $group: { _id: "$tenant", total: { $sum: "$amount" } } },
    ]),
    PaymentVoucher.aggregate([
      { $match: { business, tenant, category: "deposit_refund", status: "paid" } },
      { $group: { _id: "$tenant", total: { $sum: "$amount" } } },
    ]),
    Tenant.find({ _id: tenant, business }).select("_id depositLandlordRefunds").lean(),
  ]);

  ids.forEach((id) => positions.set(id, emptyPosition()));
  collectedRows.forEach((row) => { positions.get(String(row._id)).collected = round2(row.total || 0); });
  [...appliedRows, ...legacyAppliedRows].forEach((row) => {
    const position = positions.get(String(row._id));
    position.applied = round2(position.applied + Number(row.total || 0));
  });
  refundedRows.forEach((row) => { positions.get(String(row._id)).refunded = round2(row.total || 0); });
  tenantDocs.forEach((doc) => {
    positions.get(String(doc._id)).landlordRefunded = round2(
      activeLandlordRefunds(doc).reduce((sum, row) => sum + Number(row.amount || 0), 0)
    );
  });

  positions.forEach((position) => {
    position.available = round2(Math.max(0, position.collected - position.applied - position.refunded - position.landlordRefunded));
  });

  return positions;
};

export const computeTenantDepositPosition = async (tenantId, businessId) =>
  (await computeTenantDepositPositions(businessId, [tenantId])).get(String(tenantId)) || emptyPosition();

// Kept with its original shape for the receipt flow (deposit_applied validation) and the tenant balance endpoint.
export const resolveTenantDepositAvailable = async (tenantId, businessId) => {
  const position = await computeTenantDepositPosition(tenantId, businessId);
  return {
    depositCollected: position.collected,
    depositApplied: position.applied,
    depositRefunded: round2(position.refunded + position.landlordRefunded),
    depositAvailable: position.available,
  };
};

export const deriveDepositRefundStatus = (position) => {
  if (position.collected <= 0.009) return "not_applicable";
  if (position.available > 0.009) return "pending";
  return position.refunded + position.landlordRefunded > 0.009 ? "paid" : "not_applicable";
};

// The tenant's depositRefund* fields are a cached summary of the position — never typed in.
export const syncTenantDepositRefundState = async (tenantId, businessId) => {
  if (!tenantId || !businessId) return null;
  const [position, vouchers, tenant] = await Promise.all([
    computeTenantDepositPosition(tenantId, businessId),
    PaymentVoucher.find({ business: businessId, tenant: tenantId, category: "deposit_refund", status: "paid" })
      .select("voucherNo")
      .sort({ paidDate: 1, createdAt: 1 })
      .lean(),
    Tenant.findOne({ _id: tenantId, business: businessId }).select("depositLandlordRefunds").lean(),
  ]);
  if (!tenant) return null;

  const references = [
    ...vouchers.map((voucher) => voucher.voucherNo),
    ...activeLandlordRefunds(tenant).map((row) => row.reference || "Landlord direct"),
  ].filter(Boolean);

  await Tenant.updateOne(
    { _id: tenantId, business: businessId },
    {
      $set: {
        depositRefundStatus: deriveDepositRefundStatus(position),
        depositRefundAmount: round2(position.refunded + position.landlordRefunded),
        depositRefundReference: references.join(", ").slice(0, 500),
      },
    }
  );
  return position;
};

export const normalizeTenantDepositHolder = (value) =>
  String(value || "").trim().toLowerCase() === "landlord" ? "Landlord" : "Management Company";

export const resolveDepositForfeitTo = ({ tenant, property }) =>
  tenant?.depositForfeitTo || property?.depositForfeitTo || "landlord";

// Rent periods the tenant occupied up to move-out that were never invoiced. A deposit must not be
// released while these exist — the deposit is security for exactly this rent. Periods are walked
// from the lease start the same way the billing schedule does (UTC dates, day-of-month preserved);
// a period counts as billed when a live rent invoice carries its periodKey or is dated inside it.
// Deleted and frozen schedule periods are deliberate "not owed" decisions and are skipped.
const PERIOD_MATCH_TOLERANCE_MS = 12 * 60 * 60 * 1000; // invoice dates are stored at UTC or EAT midnight

const utcDay = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // EAT-midnight values (21:00 UTC the day before) belong to the next calendar day
  const shifted = new Date(d.getTime() + PERIOD_MATCH_TOLERANCE_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

export const findUnbilledRentPeriods = async ({ tenant, businessId }) => {
  const lease = await Lease.findOne({ business: businessId, tenant: tenant._id, status: { $ne: "cancelled" } })
    .sort({ startDate: -1, createdAt: -1 })
    .select("startDate endDate status rentAmount billingPeriodKey billingScheduleAdjustments")
    .lean();

  const start = utcDay(lease?.startDate || tenant.moveInDate);
  const endedOn = tenant.terminationDate || tenant.moveOutDate || (lease?.status === "terminated" ? lease.endDate : null);
  const end = utcDay(endedOn || new Date());
  if (!start || !end || end <= start) return [];

  const billingPeriodKey = canonicalizeBillingPeriodKey(lease?.billingPeriodKey || "monthly");
  const months = DEFAULT_BILLING_PERIODS.find((p) => p.key === billingPeriodKey)?.durationInMonths || 1;
  const adjustments = new Map((lease?.billingScheduleAdjustments || []).map((row) => [row.periodKey, row]));

  const invoices = await TenantInvoice.find({
    business: businessId,
    tenant: tenant._id,
    category: "RENT_CHARGE",
    status: { $nin: ["cancelled", "reversed"] },
  }).select("invoiceDate metadata.periodKey").lean();
  const billedKeys = new Set(invoices.map((inv) => inv.metadata?.periodKey).filter(Boolean));
  const invoiceDays = invoices.map((inv) => utcDay(inv.invoiceDate)).filter(Boolean);

  const rentPerPeriod = round2(Number(lease?.rentAmount ?? tenant.rent ?? 0) * months);
  const unbilled = [];
  for (let from = start, guard = 0; from < end && guard < 600; guard += 1) {
    const next = addMonthsPreservingDayUTC(from, months);
    const periodKey = buildSchedulePeriodKey({ startDate: from, billingPeriodKey });
    const adjustment = adjustments.get(periodKey);
    const billed = billedKeys.has(periodKey) || invoiceDays.some((day) => day >= from && day < next);
    if (!billed && !["deleted", "frozen"].includes(adjustment?.status)) {
      unbilled.push({
        periodKey,
        from,
        to: new Date(Math.min(next.getTime(), end.getTime()) - 1),
        label: from.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
        rent: round2(adjustment?.rentAmount ?? rentPerPeriod),
      });
    }
    from = next;
  }
  return unbilled;
};
