import axios from 'axios';
import Company from '../models/Company.js';
import Landlord from '../models/Landlord.js';
import { generateStatementPdf } from './statementPdfService.js';
import { generateInvoicePdf } from './invoicePdfService.js';
import { generateReceiptPdf } from './receiptPdfService.js';
import MeterReading from '../models/MeterReading.js';
import ProcessedStatement from '../models/ProcessedStatement.js';
import Property from '../models/Property.js';
import RentPayment from '../models/RentPayment.js';
import SmsLog from '../models/SmsLog.js';
import Tenant from '../models/Tenant.js';
import TenantInvoice from '../models/TenantInvoice.js';
import Unit from '../models/Unit.js';
import {
  buildEmailProfileStatus,
  buildSmsProfileStatus,
  getPrimaryEmailProfile,
  getPrimarySmsProfile,
  getRawEmailProfiles,
  getRawSmsProfiles,
  mergeSmsTemplatesWithDefaults,
} from '../utils/companyModules.js';
import {
  buildCompanyInternalCopyRecipients,
  buildCompanySmtpTransporter,
  decryptStoredSecret,
  resolveCompanyMailSender,
} from '../utils/smtpMailer.js';

const normalizeText = (value = '') => String(value || '').trim();
const safeLower = (value = '') => normalizeText(value).toLowerCase();
const toPlainObject = (value = {}) => (value?.toObject ? value.toObject() : value || {});
const unique = (values = []) => Array.from(new Set((Array.isArray(values) ? values : [values]).map((item) => String(item || '').trim()).filter(Boolean)));
const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const formatCurrency = (value, currency = 'KES') => {
  const amount = Number(value || 0);
  return `${currency} ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const escapeHtml = (value = '') =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SMS_ALLOWED_TEMPLATE_KEYS = {
  landlord_bulk: ['landlord_notice_sms', 'landlord_statement_ready', 'landlord_payment_sms'],
  tenant_bulk: ['tenant_notice_sms', 'overdue_reminder_tenant', 'receipt_sms_tenant', 'invoice_sms_tenant', 'penalty_notice_sms', 'meter_usage_notification_sms'],
  processed_statement: ['landlord_statement_ready'],
  receipt: ['receipt_sms_tenant'],
  invoice: ['invoice_sms_tenant'],
  meter_reading: ['meter_usage_notification_sms'],
  penalty_invoice: ['penalty_notice_sms'],
  landlord_payment: ['landlord_payment_sms'],
};

const EMAIL_TEMPLATE_DEFINITIONS = [
  {
    key: 'receipt_email_tenant',
    name: 'Receipt Email',
    recipientType: 'tenant',
    description: 'Send a posted receipt confirmation email to the tenant.',
    subject: 'Receipt {receiptNumber} – {propertyName} Unit {unitNumber}',
    body:
      'Hello {tenantName},\n\nWe have received your payment for {propertyName} Unit {unitNumber}. Please find the details below.\n\nReceipt Number: {receiptNumber}\nPayment Date: {paymentDate}\nAmount Received: {amount}\nPayment Type: {paymentType}\nPayment Method: {paymentMethod}\nReference Number: {referenceNumber}\n\nKindly retain this confirmation as proof of payment. If you have any questions, please do not hesitate to contact us.\n\nRegards,\n{companyName}\n{companyPhone}',
  },
  {
    key: 'invoice_email_tenant',
    name: 'Invoice Email',
    recipientType: 'tenant',
    description: 'Send a rental invoice email to the tenant.',
    subject: 'Invoice {invoiceNumber} – {category} for {propertyName} Unit {unitNumber}',
    body:
      'Hello {tenantName} ({tenantCode}),\n\nPlease find below your invoice details for {propertyName} Unit {unitNumber}.\n\nInvoice Number: {invoiceNumber}\nInvoice Type: {category}\nInvoice Date: {invoiceDate}\nDue Date: {dueDate}\nAmount Due: {amountDue}\nParticulars: {particulars}\nStatus: {invoiceStatus}\n\nPlease ensure payment is made by {dueDate} to avoid late penalties.\n\nRegards,\n{companyName}\n{companyPhone}',
  },
  {
    key: 'landlord_statement_ready_email',
    name: 'Landlord Statement Ready Email',
    recipientType: 'landlord',
    description: 'Notify the landlord that a processed statement is ready.',
    subject: '{statementType} Statement – {propertyName} ({statementPeriod})',
    body:
      'Hello {landlordName} ({landlordCode}),\n\nYour {statementType} statement for {propertyName} covering {statementPeriod} is ready for review.\n\nStatement Reference: {statementNumber}\nStatement Date: {statementDate}\n\nFinancial Summary:\nTotal Rent Invoiced: {totalRentInvoiced}\nTotal Rent Received: {totalRentReceived}\nManagement Commission ({commissionPercentage}): {commissionAmount}\nTotal Expenses: {totalExpenses}\nNet Amount Due to Landlord: {netAmountDue}\n\nPlease review and contact us if you have any questions.\n\nRegards,\n{companyName}\n{companyPhone}',
  },
  {
    key: 'landlord_payment_email',
    name: 'Landlord Payment Email',
    recipientType: 'landlord',
    description: 'Confirm a landlord payment by email.',
    subject: 'Payment Confirmation – {propertyName} ({paymentDate})',
    body:
      'Hello {landlordName} ({landlordCode}),\n\nA payment has been processed for your account. Please find the details below.\n\nProperty: {propertyName}\nStatement Period: {statementPeriod}\nStatement Reference: {statementNumber}\nAmount Paid: {amount}\nPayment Date: {paymentDate}\nPayment Reference: {referenceNumber}\n\nRegards,\n{companyName}\n{companyPhone}',
  },
  {
    key: 'penalty_notice_email',
    name: 'Penalty Notice Email',
    recipientType: 'tenant',
    description: 'Send a late penalty invoice notice to the tenant.',
    subject: 'Late Penalty Notice – Invoice {invoiceNumber}',
    body:
      'Hello {tenantName} ({tenantCode}),\n\nA late payment penalty has been raised on your account for {propertyName} Unit {unitNumber}.\n\nPenalty Invoice Number: {invoiceNumber}\nAmount Due: {amountDue}\nDue Date: {dueDate}\nOriginal Invoice: {sourceInvoiceNumber}\n\nPlease settle this outstanding amount by {dueDate} to prevent further penalties.\n\nRegards,\n{companyName}\n{companyPhone}',
  },
  {
    key: 'meter_usage_notification_email',
    name: 'Meter / Usage Notification Email',
    recipientType: 'tenant',
    description: 'Send a utility usage notification to the affected tenant.',
    subject: '{utilityType} Reading – {propertyName} Unit {unitNumber} ({billingPeriod})',
    body:
      'Hello {tenantName} ({tenantCode}),\n\nYour {utilityType} meter reading for {propertyName} Unit {unitNumber} has been recorded for {billingPeriod}.\n\nMeter Number: {meterNumber}\nReading Date: {readingDate}\nPrevious Reading: {previousReading}\nCurrent Reading: {currentReading}\nUnits Consumed: {unitsConsumed}\nRate per Unit: {rate}\nCharge Amount: {amount}\n\nRegards,\n{companyName}\n{companyPhone}',
  },
  {
    key: 'tenant_notice_email',
    name: 'Tenant Notice Email',
    recipientType: 'tenant',
    description: 'General-purpose email notice to a tenant.',
    subject: 'Notice from {companyName}',
    body: 'Hello {tenantName},\n\n{customBody}\n\nRegards,\n{companyName}\n{companyPhone}',
  },
  {
    key: 'landlord_notice_email',
    name: 'Landlord Notice Email',
    recipientType: 'landlord',
    description: 'General-purpose email notice to a landlord.',
    subject: 'Notice from {companyName}',
    body: 'Hello {landlordName},\n\n{customBody}\n\nRegards,\n{companyName}\n{companyPhone}',
  },
];

const EMAIL_ALLOWED_TEMPLATE_KEYS = {
  tenant_bulk: ['tenant_notice_email'],
  landlord_bulk: ['landlord_notice_email'],
  processed_statement: ['landlord_statement_ready_email'],
  receipt: ['receipt_email_tenant'],
  invoice: ['invoice_email_tenant'],
  meter_reading: ['meter_usage_notification_email'],
  penalty_invoice: ['penalty_notice_email'],
  landlord_payment: ['landlord_payment_email'],
};

const CONTEXT_PERMISSION_MAP = {
  landlord_bulk: { resource: 'landlords', moduleKey: 'propertyManagement' },
  tenant_bulk: { resource: 'tenants', moduleKey: 'propertyManagement' },
  processed_statement: { resource: 'processedStatements', moduleKey: 'accounts' },
  receipt: { resource: 'receipts', moduleKey: 'propertyManagement' },
  invoice: { resource: 'tenantInvoices', moduleKey: 'propertyManagement' },
  meter_reading: { resource: 'meterReadings', moduleKey: 'propertyManagement' },
  penalty_invoice: { resource: 'latePenalties', moduleKey: 'propertyManagement' },
  landlord_payment: { resource: 'landlordPayments', moduleKey: 'accounts' },
};

const normalizePhoneNumber = (value = '', defaultCountryCode = '+254') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '').replace(/[^\d+]/g, '');
  if (!compact) return '';
  if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
  if (compact.startsWith('00')) return `+${compact.slice(2).replace(/\D/g, '')}`;
  if (compact.startsWith('0')) {
    const country = String(defaultCountryCode || '+254').replace(/[^\d]/g, '');
    return `+${country}${compact.slice(1).replace(/\D/g, '')}`;
  }
  if (compact.startsWith('254')) return `+${compact}`;
  const country = String(defaultCountryCode || '+254').replace(/[^\d]/g, '');
  return `+${country}${compact.replace(/\D/g, '')}`;
};

const buildEmailHtml = ({ companyName = 'MILIK', subject = '', body = '' }) => {
  const bodyHtml = String(body || '')
    .split('\n')
    .map((line) => `<p style="margin:0 0 12px;">${escapeHtml(line) || '&nbsp;'}</p>`)
    .join('');

  return `
    <div style="font-family: Arial, sans-serif; background:#f8fafc; padding:24px; color:#0f172a;">
      <div style="max-width:720px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; overflow:hidden;">
        <div style="background:#0B3B2E; color:#ffffff; padding:18px 24px;">
          <div style="font-size:18px; font-weight:700;">${escapeHtml(companyName)}</div>
          <div style="font-size:13px; opacity:0.9; margin-top:4px;">${escapeHtml(subject)}</div>
        </div>
        <div style="padding:24px; line-height:1.6; font-size:14px;">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;
};

const getTenantDisplayName = (tenant = {}) => tenant?.name || tenant?.tenantName || 'Tenant';
const getLandlordDisplayName = (landlord = {}) => landlord?.landlordName || landlord?.name || 'Landlord';
const getPropertyName = (property = {}) => property?.propertyName || property?.name || '';
const getUnitNumber = (unit = {}) => unit?.unitNumber || unit?.name || '';

const humanizeSnake = (value = '') =>
  String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const formatPaymentType = (value = '') => {
  const map = { rent: 'Rent', deposit: 'Deposit', utility: 'Utility', late_fee: 'Late Fee', other: 'Other' };
  return map[String(value || '').toLowerCase()] || humanizeSnake(value);
};

const formatInvoiceCategory = (value = '') => {
  const label = String(value || '').replace(/_CHARGE$/, '').replace(/_/g, ' ');
  return label ? `${label.replace(/\b\w/g, (c) => c.toUpperCase())} Charge` : '';
};

const resolveTenantOverdueAmount = (tenant = {}) => {
  const balance = Number(tenant?.balance || 0);
  const status = safeLower(tenant?.status || 'active');
  if (status !== 'overdue') return 0;
  return Math.max(balance, 0);
};

const buildCommonPayload = ({ company = {}, channel = 'sms' }) => ({
  companyName: company?.companyName || company?.name || 'MILIK',
  companyEmail: company?.email || '',
  companyPhone: company?.phoneNo || '',
  currencyCode: company?.baseCurrency || 'KES',
  channel,
});

const buildLandlordBulkPayload = ({ landlord, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getLandlordDisplayName(landlord),
  landlordName: getLandlordDisplayName(landlord),
  landlordCode: landlord?.landlordCode || '',
  landlordType: landlord?.landlordType || '',
  taxPin: landlord?.taxPin || '',
  email: landlord?.email || '',
  landlordEmail: landlord?.email || '',
  phoneNumber: landlord?.phoneNumber || '',
  propertyName: '',
  statementPeriod: '',
  statementDate: '',
  amount: '',
  paymentDate: '',
  referenceNumber: '',
});

const buildTenantBulkPayload = ({ tenant, property, unit, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getTenantDisplayName(tenant),
  tenantName: getTenantDisplayName(tenant),
  tenantCode: tenant?.tenantCode || '',
  propertyName: getPropertyName(property),
  unitNumber: getUnitNumber(unit),
  overdueAmount: formatCurrency(resolveTenantOverdueAmount(tenant), company?.baseCurrency || 'KES'),
  rent: formatCurrency(tenant?.rent || 0, company?.baseCurrency || 'KES'),
  balance: formatCurrency(Math.abs(Number(tenant?.balance || 0)), company?.baseCurrency || 'KES'),
  depositAmount: formatCurrency(tenant?.depositAmount || 0, company?.baseCurrency || 'KES'),
  moveInDate: formatDate(tenant?.moveInDate),
  leaseType: humanizeSnake(tenant?.leaseType || ''),
  tenantStatus: humanizeSnake(tenant?.status || ''),
  idNumber: tenant?.idNumber || '',
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildProcessedStatementPayload = ({ statement, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getLandlordDisplayName(statement?.landlord),
  landlordName: getLandlordDisplayName(statement?.landlord),
  landlordCode: statement?.landlord?.landlordCode || '',
  propertyName: getPropertyName(statement?.property),
  statementPeriod: `${formatDate(statement?.periodStart)} to ${formatDate(statement?.periodEnd)}`,
  statementDate: formatDate(statement?.closedAt || statement?.createdAt),
  statementNumber: statement?.sourceStatementNumber || String(statement?._id || ''),
  statementType: humanizeSnake(statement?.statementType || ''),
  netAmountDue: formatCurrency(statement?.netAmountDue || 0, company?.baseCurrency || 'KES'),
  amount: formatCurrency(statement?.netAmountDue || 0, company?.baseCurrency || 'KES'),
  totalRentInvoiced: formatCurrency(statement?.totalRentInvoiced || 0, company?.baseCurrency || 'KES'),
  totalRentReceived: formatCurrency(statement?.totalRentReceived || 0, company?.baseCurrency || 'KES'),
  commissionAmount: formatCurrency(statement?.commissionAmount || 0, company?.baseCurrency || 'KES'),
  commissionPercentage: `${round2(statement?.commissionPercentage || 0)}%`,
  totalExpenses: formatCurrency(statement?.totalExpenses || 0, company?.baseCurrency || 'KES'),
  netAfterExpenses: formatCurrency(statement?.netAfterExpenses || 0, company?.baseCurrency || 'KES'),
});

const buildReceiptPayload = ({ receipt, tenant, property, unit, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getTenantDisplayName(tenant),
  tenantName: getTenantDisplayName(tenant),
  tenantCode: tenant?.tenantCode || '',
  propertyName: getPropertyName(property),
  unitNumber: getUnitNumber(unit),
  amount: formatCurrency(receipt?.amount || 0, company?.baseCurrency || 'KES'),
  receiptNumber: receipt?.receiptNumber || '',
  paymentDate: formatDate(receipt?.paymentDate || receipt?.createdAt),
  paymentMethod: humanizeSnake(receipt?.paymentMethod || receipt?.method || ''),
  paymentType: formatPaymentType(receipt?.paymentType || ''),
  dueDate: formatDate(receipt?.dueDate),
  bankingDate: formatDate(receipt?.bankingDate),
  referenceNumber: receipt?.referenceNumber || receipt?.reference || receipt?.transactionId || receipt?.mpesaReceiptNumber || '',
  description: normalizeText(receipt?.description || ''),
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildInvoicePayload = ({ invoice, tenant, property, unit, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getTenantDisplayName(tenant),
  tenantName: getTenantDisplayName(tenant),
  tenantCode: tenant?.tenantCode || '',
  propertyName: getPropertyName(property),
  unitNumber: getUnitNumber(unit),
  invoiceNumber: invoice?.invoiceNumber || '',
  category: formatInvoiceCategory(invoice?.category || ''),
  amountDue: formatCurrency(invoice?.netAmount ?? invoice?.adjustedAmount ?? invoice?.amount ?? 0, company?.baseCurrency || 'KES'),
  dueDate: formatDate(invoice?.dueDate),
  invoiceDate: formatDate(invoice?.invoiceDate || invoice?.createdAt),
  invoiceStatus: humanizeSnake(invoice?.status || ''),
  description: normalizeText(invoice?.description || ''),
  rentAmount: formatCurrency(tenant?.rent || 0, company?.baseCurrency || 'KES'),
  sourceInvoiceNumber: invoice?.metadata?.penaltySourceInvoiceNumber || invoice?.sourceInvoiceNumber || '',
  particulars: (() => {
    const meta = invoice?.metadata || {};
    const currency = company?.baseCurrency || 'KES';
    if (meta.billItemKey === 'rent_utility:combined' && Array.isArray(meta.utilityBreakdown) && meta.utilityBreakdown.length > 0) {
      const rentAmt = (invoice?.amount ?? 0) - (meta.utilityAmount ?? 0);
      const lines = rentAmt > 0 ? [`Rent: ${formatCurrency(rentAmt, currency)}`] : [];
      meta.utilityBreakdown.forEach((item) => {
        if (item?.label && item?.amount > 0) lines.push(`${item.label}: ${formatCurrency(item.amount, currency)}`);
      });
      return lines.join(' | ');
    }
    return normalizeText(invoice?.description || '');
  })(),
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildMeterReadingPayload = ({ reading, tenant, property, unit, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getTenantDisplayName(tenant),
  tenantName: getTenantDisplayName(tenant),
  tenantCode: tenant?.tenantCode || '',
  propertyName: getPropertyName(property),
  unitNumber: getUnitNumber(unit),
  utilityType: reading?.utilityType || '',
  meterNumber: reading?.meterNumber || '',
  billingPeriod: reading?.billingPeriod || '',
  readingDate: formatDate(reading?.readingDate),
  previousReading: Number(reading?.previousReading || 0).toLocaleString('en-KE'),
  currentReading: Number(reading?.currentReading || 0).toLocaleString('en-KE'),
  unitsConsumed: Number(reading?.unitsConsumed || 0).toLocaleString('en-KE'),
  rate: formatCurrency(reading?.rate || 0, company?.baseCurrency || 'KES'),
  amount: formatCurrency(reading?.amount || 0, company?.baseCurrency || 'KES'),
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildLandlordPaymentPayload = ({ statement, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getLandlordDisplayName(statement?.landlord),
  landlordName: getLandlordDisplayName(statement?.landlord),
  landlordCode: statement?.landlord?.landlordCode || '',
  propertyName: getPropertyName(statement?.property),
  statementPeriod: `${formatDate(statement?.periodStart)} to ${formatDate(statement?.periodEnd)}`,
  statementNumber: statement?.sourceStatementNumber || String(statement?._id || ''),
  amount: formatCurrency(statement?.amountPaid || statement?.netAmountDue || 0, company?.baseCurrency || 'KES'),
  paymentDate: formatDate(statement?.paidDate || statement?.updatedAt || statement?.closedAt),
  referenceNumber: statement?.paymentReference || '',
});

const renderTemplateString = (template = '', payload = {}) => {
  const missing = [];
  const rendered = String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const rawValue = payload[key];
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      missing.push(key);
      return '—';
    }
    return String(rawValue);
  });

  return {
    rendered,
    missingPlaceholders: unique(missing),
  };
};

const getEmailTemplateByKey = (key = '') => EMAIL_TEMPLATE_DEFINITIONS.find((template) => template.key === key) || null;

const resolveRelevantSmsTemplates = (company = {}, contextType = '') => {
  const allowedKeys = new Set(SMS_ALLOWED_TEMPLATE_KEYS[contextType] || []);
  const smsProfiles = getRawSmsProfiles(company?.communication || {});
  return mergeSmsTemplatesWithDefaults(company?.communication?.smsTemplates || [], smsProfiles)
    .filter((template) => allowedKeys.has(String(template?.key || '')))
    .map((template) => ({
      ...template,
      channel: 'sms',
      isConfigured: Boolean(template?.enabled),
    }));
};

const resolveRelevantEmailTemplates = (contextType = '') => {
  const allowedKeys = new Set(EMAIL_ALLOWED_TEMPLATE_KEYS[contextType] || []);
  return EMAIL_TEMPLATE_DEFINITIONS.filter((template) => allowedKeys.has(template.key)).map((template) => ({
    ...template,
    channel: 'email',
    enabled: true,
  }));
};

export const getCommunicationPermissionTarget = (contextType = '') => CONTEXT_PERMISSION_MAP[contextType] || null;

export const getAvailableTemplates = async ({ businessId, contextType = '' }) => {
  const company = await Company.findById(businessId)
    .select('companyName name email phoneNo baseCurrency modules communication')
    .lean();

  if (!company) {
    const error = new Error('Company not found for communications.');
    error.statusCode = 404;
    throw error;
  }

  const emailProfiles = getRawEmailProfiles(company.communication || {});
  const smsProfiles = getRawSmsProfiles(company.communication || {});
  const primaryEmailProfile = getPrimaryEmailProfile(emailProfiles, company?.communication?.defaultEmailProfileId || null);
  const primarySmsProfile = getPrimarySmsProfile(smsProfiles, company?.communication?.defaultSmsProfileId || null);

  return {
    company,
    contextType,
    channels: {
      sms: {
        profileStatus: primarySmsProfile
          ? buildSmsProfileStatus({ ...primarySmsProfile, hasApiKey: Boolean(primarySmsProfile?.apiKeyEncrypted) })
          : null,
        templates: resolveRelevantSmsTemplates(company, contextType),
      },
      email: {
        profileStatus: primaryEmailProfile
          ? buildEmailProfileStatus({ ...primaryEmailProfile, hasPassword: Boolean(primaryEmailProfile?.passwordEncrypted) })
          : null,
        templates: resolveRelevantEmailTemplates(contextType),
      },
    },
  };
};

const ensureCompany = async (businessId) => {
  const company = await Company.findById(businessId)
    .select('companyName name email phoneNo baseCurrency communication modules')
    .lean();

  if (!company) {
    const error = new Error('Company not found for communications.');
    error.statusCode = 404;
    throw error;
  }

  return company;
};

const loadTenantRecords = async (ids = [], businessId) => {
  const rows = await Tenant.find({ _id: { $in: ids }, business: businessId })
    .populate({ path: 'unit', select: 'unitNumber property', populate: { path: 'property', select: 'propertyName' } })
    .lean();

  return rows.map((tenant) => ({
    recordId: String(tenant._id),
    payload: buildTenantBulkPayload({
      tenant,
      property: tenant?.unit?.property,
      unit: tenant?.unit,
      company: null,
      channel: 'sms',
    }),
    recipientName: getTenantDisplayName(tenant),
    recipientPhone: tenant?.phone || '',
    recipientEmail: tenant?.email || '',
    tenant,
    property: tenant?.unit?.property || null,
    unit: tenant?.unit || null,
  }));
};

const loadLandlordRecords = async (ids = [], businessId) => {
  const rows = await Landlord.find({ _id: { $in: ids }, company: businessId }).lean();
  return rows.map((landlord) => ({
    recordId: String(landlord._id),
    payload: buildLandlordBulkPayload({ landlord, company: null, channel: 'sms' }),
    recipientName: getLandlordDisplayName(landlord),
    recipientPhone: landlord?.phoneNumber || '',
    recipientEmail: landlord?.email || '',
    landlord,
  }));
};

const loadProcessedStatementRecords = async (ids = [], businessId) => {
  const rows = await ProcessedStatement.find({ _id: { $in: ids }, business: businessId })
    .populate('landlord', 'landlordName email phoneNumber landlordCode')
    .populate('property', 'propertyName propertyCode')
    .lean();

  return rows.map((statement) => ({
    recordId: String(statement._id),
    payload: buildProcessedStatementPayload({ statement, company: null, channel: 'sms' }),
    recipientName: getLandlordDisplayName(statement?.landlord),
    recipientPhone: statement?.landlord?.phoneNumber || '',
    recipientEmail: statement?.landlord?.email || '',
    statement,
  }));
};

const loadReceiptRecords = async (ids = [], businessId) => {
  const rows = await RentPayment.find({ _id: { $in: ids }, business: businessId })
    .populate('tenant', 'name email phone tenantCode')
    .populate({ path: 'unit', select: 'unitNumber property', populate: { path: 'property', select: 'propertyName propertyCode' } })
    .lean();

  return rows.map((receipt) => ({
    recordId: String(receipt._id),
    payload: buildReceiptPayload({
      receipt,
      tenant: receipt?.tenant,
      property: receipt?.unit?.property,
      unit: receipt?.unit,
      company: null,
      channel: 'sms',
    }),
    recipientName: getTenantDisplayName(receipt?.tenant),
    recipientPhone: receipt?.tenant?.phone || '',
    recipientEmail: receipt?.tenant?.email || '',
    receipt,
  }));
};

const loadInvoiceRecords = async (ids = [], businessId) => {
  const rows = await TenantInvoice.find({ _id: { $in: ids }, business: businessId })
    .populate('tenant', 'name email phone tenantCode rent')
    .populate('property', 'propertyName propertyCode')
    .populate('unit', 'unitNumber')
    .lean();

  return rows.map((invoice) => ({
    recordId: String(invoice._id),
    payload: buildInvoicePayload({
      invoice,
      tenant: invoice?.tenant,
      property: invoice?.property,
      unit: invoice?.unit,
      company: null,
      channel: 'sms',
    }),
    recipientName: getTenantDisplayName(invoice?.tenant),
    recipientPhone: invoice?.tenant?.phone || '',
    recipientEmail: invoice?.tenant?.email || '',
    invoice,
  }));
};

const loadMeterReadingRecords = async (ids = [], businessId) => {
  const rows = await MeterReading.find({ _id: { $in: ids }, business: businessId })
    .populate('tenant', 'name email phone tenantCode')
    .populate('property', 'propertyName propertyCode')
    .populate('unit', 'unitNumber')
    .lean();

  return rows.map((reading) => ({
    recordId: String(reading._id),
    payload: buildMeterReadingPayload({
      reading,
      tenant: reading?.tenant,
      property: reading?.property,
      unit: reading?.unit,
      company: null,
      channel: 'sms',
    }),
    recipientName: getTenantDisplayName(reading?.tenant),
    recipientPhone: reading?.tenant?.phone || '',
    recipientEmail: reading?.tenant?.email || '',
    reading,
  }));
};

const loadLandlordPaymentRecords = async (ids = [], businessId) => {
  const rows = await ProcessedStatement.find({ _id: { $in: ids }, business: businessId })
    .populate('landlord', 'landlordName email phoneNumber landlordCode')
    .populate('property', 'propertyName propertyCode')
    .lean();

  return rows.map((statement) => ({
    recordId: String(statement._id),
    payload: buildLandlordPaymentPayload({ statement, company: null, channel: 'sms' }),
    recipientName: getLandlordDisplayName(statement?.landlord),
    recipientPhone: statement?.landlord?.phoneNumber || '',
    recipientEmail: statement?.landlord?.email || '',
    statement,
  }));
};

const CONTEXT_LOADERS = {
  landlord_bulk: loadLandlordRecords,
  tenant_bulk: loadTenantRecords,
  processed_statement: loadProcessedStatementRecords,
  receipt: loadReceiptRecords,
  invoice: loadInvoiceRecords,
  meter_reading: loadMeterReadingRecords,
  penalty_invoice: loadInvoiceRecords,
  landlord_payment: loadLandlordPaymentRecords,
};

const resolveChannelTemplate = ({ company, contextType, channel, templateKey }) => {
  if (channel === 'sms') {
    const template = resolveRelevantSmsTemplates(company, contextType).find((item) => item.key === templateKey);
    if (!template) {
      const error = new Error('SMS template not found or not allowed in this page context.');
      error.statusCode = 404;
      throw error;
    }
    return template;
  }

  const template = resolveRelevantEmailTemplates(contextType).find((item) => item.key === templateKey);
  if (!template) {
    const error = new Error('Email template not found or not allowed in this page context.');
    error.statusCode = 404;
    throw error;
  }
  return template;
};

const resolveSmsProfile = ({ company, template, requestedProfileId = '' }) => {
  const profiles = getRawSmsProfiles(company.communication || {});
  const requestedId = normalizeText(requestedProfileId || template?.profileId || '');
  const selected = requestedId
    ? profiles.find((profile) => String(profile?._id || '') === requestedId)
    : getPrimarySmsProfile(profiles, company?.communication?.defaultSmsProfileId || null);

  if (!selected) return { profile: null, status: null };
  return {
    profile: selected,
    status: buildSmsProfileStatus({ ...selected, hasApiKey: Boolean(selected?.apiKeyEncrypted) }),
  };
};

const resolveEmailProfile = ({ company, requestedProfileId = '' }) => {
  const profiles = getRawEmailProfiles(company.communication || {});
  const requestedId = normalizeText(requestedProfileId || '');
  const selected = requestedId
    ? profiles.find((profile) => String(profile?._id || '') === requestedId)
    : getPrimaryEmailProfile(profiles, company?.communication?.defaultEmailProfileId || null);

  if (!selected) return { profile: null, status: null };
  return {
    profile: selected,
    status: buildEmailProfileStatus({ ...selected, hasPassword: Boolean(selected?.passwordEncrypted) }),
  };
};

const buildRecordPreview = ({ company, channel, template, record, profileStatus }) => {
  const payload = {
    ...record.payload,
    ...buildCommonPayload({ company, channel }),
  };

  const bodyRendered = renderTemplateString(template?.messageBody || template?.body || '', payload);
  const subjectRendered = channel === 'email' ? renderTemplateString(template?.subject || '', payload) : { rendered: '', missingPlaceholders: [] };
  const missing = unique([...(bodyRendered.missingPlaceholders || []), ...(subjectRendered.missingPlaceholders || [])]);

  const normalizedPhone = normalizePhoneNumber(record?.recipientPhone || payload.phoneNumber || '', profileStatus?.profile?.defaultCountryCode || '+254');
  const normalizedEmail = normalizeText(record?.recipientEmail || payload.email || '').toLowerCase();

  let canSend = true;
  let reason = '';

  if (missing.length > 0) {
    canSend = false;
    reason = `Missing data: ${missing.join(', ')}`;
  }

  if (channel === 'sms' && !normalizedPhone) {
    canSend = false;
    reason = reason || 'Recipient phone number is missing.';
  }

  if (channel === 'email' && !normalizedEmail) {
    canSend = false;
    reason = reason || 'Recipient email address is missing.';
  }

  return {
    recordId: record.recordId,
    recipientName: record.recipientName,
    recipientPhone: normalizedPhone,
    recipientEmail: normalizedEmail,
    subject: subjectRendered.rendered,
    body: bodyRendered.rendered,
    htmlBody: channel === 'email' ? buildEmailHtml({ companyName: payload.companyName, subject: subjectRendered.rendered, body: bodyRendered.rendered }) : '',
    missingPlaceholders: missing,
    canSend,
    reason,
    payload,
  };
};

export const previewCommunication = async ({ businessId, contextType, channel, templateKey, recordIds = [], profileId = '', customBody = '', customSubject = '' }) => {
  const loader = CONTEXT_LOADERS[contextType];
  if (!loader) {
    const error = new Error('Unsupported communication context.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedIds = unique(recordIds);
  if (normalizedIds.length === 0) {
    const error = new Error('Select at least one record before previewing communication.');
    error.statusCode = 400;
    throw error;
  }

  const company = await ensureCompany(businessId);
  const template = resolveChannelTemplate({ company, contextType, channel, templateKey });
  const effectiveTemplate = {
    ...template,
    ...(normalizeText(customBody)    ? { messageBody: customBody, body: customBody } : {}),
    ...(normalizeText(customSubject) ? { subject: customSubject } : {}),
  };
  const loaded = await loader(normalizedIds, businessId);
  const previews = [];

  const profileResolution = channel === 'sms'
    ? resolveSmsProfile({ company, template, requestedProfileId: profileId })
    : resolveEmailProfile({ company, requestedProfileId: profileId });

  const profile = profileResolution.profile;
  const profileStatus = profileResolution.status;
  const sendingAvailable = channel === 'sms'
    ? Boolean(profile && profileStatus?.isConfigured && profile?.enabled)
    : Boolean(profile && profileStatus?.isConfigured && profile?.enabled);

  for (const record of loaded) {
    previews.push(buildRecordPreview({
      company,
      channel,
      template: effectiveTemplate,
      record,
      profileStatus: { ...profileStatus, profile },
    }));
  }

  const summary = {
    totalRecipients: previews.length,
    sendableCount: previews.filter((item) => item.canSend).length,
    blockedCount: previews.filter((item) => !item.canSend).length,
  };

  return {
    company,
    contextType,
    channel,
    template: {
      key: template.key,
      name: template.name,
      description: template.description,
      subject: template.subject || '',
      messageBody: template.messageBody || template.body || '',
    },
    senderProfile: profile
      ? {
          _id: String(profile?._id || ''),
          name: profile?.name || '',
          enabled: Boolean(profile?.enabled),
          status: profileStatus?.code || '',
          statusLabel: profileStatus?.label || '',
          statusReason: profileStatus?.reason || '',
          sendingAvailable,
        }
      : null,
    previews,
    summary,
  };
};

const sendSmsViaCustomHttp = async ({ profile, to, body }) => {
  const callbackUrl = normalizeText(profile?.callbackUrl);
  if (!callbackUrl) {
    throw new Error('Custom HTTP SMS profile is missing a callback URL.');
  }

  const apiKey = decryptStoredSecret(profile?.apiKeyEncrypted || '');
  const apiSecret = decryptStoredSecret(profile?.apiSecretEncrypted || '');
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (apiSecret) headers['X-Api-Secret'] = apiSecret;

  const response = await axios.post(callbackUrl, {
    to,
    message: body,
    senderId: profile?.senderId || '',
    username: profile?.accountUsername || '',
  }, { headers, timeout: 30000 });

  const data = response?.data || {};
  return {
    messageId: String(data.messageId || data.message_id || data.id || ''),
    status: String(data.status || 'dispatched'),
    cost: '',
  };
};

const sendSmsViaAfricasTalking = async ({ profile, to, body }) => {
  const apiKey = decryptStoredSecret(profile?.apiKeyEncrypted || '');
  if (!apiKey) {
    throw new Error("Africa's Talking API key is missing for this SMS profile.");
  }
  if (!profile?.accountUsername) {
    throw new Error("Africa's Talking username is missing for this SMS profile.");
  }

  const baseUrl = profile?.useSandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';

  const params = new URLSearchParams();
  params.append('username', profile.accountUsername);
  params.append('to', to);
  params.append('message', body);
  if (profile?.senderId) params.append('from', profile.senderId);

  const response = await axios.post(baseUrl, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      apiKey,
    },
    timeout: 30000,
  });

  const smsData = response?.data?.SMSMessageData;
  if (!smsData) {
    throw new Error(`Africa's Talking: unexpected response — ${JSON.stringify(response?.data || {})}`);
  }

  const recipients = smsData.Recipients || [];
  if (!recipients.length) {
    // AT puts a human-readable reason in smsData.Message when no recipients are processed
    const reason = smsData.Message || 'No recipients processed';
    throw new Error(`Africa's Talking: ${reason}`);
  }

  const first = recipients[0];
  const atStatus = String(first.status || '');
  if (atStatus.toLowerCase() !== 'success') {
    throw new Error(`Africa's Talking: message rejected — ${atStatus || 'unknown status'}`);
  }

  return {
    messageId: String(first.messageId || ''),
    status: atStatus,
    cost: String(first.cost || ''),
  };
};

// Africa's Talking "Send to Hashed/Masked Number" — uses the /bulk endpoint.
// maskedNumber = the hashed MSISDN from Safaricom's C2B callback when the real
// phone is withheld. AT routes the message to the payer's Safaricom number
// without us ever knowing the real digits.
// Requires JSON body with phoneNumbers: [] + maskedNumber + telco per AT spec.
const sendSmsViaAfricasTalkingMasked = async ({ profile, maskedNumber, body }) => {
  const apiKey = decryptStoredSecret(profile?.apiKeyEncrypted || '');
  if (!apiKey) throw new Error("Africa's Talking API key is missing for masked SMS.");
  if (!profile?.accountUsername) throw new Error("Africa's Talking username is missing for masked SMS.");

  const baseUrl = profile?.useSandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging/bulk'
    : 'https://api.africastalking.com/version1/messaging/bulk';

  const payload = {
    username:     profile.accountUsername,
    message:      body,
    maskedNumber,
    telco:        'Safaricom',
    phoneNumbers: [],
  };
  if (profile?.senderId) payload.senderId = profile.senderId;

  const response = await axios.post(baseUrl, payload, {
    headers: {
      'Content-Type': 'application/json',
      Accept:         'application/json',
      apiKey,
    },
    timeout: 30000,
  });

  console.log('[AT Masked SMS] Raw response:', JSON.stringify(response.data, null, 2));

  const smsData = response?.data?.SMSMessageData;
  if (!smsData) throw new Error(`Africa's Talking masked bulk: unexpected response — ${JSON.stringify(response?.data || {})}`);

  const first = (smsData.Recipients || [])[0];
  return {
    messageId: String(first?.messageId || ''),
    status: String(first?.status || smsData.Message || 'dispatched'),
    cost: String(first?.cost || ''),
  };
};

const sendSmsViaTwilio = async ({ profile, to, body }) => {
  const accountSid = normalizeText(profile?.accountUsername);
  const authToken = decryptStoredSecret(profile?.apiKeyEncrypted || '');
  const from = normalizeText(profile?.senderId);

  if (!accountSid || !authToken || !from) {
    throw new Error('Twilio SMS profile is incomplete. Save the account SID, auth token and sender number first.');
  }

  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', from);
  params.append('Body', body);

  const response = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    params.toString(),
    {
      auth: { username: accountSid, password: authToken },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
    }
  );

  const data = response?.data || {};
  return {
    messageId: String(data.sid || ''),
    status: String(data.status || ''),
    cost: '',
  };
};

const sendSmsViaMtech = async ({ profile, to, body }) => {
  const apiKey = decryptStoredSecret(profile?.apiKeyEncrypted || '');
  if (!apiKey) {
    throw new Error('MTech API key is missing for this SMS profile.');
  }

  const senderId = normalizeText(profile?.senderId);
  if (!senderId) {
    throw new Error('MTech Sender ID is missing for this SMS profile.');
  }

  // MTech API endpoint must be set explicitly in the profile's Endpoint URL field.
  // Different MTech accounts may use different base URLs — there is no single universal default.
  const endpoint = normalizeText(profile?.callbackUrl);
  if (!endpoint) {
    throw new Error('MTech endpoint URL is required. Enter your MTech API endpoint in the SMS profile Endpoint URL field (e.g. https://your-mtech-url/api/sms/send).');
  }

  const username = normalizeText(profile?.accountUsername);
  const apiSecret = decryptStoredSecret(profile?.apiSecretEncrypted || '');

  // MTech API implementations vary — cover all common authentication patterns:
  // 1. Bearer token in Authorization header (most common for REST APIs)
  // 2. apiKey in JSON body
  // 3. username + password in JSON body (some MTech setups use this)
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'apiKey': apiKey,
  };

  const requestBody = {
    apiKey,
    senderId,
    sender: senderId,
    mobile: to,
    mobileNumber: to,
    message: body,
  };

  if (username) {
    requestBody.username = username;
    // Some MTech setups authenticate with username + apiKey-as-password
    requestBody.password = apiSecret || apiKey;
  }

  const response = await axios.post(endpoint, requestBody, {
    headers,
    timeout: 30000,
  });

  const data = response?.data || {};

  // Surface explicit failure responses from MTech
  if (data.success === false || safeLower(String(data.status || '')) === 'failed') {
    const errMsg = data.description || data.message || data.error || data.errorMessage || 'MTech SMS rejected.';
    throw new Error(errMsg);
  }

  return {
    messageId: String(data.messageId || data.message_id || data.id || data.msgId || ''),
    status: String(data.status || (data.success ? 'success' : 'dispatched')),
    cost: String(data.cost || data.balance || ''),
  };
};

const dispatchSms = async ({ profile, to, body }) => {
  const provider = safeLower(profile?.provider || 'generic');
  if (provider === 'africas_talking') return sendSmsViaAfricasTalking({ profile, to, body });
  if (provider === 'twilio') return sendSmsViaTwilio({ profile, to, body });
  if (provider === 'mtech') return sendSmsViaMtech({ profile, to, body });
  if (provider === 'custom_http' || normalizeText(profile?.callbackUrl)) {
    return sendSmsViaCustomHttp({ profile, to, body });
  }
  throw new Error('The selected SMS provider is not configured for live dispatch yet.');
};

const dispatchEmail = async ({ profile, to, subject, text, html, attachments }) => {
  const transporter = buildCompanySmtpTransporter(profile);
  await transporter.sendMail({
    from: resolveCompanyMailSender(profile),
    to,
    subject,
    text,
    html,
    replyTo: profile?.replyTo || undefined,
    ...(attachments?.length ? { attachments } : {}),
    ...buildCompanyInternalCopyRecipients(profile),
  });
};

// Concurrency limit for parallel sends — keeps SMTP server happy
const SEND_BATCH_SIZE = 8;
// Per-send timeout (ms) — prevents one slow connection blocking a batch
const SEND_TIMEOUT_MS = 25_000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Send timed out after ${ms}ms (${label})`)), ms)),
  ]);

const buildLogEntry = ({ businessId, channel, contextType, templateKey, preview, profile, item, status, providerResult = {}, error = '' }) => ({
  business: businessId,
  channel,
  contextType,
  templateKey,
  templateName: preview.template?.name || '',
  profileName: profile?.name || '',
  provider: profile?.provider || '',
  to: channel === 'sms' ? item.recipientPhone : item.recipientEmail,
  recipientName: item.recipientName,
  body: item.body,
  subject: item.subject || '',
  status,
  error,
  providerMessageId: providerResult.messageId || '',
  providerStatus: providerResult.status || '',
  costLabel: providerResult.cost || '',
  recordId: item.recordId,
});

// Pre-generate all PDFs in parallel before the send loop so each email
// doesn't block waiting for its own Puppeteer render.
const preBuildAttachments = async ({ contextType, items, businessId }) => {
  const cache = new Map();
  const sendableIds = items.filter((i) => i.canSend).map((i) => i.recordId);
  if (!sendableIds.length) return cache;

  if (contextType === 'processed_statement') {
    const statements = await ProcessedStatement.find({ _id: { $in: sendableIds }, business: businessId })
      .select('sourceStatement property periodStart')
      .populate('property', 'propertyCode propertyName')
      .lean();
    const stmtMap = new Map(statements.map((s) => [String(s._id), s]));

    await Promise.allSettled(sendableIds.map(async (id) => {
      const ps = stmtMap.get(String(id));
      const sourceStatementId = String(ps?.sourceStatement || '');
      if (!sourceStatementId) return;
      try {
        const pdfBuffer = await generateStatementPdf(sourceStatementId, businessId);
        const propertyCode = ps?.property?.propertyCode || 'STMT';
        const periodLabel = ps?.periodStart
          ? new Date(ps.periodStart).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).replace(' ', '-')
          : 'statement';
        cache.set(String(id), [{ filename: `Statement-${propertyCode}-${periodLabel}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]);
      } catch { /* best-effort */ }
    }));
  }

  if (contextType === 'invoice' || contextType === 'penalty_invoice') {
    await Promise.allSettled(sendableIds.map(async (id) => {
      try {
        const pdfBuffer = await generateInvoicePdf(id, businessId);
        const item = items.find((i) => i.recordId === id);
        const invoiceNum = item?.payload?.invoiceNumber || String(id);
        cache.set(String(id), [{ filename: `Invoice-${invoiceNum}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]);
      } catch { /* best-effort */ }
    }));
  }

  if (contextType === 'receipt') {
    await Promise.allSettled(sendableIds.map(async (id) => {
      try {
        const pdfBuffer = await generateReceiptPdf(id, businessId);
        const item = items.find((i) => i.recordId === id);
        const receiptNum = item?.payload?.receiptNumber || String(id);
        cache.set(String(id), [{ filename: `Receipt-${receiptNum}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]);
      } catch { /* best-effort */ }
    }));
  }

  return cache;
};

export const sendCommunication = async ({ businessId, contextType, channel, templateKey, recordIds = [], profileId = '', customBody = '', customSubject = '' }) => {
  const preview = await previewCommunication({ businessId, contextType, channel, templateKey, recordIds, profileId, customBody, customSubject });
  const results = [];

  if (!preview.senderProfile?.sendingAvailable) {
    const failResults = preview.previews.map((item) => ({
      recordId: item.recordId,
      recipientName: item.recipientName,
      status: 'failed',
      messageId: '',
      cost: '',
      message: preview.senderProfile?.statusReason || `No active ${channel.toUpperCase()} profile is available for this company.`,
    }));

    await Promise.allSettled(failResults.map((item) =>
      SmsLog.create({
        business: businessId,
        channel,
        contextType,
        templateKey,
        templateName: preview.template?.name || '',
        profileName: preview.senderProfile?.name || '',
        provider: preview.senderProfile?.provider || '',
        to: preview.previews.find((p) => p.recordId === item.recordId)?.recipientPhone || '',
        recipientName: item.recipientName,
        body: preview.previews.find((p) => p.recordId === item.recordId)?.body || '',
        status: 'failed',
        error: item.message,
        recordId: item.recordId,
      }).catch(() => {})
    ));

    return {
      ...preview,
      summary: { ...preview.summary, sentCount: 0, failedCount: preview.previews.length },
      results: failResults,
    };
  }

  const company = preview.company;
  const template = resolveChannelTemplate({ company, contextType, channel, templateKey });
  const profileResolution = channel === 'sms'
    ? resolveSmsProfile({ company, template, requestedProfileId: profileId })
    : resolveEmailProfile({ company, requestedProfileId: profileId });
  const profile = profileResolution.profile;

  // Pre-generate all PDFs in parallel before entering the send loop
  const attachmentCache = channel === 'email'
    ? await preBuildAttachments({ contextType, items: preview.previews, businessId })
    : new Map();

  // Bulk contexts send one message per contact regardless of how many records they have.
  // Per-record contexts (invoice, receipt, etc.) intentionally send one message per record
  // even if the same tenant appears multiple times — each message has unique content.
  const BULK_CONTEXTS = new Set(['tenant_bulk', 'landlord_bulk']);
  const deduplicateByAddress = BULK_CONTEXTS.has(contextType);
  const seenAddresses = new Set();

  // Process in parallel batches to avoid sequential SMTP delays
  const sendable = preview.previews;
  for (let i = 0; i < sendable.length; i += SEND_BATCH_SIZE) {
    const batch = sendable.slice(i, i + SEND_BATCH_SIZE);

    await Promise.allSettled(batch.map(async (item) => {
      if (!item.canSend) {
        results.push({ recordId: item.recordId, recipientName: item.recipientName, status: 'failed', messageId: '', cost: '', message: item.reason || 'Not sendable.' });
        SmsLog.create(buildLogEntry({ businessId, channel, contextType, templateKey, preview, profile, item, status: 'failed', error: item.reason || 'Blocked' })).catch(() => {});
        return;
      }

      const dest = channel === 'sms' ? (item.recipientPhone || '') : (item.recipientEmail || '');
      if (!dest || (deduplicateByAddress && seenAddresses.has(dest))) {
        results.push({ recordId: item.recordId, recipientName: item.recipientName, status: 'failed', messageId: '', cost: '', message: !dest ? 'No recipient address.' : 'Duplicate recipient — skipped.' });
        SmsLog.create(buildLogEntry({ businessId, channel, contextType, templateKey, preview, profile, item, status: 'failed', error: !dest ? 'No address' : 'Duplicate' })).catch(() => {});
        return;
      }
      if (deduplicateByAddress) seenAddresses.add(dest);

      try {
        let providerResult = { messageId: '', status: '', cost: '' };

        if (channel === 'sms') {
          providerResult = (await withTimeout(
            dispatchSms({ profile, to: item.recipientPhone, body: item.body }),
            SEND_TIMEOUT_MS,
            item.recipientName
          )) || {};
        } else {
          await withTimeout(
            dispatchEmail({
              profile,
              to: item.recipientEmail,
              subject: item.subject,
              text: item.body,
              html: item.htmlBody,
              attachments: attachmentCache.get(String(item.recordId)) || [],
            }),
            SEND_TIMEOUT_MS,
            item.recipientEmail
          );
        }

        SmsLog.create(buildLogEntry({ businessId, channel, contextType, templateKey, preview, profile, item, status: 'sent', providerResult })).catch(() => {});
        results.push({ recordId: item.recordId, recipientName: item.recipientName, status: 'sent', messageId: providerResult.messageId || '', cost: providerResult.cost || '', message: `${channel.toUpperCase()} sent.` });
      } catch (error) {
        const errMsg = error?.response?.data?.message || error?.message || `Failed to send ${channel.toUpperCase()}.`;
        SmsLog.create(buildLogEntry({ businessId, channel, contextType, templateKey, preview, profile, item, status: 'failed', error: errMsg })).catch(() => {});
        results.push({ recordId: item.recordId, recipientName: item.recipientName, status: 'failed', messageId: '', cost: '', message: errMsg });
      }
    }));
  }

  return {
    ...preview,
    summary: {
      ...preview.summary,
      sentCount: results.filter((item) => item.status === 'sent').length,
      failedCount: results.filter((item) => item.status !== 'sent').length,
    },
    results,
  };
};

/**
 * Send a one-off SMS to a specific phone number using the company's default SMS profile.
 * Used by modules that compose their own message bodies (e.g. loyalty, alerts).
 */
export const sendAdHocSms = async ({ businessId, phone, body, templateKey = 'adhoc', recipientName = '' } = {}) => {
  if (!phone || !body) return null;
  try {
    const company = await ensureCompany(businessId);
    const profiles = getRawSmsProfiles(company.communication || {});
    const profile = getPrimarySmsProfile(profiles, company.communication?.defaultSmsProfileId || null);
    if (!profile?.enabled) return null;

    const result = await dispatchSms({ profile, to: phone, body });

    await SmsLog.create({
      business: businessId,
      channel: 'sms',
      templateKey,
      to: phone,
      recipientName,
      body,
      status: result?.messageId ? 'sent' : 'failed',
      providerMessageId: result?.messageId || '',
      providerStatus: result?.status || '',
      costLabel: result?.cost || '',
      provider: profile?.provider || 'generic',
      sentAt: new Date(),
    }).catch(() => {});

    return result;
  } catch (err) {
    console.error('[SMS] sendAdHocSms failed phone=%s template=%s: %s', phone, templateKey, err?.message || err);
    SmsLog.create({
      business: businessId,
      channel: 'sms',
      templateKey,
      to: phone,
      recipientName,
      body,
      status: 'failed',
      error: String(err?.message || 'Unknown error').slice(0, 500),
      provider: 'unknown',
      sentAt: new Date(),
    }).catch(() => {});
    return null;
  }
};

/**
 * Send an SMS to a masked/hashed M-Pesa number via Africa's Talking bulk endpoint.
 * Only works when the default SMS profile is Africa's Talking.
 * maskedNumber = raw hashed MSISDN string from Safaricom C2B callback.
 */
export const sendAdHocSmsToMasked = async ({ businessId, maskedNumber, body, templateKey = 'adhoc_masked', recipientName = '' } = {}) => {
  if (!maskedNumber || !body) return null;
  try {
    const company = await ensureCompany(businessId);
    const profiles = getRawSmsProfiles(company.communication || {});
    const profile = getPrimarySmsProfile(profiles, company.communication?.defaultSmsProfileId || null);
    if (!profile?.enabled || safeLower(profile?.provider) !== 'africas_talking') return null;

    const result = await sendSmsViaAfricasTalkingMasked({ profile, maskedNumber, body });

    await SmsLog.create({
      business: businessId,
      channel: 'sms',
      templateKey,
      to: `masked:${maskedNumber}`,
      recipientName,
      body,
      status: 'sent',
      providerMessageId: result?.messageId || '',
      providerStatus: result?.status || '',
      costLabel: result?.cost || '',
      provider: 'africas_talking',
      sentAt: new Date(),
    }).catch(() => {});

    return result;
  } catch (err) {
    console.error('[SMS] sendAdHocSmsToMasked failed maskedNumber=%s template=%s: %s', maskedNumber, templateKey, err?.message || err);
    if (err?.response?.data) console.error('[SMS] AT error body:', JSON.stringify(err.response.data, null, 2));
    SmsLog.create({
      business: businessId,
      channel: 'sms',
      templateKey,
      to: `masked:${maskedNumber}`,
      recipientName,
      body,
      status: 'failed',
      error: String(err?.message || 'Unknown error').slice(0, 500),
      provider: 'africas_talking',
      sentAt: new Date(),
    }).catch(() => {});
    return null;
  }
};

export const getSmsLogs = async ({ businessId, limit = 30, channel, contextType, status } = {}) => {
  const filter = { business: businessId };
  if (channel) filter.channel = channel;
  if (contextType) filter.contextType = contextType;
  if (status) filter.status = status;

  return SmsLog.find(filter)
    .sort({ sentAt: -1, createdAt: -1 })
    .limit(Math.min(100, Number(limit || 30)))
    .lean();
};

export const sendTestSms = async ({ businessId, phone, message, profileId = '' } = {}) => {
  const company = await ensureCompany(businessId);
  const profiles = getRawSmsProfiles(company.communication || {});
  const selectedProfile = normalizeText(profileId)
    ? profiles.find((p) => String(p._id) === normalizeText(profileId))
    : getPrimarySmsProfile(profiles, company.communication?.defaultSmsProfileId || null);

  if (!selectedProfile) {
    const error = new Error('No SMS profile configured for this company. Add one in Settings → Communications.');
    error.statusCode = 400;
    throw error;
  }

  const profileStatus = buildSmsProfileStatus({ ...selectedProfile, hasApiKey: Boolean(selectedProfile?.apiKeyEncrypted) });
  if (!profileStatus?.isConfigured || !selectedProfile?.enabled) {
    const error = new Error(profileStatus?.reason || 'SMS profile is not fully configured or is disabled.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedPhone = normalizePhoneNumber(normalizeText(phone), selectedProfile.defaultCountryCode || '+254');
  if (!normalizedPhone) {
    const error = new Error('A valid phone number is required for the test SMS.');
    error.statusCode = 400;
    throw error;
  }

  const testBody = String(message || 'This is a test SMS from Milik PMS. If you received this, your SMS profile is working correctly.').slice(0, 320);
  let providerResult = { messageId: '', status: '', cost: '' };
  let sendStatus = 'sent';
  let sendError = '';

  try {
    providerResult = (await dispatchSms({ profile: selectedProfile, to: normalizedPhone, body: testBody })) || {};
  } catch (err) {
    sendStatus = 'failed';
    sendError = err?.response?.data?.message || err?.message || 'Dispatch failed.';
  }

  await SmsLog.create({
    business: businessId,
    channel: 'sms',
    contextType: 'test',
    templateKey: 'test',
    templateName: 'Test SMS',
    profileName: selectedProfile.name || '',
    provider: selectedProfile.provider || '',
    to: normalizedPhone,
    recipientName: 'Test Recipient',
    body: testBody,
    status: sendStatus,
    providerMessageId: providerResult.messageId || '',
    providerStatus: providerResult.status || '',
    costLabel: providerResult.cost || '',
    error: sendError,
    isTest: true,
  }).catch(() => {});

  if (sendStatus === 'failed') {
    const error = new Error(sendError || 'Test SMS dispatch failed.');
    error.statusCode = 502;
    throw error;
  }

  return {
    success: true,
    to: normalizedPhone,
    messageId: providerResult.messageId || '',
    providerStatus: providerResult.status || '',
    cost: providerResult.cost || '',
    provider: selectedProfile.provider || '',
  };
};

export const sendAdHocEmail = async ({ businessId, to, subject, html, text } = {}) => {
  if (!to || !subject || (!html && !text)) return null;
  try {
    const company = await ensureCompany(businessId);
    const profiles = getRawEmailProfiles(company.communication || {});
    const profile  = getPrimaryEmailProfile(profiles, company.communication?.defaultEmailProfileId || null);
    if (!profile?.enabled) throw new Error("No active email profile configured");
    await dispatchEmail({ profile, to, subject, html, text });
    return { success: true };
  } catch (err) {
    console.error("[Email] sendAdHocEmail failed to=%s subject=%s: %s", to, subject, err?.message || err);
    throw err;
  }
};
