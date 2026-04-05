import mongoose from "mongoose";

const ExpenseRequisitionSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      default: null,
      index: true,
    },
    serviceProvider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["maintenance", "repair", "utility", "tax", "insurance", "supplies", "other", "general"],
      default: "other",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    requestDate: {
      type: Date,
      default: Date.now,
    },
    neededBy: {
      type: Date,
      default: null,
    },
    neededByDate: {
      type: Date,
      default: null,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected", "converted", "cancelled"],
      default: "draft",
      index: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    vendorName: {
      type: String,
      default: "",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
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
      default: "",
      trim: true,
    },
    linkedVoucher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentVoucher",
      default: null,
      index: true,
    },
    referenceNo: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    requisitionNo: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
  },
  { timestamps: true }
);

ExpenseRequisitionSchema.pre("validate", function syncCompatibilityFields(next) {
  if (!this.referenceNo && this.requisitionNo) {
    this.referenceNo = this.requisitionNo;
  }
  if (!this.requisitionNo && this.referenceNo) {
    this.requisitionNo = this.referenceNo;
  }
  if (!this.neededByDate && this.neededBy) {
    this.neededByDate = this.neededBy;
  }
  if (!this.neededBy && this.neededByDate) {
    this.neededBy = this.neededByDate;
  }
  next();
});

ExpenseRequisitionSchema.index({ business: 1, createdAt: -1 });
ExpenseRequisitionSchema.index({ business: 1, property: 1, status: 1, createdAt: -1 });
ExpenseRequisitionSchema.index({ business: 1, referenceNo: 1 }, { unique: true });
ExpenseRequisitionSchema.index({ business: 1, requisitionNo: 1 });
ExpenseRequisitionSchema.index({ business: 1, serviceProvider: 1, createdAt: -1 });

const ExpenseRequisition =
  mongoose.models.ExpenseRequisition ||
  mongoose.model("ExpenseRequisition", ExpenseRequisitionSchema);

export default ExpenseRequisition;
