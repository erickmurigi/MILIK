import mongoose from "mongoose";

const MOVEMENT_TYPES = ["opening_float", "closing_float", "cash_in", "cash_out"];

const posTillMovementSchema = new mongoose.Schema(
  {
    business:  { type: mongoose.Schema.Types.ObjectId, ref: "Company",     required: true },
    session:   { type: mongoose.Schema.Types.ObjectId, ref: "POSSession",  required: true },
    till:      { type: mongoose.Schema.Types.ObjectId, ref: "InvTill",     required: true },
    location:  { type: mongoose.Schema.Types.ObjectId, ref: "InvLocation", required: true },
    type:      { type: String, enum: MOVEMENT_TYPES, required: true },
    amount:    { type: Number, required: true, min: 0 },
    reason:    { type: String, trim: true, default: "" },
    reference: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

posTillMovementSchema.index({ business: 1, session: 1, createdAt: -1 });
posTillMovementSchema.index({ business: 1, till: 1, createdAt: -1 });

export default mongoose.model("POSTillMovement", posTillMovementSchema);
