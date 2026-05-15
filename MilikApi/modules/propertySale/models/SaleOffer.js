import mongoose from "mongoose";

const OFFER_STATUSES = ["pending", "negotiating", "accepted", "rejected", "expired", "withdrawn"];

const saleOfferSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    offerNumber: { type: String, required: true, trim: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", required: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer", required: true, index: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent", default: null },
    offerAmount: { type: Number, required: true, min: 0 },
    counterOfferAmount: { type: Number, default: null },
    offerDate: { type: Date, default: Date.now },
    validUntil: { type: Date, default: null },
    status: { type: String, enum: OFFER_STATUSES, default: "pending", index: true },
    negotiationNotes: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleOfferSchema.index({ business: 1, offerNumber: 1 }, { unique: true });
saleOfferSchema.index({ business: 1, listing: 1, status: 1 });
saleOfferSchema.index({ business: 1, createdAt: -1 });

export default mongoose.model("SaleOffer", saleOfferSchema);
