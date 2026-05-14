import mongoose from "mongoose";

/**
 * LandlordStatementTenantBalance: per-tenant closing-balance snapshot frozen when a
 * LandlordStatement is approved.  The NEXT statement for the same property/landlord
 * uses these values as opening balances and only needs to scan transactions that
 * occurred AFTER this statement's periodEnd, eliminating the otherwise unbounded
 * full-history scan.
 */
const LandlordStatementTenantBalanceSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
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
    statement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LandlordStatement",
      required: true,
      index: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
    },
    tenantKey: {
      type: String,
      required: true,
      trim: true,
    },
    balanceCF: {
      type: Number,
      default: 0,
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

// Primary lookup: give me the latest snapshot set for this property/landlord
LandlordStatementTenantBalanceSchema.index({ business: 1, property: 1, landlord: 1, periodEnd: -1 });
// Exact lookup when approving a revision chain: delete snapshots for a superseded statement
LandlordStatementTenantBalanceSchema.index({ statement: 1 });
// Ensure one snapshot row per tenant per approved statement
LandlordStatementTenantBalanceSchema.index({ statement: 1, tenantKey: 1 }, { unique: true });

export default mongoose.model("LandlordStatementTenantBalance", LandlordStatementTenantBalanceSchema);
