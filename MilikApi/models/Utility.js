// models/Utility.js
import mongoose from "mongoose";

const UtilitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    unitCost: { type: Number, default: 0 },
    billingCycle: { 
      type: String, 
      enum: ['monthly', 'quarterly', 'annually', 'per_use'],
      default: 'monthly' 
    },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("Utility", UtilitySchema);