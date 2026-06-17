import mongoose from "mongoose";

const carWashMpesaNotificationSchema = new mongoose.Schema(
  {
    business:   { type: mongoose.Schema.Types.ObjectId, ref: "Company",       required: true, index: true },
    branch:     { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null },
    shortCode:  { type: String, trim: true, default: "" },

    // Extracted from Safaricom payload
    transactionCode: { type: String, trim: true, default: "" },
    billRefNumber:   { type: String, trim: true, default: "" }, // raw account reference
    plate:           { type: String, trim: true, default: "" }, // normalized plate
    amount:          { type: Number, default: 0 },
    msisdn:          { type: String, trim: true, default: "" }, // normalised 07xx
    maskedMsisdn:    { type: String, trim: true, default: "" }, // raw Safaricom-hashed MSISDN when real phone is unavailable
    senderName:      { type: String, trim: true, default: "" }, // FirstName + MiddleName + LastName from Safaricom
    transactionDate: { type: Date, default: null },

    // Processing result
    status: {
      type: String,
      enum: ["matched", "unmatched", "duplicate", "rejected", "error", "stk_pending"],
      default: "unmatched",
      index: true,
    },
    matchedJob:     { type: mongoose.Schema.Types.ObjectId, ref: "CarWashJob",     default: null },
    matchedPayment: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashPayment", default: null },
    resultCode: { type: Number, default: 0 },
    resultDesc: { type: String, trim: true, default: "" },
    notes:      { type: String, trim: true, default: "" },

    // Reversal tracking
    isReversed:   { type: Boolean, default: false },
    reversalRef:  { type: String, trim: true, default: "" }, // Safaricom reversal transaction code or manual note
    reversalDate: { type: Date, default: null },

    // Stamp SMS body deferred until TSQ resolves the real phone
    pendingStampSmsBody: { type: String, default: null },

    // Full raw Safaricom payload — kept for audit / debugging
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

carWashMpesaNotificationSchema.index({ business: 1, createdAt: -1 });
carWashMpesaNotificationSchema.index({ business: 1, plate: 1 });
carWashMpesaNotificationSchema.index({ business: 1, status: 1, createdAt: -1 });
// Compound for duplicate check: business + transactionCode query in confirmCarWashCallback
carWashMpesaNotificationSchema.index({ business: 1, transactionCode: 1 });
// Global uniqueness on transactionCode prevents two concurrent callbacks from both
// passing the duplicate check before either saves a "matched" notification.
// partialFilterExpression excludes empty-string codes (STK pending before receipt arrives).
carWashMpesaNotificationSchema.index(
  { transactionCode: 1 },
  { unique: true, partialFilterExpression: { transactionCode: { $gt: "" }, status: "matched" } }
);

export default mongoose.model("CarWashMpesaNotification", carWashMpesaNotificationSchema);
