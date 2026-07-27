import mongoose from "mongoose";

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity:    { type: Number, default: 1, min: 0 },
    unitPrice:   { type: Number, default: 0, min: 0 },
    amount:      { type: Number, default: 0 },
    taxable:     { type: Boolean, default: true },
  },
  { _id: false }
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
    invoiceNumber: { type: String, trim: true },
    issueDate:     { type: Date, required: true, default: Date.now },
    dueDate:       { type: Date, required: true },
    periodStart:   { type: Date, default: null },
    periodEnd:     { type: Date, default: null },
    lineItems:     { type: [lineItemSchema], default: [] },
    subtotal:      { type: Number, default: 0 },
    vatRate:       { type: Number, default: 16, min: 0, max: 100 },
    vatAmount:     { type: Number, default: 0 },
    total:         { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "sent", "partial", "paid", "overdue", "cancelled"],
      default: "draft",
    },
    paidAmount:       { type: Number, default: 0, min: 0 },
    paidAt:           { type: Date, default: null },
    paymentMethod:    { type: String, default: "" },
    paymentReference: { type: String, default: "" },
    sentAt:           { type: Date, default: null },
    notes:            { type: String, default: "" },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Pre-save: recompute line item amounts and invoice totals
clientInvoiceSchema.pre("save", function (next) {
  const vatRate = Number(this.vatRate || 0);
  let subtotal = 0;
  let vatAmount = 0;

  if (Array.isArray(this.lineItems)) {
    for (const item of this.lineItems) {
      const qty = Number(item.quantity || 0);
      const price = Number(item.unitPrice || 0);
      const lineAmount = Math.round(qty * price * 100) / 100;
      item.amount = lineAmount;
      subtotal += lineAmount;
      if (item.taxable && vatRate > 0) {
        vatAmount += Math.round(qty * price * (vatRate / 100) * 100) / 100;
      }
    }
  }

  this.subtotal = Math.round(subtotal * 100) / 100;
  this.vatAmount = Math.round(vatAmount * 100) / 100;
  this.total = Math.round((subtotal + vatAmount) * 100) / 100;
  next();
});

clientInvoiceSchema.index({ business: 1, client: 1, status: 1 });
clientInvoiceSchema.index({ business: 1, invoiceNumber: 1 }, { unique: true, sparse: true });
clientInvoiceSchema.index({ business: 1, dueDate: 1, status: 1 });

export default mongoose.model("ClientInvoice", clientInvoiceSchema);
