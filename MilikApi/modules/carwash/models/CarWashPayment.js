import mongoose from "mongoose";

const PAYMENT_METHODS = ["cash", "mpesa", "bank", "card", "prepaid", "other"];
const RECONCILIATION_STATUSES = ["pending", "reconciled", "flagged"];

const carWashPaymentSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null, index: true },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CarWashJob",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0.01 },
    discountAmount: { type: Number, min: 0, default: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true, default: "cash" },
    cashbookAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null, index: true },
    reference: { type: String, trim: true, default: "" },
    receivedFromPhone: { type: String, trim: true, default: null },
    paymentDate: { type: Date, default: Date.now, index: true },
    reconciliationStatus: { type: String, enum: RECONCILIATION_STATUSES, default: "pending", index: true },
    reconciliationNote: { type: String, trim: true, default: "" },
    reconciledAt: { type: Date, default: null },
    reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashPaymentSchema.index({ business: 1, job: 1 });
carWashPaymentSchema.index({ business: 1, paymentDate: -1 });
carWashPaymentSchema.index({ business: 1, branch: 1, paymentDate: -1 });
carWashPaymentSchema.index({ business: 1, method: 1 });
carWashPaymentSchema.index({ business: 1, cashbookAccount: 1 });
carWashPaymentSchema.index({ business: 1, reconciliationStatus: 1 });
// Covering indexes for payments list filters
carWashPaymentSchema.index({ business: 1, method: 1, paymentDate: -1 });
carWashPaymentSchema.index({ business: 1, reconciliationStatus: 1, paymentDate: -1 });
// Unique M-Pesa receipt: prevents duplicate payments from concurrent callbacks
carWashPaymentSchema.index(
  { business: 1, reference: 1 },
  { unique: true, partialFilterExpression: { method: "mpesa", reference: { $gt: "" } } }
);

export default mongoose.model("CarWashPayment", carWashPaymentSchema);
