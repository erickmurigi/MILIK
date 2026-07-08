import mongoose from "mongoose";

/**
 * PropertyLedgerEntry — one accounting line in a property's isolated GL.
 *
 * Architecture: each document is one T-account line (account + debit or credit).
 * Multiple lines sharing the same groupId form a balanced journal entry.
 * This per-line format lets every report (trial balance, P&L, balance sheet)
 * run as a single aggregation pipeline with no in-memory post-processing.
 *
 * Only used when property.accountLedgerType === "property-gl"
 * AND property.propertyLedgerEnabled === true.
 * The main JournalEntry collection is never touched for these properties.
 */
const PropertyLedgerEntrySchema = new mongoose.Schema(
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

    // Links all debit+credit lines that form one balanced journal entry
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
    },

    date: {
      type: Date,
      required: true,
    },

    // "2026-07" — pre-computed for fast period-range queries without date math
    statementPeriod: {
      type: String,
      trim: true,
    },

    debit: {
      type: Number,
      default: 0,
      min: 0,
    },

    credit: {
      type: Number,
      default: 0,
      min: 0,
    },

    narration: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },

    reference: {
      type: String,
      trim: true,
      default: "",
    },

    // Drives grouping in income statement (rent, deposit, penalty, commission, utility, other)
    category: {
      type: String,
      trim: true,
      default: "other",
    },

    // Source document refs — for drill-down and cross-referencing
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

    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantInvoice",
      default: null,
    },

    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RentPayment",
      default: null,
    },

    // Soft-delete for reversals — reversed lines are excluded from all reports
    isReversed: {
      type: Boolean,
      default: false,
    },

    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    postedAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// All ordered by selectivity: property first (most selective in this collection),
// then the field most commonly used in range/match filters.

// Core report queries: trial balance, balance sheet
PropertyLedgerEntrySchema.index({ property: 1, account: 1, date: 1 });

// Income statement: property + date range, excludes reversed
PropertyLedgerEntrySchema.index({ property: 1, date: 1, isReversed: 1 });

// Period-keyed reports (landlord statement, period P&L)
PropertyLedgerEntrySchema.index({ property: 1, statementPeriod: 1 });

// Journal entry drill-down — fetch all lines of one entry
PropertyLedgerEntrySchema.index({ groupId: 1 });

// Tenant ledger within property context
PropertyLedgerEntrySchema.index({ property: 1, tenant: 1, date: 1 });

// Reversal lookup
PropertyLedgerEntrySchema.index({ reversalOf: 1 }, { sparse: true });

// Business-level queries (property ledger overview across all properties)
PropertyLedgerEntrySchema.index({ business: 1, property: 1, date: -1 });

export default mongoose.model("PropertyLedgerEntry", PropertyLedgerEntrySchema);
