import mongoose from "mongoose";

/**
 * LandlordStatement: Immutable snapshot of an approved landlord statement.
 * Once approved, statements cannot be modified - corrections require creating a new version.
 */

const STATEMENT_STATUS = ["draft", "reviewed", "approved", "sent", "revised"];

const isApprovedToSentTransition = ({ originalStatus, currentStatus, doc }) => {
  if (originalStatus !== "approved" || currentStatus !== "sent") return false;

  const changedPaths = typeof doc?.modifiedPaths === "function" ? doc.modifiedPaths() : [];
  const allowedPaths = new Set(["status", "sentAt", "sentBy", "updatedAt"]);

  return changedPaths.every((path) => allowedPaths.has(path));
};

const LandlordStatementSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    statementNumber: {
      type: String,
      required: true,
      trim: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: STATEMENT_STATUS,
      required: true,
      default: "draft",
    },
    openingBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    periodNet: {
      type: Number,
      required: true,
      default: 0,
    },
    closingBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      required: true,
      default: "KES",
      trim: true,
      uppercase: true,
    },
    totalsByCategory: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    entryCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lineCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    ledgerEntryCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    ledgerEntryIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
      index: false,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    supersedesStatementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LandlordStatement",
      default: null,
    },
    supersededByStatementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LandlordStatement",
      default: null,
    },
    revisionReason: {
      type: String,
      default: null,
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient queries
LandlordStatementSchema.index({ business: 1, property: 1, landlord: 1, periodStart: 1 });
LandlordStatementSchema.index({ business: 1, statementNumber: 1, version: 1 }, { unique: true });
LandlordStatementSchema.index({ business: 1, landlord: 1, status: 1, periodStart: -1 });
LandlordStatementSchema.index({ business: 1, property: 1, landlord: 1, status: 1 });
// Unique index to prevent duplicate statements for same period/version
LandlordStatementSchema.index(
  { business: 1, property: 1, landlord: 1, periodStart: 1, periodEnd: 1, version: 1 },
  { unique: true }
);
// Covers approval duplicate check: { business, property, landlord, periodStart, periodEnd, status: "approved" }
LandlordStatementSchema.index({ business: 1, property: 1, landlord: 1, status: 1, periodStart: 1, periodEnd: 1 });
// Covers revision chain lookups in deleteDraft
LandlordStatementSchema.index({ business: 1, supersededByStatementId: 1 });
LandlordStatementSchema.index({ business: 1, supersedesStatementId: 1 });

// Prevent modification of approved statements
LandlordStatementSchema.pre("save", function (next) {
  if (this.isModified() && !this.isNew) {
    const originalStatus = this._original?.status;
    const currentStatus = this.status;

    if (isApprovedToSentTransition({ originalStatus, currentStatus, doc: this })) {
      return next();
    }

    if (originalStatus === "approved" || originalStatus === "sent") {
      return next(new Error("Approved or sent statements cannot be modified. Create a revision instead."));
    }
  }
  next();
});

// Store original document for pre-save hook
LandlordStatementSchema.post("init", function () {
  this._original = { status: this.status };
});

// Block direct updates and deletes on approved statements
LandlordStatementSchema.pre("findOneAndUpdate", function (next) {
  const filter = this.getFilter();
  const update = this.getUpdate() || {};
  const nextStatus = update?.$set?.status ?? update?.status;
  const touchesOnlyAllowedFields = (() => {
    const directKeys = Object.keys(update).filter((key) => !key.startsWith("$"));
    const setKeys = Object.keys(update?.$set || {});
    const allKeys = [...directKeys, ...setKeys];
    if (allKeys.length === 0) return false;
    return allKeys.every((key) => ["status", "sentAt", "sentBy", "updatedAt"].includes(key));
  })();

  // Allow the approved -> sent transition.
  // IMPORTANT: Callers performing this transition MUST include { status: "approved" } as a plain
  // string in their filter. Without it the guard below will silently block the update.
  if (filter.status === "approved" && nextStatus === "sent" && touchesOnlyAllowedFields) {
    return next();
  }

  // Block updates to approved/sent statements by injecting a status guard into the filter.
  // Only inject when the caller has not already supplied a status constraint, to avoid clobbering it.
  // NOTE: invalid updates now silently no-op (0 matched) instead of throwing an error.
  if (!filter.status) {
    this.setQuery({ ...filter, status: { $nin: ["approved", "sent"] } });
  }
  next();
});

LandlordStatementSchema.pre("updateOne", function (next) {
  const filter = this.getFilter();
  const update = this.getUpdate() || {};
  const nextStatus = update?.$set?.status ?? update?.status;
  const touchesOnlyAllowedFields = (() => {
    const directKeys = Object.keys(update).filter((key) => !key.startsWith("$"));
    const setKeys = Object.keys(update?.$set || {});
    const allKeys = [...directKeys, ...setKeys];
    if (allKeys.length === 0) return false;
    return allKeys.every((key) => ["status", "sentAt", "sentBy", "updatedAt"].includes(key));
  })();

  // Allow the approved -> sent transition.
  // IMPORTANT: Callers performing this transition MUST include { status: "approved" } as a plain
  // string in their filter. Without it the guard below will silently block the update.
  if (filter.status === "approved" && nextStatus === "sent" && touchesOnlyAllowedFields) {
    return next();
  }

  // Block updates to approved/sent statements by injecting a status guard into the filter.
  // Only inject when the caller has not already supplied a status constraint, to avoid clobbering it.
  // NOTE: invalid updates now silently no-op (0 matched) instead of throwing an error.
  if (!filter.status) {
    this.setQuery({ ...filter, status: { $nin: ["approved", "sent"] } });
  }
  next();
});

LandlordStatementSchema.pre("findOneAndDelete", async function (next) {
  const docToDelete = await this.model.findOne(this.getQuery()).select("status").lean();
  if (docToDelete?.status === "approved" || docToDelete?.status === "sent") {
    return next(new Error("Approved or sent statements cannot be deleted. Create a revision instead."));
  }
  next();
});

export { STATEMENT_STATUS };
export default mongoose.model("LandlordStatement", LandlordStatementSchema);
