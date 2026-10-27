import mongoose from "mongoose";

const pushTokenSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    company:  { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    token:    { type: String, required: true, trim: true },
    platform: { type: String, enum: ["ios", "android"], default: "android" },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One row per device token — a user can hold several (multiple devices), but the same
// token is never duplicated across rows (re-registering on app launch just touches it).
pushTokenSchema.index({ token: 1 }, { unique: true });

export default mongoose.model("PushToken", pushTokenSchema);
