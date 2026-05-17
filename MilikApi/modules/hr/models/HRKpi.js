import mongoose from 'mongoose';

const kpiSchema = new mongoose.Schema(
  {
    company:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name:        { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category:    { type: String, enum: ['Performance', 'Attendance', 'Skills', 'Leadership', 'Financial', 'Customer', 'Other'], default: 'Performance' },
    unit:        { type: String, enum: ['Percentage', 'Score', 'Count', 'KES', 'Custom'], default: 'Score' },
    maxScore:    { type: Number, default: 100, min: 1 },
    isActive:    { type: Boolean, default: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

kpiSchema.index({ company: 1, name: 1 }, { unique: true });
kpiSchema.index({ company: 1, isActive: 1 });

export default mongoose.model('HRKpi', kpiSchema);
