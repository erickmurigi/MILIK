import mongoose from "mongoose";

// Credit and debit notes against a posted client invoice (modelled on models/TenantInvoiceNote.js).
// A note is the only way to change what a posted invoice charges. Each note line points back at
// the invoice line it adjusts, so tax and income/deferred-revenue split follow the original line.
export const CLIENT_NOTE_TYPES = ["CREDIT_NOTE", "DEBIT_NOTE"];
export const CLIENT_NOTE_STATUSES = ["posted", "reversed"];

const deferredReductionSchema = new mongoose.Schema(
  { month: String, amount: Number },
  { _id: false }
);

const noteLineSchema = new mongoose.Schema(
  {
    invoiceLineId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    invoiceLineIndex: { type: Number, default: null },
    description:     { type: String, trim: true, default: "" },
    quantity:        { type: Number, default: 1, min: 0 },
    unitPrice:       { type: Number, default: 0, min: 0 },
    netAmount:       { type: Number, required: true, min: 0 },
    taxCodeKey:      { type: String, default: null },
    taxType:         { type: String, default: "none" },
    taxRate:         { type: Number, default: 0 },
    taxAmount:       { type: Number, default: 0 },
    totalAmount:     { type: Number, required: true, min: 0 },
    incomeAccount:   { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    // Credit notes on a deferred line release the unrecognised portion from 2165 first; the months
    // it came out of are kept so a reversal can put it back exactly.
    deferredPortion: { type: Number, default: 0 },
    revenueSchedule: { type: mongoose.Schema.Types.ObjectId, ref: "ClientRevenueSchedule", default: null },
    deferredReductions: { type: [deferredReductionSchema], default: [] },
  },
  { _id: true }
);

const clientCreditNoteSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:   { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    invoice:  { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", required: true },
    invoiceNumber: { type: String, default: "" },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "ClientContract", default: null },
    noteType: { type: String, enum: CLIENT_NOTE_TYPES, required: true },
    noteNumber: { type: String, required: true, trim: true },
    noteDate: { type: Date, required: true },
    reason:   { type: String, trim: true, default: "" },
    isFullCredit: { type: Boolean, default: false },
    lines:    { type: [noteLineSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total:    { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: "KES" },
    status:   { type: String, enum: CLIENT_NOTE_STATUSES, default: "posted" },
    journalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null },
    ledgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clientCreditNoteSchema.index({ business: 1, noteNumber: 1 }, { unique: true });
clientCreditNoteSchema.index({ business: 1, invoice: 1, status: 1 });
clientCreditNoteSchema.index({ business: 1, client: 1, noteDate: -1 });

export default mongoose.model("ClientCreditNote", clientCreditNoteSchema);
