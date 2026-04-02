import { z } from 'zod';

// ========== USER SCHEMAS ==========
export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters")
});

export const createUserSchema = z.object({
  surname: z.string().min(1, "Surname is required"),
  otherNames: z.string().min(1, "Other names are required"),
  idNumber: z.string().min(1, "ID number is required"),
  phoneNumber: z.string().min(10, "Valid phone number is required"),
  email: z.string().email("Invalid email address"),
  profile: z.enum(['Administrator', 'Manager', 'Accountant', 'Agent', 'Viewer']),
  password: z.union([z.string().min(8, "Password must be at least 8 characters"), z.literal("")]).optional(),
  autoGeneratePassword: z.boolean().optional(),
  sendOnboardingEmail: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  company: z.string().min(1, "Company is required"),
  primaryCompany: z.string().optional(),
  accessibleCompanies: z.array(z.string()).optional(),
  companyAssignments: z.array(z.object({
    company: z.string().min(1),
    moduleAccess: z.record(z.any()).optional(),
    permissions: z.record(z.any()).optional(),
    rights: z.array(z.string()).optional(),
  })).optional(),
  permissions: z.record(z.any()).optional(),
  rights: z.array(z.union([z.number(), z.string()])).optional(),
}).passthrough();

// ========== PROPERTY SCHEMAS ==========
export const createPropertySchema = z.object({
  propertyCode: z.string().min(1, "Property code is required"),
  propertyName: z.string().min(1, "Property name is required"),
  lrNumber: z.string().min(1, "LR number is required"),
  category: z.string().optional(),
  propertyType: z.string().min(1, "Property type is required"),
  country: z.string().optional(),
  townCityState: z.string().optional(),
  address: z.string().optional(),
  status: z
    .enum(['active', 'inactive', 'archived', 'Active', 'Inactive', 'Archived'])
    .transform((value) => value.toLowerCase())
    .default('active')
}).passthrough();

export const updatePropertySchema = createPropertySchema.partial().passthrough();

// ========== UNIT SCHEMAS ==========
export const createUnitSchema = z.object({
  unitNumber: z.string().min(1, "Unit number is required"),
  property: z.string().min(1, "Property ID is required"),
  rent: z.number().min(0, "Rent must be a positive number"),
  status: z.enum(['vacant', 'occupied', 'maintenance']).default('vacant'),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional()
});

export const updateUnitSchema = createUnitSchema.partial();

// ========== TENANT SCHEMAS ==========
export const createTenantSchema = z.object({
  name: z.string().min(1, "Tenant name is required"),
  email: z.string().email("Invalid email address").optional(),
  phone: z.string().min(10, "Valid phone number is required"),
  idNumber: z.string().min(1, "ID number is required"),
  unit: z.string().min(1, "Unit ID is required"),
  leaseStartDate: z.string().or(z.date()),
  leaseEndDate: z.string().or(z.date()),
  rentAmount: z.number().min(0, "Rent must be a positive number"),
  securityDeposit: z.number().min(0, "Security deposit must be a positive number").optional()
});

export const updateTenantSchema = createTenantSchema.partial();

// ========== LANDLORD SCHEMAS ==========
export const createLandlordSchema = z.object({
  landlordName: z.string().min(1, "Landlord name is required"),
  email: z.string().email("Invalid email address").optional(),
  phoneNumber: z.string().min(10, "Valid phone number is required"),
  regId: z.string().optional(),
  pinNumber: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(['Active', 'Inactive']).default('Active')
});

export const updateLandlordSchema = createLandlordSchema.partial();

// ========== RENT PAYMENT SCHEMAS ==========
export const createPaymentSchema = z.object({
  tenant: z.string().min(1, "Tenant ID is required"),
  unit: z.string().min(1, "Unit ID is required"),
  amount: z.number().min(0, "Amount must be a positive number"),
  paymentDate: z.string().or(z.date()),
  paymentMethod: z.enum(['Cash', 'Bank Transfer', 'M-Pesa', 'Cheque', 'Card']),
  month: z.number().min(1).max(12),
  year: z.number().min(2000),
  receiptNumber: z.string().optional()
});

const mpesaPaybillConfigSchema = z.object({
  _id: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
  shortCode: z.string().optional(),
  consumerKey: z.union([z.string(), z.literal("")]).optional(),
  consumerSecret: z.union([z.string(), z.literal("")]).optional(),
  passkey: z.union([z.string(), z.literal("")]).optional(),
  defaultCashbookAccountId: z.union([z.string(), z.literal("")]).optional(),
  unmatchedPaymentMode: z.enum(["manual_review", "hold_unallocated"]).optional(),
  postingMode: z.enum(["manual_review", "auto_post_matched"]).optional(),
  callbackMode: z.enum(["milik_managed"]).optional(),
  responseType: z.enum(["Completed", "Cancelled"]).optional(),
});

const mpesaPaybillCrudSchema = z
  .object({
    action: z.enum(["create", "update", "delete"]),
    configId: z.string().optional(),
    config: mpesaPaybillConfigSchema.optional(),
  })
  .passthrough();


const emailProfileSchema = z.object({
  _id: z.string().optional(),
  name: z.string().optional(),
  senderName: z.string().optional(),
  senderEmail: z.string().email("Invalid sender email address").optional().or(z.literal("")),
  replyTo: z.string().email("Invalid reply-to email address").optional().or(z.literal("")),
  smtpHost: z.string().optional(),
  smtpPort: z.union([z.number(), z.string().transform((value) => (value === '' ? '' : Number(value))) ]).optional(),
  encryption: z.enum(["ssl", "tls", "none"]).optional(),
  username: z.string().optional(),
  password: z.union([z.string(), z.literal("")]).optional(),
  internalCopyEmail: z.string().email("Invalid internal copy email address").optional().or(z.literal("")),
  internalCopyMode: z.enum(["none", "bcc", "cc"]).optional(),
  usageTags: z.array(z.enum(["receipts", "invoices", "landlord_statements", "system_alerts", "demo_requests", "onboarding"])).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
}).passthrough();

const emailProfileCrudSchema = z
  .object({
    action: z.enum(["create", "update", "delete"]),
    profileId: z.string().optional(),
    profile: emailProfileSchema.optional(),
  })
  .passthrough();

const smsProfileSchema = z.object({
  _id: z.string().optional(),
  name: z.string().optional(),
  provider: z.enum(["generic", "africas_talking", "twilio", "custom_http"]).optional(),
  senderId: z.string().optional(),
  accountUsername: z.string().optional(),
  apiKey: z.union([z.string(), z.literal("")]).optional(),
  apiSecret: z.union([z.string(), z.literal("")]).optional(),
  defaultCountryCode: z.string().optional(),
  callbackUrl: z.string().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
}).passthrough();

const smsProfileCrudSchema = z
  .object({
    action: z.enum(["create", "update", "delete"]),
    profileId: z.string().optional(),
    profile: smsProfileSchema.optional(),
  })
  .passthrough();

const smsTemplateSchema = z.object({
  _id: z.string().optional(),
  key: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  recipientType: z.enum(["tenant", "landlord", "internal"]).optional(),
  enabled: z.boolean().optional(),
  sendMode: z.enum(["manual", "automatic"]).optional(),
  profileId: z.string().optional().or(z.literal("")),
  messageBody: z.string().optional(),
}).passthrough();

const smsTemplateCrudSchema = z
  .object({
    action: z.enum(["update", "reset_defaults"]),
    templateId: z.string().optional(),
    templateKey: z.string().optional(),
    template: smsTemplateSchema.optional(),
  })
  .passthrough();

const communicationSchema = z.object({
  emailProfiles: emailProfileCrudSchema.optional(),
  defaultEmailProfileId: z.string().optional().or(z.literal("")),
  smsProfiles: smsProfileCrudSchema.optional(),
  defaultSmsProfileId: z.string().optional().or(z.literal("")),
  smsTemplates: smsTemplateCrudSchema.optional(),
}).optional();

const paymentIntegrationSchema = z.object({
  mpesaPaybill: mpesaPaybillConfigSchema.optional(),
  mpesaPaybills: mpesaPaybillCrudSchema.optional(),
}).optional();

// ========== COMPANY SCHEMAS ==========
export const createCompanySchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  companyCode: z.string().optional(),
  registrationNo: z.string().optional(),
  taxPIN: z.string().optional(),
  taxExemptCode: z.string().optional(),
  postalAddress: z.string().min(1, "Postal address is required"),
  country: z.string().optional(),
  town: z.string().optional(),
  roadStreet: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  baseCurrency: z.string().optional(),
  taxRegime: z.string().optional(),
  fiscalStartMonth: z.string().optional(),
  fiscalStartYear: z.union([z.number(), z.string().transform((value) => Number(value))]).optional(),
  modules: z.record(z.string(), z.union([z.boolean(), z.object({ enabled: z.boolean().optional(), required: z.boolean().optional() })])).optional(),
  operationPeriodType: z.string().optional(),
  businessOwner: z.string().optional(),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  phoneNo: z.string().min(7, "Phone number is too short").optional().or(z.literal("")),
  slogan: z.string().optional(),
  logo: z.string().optional(),
  unitTypes: z.array(z.string().min(1)).optional(),
  POBOX: z.string().optional(),
  Street: z.string().optional(),
  City: z.string().optional(),
  paymentIntegration: paymentIntegrationSchema,
  communication: communicationSchema,
});

export const updateCompanySchema = createCompanySchema.partial();

export const testCompanyEmailProfileSchema = z.object({
  profileId: z.string().optional(),
  toEmail: z.string().email("Invalid test email address").optional(),
}).refine((value) => Boolean(value.profileId || value.toEmail), {
  message: "Provide a saved email profile or a valid test email address",
});


// ========== MAINTENANCE SCHEMAS ==========
export const createMaintenanceSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  unit: z.string().min(1, "Unit ID is required"),
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).default('Medium'),
  status: z.enum(['Pending', 'In Progress', 'Completed', 'Cancelled']).default('Pending'),
  tenant: z.string().optional()
});

// ========== LEASE SCHEMAS ==========
export const createLeaseSchema = z.object({
  tenant: z.string().min(1, "Tenant ID is required"),
  unit: z.string().min(1, "Unit ID is required"),
  startDate: z.string().or(z.date()),
  endDate: z.string().or(z.date()),
  rentAmount: z.number().min(0, "Rent must be a positive number"),
  securityDeposit: z.number().min(0, "Security deposit must be positive").optional(),
  status: z.enum(['Active', 'Expired', 'Terminated']).default('Active')
});

// ========== EXPENSE SCHEMAS ==========
export const createExpenseSchema = z.object({
  category: z.string().min(1, "Category is required"),
  amount: z.number().min(0, "Amount must be a positive number"),
  date: z.string().or(z.date()),
  description: z.string().min(1, "Description is required"),
  property: z.string().optional(),
  unit: z.string().optional(),
  vendor: z.string().optional()
});

// ========== UTILITY SCHEMAS ==========
export const createUtilitySchema = z.object({
  name: z.string().min(1, "Utility name is required"),
  type: z.enum(['Water', 'Electricity', 'Gas', 'Internet', 'Security', 'Other']),
  fixedAmount: z.boolean().default(false),
  amount: z.number().min(0, "Amount must be a positive number").optional(),
  billingCycle: z.enum(['Monthly', 'Quarterly', 'Annually']).default('Monthly')
});
