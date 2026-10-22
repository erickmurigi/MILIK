import mongoose from "mongoose";

// Real cash an advocate sends Pink House specifically to recover one or more rechargeable owner
// expenses (a "sale_owner_expense" PaymentVoucher, the asset recognized on 1313 Owner Expense
// Recoverable) — distinct from SaleAdvocateRemittance, which clears the advocate's TRUST balance (1314)
// for sale-proceeds cash collected on the company's behalf. This is a direct receivable settlement
// instead: Dr [cashbook] / Cr 1313, posted by propertySaleAccountingService.js's
// postAdvocateRechargeRemittance. An owner's statement (ownerStatementService.js) only shows a
// rechargeable expense as recovered once one of these posts against it — never merely because the
// voucher itself was paid to the service provider.
const allocationSchema = new mongoose.Schema(
  {
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentVoucher", required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const saleAdvocateRechargeRemittanceSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    remittanceNumber: { type: String, required: true, trim: true },
    advocate: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAdvocate", required: true, index: true },
    // Every allocation must belong to this same owner — a recharge remittance is always one owner's
    // recovery, even when it settles several of that owner's vouchers in one go.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwner", required: true, index: true },
    allocations: { type: [allocationSchema], default: [] },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    // The company account the money actually landed in
    cashbook: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    reference: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    // Same voided/audit-trail pattern as SaleAdvocateRemittance — the record stays, the GL is reversed,
    // and every outstanding-balance aggregate excludes it.
    status: { type: String, enum: ["posted", "cancelled"], default: "posted" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleAdvocateRechargeRemittanceSchema.index({ business: 1, remittanceNumber: 1 }, { unique: true });
saleAdvocateRechargeRemittanceSchema.index({ business: 1, advocate: 1, date: -1 });
saleAdvocateRechargeRemittanceSchema.index({ business: 1, owner: 1 });

export default mongoose.model("SaleAdvocateRechargeRemittance", saleAdvocateRechargeRemittanceSchema);
