import mongoose from "mongoose";

const coopCollectionSchema = new mongoose.Schema(
  {
    business:                 { type: mongoose.Schema.Types.ObjectId, ref: "Company",    required: true },
    coopConfigId:             { type: mongoose.Schema.Types.ObjectId,                    default: null  },
    institutionCode:          { type: String, trim: true, default: '' },
    transactionReferenceCode: { type: String, trim: true, required: true },
    documentReferenceNumber:  { type: String, trim: true, default: '' },
    tenantCode:               { type: String, trim: true, default: '' },
    amount:                   { type: Number, default: 0 },
    currency:                 { type: String, trim: true, default: 'KES' },
    paymentDate:              { type: Date, default: null },
    transactionDate:          { type: Date, default: null },
    bankCode:                 { type: String, trim: true, default: '' },
    branchCode:               { type: String, trim: true, default: '' },
    paymentMode:              { type: String, trim: true, default: '' },
    payerName:                { type: String, trim: true, default: '' },
    accountNumber:            { type: String, trim: true, default: '' },
    accountName:              { type: String, trim: true, default: '' },
    matchingStatus: {
      type:    String,
      enum:    ['unmatched', 'matched_tenant', 'captured', 'ignored'],
      default: 'unmatched',
    },
    tenant:        { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant',      default: null },
    matchedReceipt:{ type: mongoose.Schema.Types.ObjectId, ref: 'RentPayment', default: null },
    rawPayload:    { type: mongoose.Schema.Types.Mixed,                         default: null },
  },
  { timestamps: true }
);

coopCollectionSchema.index({ business: 1, transactionReferenceCode: 1 }, { unique: true });
coopCollectionSchema.index({ business: 1, matchingStatus: 1 });
coopCollectionSchema.index({ business: 1, createdAt: -1 });
coopCollectionSchema.index({ business: 1, tenantCode: 1 });

const CoopCollection = mongoose.model("CoopCollection", coopCollectionSchema);
export default CoopCollection;
