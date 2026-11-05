import mongoose from "mongoose";

// One reset of a company's data, from the backup export to the finished wipe. Deliberately has no
// `business` field: it is the record of the reset, so the reset itself never deletes it.
const StepSchema = new mongoose.Schema(
  {
    model: { type: String, required: true },
    label: { type: String, default: "" },
    module: { type: String, default: "" },
    action: { type: String, enum: ["delete", "reset"], default: "delete" },
    total: { type: Number, default: 0 },
    done: { type: Number, default: 0 },
    status: { type: String, enum: ["pending", "running", "done"], default: "pending" },
  },
  { _id: false }
);

const CompanyDataResetSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    companyName: { type: String, default: "" },
    scope: { type: String, enum: ["transactions", "all"], required: true },
    // exporting -> ready (backup downloaded) -> running -> completed | failed
    status: {
      type: String,
      enum: ["exporting", "ready", "running", "completed", "failed"],
      default: "exporting",
      index: true,
    },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
    exportedAt: { type: Date, default: null },
    exportBytes: { type: Number, default: 0 },
    overrideFiled: { type: Boolean, default: false },
    requestedBy: {
      id: { type: String, default: "" },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    // lock state before the reset, restored when it finishes
    previousState: {
      locked: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      accountStatus: { type: String, default: "" },
    },
    steps: { type: [StepSchema], default: [] },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    error: { type: String, default: "" },
  },
  { timestamps: true }
);

CompanyDataResetSchema.index({ company: 1, createdAt: -1 });

export default mongoose.model("CompanyDataReset", CompanyDataResetSchema);
