import mongoose from "mongoose";

const invUoMSchema = new mongoose.Schema(
  {
    business:     { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name:         { type: String, required: true, trim: true },
    abbreviation: { type: String, required: true, trim: true },
    description:  { type: String, trim: true, default: "" },
    active:       { type: Boolean, default: true },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invUoMSchema.index({ business: 1, abbreviation: 1 }, { unique: true });
invUoMSchema.index({ business: 1, active: 1 });

export default mongoose.model("InvUnitOfMeasure", invUoMSchema);
