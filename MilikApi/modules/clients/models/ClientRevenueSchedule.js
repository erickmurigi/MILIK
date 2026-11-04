import mongoose from "mongoose";

// Revenue recognition plan for one deferred invoice line. Invoicing credits the line's net amount
// to 2165 Deferred Revenue; each entry here is one calendar month's share, released to income by the
// monthly recognition run (Dr 2165 / Cr income). An entry is claimed pending -> posting -> recognized
// atomically, so recognition is idempotent per invoice line per month however often the run fires.
export const REVENUE_ENTRY_STATUSES = ["pending", "posting", "recognized", "cancelled"];

const recognitionEntrySchema = new mongoose.Schema(
  {
    month:  { type: String, required: true }, // YYYY-MM
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: REVENUE_ENTRY_STATUSES, default: "pending" },
    recognizedAt: { type: Date, default: null },
    recognizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    journalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null },
    ledgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    description: { type: String, default: "" }, // milestone label
  },
  { _id: true }
);

const clientRevenueScheduleSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:   { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "ClientContract", default: null },
    contractLineKey: { type: String, default: null },
    invoice:  { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", required: true },
    invoiceNumber: { type: String, default: "" },
    invoiceLineId: { type: mongoose.Schema.Types.ObjectId, required: true },
    description: { type: String, default: "" },
    method: { type: String, enum: ["straight_line", "milestone"], required: true },
    incomeAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    servicePeriodStart: { type: Date, default: null },
    servicePeriodEnd:   { type: Date, default: null },
    totalAmount: { type: Number, required: true, min: 0 },      // net deferred at invoicing
    creditedAmount: { type: Number, default: 0, min: 0 },       // released by credit notes
    recognizedAmount: { type: Number, default: 0, min: 0 },
    entries: { type: [recognitionEntrySchema], default: [] },
    status: { type: String, enum: ["active", "completed", "cancelled"], default: "active" },
  },
  { timestamps: true }
);

clientRevenueScheduleSchema.index({ business: 1, invoice: 1, invoiceLineId: 1 }, { unique: true });
clientRevenueScheduleSchema.index({ business: 1, contract: 1 });
clientRevenueScheduleSchema.index({ business: 1, status: 1, "entries.month": 1 });

export default mongoose.model("ClientRevenueSchedule", clientRevenueScheduleSchema);
