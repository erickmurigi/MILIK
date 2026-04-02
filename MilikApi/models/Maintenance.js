// models/Maintenance.js
import mongoose from "mongoose";

const MaintenanceSchema = new mongoose.Schema(
  {
    unit: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Unit', 
      required: true 
    },
    tenant: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Tenant' 
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    priority: { 
      type: String, 
      enum: ['low', 'medium', 'high', 'emergency'],
      default: 'medium' 
    },
    status: { 
      type: String, 
      enum: ['pending', 'in_progress', 'completed', 'cancelled'],
      default: 'pending' 
    },
    assignedTo: { 
      type: String,                             
    },
    estimatedCost: { type: Number, default: 0 },
    actualCost: { type: Number, default: 0 },
    scheduledDate: { type: Date },
    completedDate: { type: Date },
    images: [{ type: String }],
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' }
  },
  { timestamps: true }
);

// Indexes for better query performance
MaintenanceSchema.index({ business: 1 });
MaintenanceSchema.index({ business: 1, status: 1 });
MaintenanceSchema.index({ unit: 1 });
MaintenanceSchema.index({ tenant: 1 });
MaintenanceSchema.index({ priority: 1 });
MaintenanceSchema.index({ createdAt: -1 });

export default mongoose.model("Maintenance", MaintenanceSchema);