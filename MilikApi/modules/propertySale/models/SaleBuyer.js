import mongoose from "mongoose";

const KYC_STATUSES = ["pending", "verified", "rejected"];

const saleBuyerSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    buyerNumber: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    idNumber: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    address: { type: String, trim: true, default: "" },
    nationality: { type: String, trim: true, default: "Kenyan" },
    // Free-form: lead sources are admin-configurable in Sale Settings and carry over on conversion
    source: { type: String, trim: true, default: "walk_in" },
    kycStatus: { type: String, enum: KYC_STATUSES, default: "pending" },
    kycDocuments: [{ type: String, trim: true }],
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleBuyerSchema.index({ business: 1, buyerNumber: 1 }, { unique: true });
saleBuyerSchema.index({ business: 1, createdAt: -1 });
saleBuyerSchema.index({ business: 1, fullName: "text", buyerNumber: "text", phone: "text", email: "text", idNumber: "text" }, { default_language: "none" });

export default mongoose.model("SaleBuyer", saleBuyerSchema);
