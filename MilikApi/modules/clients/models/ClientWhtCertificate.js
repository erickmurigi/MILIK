import mongoose from "mongoose";

// A withholding certificate is "expected" the moment a client withholds tax on
// a receipt. Until the certificate (iTax income-tax WHT or VAT WHT) arrives the
// 1265/1266 recoverable balance cannot be claimed, so outstanding ones are
// chased like debts.
export const WHT_CERT_TYPES = ["income_tax", "vat"];
export const WHT_CERT_STATUSES = ["expected", "received", "cancelled"];

const clientWhtCertificateSchema = new mongoose.Schema(
  {
    business:        { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:          { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    receipt:         { type: mongoose.Schema.Types.ObjectId, ref: "ClientReceipt", required: true },
    receiptNumber:   { type: String, trim: true, default: "" },
    invoices:        [{ type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice" }],
    type:            { type: String, enum: WHT_CERT_TYPES, required: true },
    amount:          { type: Number, required: true, min: 0.01 },
    withheldDate:    { type: Date, required: true },
    certificateNo:   { type: String, trim: true, default: "" },
    certificateDate: { type: Date, default: null },
    fileUrl:         { type: String, trim: true, default: "" },
    status:          { type: String, enum: WHT_CERT_STATUSES, default: "expected" },
    receivedAt:      { type: Date, default: null },
    receivedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    notes:           { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

clientWhtCertificateSchema.index({ business: 1, receipt: 1, type: 1 }, { unique: true });
clientWhtCertificateSchema.index({ business: 1, status: 1, client: 1, withheldDate: 1 });

export default mongoose.model("ClientWhtCertificate", clientWhtCertificateSchema);
