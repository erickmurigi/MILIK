import mongoose from "mongoose";
import { round2 } from "../../../utils/math.js";

const STATUSES = ["pending", "approved", "cancelled"];

// The company's own agency commission for selling on an owner's behalf — structurally parallel to
// SaleCommission (the broker's cut) but simpler: no WHT, no payout/disbursement, since this is the
// company's own recognized revenue, never paid out to a third party. Created once per deal, alongside
// the broker SaleCommission, only when the deal's listing -> project resolves to a non-null owner.
const saleOwnerCommissionSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    commissionNumber: { type: String, required: true, trim: true },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", required: true, index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwner", required: true, index: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", default: null },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer", default: null },
    saleAmount: { type: Number, required: true, min: 0 },
    commissionRate: { type: Number, required: true, min: 0 },
    commissionType: { type: String, enum: ["percentage", "flat"], default: "percentage" },
    commissionAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: STATUSES, default: "pending", index: true },
    // Snapshot of SaleSettings.commissionReleaseSchedule.ownerCommissionTiers at creation time. Empty =
    // immediate release (today's exact behavior) — nothing below is used.
    releaseSchedule: {
      type: [{ _id: false, thresholdPct: Number, releasePct: Number }],
      default: [],
    },
    // True when releaseSchedule was set per-deal (buyer/broker agreed different terms) rather than
    // copied from company settings — resyncOpenCommissionReleaseSchedules skips these so a later
    // company-wide schedule edit never overwrites a deal-negotiated one.
    releaseScheduleOverridden: { type: Boolean, default: false },
    releasedAmount: { type: Number, default: 0, min: 0 },
    tierReleases: [{
      _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
      thresholdPct: Number,
      releasePct: Number,
      amount: Number,
      accruedAt: { type: Date, default: Date.now },
    }],
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleOwnerCommissionSchema.pre("validate", function (next) {
  for (const f of ["commissionAmount", "releasedAmount"]) {
    if (typeof this[f] === "number" && this.isModified(f)) this[f] = round2(this[f]);
  }
  next();
});

saleOwnerCommissionSchema.index({ business: 1, commissionNumber: 1 }, { unique: true });
saleOwnerCommissionSchema.index({ business: 1, owner: 1, status: 1 });
saleOwnerCommissionSchema.index({ business: 1, deal: 1 });
saleOwnerCommissionSchema.index({ business: 1, status: 1, createdAt: -1 });

export default mongoose.model("SaleOwnerCommission", saleOwnerCommissionSchema);
