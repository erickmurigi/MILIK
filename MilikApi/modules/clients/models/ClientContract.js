import mongoose from "mongoose";

const remindersSentSchema = new mongoose.Schema(
  {
    days90: { type: Date, default: null },
    days60: { type: Date, default: null },
    days30: { type: Date, default: null },
    days7:  { type: Date, default: null },
  },
  { _id: false }
);

const clientContractSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    contractNumber: { type: String, trim: true },
    description:    { type: String, trim: true, default: "" },
    startDate:      { type: Date, required: true },
    endDate:        { type: Date, required: true },
    noticePeriodDays: { type: Number, default: 30, min: 0 },
    baseValue:      { type: Number, required: true, min: 0 },
    currentValue:   { type: Number, min: 0 },
    billingCycle: {
      type: String,
      enum: ["monthly", "quarterly", "annually"],
      default: "monthly",
    },
    currency:            { type: String, default: "KES" },
    escalationPercent:   { type: Number, default: 10, min: 0, max: 100 },
    escalationPeriodYears: { type: Number, default: 2, min: 1 },
    nextEscalationDate:  { type: Date },
    paymentTermsDays:    { type: Number, default: 30, min: 0 },
    status: {
      type: String,
      enum: ["draft", "active", "pending_renewal", "renewed", "terminated"],
      default: "draft",
    },
    documentUrl: { type: String, default: "" },
    supersedesContractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContract",
      default: null,
    },
    supersededByContractId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContract",
      default: null,
    },
    renewalStage: {
      type: String,
      enum: ["due", "contacted", "negotiating", "renewed", "lost", null],
      default: null,
    },
    lostReason:    { type: String, default: "" },
    remindersSent: { type: remindersSentSchema, default: () => ({}) },
    notes:         { type: String, default: "" },
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Pre-save: default currentValue to baseValue; compute nextEscalationDate
clientContractSchema.pre("save", function (next) {
  if (this.currentValue == null || this.currentValue === undefined) {
    this.currentValue = this.baseValue;
  }
  if (this.startDate && this.escalationPeriodYears) {
    const d = new Date(this.startDate);
    d.setFullYear(d.getFullYear() + (this.escalationPeriodYears || 2));
    this.nextEscalationDate = d;
  }
  next();
});

clientContractSchema.index({ business: 1, client: 1, status: 1 });
clientContractSchema.index({ business: 1, endDate: 1, status: 1 });
clientContractSchema.index({ business: 1, contractNumber: 1 }, { unique: true, sparse: true });

export default mongoose.model("ClientContract", clientContractSchema);
