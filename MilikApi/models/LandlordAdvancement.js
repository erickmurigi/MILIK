import mongoose from "mongoose";

const recoveryHistorySchema = new mongoose.Schema(
  {
    processedAt: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    periodKey: { type: String, default: "", trim: true },
    periodLabel: { type: String, default: "", trim: true },
    amount: { type: Number, required: true, min: 0 },
    principalAmount: { type: Number, default: 0, min: 0 },
    interestAmount: { type: Number, default: 0, min: 0 },
    note: { type: String, default: "", trim: true },
    referenceNo: { type: String, default: "", trim: true },
    journalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalGroup",
      default: null,
    },
    visibleStatementEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
    },
    offsetEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { _id: true, timestamps: true }
);

const LandlordAdvancementSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Landlord",
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    referenceNo: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    interestRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    interestType: {
      type: String,
      enum: ["simple_flat", "reducing_balance"],
      default: "simple_flat",
    },
    scheduledInterestTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    interestRecoveredAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRecoverableAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    recoveredAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceOutstanding: {
      type: Number,
      default: 0,
      min: 0,
    },
    frequency: {
      type: String,
      enum: ["weekly", "monthly", "quarterly", "semi_annually", "annually", "yearly", "custom"],
      default: "monthly",
      index: true,
    },
    dayOfMonth: {
      type: Number,
      min: 1,
      max: 31,
      default: 5,
    },
    disbursementDate: {
      type: Date,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    periodMonths: {
      type: Number,
      default: null,
      min: 1,
    },
    gracePeriodMonths: {
      type: Number,
      default: 0,
      min: 0,
    },
    endDate: {
      type: Date,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "mobile_money", "mpesa", "cash", "check", "cheque", "credit_card", "other"],
      default: "bank_transfer",
    },
    cashbook: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChartOfAccount",
      default: null,
    },
    status: {
      type: String,
      enum: ["draft", "active", "paused", "completed", "cancelled"],
      default: "draft",
      index: true,
    },
    narration: {
      type: String,
      default: "",
      trim: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    disbursementJournalGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "JournalGroup",
      default: null,
    },
    disbursementEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
    },
    disbursementOffsetEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
    },
    disbursedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    recoveryHistory: {
      type: [recoveryHistorySchema],
      default: () => [],
    },
  },
  { timestamps: true }
);

LandlordAdvancementSchema.pre("validate", function syncBalance(next) {
  const principalAmount = Number(this.amount || 0);
  const scheduledInterestTotal = Number(this.scheduledInterestTotal || 0);
  const totalRecoverableAmount = Number(this.totalRecoverableAmount || principalAmount + scheduledInterestTotal);
  const recoveredPrincipal = Number(this.recoveredAmount || 0);
  const recoveredInterest = Number(this.interestRecoveredAmount || 0);

  this.scheduledInterestTotal = Math.max(Math.round((scheduledInterestTotal + Number.EPSILON) * 100) / 100, 0);
  this.totalRecoverableAmount = Math.max(Math.round((totalRecoverableAmount + Number.EPSILON) * 100) / 100, 0);
  this.balanceOutstanding = Math.max(
    Math.round((this.totalRecoverableAmount - recoveredPrincipal - recoveredInterest + Number.EPSILON) * 100) / 100,
    0
  );
  next();
});

LandlordAdvancementSchema.index({ business: 1, referenceNo: 1 }, { unique: true });
LandlordAdvancementSchema.index({ business: 1, landlord: 1, status: 1, createdAt: -1 });
LandlordAdvancementSchema.index({ business: 1, property: 1, status: 1, createdAt: -1 });
LandlordAdvancementSchema.index({ business: 1, landlord: 1, property: 1, "recoveryHistory.periodKey": 1 });

const LandlordAdvancement =
  mongoose.models.LandlordAdvancement ||
  mongoose.model("LandlordAdvancement", LandlordAdvancementSchema);

export default LandlordAdvancement;
