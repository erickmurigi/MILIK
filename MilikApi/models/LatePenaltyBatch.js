import mongoose from "mongoose";

const LatePenaltyBatchItemSchema = new mongoose.Schema(
  {
    sourceInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantInvoice",
      required: true,
    },
    sourceInvoiceNumber: {
      type: String,
      default: "",
      trim: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      default: null,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    overdueDays: {
      type: Number,
      default: 0,
    },
    outstandingBalance: {
      type: Number,
      default: 0,
    },
    calculatedPenalty: {
      type: Number,
      default: 0,
    },
    penaltyInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantInvoice",
      default: null,
    },
    status: {
      type: String,
      enum: ["processed", "skipped", "duplicate", "failed"],
      default: "processed",
    },
    reason: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: true }
);

const LatePenaltyBatchSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    batchName: {
      type: String,
      required: true,
      trim: true,
    },
    rule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LatePenaltyRule",
      required: true,
      index: true,
    },
    ruleName: {
      type: String,
      default: "",
      trim: true,
    },
    runDate: {
      type: Date,
      required: true,
      index: true,
    },
    periodKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    invoicesCreatedCount: {
      type: Number,
      default: 0,
    },
    totalPenaltyAmount: {
      type: Number,
      default: 0,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["processed", "partial", "failed", "reversed_ready"],
      default: "processed",
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    items: {
      type: [LatePenaltyBatchItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

LatePenaltyBatchSchema.index({ business: 1, runDate: -1 });
LatePenaltyBatchSchema.index({ business: 1, rule: 1, periodKey: 1 });

export default mongoose.model("LatePenaltyBatch", LatePenaltyBatchSchema);
