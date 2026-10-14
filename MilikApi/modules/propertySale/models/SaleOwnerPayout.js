import mongoose from "mongoose";

// A physical payout of an owner's net sale proceeds — either from the company's own cash
// ("company_cashbook") or paid directly by the conveyancing advocate out of trust funds they
// hold for a specific deal ("advocate_trust"). See propertySaleAccountingService.js's
// postSaleOwnerPayout (Dr 2185 Owner Clearing / Cr 1314 or Cr Cashbook) for the GL side, and
// dealProgress.js's dealAdvocateTrustBalance for the deal-scoped trust-funds guard an
// advocate_trust payout must be checked against before it is created.
const SOURCES = ["company_cashbook", "advocate_trust"];

const saleOwnerPayoutSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    payoutNumber: { type: String, required: true, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwner", required: true, index: true },
    // Nullable — a payout need not be tied to one specific deal (an owner's net balance can span
    // several completed deals under their projects), but it MUST be set when source is
    // "advocate_trust", since trust funds are only ever tracked per-deal (dealAdvocateTrustBalance).
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", default: null, index: true },
    amount: { type: Number, required: true, min: 0 },
    // Capital Gains Tax withheld from the owner's gross entitlement for this payout (computed externally
    // via KRA iTax, entered here for record-keeping) — CGT is always the OWNER's own personal obligation,
    // never a liability on this company's books (we're never the remitting party, unlike WHT on a
    // broker's commission), so this is pure audit metadata: it reduces what the owner is entitled to and
    // what actually left the trust/cashbook, but posts no separate GL leg of its own. See
    // postSaleOwnerPayout — the full (amount + cgtAmount) clears 2185, matching how the owner's claim was
    // reduced, even though only `amount` is cash the owner physically received.
    cgtAmount: { type: Number, default: 0, min: 0 },
    cgtReference: { type: String, trim: true, default: "" },
    date: { type: Date, default: Date.now },
    source: { type: String, enum: SOURCES, default: "company_cashbook" },
    // The advocate who physically paid the owner — required when source is "advocate_trust".
    advocate: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAdvocate", default: null },
    // The company account the money actually left from — only meaningful for "company_cashbook".
    cashbook: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    reference: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleOwnerPayoutSchema.index({ business: 1, payoutNumber: 1 }, { unique: true });
saleOwnerPayoutSchema.index({ business: 1, owner: 1, date: -1 });
saleOwnerPayoutSchema.index({ business: 1, deal: 1 });

export default mongoose.model("SaleOwnerPayout", saleOwnerPayoutSchema);
