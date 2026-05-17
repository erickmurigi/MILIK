import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema(
  {
    kpi:      { type: mongoose.Schema.Types.ObjectId, ref: 'HRKpi' },
    kpiName:  { type: String },
    maxScore: { type: Number, default: 100 },
    weight:   { type: Number, default: 0 },   // % weight in this cycle
    score:    { type: Number, default: 0 },   // achieved score (0..maxScore)
    notes:    { type: String, trim: true },
  },
  { _id: false }
);

const appraisalSchema = new mongoose.Schema(
  {
    company:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    cycle:    { type: mongoose.Schema.Types.ObjectId, ref: 'HRAppraisalCycle', required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee', required: true },
    snapshot: {
      name:           { type: String },
      employeeNumber: { type: String },
      department:     { type: String },
      designation:    { type: String },
    },
    ratings:          { type: [ratingSchema], default: [] },
    overallScore:     { type: Number, default: 0 },   // 0–100 weighted
    reviewerNotes:    { type: String, trim: true },
    employeeComments: { type: String, trim: true },
    status:           { type: String, enum: ['Pending', 'InProgress', 'Submitted'], default: 'Pending' },
    submittedAt:      { type: Date },
    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

appraisalSchema.index({ company: 1, cycle: 1 });
appraisalSchema.index({ company: 1, employee: 1 });
appraisalSchema.index({ cycle: 1, employee: 1 }, { unique: true });

export default mongoose.model('HRAppraisal', appraisalSchema);
