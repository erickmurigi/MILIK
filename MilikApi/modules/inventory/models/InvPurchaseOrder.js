import mongoose from "mongoose";

const PO_STATUSES = ["draft", "sent", "partially_received", "received", "cancelled"];

const poLineSchema = new mongoose.Schema(
  {
    product:      { type: mongoose.Schema.Types.ObjectId, ref: "InvProduct", required: true },
    qtyOrdered:   { type: Number, required: true, min: 0 },
    qtyReceived:  { type: Number, default: 0, min: 0 },
    unitCost:     { type: Number, required: true, min: 0 },
    totalCost:    { type: Number, default: 0 },
  },
  { _id: true }
);

const invPurchaseOrderSchema = new mongoose.Schema(
  {
    business:     { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    poNumber:     { type: String, required: true, trim: true },
    supplier:     { type: mongoose.Schema.Types.ObjectId, ref: "InvSupplier", required: true },
    location:     { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true },  // receive into
    status:       { type: String, enum: PO_STATUSES, default: "draft", index: true },
    lines:        [poLineSchema],
    orderDate:    { type: Date, default: Date.now },
    expectedDate: { type: Date, default: null },
    receivedAt:   { type: Date, default: null },
    totalAmount:  { type: Number, default: 0 },
    notes:        { type: String, trim: true, default: "" },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invPurchaseOrderSchema.index({ business: 1, poNumber: 1 }, { unique: true });
invPurchaseOrderSchema.index({ business: 1, status: 1, createdAt: -1 });
invPurchaseOrderSchema.index({ business: 1, supplier: 1, createdAt: -1 });
invPurchaseOrderSchema.index({ business: 1, location: 1, createdAt: -1 });

export default mongoose.model("InvPurchaseOrder", invPurchaseOrderSchema);
