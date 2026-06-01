import mongoose from "mongoose";

const STATEMENT_STATUSES = ["draft", "sent", "partial", "paid"];

const jobLineSchema = new mongoose.Schema(
  {
    job:         { type: mongoose.Schema.Types.ObjectId, ref: "CarWashJob", required: true },
    jobNumber:   { type: String, default: "" },
    plateNumber: { type: String, default: "" },
    serviceName: { type: String, default: "" },
    price:       { type: Number, default: 0 },
    paidAmount:  { type: Number, default: 0 },
    outstanding: { type: Number, default: 0 },
    jobDate:     { type: Date, default: null },
  },
  { _id: false }
);

const carWashAccountStatementSchema = new mongoose.Schema(
  {
    business:         { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    account:          { type: mongoose.Schema.Types.ObjectId, ref: "CarWashCreditAccount", required: true, index: true },
    statementNumber:  { type: String, trim: true, required: true },
    periodStart:      { type: Date, required: true },
    periodEnd:        { type: Date, required: true },
    openingBalance:   { type: Number, default: 0 },
    jobs:             { type: [jobLineSchema], default: [] },
    totalJobs:        { type: Number, default: 0 },
    totalInvoiced:    { type: Number, default: 0 },
    totalPaid:        { type: Number, default: 0 },
    totalOutstanding: { type: Number, default: 0 },
    closingBalance:   { type: Number, default: 0 },
    status:           { type: String, enum: STATEMENT_STATUSES, default: "draft", index: true },
    sentAt:           { type: Date, default: null },
    notes:            { type: String, trim: true, default: "" },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashAccountStatementSchema.index({ business: 1, statementNumber: 1 }, { unique: true });
carWashAccountStatementSchema.index({ business: 1, account: 1, periodStart: -1 });
carWashAccountStatementSchema.index({ business: 1, status: 1 });

export default mongoose.model("CarWashAccountStatement", carWashAccountStatementSchema);
