import mongoose from "mongoose";

const invSupplierPaymentSchema = new mongoose.Schema(
  {
    business:            { type: mongoose.Schema.Types.ObjectId, ref: "Company",          required: true, index: true },
    paymentNumber:       { type: String, required: true, trim: true },
    supplier:            { type: mongoose.Schema.Types.ObjectId, ref: "InvSupplier",      required: true, index: true },
    purchaseOrder:       { type: mongoose.Schema.Types.ObjectId, ref: "InvPurchaseOrder", default: null,  index: true },
    amount:              { type: Number, required: true, min: 0 },
    cashbookAccountId:   { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount",   required: true },
    cashbookAccountName: { type: String, trim: true, default: "" },
    paymentDate:         { type: Date, required: true },
    reference:           { type: String, trim: true, default: "" },
    notes:               { type: String, trim: true, default: "" },
    status:              { type: String, enum: ["confirmed", "voided"], default: "confirmed" },
    voidedAt:            { type: Date, default: null },
    voidedBy:            { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy:           { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:           { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invSupplierPaymentSchema.index({ business: 1, paymentNumber: 1 }, { unique: true });
invSupplierPaymentSchema.index({ business: 1, supplier: 1,      paymentDate: -1 });
invSupplierPaymentSchema.index({ business: 1, purchaseOrder: 1, paymentDate: -1 });
invSupplierPaymentSchema.index({ business: 1, status: 1,        paymentDate: -1 });

export default mongoose.model("InvSupplierPayment", invSupplierPaymentSchema);
