import mongoose from "mongoose";

const PettyCashReplenishmentSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    pettyCashAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PettyCashAccount",
      required: true,
      index: true,
    },
    replenishmentNumber: {
      type: String,
      required: true,
      trim: true,
    },
    requestDate: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    balanceBeforeReplenishment: {
      type: Number,
      default: 0,
    },
    targetFloat: {
      type: Number,
      default: 0,
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "posted", "rejected"],
      default: "pending",
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    postedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },
    postedToLedger: {
      type: Boolean,
      default: false,
    },
    ledgerEntries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FinancialLedgerEntry",
      },
    ],
  },
  { timestamps: true }
);

PettyCashReplenishmentSchema.index({ business: 1, pettyCashAccount: 1, requestDate: -1 });
PettyCashReplenishmentSchema.index({ pettyCashAccount: 1, replenishmentNumber: 1 }, { unique: true });

export default mongoose.model("PettyCashReplenishment", PettyCashReplenishmentSchema);
