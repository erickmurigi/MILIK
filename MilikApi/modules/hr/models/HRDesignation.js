import mongoose from 'mongoose';

const designationSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'HRDepartment', default: null },
  name: { type: String, required: true, trim: true },
  gradeLevel: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

designationSchema.index({ company: 1, name: 1 });
designationSchema.index({ company: 1, department: 1, isActive: 1 });

export default mongoose.model('HRDesignation', designationSchema);
