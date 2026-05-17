import mongoose from 'mongoose';

const leaveTypeSchema = new mongoose.Schema(
  {
    company:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name:        { type: String, required: true, trim: true },
    code:        { type: String, trim: true, uppercase: true },
    description: { type: String, trim: true },
    // Accrual & entitlement
    daysPerYear:    { type: Number, default: 0, min: 0 },
    maxCarryover:   { type: Number, default: 0, min: 0 },  // max days to carry to next year
    isPaid:         { type: Boolean, default: true },
    requiresApproval: { type: Boolean, default: true },
    // Eligibility
    applicableTo: { type: String, enum: ['All', 'Permanent', 'Contract', 'Casual', 'Intern'], default: 'All' },
    genderRestriction: { type: String, enum: ['None', 'Male', 'Female'], default: 'None' },
    minServiceDays: { type: Number, default: 0 },  // days employed before eligible
    // Controls
    isActive:    { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

leaveTypeSchema.index({ company: 1, name: 1 }, { unique: true });
leaveTypeSchema.index({ company: 1, isActive: 1 });

export default mongoose.model('HRLeaveType', leaveTypeSchema);
