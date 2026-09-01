import mongoose from 'mongoose';

const { Schema, Types: { ObjectId } } = mongoose;

const carWashCustomerCreditSchema = new Schema(
  {
    business:  { type: ObjectId, ref: 'Company',         required: true },
    customer:  { type: ObjectId, ref: 'CarWashCustomer', required: true },
    plates:    [{ type: String, uppercase: true, trim: true }],
    amount:    { type: Number, required: true, min: 0.01 },
    status:    { type: String, enum: ['active', 'applied', 'written_off', 'refunded'], default: 'active' },

    // Origin
    sourceJob:     { type: ObjectId, ref: 'CarWashJob' },
    sourcePayment: { type: ObjectId, ref: 'CarWashPayment' },

    // Application
    appliedToJob:    { type: ObjectId, ref: 'CarWashJob' },
    appliedPayment:  { type: ObjectId, ref: 'CarWashPayment' },
    appliedAt:       Date,
    appliedBy:       { type: ObjectId, ref: 'User' },

    // Write-off
    writeOffLedgerEntries: [{ type: ObjectId, ref: 'FinancialLedgerEntry' }],
    writtenOffAt:  Date,
    writtenOffBy:  { type: ObjectId, ref: 'User' },

    // Undo of write-off
    reversedAt:  Date,
    reversedBy:  { type: ObjectId, ref: 'User' },

    // Refund
    refundedAt:  Date,
    refundedBy:  { type: ObjectId, ref: 'User' },
    refundNote:  { type: String, trim: true },

    notes:      { type: String, trim: true },
    createdBy:  { type: ObjectId, ref: 'User' },
    updatedBy:  { type: ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

carWashCustomerCreditSchema.index({ business: 1, customer: 1, status: 1 });
carWashCustomerCreditSchema.index({ business: 1, status: 1, createdAt: 1 });
carWashCustomerCreditSchema.index({ business: 1, sourcePayment: 1 }, { sparse: true });

export default mongoose.model('CarWashCustomerCredit', carWashCustomerCreditSchema);
