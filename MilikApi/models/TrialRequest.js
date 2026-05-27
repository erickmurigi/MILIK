import mongoose from "mongoose";

const trialRequestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    phone: { type: String, trim: true, default: "" },
    company: { type: String, trim: true, default: "" },
    role: {
      type: String,
      enum: ["property_manager", "landlord"],
      default: "property_manager",
    },
    portfolioSize: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    selectedModules: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["pending", "contacted", "converted", "demo_started", "demo_expired"],
      default: "pending",
    },
    demoTokenIssued: { type: Boolean, default: false },
    demoStartedAt: { type: Date, default: null },
    demoExpiresAt: { type: Date, default: null },
    demoCompany: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    lastAdminNotificationAt: { type: Date, default: null },
    lastDemoAccessEmailSentAt: { type: Date, default: null },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  }
);

trialRequestSchema.index({ status: 1, demoExpiresAt: 1 });
trialRequestSchema.index({ demoCompany: 1 });

export default mongoose.model("TrialRequest", trialRequestSchema);
