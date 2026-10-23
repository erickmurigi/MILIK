import mongoose from "mongoose";

// Real cash an advocate sends Pink House specifically to settle its own (agency) commission on deals
// whose proceeds were collected into the advocate's trust account — distinct from
// SaleAdvocateRechargeRemittance (recoverable owner expenses). Only ever exists for commission tiers
// whose income was DEFERRED at release time
// (SaleOwnerCommission.tierReleases[].deferred) — a tier recognized immediately (non-trust deal) has
// nothing to pay out here. See propertySaleAccountingService.js's postAgencyCommissionPayout: this is
// the one event that finally credits 4430 Commission Income — Agency Fees for a deferred tier.
//
// One payout can settle several of an advocate's commissions in one go (e.g. several plots that closed
// around the same time) — allocations[] mirrors the same pattern SaleOwnerPayout/SaleAdvocateRechargeRemittance
// already use for a combined, multi-record settlement.
const allocationSchema = new mongoose.Schema(
  {
    ownerCommission: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwnerCommission", required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleAgencyCommissionPayoutSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    payoutNumber: { type: String, required: true, trim: true },
    advocate: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAdvocate", required: true, index: true },
    allocations: { type: [allocationSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    // The company account the money actually landed in
    cashbook: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    reference: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    // Same voided/audit-trail pattern used throughout this module — the record stays, the GL is
    // reversed, and every outstanding/trust-balance aggregate excludes it.
    status: { type: String, enum: ["posted", "cancelled"], default: "posted" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleAgencyCommissionPayoutSchema.index({ business: 1, payoutNumber: 1 }, { unique: true });
saleAgencyCommissionPayoutSchema.index({ business: 1, advocate: 1, date: -1 });
saleAgencyCommissionPayoutSchema.index({ business: 1, "allocations.ownerCommission": 1 });

export default mongoose.model("SaleAgencyCommissionPayout", saleAgencyCommissionPayoutSchema);
