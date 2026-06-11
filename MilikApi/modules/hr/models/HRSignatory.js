import mongoose from 'mongoose';

const LETTER_TYPES = [
  'offer','appointment','confirmation','increment','promotion',
  'warning_1','warning_2','final_warning','termination',
  'reference','suspension','reinstatement','redundancy','custom',
];

const hrSignatorySchema = new mongoose.Schema({
  company:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name:        { type: String, required: true, trim: true },
  title:       { type: String, required: true, trim: true },
  department:  { type: String, trim: true, default: '' },
  isDefault:   { type: Boolean, default: false },
  letterTypes: { type: [String], enum: LETTER_TYPES, default: [] },
}, { timestamps: true });

hrSignatorySchema.index({ company: 1, isDefault: 1 });

export default mongoose.model('HRSignatory', hrSignatorySchema);
