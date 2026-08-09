import mongoose from "mongoose";

const invPOSSettingsSchema = new mongoose.Schema(
  {
    business:          { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    receiptHeader:     { type: String, trim: true, default: "" },
    receiptFooter:     { type: String, trim: true, default: "Thank you for your business!" },
    showVATBreakdown:  { type: Boolean, default: true },
    showCashierName:   { type: Boolean, default: true },
    showReceiptNumber: { type: Boolean, default: true },
    autoReceiptPrint:  { type: Boolean, default: false },
    currency:          { type: String, trim: true, default: "KES" },
    currencySymbol:    { type: String, trim: true, default: "Ksh" },
    vatPIN:            { type: String, trim: true, default: "" },
    kraETIMSEnabled:   { type: Boolean, default: false },
    decimalPlaces:     { type: Number, default: 2, min: 0, max: 4 },
  },
  { timestamps: true }
);

export default mongoose.model("InvPOSSettings", invPOSSettingsSchema);
