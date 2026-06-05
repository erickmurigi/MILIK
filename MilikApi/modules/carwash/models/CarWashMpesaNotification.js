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
    transactionDate: { type: Date, default: null },

    // Processing result
    status: {
      type: String,
      enum: ["matched", "unmatched", "duplicate", "rejected", "error"],
      default: "unmatched",
      index: true,
    },
    matchedJob:     { type: mongoose.Schema.Types.ObjectId, ref: "CarWashJob",     default: null },
    matchedPayment: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashPayment", default: null },
    resultCode: { type: Number, default: 0 },
    resultDesc: { type: String, trim: true, default: "" },
    notes:      { type: String, trim: true, default: "" },

    // Full raw Safaricom payload — kept for audit / debugging
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

carWashMpesaNotificationSchema.index({ business: 1, createdAt: -1 });
carWashMpesaNotificationSchema.index({ business: 1, plate: 1 });
carWashMpesaNotificationSchema.index({ transactionCode: 1 }, { sparse: true });

export default mongoose.model("CarWashMpesaNotification", carWashMpesaNotificationSchema);
