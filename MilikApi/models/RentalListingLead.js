import mongoose from "mongoose";

const LEAD_STATUSES = ["new", "contacted", "converted", "lost"];
const LEAD_SOURCES = ["public_site", "referral", "walk_in", "other"];

const rentalListingLeadSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "Unit", required: true, index: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
    leadNumber: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    message: { type: String, trim: true, default: "" },
    source: { type: String, enum: LEAD_SOURCES, default: "public_site" },
    status: { type: String, enum: LEAD_STATUSES, default: "new" },
    notes: { type: String, trim: true, default: "" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

rentalListingLeadSchema.index({ business: 1, leadNumber: 1 }, { unique: true });
rentalListingLeadSchema.index({ business: 1, status: 1, createdAt: -1 });
rentalListingLeadSchema.index(
  { fullName: "text", phone: "text", email: "text", leadNumber: "text" },
  { default_language: "none" }
);

export default mongoose.model("RentalListingLead", rentalListingLeadSchema);
