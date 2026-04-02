import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URL;
const DEFAULT_BUSINESS_ID = process.env.DEFAULT_BUSINESS_ID || '65f1a2b3c4d5e6f789012345';
const DEFAULT_LANDLORD_ID = process.env.DEFAULT_LANDLORD_ID || '65f1a2b3c4d5e6f789012347';
const DEFAULT_PROPERTY_ID = process.env.DEFAULT_PROPERTY_ID || '65f1a2b3c4d5e6f789012346';
const DEFAULT_UNIT_ID = process.env.DEFAULT_UNIT_ID || '65f1a2b3c4d5e6f789012349';
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || '65f1a2b3c4d5e6f789012348';
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || 'milik-admin';
const DEFAULT_CHART_ACCOUNT_ID = process.env.DEFAULT_CHART_ACCOUNT_ID || '65f1a2b3c4d5e6f789012350';

async function migrate() {
  await mongoose.connect(MONGO_URI);
    // User migration: ensure company reference
    const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({}));
    const users = await User.find({});
    for (const user of users) {
      let needsUpdate = false;
      if (!user.company) {
        user.company = DEFAULT_BUSINESS_ID;
        needsUpdate = true;
      }
      if (needsUpdate) {
        await user.save();
        console.log(`Updated user: ${user._id}`);
      }
    }
  await mongoose.connect(MONGO_URI);
  // FinancialLedgerEntry migration
  const FinancialLedgerEntry = mongoose.models.FinancialLedgerEntry || mongoose.model('FinancialLedgerEntry', new mongoose.Schema({}));
  const ledgerEntries = await FinancialLedgerEntry.find({});
  for (const entry of ledgerEntries) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await entry.save();
      console.log(`Updated ledger entry: ${entry._id}`);
    }
  }

  // PaymentVoucher migration
  const PaymentVoucher = mongoose.models.PaymentVoucher || mongoose.model('PaymentVoucher', new mongoose.Schema({}));
  const vouchers = await PaymentVoucher.find({});
  for (const voucher of vouchers) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await voucher.save();
      console.log(`Updated payment voucher: ${voucher._id}`);
    }
  }

  // Expense migration
  const Expense = mongoose.models.Expense || mongoose.model('Expense', new mongoose.Schema({}));
  const expenses = await Expense.find({});
  for (const expense of expenses) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await expense.save();
      console.log(`Updated expense: ${expense._id}`);
    }
  }

  // ProcessedStatement migration
  const ProcessedStatement = mongoose.models.ProcessedStatement || mongoose.model('ProcessedStatement', new mongoose.Schema({}));
  const processedStatements = await ProcessedStatement.find({});
  for (const statement of processedStatements) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await statement.save();
      console.log(`Updated processed statement: ${statement._id}`);
    }
  }

  // LandlordStatementLine migration
  const LandlordStatementLine = mongoose.models.LandlordStatementLine || mongoose.model('LandlordStatementLine', new mongoose.Schema({}));
  const statementLines = await LandlordStatementLine.find({});
  for (const line of statementLines) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await line.save();
      console.log(`Updated landlord statement line: ${line._id}`);
    }
  }

  // CompanySettings migration
  const CompanySettings = mongoose.models.CompanySettings || mongoose.model('CompanySettings', new mongoose.Schema({}));
  const settings = await CompanySettings.find({});
  for (const setting of settings) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await setting.save();
      console.log(`Updated company settings: ${setting._id}`);
    }
  }

  // Notification migration
  const Notification = mongoose.models.Notification || mongoose.model('Notification', new mongoose.Schema({}));
  const notifications = await Notification.find({});
  for (const notification of notifications) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await notification.save();
      console.log(`Updated notification: ${notification._id}`);
    }
  }

  // Utility migration
  const Utility = mongoose.models.Utility || mongoose.model('Utility', new mongoose.Schema({}));
  const utilities = await Utility.find({});
  for (const utility of utilities) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await utility.save();
      console.log(`Updated utility: ${utility._id}`);
    }
  }

  // Lease migration
  const Lease = mongoose.models.Lease || mongoose.model('Lease', new mongoose.Schema({}));
  const leases = await Lease.find({});
  for (const lease of leases) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await lease.save();
      console.log(`Updated lease: ${lease._id}`);
    }
  }

  // Maintenance migration
  const Maintenance = mongoose.models.Maintenance || mongoose.model('Maintenance', new mongoose.Schema({}));
  const maintenances = await Maintenance.find({});
  for (const maintenance of maintenances) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await maintenance.save();
      console.log(`Updated maintenance: ${maintenance._id}`);
    }
  }

  // RentPayment migration
  const RentPayment = mongoose.models.RentPayment || mongoose.model('RentPayment', new mongoose.Schema({}));
  const rentPayments = await RentPayment.find({});
  for (const payment of rentPayments) {
    let needsUpdate = false;
    // Add field checks and defaults as needed
    if (needsUpdate) {
      await payment.save();
      console.log(`Updated rent payment: ${payment._id}`);
    }
  }

  // User migratio

  // Landlord migration
  const Landlord = mongoose.models.Landlord || mongoose.model('Landlord', new mongoose.Schema({
    landlordCode: { type: String, required: true, unique: true },
    landlordType: { type: String, required: true, default: 'Individual' },
    landlordName: { type: String, required: true },
    idNumber: { type: String },
    regId: { type: String, required: true },
    taxPin: { type: String, required: true },
    status: { type: String, default: 'Active' }
  }));
  const landlords = await Landlord.find({});
  for (const landlord of landlords) {
    let needsUpdate = false;
    if (!landlord.landlordCode) {
      landlord.landlordCode = `LL${String(Date.now()).slice(-6)}`;
      needsUpdate = true;
    }
    if (!landlord.landlordType) {
      landlord.landlordType = 'Individual';
      needsUpdate = true;
    }
    if (!landlord.landlordName) {
      landlord.landlordName = 'Unnamed Landlord';
      needsUpdate = true;
    }
    if (!landlord.regId) {
      landlord.regId = 'UNKNOWN';
      needsUpdate = true;
    }
    if (!landlord.taxPin) {
      landlord.taxPin = 'UNKNOWN';
      needsUpdate = true;
    }
    if (!landlord.status) {
      landlord.status = 'Active';
      needsUpdate = true;
    }
    if (needsUpdate) {
      await landlord.save();
      console.log(`Updated landlord: ${landlord._id}`);
    }
  }

  // Tenant migration
  const Tenant = mongoose.models.Tenant || mongoose.model('Tenant', new mongoose.Schema({
    tenantCode: { type: String, unique: true, sparse: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    idNumber: { type: String, required: true, unique: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
    rent: { type: Number, required: true },
    balance: { type: Number, default: 0 },
    status: { type: String, default: 'active' },
    paymentMethod: { type: String, required: true },
    leaseType: { type: String, default: 'at_will' },
    moveInDate: { type: Date, required: true },
    moveOutDate: { type: Date },
    emergencyContact: { name: String, phone: String, relationship: String },
    documents: [{ type: String }]
  }));
  const tenants = await Tenant.find({});
  for (const tenant of tenants) {
    let needsUpdate = false;
    if (!tenant.tenantCode) {
      tenant.tenantCode = `TN${String(Date.now()).slice(-6)}`;
      needsUpdate = true;
    }
    if (!tenant.name) {
      tenant.name = 'Unnamed Tenant';
      needsUpdate = true;
    }
    if (!tenant.phone) {
      tenant.phone = 'Unknown';
      needsUpdate = true;
    }
    if (!tenant.idNumber) {
      tenant.idNumber = 'Unknown';
      needsUpdate = true;
    }
    if (!tenant.unit) {
      tenant.unit = DEFAULT_UNIT_ID;
      needsUpdate = true;
    }
    if (typeof tenant.rent === 'undefined') {
      tenant.rent = 0;
      needsUpdate = true;
    }
    if (typeof tenant.balance === 'undefined') {
      tenant.balance = 0;
      needsUpdate = true;
    }
    if (!tenant.status) {
      tenant.status = 'active';
      needsUpdate = true;
    }
    if (!tenant.paymentMethod) {
      tenant.paymentMethod = 'cash';
      needsUpdate = true;
    }
    if (!tenant.leaseType) {
      tenant.leaseType = 'at_will';
      needsUpdate = true;
    }
    if (!tenant.moveInDate) {
      tenant.moveInDate = new Date();
      needsUpdate = true;
    }
    if (!tenant.emergencyContact) {
      tenant.emergencyContact = { name: '', phone: '', relationship: '' };
      needsUpdate = true;
    }
    if (!tenant.documents) {
      tenant.documents = [];
      needsUpdate = true;
    }
    if (needsUpdate) {
      await tenant.save();
      console.log(`Updated tenant: ${tenant._id}`);
    }
  }

  // TenantInvoice migration
  const TenantInvoice = mongoose.models.TenantInvoice || mongoose.model('TenantInvoice', new mongoose.Schema({
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: 'Landlord', required: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
    invoiceNumber: { type: String, required: true, unique: true },
    category: { type: String, enum: ['RENT_CHARGE', 'UTILITY_CHARGE'], required: true },
    amount: { type: Number, required: true },
    description: { type: String },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    status: { type: String, default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chartAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialLedgerEntry', required: true }
  }));
  const invoices = await TenantInvoice.find({});
  for (const invoice of invoices) {
    let needsUpdate = false;
    if (!invoice.business) {
      invoice.business = DEFAULT_BUSINESS_ID;
      needsUpdate = true;
    }
    if (!invoice.property) {
      invoice.property = DEFAULT_PROPERTY_ID;
      needsUpdate = true;
    }
    if (!invoice.landlord) {
      invoice.landlord = DEFAULT_LANDLORD_ID;
      needsUpdate = true;
    }
    if (!invoice.tenant) {
      invoice.tenant = DEFAULT_TENANT_ID;
      needsUpdate = true;
    }
    if (!invoice.unit) {
      invoice.unit = DEFAULT_UNIT_ID;
      needsUpdate = true;
    }
    if (!invoice.invoiceNumber) {
      invoice.invoiceNumber = `INV${String(Date.now()).slice(-6)}`;
      needsUpdate = true;
    }
    if (!invoice.category) {
      invoice.category = 'RENT_CHARGE';
      needsUpdate = true;
    }
    if (typeof invoice.amount === 'undefined') {
      invoice.amount = 0;
      needsUpdate = true;
    }
    if (!invoice.description) {
      invoice.description = '';
      needsUpdate = true;
    }
    if (!invoice.invoiceDate) {
      invoice.invoiceDate = new Date();
      needsUpdate = true;
    }
    if (!invoice.dueDate) {
      invoice.dueDate = new Date();
      needsUpdate = true;
    }
    if (!invoice.status) {
      invoice.status = 'pending';
      needsUpdate = true;
    }
    if (!invoice.createdBy) {
      invoice.createdBy = DEFAULT_USER_ID;
      needsUpdate = true;
    }
    if (!invoice.chartAccount) {
      invoice.chartAccount = DEFAULT_CHART_ACCOUNT_ID;
      needsUpdate = true;
    }
    if (needsUpdate) {
      await invoice.save();
      console.log(`Updated invoice: ${invoice._id}`);
    }
  }

  // Receipt migration
  const Receipt = mongoose.models.Receipt || mongoose.model('Receipt', new mongoose.Schema({
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: 'Landlord' },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    unit: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', required: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String, required: true },
    description: { type: String },
    receiptDate: { type: Date, required: true },
    receiptNumber: { type: String, unique: true },
    referenceNumber: { type: String },
    cashbook: { type: String, default: 'Main Cashbook' },
    paymentType: { type: String, default: 'rent' },
    dueDate: { type: Date },
    isConfirmed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }));
  const receipts = await Receipt.find({});
  for (const receipt of receipts) {
    let needsUpdate = false;
    if (!receipt.business) {
      receipt.business = DEFAULT_BUSINESS_ID;
      needsUpdate = true;
    }
    if (!receipt.property) {
      receipt.property = DEFAULT_PROPERTY_ID;
      needsUpdate = true;
    }
    if (!receipt.landlord) {
      receipt.landlord = DEFAULT_LANDLORD_ID;
      needsUpdate = true;
    }
    if (!receipt.tenant) {
      receipt.tenant = DEFAULT_TENANT_ID;
      needsUpdate = true;
    }
    if (!receipt.unit) {
      receipt.unit = DEFAULT_UNIT_ID;
      needsUpdate = true;
    }
    if (typeof receipt.amount === 'undefined') {
      receipt.amount = 0;
      needsUpdate = true;
    }
    if (!receipt.paymentMethod) {
      receipt.paymentMethod = 'cash';
      needsUpdate = true;
    }
    if (!receipt.description) {
      receipt.description = '';
      needsUpdate = true;
    }
    if (!receipt.receiptDate) {
      receipt.receiptDate = new Date();
      needsUpdate = true;
    }
    if (!receipt.receiptNumber) {
      receipt.receiptNumber = `RCPT${String(Date.now()).slice(-6)}`;
      needsUpdate = true;
    }
    if (!receipt.referenceNumber) {
      receipt.referenceNumber = '';
      needsUpdate = true;
    }
    if (!receipt.cashbook) {
      receipt.cashbook = 'Main Cashbook';
      needsUpdate = true;
    }
    if (!receipt.paymentType) {
      receipt.paymentType = 'rent';
      needsUpdate = true;
    }
    if (!receipt.dueDate) {
      receipt.dueDate = new Date();
      needsUpdate = true;
    }
    if (typeof receipt.isConfirmed === 'undefined') {
      receipt.isConfirmed = false;
      needsUpdate = true;
    }
    if (!receipt.createdBy) {
      receipt.createdBy = DEFAULT_USER_ID;
      needsUpdate = true;
    }
    if (needsUpdate) {
      await receipt.save();
      console.log(`Updated receipt: ${receipt._id}`);
    }
  }

  // LandlordStatement migration
  const LandlordStatement = mongoose.models.LandlordStatement || mongoose.model('LandlordStatement', new mongoose.Schema({
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: 'Landlord', required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    statementNumber: { type: String, required: true }
  }));
  const statements = await LandlordStatement.find({});
  for (const statement of statements) {
    let needsUpdate = false;
    if (!statement.business) {
      statement.business = DEFAULT_BUSINESS_ID;
      needsUpdate = true;
    }
    if (!statement.property) {
      statement.property = DEFAULT_PROPERTY_ID;
      needsUpdate = true;
    }
    if (!statement.landlord) {
      statement.landlord = DEFAULT_LANDLORD_ID;
      needsUpdate = true;
    }
    if (!statement.periodStart) {
      statement.periodStart = new Date();
      needsUpdate = true;
    }
    if (!statement.periodEnd) {
      statement.periodEnd = new Date();
      needsUpdate = true;
    }
    if (!statement.statementNumber) {
      statement.statementNumber = `STMT${String(Date.now()).slice(-6)}`;
      needsUpdate = true;
    }
    if (needsUpdate) {
      await statement.save();
      console.log(`Updated statement: ${statement._id}`);
    }
  }

  console.log('Migration complete!');
  // Property migration
  const Property = mongoose.models.Property || mongoose.model('Property', new mongoose.Schema({
    landlordId: { type: mongoose.Schema.Types.ObjectId, ref: 'Landlord' },
    name: { type: String, required: true },
    contact: { type: String },
    isPrimary: { type: Boolean, default: false }
  }));
  const properties = await Property.find({});
  for (const property of properties) {
    let needsUpdate = false;
    if (!property.landlordId) {
      property.landlordId = DEFAULT_LANDLORD_ID;
      needsUpdate = true;
    }
    if (!property.name) {
      property.name = 'Unnamed Property';
      needsUpdate = true;
    }
    if (!property.contact) {
      property.contact = '';
      needsUpdate = true;
    }
    if (typeof property.isPrimary === 'undefined') {
      property.isPrimary = false;
      needsUpdate = true;
    }
    if (needsUpdate) {
      await property.save();
      console.log(`Updated property: ${property._id}`);
    }
  }

  // Unit migration
  const Unit = mongoose.models.Unit || mongoose.model('Unit', new mongoose.Schema({
    unitNumber: { type: String, required: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    unitType: { type: String, required: true },
    rent: { type: Number, required: true },
    deposit: { type: Number, required: true },
    status: { type: String, default: 'vacant' },
    amenities: [{ type: String }],
    utilities: [{ utility: String, isIncluded: Boolean, unitCharge: Number }],
    billingFrequency: { type: String, default: 'monthly' },
    isVacant: { type: Boolean, default: true },
    lastTenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' }
  }));
  const units = await Unit.find({});
  for (const unit of units) {
    let needsUpdate = false;
    if (!unit.unitNumber) {
      unit.unitNumber = 'Unknown';
      needsUpdate = true;
    }
    if (!unit.property) {
      unit.property = DEFAULT_PROPERTY_ID;
      needsUpdate = true;
    }
    if (!unit.unitType) {
      unit.unitType = 'studio';
      needsUpdate = true;
    }
    if (typeof unit.rent === 'undefined') {
      unit.rent = 0;
      needsUpdate = true;
    }
    if (typeof unit.deposit === 'undefined') {
      unit.deposit = 0;
      needsUpdate = true;
    }
    if (!unit.status) {
      unit.status = 'vacant';
      needsUpdate = true;
    }
    if (!unit.amenities) {
      unit.amenities = [];
      needsUpdate = true;
    }
    if (!unit.utilities) {
      unit.utilities = [];
      needsUpdate = true;
    }
    if (!unit.billingFrequency) {
      unit.billingFrequency = 'monthly';
      needsUpdate = true;
    }
    if (typeof unit.isVacant === 'undefined') {
      unit.isVacant = true;
      needsUpdate = true;
    }
    if (!unit.lastTenant) {
      unit.lastTenant = DEFAULT_TENANT_ID;
      needsUpdate = true;
    }
    if (needsUpdate) {
      await unit.save();
      console.log(`Updated unit: ${unit._id}`);
    }
  }

  console.log('Migration complete!');
  mongoose.disconnect();
}

migrate();