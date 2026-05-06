import mongoose from "mongoose";

const COMMISSION_STATUSES = ["earned", "payable", "paid", "cancelled"];

const carWashStaffCommissionSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashJob", required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaff", required: true, index: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashService", default: null, index: true },
    rule: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCommissionRule", default: null },
    jobNumber: { type: String, trim: true, default: "" },
    serviceName: { type: String, trim: true, default: "" },
    baseAmount: { type: Number, required: true, min: 0, default: 0 },
    commissionType: { type: String, enum: ["fixed", "percentage"], required: true, default: "fixed" },
    commissionRate: { type: Number, required: true, min: 0, default: 0 },
    commissionAmount: { type: Number, required: true, min: 0, default: 0 },
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
carWashStaffCommissionSchema.index({ business: 1, status: 1, earnedAt: -1 });
carWashStaffCommissionSchema.index({ business: 1, staff: 1, status: 1 });

export default mongoose.model("CarWashStaffCommission", carWashStaffCommissionSchema);
