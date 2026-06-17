import mongoose from "mongoose";

const ACCOUNT_TYPES   = ["credit", "monthly", "prepaid"];
const BILLING_CYCLES  = ["monthly", "weekly"];
const ACCOUNT_STATUSES = ["active", "suspended", "closed"];

const carWashCreditAccountSchema = new mongoose.Schema(
  {
    business:      { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    branch:        { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null },
    accountNumber: { type: String, trim: true, required: true, minlength: 1 },
    customer:      { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCustomer", required: true },
    plates:        { type: [{ type: String, trim: true, uppercase: true }], default: [] },
    accountType:   { type: String, enum: ACCOUNT_TYPES, required: true, default: "credit" },
    creditLimit:   { type: Number, default: 0, min: 0 },  // 0 = no enforced limit
    billingCycle:  { type: String, enum: BILLING_CYCLES, default: "monthly" },
    billingDay:    { type: Number, default: 1, min: 1, max: 28 },
    status:        { type: String, enum: ACCOUNT_STATUSES, default: "active", index: true },

    // Cached running balance — always recomputed on payment but cached for fast reads.
    // Positive = customer owes us. Negative = we have a credit on their account.
    currentBalance: { type: Number, default: 0 },

    // Excess credit from overpayment — applied automatically to next jobs.
    accountCredit: { type: Number, default: 0, min: 0 },

    lastStatementAt: { type: Date, default: null },
    notes:           { type: String, trim: true, default: "" },
    createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashCreditAccountSchema.index({ business: 1, accountNumber: 1 }, { unique: true });
carWashCreditAccountSchema.index({ business: 1, customer: 1 });
carWashCreditAccountSchema.index({ business: 1, plates: 1 });
carWashCreditAccountSchema.index({ business: 1, status: 1 });
carWashCreditAccountSchema.index({ business: 1, accountType: 1, status: 1 });

export default mongoose.model("CarWashCreditAccount", carWashCreditAccountSchema);
