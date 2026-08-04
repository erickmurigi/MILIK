import mongoose from "mongoose";

const LEDGER_CATEGORIES = [
  "RENT_INVOICE",
  "UTILITY_INVOICE",
  "RENT_RECEIPT_MANAGER",
  "RENT_RECEIPT_LANDLORD",
  "UTILITY_RECEIPT_MANAGER",
  "UTILITY_RECEIPT_LANDLORD",
  "DEPOSIT_CHARGE",
  "DEPOSIT_RECEIVED",
  "DEPOSIT_REFUNDED",
  "DEPOSIT_APPLIED",
  "COMMISSION_CHARGE",
  "LANDLORD_PAYABLE",
  "EXPENSE_DEDUCTION",
  "RECURRING_DEDUCTION",
  "ADVANCE_TO_LANDLORD",
  "ADVANCE_RECOVERY",
  "LANDLORD_RECEIPT",
  "ADJUSTMENT",
  "WRITE_OFF",
  "REVERSAL",
  "PETTY_CASH_EXPENSE",
  "PETTY_CASH_REPLENISHMENT",
  "CARWASH_COMMISSION_ACCRUAL",
  "CARWASH_COMMISSION_PAYOUT",
  "CARWASH_PAYMENT",
  "CARWASH_EXPENSE",
  "CARWASH_PREPAID_TOPUP",
  "CARWASH_SAVINGS_DISBURSEMENT",
  "CARWASH_CUSTOMER_CREDIT",
  "POS_SALE",
  "POS_PURCHASE",
  "POS_STOCK_ADJUSTMENT",
  "PROPERTY_SALE_PAYMENT",
  "PROPERTY_SALE_COMMISSION_ACCRUAL",
  "PROPERTY_SALE_COMMISSION_PAYOUT",
  "PAYROLL_JOURNAL",
  "DEPRECIATION",
  "DISPOSAL",
  "JOURNAL_ENTRY",
  "TAX_REMITTANCE",
  "YEAR_END_CLOSE",
];

const SOURCE_TYPES = [
  "rent_payment",
  "invoice",
  "invoice_note",
  "expense",
  "payment_voucher",
  "deposit",
  "processed_statement",
  "processed_statement_payment",
  "landlord_payment",
  "landlord_receipt",
  "meter_reading",
  "manual_adjustment",
  "system_migration",
  "advance",
  "recurring_deduction",
  "petty_cash_disbursement",
  "petty_cash_replenishment",
  "carwash_commission",
  "carwash_commission_payout",
  "carwash_payment",
  "carwash_expense",
  "carwash_prepaid_topup",
  "carwash_savings_disbursement",
  "carwash_customer_credit_created",
  "pos_sale",
  "pos_purchase_receipt",
  "pos_stock_adjustment",
  "property_sale_payment",
  "property_sale_commission",
  "property_sale_commission_payout",
  "payroll_period",
  "fixed_asset_depreciation",
  "fixed_asset_disposal",
  "journal_entry",
  "tax_remittance",
  "year_end_close",
  "expense_requisition",
  "other",
];

const ENTRY_STATUS = ["draft", "approved", "reversed", "void"];

const RECEIVER_TYPES = ["manager", "landlord", "tenant", "vendor", "staff", "system", "n/a"];

const DIRECTION_TYPES = ["debit", "credit"];

const FinancialLedgerEntrySchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      default: null,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      default: null,
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
      index: true,
    },
    serviceProvider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceProvider",
      default: null,
      index: true,
    },

    sourceTransactionType: {
      type: String,
      enum: SOURCE_TYPES,
      required: true,
      default: "other",
    },
    sourceTransactionId: {
      type: String,
      required: true,
      index: true,
    },

    transactionDate: {
      type: Date,
      required: true,
      index: true,
    },

    statementPeriodStart: {
      type: Date,
      required: true,
      index: true,
    },
    statementPeriodEnd: {
      type: Date,
      required: true,
      index: true,
    },

    category: {
      type: String,
      enum: LEDGER_CATEGORIES,
      required: true,
      index: true,
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
      index: true,
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
    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalGroup",
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    direction: {
      type: String,
      enum: DIRECTION_TYPES,
      required: true,
    },

    payer: {
      type: String,
      default: "n/a",
      trim: true,
    },
    receiver: {
      type: String,
      enum: RECEIVER_TYPES,
      default: "n/a",
      index: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ENTRY_STATUS,
      default: "approved",
    },

    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
      index: true,
    },
    reversedByEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

FinancialLedgerEntrySchema.virtual("signedAmount").get(function signedAmount() {
  return this.direction === "debit" ? -Number(this.amount || 0) : Number(this.amount || 0);
});

FinancialLedgerEntrySchema.index({
  business: 1,
  property: 1,
  landlord: 1,
  statementPeriodStart: 1,
  statementPeriodEnd: 1,
});

FinancialLedgerEntrySchema.index({
  business: 1,
  sourceTransactionType: 1,
  sourceTransactionId: 1,
  category: 1,
});

FinancialLedgerEntrySchema.index({ business: 1, transactionDate: -1 });
FinancialLedgerEntrySchema.index({ business: 1, accountId: 1, status: 1 });
FinancialLedgerEntrySchema.index({ business: 1, tenant: 1, transactionDate: -1 });
FinancialLedgerEntrySchema.index({ business: 1, property: 1, status: 1, transactionDate: -1 });
FinancialLedgerEntrySchema.index({ business: 1, landlord: 1, status: 1, transactionDate: -1 });
FinancialLedgerEntrySchema.index({ business: 1, unit: 1, status: 1, transactionDate: -1 });
// Optimized for report aggregations: $match on business+status+date, $group on accountId
FinancialLedgerEntrySchema.index({ business: 1, status: 1, transactionDate: 1, accountId: 1 });
// Optimized for ledger activity: accountId range scan + sort by date/createdAt
FinancialLedgerEntrySchema.index({ business: 1, accountId: 1, transactionDate: 1, createdAt: 1 });
FinancialLedgerEntrySchema.index({ business: 1, journalGroupId: 1, status: 1 });

FinancialLedgerEntrySchema.pre("findOneAndUpdate", function blockImmutableUpdate(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of updates."));
});

FinancialLedgerEntrySchema.pre("updateOne", function blockImmutableUpdate(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of updates."));
});

FinancialLedgerEntrySchema.pre("deleteOne", function blockImmutableDelete(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of deletes."));
});

FinancialLedgerEntrySchema.pre("findOneAndDelete", function blockImmutableDelete(next) {
  return next(new Error("FinancialLedgerEntry is immutable. Use reversal entries instead of deletes."));
});

export { LEDGER_CATEGORIES, SOURCE_TYPES, ENTRY_STATUS };
export default mongoose.model("FinancialLedgerEntry", FinancialLedgerEntrySchema);
