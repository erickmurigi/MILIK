import mongoose from "mongoose";
import { voucherReferenceKey } from "../../../utils/voucherReference.js";

// One receipt can settle many invoices (Xero/QuickBooks "receive payment").
// The settlement value is cash + WHT withheld by the client: the invoice is
// fully paid when cash and the WHT certificates together cover it. Whatever
// is not allocated sits on 2136 Client Unapplied Receipts until it is applied
// to a later invoice or refunded.
export const RECEIPT_METHODS = ["bank_transfer", "mobile_money", "cheque", "card", "cash", "other"];
export const RECEIPT_STATUSES = ["posted", "reversed"];
export const CHEQUE_STATUSES = ["pending", "cleared", "bounced"];

const allocationSchema = new mongoose.Schema(
  {
    invoice:       { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", required: true },
    invoiceNumber: { type: String, trim: true, default: "" },
    amount:        { type: Number, required: true, min: 0.01 },
    // "receipt" allocations post inside the receipt's own journal;
    // "credit_application" ones are later Dr 2136 / Cr 1260 journals.
    kind:          { type: String, enum: ["receipt", "credit_application"], default: "receipt" },
    appliedAt:     { type: Date, default: Date.now },
    appliedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status:        { type: String, enum: ["active", "reversed"], default: "active" },
    journalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null },
    ledgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    reversedAt:    { type: Date, default: null },
  },
  { _id: true }
);

const whtSchema = new mongoose.Schema(
  {
    amount:        { type: Number, default: 0, min: 0 },
    certificateNo: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const clientReceiptSchema = new mongoose.Schema(
  {
    business:      { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:        { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    receiptNumber: { type: String, trim: true, required: true },
    receiptDate:   { type: Date, required: true, default: Date.now },
    // Cash actually received into the cashbook.
    amount:        { type: Number, required: true, min: 0 },
    method:        { type: String, enum: RECEIPT_METHODS, required: true },
    reference:     { type: String, trim: true, maxlength: 100, default: "" },
    // Unique per company among live receipts; cleared on reversal so a
    // mis-keyed receipt can be reversed and re-entered with the same reference.
    referenceKey:  { type: String, default: null },
    chequeNumber:       { type: String, trim: true, default: "" },
    chequeClearingDate: { type: Date, default: null },
    chequeStatus:       { type: String, enum: [...CHEQUE_STATUSES, null], default: null },
    cashbookAccountId:   { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", required: true },
    cashbookAccountCode: { type: String, trim: true, required: true },
    whtIncomeTax:  { type: whtSchema, default: () => ({}) },
    whtVat:        { type: whtSchema, default: () => ({}) },
    allocations:   { type: [allocationSchema], default: [] },
    unappliedAmount: { type: Number, default: 0, min: 0 },
    refundedAmount:  { type: Number, default: 0, min: 0 },
    currency:      { type: String, trim: true, default: "KES" },
    notes:         { type: String, trim: true, default: "" },
    source:        { type: String, enum: ["manual", "mpesa_auto", "mpesa_manual", "portal"], default: "manual" },
    mpesaCollection: { type: mongoose.Schema.Types.ObjectId, ref: "MpesaCollection", default: null },
    status:        { type: String, enum: RECEIPT_STATUSES, default: "posted" },
    reversedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversedAt:     { type: Date, default: null },
    reversalReason: { type: String, trim: true, default: "" },
    journalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null },
    ledgerEntries:  [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

clientReceiptSchema.virtual("settlementTotal").get(function settlementTotal() {
  return Math.round((Number(this.amount || 0) + Number(this.whtIncomeTax?.amount || 0) + Number(this.whtVat?.amount || 0)) * 100) / 100;
});

clientReceiptSchema.pre("validate", function setReferenceKey(next) {
  if (this.status === "reversed") this.referenceKey = null;
  else if (this.isNew || this.isModified("reference")) this.referenceKey = voucherReferenceKey(this.reference);
  next();
});

clientReceiptSchema.index({ business: 1, receiptNumber: 1 }, { unique: true });
clientReceiptSchema.index(
  { business: 1, referenceKey: 1 },
  { unique: true, partialFilterExpression: { referenceKey: { $type: "string" } } }
);
clientReceiptSchema.index({ business: 1, client: 1, receiptDate: -1 });
clientReceiptSchema.index({ business: 1, status: 1, receiptDate: -1 });
clientReceiptSchema.index({ business: 1, "allocations.invoice": 1 });
clientReceiptSchema.index(
  { business: 1, client: 1, unappliedAmount: 1 },
  { partialFilterExpression: { unappliedAmount: { $gt: 0 } } }
);
// One live receipt per M-Pesa payment; a reversed one frees it for re-matching.
clientReceiptSchema.index(
  { business: 1, mpesaCollection: 1 },
  { unique: true, partialFilterExpression: { mpesaCollection: { $type: "objectId" }, status: "posted" } }
);

export default mongoose.model("ClientReceipt", clientReceiptSchema);
