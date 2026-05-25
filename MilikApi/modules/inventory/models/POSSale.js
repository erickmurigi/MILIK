import mongoose from "mongoose";

const PAYMENT_METHODS = ["cash", "mpesa", "card", "credit", "mixed"];
const SALE_STATUSES   = ["completed", "voided"];

const saleLineSchema = new mongoose.Schema(
  {
    product:      { type: mongoose.Schema.Types.ObjectId, ref: "InvProduct", required: true },
    productName:  { type: String, trim: true, default: "" },  // snapshot at time of sale
    sku:          { type: String, trim: true, default: "" },
    qty:          { type: Number, required: true, min: 0.001 },
    unitPrice:    { type: Number, required: true, min: 0 },
    discount:     { type: Number, default: 0, min: 0 },       // amount, not %
    vatRate:      { type: Number, default: 0 },
    vatAmount:    { type: Number, default: 0 },
    lineTotal:    { type: Number, default: 0 },               // (unitPrice - discount) * qty
    costPrice:    { type: Number, default: 0 },               // snapshot for COGS
  },
  { _id: true }
);

const paymentLineSchema = new mongoose.Schema(
  {
    method: { type: String, enum: ["cash", "mpesa", "card", "credit"], required: true },
    amount: { type: Number, required: true, min: 0 },
    ref:    { type: String, trim: true, default: "" },  // M-Pesa ref, card auth
  },
  { _id: false }
);

const posSaleSchema = new mongoose.Schema(
  {
    business:      { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    location:      { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true, index: true },
    session:       { type: mongoose.Schema.Types.ObjectId, ref: "POSSession", required: true, index: true },
    receiptNumber: { type: String, required: true, trim: true },
    status:        { type: String, enum: SALE_STATUSES, default: "completed", index: true },
    lines:         [saleLineSchema],
    payments:      [paymentLineSchema],
    subtotal:      { type: Number, default: 0 },
    totalDiscount: { type: Number, default: 0 },
    totalVat:      { type: Number, default: 0 },
    grandTotal:    { type: Number, default: 0 },
    amountTendered:{ type: Number, default: 0 },
    change:        { type: Number, default: 0 },
    customerName:  { type: String, trim: true, default: "" },
    customerPhone: { type: String, trim: true, default: "" },
    cashier:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    voidedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    voidedAt:      { type: Date, default: null },
    voidReason:    { type: String, trim: true, default: "" },
    notes:         { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

posSaleSchema.index({ business: 1, receiptNumber: 1 }, { unique: true });
posSaleSchema.index({ business: 1, location: 1, createdAt: -1 });
posSaleSchema.index({ business: 1, session: 1, createdAt: -1 });
posSaleSchema.index({ business: 1, status: 1, createdAt: -1 });
posSaleSchema.index({ business: 1, cashier: 1, createdAt: -1 });

export default mongoose.model("POSSale", posSaleSchema);
