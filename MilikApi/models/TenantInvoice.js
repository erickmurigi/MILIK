import mongoose from "mongoose";

export const TENANT_INVOICE_CATEGORIES = ["RENT_CHARGE", "UTILITY_CHARGE", "DEPOSIT_CHARGE", "LATE_PENALTY_CHARGE"];

const taxSnapshotSchema = new mongoose.Schema(
  {
    isTaxable: { type: Boolean, default: false },
    taxCodeKey: { type: String, default: "no_tax", trim: true },
    taxCodeName: { type: String, default: "No Tax", trim: true },
    taxType: { type: String, default: "none", trim: true },
    taxMode: { type: String, enum: ["exclusive", "inclusive"], default: "exclusive" },
    taxRate: { type: Number, default: 0 },
    enteredAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    grossAmount: { type: Number, default: 0 },
    outputAccountCode: { type: String, default: "2140", trim: true },
  },
  { _id: false }
);

const TenantInvoiceSchema = new mongoose.Schema(
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
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      required: true,
      index: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      enum: TENANT_INVOICE_CATEGORIES,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, "Amount must be positive"],
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceDate: {
      type: Date,
      required: true,
      index: true,
    },
    dueDate: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return value >= this.invoiceDate;
        },
        message: "Due date must be after invoice date",
      },
    },
    status: {
      type: String,
      enum: ["pending", "paid", "partially_paid", "cancelled", "reversed"],
      default: "pending",
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    chartAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      required: true,
      index: true,
    },

    depositHeldBy: {
      type: String,
      enum: ["Management Company", "Landlord", null],
      default: null,
    },

    ledgerMode: {
      type: String,
      enum: ["on_ledger", "off_ledger"],
      default: "on_ledger",
      index: true,
    },

    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    ledgerEntries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FinancialLedgerEntry",
      },
    ],
    postingStatus: {
      type: String,
      enum: ["unposted", "posted", "failed", "reversed", "not_applicable"],
      default: "unposted",
      index: true,
    },
    postingError: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    taxSnapshot: {
      type: taxSnapshotSchema,
      default: () => ({}),
    },

  },
  { timestamps: true }
);

TenantInvoiceSchema.index({ business: 1, tenant: 1, invoiceDate: -1 });
TenantInvoiceSchema.index({ business: 1, property: 1, landlord: 1, invoiceDate: -1 });
TenantInvoiceSchema.index({ business: 1, invoiceNumber: 1 }, { unique: true });

// Performance index for tenant balance recomputation
TenantInvoiceSchema.index({ business: 1, tenant: 1, status: 1 });
TenantInvoiceSchema.index({ business: 1, tenant: 1, invoiceDate: -1 });


TenantInvoiceSchema.index(
  {
    business: 1,
    category: 1,
    "metadata.penaltyRuleId": 1,
    "metadata.penaltySourceInvoiceId": 1,
    "metadata.penaltyPeriodKey": 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      category: "LATE_PENALTY_CHARGE",
      "metadata.penaltyRuleId": { $exists: true },
      "metadata.penaltySourceInvoiceId": { $exists: true },
      "metadata.penaltyPeriodKey": { $exists: true },
    },
  }
);

export default mongoose.model("TenantInvoice", TenantInvoiceSchema);