import mongoose from "mongoose";

const LatePenaltyRuleSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    ruleName: {
      type: String,
      required: true,
      trim: true,
    },
    effectiveFrom: {
      type: Date,
      required: true,
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    postingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
      index: true,
    },
    graceDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    minimumOverdueDays: {
      type: Number,
      default: 1,
      min: 0,
    },
    penalizeItem: {
      type: String,
      enum: [
        "rent_only",
        "current_period_rent_only",
        "current_period_bill_balance_only",
        "all_arrears",
        "outstanding_invoice_balance",
      ],
      default: "outstanding_invoice_balance",
      index: true,
    },
    calculationType: {
      type: String,
      enum: [
        "flat_amount",
        "percentage_overdue_balance",
        "daily_fixed_amount",
        "daily_percentage",
      ],
      default: "percentage_overdue_balance",
    },
    rateOrAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    minimumBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    maximumBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    maximumPenaltyCap: {
      type: Number,
      default: 0,
      min: 0,
    },
    applyAutomatically: {
      type: Boolean,
      default: false,
    },
    repeatFrequency: {
      type: String,
      enum: ["manual", "daily", "monthly"],
      default: "manual",
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

LatePenaltyRuleSchema.index({ business: 1, ruleName: 1 }, { unique: true });
LatePenaltyRuleSchema.index({ business: 1, active: 1, effectiveFrom: -1 });

export default mongoose.model("LatePenaltyRule", LatePenaltyRuleSchema);
