import mongoose from "mongoose";

const DEAL_STATUSES = ["active", "closed", "cancelled"];
// The four standard ways property is bought in Kenya: outright cash (closes fast, no drawn-out
// timeline to project), a developer's own structured installment plan, bank/mortgage financing, or
// an off-plan purchase (paid in installments against a construction/handover milestone schedule).
// Drives whether the deal form asks for an Expected Closing Date at all — cash deals don't need one.
const PAYMENT_PLANS = ["cash", "installment", "mortgage", "off_plan"];

const saleDealSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    dealNumber: { type: String, required: true, trim: true },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOffer", default: null },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", required: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer", required: true, index: true },
    agent: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent", default: null },
    // Explicit per-deal override of which advocate handles this sale's conveyancing — e.g. the buyer
    // brought their own advocate, different from whichever one the project/listing defaults to. When
    // unset, visibility and trust-account scoping (middleware/advocateScope.js) fall back to the
    // listing's project's assignedAdvocate, then the listing's own assignedAdvocate (for a standalone
    // listing with no project). When set, it overrides those defaults entirely for this one deal.
    advocate: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAdvocate", default: null },
    agreedPrice: { type: Number, required: true, min: 0 },
    paymentPlan: { type: String, enum: PAYMENT_PLANS, default: "installment" },
    dealDate: { type: Date, default: Date.now },
    expectedClosingDate: { type: Date, default: null },
    actualClosingDate: { type: Date, default: null },
    status: { type: String, enum: DEAL_STATUSES, default: "active", index: true },
    saleAgreementUploaded: { type: Boolean, default: false },
    saleAgreementUrl: { type: String, trim: true, default: "" },
    titleTransferDate: { type: Date, default: null },
    handoverNotes: { type: String, trim: true, default: "" },
    stampDutyAmount: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: "" },
    documents: [{
      label:        { type: String, trim: true, default: "" },
      originalName: { type: String, trim: true },
      filename:     { type: String, trim: true },
      mimetype:     { type: String, trim: true },
      size:         { type: Number, default: 0 },
      uploadedAt:   { type: Date, default: Date.now },
      uploadedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleDealSchema.index({ business: 1, dealNumber: 1 }, { unique: true });
saleDealSchema.index({ business: 1, status: 1, createdAt: -1 });
// Unfiltered list/dashboard sort by newest, and report date-window filters
saleDealSchema.index({ business: 1, createdAt: -1 });
saleDealSchema.index({ business: 1, dealDate: -1 });
saleDealSchema.index({ business: 1, actualClosingDate: 1 });
saleDealSchema.index({ business: 1, listing: 1 });
saleDealSchema.index({ business: 1, buyer: 1 });
saleDealSchema.index({ business: 1, agent: 1 });
saleDealSchema.index({ business: 1, advocate: 1 });
saleDealSchema.index({ business: 1, offer: 1 });

export default mongoose.model("SaleDeal", saleDealSchema);
