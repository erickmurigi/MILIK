import mongoose from "mongoose";

// One row per contract line per billing period. The row is the idempotency guard for billing: its
// idempotencyKey (contract:line:periodKey - see clientLineMath.buildScheduleIdempotencyKey, the same
// idea as buildRecurringChargeIdempotencyKey for tenant charges) is unique, and a billing run can only
// invoice a row by atomically moving it scheduled -> invoicing, so a row is invoiced at most once
// however many runs (cron, manual, concurrent) touch it. Cancelling the invoice returns it to scheduled.
//
// held / skipped mirror Lease.billingScheduleAdjustments (frozen / deleted): a held row is billable
// again once released; a skipped row is never billed. cancelled = cut off by termination/amendment.
export const SCHEDULE_ROW_STATUSES = ["scheduled", "invoicing", "invoiced", "held", "skipped", "cancelled"];

const clientBillingScheduleSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:   { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "ClientContract", required: true },
    contractVersion: { type: Number, default: 1 },
    lineKey:   { type: String, required: true },
    periodKey: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    from: { type: Date, required: true },
    to:   { type: Date, required: true },
    billingDate: { type: Date, required: true },
    prorationFactor: { type: Number, default: 1 },
    itemName: { type: String, default: "" },
    description: { type: String, default: "" },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    taxCodeKey: { type: String, default: null },
    billingFrequency: { type: String, default: "monthly" },
    billingTiming: { type: String, default: "advance" },
    revenueRecognition: { type: String, default: "on_invoice" },
    incomeAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    // Estimates at the current tax config - the invoice re-resolves tax when it is raised.
    netAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    status: { type: String, enum: SCHEDULE_ROW_STATUSES, default: "scheduled" },
    holdSource: { type: String, enum: ["manual", "suspension", null], default: null },
    statusReason: { type: String, default: "" },
    statusChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    statusChangedAt: { type: Date, default: null },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", default: null },
    invoiceNumber: { type: String, default: "" },
    billingRun: { type: mongoose.Schema.Types.ObjectId, ref: "ClientBillingRun", default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

clientBillingScheduleSchema.index({ business: 1, idempotencyKey: 1 }, { unique: true });
clientBillingScheduleSchema.index({ business: 1, contract: 1, from: 1 });
clientBillingScheduleSchema.index({ business: 1, status: 1, billingDate: 1 });
clientBillingScheduleSchema.index({ invoice: 1 });

export default mongoose.model("ClientBillingSchedule", clientBillingScheduleSchema);
