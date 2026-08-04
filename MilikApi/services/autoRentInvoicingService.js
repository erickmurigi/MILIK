import mongoose from "mongoose";
import CompanySettings from "../models/CompanySettings.js";
import Lease from "../models/Lease.js";
import Tenant from "../models/Tenant.js";
import { createTenantInvoiceRecord } from "../controllers/propertyController/tenantInvoices.js";
import { resolveBillingPeriodFromSettings } from "./billingPeriodService.js";
import { sendAdHocSms, sendAdHocEmail } from "./communicationService.js";

const toObjectId = (v) =>
  mongoose.Types.ObjectId.isValid(String(v || "")) ? new mongoose.Types.ObjectId(String(v)) : null;

// Returns true if today is the day invoices should be generated for a given config.
// effective trigger = billingDay - daysInAdvance (wraps into previous month when needed).
const isTriggerDay = (billingDay, daysInAdvance, today = new Date()) => {
  const bd = Math.max(1, Math.min(28, Number(billingDay) || 1));
  const adv = Math.max(0, Math.min(14, Number(daysInAdvance) || 0));
  const todayDay = today.getDate();
  const triggerDay = bd - adv;

  if (triggerDay >= 1) {
    return todayDay === triggerDay;
  }

  // triggerDay <= 0 means we roll into the previous month's tail
  const prevMonthDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  const effectivePrevDay = prevMonthDays + triggerDay;
  return todayDay === effectivePrevDay;
};

// Resolve the target invoice/due month from today + advance config.
// When daysInAdvance > 0 the target is next month (advance invoicing).
const resolveTargetMonth = (daysInAdvance, today = new Date()) => {
  const adv = Math.max(0, Math.min(14, Number(daysInAdvance) || 0));
  let year = today.getFullYear();
  let month = today.getMonth(); // 0-indexed
  if (adv > 0) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return { year, month };
};

// Returns true when (targetYear, targetMonth) is a billing month for this lease.
// Monthly leases always return true.
// Non-monthly leases (quarterly = 3 months, semi-annual = 6, annual = 12) only bill
// in months that are a multiple of durationInMonths away from the lease start month.
const isBillingMonth = (leaseStartDate, durationInMonths, targetYear, targetMonth) => {
  if (!durationInMonths || durationInMonths <= 1) return true; // monthly
  const start = new Date(leaseStartDate);
  if (isNaN(start.getTime())) return true; // no start date — default to always bill
  const monthsElapsed =
    (targetYear - start.getFullYear()) * 12 + (targetMonth - start.getMonth());
  return monthsElapsed >= 0 && monthsElapsed % durationInMonths === 0;
};

// Build a human-readable period label based on target month and duration.
const buildPeriodLabel = (year, month, durationInMonths) => {
  const startDate = new Date(year, month, 1);
  if (!durationInMonths || durationInMonths <= 1) {
    return startDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }
  const endMonth = month + durationInMonths - 1;
  const endYear = year + Math.floor(endMonth / 12);
  const endDate = new Date(endYear, endMonth % 12, 1);
  const startLabel = startDate.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const endLabel = endDate.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
};

// Send an invoice notification to a tenant (best-effort; errors are swallowed).
const sendInvoiceNotification = async ({ businessId, notifyChannel, tenant, amount, dueDate, periodLabel }) => {
  if (!tenant) return;
  const dueDateStr = dueDate instanceof Date
    ? dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : String(dueDate || "");
  const amountStr = `KES ${Number(amount || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const body = `Dear ${tenant.name || "Tenant"}, your rent invoice of ${amountStr} for ${periodLabel} is ready. Due date: ${dueDateStr}.`;
  const subject = `Rent Invoice — ${periodLabel}`;

  try {
    if (["sms", "both"].includes(notifyChannel) && tenant.phone) {
      await sendAdHocSms({ businessId, phone: tenant.phone, body, templateKey: "auto_invoice_rent", recipientName: tenant.name || "" });
    }
    if (["email", "both"].includes(notifyChannel) && tenant.email) {
      await sendAdHocEmail({ businessId, to: tenant.email, subject, bodyText: body });
    }
  } catch {
    // best-effort — never fail the run because of a notification error
  }
};

// Process one company. Returns { created, skipped, errors } or null if not trigger day.
const processCompany = async (businessId, settings, billingPeriods, today, forceRun, triggeredBy) => {
  const { billingDay, daysInAdvance, notifyTenants, notifyChannel } = settings;

  if (!forceRun && !isTriggerDay(billingDay, daysInAdvance, today)) {
    return null;
  }

  const { year: targetYear, month: targetMonth } = resolveTargetMonth(daysInAdvance, today);
  const invoiceDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const activeLeases = await Lease.find({
    business: toObjectId(String(businessId)),
    status: "active",
    autoInvoice: { $ne: false },
  })
    .select("tenant unit property rentAmount description billingPeriodKey paymentDueDay startDate")
    .lean();

  // Batch-load tenant contact info when notifications are enabled
  let tenantMap = new Map();
  if (notifyTenants && notifyChannel && notifyChannel !== "none") {
    const tenantIds = activeLeases.filter((l) => l.tenant).map((l) => String(l.tenant));
    if (tenantIds.length) {
      const tenants = await Tenant.find({ _id: { $in: tenantIds }, business: toObjectId(String(businessId)) })
        .select("name phone email")
        .lean();
      tenantMap = new Map(tenants.map((t) => [String(t._id), t]));
    }
  }

  let created = 0;
  let skipped = 0;
  const errors = [];
  const notificationQueue = [];

  const systemReq = { user: { isSystemAdmin: true, company: businessId } };

  await Promise.all(
    activeLeases.map(async (lease) => {
      if (!lease.tenant || !lease.unit || Number(lease.rentAmount || 0) <= 0) {
        skipped++;
        return;
      }
      if (!lease.property) {
        skipped++;
        return;
      }

      // Resolve this lease's billing period duration
      const periodRecord = resolveBillingPeriodFromSettings(billingPeriods, lease.billingPeriodKey || "monthly");
      const durationInMonths = Math.max(1, Number(periodRecord?.durationInMonths || 1));

      // Skip if this month is not a billing month for this lease's cycle
      if (!isBillingMonth(lease.startDate, durationInMonths, targetYear, targetMonth)) {
        skipped++;
        return;
      }

      // Per-lease due date uses lease.paymentDueDay; fall back to company billingDay
      const leaseDueDay = Math.max(1, Math.min(28, Number(lease.paymentDueDay || billingDay || 1)));
      const dueDate = new Date(targetYear, targetMonth, leaseDueDay);

      const periodLabel = buildPeriodLabel(targetYear, targetMonth, durationInMonths);

      // Idempotency key: unique per tenant per billing cycle (target month encodes the cycle)
      const idempotencyKey = `auto_rent_${String(lease.tenant)}_${targetYear}_${String(targetMonth + 1).padStart(2, "0")}`;

      try {
        await createTenantInvoiceRecord({
          req: systemReq,
          payload: {
            business: String(businessId),
            tenant: String(lease.tenant),
            unit: String(lease.unit),
            property: String(lease.property),
            category: "RENT_CHARGE",
            amount: Number(lease.rentAmount),
            description: `Rent — ${periodLabel}`,
            invoiceDate: invoiceDate.toISOString(),
            dueDate: dueDate.toISOString(),
            idempotencyKey,
            metadata: { autoGenerated: true, billingDay, period: periodLabel, triggeredBy },
          },
          options: { skipGL: false },
        });
        created++;
        if (notifyTenants && notifyChannel && notifyChannel !== "none") {
          notificationQueue.push({ tenantId: String(lease.tenant), amount: lease.rentAmount, dueDate, periodLabel });
        }
      } catch (err) {
        if (/idempotencyKey|duplicate key/i.test(String(err?.message || ""))) {
          skipped++;
        } else {
          errors.push({ leaseId: String(lease._id), message: err?.message || String(err) });
        }
      }
    })
  );

  // Send notifications after all invoices are created (best-effort)
  if (notificationQueue.length) {
    await Promise.allSettled(
      notificationQueue.map(({ tenantId, amount, dueDate, periodLabel }) => {
        const tenant = tenantMap.get(tenantId);
        return sendInvoiceNotification({ businessId, notifyChannel, tenant, amount, dueDate, periodLabel });
      })
    );
  }

  return { created, skipped, errors };
};

// Main entry point. Call with no args from cron (processes all enabled companies).
// Call with a businessId for manual trigger or testing.
// Set forceRun=true to bypass the enabled flag and the trigger-day check.
// Set triggeredBy='manual' when called from a user-initiated endpoint.
export const processAutoRentInvoices = async (
  businessId = null,
  today = new Date(),
  { forceRun = false, triggeredBy = "cron" } = {}
) => {
  const query = forceRun ? {} : { "autoInvoicing.enabled": true };
  if (businessId) query.company = toObjectId(String(businessId));

  const settingsDocs = await CompanySettings.find(query)
    .select("company autoInvoicing billingPeriods")
    .lean();

  const results = [];

  for (const doc of settingsDocs) {
    const companyId = String(doc.company);
    const billingPeriods = doc.billingPeriods || [];
    try {
      const result = await processCompany(companyId, doc.autoInvoicing, billingPeriods, today, forceRun, triggeredBy);
      if (result === null) continue;

      const summary = `Created ${result.created}, skipped ${result.skipped}, errors ${result.errors.length}`;

      await CompanySettings.updateOne(
        { company: doc.company },
        {
          $set: {
            "autoInvoicing.lastRunAt": new Date(),
            "autoInvoicing.lastRunSummary": summary,
          },
          $push: {
            "autoInvoicing.runHistory": {
              $each: [{
                runAt: new Date(),
                created: result.created,
                skipped: result.skipped,
                errors: result.errors.length,
                summary,
                triggeredBy,
              }],
              $position: 0,
              $slice: 20,
            },
          },
        }
      );

      results.push({ businessId: companyId, ...result, summary });

      if (result.errors.length) {
        console.error(`[AutoInvoicing] ${companyId} had ${result.errors.length} error(s):`, result.errors);
      }
    } catch (err) {
      console.error(`[AutoInvoicing] Failed for company ${companyId}:`, err?.message || err);
      results.push({ businessId: companyId, created: 0, skipped: 0, errors: [{ message: err?.message }] });
    }
  }

  return results;
};
