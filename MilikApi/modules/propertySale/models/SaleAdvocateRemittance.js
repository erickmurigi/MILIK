import mongoose from "mongoose";

// Records money the advocate has actually handed over to the company, clearing part (or all) of the
// 1314 Advocate Trust Receivable balance built up by "advocate_trust" SalePayments. See
// propertySaleAccountingService.js's postSaleAdvocateRemittance for the GL posting (Dr cashbook / Cr 1314).
const saleAdvocateRemittanceSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    remittanceNumber: { type: String, required: true, trim: true },
    advocate: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAdvocate", required: true, index: true },
    // Nullable — null preserves today's exact ad-hoc/legacy behavior (a flat, advocate-level remittance
    // with no deal linkage). When set, this remittance is scoped to one deal's trust balance.
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", default: null, index: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    // The company account the money actually landed in
    cashbook: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    // Computed (not submitted by the caller) breakdown of what this remittance's cash actually clears:
    // recoverable owner expenses first, then plain commission-cash. This is audit/breakdown metadata
    // only — the remittance's own GL posting is always a pure Dr cashbook / Cr 1314 for the full amount,
    // regardless of this field. Each "recoverable_expense" entry additionally drives one SEPARATE,
    // non-cash postRecoverableExpenseSettlement entry (Dr 2185 Owner Clearing / Cr 1313 Owner Expense
    // Recoverable) — see propertySaleAccountingService.js. Empty = legacy/ad-hoc remittance, no
    // settlement entries at all.
    appliedTo: {
      type: [
        {
          _id: false,
          category: { type: String, enum: ["recoverable_expense", "owner_commission_cash"], required: true },
          refId: { type: mongoose.Schema.Types.ObjectId, default: null },
          amount: { type: Number, required: true, min: 0 },
        },
      ],
      default: [],
    },
    reference: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    // No correction path existed before this field — a remittance entered with the wrong amount or
    // against the wrong advocate had no way to be corrected, even though the reversal GL logic
    // (reverseSaleAdvocateRemittance) was already built and tested. Same voided/audit-trail pattern as
    // SalePayment — the record stays, the GL is reversed, and every trust-balance aggregate excludes it.
    status: { type: String, enum: ["posted", "cancelled"], default: "posted" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleAdvocateRemittanceSchema.index({ business: 1, remittanceNumber: 1 }, { unique: true });
saleAdvocateRemittanceSchema.index({ business: 1, advocate: 1, date: -1 });

export default mongoose.model("SaleAdvocateRemittance", saleAdvocateRemittanceSchema);
