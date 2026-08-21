import mongoose from "mongoose";

const stageSchema = new mongoose.Schema(
  { _id: mongoose.Schema.Types.ObjectId, name: { type: String, required: true, trim: true }, order: { type: Number, default: 0 }, isActive: { type: Boolean, default: true } }
);

const simpleSchema = new mongoose.Schema(
  { _id: mongoose.Schema.Types.ObjectId, name: { type: String, required: true, trim: true }, isActive: { type: Boolean, default: true } }
);

const saleSettingsSchema = new mongoose.Schema(
  {
    business:     { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true, index: true },
    pipelineStages: { type: [stageSchema],  default: [] },
    leadSources:    { type: [simpleSchema], default: [] },
    propertyTypes:  { type: [simpleSchema], default: [] },
    commissionDefaults: {
      rate:           { type: Number, default: 3,           min: 0 },
      commissionType: { type: String, enum: ["percentage", "flat"], default: "percentage" },
      whtRate:        { type: Number, default: 5,           min: 0, max: 100 },
    },
  },
  { timestamps: true }
);

export default mongoose.model("SaleSettings", saleSettingsSchema);
