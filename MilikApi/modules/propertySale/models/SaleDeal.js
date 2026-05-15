import mongoose from "mongoose";

const DEAL_STATUSES = ["active", "closed", "cancelled"];

const saleDealSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    dealNumber: { type: String, required: true, trim: true },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOffer", default: null },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", required: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer", required: true, index: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent", default: null },
    agreedPrice: { type: Number, required: true, min: 0 },
    dealDate: { type: Date, default: Date.now },
    expectedClosingDate: { type: Date, default: null },
    actualClosingDate: { type: Date, default: null },
    status: { type: String, enum: DEAL_STATUSES, default: "active", index: true },
    saleAgreementUploaded: { type: Boolean, default: false },
    saleAgreementUrl: { type: String, trim: true, default: "" },
    titleTransferDate: { type: Date, default: null },
    handoverNotes: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleDealSchema.index({ business: 1, dealNumber: 1 }, { unique: true });
saleDealSchema.index({ business: 1, status: 1, createdAt: -1 });
saleDealSchema.index({ business: 1, listing: 1 });
saleDealSchema.index({ business: 1, buyer: 1 });

export default mongoose.model("SaleDeal", saleDealSchema);
