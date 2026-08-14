import mongoose from "mongoose";

const COMMISSION_TYPES = ["percentage", "flat"];
const AGENT_STATUSES = ["active", "inactive"];

const saleAgentSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    agentNumber: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    idNumber: { type: String, trim: true, default: "" },
    commissionRate: { type: Number, min: 0, default: 3 },
    commissionType: { type: String, enum: COMMISSION_TYPES, default: "percentage" },
    status: { type: String, enum: AGENT_STATUSES, default: "active", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleAgentSchema.index({ business: 1, agentNumber: 1 }, { unique: true });
saleAgentSchema.index({ business: 1, status: 1 });
saleAgentSchema.index({ fullName: "text", agentNumber: "text", phone: "text", email: "text" }, { default_language: "none" });

export default mongoose.model("SaleAgent", saleAgentSchema);
