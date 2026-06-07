import mongoose from "mongoose";

const EXPENSE_METHODS = ["cash", "mpesa", "bank", "card", "other"];
const EXPENSE_STATUSES = ["draft", "approved", "paid", "cancelled"];

const carWashExpenseSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashBranch", default: null, index: true },
    expenseNumber: { type: String, required: true, trim: true },
    expenseDate: { type: Date, default: Date.now, index: true },
    payee: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, required: true },
    description: { type: String, trim: true, default: "" },
    items: [{
      _id: false,
      description: { type: String, trim: true, default: "" },
      qty:         { type: Number, default: 1,   min: 0 },
      unitPrice:   { type: Number, default: 0,   min: 0 },
      amount:      { type: Number, default: 0,   min: 0 },
    }],
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: EXPENSE_METHODS, default: "cash" },
    cashbookAccount: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null, index: true },
    reference: { type: String, trim: true, default: "" },
    status: { type: String, enum: EXPENSE_STATUSES, default: "draft", index: true },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    paidAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashExpenseSchema.index({ business: 1, expenseNumber: 1 }, { unique: true });
carWashExpenseSchema.index({ business: 1, expenseDate: -1 });
carWashExpenseSchema.index({ business: 1, branch: 1, expenseDate: -1 });
carWashExpenseSchema.index({ business: 1, status: 1 });
carWashExpenseSchema.index({ business: 1, category: 1 });
carWashExpenseSchema.index({ business: 1, cashbookAccount: 1 });

export default mongoose.model("CarWashExpense", carWashExpenseSchema);
