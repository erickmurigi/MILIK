import mongoose from "mongoose";

const PAYMENT_METHODS = ["cash", "mpesa", "bank", "card", "other"];
const RECONCILIATION_STATUSES = ["pending", "reconciled", "flagged"];

const carWashPaymentSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null, index: true },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CarWashJob",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true, default: "cash" },
    cashbookAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null, index: true },
    reference: { type: String, trim: true, default: "" },
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
carWashPaymentSchema.index({ business: 1, reference: 1 });

export default mongoose.model("CarWashPayment", carWashPaymentSchema);
