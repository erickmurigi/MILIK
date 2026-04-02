// models/Expense.js
import mongoose from "mongoose";

const ExpenseSchema = new mongoose.Schema({
  type: { type: String, required: true }, // Remove default to enforce selection
  amount: { type: Number, required: true, min: 0 },
  category: { type: String, default: '' },
  subcategory: { type: String, default: '' },
  reason: { type: String, required: true },
  paidThrough: { type: String, enum: ['mpesa', 'cash', 'bank', 'mpesa/cash'] },
  mpesaCode: { type: String, default: null }, // For M-Pesa or M-Pesa/Cash
  mpesaAmount: { type: Number, default: 0 }, // For M-Pesa or M-Pesa/Cash
  cashAmount: { type: Number, default: 0 }, // For Cash or M-Pesa/Cash
  bankAmount: { type: Number, default: 0 }, // For Bank
  debtCleared: { type: Boolean, default: false },
  transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }
}, { timestamps: true });

export default mongoose.model("Expense", ExpenseSchema);