import mongoose from "mongoose";

// Every stock movement — positive qty = in, negative qty = out.
// Running balance per (business, location, product) is derived by summing qty.
const ENTRY_TYPES = [
  "purchase",       // goods received from supplier
  "sale",           // sold via POS
  "return",         // customer return (positive)
  "transfer_out",   // dispatched to another location
  "transfer_in",    // received from another location
  "adjustment",     // manual count correction
  "writeoff",       // damaged / expired
  "opening",        // opening stock entry
];

const invStockEntrySchema = new mongoose.Schema(
  {
    business:       { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    location:       { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true, index: true },
    product:        { type: mongoose.Schema.Types.ObjectId, ref: "InvProduct", required: true, index: true },
    type:           { type: String, enum: ENTRY_TYPES, required: true, index: true },
    qty:            { type: Number, required: true },   // positive = in, negative = out
    unitCost:       { type: Number, default: 0, min: 0 },
    totalCost:      { type: Number, default: 0 },
    // reference links
    reference:      { type: String, trim: true, default: "" },   // PO number, transfer number, receipt no.
    purchaseOrder:  { type: mongoose.Schema.Types.ObjectId, ref: "InvPurchaseOrder", default: null },
    stockTransfer:  { type: mongoose.Schema.Types.ObjectId, ref: "InvStockTransfer", default: null },
    posSale:        { type: mongoose.Schema.Types.ObjectId, ref: "POSSale", default: null },
    batch:          { type: String, trim: true, default: "" },
    expiryDate:     { type: Date, default: null },
    notes:          { type: String, trim: true, default: "" },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invStockEntrySchema.index({ business: 1, location: 1, product: 1, createdAt: -1 });
invStockEntrySchema.index({ business: 1, location: 1, type: 1, createdAt: -1 });
invStockEntrySchema.index({ business: 1, product: 1, createdAt: -1 });
invStockEntrySchema.index({ business: 1, stockTransfer: 1 });
invStockEntrySchema.index({ business: 1, purchaseOrder: 1 });

export default mongoose.model("InvStockEntry", invStockEntrySchema);
