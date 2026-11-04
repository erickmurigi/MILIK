import mongoose from "mongoose";

// One row per document sent (or to be sent) to KRA eTIMS. Unique per
// (business, documentType, documentId) so a document is only ever signed
// once; `etimsInvoiceNo` is allocated on first attempt and reused by every
// retry, which is what keeps resubmission idempotent on KRA's side too.
const etimsSubmissionSchema = new mongoose.Schema(
  {
    business:       { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true },
    documentType:   { type: String, enum: ["invoice", "credit_note"], required: true },
    documentId:     { type: mongoose.Schema.Types.ObjectId, required: true },
    documentNumber: { type: String, trim: true, default: "" },
    client:         { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },
    etimsInvoiceNo: { type: Number, default: null },
    status: {
      type: String,
      enum: ["pending", "processing", "submitted", "failed", "skipped"],
      default: "pending",
    },
    environment:    { type: String, default: "sandbox" },
    attempts:       { type: Number, default: 0 },
    lastAttemptAt:  { type: Date, default: null },
    nextRetryAt:    { type: Date, default: null },
    requestPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    responsePayload: { type: mongoose.Schema.Types.Mixed, default: null },
    resultCode:     { type: String, default: "" },
    resultMessage:  { type: String, default: "" },
    cuInvoiceNumber: { type: String, default: "" },
    receiptSignature: { type: String, default: "" },
    internalData:   { type: String, default: "" },
    qrUrl:          { type: String, default: "" },
    submittedAt:    { type: Date, default: null },
    error:          { type: String, default: "" },
    requestedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

etimsSubmissionSchema.index({ business: 1, documentType: 1, documentId: 1 }, { unique: true });
etimsSubmissionSchema.index({ business: 1, status: 1, createdAt: -1 });
etimsSubmissionSchema.index({ status: 1, nextRetryAt: 1 });

export default mongoose.model("EtimsSubmission", etimsSubmissionSchema);
