import mongoose from "mongoose";

const ExpensePropertySchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
    },
    unit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit",
    },
    category: {
      type: String,
      enum: ["maintenance", "repair", "utility", "tax", "insurance", "supplies", "other"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
    },
    receiptNumber: {
      type: String,
      trim: true,
      default: "",
    },
    receiptImage: {
      type: String,
      default: "",
    },
    paidBy: {
      type: String,
      trim: true,
      default: "",
    },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "mobile_money", "cash", "check", "credit_card"],
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

ExpensePropertySchema.index({ business: 1, date: -1 });
ExpensePropertySchema.index({ business: 1, property: 1, date: -1 });
ExpensePropertySchema.index({ business: 1, unit: 1, date: -1 });
ExpensePropertySchema.index({ business: 1, category: 1, date: -1 });

const ExpenseProperty =
  mongoose.models.ExpenseProperty ||
  mongoose.model("ExpenseProperty", ExpensePropertySchema);

export default ExpenseProperty;