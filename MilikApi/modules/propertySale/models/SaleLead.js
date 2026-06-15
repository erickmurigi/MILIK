import mongoose from "mongoose";

const LEAD_STATUSES = ["new", "contacted", "qualified", "site_visited", "proposal_sent", "negotiating", "converted", "lost"];
const LEAD_SOURCES  = ["walk_in", "referral", "online", "social_media", "agent", "cold_call", "other"];

const saleLeadSchema = new mongoose.Schema(
  {
    business:           { type: mongoose.Schema.Types.ObjectId, ref: "Company",    required: true, index: true },
    leadNumber:         { type: String,  required: true, trim: true },
    fullName:           { type: String,  required: true, trim: true },
    phone:              { type: String,  trim: true, default: "" },
    email:              { type: String,  trim: true, lowercase: true, default: "" },
    source:             { type: String,  enum: LEAD_SOURCES,  default: "walk_in" },
    status:             { type: String,  enum: LEAD_STATUSES, default: "new" },
    assignedAgent:      { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent",  default: null },
    interestedListings: [{ type: mongoose.Schema.Types.ObjectId, ref: "SaleListing" }],
    budgetMin:          { type: Number,  default: 0 },
    budgetMax:          { type: Number,  default: 0 },
    notes:              { type: String,  trim: true, default: "" },
    lostReason:         { type: String,  trim: true, default: "" },
    nextFollowUpDate:   { type: Date,    default: null },
    lastContactDate:    { type: Date,    default: null },
    convertedBuyer:     { type: mongoose.Schema.Types.ObjectId, ref: "SaleBuyer",  default: null },
    convertedAt:        { type: Date,    default: null },
    createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User",       default: null },
    updatedBy:          { type: mongoose.Schema.Types.ObjectId, ref: "User",       default: null },
  },
  { timestamps: true }
);

saleLeadSchema.index({ business: 1, leadNumber: 1 }, { unique: true });
saleLeadSchema.index({ business: 1, status: 1, createdAt: -1 });
saleLeadSchema.index({ business: 1, assignedAgent: 1 });
saleLeadSchema.index({ business: 1, nextFollowUpDate: 1 });
saleLeadSchema.index(
  { fullName: "text", phone: "text", email: "text", leadNumber: "text" },
  { default_language: "none" }
);

export default mongoose.model("SaleLead", saleLeadSchema);
