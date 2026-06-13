import mongoose from "mongoose";

const carWashAccountTopupSchema = new mongoose.Schema(
  {
    business:        { type: mongoose.Schema.Types.ObjectId, ref: "Company",              required: true, index: true },
    account:         { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCreditAccount", required: true, index: true },
    amount:          { type: Number, required: true, min: 0.01 },
    method:          { type: String, trim: true, default: "cash" },
    reference:       { type: String, trim: true, default: "" },
    cashbookAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    paymentDate:     { type: Date, default: Date.now },
    notes:           { type: String, trim: true, default: "" },
    createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isVoided:        { type: Boolean, default: false },
    voidedAt:        { type: Date,    default: null },
    voidedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    voidReason:      { type: String,  trim: true, default: "" },
  },
  { timestamps: true }
);

carWashAccountTopupSchema.index({ business: 1, account: 1, paymentDate: -1 });

export default mongoose.model("CarWashAccountTopup", carWashAccountTopupSchema);
