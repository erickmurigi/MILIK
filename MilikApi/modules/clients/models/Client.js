import mongoose from "mongoose";

const contactPersonSchema = new mongoose.Schema(
  {
    name:      { type: String, trim: true, default: "" },
    role:      { type: String, trim: true, default: "" },
    email:     { type: String, trim: true, default: "" },
    phone:     { type: String, trim: true, default: "" },
    isPrimary: { type: Boolean, default: false },
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
    companyRegistration: { type: String, trim: true, default: "" },
    taxPin:              { type: String, trim: true, default: "" },
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
      enum: ["active", "inactive", "churned"],
      default: "active",
    },
    source: {
      type: String,
      enum: ["referral", "direct", "online", "other"],
      default: "direct",
    },
    contactPersons: { type: [contactPersonSchema], default: [] },
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

export default mongoose.model("Client", clientSchema);
