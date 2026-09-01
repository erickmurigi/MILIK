import mongoose from "mongoose";

const COMMISSION_STATUSES = ["earned", "payable", "paid", "cancelled"];

const lineBreakdownSchema = new mongoose.Schema(
  {
    service: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashService", default: null },
    serviceName: { type: String, trim: true, default: "" },
    linePrice: { type: Number, default: 0 },
    commissionType: { type: String, enum: ["fixed", "percentage"], default: "fixed" },
    commissionRate: { type: Number, default: 0 },
    lineCommissionAmount: { type: Number, default: 0 },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCommissionRule", default: null },
  },
  { _id: false }
);

const carWashStaffCommissionSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null, index: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashJob", required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaff", required: true, index: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashService", default: null, index: true },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCommissionRule", default: null },
    jobNumber: { type: String, trim: true, default: "" },
    serviceName: { type: String, trim: true, default: "" },
    baseAmount: { type: Number, required: true, min: 0, default: 0 },
    commissionType: { type: String, enum: ["fixed", "percentage"], required: true, default: "fixed" },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
      validate: {
        validator(v) { return this.commissionType !== 'percentage' || v <= 100; },
        message: 'Percentage commission rate cannot exceed 100',
      },
    },
    commissionAmount: { type: Number, required: true, min: 0, default: 0 },
    lineBreakdown: { type: [lineBreakdownSchema], default: [] },
    status: { type: String, enum: COMMISSION_STATUSES, default: "earned", index: true },
    earnedAt: { type: Date, default: Date.now, index: true },
    payableAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    payout: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCommissionPayout", default: null, index: true },
    accrualLedgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    accrualReversalLedgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    payoutLedgerEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: "FinancialLedgerEntry" }],
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashStaffCommissionSchema.index({ business: 1, job: 1, staff: 1 }, { unique: true });
carWashStaffCommissionSchema.index({ business: 1, job: 1 });
carWashStaffCommissionSchema.index({ business: 1, status: 1, earnedAt: -1 });
carWashStaffCommissionSchema.index({ business: 1, staff: 1, status: 1 });
carWashStaffCommissionSchema.index({ business: 1, branch: 1, earnedAt: -1 });
// Per-staff commission list sorted by date (commissions page filter)
carWashStaffCommissionSchema.index({ business: 1, staff: 1, status: 1, earnedAt: -1 });

export default mongoose.model("CarWashStaffCommission", carWashStaffCommissionSchema);
