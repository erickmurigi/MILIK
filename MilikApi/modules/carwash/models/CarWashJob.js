import mongoose from "mongoose";

const JOB_STATUSES = ["waiting", "washing", "done", "paid", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "partial", "paid"];

const carWashJobSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    jobNumber: { type: String, required: true, trim: true },
    customerName: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    plateNumber: { type: String, required: true, trim: true, uppercase: true },
    vehicleType: { type: String, trim: true, default: "" },
    service: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashService", default: null },
    serviceName: { type: String, trim: true, default: "" },
    price: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, enum: JOB_STATUSES, default: "waiting", index: true },
    assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: "CarWashStaff", default: null },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "unpaid", index: true },
    notes: { type: String, trim: true, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

carWashJobSchema.index({ business: 1, jobNumber: 1 }, { unique: true });
carWashJobSchema.index({ business: 1, createdAt: -1 });
carWashJobSchema.index({ business: 1, plateNumber: 1 });

export default mongoose.model("CarWashJob", carWashJobSchema);
