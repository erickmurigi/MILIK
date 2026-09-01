import mongoose from "mongoose";

const ACTIVITY_TYPES = ["call", "email", "meeting", "site_visit", "whatsapp", "note", "follow_up"];
const OUTCOMES       = ["positive", "neutral", "negative", "no_answer", "not_applicable"];

const saleActivitySchema = new mongoose.Schema(
  {
    business:        { type: mongoose.Schema.Types.ObjectId, ref: "Company",     required: true },
    activityNumber:  { type: String, required: true, trim: true },
    type:            { type: String, enum: ACTIVITY_TYPES, required: true },
    subject:         { type: String, trim: true, default: "" },
    notes:           { type: String, trim: true, default: "" },
    date:            { type: Date,   required: true, default: Date.now },
    durationMinutes: { type: Number, default: 0 },
    outcome:         { type: String, enum: OUTCOMES, default: "not_applicable" },
    nextAction:      { type: String, trim: true, default: "" },
    nextActionDate:  { type: Date,   default: null },
    relatedLead:     { type: mongoose.Schema.Types.ObjectId, ref: "SaleLead",    default: null },
    relatedBuyer:    { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer",   default: null },
    relatedDeal:     { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal",    default: null },
    relatedListing:  { type: mongoose.Schema.Types.ObjectId, ref: "SaleListing", default: null },
    createdBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User",        default: null },
    updatedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User",        default: null },
  },
  { timestamps: true }
);

saleActivitySchema.index({ business: 1, activityNumber: 1 }, { unique: true });
saleActivitySchema.index({ business: 1, relatedLead:    1, date: -1 });
saleActivitySchema.index({ business: 1, relatedBuyer:   1, date: -1 });
saleActivitySchema.index({ business: 1, relatedDeal:    1, date: -1 });
saleActivitySchema.index({ business: 1, relatedListing: 1, date: -1 });
saleActivitySchema.index({ business: 1, date: -1 });
saleActivitySchema.index({ business: 1, type: 1, date: -1 });

export default mongoose.model("SaleActivity", saleActivitySchema);
