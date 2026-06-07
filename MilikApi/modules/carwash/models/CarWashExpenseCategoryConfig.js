import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    business:   { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    categories: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

export default mongoose.model("CarWashExpenseCategoryConfig", schema);
