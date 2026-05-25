import mongoose from "mongoose";

const TRANSFER_STATUSES = ["draft", "in_transit", "partially_received", "received", "cancelled"];

const transferLineSchema = new mongoose.Schema(
  {
    product:       { type: mongoose.Schema.Types.ObjectId, ref: "InvProduct", required: true },
    qtyDispatched: { type: Number, required: true, min: 0 },
    qtyReceived:   { type: Number, default: 0, min: 0 },
    unitCost:      { type: Number, default: 0, min: 0 },
    notes:         { type: String, trim: true, default: "" },
  },
  { _id: true }
);

const invStockTransferSchema = new mongoose.Schema(
  {
    business:       { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    transferNumber: { type: String, required: true, trim: true },
    fromLocation:   { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true },
    toLocation:     { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true },
    status:         { type: String, enum: TRANSFER_STATUSES, default: "draft", index: true },
    lines:          [transferLineSchema],
    dispatchedAt:   { type: Date, default: null },
    dispatchedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    receivedAt:     { type: Date, default: null },
    receivedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    notes:          { type: String, trim: true, default: "" },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invStockTransferSchema.index({ business: 1, transferNumber: 1 }, { unique: true });
invStockTransferSchema.index({ business: 1, status: 1, createdAt: -1 });
invStockTransferSchema.index({ business: 1, fromLocation: 1, createdAt: -1 });
invStockTransferSchema.index({ business: 1, toLocation: 1, createdAt: -1 });

export default mongoose.model("InvStockTransfer", invStockTransferSchema);
