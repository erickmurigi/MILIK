import mongoose from "mongoose";

const SequenceCounterSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    sequence: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

SequenceCounterSchema.index({ business: 1, key: 1 }, { unique: true });

export default mongoose.model("SequenceCounter", SequenceCounterSchema);
