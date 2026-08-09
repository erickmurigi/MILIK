import mongoose from "mongoose";

const invSupplierSchema = new mongoose.Schema(
  {
    business:    { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name:        { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: "" },
    phone:       { type: String, trim: true, default: "" },
    email:       { type: String, trim: true, lowercase: true, default: "" },
    kraPin:      { type: String, trim: true, uppercase: true, default: "" },
    address:     { type: String, trim: true, default: "" },
    notes:       { type: String, trim: true, default: "" },
    active:       { type: Boolean, default: true },
    apAccountId:  { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount", default: null },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

invSupplierSchema.index({ business: 1, name: 1 });
invSupplierSchema.index({ business: 1, active: 1 });

export default mongoose.model("InvSupplier", invSupplierSchema);
