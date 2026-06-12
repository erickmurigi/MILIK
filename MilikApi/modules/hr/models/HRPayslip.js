import mongoose from 'mongoose';

const earningLineSchema = new mongoose.Schema(
  { name: { type: String, trim: true }, amount: { type: Number, default: 0 } },
  { _id: false }
);

const deductionLineSchema = new mongoose.Schema(
  { name: { type: String, trim: true }, amount: { type: Number, default: 0 } },
  { _id: false }
);

const payslipSchema = new mongoose.Schema({
  company:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  payrollPeriod: { type: mongoose.Schema.Types.ObjectId, ref: 'HRPayrollPeriod', required: true },
  employee:      { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee', required: true },

  // Snapshot of employee data at the time payroll was run
  snapshot: {
    name:              { type: String, default: '' },
    employeeNumber:    { type: String, default: '' },
    department:        { type: String, default: '' },
    designation:       { type: String, default: '' },
    kraPin:            { type: String, default: '' },
    nhifNo:            { type: String, default: '' },
    nssfNo:            { type: String, default: '' },
    paymentMethod:     { type: String, default: '' },
    bankName:          { type: String, default: '' },
    bankAccountNumber: { type: String, default: '' },
    bankBranch:        { type: String, default: '' },
    mpesaNumber:       { type: String, default: '' },
  },

  // Earnings
  basicSalary:  { type: Number, default: 0 },
  allowances:   { type: [earningLineSchema], default: [] },
  grossSalary:  { type: Number, default: 0 },

  // Statutory deductions
  paye: { type: Number, default: 0 },
  nhif: { type: Number, default: 0 },
  nssf: { type: Number, default: 0 },
  ahl:  { type: Number, default: 0 },

  // Non-statutory deductions from salary components
  otherDeductions: { type: [deductionLineSchema], default: [] },

  totalDeductions: { type: Number, default: 0 },
  netSalary:       { type: Number, default: 0 },

  // Manual HR adjustments applied on top of computed values (e.g. bonuses, penalties)
  adjustmentAllowances: { type: [earningLineSchema],   default: [] },
  adjustmentDeductions: { type: [deductionLineSchema],  default: [] },
  adjustmentNote:       { type: String, default: '' },

  status: {
    type: String,
    enum: ['Draft', 'Approved', 'Paid', 'Reversed'],
    default: 'Draft',
    index: true,
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

payslipSchema.index({ company: 1, payrollPeriod: 1 });
payslipSchema.index({ company: 1, employee: 1, payrollPeriod: 1 }, { unique: true });

export default mongoose.model('HRPayslip', payslipSchema);
