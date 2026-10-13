import mongoose from "mongoose";

/**
 * SaleOwnerStatement: immutable-once-approved snapshot of a property-sale owner's statement —
 * proceeds collected, company commission, broker commission and recharged expenses for a period.
 * Mirrors the PMS LandlordStatement pattern, scoped down for v1: draft -> approve only (no
 * send/revision workflow yet). `version`/`supersedesStatementId`/`supersededByStatementId` are kept
 * on the schema so revisioning can be added later without a migration, even though no endpoint
 * creates a revision yet.
 */

const STATEMENT_STATUSES = ["draft", "approved"];

const saleOwnerStatementSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwner", required: true },
    // null = covers every project this owner has, not just one
    project: { type: mongoose.Schema.Types.ObjectId, ref: "SaleProject", default: null },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    statementNumber: { type: String, required: true, trim: true },
    version: { type: Number, required: true, default: 1, min: 1 },
    status: { type: String, enum: STATEMENT_STATUSES, required: true, default: "draft" },
    grossProceeds: { type: Number, required: true, default: 0 },
    companyCommission: { type: Number, required: true, default: 0 },
    brokerCommission: { type: Number, required: true, default: 0 },
    rechargedExpenses: { type: Number, required: true, default: 0 },
    netBalance: { type: Number, required: true, default: 0 },
    currency: { type: String, required: true, default: "KES", trim: true, uppercase: true },
    entryCount: { type: Number, required: true, default: 0, min: 0 },
    generatedAt: { type: Date, required: true, default: Date.now },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    supersedesStatementId: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwnerStatement", default: null },
    supersededByStatementId: { type: mongoose.Schema.Types.ObjectId, ref: "SaleOwnerStatement", default: null },
    notes: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleOwnerStatementSchema.index(
  { business: 1, owner: 1, project: 1, periodStart: 1, periodEnd: 1, version: 1 },
  { unique: true }
);
saleOwnerStatementSchema.index({ business: 1, statementNumber: 1 }, { unique: true });
saleOwnerStatementSchema.index({ business: 1, owner: 1, status: 1, periodStart: -1 });

// Store original status so the pre("save") hook below can tell whether this doc was already approved
saleOwnerStatementSchema.post("init", function () {
  this._original = { status: this.status };
});

// Once approved, a statement is immutable — corrections require a new version (not built in v1,
// but the schema fields exist for it).
saleOwnerStatementSchema.pre("save", function (next) {
  if (this.isModified() && !this.isNew && this._original?.status === "approved") {
    return next(new Error("Approved owner statements cannot be modified."));
  }
  next();
});

saleOwnerStatementSchema.pre("findOneAndUpdate", function (next) {
  const filter = this.getFilter();
  if (!filter.status) this.setQuery({ ...filter, status: { $ne: "approved" } });
  next();
});

saleOwnerStatementSchema.pre("updateOne", function (next) {
  const filter = this.getFilter();
  if (!filter.status) this.setQuery({ ...filter, status: { $ne: "approved" } });
  next();
});

saleOwnerStatementSchema.pre("findOneAndDelete", async function (next) {
  const existing = await this.model.findOne(this.getQuery()).select("status").lean();
  if (existing?.status === "approved") return next(new Error("Approved owner statements cannot be deleted."));
  next();
});

export { STATEMENT_STATUSES };
export default mongoose.model("SaleOwnerStatement", saleOwnerStatementSchema);
