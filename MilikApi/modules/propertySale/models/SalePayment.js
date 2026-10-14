import mongoose from "mongoose";

const PAYMENT_TYPES = ["deposit", "installment", "final_payment", "other"];
const PAYMENT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const PAYMENT_STATUSES = ["pending", "paid", "cancelled"];
// "direct" (default) = the company receives the money itself, exactly like before this field existed.
// "advocate_trust" = the advocate physically collected the money into their own trust account —
// the GL debit side goes to 1314 Advocate Trust Receivable instead of the cashbook until remitted.
const COLLECTION_METHODS = ["direct", "advocate_trust"];

const salePaymentSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    paymentNumber: { type: String, required: true, trim: true },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", required: true, index: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", default: null },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer", default: null },
    paymentType: { type: String, enum: PAYMENT_TYPES, default: "installment" },
    amount: { type: Number, required: true, min: 0 },
    paymentDate: { type: Date, default: Date.now },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "bank_transfer" },
    cashbook: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    // The advocate who physically collected this payment (only meaningful when collectionMethod is
    // "advocate_trust", but stored regardless so a deal's advocate history stays visible either way).
    advocate: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAdvocate", default: null },
    collectionMethod: { type: String, enum: COLLECTION_METHODS, default: "direct" },
    reference: { type: String, trim: true, default: "" },
    // Set only when an "advocate_trust" payment is voided — voidPayment requires this (plus
    // refundConfirmed in the request) because voiding such a payment represents a real refund the
    // advocate must have actually made to the buyer, not just a data-entry correction.
    refundReference: { type: String, trim: true, default: "" },
    status: { type: String, enum: PAYMENT_STATUSES, default: "paid" },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

salePaymentSchema.index({ business: 1, paymentNumber: 1 }, { unique: true });
salePaymentSchema.index({ business: 1, deal: 1, createdAt: -1 });
salePaymentSchema.index({ business: 1, deal: 1, status: 1 });
salePaymentSchema.index({ business: 1, paymentDate: -1 });
// totalCollected aggregate ({business, status:"paid"}) and status-filtered date sorts
salePaymentSchema.index({ business: 1, status: 1, paymentDate: -1 });
salePaymentSchema.index({ business: 1, buyer: 1 });
salePaymentSchema.index({ business: 1, deal: 1, paymentType: 1, status: 1 });
salePaymentSchema.index({ business: 1, paymentType: 1 });
salePaymentSchema.index({ business: 1, paymentMethod: 1 });

export default mongoose.model("SalePayment", salePaymentSchema);
