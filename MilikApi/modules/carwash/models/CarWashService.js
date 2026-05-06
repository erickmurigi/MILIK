import mongoose from "mongoose";

const carWashServiceSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "" },
    vehicleType: { type: String, trim: true, default: "" },
    defaultPrice: { type: Number, required: true, min: 0, default: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashServiceSchema.index({ business: 1, name: 1 });
carWashServiceSchema.index({ business: 1, active: 1 });

export default mongoose.model("CarWashService", carWashServiceSchema);
