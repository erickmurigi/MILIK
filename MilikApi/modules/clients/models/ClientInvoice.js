import mongoose from "mongoose";
import { round2 } from "../../../utils/math.js";
import { calculateLineAmounts, REVENUE_RECOGNITION_METHODS, TAX_MODES } from "../services/clientLineMath.js";

// "partial" is what the legacy recordPayment writes; "partially_paid" is accepted as its alias.
// "posted" = on the ledger but not yet sent to the client; "credited" = fully credit-noted.
export const CLIENT_INVOICE_STATUSES = [
  "draft", "posted", "sent", "partial", "partially_paid", "paid", "overdue", "cancelled", "credited",
];
export const CLIENT_INVOICE_OPEN_STATUSES = ["posted", "sent", "partial", "partially_paid", "overdue"];

// Fields that define what the client owes. Once an invoice leaves draft they are frozen: the only
// way to change the amount is a credit/debit note, which is what keeps the GL, the VAT return and
// the client's copy of the invoice in agreement.
export const CLIENT_INVOICE_IMMUTABLE_FIELDS = [
  "client", "contract", "lineItems", "subtotal", "vatRate", "vatAmount", "total",
  "taxMode", "taxCalculation", "issueDate", "currency", "discountTotal",
];

const lineItemSchema = new mongoose.Schema(
  {
    itemName:    { type: String, trim: true, default: "" },
    description: { type: String, required: true, trim: true },
    quantity:    { type: Number, default: 1, min: 0 },
    unitPrice:   { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount:  { type: Number, default: 0 },
    prorationFactor: { type: Number, default: 1, min: 0 },
    // Net of discount and of VAT (what is credited to income / deferred revenue).
    amount:      { type: Number, default: 0 },
    taxable:     { type: Boolean, default: true }, // legacy flat-rate flag
    taxCodeKey:  { type: String, trim: true, default: null },
    taxCodeName: { type: String, trim: true, default: "" },
    taxType:     { type: String, trim: true, default: null },
    taxRate:     { type: Number, default: 0, min: 0 },
    taxAmount:   { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    servicePeriodStart: { type: Date, default: null },
    servicePeriodEnd:   { type: Date, default: null },
    revenueRecognition: { type: String, enum: REVENUE_RECOGNITION_METHODS, default: "on_invoice" },
    incomeAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    contract:       { type: mongoose.Schema.Types.ObjectId, ref: "ClientContract", default: null },
    contractLineKey: { type: String, default: null },
    scheduleRow:    { type: mongoose.Schema.Types.ObjectId, ref: "ClientBillingSchedule", default: null },
    scheduleKey:    { type: String, default: null },
  },
  { _id: true }
);

const clientInvoiceSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContract",
      default: null,
    },
    contractVersion: { type: Number, default: null },
    invoiceNumber: { type: String, trim: true },
    series:        { type: String, trim: true, default: "CINV" },
    poNumber:      { type: String, trim: true, default: "" },
    issueDate:     { type: Date, required: true, default: Date.now },
    dueDate:       { type: Date, required: true },
    periodStart:   { type: Date, default: null },
    periodEnd:     { type: Date, default: null },
    currency:      { type: String, default: "KES" },
    lineItems:     { type: [lineItemSchema], default: [] },
    // "flat" = pre-tax-code invoices (one vatRate on taxable lines); "line" = per-line tax codes.
    taxCalculation: { type: String, enum: ["flat", "line"], default: "flat" },
    taxMode:       { type: String, enum: TAX_MODES, default: "exclusive" },
    subtotal:      { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    vatRate:       { type: Number, default: 16, min: 0, max: 100 },
    vatAmount:     { type: Number, default: 0 },
    total:         { type: Number, default: 0 },
    // Running note totals, maintained when a credit/debit note is posted or reversed. adjustedTotal is
    // what the client owes before receipts: outstanding = adjustedTotal - paidAmount
    // (see services/clientInvoiceBalanceService.js).
    creditedAmount: { type: Number, default: 0, min: 0 },
    debitedAmount:  { type: Number, default: 0, min: 0 },
    // No default on purpose: invoices saved before notes existed simply don't have it, and readers
    // fall back to total + debitedAmount - creditedAmount rather than trusting a hydrated 0.
    adjustedTotal:  { type: Number },
    // Net amount billed into 2165 Deferred Revenue instead of income.
    deferredAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: CLIENT_INVOICE_STATUSES,
      default: "draft",
    },
    paidAmount:       { type: Number, default: 0, min: 0 },
    paidAt:           { type: Date, default: null },
    paymentMethod:    { type: String, default: "" },
    paymentReference: { type: String, default: "" },
    sentAt:           { type: Date, default: null },
    postedAt:         { type: Date, default: null },
    postedBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt:      { type: Date, default: null },
    cancelledBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancellationReason: { type: String, default: "" },
    notes:            { type: String, default: "" },
    terms:            { type: String, default: "" },
    billingRun:       { type: mongoose.Schema.Types.ObjectId, ref: "ClientBillingRun", default: null },
    journalGroupId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    ledgerEntries:    [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    // eTIMS (KRA) — set by the eTIMS submission service, printed on the invoice PDF.
    etimsCuInvoiceNumber: { type: String, trim: true, default: "" },
    etimsQrUrl:           { type: String, trim: true, default: "" },
    etimsStatus:          { type: String, trim: true, default: "not_submitted" },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

clientInvoiceSchema.virtual("isOverdue").get(function () {
  const outstanding = Number(this.adjustedTotal ?? this.total ?? 0) - Number(this.paidAmount || 0);
  return Boolean(
    CLIENT_INVOICE_OPEN_STATUSES.includes(this.status) && outstanding > 0.005 && this.dueDate && new Date(this.dueDate) < new Date()
  );
});

clientInvoiceSchema.post("init", function () {
  this.$locals.originalStatus = this.status;
});

const recomputeTotals = (doc) => {
  if (doc.taxCalculation === "line") {
    for (const item of doc.lineItems || []) {
      const calc = calculateLineAmounts({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        taxRate: item.taxRate,
        taxType: item.taxType,
        taxMode: doc.taxMode,
        prorationFactor: item.prorationFactor ?? 1,
      });
      item.discountAmount = calc.discountAmount;
      item.amount = calc.netAmount;
      item.taxAmount = calc.taxAmount;
      item.totalAmount = calc.totalAmount;
    }
    const items = doc.lineItems || [];
    doc.subtotal = round2(items.reduce((s, i) => s + Number(i.amount || 0), 0));
    doc.vatAmount = round2(items.reduce((s, i) => s + Number(i.taxAmount || 0), 0));
    doc.total = round2(items.reduce((s, i) => s + Number(i.totalAmount || 0), 0));
    doc.discountTotal = round2(items.reduce((s, i) => s + Number(i.discountAmount || 0), 0));
    doc.vatRate = Math.min(100, items.reduce((m, i) => Math.max(m, Number(i.taxRate || 0)), 0));
    return;
  }

  // Legacy flat-rate invoice — unchanged arithmetic.
  const vatRate = Number(doc.vatRate || 0);
  let subtotal = 0;
  let vatAmount = 0;
  for (const item of doc.lineItems || []) {
    const qty = Number(item.quantity || 0);
    const price = Number(item.unitPrice || 0);
    const lineAmount = Math.round(qty * price * 100) / 100;
    item.amount = lineAmount;
    subtotal += lineAmount;
    if (item.taxable && vatRate > 0) {
      vatAmount += Math.round(qty * price * (vatRate / 100) * 100) / 100;
    }
  }
  doc.subtotal = Math.round(subtotal * 100) / 100;
  doc.vatAmount = Math.round(vatAmount * 100) / 100;
  doc.total = Math.round((subtotal + vatAmount) * 100) / 100;
};

clientInvoiceSchema.pre("save", function (next) {
  const original = this.$locals.originalStatus;
  const editable = this.isNew || !original || original === "draft";

  if (!editable) {
    const changed = CLIENT_INVOICE_IMMUTABLE_FIELDS.filter((field) => this.isModified(field));
    if (changed.length) {
      const err = new Error(`Invoice ${this.invoiceNumber || ""} is ${original} — ${changed.join(", ")} can no longer be changed. Use a credit or debit note.`);
      err.status = 400;
      return next(err);
    }
  } else {
    recomputeTotals(this);
  }

  this.adjustedTotal = round2(Number(this.total || 0) + Number(this.debitedAmount || 0) - Number(this.creditedAmount || 0));
  next();
});

clientInvoiceSchema.post("save", function () {
  this.$locals.originalStatus = this.status;
});

// The same freeze for update queries: an update touching an immutable field is only allowed when
// the filter pins the invoice to draft. Receipts ($set paidAmount/status/paidAt) are unaffected.
const updatedRootFields = (update) => {
  const fields = new Set();
  const collect = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith("$")) {
        if (value && typeof value === "object") Object.keys(value).forEach((k) => fields.add(k.split(".")[0]));
      } else {
        fields.add(key.split(".")[0]);
      }
    }
  };
  if (Array.isArray(update)) update.forEach(collect);
  else collect(update);
  return [...fields];
};

clientInvoiceSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function (next) {
  const touched = updatedRootFields(this.getUpdate()).filter((f) => CLIENT_INVOICE_IMMUTABLE_FIELDS.includes(f));
  if (!touched.length) return next();
  if (this.getFilter()?.status === "draft") return next();
  const err = new Error(`Posted client invoices are immutable (${touched.join(", ")}). Use a credit or debit note.`);
  err.status = 400;
  return next(err);
});

clientInvoiceSchema.index({ business: 1, client: 1, status: 1 });
clientInvoiceSchema.index({ business: 1, invoiceNumber: 1 }, { unique: true, sparse: true });
clientInvoiceSchema.index({ business: 1, dueDate: 1, status: 1 });
clientInvoiceSchema.index({ business: 1, contract: 1, issueDate: -1 });
clientInvoiceSchema.index({ billingRun: 1 });

export default mongoose.model("ClientInvoice", clientInvoiceSchema);
