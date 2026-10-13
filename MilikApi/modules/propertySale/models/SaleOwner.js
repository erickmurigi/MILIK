import mongoose from "mongoose";

const OWNER_STATUSES = ["active", "inactive"];

// A property/project owner the company sells on behalf of, as the owner's selling agent.
// No commission rate here — the company's own cut is business-wide config (SaleSettings), not per-owner.
const saleOwnerSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    ownerNumber: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    idNumber: { type: String, trim: true, default: "" },
    payeeBank: {
      bankName: { type: String, trim: true, default: "" },
      branchName: { type: String, trim: true, default: "" },
      accountName: { type: String, trim: true, default: "" },
      accountNumber: { type: String, trim: true, default: "" },
      mobileNumber: { type: String, trim: true, default: "" },
    },
    status: { type: String, enum: OWNER_STATUSES, default: "active", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleOwnerSchema.index({ business: 1, ownerNumber: 1 }, { unique: true });
saleOwnerSchema.index({ business: 1, status: 1 });
saleOwnerSchema.index({ business: 1, createdAt: -1 });
saleOwnerSchema.index({ business: 1, fullName: "text", ownerNumber: "text", phone: "text", email: "text" }, { default_language: "none" });

export default mongoose.model("SaleOwner", saleOwnerSchema);
