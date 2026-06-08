import mongoose from 'mongoose';

const salaryComponentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['Allowance', 'Deduction'], required: true },
  amount: { type: Number, default: 0 },
  isPercentage: { type: Boolean, default: false },
  percentageBase: { type: String, enum: ['Basic', 'Gross'], default: 'Basic' },
}, { _id: true });

const employeeSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  employeeNumber: { type: String, trim: true, default: '' },

  // ── Personal Information ───────────────────────────────────────
  surname: { type: String, required: true, trim: true },
  otherNames: { type: String, required: true, trim: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], default: null },
  dateOfBirth: { type: Date, default: null },
  nationalId: { type: String, trim: true, default: '' },

  // ── Kenya Statutory Numbers ────────────────────────────────────
  kraPin: { type: String, trim: true, uppercase: true, default: '' },
  nhifNo: { type: String, trim: true, default: '' },
  nssfNo: { type: String, trim: true, default: '' },
  helbNo: { type: String, trim: true, default: '' },

  // ── Contact ───────────────────────────────────────────────────
  phoneNumber: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true, default: '' },
  physicalAddress: { type: String, trim: true, default: '' },
  postalAddress: { type: String, trim: true, default: '' },

  // ── Emergency Contact ─────────────────────────────────────────
  nextOfKinName: { type: String, trim: true, default: '' },
  nextOfKinRelationship: { type: String, trim: true, default: '' },
  nextOfKinPhone: { type: String, trim: true, default: '' },

  // ── Employment Details ────────────────────────────────────────
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'HRDepartment', default: null },
  designation: { type: mongoose.Schema.Types.ObjectId, ref: 'HRDesignation', default: null },
  reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: 'HREmployee', default: null },
  employmentType: {
    type: String,
    enum: ['Permanent', 'Contract', 'Casual', 'Intern'],
    required: true,
  },
  dateJoined: { type: Date, required: true },
  contractStartDate: { type: Date, default: null },
  contractEndDate: { type: Date, default: null },
  probationEndDate: { type: Date, default: null },

  // ── Compensation ──────────────────────────────────────────────
  basicSalary: { type: Number, default: 0 },
  salaryComponents: { type: [salaryComponentSchema], default: [] },
  paymentMethod: {
    type: String,
    enum: ['Bank Transfer', 'Cash', 'M-Pesa'],
    default: 'Bank Transfer',
  },
  bankName: { type: String, trim: true, default: '' },
  bankAccountNumber: { type: String, trim: true, default: '' },
  bankBranch: { type: String, trim: true, default: '' },
  mpesaNumber: { type: String, trim: true, default: '' },

  // ── Profile Picture ───────────────────────────────────────────
  profilePicture: { type: String, default: '' },

  // ── Status ────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['Active', 'Probation', 'Suspended', 'Terminated'],
    default: 'Active',
    index: true,
  },
  terminationDate: { type: Date, default: null },
  terminationReason: { type: String, trim: true, default: '' },

  // ── Audit ─────────────────────────────────────────────────────
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

employeeSchema.index({ company: 1, status: 1 });
employeeSchema.index({ company: 1, department: 1 });
employeeSchema.index({ company: 1, employmentType: 1 });
employeeSchema.index({ company: 1, surname: 1, otherNames: 1 });
employeeSchema.index({ company: 1, employeeNumber: 1 }, { unique: true, sparse: true });
employeeSchema.index({ surname: "text", otherNames: "text", employeeNumber: "text", phoneNumber: "text", email: "text" }, { default_language: "none" });

employeeSchema.pre('validate', async function (next) {
  if (this.isNew && !this.employeeNumber) {
    try {
      const count = await mongoose.model('HREmployee').countDocuments({ company: this.company });
      this.employeeNumber = `EMP${String(count + 1).padStart(4, '0')}`;
    } catch {
      // non-fatal — leave blank, route will retry if needed
    }
  }
  next();
});

export default mongoose.model('HREmployee', employeeSchema);
