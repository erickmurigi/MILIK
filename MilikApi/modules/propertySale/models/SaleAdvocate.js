import mongoose from "mongoose";

const ADVOCATE_STATUSES = ["active", "inactive"];

// A conveyancing advocate/firm that physically collects buyer payments into their own client/trust
// account before remitting to the company — see SaleAdvocateRemittance for the remittance workflow
// and 1314 Advocate Trust Receivable (propertySaleAccountingService.js) for the GL side.
// Deliberately no fee/rate field — Kenyan practice is usually the buyer pays their own legal fee
// directly, not something recharged to the owner; don't model a cost flow nobody's confirmed.
const saleAdvocateSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    advocateNumber: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    firm: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    idNumber: { type: String, trim: true, default: "" },
    status: { type: String, enum: ADVOCATE_STATUSES, default: "active", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

saleAdvocateSchema.index({ business: 1, advocateNumber: 1 }, { unique: true });
saleAdvocateSchema.index({ business: 1, status: 1 });
saleAdvocateSchema.index({ business: 1, createdAt: -1 });
saleAdvocateSchema.index({ business: 1, fullName: "text", advocateNumber: "text", firm: "text", phone: "text", email: "text" }, { default_language: "none" });

export default mongoose.model("SaleAdvocate", saleAdvocateSchema);
