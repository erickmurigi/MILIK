import mongoose from "mongoose";
import { voucherReferenceKey } from "../utils/voucherReference.js";

// One charge on a voucher. A voucher without lines is a single charge carried on the header fields.
const VoucherLineSchema = new mongoose.Schema(
  {
    description: { type: String, trim: true, maxlength: 200, default: "" },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
    expenseItem: { type: mongoose.Schema.Types.ObjectId, default: null },
    expenseAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    payableAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    amount: { type: Number, required: true, min: 0 },
    whtRate: { type: Number, min: 0, max: 100, default: 0 },
    whtAmount: { type: Number, min: 0, default: 0 },
  },
  { _id: true }
);

const PaymentVoucherSchema = new mongoose.Schema(
  {
    voucherNo: { type: String, required: true },
    lines: { type: [VoucherLineSchema], default: [] },
    category: {
      type: String,
      enum: [
        "landlord_maintenance",
        "deposit_refund",
        "landlord_other",
        "manager_property",
        "company_operational",
        "petty_cash_float",
        "petty_cash_expense",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["draft", "approved", "paid", "reversed"],
      default: "draft",
    },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: "Landlord", default: null },
    amount: { type: Number, required: true, min: 0 },
    whtAmount:    { type: Number, min: 0, default: 0 },
    whtNetAmount: { type: Number, min: 0, default: 0 },
    whtAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    serviceProvider: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceProvider", default: null },
    // Free-text payee fallback for a one-off vendor/individual not worth registering as
    // a full Service Provider record. Ignored (left blank) when serviceProvider is set —
    // the provider's own name is the source of truth in that case.
    payeeName: { type: String, trim: true, default: "" },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "mobile_money", "cash", "cheque", "other"],
      default: "bank_transfer",
    },
    // Where this payment is sent. Prefilled from the linked landlord or service provider, and
    // editable for this one voucher. Optional: the system records payments, it does not block them.
    payeeBank: {
      bankName: { type: String, trim: true, default: "" },
      branchName: { type: String, trim: true, default: "" },
      accountName: { type: String, trim: true, default: "" },
      accountNumber: { type: String, trim: true, default: "" },
      mobileNumber: { type: String, trim: true, default: "" }, // M-Pesa, 0XXXXXXXXX
    },
    dueDate: { type: Date, required: true },
    paidDate: { type: Date },
    reference: { type: String, trim: true, maxlength: 100 },
    // reference compared ignoring case/spaces; unique per company among live vouchers, cleared when the voucher is reversed
    referenceKey: { type: String, default: null },
    // set while a status change / edit / removal is running, so two clicks (or two users) can't post the same voucher twice
    processingAt: { type: Date, default: null },
    sourceProcessedStatement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProcessedStatement",
      default: null,
      index: true,
    },
    narration: { type: String, trim: true, maxlength: 1000 },
    sourceRequisition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseRequisition",
      default: null,
      index: true,
    },

    liabilityAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    debitAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    settlementAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    expenseRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExpenseProperty",
      default: null,
    },
    ledgerEntries: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FinancialLedgerEntry",
      },
    ],
    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidAt: { type: Date },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reversedAt: { type: Date },
    reversalReason: { type: String },
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
  },
  { timestamps: true }
);

// Only touched when a reference is entered or edited, or the voucher is reversed: vouchers saved before this existed keep
// working (and stay editable) even where two of them share a reference.
PaymentVoucherSchema.pre("validate", function (next) {
  if (this.status === "reversed") this.referenceKey = null;
  else if (this.isNew || this.isModified("reference")) this.referenceKey = voucherReferenceKey(this.reference);
  next();
});

PaymentVoucherSchema.index({ business: 1, referenceKey: 1 }, { unique: true, partialFilterExpression: { referenceKey: { $type: "string" } } });
PaymentVoucherSchema.index({ business: 1, createdAt: -1 });
PaymentVoucherSchema.index({ business: 1, voucherNo: 1 }, { unique: true });
PaymentVoucherSchema.index({ business: 1, status: 1 });
PaymentVoucherSchema.index({ business: 1, category: 1 });
PaymentVoucherSchema.index({ business: 1, property: 1, status: 1 });
PaymentVoucherSchema.index({ landlord: 1 });
PaymentVoucherSchema.index({ liabilityAccount: 1 });
PaymentVoucherSchema.index({ business: 1, sourceRequisition: 1 });
PaymentVoucherSchema.index({ business: 1, status: 1, whtAmount: 1, paidDate: -1 });
PaymentVoucherSchema.index({ business: 1, status: 1, dueDate: 1 });

export default mongoose.model("PaymentVoucher", PaymentVoucherSchema);