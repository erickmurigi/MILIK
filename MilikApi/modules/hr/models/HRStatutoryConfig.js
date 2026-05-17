import mongoose from 'mongoose';

const payeBandSchema = new mongoose.Schema(
  {
    upTo: { type: Number, default: null },  // null = top band (unbounded)
    rate: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const statutoryConfigSchema = new mongoose.Schema(
  {
    company:        { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    personalRelief: { type: Number, default: 2400 },
    payeBands:      { type: [payeBandSchema], default: [] },
    shaRate:        { type: Number, default: 0.0275 },
    shaMin:         { type: Number, default: 500 },
    nssfLower:      { type: Number, default: 7000 },
    nssfUpper:      { type: Number, default: 36000 },
    nssfRate:       { type: Number, default: 0.06 },
    ahlRate:        { type: Number, default: 0.015 },
    updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

statutoryConfigSchema.index({ company: 1 }, { unique: true });

export default mongoose.model('HRStatutoryConfig', statutoryConfigSchema);
