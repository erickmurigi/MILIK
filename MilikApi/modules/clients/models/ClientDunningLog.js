import mongoose from "mongoose";

// Every automated reminder attempt, one row per (invoice, step, channel). The
// unique index is what makes the daily cron idempotent: a re-run or two
// overlapping workers can never send the same step twice.
const clientDunningLogSchema = new mongoose.Schema(
  {
    business:    { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:      { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    invoice:     { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", required: true },
    invoiceNumber: { type: String, trim: true, default: "" },
    stepKey:     { type: String, required: true, trim: true },
    offsetDays:  { type: Number, default: 0 },
    channel:     { type: String, enum: ["sms", "email"], required: true },
    to:          { type: String, trim: true, default: "" },
    subject:     { type: String, default: "" },
    body:        { type: String, default: "" },
    outstanding: { type: Number, default: 0 },
    status:      { type: String, enum: ["sent", "failed", "skipped"], default: "sent" },
    error:       { type: String, default: "" },
    sentAt:      { type: Date, default: Date.now },
  },
  { timestamps: true }
);

clientDunningLogSchema.index({ business: 1, invoice: 1, stepKey: 1, channel: 1 }, { unique: true });
clientDunningLogSchema.index({ business: 1, client: 1, sentAt: -1 });
clientDunningLogSchema.index({ business: 1, sentAt: -1 });

export default mongoose.model("ClientDunningLog", clientDunningLogSchema);
