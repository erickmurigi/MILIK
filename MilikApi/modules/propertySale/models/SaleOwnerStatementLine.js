import mongoose from "mongoose";

/**
 * SaleOwnerStatementLine: immutable line items within a SaleOwnerStatement. Freely replaceable while
 * the parent statement is "draft" (regenerate = delete + reinsert); frozen once approved.
 */

const LINE_CATEGORIES = ["proceeds", "company_commission", "broker_commission", "expense", "owner_payout"];

const saleOwnerStatementLineSchema = new mongoose.Schema(
  {
    statement: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwnerStatement", required: true },
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwner", required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "SaleProject", default: null },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", default: null },
    transactionDate: { type: Date, required: true },
    category: { type: String, enum: LINE_CATEGORIES, required: true, index: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    direction: { type: String, enum: ["debit", "credit"], required: true },
    runningBalance: { type: Number, required: true },
    sourceTransactionType: { type: String, default: null, trim: true },
    sourceTransactionId: { type: String, default: null, trim: true },
    lineNumber: { type: Number, required: true, min: 1 },
    // Recovery/disbursement status for an "expense", "company_commission" or "broker_commission" line —
    // true once the advocate has recovered/paid it out in full, false while still outstanding. Drives
    // red/green on the statement; never on "proceeds"/"owner_payout" lines, which have no such status
    // (left undefined/null for those, same as every other category-specific field on this shared schema).
    paid: { type: Boolean, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

saleOwnerStatementLineSchema.index({ statement: 1, lineNumber: 1 }, { unique: true });
saleOwnerStatementLineSchema.index({ business: 1, statement: 1, transactionDate: 1 });
saleOwnerStatementLineSchema.index({ business: 1, owner: 1 });

saleOwnerStatementLineSchema.virtual("signedAmount").get(function () {
  return this.direction === "debit" ? -Math.abs(this.amount) : Math.abs(this.amount);
});

// Immutable once the parent statement is approved — same guard pattern as LandlordStatementLine
const blockIfApproved = async function (next) {
  const line = await this.model.findOne(this.getQuery()).select("statement").lean();
  if (!line) return next();
  const stmt = await mongoose.model("SaleOwnerStatement").findById(line.statement).select("status").lean();
  if (stmt?.status === "approved") return next(new Error("SaleOwnerStatementLine is immutable once its statement is approved."));
  next();
};
saleOwnerStatementLineSchema.pre("findOneAndUpdate", blockIfApproved);
saleOwnerStatementLineSchema.pre("updateOne", blockIfApproved);
saleOwnerStatementLineSchema.pre("findOneAndDelete", blockIfApproved);

export { LINE_CATEGORIES };
export default mongoose.model("SaleOwnerStatementLine", saleOwnerStatementLineSchema);
