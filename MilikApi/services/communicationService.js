import axios from 'axios';
import Company from '../models/Company.js';
import Landlord from '../models/Landlord.js';
import MeterReading from '../models/MeterReading.js';
import ProcessedStatement from '../models/ProcessedStatement.js';
import Property from '../models/Property.js';
import RentPayment from '../models/RentPayment.js';
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
  landlord_bulk: ['landlord_notice_sms'],
  tenant_bulk: ['tenant_notice_sms'],
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
    subject: 'Receipt {receiptNumber} for {propertyName} Unit {unitNumber}',
    body:
      'Hello {tenantName},\n\nWe have received {amount} for {propertyName} Unit {unitNumber}.\nReceipt Number: {receiptNumber}\nReceipt Date: {paymentDate}\nPayment Method: {paymentMethod}\n\nRegards,\n{companyName}',
  },
  {
    key: 'invoice_email_tenant',
    name: 'Invoice Email',
    recipientType: 'tenant',
    description: 'Send a rental invoice email to the tenant.',
    subject: 'Invoice {invoiceNumber} for {propertyName} Unit {unitNumber}',
    body:
      'Hello {tenantName},\n\nYour invoice {invoiceNumber} for {propertyName} Unit {unitNumber} is {amountDue}.\nDue Date: {dueDate}\nInvoice Date: {invoiceDate}\n\nRegards,\n{companyName}',
  },
  {
    key: 'landlord_statement_ready_email',
    name: 'Landlord Statement Ready Email',
    recipientType: 'landlord',
    description: 'Notify the landlord that a processed statement is ready.',
    subject: 'Statement ready for {propertyName} - {statementPeriod}',
    body:
      'Hello {landlordName},\n\nYour statement for {propertyName} covering {statementPeriod} is ready for review.\nStatement Date: {statementDate}\nNet Amount Due: {netAmountDue}\n\nRegards,\n{companyName}',
  },
  {
    key: 'landlord_payment_email',
    name: 'Landlord Payment Email',
    recipientType: 'landlord',
    description: 'Confirm a landlord payment by email.',
    subject: 'Landlord payment confirmation - {propertyName}',
    body:
      'Hello {landlordName},\n\nA payment of {amount} has been recorded for {propertyName}.\nPayment Date: {paymentDate}\nReference: {referenceNumber}\n\nRegards,\n{companyName}',
  },
  {
    key: 'penalty_notice_email',
    name: 'Penalty Notice Email',
    recipientType: 'tenant',
    description: 'Send a late penalty invoice notice to the tenant.',
    subject: 'Penalty notice for invoice {invoiceNumber}',
    body:
      'Hello {tenantName},\n\nA penalty invoice {invoiceNumber} has been raised for {propertyName} Unit {unitNumber}.\nAmount Due: {amountDue}\nDue Date: {dueDate}\nSource Invoice: {sourceInvoiceNumber}\n\nRegards,\n{companyName}',
  },
  {
    key: 'meter_usage_notification_email',
    name: 'Meter / Usage Notification Email',
    recipientType: 'tenant',
    description: 'Send a utility usage notification to the affected tenant.',
    subject: '{utilityType} usage update for {propertyName} Unit {unitNumber}',
    body:
      'Hello {tenantName},\n\nYour {utilityType} reading for {propertyName} Unit {unitNumber} has been recorded.\nBilling Period: {billingPeriod}\nUnits Consumed: {unitsConsumed}\nCharge Amount: {amount}\nReading Date: {readingDate}\n\nRegards,\n{companyName}',
  },
];

const EMAIL_ALLOWED_TEMPLATE_KEYS = {
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
  email: landlord?.email || '',
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
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildProcessedStatementPayload = ({ statement, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getLandlordDisplayName(statement?.landlord),
  landlordName: getLandlordDisplayName(statement?.landlord),
  propertyName: getPropertyName(statement?.property),
  statementPeriod: `${formatDate(statement?.periodStart)} to ${formatDate(statement?.periodEnd)}`,
  statementDate: formatDate(statement?.closedAt || statement?.createdAt),
  statementNumber: statement?.sourceStatementNumber || statement?.sourceStatement?._id || statement?._id || '',
  netAmountDue: formatCurrency(statement?.netAmountDue || 0, company?.baseCurrency || 'KES'),
  amount: formatCurrency(statement?.netAmountDue || 0, company?.baseCurrency || 'KES'),
});

const buildReceiptPayload = ({ receipt, tenant, property, unit, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getTenantDisplayName(tenant),
  tenantName: getTenantDisplayName(tenant),
  propertyName: getPropertyName(property),
  unitNumber: getUnitNumber(unit),
  amount: formatCurrency(receipt?.amount || 0, company?.baseCurrency || 'KES'),
  receiptNumber: receipt?.receiptNumber || '',
  paymentDate: formatDate(receipt?.paymentDate || receipt?.createdAt),
  paymentMethod: normalizeText(receipt?.paymentMethod || receipt?.method || ''),
  referenceNumber: receipt?.reference || receipt?.transactionId || receipt?.mpesaReceiptNumber || '',
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildInvoicePayload = ({ invoice, tenant, property, unit, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getTenantDisplayName(tenant),
  tenantName: getTenantDisplayName(tenant),
  propertyName: getPropertyName(property),
  unitNumber: getUnitNumber(unit),
  invoiceNumber: invoice?.invoiceNumber || '',
  amountDue: formatCurrency(invoice?.netAmount ?? invoice?.adjustedAmount ?? invoice?.amount ?? 0, company?.baseCurrency || 'KES'),
  dueDate: formatDate(invoice?.dueDate),
  invoiceDate: formatDate(invoice?.invoiceDate || invoice?.createdAt),
  sourceInvoiceNumber: invoice?.metadata?.penaltySourceInvoiceNumber || invoice?.sourceInvoiceNumber || '',
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildMeterReadingPayload = ({ reading, tenant, property, unit, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getTenantDisplayName(tenant),
  tenantName: getTenantDisplayName(tenant),
  propertyName: getPropertyName(property),
  unitNumber: getUnitNumber(unit),
  utilityType: reading?.utilityType || '',
  billingPeriod: reading?.billingPeriod || '',
  readingDate: formatDate(reading?.readingDate),
  previousReading: Number(reading?.previousReading || 0).toLocaleString('en-KE'),
  currentReading: Number(reading?.currentReading || 0).toLocaleString('en-KE'),
  unitsConsumed: Number(reading?.unitsConsumed || 0).toLocaleString('en-KE'),
  amount: formatCurrency(reading?.amount || 0, company?.baseCurrency || 'KES'),
  email: tenant?.email || '',
  phoneNumber: tenant?.phone || '',
});

const buildLandlordPaymentPayload = ({ statement, company, channel }) => ({
  ...buildCommonPayload({ company, channel }),
  recipientName: getLandlordDisplayName(statement?.landlord),
  landlordName: getLandlordDisplayName(statement?.landlord),
  propertyName: getPropertyName(statement?.property),
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
    .populate('tenant', 'name email phone tenantCode')
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

export const previewCommunication = async ({ businessId, contextType, channel, templateKey, recordIds = [], profileId = '' }) => {
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
      template,
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
  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (apiSecret) headers['X-Api-Secret'] = apiSecret;

  await axios.post(callbackUrl, {
    to,
    message: body,
    senderId: profile?.senderId || '',
    username: profile?.accountUsername || '',
  }, { headers, timeout: 30000 });
};

const sendSmsViaAfricasTalking = async ({ profile, to, body }) => {
  const apiKey = decryptStoredSecret(profile?.apiKeyEncrypted || '');
  if (!apiKey) {
    throw new Error('Africa\'s Talking API key is missing for this SMS profile.');
  }

  const params = new URLSearchParams();
  params.append('username', profile?.accountUsername || '');
  params.append('to', to);
  params.append('message', body);
  if (profile?.senderId) params.append('from', profile.senderId);

  await axios.post('https://api.africastalking.com/version1/messaging', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      apiKey,
    },
    timeout: 30000,
  });
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

  await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, params.toString(), {
    auth: {
      username: accountSid,
      password: authToken,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 30000,
  });
};

const dispatchSms = async ({ profile, to, body }) => {
  const provider = safeLower(profile?.provider || 'generic');
  if (provider === 'africas_talking') return sendSmsViaAfricasTalking({ profile, to, body });
  if (provider === 'twilio') return sendSmsViaTwilio({ profile, to, body });
  if (provider === 'custom_http' || normalizeText(profile?.callbackUrl)) {
    return sendSmsViaCustomHttp({ profile, to, body });
  }
  throw new Error('The selected SMS provider is not configured for live dispatch yet.');
};

const dispatchEmail = async ({ profile, to, subject, text, html }) => {
  const transporter = buildCompanySmtpTransporter(profile);
  await transporter.sendMail({
    from: resolveCompanyMailSender(profile),
    to,
    subject,
    text,
    html,
    replyTo: profile?.replyTo || undefined,
    ...buildCompanyInternalCopyRecipients(profile),
  });
};

export const sendCommunication = async ({ businessId, contextType, channel, templateKey, recordIds = [], profileId = '' }) => {
  const preview = await previewCommunication({ businessId, contextType, channel, templateKey, recordIds, profileId });
  const results = [];

  if (!preview.senderProfile?.sendingAvailable) {
    return {
      ...preview,
      summary: {
        ...preview.summary,
        sentCount: 0,
        failedCount: preview.previews.length,
      },
      results: preview.previews.map((item) => ({
        recordId: item.recordId,
        recipientName: item.recipientName,
        status: 'failed',
        message: preview.senderProfile?.statusReason || `No active ${channel.toUpperCase()} profile is available for this company.`,
      })),
    };
  }

  const company = preview.company;
  const template = resolveChannelTemplate({ company, contextType, channel, templateKey });
  const profileResolution = channel === 'sms'
    ? resolveSmsProfile({ company, template, requestedProfileId: profileId })
    : resolveEmailProfile({ company, requestedProfileId: profileId });
  const profile = profileResolution.profile;

  for (const item of preview.previews) {
    if (!item.canSend) {
      results.push({
        recordId: item.recordId,
        recipientName: item.recipientName,
        status: 'failed',
        message: item.reason || 'Communication preview is not sendable for this recipient.',
      });
      continue;
    }

    try {
      if (channel === 'sms') {
        await dispatchSms({ profile, to: item.recipientPhone, body: item.body });
      } else {
        await dispatchEmail({
          profile,
          to: item.recipientEmail,
          subject: item.subject,
          text: item.body,
          html: item.htmlBody,
        });
      }

      results.push({
        recordId: item.recordId,
        recipientName: item.recipientName,
        status: 'sent',
        message: `${channel.toUpperCase()} sent successfully.`,
      });
    } catch (error) {
      results.push({
        recordId: item.recordId,
        recipientName: item.recipientName,
        status: 'failed',
        message: error?.response?.data?.message || error?.message || `Failed to send ${channel.toUpperCase()}.`,
      });
    }
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
