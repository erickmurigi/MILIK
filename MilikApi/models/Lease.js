// models/Lease.js
import mongoose from "mongoose";

const LeaseSchema = new mongoose.Schema(
  {
    tenant: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Tenant', 
      required: true 
    },
    unit: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Unit', 
      required: true 
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    rentAmount: { type: Number, required: true },
    depositAmount: { type: Number, required: true },
    paymentDueDay: { type: Number, required: true, min: 1, max: 28 },
    lateFee: { type: Number, default: 0 },
    terms: { type: String },
    status: { 
      type: String, 
      enum: ['active', 'expired', 'terminated', 'renewed'],
      default: 'active' 
    },
    documentUrl: { type: String },
    signedByTenant: { type: Boolean, default: false },
    signedByLandlord: { type: Boolean, default: false },
    signedDate: { type: Date },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
    billingScheduleAdjustments: [
      {
        periodKey: { type: String, required: true },
        fromDate: { type: Date },
        toDate: { type: Date },
        rentAmount: { type: Number, default: 0 },
        utilityAmount: { type: Number, default: 0 },
        utilityNames: [{ type: String }],
        status: {
          type: String,
          enum: ['active', 'frozen', 'deleted'],
          default: 'active'
        },
        note: { type: String, default: '' },
        updatedAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

// Indexes for better query performance
LeaseSchema.index({ business: 1 });
LeaseSchema.index({ business: 1, status: 1 });
LeaseSchema.index({ tenant: 1 });
LeaseSchema.index({ unit: 1 });
LeaseSchema.index({ startDate: -1 });
LeaseSchema.index({ endDate: 1 });
LeaseSchema.index({ business: 1, 'billingScheduleAdjustments.periodKey': 1 });

export default mongoose.model("Lease", LeaseSchema);