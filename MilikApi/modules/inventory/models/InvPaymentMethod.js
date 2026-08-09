import mongoose from "mongoose";

const invPaymentMethodSchema = new mongoose.Schema(
  {
    business:   { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name:       { type: String, required: true, trim: true },
    code:       { type: String, required: true, trim: true, lowercase: true },
    icon:       { type: String, trim: true, default: "" },
    requireRef: { type: Boolean, default: false },
    refLabel:   { type: String, trim: true, default: "" },
    sortOrder:  { type: Number, default: 0 },
    active:     { type: Boolean, default: true },
    builtIn:    { type: Boolean, default: false },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invPaymentMethodSchema.index({ business: 1, code: 1 }, { unique: true });
invPaymentMethodSchema.index({ business: 1, active: 1, sortOrder: 1 });

export default mongoose.model("InvPaymentMethod", invPaymentMethodSchema);
