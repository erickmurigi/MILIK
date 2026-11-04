import mongoose from "mongoose";

// KRA PIN: one letter, nine digits, one letter (A123456789B). Individuals
// start with "A", non-individuals with "P" — that prefix is only a warning
// (clientsController), the shape itself is enforced here.
export const KRA_PIN_PATTERN = /^[A-Z]\d{9}[A-Z]$/i;

export const CLIENT_TYPES = ["company", "individual", "government", "ngo"];
// "inactive" stays for records saved before the richer lifecycle existed.
export const CLIENT_STATUSES = ["prospect", "active", "on_hold", "inactive", "churned", "blacklisted"];
export const INVOICE_RECIPIENT_MODES = ["to", "cc", "none"];

const contactPersonSchema = new mongoose.Schema(
  {
    name:      { type: String, trim: true, default: "" },
    role:      { type: String, trim: true, default: "" },
    email:     { type: String, trim: true, default: "" },
    // One number per contact; "-" is stored as blank (house rule).
    phone:     { type: String, trim: true, default: "" },
    isPrimary: { type: Boolean, default: false },
    receivesInvoices: { type: String, enum: INVOICE_RECIPIENT_MODES, default: "none" },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    line1:   { type: String, trim: true, default: "" },
    city:    { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "Kenya" },
  },
  { _id: false }
);

const billingAddressSchema = new mongoose.Schema(
  {
    line1:   { type: String, trim: true, default: "" },
    city:    { type: String, trim: true, default: "" },
    country: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const taxBehaviourSchema = new mongoose.Schema(
  {
    // Appointed VAT withholding agents withhold 2% of the taxable value.
    vatWithholdingAgent:    { type: Boolean, default: false },
    incomeTaxWhtAgent:      { type: Boolean, default: false },
    incomeTaxWhtRate:       { type: Number, default: 5, min: 0, max: 100 },
    taxExempt:              { type: Boolean, default: false },
    exemptionCertificateNo: { type: String, trim: true, default: "" },
    exemptionExpiry:        { type: Date, default: null },
  },
  { _id: false }
);

const termsSchema = new mongoose.Schema(
  {
    currency:               { type: String, trim: true, uppercase: true, default: "KES" },
    paymentTermsDays:       { type: Number, default: 30, min: 0 },
    creditLimit:            { type: Number, default: 0, min: 0 }, // 0 = no limit
    preferredPaymentMethod: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    name:       { type: String, trim: true, default: "" },
    url:        { type: String, trim: true, default: "" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    clientCode: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    tradingName:         { type: String, trim: true, default: "" },
    clientType:          { type: String, enum: CLIENT_TYPES, default: "company" },
    industry:            { type: String, trim: true, default: "" },
    companyRegistration: { type: String, trim: true, default: "" },
    taxPin: {
      type: String,
      trim: true,
      uppercase: true,
      default: "",
      validate: {
        validator: (value) => !value || KRA_PIN_PATTERN.test(value),
        message: "KRA PIN must be a letter, 9 digits and a letter (e.g. P051234567X)",
      },
    },
    vatRegistered:       { type: Boolean, default: false },
    taxBehaviour:        { type: taxBehaviourSchema, default: () => ({}) },
    terms:               { type: termsSchema, default: () => ({}) },
    email:               { type: String, trim: true, default: "" },
    phone:               { type: String, trim: true, default: "" },
    address:             { type: addressSchema, default: () => ({}) },
    billingAddress:      { type: billingAddressSchema, default: null },
    category: {
      type: String,
      enum: ["enterprise", "sme", "individual"],
      default: "individual",
    },
    status: {
      type: String,
      enum: CLIENT_STATUSES,
      default: "active",
    },
    source: {
      type: String,
      enum: ["referral", "direct", "online", "other"],
      default: "direct",
    },
    accountManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    tags:           { type: [String], default: [] },
    documents:      { type: [documentSchema], default: [] },
    contactPersons: { type: [contactPersonSchema], default: [] },
    // Collections controls: opted-out clients never get automated reminders;
    // creditHold blocks new billing (see clientCreditControlService).
    dunningOptOut:  { type: Boolean, default: false },
    creditHold:     { type: Boolean, default: false },
    creditHoldReason: { type: String, trim: true, default: "" },
    notes:          { type: String, default: "" },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Compound indexes
clientSchema.index({ business: 1, status: 1 });
clientSchema.index({ business: 1, name: 1 });
clientSchema.index(
  { business: 1, email: 1 },
  { sparse: true, partialFilterExpression: { email: { $type: "string", $gt: "" } } }
);
clientSchema.index({ business: 1, clientCode: 1 }, { unique: true, sparse: true });
// Duplicate detection + eTIMS buyer lookups by PIN/phone.
clientSchema.index(
  { business: 1, taxPin: 1 },
  { partialFilterExpression: { taxPin: { $type: "string", $gt: "" } } }
);
clientSchema.index(
  { business: 1, phone: 1 },
  { partialFilterExpression: { phone: { $type: "string", $gt: "" } } }
);
clientSchema.index({ business: 1, accountManager: 1 });

export default mongoose.model("Client", clientSchema);
