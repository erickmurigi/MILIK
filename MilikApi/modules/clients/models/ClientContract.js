import mongoose from "mongoose";
import {
  BILLING_FREQUENCIES,
  BILLING_TIMINGS,
  REVENUE_RECOGNITION_METHODS,
  TAX_MODES,
  computeContractMetrics,
} from "../services/clientLineMath.js";

export const CONTRACT_STATUSES = [
  "draft", "pending_approval", "active", "suspended", "pending_renewal",
  "renewed", "expired", "terminated", "cancelled",
];
export const CONTRACT_TYPES = ["retainer", "subscription", "fixed_term", "project", "time_and_materials", "one_off"];
export const CONTRACT_APPROVAL_STATUSES = ["none", "not_required", "pending", "approved", "rejected"];

const remindersSentSchema = new mongoose.Schema(
  {
    days90: { type: Date, default: null },
    days60: { type: Date, default: null },
    days30: { type: Date, default: null },
    days7:  { type: Date, default: null },
  },
  { _id: false }
);

// One priced service on the contract. `lineKey` is the line's identity across versions/amendments
// (the billing schedule idempotency key is built from it), so it is generated once and never reused.
export const contractLineSchema = new mongoose.Schema(
  {
    lineKey:            { type: String, required: true, trim: true },
    itemName:           { type: String, required: true, trim: true },
    description:        { type: String, trim: true, default: "" },
    quantity:           { type: Number, default: 1, min: 0 },
    unitPrice:          { type: Number, default: 0, min: 0 },
    discountPercent:    { type: Number, default: 0, min: 0, max: 100 },
    taxCodeKey:         { type: String, trim: true, default: null },
    // Snapshot of the tax code at save time — used for TCV/MRR; invoices re-resolve at billing.
    taxCodeName:        { type: String, trim: true, default: "" },
    taxType:            { type: String, trim: true, default: "none" },
    taxRate:            { type: Number, default: 0, min: 0 },
    billingFrequency:   { type: String, enum: BILLING_FREQUENCIES, default: "monthly" },
    billingTiming:      { type: String, enum: BILLING_TIMINGS, default: "advance" },
    revenueRecognition: { type: String, enum: REVENUE_RECOGNITION_METHODS, default: "on_invoice" },
    incomeAccount:      { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    startDate:          { type: Date, default: null },
    endDate:            { type: Date, default: null },
  },
  { _id: true }
);

const documentSchema = new mongoose.Schema(
  {
    name:       { type: String, trim: true, default: "" },
    url:        { type: String, trim: true, default: "" },
    kind:       { type: String, trim: true, default: "other" }, // signed_contract | amendment | other
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: true }
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
    contractType:   { type: String, enum: CONTRACT_TYPES, default: "retainer" },
    owner:          { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    property:       { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
    startDate:      { type: Date, required: true },
    endDate:        { type: Date, default: null },
    openEnded:      { type: Boolean, default: false },
    minimumTermMonths: { type: Number, default: 0, min: 0 },
    noticePeriodDays: { type: Number, default: 30, min: 0 },
    autoRenew:      { type: Boolean, default: false },
    renewalTermMonths: { type: Number, default: 12, min: 1 },

    // Legacy single-value pricing. Contracts with lines keep these in sync (baseValue/currentValue = TCV)
    // so the existing list/renewal-reminder screens still show a sensible value.
    baseValue:      { type: Number, default: 0, min: 0 },
    currentValue:   { type: Number, min: 0 },
    billingCycle: {
      type: String,
      enum: ["monthly", "quarterly", "annually"],
      default: "monthly",
    },

    lines:          { type: [contractLineSchema], default: [] },
    taxMode:        { type: String, enum: TAX_MODES, default: "exclusive" },
    tcv:            { type: Number, default: 0 },
    acv:            { type: Number, default: 0 },
    mrr:            { type: Number, default: 0 },
    version:        { type: Number, default: 1, min: 1 },

    billingDay:     { type: Number, default: null, min: 1, max: 28 },
    prorationRule:  { type: String, enum: ["none", "daily"], default: "none" },
    autoBill:       { type: Boolean, default: false },
    poNumber:       { type: String, trim: true, default: "" },
    currency:            { type: String, default: "KES" },
    escalationPercent:   { type: Number, default: 10, min: 0, max: 100 },
    escalationPeriodYears: { type: Number, default: 2, min: 1 },
    nextEscalationDate:  { type: Date },
    lastEscalatedAt:     { type: Date, default: null },
    paymentTermsDays:    { type: Number, default: 30, min: 0 },
    latePaymentInterestPercent: { type: Number, default: 0, min: 0, max: 100 },
    // Read by services/lateInterestService.js: rate is per month unless "annual"; interest starts
    // accruing this many days after the due date.
    latePaymentInterestBasis: { type: String, enum: ["monthly", "annual"], default: "monthly" },
    latePaymentGraceDays: { type: Number, default: 0, min: 0 },
    depositAmount:       { type: Number, default: 0, min: 0 },
    terms:               { type: String, default: "" },
    slaText:             { type: String, default: "" },

    status: {
      type: String,
      enum: CONTRACT_STATUSES,
      default: "draft",
    },
    approvalStatus:    { type: String, enum: CONTRACT_APPROVAL_STATUSES, default: "none" },
    approvalReasons:   { type: [String], default: [] },
    submittedBy:       { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt:       { type: Date, default: null },
    approvedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt:        { type: Date, default: null },
    rejectedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt:        { type: Date, default: null },
    rejectionReason:   { type: String, default: "" },
    activatedAt:       { type: Date, default: null },
    suspendedAt:       { type: Date, default: null },
    suspensionReason:  { type: String, default: "" },
    resumedAt:         { type: Date, default: null },
    terminatedAt:      { type: Date, default: null },
    terminationEffectiveDate: { type: Date, default: null },
    terminationReason: { type: String, default: "" },
    earlyTerminationFee: { type: Number, default: 0, min: 0 },
    terminationInvoice: { type: mongoose.Schema.Types.ObjectId, ref: "ClientInvoice", default: null },
    cancelledAt:       { type: Date, default: null },
    cancellationReason: { type: String, default: "" },
    expiredAt:         { type: Date, default: null },

    documentUrl: { type: String, default: "" },
    documents:   { type: [documentSchema], default: [] },
    signedDocumentUrl: { type: String, default: "" },
    signedByClientAt:  { type: Date, default: null },
    signedByClientName: { type: String, default: "" },
    signedByUsAt:      { type: Date, default: null },
    signedByUsUser:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sourceQuote:       { type: mongoose.Schema.Types.ObjectId, ref: "ClientQuote", default: null },

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

const computeEscalationDate = (startDate, years) => {
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + (Number(years) || 2));
  return d;
};

// Pre-save: derive TCV/ACV/MRR from lines; keep legacy value fields meaningful; set the first
// escalation date. nextEscalationDate is only (re)derived before any escalation has been applied —
// it used to be recomputed from startDate on every save, which silently undid every advance.
clientContractSchema.pre("save", function (next) {
  if (this.lines?.length) {
    const metrics = computeContractMetrics(this.toObject({ depopulate: true }));
    this.tcv = metrics.tcv;
    this.acv = metrics.acv;
    this.mrr = metrics.mrr;
    this.baseValue = this.isNew || !this.baseValue ? metrics.tcv : this.baseValue;
    this.currentValue = metrics.tcv;
  } else {
    if (this.currentValue == null || this.currentValue === undefined) {
      this.currentValue = this.baseValue;
    }
    const metrics = computeContractMetrics(this.toObject({ depopulate: true }));
    this.tcv = metrics.tcv;
    this.acv = metrics.acv;
    this.mrr = metrics.mrr;
  }
  if (this.startDate && this.escalationPeriodYears && !this.lastEscalatedAt
    && (this.isNew || !this.nextEscalationDate || this.isModified("startDate") || this.isModified("escalationPeriodYears"))) {
    this.nextEscalationDate = computeEscalationDate(this.startDate, this.escalationPeriodYears);
  }
  next();
});

clientContractSchema.index({ business: 1, client: 1, status: 1 });
clientContractSchema.index({ business: 1, endDate: 1, status: 1 });
clientContractSchema.index({ business: 1, contractNumber: 1 }, { unique: true, sparse: true });
clientContractSchema.index({ status: 1, nextEscalationDate: 1 });
clientContractSchema.index({ business: 1, status: 1, autoBill: 1 });

export default mongoose.model("ClientContract", clientContractSchema);
