import mongoose from 'mongoose';

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const periodSchema = new mongoose.Schema({
  company:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  month:    { type: Number, required: true, min: 1, max: 12 },
  year:     { type: Number, required: true },
  label:    { type: String, trim: true, default: '' },

  status: {
    type: String,
    enum: ['Draft', 'Processing', 'Approved', 'Paid', 'Closed', 'Reversed'],
    default: 'Draft',
    index: true,
  },

  employeeCount:        { type: Number, default: 0 },
  totalBasic:           { type: Number, default: 0 },
  totalGross:           { type: Number, default: 0 },
  totalPAYE:            { type: Number, default: 0 },
  totalNHIF:            { type: Number, default: 0 },
  totalNSSF:            { type: Number, default: 0 },
  totalAHL:             { type: Number, default: 0 },
  totalOtherDeductions: { type: Number, default: 0 },
  totalDeductions:      { type: Number, default: 0 },
  totalNet:             { type: Number, default: 0 },

  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  paidAt:     { type: Date, default: null },
  notes:      { type: String, trim: true, default: '' },

  glPosted:         { type: Boolean, default: false },
  glJournalGroupId: { type: mongoose.Schema.Types.ObjectId, default: null },
  glPostedAt:       { type: Date, default: null },
  glError:          { type: String, default: '' },
  glReversed:       { type: Boolean, default: false },
  glReversedAt:     { type: Date, default: null },

  reversedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reversedAt:      { type: Date, default: null },
  reversalReason:  { type: String, default: '' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

periodSchema.index({ company: 1, year: 1, month: 1 }, { unique: true });
periodSchema.index({ company: 1, status: 1 });

periodSchema.pre('validate', function (next) {
  if (!this.label) {
    this.label = `${MONTH_NAMES[this.month] || ''} ${this.year}`;
  }
  next();
});

export default mongoose.model('HRPayrollPeriod', periodSchema);
