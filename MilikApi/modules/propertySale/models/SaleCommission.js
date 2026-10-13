import mongoose from "mongoose";
import { round2 } from "../../../utils/math.js";
import { WHT_MAX_RATE } from "../../../utils/withholdingTax.js";

const COMMISSION_STATUSES = ["pending", "approved", "paid", "cancelled", "reversed"];
const PAYOUT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const TIER_RELEASE_STATUSES = ["accrued", "paid", "clawback_receivable"];
const CLAWBACK_STATUSES = ["none", "outstanding", "settled"];

const saleCommissionSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    commissionNumber: { type: String, required: true, trim: true },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", required: true, index: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent", required: true, index: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", default: null },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer", default: null },
    saleAmount: { type: Number, required: true, min: 0 },
    commissionRate: { type: Number, required: true, min: 0 },
    commissionType: { type: String, enum: ["percentage", "flat"], default: "percentage" },
    commissionAmount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: COMMISSION_STATUSES, default: "pending", index: true },
    payoutDate: { type: Date, default: null },
    payoutMethod: { type: String, enum: PAYOUT_METHODS, default: null },
    payoutReference: { type: String, trim: true, default: "" },
    whtRate:   { type: Number, default: 5, min: 0, max: WHT_MAX_RATE },
    whtAmount: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, default: 0, min: 0 },
    splits: [{
      coAgent:          { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent" },
      splitPercentage:  { type: Number, default: 0 },
      splitAmount:      { type: Number, default: 0 },
      notes:            { type: String, trim: true, default: "" },
    }],
    // Snapshotted at creation from the deal's listing -> project -> owner, so a later reassignment of a
    // project's owner never retroactively changes a deal already in progress. Null = no owner (legacy/
    // self-sold deal) — every staged-release field below stays untouched in that case.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwner", default: null, index: true },
    // Snapshot of SaleSettings.commissionReleaseSchedule.brokerCommissionTiers at creation time. Empty =
    // immediate release (today's exact behavior) — nothing below is used.
    releaseSchedule: {
      type: [{ _id: false, thresholdPct: Number, releasePct: Number }],
      default: [],
    },
    releasedAmount: { type: Number, default: 0, min: 0 },
    paidOutAmount: { type: Number, default: 0, min: 0 },
    tierReleases: [{
      _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
      thresholdPct: Number,
      releasePct: Number,
      amount: Number,
      status: { type: String, enum: TIER_RELEASE_STATUSES, default: "accrued" },
      accruedAt: { type: Date, default: Date.now },
      paidAt: { type: Date, default: null },
    }],
    // Populated only on deal cancellation when a tier was already paid out in cash — can't un-send that
    // cash, so it becomes a receivable to recover from the broker instead.
    clawbackReceivable: {
      amount: { type: Number, default: 0 },
      createdAt: { type: Date, default: null },
      settledAmount: { type: Number, default: 0 },
      status: { type: String, enum: CLAWBACK_STATUSES, default: "none" },
    },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Money fields are stored at 2dp so they always match what the accounting service posts (round2)
saleCommissionSchema.pre("validate", function (next) {
  for (const f of ["commissionAmount", "whtAmount", "netAmount", "releasedAmount", "paidOutAmount"]) {
    if (typeof this[f] === "number" && this.isModified(f)) this[f] = round2(this[f]);
  }
  next();
});

saleCommissionSchema.index({ business: 1, commissionNumber: 1 }, { unique: true });
saleCommissionSchema.index({ business: 1, agent: 1, status: 1 });
saleCommissionSchema.index({ business: 1, deal: 1, status: 1 });
saleCommissionSchema.index({ business: 1, status: 1, createdAt: -1 });
saleCommissionSchema.index({ business: 1, createdAt: -1 });
saleCommissionSchema.index({ business: 1, status: 1, updatedAt: -1 });
saleCommissionSchema.index({ business: 1, owner: 1, status: 1 });

export default mongoose.model("SaleCommission", saleCommissionSchema);
