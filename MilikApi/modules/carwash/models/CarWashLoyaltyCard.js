import mongoose from 'mongoose';

const stampEntrySchema = new mongoose.Schema(
  {
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'CarWashJob' },
    jobNumber: { type: String, default: '' },
    awardedAt: { type: Date, default: Date.now },
    wasRedemption: { type: Boolean, default: false },
  },
  { _id: false }
);

const carWashLoyaltyCardSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    plate: { type: String, required: true, trim: true, uppercase: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'CarWashCustomer', required: true, index: true },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'CarWashLoyaltyProgram', required: true },
    // Current active stamps toward next reward
    currentStamps: { type: Number, default: 0, min: 0 },
    // Rewards earned and not yet redeemed
    pendingRewards: { type: Number, default: 0, min: 0 },
    // Lifetime totals
    totalStampsEarned: { type: Number, default: 0, min: 0 },
    totalRewardsEarned: { type: Number, default: 0, min: 0 },
    totalRewardsRedeemed: { type: Number, default: 0, min: 0 },
    lastStampAt: { type: Date, default: null },
    lastRedemptionAt: { type: Date, default: null },
    // Audit trail of stamp events
    stampHistory: { type: [stampEntrySchema], default: [] },
  },
  { timestamps: true }
);

// One card per plate per business
carWashLoyaltyCardSchema.index({ business: 1, plate: 1 }, { unique: true });

export default mongoose.model('CarWashLoyaltyCard', carWashLoyaltyCardSchema);
