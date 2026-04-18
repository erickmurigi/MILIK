// models/Lease.js
import mongoose from "mongoose";

const BillingScheduleAdjustmentSchema = new mongoose.Schema(
  {
    periodKey: { type: String, required: true, trim: true },
    fromDate: { type: Date },
    toDate: { type: Date },
    rentAmount: { type: Number, default: 0, min: 0 },
    utilityAmount: { type: Number, default: 0, min: 0 },
    utilityNames: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: ["active", "frozen", "deleted"],
      default: "active",
    },
    note: { type: String, default: "", trim: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const LeaseSchema = new mongoose.Schema(
  {
    agreementNumber: { type: String, trim: true },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      default: null,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    leaseType: {
      type: String,
      enum: ["at_will", "fixed"],
      default: "fixed",
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    rentAmount: { type: Number, required: true, min: 0 },
    depositAmount: { type: Number, required: true, min: 0, default: 0 },
    paymentDueDay: { type: Number, required: true, min: 1, max: 28, default: 5 },
    noticePeriodDays: { type: Number, default: 30, min: 0 },
    lateFee: { type: Number, default: 0, min: 0 },
    terms: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: [
        "draft",
        "pending_signature",
        "active",
        "expired",
        "terminated",
        "renewed",
        "cancelled",
      ],
      default: "active",
    },
    documentUrl: { type: String, trim: true, default: "" },
    documentName: { type: String, trim: true, default: "" },
    signedByTenant: { type: Boolean, default: false },
    signedByLandlord: { type: Boolean, default: false },
    signedDate: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    terminatedAt: { type: Date, default: null },
    terminationReason: { type: String, trim: true, default: "" },
    version: { type: Number, default: 1, min: 1 },
    renewalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lease",
      default: null,
    },
    autoCreatedFromTenant: { type: Boolean, default: false },
    billingScheduleAdjustments: [BillingScheduleAdjustmentSchema],
  },
  { timestamps: true }
);

LeaseSchema.index({ business: 1, status: 1 });
LeaseSchema.index({ business: 1, tenant: 1, status: 1 });
LeaseSchema.index({ business: 1, unit: 1, status: 1 });
LeaseSchema.index({ tenant: 1, startDate: -1 });
LeaseSchema.index({ unit: 1, endDate: 1 });
LeaseSchema.index({ business: 1, agreementNumber: 1 }, { unique: true, sparse: true });
LeaseSchema.index({ business: 1, "billingScheduleAdjustments.periodKey": 1 });

LeaseSchema.pre("validate", function normalizeLease(next) {
  if (typeof this.agreementNumber === "string") {
    this.agreementNumber = this.agreementNumber.trim();
  }

  if (typeof this.documentUrl === "string") {
    this.documentUrl = this.documentUrl.trim();
  }

  if (typeof this.documentName === "string") {
    this.documentName = this.documentName.trim();
  }

  if (typeof this.terms === "string") {
    this.terms = this.terms.trim();
  }

  if (typeof this.terminationReason === "string") {
    this.terminationReason = this.terminationReason.trim();
  }

  if (typeof this.leaseType === "string") {
    this.leaseType = this.leaseType.trim().toLowerCase();
  }

  if (typeof this.status === "string") {
    this.status = this.status.trim().toLowerCase();
  }

  this.rentAmount = Number(this.rentAmount || 0);
  this.depositAmount = Number(this.depositAmount || 0);
  this.paymentDueDay = Number(this.paymentDueDay || 5);
  this.noticePeriodDays = Number(this.noticePeriodDays || 0);
  this.lateFee = Number(this.lateFee || 0);
  this.version = Number(this.version || 1);

  if (this.startDate && this.endDate) {
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);

    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      return next(new Error("Lease end date must be after the start date."));
    }
  }

  if (this.status === "active" && !this.activatedAt) {
    this.activatedAt = new Date();
  }

  if (this.status !== "terminated" && this.terminatedAt) {
    this.terminatedAt = null;
  }

  if (this.signedByTenant && this.signedByLandlord && !this.signedDate) {
    this.signedDate = new Date();
  }

  return next();
});

export default mongoose.model("Lease", LeaseSchema);
