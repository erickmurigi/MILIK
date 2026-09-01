import mongoose from "mongoose";

const carWashServiceSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "" },
    jobType: { type: String, enum: ["both", "vehicle", "carpet"], default: "both" },
    pricingType: { type: String, enum: ["flat", "per_sqft"], default: "flat" },
    defaultPrice: { type: Number, required: true, min: 0, default: 0 },
    pricingTiers: [{
      vehicleType: { type: String, trim: true, required: true },
      price:       { type: Number, required: true, min: 0 },
      _id: false,
    }],
    isCombo:          { type: Boolean, default: false },
    comboDescription: { type: String, trim: true, default: "" },
    isTaxable: { type: Boolean, default: false },
    taxRate:   { type: Number, min: 0, max: 100, default: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashServiceSchema.index({ business: 1, name: 1 }, { unique: true });
carWashServiceSchema.index({ business: 1, active: 1 });

export default mongoose.model("CarWashService", carWashServiceSchema);
