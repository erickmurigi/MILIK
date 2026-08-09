import mongoose from "mongoose";

const SESSION_STATUSES = ["open", "closed"];

const posSessionSchema = new mongoose.Schema(
  {
    business:        { type: mongoose.Schema.Types.ObjectId, ref: "Company",     required: true, index: true },
    location:        { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true, index: true },
    till:            { type: mongoose.Schema.Types.ObjectId, ref: "InvTill",     default: null },
    sessionNumber:   { type: String, required: true, trim: true },
    status:          { type: String, enum: SESSION_STATUSES, default: "open", index: true },
    openedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    openedAt:        { type: Date, default: Date.now },
    closedAt:        { type: Date, default: null },
    openingFloat:    { type: Number, default: 0, min: 0 },
    closingFloat:    { type: Number, default: 0 },
    expectedCash:    { type: Number, default: 0 },
    cashVariance:    { type: Number, default: 0 },
    totalCashIn:     { type: Number, default: 0 },
    totalCashOut:    { type: Number, default: 0 },
    totalSales:      { type: Number, default: 0 },
    totalCash:       { type: Number, default: 0 },
    totalMpesa:      { type: Number, default: 0 },
    totalCard:       { type: Number, default: 0 },
    totalCredit:     { type: Number, default: 0 },
    totalVoids:      { type: Number, default: 0 },
    salesCount:      { type: Number, default: 0 },
    notes:           { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

posSessionSchema.index({ business: 1, sessionNumber: 1 }, { unique: true });
posSessionSchema.index({ business: 1, location: 1, status: 1 });
posSessionSchema.index({ business: 1, till: 1, status: 1 });
posSessionSchema.index({ business: 1, openedAt: -1 });

export default mongoose.model("POSSession", posSessionSchema);
