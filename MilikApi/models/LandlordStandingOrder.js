import mongoose from "mongoose";

const destinationSchema = new mongoose.Schema(
  {
    accountName: { type: String, default: "", trim: true },
    accountNumber: { type: String, default: "", trim: true },
    bankName: { type: String, default: "", trim: true },
    branchName: { type: String, default: "", trim: true },
    mobileNumber: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const LandlordStandingOrderSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    frequency: {
      type: String,
      enum: ["monthly", "quarterly", "semi_annually", "annually", "custom"],
      default: "monthly",
      index: true,
    },
    dayOfMonth: {
      type: Number,
      min: 1,
      max: 31,
      default: 5,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "mobile_money", "cash", "check", "credit_card"],
      default: "bank_transfer",
    },
    destination: {
      type: destinationSchema,
      default: () => ({}),
    },
    narration: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["draft", "active", "paused", "stopped"],
      default: "draft",
      index: true,
    },
    nextRunDate: {
      type: Date,
      default: null,
    },
    lastRunDate: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
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

LandlordStandingOrderSchema.index({ business: 1, createdAt: -1 });
LandlordStandingOrderSchema.index({ business: 1, landlord: 1, status: 1, createdAt: -1 });
LandlordStandingOrderSchema.index({ business: 1, referenceNo: 1 }, { unique: true });

const LandlordStandingOrder =
  mongoose.models.LandlordStandingOrder ||
  mongoose.model("LandlordStandingOrder", LandlordStandingOrderSchema);

export default LandlordStandingOrder;
