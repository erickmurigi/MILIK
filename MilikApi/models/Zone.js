import mongoose from 'mongoose';

const ZoneSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, trim: true, default: '' },
    type: {
      type: String,
      enum: ['geographic', 'performance', 'portfolio', 'other'],
      default: 'geographic',
    },
    color: { type: String, default: '#0B3B2E', trim: true },
    fieldOfficers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    supervisors:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

ZoneSchema.index({ company: 1, code: 1 }, { unique: true });
ZoneSchema.index({ company: 1, isActive: 1 });
ZoneSchema.index({ company: 1, fieldOfficers: 1, isActive: 1 });

export default mongoose.model('Zone', ZoneSchema);
