import mongoose from 'mongoose';

const leaveApplicationSchema = new mongoose.Schema(
  {
    company:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    employee:   { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee', required: true },
    leaveType:  { type: mongoose.Schema.Types.ObjectId, ref: 'HRLeaveType', required: true },
    // Dates
    startDate:  { type: Date, required: true },
    endDate:    { type: Date, required: true },
    days:       { type: Number, required: true, min: 0.5 },  // computed (excl. weekends by default)
    // Request
    reason:     { type: String, trim: true },
    attachmentUrl: { type: String, trim: true },
    // Status flow: Draft → Pending → Approved | Rejected | Cancelled
    status: {
      type: String,
      enum: ['Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled'],
      default: 'Pending',
    },
    // Approval
    approvedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee' },
    approvedAt:    { type: Date },
    approvalNotes: { type: String, trim: true },
    // Rejection / cancellation
    rejectedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee' },
    rejectedAt:    { type: Date },
    rejectionReason: { type: String, trim: true },
    cancelledAt:   { type: Date },
    cancelReason:  { type: String, trim: true },
    // Audit
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

leaveApplicationSchema.index({ company: 1, employee: 1, status: 1 });
leaveApplicationSchema.index({ company: 1, leaveType: 1 });
leaveApplicationSchema.index({ company: 1, startDate: 1, endDate: 1 });
leaveApplicationSchema.index({ company: 1, status: 1, createdAt: -1 });

export default mongoose.model('HRLeaveApplication', leaveApplicationSchema);
