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

const unitTypeSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    category: { type: String, enum: ["residential", "commercial", "mixed"], default: "residential" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const maintenanceCategorySchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    priority: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const billingPeriodSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    key: {
      type: String,
      required: true,
      trim: true,
      default: function () {
        return String(this?.name || "monthly")
          .trim()
          .toLowerCase()
          .replace(/&/g, " and ")
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .replace(/_+/g, "_") || "monthly";
      },
    },
    name: { type: String, required: true, trim: true },
    durationInDays: { type: Number, required: true },
    durationInMonths: { type: Number, default: 0 },
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
    // NOTE: `unique` on an embedded subdocument field is NOT enforced by MongoDB without
    // a top-level compound index (e.g. { company: 1, "expenseItems.code": 1 }).
    // Uniqueness of expense item codes is enforced in the controller layer instead.
    code: { type: String, default: "" },
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

const depositTypeSchema = new mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    name: { type: String, required: true },
    description: { type: String, default: "" },
    code: { type: String, default: "", trim: true },
    defaultAmount: { type: Number, default: 0 },
    refundable: { type: Boolean, default: true },
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

const inventoryAccountingDefaultsSchema = new mongoose.Schema(
  {
    inventoryAssetAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    cogsAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    salesRevenueAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    stockAdjustmentAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    purchaseClearingAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
  },
  { _id: false }
);

const hrAccountingDefaultsSchema = new mongoose.Schema(
  {
    salaryExpenseAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    netPayableAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    payePayableAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    nhifPayableAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    nssfPayableAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    ahlPayableAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    otherDeductionsPayableAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    employerNhifExpenseAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    employerNssfExpenseAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    employerAhlExpenseAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
  },
  { _id: false }
);

const accountingDefaultsSchema = new mongoose.Schema(
  {
    tenantReceivableAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    rentIncomeAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    utilityRechargeIncomeAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    penaltyIncomeAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    depositLiabilityAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    managementCommissionIncomeAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    leaseAgreementFeeIncomeAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
  },
  { _id: false }
);

const incomeRulesSchema = new mongoose.Schema(
  {
    latePenaltyBeneficiary: {
      type: String,
      enum: ["landlord", "manager"],
      default: "manager",
    },
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
    unitTypes: {
      type: [unitTypeSchema],
      default: [],
    },
    maintenanceCategories: {
      type: [maintenanceCategorySchema],
      default: [],
    },
    billingPeriods: {
      type: [billingPeriodSchema],
      default: [],
    },
    expenseItems: {
      type: [expenseItemSchema],
      default: [],
    },
    depositTypes: {
      type: [depositTypeSchema],
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
    accountingDefaults: {
      type: accountingDefaultsSchema,
      default: () => ({}),
    },
    inventoryAccountingDefaults: {
      type: inventoryAccountingDefaultsSchema,
      default: () => ({}),
    },
    hrAccountingDefaults: {
      type: hrAccountingDefaultsSchema,
      default: () => ({}),
    },
    autoInvoicing: {
      type: new mongoose.Schema({
        enabled:          { type: Boolean, default: false },
        billingDay:       { type: Number, default: 1, min: 1, max: 28 },
        daysInAdvance:    { type: Number, default: 0, min: 0, max: 14 },
        notifyTenants:    { type: Boolean, default: false },
        notifyChannel:    { type: String, enum: ["sms", "email", "both", "none"], default: "none" },
        lastRunAt:        { type: Date, default: null },
        lastRunSummary:   { type: String, default: null },
        runHistory: {
          type: [new mongoose.Schema({
            runAt:       { type: Date, required: true },
            created:     { type: Number, default: 0 },
            skipped:     { type: Number, default: 0 },
            errors:      { type: Number, default: 0 },
            summary:     { type: String, default: "" },
            triggeredBy: { type: String, enum: ["cron", "manual"], default: "cron" },
          }, { _id: false })],
          default: [],
        },
      }, { _id: false }),
      default: () => ({}),
    },
    incomeRules: {
      type: incomeRulesSchema,
      default: () => ({}),
    },
    mriRate: { type: Number, default: 0.075, min: 0, max: 1 },
    currencyCode: { type: String, default: "KES" },
    decimalPlaces: { type: Number, default: 2 },
    timezone: { type: String, default: "Africa/Nairobi" },
    dateFormat: { type: String, default: "DD/MM/YYYY" },
    isActive: { type: Boolean, default: true },
    terminology: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

CompanySettingsSchema.index({ "utilityTypes.isActive": 1 });
CompanySettingsSchema.index({ "unitTypes.isActive": 1 });
CompanySettingsSchema.index({ "maintenanceCategories.isActive": 1 });
CompanySettingsSchema.index({ "billingPeriods.isActive": 1 });
CompanySettingsSchema.index({ "billingPeriods.key": 1 });
CompanySettingsSchema.index({ "expenseItems.isActive": 1 });
CompanySettingsSchema.index({ "depositTypes.isActive": 1 });
CompanySettingsSchema.index({ "taxCodes.key": 1 });

export default mongoose.model("CompanySettings", CompanySettingsSchema);
