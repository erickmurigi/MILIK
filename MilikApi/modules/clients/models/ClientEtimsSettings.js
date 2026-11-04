import mongoose from "mongoose";

// KRA eTIMS (OSCU) connection per company. Disabled by default: every eTIMS
// call is a no-op until a company is onboarded with KRA and switches it on.
// cmcKey is a device secret, stored encrypted (utils/smtpMailer.js
// encryptStoredSecret, the same AES-256-GCM helper SMTP passwords use) and
// never returned by the API.
const clientEtimsSettingsSchema = new mongoose.Schema(
  {
    business:     { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    enabled:      { type: Boolean, default: false },
    environment:  { type: String, enum: ["sandbox", "production"], default: "sandbox" },
    // Base URL of the OSCU/VSCU service; blank = KRA default for the environment.
    baseUrl:      { type: String, trim: true, default: "" },
    kraPin:       { type: String, trim: true, uppercase: true, default: "" },
    branchId:     { type: String, trim: true, default: "00" },
    deviceSerial: { type: String, trim: true, default: "" },
    cmcKeyEncrypted: { type: String, default: "" },
    // Returned by device initialisation; the CU invoice number is sdcId/rcptNo.
    sdcId:        { type: String, trim: true, default: "" },
    mrcNo:        { type: String, trim: true, default: "" },
    lastInitializedAt: { type: Date, default: null },
    // KRA item classification / item code used when an invoice line has none.
    defaultItemClassCode: { type: String, trim: true, default: "" },
    defaultItemCode:      { type: String, trim: true, default: "" },
    defaultQtyUnitCode:   { type: String, trim: true, default: "U" },
    defaultPkgUnitCode:   { type: String, trim: true, default: "NT" },
    maxAttempts:  { type: Number, default: 6, min: 1, max: 20 },
    updatedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

clientEtimsSettingsSchema.index({ business: 1 }, { unique: true });

export default mongoose.model("ClientEtimsSettings", clientEtimsSettingsSchema);
