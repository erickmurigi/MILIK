import mongoose from "mongoose";

const MpesaCollectionSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    configId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    configName: {
      type: String,
      trim: true,
      default: "",
    },
    shortCode: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    source: {
      type: String,
      enum: ["manual_batch", "callback_validation", "callback_confirmation"],
      default: "manual_batch",
      index: true,
    },
    importBatchId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    transactionCode: {
      type: String,
      trim: true,
      default: "",
    },
    externalSignature: {
      type: String,
      trim: true,
      default: "",
    },
    transactionDate: {
      type: Date,
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      default: 0,
    },
    accountReference: {
      type: String,
      trim: true,
      default: "",
    },
    billRefNumber: {
      type: String,
      trim: true,
      default: "",
    },
    msisdn: {
      type: String,
      trim: true,
      default: "",
    },
    payerName: {
      type: String,
      trim: true,
      default: "",
    },
    firstName: {
      type: String,
      trim: true,
      default: "",
    },
    middleName: {
      type: String,
      trim: true,
      default: "",
    },
    lastName: {
      type: String,
      trim: true,
      default: "",
    },
    orgAccountBalance: {
      type: String,
      trim: true,
      default: "",
    },
    transType: {
      type: String,
      trim: true,
      default: "",
    },
    transTimeRaw: {
      type: String,
      trim: true,
      default: "",
    },
    rawLine: {
      type: String,
      trim: true,
      default: "",
    },
    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    matchingStatus: {
      type: String,
      enum: ["unmatched", "matched_tenant", "captured", "duplicate", "ignored"],
      default: "unmatched",
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
    },
    matchedReceipt: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RentPayment",
      default: null,
    },
    duplicateOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MpesaCollection",
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    importedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

MpesaCollectionSchema.index(
  { business: 1, transactionCode: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { transactionCode: { $type: "string", $gt: "" } },
    name: "mpesa_collection_transaction_unique",
  }
);

MpesaCollectionSchema.index(
  { business: 1, externalSignature: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { externalSignature: { $type: "string", $gt: "" } },
    name: "mpesa_collection_signature_unique",
  }
);

MpesaCollectionSchema.index({ business: 1, matchingStatus: 1, transactionDate: -1 });
MpesaCollectionSchema.index({ business: 1, source: 1, createdAt: -1 });
MpesaCollectionSchema.index({ business: 1, tenant: 1, transactionDate: -1 });
MpesaCollectionSchema.index({ business: 1, matchedReceipt: 1, transactionDate: -1 });

export default mongoose.model("MpesaCollection", MpesaCollectionSchema);
