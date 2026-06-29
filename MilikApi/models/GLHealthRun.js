import mongoose from "mongoose";

const RepairLogSchema = new mongoose.Schema(
  {
    repairType:      { type: String, required: true },
    appliedAt:       { type: Date, default: () => new Date() },
    appliedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    description:     { type: String, default: "" },
    outcome:         { type: String, enum: ["success", "failed"], default: "success" },
    recordsAffected: { type: Number, default: 0 },
    errorMessage:    { type: String, default: "" },
  },
  { _id: false }
);

const GLHealthRunSchema = new mongoose.Schema(
  {
    business:      { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    ranBy:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    runAt:         { type: Date, default: () => new Date() },
    overallStatus: { type: String, enum: ["clean", "warnings", "critical"], default: "clean" },
    issueCount:    { type: Number, default: 0 },
    issues:        [{ severity: { type: String }, issue: { type: String }, _id: false }],
    repairs:       [RepairLogSchema],
  },
  { timestamps: false }
);

GLHealthRunSchema.index({ business: 1, runAt: -1 });

export default mongoose.model("GLHealthRun", GLHealthRunSchema);
