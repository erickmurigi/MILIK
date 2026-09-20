import mongoose from "mongoose";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "site_visited", "proposal_sent", "negotiating", "converted", "lost"];

const saleLeadSchema = new mongoose.Schema(
  {
    business:           { type: mongoose.Schema.Types.ObjectId, ref: "Company",    required: true },
    leadNumber:         { type: String,  required: true, trim: true },
    fullName:           { type: String,  required: true, trim: true },
    phone:              { type: String,  trim: true, default: "" },
    email:              { type: String,  trim: true, lowercase: true, default: "" },
    source:             { type: String,  trim: true,          default: "walk_in" }, // admin-configurable in Sale Settings
    status:             { type: String,  trim: true,          default: "new" }, // fixed set + the business's own Sale Settings pipeline stages (validated in leadsController)
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
saleLeadSchema.index({ business: 1, createdAt: -1 });
saleLeadSchema.index({ business: 1, assignedAgent: 1 });
saleLeadSchema.index({ business: 1, nextFollowUpDate: 1 });
saleLeadSchema.index(
  { fullName: "text", phone: "text", email: "text", leadNumber: "text" },
  { default_language: "none" }
);

export default mongoose.model("SaleLead", saleLeadSchema);
