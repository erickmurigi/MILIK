import mongoose from "mongoose";

const RentPaymentSchema = new mongoose.Schema(
  {
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
    amount: {
      type: Number,
      required: true,
    },
    paymentType: {
      type: String,
      enum: ["rent", "deposit", "utility", "late_fee", "other"],
      required: true,
      index: true,
    },
    paymentDate: {
      type: Date,
      required: true,
      index: true,
    },
    bankingDate: {
      type: Date,
      default: null,
    },
    recordDate: {
      type: Date,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    referenceNumber: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    isConfirmed: {
      type: Boolean,
      default: false,
      index: true,
    },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "mobile_money", "cash", "check", "credit_card"],
      required: true,
    },
    cashbook: {
      type: String,
      trim: true,
      default: "",
    },
    paidDirectToLandlord: {
      type: Boolean,
      default: false,
    },

    // Receipt-only document discipline.
    ledgerType: {
      type: String,
      enum: ["receipts"],
      default: "receipts",
      index: true,
    },

    isReversed: {
      type: Boolean,
      default: false,
      index: true,
    },
    reversedAt: {
      type: Date,
      default: null,
    },
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reversalReason: {
      type: String,
      default: null,
    },
    reversalEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RentPayment",
      default: null,
      index: true,
    },
    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RentPayment",
      default: null,
      index: true,
    },
    isCancellationEntry: {
      type: Boolean,
      default: false,
    },
    isCancelled: {
      type: Boolean,
      default: false,
      index: true,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },

    receiptNumber: {
      type: String,
      trim: true,
    },

    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
      min: 2000,
    },

    utilities: [
      {
        utility: { type: mongoose.Schema.Types.ObjectId, ref: "Utility" },
        amount: { type: Number, default: 0 },
      },
    ],
    breakdown: {
      rent: { type: Number, default: 0 },
      utilities: [
        {
          utility: { type: mongoose.Schema.Types.ObjectId, ref: "Utility" },
          name: { type: String, default: "" },
          amount: { type: Number, default: 0 },
          billingCycle: { type: String, default: "" },
        },
      ],
      total: { type: Number, default: 0 },
    },
    allocations: [
      {
        invoice: { type: mongoose.Schema.Types.ObjectId, ref: "TenantInvoice", default: null },
        invoiceNumber: { type: String, default: "" },
        category: { type: String, default: "" },
        priorityGroup: { type: String, default: "" },
        utilityType: { type: String, default: "" },
        appliedAmount: { type: Number, default: 0 },
        beforeOutstanding: { type: Number, default: 0 },
        afterOutstanding: { type: Number, default: 0 },
        invoiceDate: { type: Date, default: null },
        dueDate: { type: Date, default: null },
        description: { type: String, default: "" },
      },
    ],
    allocationSummary: {
      rent: { type: Number, default: 0 },
      deposit: { type: Number, default: 0 },
      utility: { type: Number, default: 0 },
      latePenalty: { type: Number, default: 0 },
      debitNote: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
      unapplied: { type: Number, default: 0 },
    },

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // Posting / audit traceability
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
      enum: ["unposted", "posted", "failed", "reversed"],
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
  },
  { timestamps: true }
);

RentPaymentSchema.pre("save", function preSave(next) {
  if (!this.breakdown) {
    this.breakdown = {
      rent: 0,
      utilities: [],
      total: Math.abs(Number(this.amount || 0)),
    };
  }

  if (!this.breakdown.total || Number(this.breakdown.total) === 0) {
    const rentAmount = Number(this.breakdown.rent || 0);
    const utilitiesTotal = Array.isArray(this.breakdown.utilities)
      ? this.breakdown.utilities.reduce((sum, util) => sum + Number(util.amount || 0), 0)
      : 0;

    this.breakdown.total = rentAmount + utilitiesTotal || Math.abs(Number(this.amount || 0));
  }

  this.ledgerType = "receipts";
  next();
});

RentPaymentSchema.index({ business: 1, paymentDate: -1 });
RentPaymentSchema.index({ business: 1, isConfirmed: 1, ledgerType: 1 });
RentPaymentSchema.index({ business: 1, tenant: 1, paymentDate: -1 });
RentPaymentSchema.index({ "allocations.invoice": 1 });
RentPaymentSchema.index({ business: 1, unit: 1, paymentDate: -1 });
RentPaymentSchema.index({ year: -1, month: -1 });

RentPaymentSchema.index(
  { business: 1, referenceNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      referenceNumber: { $exists: true, $type: "string", $gt: "" },
    },
  }
);

RentPaymentSchema.index(
  { business: 1, receiptNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      receiptNumber: { $exists: true, $type: "string", $gt: "" },
    },
  }
);

// Performance index for tenant balance recomputation
RentPaymentSchema.index({ business: 1, tenant: 1, isConfirmed: 1, paymentDate: -1 });

export default mongoose.model("RentPayment", RentPaymentSchema);
