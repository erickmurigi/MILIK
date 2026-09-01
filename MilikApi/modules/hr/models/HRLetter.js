import mongoose from 'mongoose';

const hrLetterSchema = new mongoose.Schema({
  company:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company',    required: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee', required: true, index: true },
  letterType: {
    type: String,
    enum: [
      'offer', 'appointment', 'confirmation', 'increment', 'promotion',
      'warning_1', 'warning_2', 'final_warning', 'termination',
      'reference', 'suspension', 'reinstatement', 'redundancy', 'custom',
    ],
    required: true,
    index: true,
  },
  subject:    { type: String, required: true, trim: true },
  body:       { type: String, required: true },     // rendered HTML stored after generation
  metadata:   { type: mongoose.Schema.Types.Mixed, default: {} },
  status:     { type: String, enum: ['draft', 'issued', 'revoked'], default: 'draft', index: true },
  issuedDate: { type: Date, default: null },
  issuedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revokedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revokedAt:  { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

hrLetterSchema.index({ company: 1, employee: 1, letterType: 1, createdAt: -1 });
hrLetterSchema.index({ company: 1, status: 1, createdAt: -1 });

export default mongoose.model('HRLetter', hrLetterSchema);
