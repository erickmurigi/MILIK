import mongoose from "mongoose";

const MeterReadingSchema = new mongoose.Schema(
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
      required: true,
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
    utilityType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    meterNumber: {
      type: String,
      default: "",
      trim: true,
    },
    billingPeriod: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    readingDate: {
      type: Date,
      required: true,
      index: true,
    },
    previousReading: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    currentReading: {
      type: Number,
      required: true,
      min: 0,
    },
    unitsConsumed: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    isMeterReset: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["draft", "billed", "void"],
      default: "draft",
      index: true,
    },
    billedInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantInvoice",
      default: null,
      index: true,
    },
    billedAt: {
      type: Date,
      default: null,
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
    voidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

MeterReadingSchema.index({ business: 1, property: 1, unit: 1, readingDate: -1 });
MeterReadingSchema.index({ business: 1, utilityType: 1, billingPeriod: 1 });
MeterReadingSchema.index({ business: 1, unit: 1, utilityType: 1, billingPeriod: 1 });

export default mongoose.model("MeterReading", MeterReadingSchema);
