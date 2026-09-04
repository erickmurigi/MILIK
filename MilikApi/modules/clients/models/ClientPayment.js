import mongoose from "mongoose";

// One document per payment received against a client invoice — mirrors
// LandlordReceipt's shape (models/LandlordReceipt.js): each payment is its own
// record with its own method/reference/cashbook, not a field on the invoice that
// gets overwritten on every subsequent payment. ClientInvoice.paidAmount/paidAt
// stay as a fast-read cache of the running total; this collection is the
// auditable source of truth for individual payments.

const PAYMENT_METHODS = ["bank_transfer", "mobile_money", "cash", "check", "credit_card", "other"];
const PAYMENT_STATUSES = ["posted", "reversed"];

const clientPaymentSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientInvoice",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0.01 },
    paymentDate: { type: Date, required: true, default: Date.now },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentReference: { type: String, trim: true, default: "" },
    cashbookAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
    },
    cashbookAccountCode: { type: String, trim: true, required: true },
    notes: { type: String, default: "" },
    status: { type: String, enum: PAYMENT_STATUSES, default: "posted" },
    reversedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversedAt:     { type: Date, default: null },
    reversalReason: { type: String, default: null, trim: true },
    journalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    ledgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

clientPaymentSchema.index({ business: 1, invoice: 1, status: 1 });
clientPaymentSchema.index({ business: 1, client: 1, paymentDate: -1 });

export { PAYMENT_METHODS, PAYMENT_STATUSES };
export default mongoose.model("ClientPayment", clientPaymentSchema);
