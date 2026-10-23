import mongoose from "mongoose";

const ADVOCATE_STATUSES = ["active", "inactive"];

// A conveyancing advocate/firm that physically collects buyer payments into their own client/trust
// account, paying the broker/owner/company directly from it (postPropertySaleCommissionPayout /
// postSaleOwnerPayout / postAgencyCommissionPayout) — see 1314 Advocate Trust Receivable
// (propertySaleAccountingService.js) for the GL side.
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
    // A firm can have several people with their own logins (partners, conveyancing clerks) — all scoped
    // identically, since every scoping helper in advocateScope.js keys off the advocate (firm) id, never
    // the user id. See scripts/migrateAdvocateUserIds.js for the one-time migration off the old singular
    // `userId` field.
    userIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [], index: true },
    // Who withholds/remits WHT when this advocate physically pays out a broker's commission from
    // trust funds: "advocate" = self-remits to KRA under their own registration (no 2141 leg on our
    // books); "agent" = forwards the withheld amount to the company, which remits via the existing
    // WHT machinery (2141 gets credited, same as a normal direct-pay commission). null = inherit
    // SaleSettings.advocateDefaults.whtHandledBy — see resolveWhtHandler in propertySaleAccountingService.js.
    whtHandledBy: { type: String, enum: ["advocate", "agent"], default: null },
    // Periodic control log comparing this advocate's actually-stated trust balance (from their own
    // bank/client-account statement) against our system's computed balance. Read-only against the
    // GL — no posting happens from this, it is an audit/control record only.
    trustReconciliation: [
      {
        _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
        date: { type: Date, default: Date.now },
        statedBalance: { type: Number },
        systemBalance: { type: Number },
        variance: { type: Number },
        reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        notes: { type: String, trim: true, default: "" },
      },
    ],
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
