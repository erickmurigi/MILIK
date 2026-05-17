import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, trim: true, uppercase: true, default: '' },
  description: { type: String, trim: true, default: '' },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee', default: null },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

departmentSchema.index({ company: 1, name: 1 }, { unique: true });
departmentSchema.index({ company: 1, isActive: 1 });

export default mongoose.model('HRDepartment', departmentSchema);
