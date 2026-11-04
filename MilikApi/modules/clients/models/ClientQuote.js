import mongoose from "mongoose";
import { contractLineSchema } from "./ClientContract.js";
import { TAX_MODES } from "../services/clientLineMath.js";

// Quote / proforma. Lines use the contract line shape so an accepted quote converts to a contract
// (or a one-off invoice) without re-keying. Totals are recomputed by the controller from the lines.
export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "expired"];

const clientQuoteSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    client:   { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    quoteNumber: { type: String, trim: true },
    kind:     { type: String, enum: ["quote", "proforma"], default: "quote" },
    title:    { type: String, trim: true, default: "" },
    issueDate: { type: Date, required: true, default: Date.now },
    validUntil: { type: Date, required: true },
    currency: { type: String, default: "KES" },
    taxMode:  { type: String, enum: TAX_MODES, default: "exclusive" },
    lines:    { type: [contractLineSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    total:    { type: Number, default: 0 },
    // First-year value of recurring lines, for quotes that will become contracts.
    recurringMonthly: { type: Number, default: 0 },
    notes:    { type: String, default: "" },
    terms:    { type: String, default: "" },
    status:   { type: String, enum: QUOTE_STATUSES, default: "draft" },
    sentAt:   { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    declineReason: { type: String, default: "" },
    expiredAt: { type: Date, default: null },
    convertedContract: { type: mongoose.Schema.Types.ObjectId, ref: "ClientContract", default: null },
    convertedInvoice:  { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clientQuoteSchema.index({ business: 1, quoteNumber: 1 }, { unique: true, sparse: true });
clientQuoteSchema.index({ business: 1, client: 1, status: 1 });
clientQuoteSchema.index({ status: 1, validUntil: 1 });

export default mongoose.model("ClientQuote", clientQuoteSchema);
