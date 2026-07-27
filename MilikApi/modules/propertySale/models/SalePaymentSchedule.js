import mongoose from "mongoose";

const scheduleItemSchema = new mongoose.Schema(
  {
    business:         { type: mongoose.Schema.Types.ObjectId, ref: "Company",    required: true, index: true },
    deal:             { type: mongoose.Schema.Types.ObjectId, ref: "SaleDeal",   required: true, index: true },
    installmentNumber:{ type: Number, required: true, min: 1 },
    dueDate:          { type: Date, required: true },
    expectedAmount:   { type: Number, required: true, min: 0 },
    description:      { type: String, trim: true, default: "" },
    // status is derived: overridden when linkedPayment is set or manually marked
    status:           { type: String, enum: ["upcoming", "overdue", "paid", "waived"], default: "upcoming" },
    linkedPayment:    { type: mongoose.Schema.Types.ObjectId, ref: "SalePayment", default: null },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

scheduleItemSchema.index({ business: 1, deal: 1, installmentNumber: 1 }, { unique: true });
scheduleItemSchema.index({ business: 1, dueDate: 1, status: 1 });

export default mongoose.model("SalePaymentSchedule", scheduleItemSchema);
