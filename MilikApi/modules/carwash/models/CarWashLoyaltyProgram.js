import mongoose from 'mongoose';

const carWashLoyaltyProgramSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true, default: 'Loyalty Program' },
    isActive: { type: Boolean, default: true },
    stampsRequired: { type: Number, required: true, min: 2, default: 10 },
    rewardType: {
      type: String,
      enum: ['free_wash', 'discount_percent', 'discount_fixed', 'free_service'],
      default: 'free_wash',
    },
    rewardValue: { type: Number, min: 0, default: 0 },
    // For rewardType = "free_service": the specific service given free
    rewardServiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'CarWashService', default: null },
    // Empty array = all services qualify; populated = only listed services qualify
    applicableServices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CarWashService' }],
    // 0 = stamps never expire
    stampExpiryDays: { type: Number, min: 0, default: 0 },
    smsOnStamp: { type: Boolean, default: true },
    smsOnReward: { type: Boolean, default: true },
    smsOnPayment: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// One active program per business
carWashLoyaltyProgramSchema.index({ business: 1, isActive: 1 });

export default mongoose.model('CarWashLoyaltyProgram', carWashLoyaltyProgramSchema);
