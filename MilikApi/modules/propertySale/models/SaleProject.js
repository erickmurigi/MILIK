import mongoose from "mongoose";

const PROJECT_STATUSES = ["active", "archived"];

// A project groups units that are sold independently (plots in an estate, flats in a development, ...).
// Each unit is an ordinary SaleListing with `project` + `unitNumber`, so offers, deals, payments, commissions
// and accounting need no changes. A project has no stored progress figures: those are always derived.
const saleProjectSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    projectNumber: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    location: { type: String, trim: true, default: "" },
    town: { type: String, trim: true, default: "" },
    county: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "Kenya" },
    currency: { type: String, default: "KES" },
    // Default agent for the project's units: a unit with no agent of its own inherits this one
    assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: "SaleAgent", default: null },
    launchDate: { type: Date, default: null },
    // Optional goals shown against actual sales on the project page
    targetUnits: { type: Number, min: 0, default: null },
    targetValue: { type: Number, min: 0, default: null },
    status: { type: String, enum: PROJECT_STATUSES, default: "active" },
    notes: { type: String, trim: true, default: "" },
    // Photos are managed only through the upload/delete image endpoints (same storage as listing photos)
    images: [{ type: String, trim: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleProjectSchema.index({ business: 1, projectNumber: 1 }, { unique: true });
saleProjectSchema.index({ business: 1, status: 1, createdAt: -1 });

export { PROJECT_STATUSES };
export default mongoose.model("SaleProject", saleProjectSchema);
