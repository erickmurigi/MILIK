import mongoose from "mongoose";

const ReceiptSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property" },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: "Landlord" },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "Unit", required: true },
    amount: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["mobile_money", "bank_transfer", "cash", "check", "credit_card"],
      required: true,
    },
    description: { type: String },
    receiptDate: { type: Date, required: true },
    receiptNumber: { type: String, trim: true },
    referenceNumber: { type: String, trim: true },
    cashbook: { type: String, default: "Main Cashbook" },
    paymentType: {
      type: String,
      enum: ["rent", "deposit", "utility", "late_fee", "other"],
      default: "rent",
    },
    dueDate: { type: Date },
    isConfirmed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

ReceiptSchema.index({ business: 1, receiptNumber: 1 }, { unique: true, sparse: true });
ReceiptSchema.index({ business: 1, referenceNumber: 1 }, { sparse: true });

export default mongoose.model("Receipt", ReceiptSchema);
