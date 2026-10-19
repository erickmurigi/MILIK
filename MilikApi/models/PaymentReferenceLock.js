import mongoose from "mongoose";

// One row per claimed external payment reference (bank ref, M-Pesa code, cheque no...) system-wide, scoped
// to a business. The unique index is the actual enforcement mechanism — everything in paymentReferenceGuard.js
// is a friendly wrapper around insert/delete against it. sourceModel/sourceId say which document holds the
// reference, so a conflict can be reported to the user ("already used on Sale Payment PMT-00004").
const PaymentReferenceLockSchema = new mongoose.Schema(
  {
    business:     { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    referenceKey: { type: String, required: true },
    rawReference: { type: String, required: true },
    sourceModel:  { type: String, required: true },
    sourceId:     { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

PaymentReferenceLockSchema.index({ business: 1, referenceKey: 1 }, { unique: true });
PaymentReferenceLockSchema.index({ sourceModel: 1, sourceId: 1 });

export default mongoose.model("PaymentReferenceLock", PaymentReferenceLockSchema);
