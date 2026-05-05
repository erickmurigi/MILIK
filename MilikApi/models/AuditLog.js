import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorName: { type: String, default: "" },
    actorEmail: { type: String, default: "" },
    action: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: ["auth", "users", "company", "settings", "finance", "property", "system"],
      default: "system",
      index: true,
    },
    severity: {
      type: String,
      enum: ["info", "important", "critical"],
      default: "important",
      index: true,
    },
    targetType: { type: String, default: "" },
    targetId: { type: String, default: "" },
    targetName: { type: String, default: "" },
    message: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

auditLogSchema.index({ company: 1, createdAt: -1 });
auditLogSchema.index({ company: 1, category: 1, createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
