import mongoose from "mongoose";

const inspectionSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true, index: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: "Unit", default: null, index: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
    inspectionNumber: { type: String, trim: true, default: "", index: true },
    type: {
      type: String,
      enum: ["routine", "move_in", "move_out", "safety", "emergency", "custom"],
      default: "routine",
      index: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "in_progress", "completed", "cancelled"],
      default: "scheduled",
      index: true,
    },
    inspectorName: { type: String, trim: true, required: true },
    scheduledDate: { type: Date, required: true, index: true },
    completedDate: { type: Date, default: null },
    score: { type: Number, min: 0, max: 100, default: null },
    issuesFound: { type: Number, min: 0, default: 0 },
    recommendations: { type: String, trim: true, default: "" },
    nextInspectionDate: { type: Date, default: null },
    tenantPresent: { type: Boolean, default: false },
    notes: { type: String, trim: true, default: "" },
    photosCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

inspectionSchema.index({ business: 1, property: 1, scheduledDate: -1 });
inspectionSchema.index({ business: 1, status: 1, type: 1 });
inspectionSchema.index({ business: 1, unit: 1 });

export default mongoose.model("Inspection", inspectionSchema);
