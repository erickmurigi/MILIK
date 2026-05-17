import mongoose from 'mongoose';

const cycleKpiSchema = new mongoose.Schema(
  {
    kpi:    { type: mongoose.Schema.Types.ObjectId, ref: 'HRKpi', required: true },
    weight: { type: Number, required: true, min: 0, max: 100 },  // % weight, all weights must sum to 100
  },
  { _id: false }
);

const appraisalCycleSchema = new mongoose.Schema(
  {
    company:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name:       { type: String, required: true, trim: true },
    year:       { type: Number, required: true },
    periodType: { type: String, enum: ['Annual', 'Semi-Annual', 'Quarterly', 'Custom'], default: 'Annual' },
    startDate:  { type: Date, required: true },
    endDate:    { type: Date, required: true },
    status:     { type: String, enum: ['Draft', 'Open', 'Closed'], default: 'Draft' },
    kpis:           { type: [cycleKpiSchema], default: [] },
    employeeCount:  { type: Number, default: 0 },
    notes:          { type: String, trim: true },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

appraisalCycleSchema.index({ company: 1, status: 1 });
appraisalCycleSchema.index({ company: 1, year: -1 });

export default mongoose.model('HRAppraisalCycle', appraisalCycleSchema);
