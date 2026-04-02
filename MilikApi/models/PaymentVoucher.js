import mongoose from "mongoose";

const PaymentVoucherSchema = new mongoose.Schema(
  {
    voucherNo: { type: String, required: true },
    category: {
      type: String,
      enum: ["landlord_maintenance", "deposit_refund", "landlord_other"],
      required: true,
    },
    status: {
      type: String,
      enum: ["draft", "approved", "paid", "reversed"],
      default: "draft",
    },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: "Landlord", default: null },
    amount: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, required: true },
    paidDate: { type: Date },
    reference: { type: String },
    narration: { type: String, trim: true, maxlength: 1000 },

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

PaymentVoucherSchema.index({ business: 1, createdAt: -1 });
PaymentVoucherSchema.index({ business: 1, voucherNo: 1 }, { unique: true });
PaymentVoucherSchema.index({ business: 1, status: 1 });
PaymentVoucherSchema.index({ business: 1, category: 1 });
PaymentVoucherSchema.index({ property: 1 });
PaymentVoucherSchema.index({ landlord: 1 });
PaymentVoucherSchema.index({ liabilityAccount: 1 });

export default mongoose.model("PaymentVoucher", PaymentVoucherSchema);