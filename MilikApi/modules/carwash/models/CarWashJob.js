import mongoose from "mongoose";

const JOB_STATUSES = ["waiting", "washing", "drying", "ready", "done", "paid", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "partial", "paid"];
const JOB_TYPES = ["vehicle", "carpet", "balance_bf"];

const serviceLineSchema = new mongoose.Schema(
  {
    service:    { type: mongoose.Schema.Types.ObjectId, ref: "CarWashService", default: null },
    serviceName:{ type: String, trim: true, default: "" },
    vehicleType:{ type: String, trim: true, default: "" },
    price:      { type: Number, min: 0, default: 0 },
    // Optional: specific staff assigned to this line only.
    // If set, only this staff earns commission for the line (no splitting).
    // If null, all job-level assignedStaff share the commission equally.
    lineStaff:   [{ type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaff" }],
    isRewardLine: { type: Boolean, default: false },
  },
  { _id: false }
);

const carWashJobSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null, index: true },
    jobType: { type: String, enum: JOB_TYPES, default: "vehicle", index: true },
    jobNumber: { type: String, required: true, trim: true, minlength: 1 },
    customerName: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    maskedMsisdn: { type: String, trim: true, default: null },
    plateNumber: { type: String, trim: true, uppercase: true, default: "" },
    itemDescription: { type: String, trim: true, default: "" },
    expectedReadyAt: { type: Date, default: null },

    // Deprecated single-service fields — kept for backward compat with existing jobs
    service: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashService", default: null },
    serviceName: { type: String, trim: true, default: "" },
    vehicleType: { type: String, trim: true, default: "" },

    // Multi-service lines (new)
    serviceLines: { type: [serviceLineSchema], default: [] },

    price:          { type: Number, required: true, min: 0, default: 0 },
    taxAmount:      { type: Number, min: 0, default: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: JOB_STATUSES, default: "waiting", index: true },

    // Multi-staff support (array; old jobs may have a scalar coerced to [id])
    assignedStaff: [{ type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaff" }],

    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "unpaid", index: true },
    rewardRedemption: { type: Boolean, default: false },
    creditAccount: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCreditAccount", default: null, index: true },
    // Voucher job — set automatically when the linked creditAccount is of type "voucher"
    isVoucher:         { type: Boolean, default: false, index: true },
    voucherCompanyName:{ type: String, trim: true, default: "" },
    // Pay-later — supervisor explicitly deferred payment collection
    payLater:   { type: Boolean, default: false, index: true },
    payLaterAt: { type: Date, default: null },
    payLaterBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    notes: { type: String, trim: true, default: "" },
    // Carpet job photos — stored as relative URL paths e.g. /uploads/carwash/carpets/uuid.jpg
    photos: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashJobSchema.index({ business: 1, jobNumber: 1 }, { unique: true });
carWashJobSchema.index({ business: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, branch: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, branch: 1, status: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, jobType: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, plateNumber: 1 });
carWashJobSchema.index({ business: 1, jobType: 1, status: 1 });
carWashJobSchema.index({ business: 1, creditAccount: 1, createdAt: 1 });
// Covering indexes for list-page filters that combine status/paymentStatus with sort
carWashJobSchema.index({ business: 1, status: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, paymentStatus: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, assignedStaff: 1, createdAt: -1 });
// M-Pesa plate matching: covers the plate + open-job filter in one scan
carWashJobSchema.index({ business: 1, plateNumber: 1, status: 1, paymentStatus: 1 });
// Duplicate-plate-today check + loyalty plate stats with date range
carWashJobSchema.index({ business: 1, plateNumber: 1, createdAt: -1 });
// Combined status + paymentStatus filter with sort (job list page multi-filter)
carWashJobSchema.index({ business: 1, status: 1, paymentStatus: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, isVoucher: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, payLater: 1, status: 1, createdAt: -1 });

export default mongoose.model("CarWashJob", carWashJobSchema);
