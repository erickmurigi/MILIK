import mongoose from "mongoose";

const TAX_TYPES = ["vat_output"];
const STATUSES  = ["remitted", "voided"];

const TaxRemittanceSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    periodYear:  { type: Number, required: true },
    periodMonth: { type: Number, required: true, min: 1, max: 12 },
    taxType: {
      type: String,
      enum: TAX_TYPES,
      default: "vat_output",
      index: true,
    },

    // Snapshot of balances at the time of remittance
    vatAccount2140Amount: { type: Number, default: 0 },
    vatAccount2190Amount: { type: Number, default: 0 },
    totalOutputVat:       { type: Number, default: 0 },
    alreadyRemitted:      { type: Number, default: 0 },

    amountRemitted: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: STATUSES,
      default: "remitted",
      index: true,
    },

    paymentDate:      { type: Date, required: true },
    paymentReference: { type: String, default: "", trim: true },
    cashbookAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },

    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    notes: { type: String, default: "", trim: true },

    voidedAt:     { type: Date, default: null },
    voidedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    voidReason:   { type: String, default: "", trim: true },

    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    remittedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    remittedAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

TaxRemittanceSchema.index({ business: 1, periodYear: 1, periodMonth: 1, taxType: 1 });
TaxRemittanceSchema.index({ business: 1, status: 1, paymentDate: -1 });

export default mongoose.model("TaxRemittance", TaxRemittanceSchema);
