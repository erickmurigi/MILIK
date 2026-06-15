import mongoose from "mongoose";

const COMMISSION_STATUSES = ["pending", "approved", "paid", "cancelled"];
const PAYOUT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];

const saleCommissionSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
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
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleCommissionSchema.index({ business: 1, commissionNumber: 1 }, { unique: true });
saleCommissionSchema.index({ business: 1, agent: 1, status: 1 });
saleCommissionSchema.index({ business: 1, deal: 1, status: 1 });
saleCommissionSchema.index({ business: 1, status: 1, createdAt: -1 });

export default mongoose.model("SaleCommission", saleCommissionSchema);
