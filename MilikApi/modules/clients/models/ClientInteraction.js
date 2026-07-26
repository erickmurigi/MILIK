import mongoose from "mongoose";

const clientInteractionSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    type: {
      type: String,
      enum: ["email", "note", "call", "meeting", "sms"],
      required: true,
    },
    subject: { type: String, default: "" },
    body:    { type: String, default: "" },
    relatedInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientInvoice",
      default: null,
    },
    relatedContract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContract",
      default: null,
    },
    emailStatus: {
      type: String,
      enum: ["sent", "failed", "pending"],
      default: "pending",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

clientInteractionSchema.index({ business: 1, client: 1, createdAt: -1 });

export default mongoose.model("ClientInteraction", clientInteractionSchema);
