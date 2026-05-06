import mongoose from "mongoose";

const DESTINATIONS = ["bank", "mpesa", "safe", "other"];
const STATUSES = ["pending", "confirmed", "cancelled"];

const carWashDepositSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    depositNumber: { type: String, required: true, trim: true },
    depositDate: { type: Date, default: Date.now, index: true },
    amount: { type: Number, required: true, min: 0 },
    destination: { type: String, enum: DESTINATIONS, default: "bank", index: true },
    cashbookAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null, index: true },
    reference: { type: String, trim: true, default: "" },
    status: { type: String, enum: STATUSES, default: "pending", index: true },
    notes: { type: String, trim: true, default: "" },
    depositedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    confirmedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashDepositSchema.index({ business: 1, depositNumber: 1 }, { unique: true });
carWashDepositSchema.index({ business: 1, depositDate: -1 });
carWashDepositSchema.index({ business: 1, status: 1 });
carWashDepositSchema.index({ business: 1, cashbookAccount: 1 });

export default mongoose.model("CarWashDeposit", carWashDepositSchema);
