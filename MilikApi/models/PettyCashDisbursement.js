import mongoose from "mongoose";

export const PETTY_CASH_CATEGORIES = [
  "maintenance",
  "cleaning",
  "security",
  "transport",
  "office_supplies",
  "utilities",
  "garden",
  "staff_welfare",
  "miscellaneous",
];

export const PETTY_CASH_CATEGORY_LABELS = {
  maintenance: "Maintenance & Repairs",
  cleaning: "Cleaning Supplies",
  security: "Security",
  transport: "Transport & Fuel",
  office_supplies: "Office Supplies",
  utilities: "Utilities (Common Areas)",
  garden: "Garden & Grounds",
  staff_welfare: "Staff Welfare",
  miscellaneous: "Miscellaneous",
};

const PettyCashDisbursementSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    pettyCashAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PettyCashAccount",
      required: true,
      index: true,
    },
    voucherNumber: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    category: {
      type: String,
      enum: PETTY_CASH_CATEGORIES,
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      default: null,
      index: true,
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
      default: null,
    },
    expenseAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    receiptAttached: {
      type: Boolean,
      default: false,
    },
    receiptNote: {
      type: String,
      trim: true,
      default: "",
      maxlength: 300,
    },
    status: {
      type: String,
      enum: ["active", "void"],
      default: "active",
    },
    postedToLedger: {
      type: Boolean,
      default: false,
    },
    ledgerEntries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FinancialLedgerEntry",
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    voidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    voidedAt: {
      type: Date,
      default: null,
    },
    voidReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

PettyCashDisbursementSchema.index({ business: 1, pettyCashAccount: 1, date: -1 });
PettyCashDisbursementSchema.index({ business: 1, status: 1 });
PettyCashDisbursementSchema.index({ pettyCashAccount: 1, voucherNumber: 1 }, { unique: true });

export default mongoose.model("PettyCashDisbursement", PettyCashDisbursementSchema);
