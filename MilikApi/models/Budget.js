import mongoose from "mongoose";
const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const BudgetLineSchema = new Schema(
  {
    account:       { type: ObjectId, ref: "ChartOfAccount", required: true },
    accountCode:   { type: String, default: "" },
    accountName:   { type: String, default: "" },
    accountType:   { type: String, default: "" }, // income | expense | asset | liability | equity
    budgetedAmount: { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

const BudgetSchema = new Schema(
  {
    business:    { type: ObjectId, ref: "Company", required: true, index: true },
    name:        { type: String, required: true, trim: true },
    periodStart: { type: Date, required: true },
    periodEnd:   { type: Date, required: true },
    status:      { type: String, enum: ["draft", "active", "closed"], default: "draft", index: true },
    lines:       [BudgetLineSchema],
    notes:       { type: String, default: "" },
    createdBy:   { type: ObjectId, ref: "User" },
  },
  { timestamps: true }
);

BudgetSchema.index({ business: 1, periodStart: -1 });

export default model("Budget", BudgetSchema);
