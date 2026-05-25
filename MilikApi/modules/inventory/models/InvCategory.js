import mongoose from "mongoose";

const invCategorySchema = new mongoose.Schema(
  {
    business:    { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name:        { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    active:      { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invCategorySchema.index({ business: 1, name: 1 }, { unique: true });

export default mongoose.model("InvCategory", invCategorySchema);
