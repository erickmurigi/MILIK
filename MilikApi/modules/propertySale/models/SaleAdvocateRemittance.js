import mongoose from "mongoose";

// Records money the advocate has actually handed over to the company, clearing part (or all) of the
// 1314 Advocate Trust Receivable balance built up by "advocate_trust" SalePayments. See
// propertySaleAccountingService.js's postSaleAdvocateRemittance for the GL posting (Dr cashbook / Cr 1314).
const saleAdvocateRemittanceSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    remittanceNumber: { type: String, required: true, trim: true },
    advocate: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAdvocate", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    // The company account the money actually landed in
    cashbook: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    reference: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleAdvocateRemittanceSchema.index({ business: 1, remittanceNumber: 1 }, { unique: true });
saleAdvocateRemittanceSchema.index({ business: 1, advocate: 1, date: -1 });

export default mongoose.model("SaleAdvocateRemittance", saleAdvocateRemittanceSchema);
