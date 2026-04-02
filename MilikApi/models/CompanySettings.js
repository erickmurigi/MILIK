import mongoose from "mongoose";

const utilityTypeSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true },
    description: { type: String, default: "" },
    category: { type: String, enum: ["utility", "service_charge", "maintenance"], default: "utility" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const billingPeriodSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true },
    durationInDays: { type: Number, required: true },
    durationInMonths: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const commissionSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true },
    description: { type: String, default: "" },
    percentage: { type: Number, required: true },
    applicableTo: { type: String, enum: ["rent", "utilities", "all"], default: "rent" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const expenseItemSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true },
    description: { type: String, default: "" },
    code: { type: String, unique: true, sparse: true },
    category: {
      type: String,
      enum: ["maintenance", "utilities", "staffing", "supplies", "other"],
      default: "other",
    },
    defaultAmount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const taxCodeSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    key: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["vat", "zero_rated", "exempt", "none"], default: "vat" },
    rate: { type: Number, default: 0, min: 0 },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    description: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const invoiceTaxabilitySchema = new mongoose.Schema(
  {
    rent: { type: Boolean, default: false },
    utility: { type: Boolean, default: false },
    penalty: { type: Boolean, default: false },
    deposit: { type: Boolean, default: false },
  },
  { _id: false }
);

const taxSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    defaultTaxMode: { type: String, enum: ["exclusive", "inclusive"], default: "exclusive" },
    defaultTaxCodeKey: { type: String, default: "vat_standard", trim: true },
    defaultVatRate: { type: Number, default: 16, min: 0 },
    roundingPrecision: { type: Number, default: 2, min: 0, max: 4 },
    outputVatAccountCode: { type: String, default: "2140", trim: true },
    invoiceTaxableByDefault: { type: Boolean, default: false },
    invoiceTaxabilityByCategory: { type: invoiceTaxabilitySchema, default: () => ({}) },
  },
  { _id: false }
);

const CompanySettingsSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      unique: true,
    },
    utilityTypes: {
      type: [utilityTypeSchema],
      default: [],
    },
    billingPeriods: {
      type: [billingPeriodSchema],
      default: [],
    },
    commissions: {
      type: [commissionSchema],
      default: [],
    },
    expenseItems: {
      type: [expenseItemSchema],
      default: [],
    },
    taxSettings: {
      type: taxSettingsSchema,
      default: () => ({}),
    },
    taxCodes: {
      type: [taxCodeSchema],
      default: [],
    },
    currencyCode: { type: String, default: "KES" },
    decimalPlaces: { type: Number, default: 2 },
    timezone: { type: String, default: "Africa/Nairobi" },
    dateFormat: { type: String, default: "DD/MM/YYYY" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

CompanySettingsSchema.index({ company: 1 });
CompanySettingsSchema.index({ "utilityTypes.isActive": 1 });
CompanySettingsSchema.index({ "billingPeriods.isActive": 1 });
CompanySettingsSchema.index({ "expenseItems.isActive": 1 });
CompanySettingsSchema.index({ "taxCodes.key": 1 });

export default mongoose.model("CompanySettings", CompanySettingsSchema);
