import mongoose from "mongoose";

const ServiceProviderSchema = new mongoose.Schema(
  {
    providerCode: { type: String, required: true, trim: true, uppercase: true },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "general" },
    kraPin: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    paybillNumber: { type: String, trim: true, default: "" },
    bankName: { type: String, trim: true, default: "" },
    accountName: { type: String, trim: true, default: "" },
    subjectToWht: { type: Boolean, default: false },
    whtRate:      { type: Number, min: 0, max: 30, default: 0 },
    whtCategory:  { type: String, trim: true, default: "" },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

ServiceProviderSchema.index({ business: 1, providerCode: 1 }, { unique: true });
ServiceProviderSchema.index({ business: 1, name: 1 });

const ServiceProvider =
  mongoose.models.ServiceProvider ||
  mongoose.model("ServiceProvider", ServiceProviderSchema);

export default ServiceProvider;
