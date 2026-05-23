import mongoose from "mongoose";
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const FixedAssetSchema = new Schema(
  {
    business: { type: ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: "", trim: true },
    category: { type: String, default: "", trim: true },
    description: { type: String, default: "" },

    // Acquisition
    purchaseDate: { type: Date, required: true },
    purchaseCost: { type: Number, required: true, min: 0 },
    residualValue: { type: Number, default: 0, min: 0 },

    // Depreciation policy
    depreciationMethod: {
      type: String,
      enum: ["straight_line", "reducing_balance", "none"],
      default: "straight_line",
    },
    usefulLifeYears: { type: Number, default: 5, min: 0 },
    depreciationRate: { type: Number, default: 0, min: 0, max: 100 }, // % per annum for reducing balance

    // GL accounts
    assetAccount: { type: ObjectId, ref: "ChartOfAccount", required: true },
    depreciationExpenseAccount: { type: ObjectId, ref: "ChartOfAccount", required: true },
    accumulatedDepreciationAccount: { type: ObjectId, ref: "ChartOfAccount", required: true },

    // Running totals (updated each depreciation run)
    accumulatedDepreciation: { type: Number, default: 0, min: 0 },
    lastDepreciationDate: { type: Date, default: null },

    // Status
    status: {
      type: String,
      enum: ["active", "disposed", "fully_depreciated"],
      default: "active",
      index: true,
    },

    // Disposal details (set when status = disposed)
    disposalDate: { type: Date, default: null },
    disposalProceeds: { type: Number, default: 0 },
    disposalNotes: { type: String, default: "" },
    disposedBy: { type: ObjectId, ref: "User", default: null },

    createdBy: { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);

FixedAssetSchema.index({ business: 1, status: 1 });
FixedAssetSchema.index({ business: 1, category: 1 });
FixedAssetSchema.index({ business: 1, createdAt: -1 });

export default model("FixedAsset", FixedAssetSchema);
