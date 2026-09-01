import mongoose from 'mongoose';

const LETTER_TYPES = [
  'offer','appointment','confirmation','increment','promotion',
  'warning_1','warning_2','final_warning','termination',
  'reference','suspension','reinstatement','redundancy','custom',
];

const hrLetterTemplateSchema = new mongoose.Schema({
  company:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  letterType: { type: String, enum: LETTER_TYPES, required: true },
  bodyHtml:   { type: String, required: true },   // HTML body with {{placeholders}} — no header/footer
  signatory:  { type: mongoose.Schema.Types.ObjectId, ref: 'HRSignatory', default: null },
  notes:      { type: String, default: '' },
  updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

hrLetterTemplateSchema.index({ company: 1, letterType: 1 }, { unique: true });

export default mongoose.model('HRLetterTemplate', hrLetterTemplateSchema);
