import mongoose from "mongoose";

const PAYMENT_TYPES = ["deposit", "installment", "final_payment", "other"];
const PAYMENT_METHODS = ["cash", "mpesa", "bank_transfer", "cheque", "other"];
const PAYMENT_STATUSES = ["pending", "paid", "cancelled"];

const salePaymentSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    paymentNumber: { type: String, required: true, trim: true },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal", required: true, index: true },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", default: null },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer", default: null },
    paymentType: { type: String, enum: PAYMENT_TYPES, default: "installment" },
    amount: { type: Number, required: true, min: 0 },
    paymentDate: { type: Date, default: Date.now },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: "bank_transfer" },
    reference: { type: String, trim: true, default: "" },
    status: { type: String, enum: PAYMENT_STATUSES, default: "paid" },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

salePaymentSchema.index({ business: 1, paymentNumber: 1 }, { unique: true });
salePaymentSchema.index({ business: 1, deal: 1, createdAt: -1 });
salePaymentSchema.index({ business: 1, paymentDate: -1 });

export default mongoose.model("SalePayment", salePaymentSchema);
