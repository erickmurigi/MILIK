import mongoose from "mongoose";

const destinationSchema = new mongoose.Schema(
  {
    accountName: { type: String, default: "", trim: true },
    accountNumber: { type: String, default: "", trim: true },
    bankName: { type: String, default: "", trim: true },
    branchName: { type: String, default: "", trim: true },
    mobileNumber: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const runHistorySchema = new mongoose.Schema(
  {
    runDate: { type: Date, required: true },
    dueDate: { type: Date, default: null },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    periodKey: { type: String, default: "", trim: true },
    periodLabel: { type: String, default: "", trim: true },
    amount: { type: Number, required: true, min: 0 },
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
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    cancellationReason: {
      type: String,
      default: "",
      trim: true,
    },
    reversalVisibleEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
    },
    reversalOffsetEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinancialLedgerEntry",
      default: null,
    },
  },
  {
    _id: true,
    timestamps: true,
  }
);

const LandlordStandingOrderSchema = new mongoose.Schema(
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
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
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
    startDate: {
      type: Date,
      required: true,
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
    destination: {
      type: destinationSchema,
      default: () => ({}),
    },
    narration: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["draft", "active", "paused", "stopped"],
      default: "draft",
      index: true,
    },
    nextRunDate: {
      type: Date,
      default: null,
    },
    lastRunDate: {
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
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    referenceNo: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },
    standingOrderNo: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    runHistory: {
      type: [runHistorySchema],
      default: () => [],
    },
    totalRuns: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalProcessedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

LandlordStandingOrderSchema.pre("validate", function syncCompatibilityFields(next) {
  if (!this.referenceNo && this.standingOrderNo) {
    this.referenceNo = this.standingOrderNo;
  }
  if (!this.standingOrderNo && this.referenceNo) {
    this.standingOrderNo = this.referenceNo;
  }
  if (!this.lastRunDate && this.lastRunAt) {
    this.lastRunDate = this.lastRunAt;
  }
  if (!this.lastRunAt && this.lastRunDate) {
    this.lastRunAt = this.lastRunDate;
  }
  next();
});

LandlordStandingOrderSchema.index({ business: 1, createdAt: -1 });
LandlordStandingOrderSchema.index({ business: 1, landlord: 1, status: 1, createdAt: -1 });
LandlordStandingOrderSchema.index({ business: 1, referenceNo: 1 }, { unique: true });
LandlordStandingOrderSchema.index({ business: 1, standingOrderNo: 1 });
LandlordStandingOrderSchema.index({ business: 1, landlord: 1, property: 1, "runHistory.periodKey": 1 });

const LandlordStandingOrder =
  mongoose.models.LandlordStandingOrder ||
  mongoose.model("LandlordStandingOrder", LandlordStandingOrderSchema);

export default LandlordStandingOrder;
