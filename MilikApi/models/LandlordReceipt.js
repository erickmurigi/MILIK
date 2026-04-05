import mongoose from "mongoose";

const RECEIPT_CATEGORIES = [
  "owner_float",
  "expense_reimbursement",
  "advance_settlement",
  "utility_funding",
  "deposit_funding",
  "other_adjusted_receipt",
];

const RECEIPT_STATUSES = ["draft", "posted", "reversed"];
const PAYMENT_METHODS = ["bank_transfer", "mobile_money", "cash", "check", "credit_card"];

const LandlordReceiptSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    receiptNumber: {
      type: String,
      required: true,
      trim: true,
    },
    receiptDate: {
      type: Date,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      enum: RECEIPT_CATEGORIES,
      required: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      required: true,
    },
    cashbook: {
      type: String,
      required: true,
      trim: true,
    },
    referenceNumber: {
      type: String,
      required: true,
      trim: true,
    },
    narration: {
      type: String,
      default: "",
      trim: true,
    },
    linkedDocumentType: {
      type: String,
      default: "",
      trim: true,
    },
    linkedDocumentId: {
      type: String,
      default: "",
      trim: true,
    },
    linkedDocumentRef: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: RECEIPT_STATUSES,
      default: "draft",
      index: true,
    },
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    postedAt: {
      type: Date,
      default: null,
    },
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reversedAt: {
      type: Date,
      default: null,
    },
    reversalReason: {
      type: String,
      default: null,
      trim: true,
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
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

LandlordReceiptSchema.index({ business: 1, receiptNumber: 1 }, { unique: true });
LandlordReceiptSchema.index({ business: 1, referenceNumber: 1 });
LandlordReceiptSchema.index({ business: 1, landlord: 1, receiptDate: -1 });
LandlordReceiptSchema.index({ business: 1, property: 1, receiptDate: -1 });

export { RECEIPT_CATEGORIES, RECEIPT_STATUSES, PAYMENT_METHODS };
export default mongoose.model("LandlordReceipt", LandlordReceiptSchema);
