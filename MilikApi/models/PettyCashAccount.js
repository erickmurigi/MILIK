import mongoose from "mongoose";

const PettyCashAccountSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    custodianName: {
      type: String,
      trim: true,
      default: "",
    },
    custodianUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    floatAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    currentBalance: {
      type: Number,
      default: 0,
    },
    glAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    voucherPrefix: {
      type: String,
      trim: true,
      default: "PCV",
      maxlength: 10,
    },
    status: {
      type: String,
      enum: ["active", "closed"],
      default: "active",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 1000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

PettyCashAccountSchema.index({ business: 1, status: 1 });
PettyCashAccountSchema.index({ business: 1, createdAt: -1 });

export default mongoose.model("PettyCashAccount", PettyCashAccountSchema);
