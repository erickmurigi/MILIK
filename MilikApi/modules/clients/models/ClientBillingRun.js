import mongoose from "mongoose";

// Audit record of one billing run (manual or cron): who ran it, for what scope, what it raised and
// what failed. Row-level idempotency lives on ClientBillingSchedule; this is the run's paper trail.
const runFailureSchema = new mongoose.Schema(
  {
    client: mongoose.Schema.Types.ObjectId,
    contract: mongoose.Schema.Types.ObjectId,
    kind: { type: String, enum: ["error", "credit_block"], default: "error" },
    message: String,
  },
  { _id: false }
);

const clientBillingRunSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    triggeredBy: { type: String, enum: ["manual", "cron"], default: "manual" },
    runBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    asOfDate: { type: Date, required: true },
    issueDate: { type: Date, required: true },
    period: { type: String, default: "" },
    scope: { type: String, enum: ["all", "client", "contract", "auto_bill"], default: "all" },
    scopeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    groupBy: { type: String, enum: ["client", "contract"], default: "client" },
    postAsDraft: { type: Boolean, default: false },
    status: { type: String, enum: ["running", "completed", "completed_with_errors", "failed"], default: "running" },
    invoiceCount: { type: Number, default: 0 },
    rowCount: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    invoices: [{ type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice" }],
    failures: { type: [runFailureSchema], default: [] },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

clientBillingRunSchema.index({ business: 1, createdAt: -1 });

export default mongoose.model("ClientBillingRun", clientBillingRunSchema);
