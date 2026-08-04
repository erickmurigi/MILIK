// models/Lease.js
import mongoose from "mongoose";
import { canonicalizeBillingPeriodKey } from "../services/billingPeriodService.js";


const RentReviewRecordSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    reviewType: { type: String, enum: ["review", "escalation"], default: "review" },
    type: { type: String, enum: ["percentage", "amount"], default: "percentage" },
    value: { type: Number, default: 0, min: 0 },
    frequency: { type: String, trim: true, default: "yearly" },
    effectiveDate: { type: Date, required: true },
    note: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["Draft", "Scheduled", "Applied"], default: "Scheduled" },
    previousRent: { type: Number, default: 0, min: 0 },
    resultingRent: { type: Number, default: 0, min: 0 },
    appliedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

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
    agreementNumber: { type: String, trim: true, default: "" },
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
    },
    leaseType: {
      type: String,
      enum: ["at_will", "fixed"],
      default: "fixed",
    },
    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: function requireEndDateForFixedLease() {
        return String(this.leaseType || "fixed").trim().toLowerCase() === "fixed";
      },
      default: null,
    },
    rentAmount: { type: Number, required: true, min: 0 },
    depositAmount: { type: Number, required: true, min: 0, default: 0 },
    paymentDueDay: { type: Number, required: true, min: 1, max: 28, default: 5 },
    billingPeriodKey: { type: String, trim: true, default: "monthly" },
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
    autoInvoice: { type: Boolean, default: true },
    billingScheduleAdjustments: [BillingScheduleAdjustmentSchema],
    rentReviewRecords: [RentReviewRecordSchema],
  },
  { timestamps: true }
);

LeaseSchema.index({ business: 1, tenant: 1, status: 1 });
LeaseSchema.index({ business: 1, unit: 1, status: 1 });
LeaseSchema.index({ tenant: 1, startDate: -1 });
LeaseSchema.index({ unit: 1, endDate: 1 });
LeaseSchema.index(
  { business: 1, agreementNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      agreementNumber: { $type: "string", $ne: "" },
    },
  }
);
LeaseSchema.index({ business: 1, "billingScheduleAdjustments.periodKey": 1 });
LeaseSchema.index({ business: 1, status: 1, endDate: 1 });
LeaseSchema.index({ business: 1, tenant: 1, unit: 1, status: 1 });
LeaseSchema.index({ business: 1, landlord: 1 });
LeaseSchema.index({ business: 1, createdAt: -1 });

LeaseSchema.pre("validate", function normalizeLease(next) {
  if (typeof this.agreementNumber === "string") {
    this.agreementNumber = this.agreementNumber.trim();
  }

  if (this.isNew && !this.agreementNumber) {
    return next(new Error("Agreement number is required before saving a lease."));
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
  this.billingPeriodKey = canonicalizeBillingPeriodKey(this.billingPeriodKey || "monthly");
  this.noticePeriodDays = Number(this.noticePeriodDays || 0);
  this.lateFee = Number(this.lateFee || 0);
  this.version = Number(this.version || 1);

  if (Array.isArray(this.rentReviewRecords)) {
    this.rentReviewRecords = this.rentReviewRecords
      .filter((item) => item && item.id && item.effectiveDate)
      .map((item) => {
        const next = {
          ...item,
          id: String(item.id).trim(),
          reviewType: ["review", "escalation"].includes(String(item.reviewType || "").trim().toLowerCase())
            ? String(item.reviewType || "").trim().toLowerCase()
            : "review",
          type: ["percentage", "amount"].includes(String(item.type || "").trim().toLowerCase())
            ? String(item.type || "").trim().toLowerCase()
            : "percentage",
          value: Number(item.value || 0),
          frequency: String(item.frequency || "yearly").trim().toLowerCase() || "yearly",
          effectiveDate: new Date(item.effectiveDate),
          note: typeof item.note === "string" ? item.note.trim() : "",
          status: ["Draft", "Scheduled", "Applied"].includes(String(item.status || "Scheduled"))
            ? String(item.status || "Scheduled")
            : "Scheduled",
          previousRent: Number(item.previousRent || 0),
          resultingRent: Number(item.resultingRent || 0),
          appliedAt: item.appliedAt ? new Date(item.appliedAt) : null,
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
          updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
        };
        return next;
      })
      .sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
  }

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
