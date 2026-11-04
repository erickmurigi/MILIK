import mongoose from "mongoose";

// Collections-side state for an invoice (dispute, late-interest watermark),
// kept off ClientInvoice so posted invoices stay immutable documents and the
// billing side and the collections side never write the same record.
const clientInvoiceFlagSchema = new mongoose.Schema(
  {
    business:      { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:        { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    invoice:       { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", required: true },
    disputed:      { type: Boolean, default: false },
    disputeReason: { type: String, trim: true, default: "" },
    disputedAt:    { type: Date, default: null },
    disputedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    disputeResolvedAt:  { type: Date, default: null },
    disputeResolution:  { type: String, trim: true, default: "" },
    // Late-payment interest has been charged (via debit note) up to this date;
    // the next calculation starts from here so interest is never charged twice.
    interestChargedThrough: { type: Date, default: null },
  },
  { timestamps: true }
);

clientInvoiceFlagSchema.index({ business: 1, invoice: 1 }, { unique: true });
clientInvoiceFlagSchema.index({ business: 1, disputed: 1 });

export default mongoose.model("ClientInvoiceFlag", clientInvoiceFlagSchema);
