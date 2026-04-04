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
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["maintenance", "repair", "utility", "tax", "insurance", "supplies", "other"],
      default: "other",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
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
      enum: ["draft", "submitted", "approved", "rejected", "converted"],
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
  },
  { timestamps: true }
);

ExpenseRequisitionSchema.index({ business: 1, createdAt: -1 });
ExpenseRequisitionSchema.index({ business: 1, property: 1, status: 1, createdAt: -1 });
ExpenseRequisitionSchema.index({ business: 1, referenceNo: 1 }, { unique: true });

const ExpenseRequisition =
  mongoose.models.ExpenseRequisition ||
  mongoose.model("ExpenseRequisition", ExpenseRequisitionSchema);

export default ExpenseRequisition;
