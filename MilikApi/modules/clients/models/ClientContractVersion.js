import mongoose from "mongoose";

// One immutable snapshot per contract version. Version 1 is written when the contract is activated;
// every amendment / escalation adds the next one with the date it takes effect from. The billing
// schedule prices each period from the version in force on that period's first day, so history
// stays reproducible. A version is never edited after it is applied - only its status moves
// (pending_approval -> applied | rejected; applied -> superseded when a later one is applied).
export const CONTRACT_VERSION_STATUSES = ["pending_approval", "applied", "superseded", "rejected"];
export const CONTRACT_VERSION_TYPES = ["original", "amendment", "escalation", "renewal"];

const fieldChangeSchema = new mongoose.Schema(
  { field: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed },
  { _id: false }
);

const lineDiffSchema = new mongoose.Schema(
  {
    lineKey: String,
    itemName: String,
    change: { type: String, enum: ["added", "removed", "modified"] },
    fields: { type: [fieldChangeSchema], default: [] },
  },
  { _id: false }
);

const clientContractVersionSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: "ClientContract", required: true },
    version:  { type: Number, required: true, min: 1 },
    versionType: { type: String, enum: CONTRACT_VERSION_TYPES, default: "amendment" },
    status:   { type: String, enum: CONTRACT_VERSION_STATUSES, default: "applied" },
    effectiveDate: { type: Date, required: true },
    changeSummary: { type: String, trim: true, default: "" },
    // Idempotency for system-generated versions (escalation run): "escalation:YYYY-MM-DD".
    sourceKey: { type: String, trim: true, default: null },
    // Full commercial snapshot of the contract as of this version.
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    fieldChanges: { type: [fieldChangeSchema], default: [] },
    lineDiffs: { type: [lineDiffSchema], default: [] },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

clientContractVersionSchema.index({ contract: 1, version: 1 }, { unique: true });
clientContractVersionSchema.index(
  { contract: 1, sourceKey: 1 },
  { unique: true, partialFilterExpression: { sourceKey: { $type: "string" } } }
);
clientContractVersionSchema.index({ business: 1, contract: 1, status: 1, effectiveDate: 1 });

export default mongoose.model("ClientContractVersion", clientContractVersionSchema);
