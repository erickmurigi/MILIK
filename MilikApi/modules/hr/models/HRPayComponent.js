import mongoose from 'mongoose';

const hrPayComponentSchema = new mongoose.Schema({
  company:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  type:        { type: String, enum: ['allowance', 'deduction'], required: true },
  name:        { type: String, required: true, trim: true },
  code:        { type: String, required: true, trim: true, uppercase: true },
  isTaxable:   { type: Boolean, default: false },   // for allowances: does it attract PAYE?
  isStatutory: { type: Boolean, default: false },   // for deductions: government-mandated
  isActive:    { type: Boolean, default: true },
  sortOrder:   { type: Number, default: 0 },
}, { timestamps: true });

hrPayComponentSchema.index({ company: 1, type: 1, code: 1 }, { unique: true });
hrPayComponentSchema.index({ company: 1, type: 1, isActive: 1, sortOrder: 1 });

export default mongoose.model('HRPayComponent', hrPayComponentSchema);
