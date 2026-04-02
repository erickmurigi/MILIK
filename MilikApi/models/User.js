import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  // Personal Information (from AddUserPage)
  surname: { type: String, required: true },
  otherNames: { type: String, required: true },
  idNumber: { type: String, required: true },
  gender: { type: String, enum: ['Male', 'Female', 'Other'] },
  postalAddress: { type: String },
  phoneNumber: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },

  // User Details
  profile: { 
    type: String, 
    required: true, 
    enum: ['Administrator', 'Manager', 'Accountant', 'Agent', 'Viewer'] 
  },
  userControl: { type: Boolean, default: true },
  superAdminAccess: { type: Boolean, default: false },
  adminAccess: { type: Boolean, default: false },
  setupAccess: { type: Boolean, default: false },
  companySetupAccess: { type: Boolean, default: false },

  // Module Access – stored as an object with permission levels
  moduleAccess: {
    propertyMgmt: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    propertySale: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    facilityManagement: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    hotelManagement: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    accounts: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    revenueRecognition: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    telcoDealership: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    inventory: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    retailOutlet: { type: String, default: '' }, // free text for counter/till
    procurement: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    humanResource: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    hidePayDetails: { type: Boolean, default: false },
    incidentManagement: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    sacco: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    projectManagement: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    assetValuation: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    crm: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    dms: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
    academics: { type: String, enum: ['Not allowed', 'View only', 'Full access'], default: 'Not allowed' },
  },

  // User Rights – legacy/global list of enabled right IDs
  rights: [{ type: Number }],

  permissions: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Company reference (active/default company context)
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  primaryCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  accessibleCompanies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Company' }],
  companyAssignments: [{
    company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    moduleAccess: { type: mongoose.Schema.Types.Mixed, default: {} },
    permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    rights: [{ type: String }],
  }],

  // Authentication
  password: { type: String, required: true }, // will be hashed
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  mustChangePassword: { type: Boolean, default: false },
  passwordProvisioningMethod: { type: String, enum: ['manual', 'emailed_temp_password'], default: 'manual' },
  onboardingEmailSentAt: { type: Date, default: null },
  lastPasswordChangeAt: { type: Date, default: null },

  // Status flags
  isActive: { type: Boolean, default: true },
  locked: { type: Boolean, default: false },
  isSystemAuditUser: { type: Boolean, default: false, index: true },
  lastLogin: Date,
}, { timestamps: true });

// Ensure email is unique per company
userSchema.index({ company: 1, email: 1 }, { unique: true });


userSchema.pre('validate', function(next) {
  const companyId = this.company || this.primaryCompany;
  if (companyId && !this.primaryCompany) {
    this.primaryCompany = companyId;
  }

  const accessible = Array.isArray(this.accessibleCompanies) ? this.accessibleCompanies.map(String) : [];
  const primary = this.primaryCompany ? String(this.primaryCompany) : (this.company ? String(this.company) : null);
  if (primary && !accessible.includes(primary)) {
    this.accessibleCompanies = [...new Set([...(this.accessibleCompanies || []), primary])];
  }

  if ((!this.companyAssignments || this.companyAssignments.length === 0) && Array.isArray(this.accessibleCompanies)) {
    this.companyAssignments = this.accessibleCompanies.map((company) => ({
      company,
      moduleAccess: this.moduleAccess || {},
      permissions: this.permissions || {},
      rights: [],
    }));
  }

  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);