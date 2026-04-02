import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import {
  FaBuilding,
  FaSitemap,
  FaMoneyCheckAlt,
  FaEnvelope,
  FaSms,
  FaUsers,
  FaThLarge,
  FaUserClock,
  FaHistory,
  FaImage,
  FaSave,
  FaCheckCircle,
  FaExclamationTriangle,
  FaShieldAlt,
  FaUniversity,
  FaSyncAlt,
  FaPhoneAlt,
  FaLock,
  FaPlus,
  FaPen,
  FaTrashAlt,
  FaPowerOff,
  FaListAlt,
  FaPaperPlane,
  FaServer,
  FaPlug,
} from "react-icons/fa";
import { getChartOfAccounts, getCompany, updateCompany } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";

const PAYMENT_DRAFT_ID = "__new_mpesa_paybill__";
const EMAIL_DRAFT_ID = "__new_email_profile__";
const SMS_DRAFT_ID = "__new_sms_profile__";
const validSmsSections = new Set(["configuration", "templates"]);

const tabs = [
  { key: "details", label: "COMPANY DETAILS", icon: <FaBuilding /> },
  { key: "structure", label: "COMPANY STRUCTURE", icon: <FaSitemap /> },
  { key: "payments", label: "PAYMENT CONFIG DETAILS", icon: <FaMoneyCheckAlt /> },
  { key: "email", label: "EMAIL CONFIG DETAILS", icon: <FaEnvelope /> },
  { key: "sms", label: "SMS", icon: <FaSms /> },
  { key: "users", label: "USERS", icon: <FaUsers /> },
  { key: "modules", label: "MODULES CONFIGURATION", icon: <FaThLarge /> },
  { key: "sessions", label: "USER SESSIONS", icon: <FaUserClock /> },
  { key: "activities", label: "USER ACTIVITIES", icon: <FaHistory /> },
];

const validTabKeys = new Set(tabs.map((tab) => tab.key));

const Card = ({ title, subtitle, children, action = null }) => (
  <div className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-xl shadow-sm">
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
      <div>
        <div className="text-sm font-extrabold text-slate-900">{title}</div>
        {subtitle ? <div className="mt-1 text-xs text-slate-600">{subtitle}</div> : null}
      </div>
      {action}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Modal = ({ open, title, subtitle, onClose, children, footer = null }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/20 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <div className="text-lg font-extrabold text-slate-900">{title}</div>
            {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50">Close</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
};

const Input = ({ className = "", ...props }) => (
  <input
    {...props}
    className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 ${className}`}
  />
);

const Select = ({ className = "", ...props }) => (
  <select
    {...props}
    className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 ${className}`}
  />
);

const ToggleRow = ({ checked, onChange, title, description, disabled = false }) => (
  <label
    className={[
      "flex items-start gap-3 rounded-2xl border px-4 py-3 transition",
      checked ? "border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-white",
      disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-slate-300",
    ].join(" ")}
  >
    <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
    <div>
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-1 text-xs leading-5 text-slate-600">{description}</div>
    </div>
  </label>
);

const statusTheme = {
  not_configured: {
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    panel: "border-slate-200 bg-slate-50",
    icon: <FaShieldAlt className="text-slate-500" />,
  },
  partial: {
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    panel: "border-amber-200 bg-amber-50/70",
    icon: <FaExclamationTriangle className="text-amber-500" />,
  },
  configured: {
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    panel: "border-blue-200 bg-blue-50/70",
    icon: <FaSyncAlt className="text-blue-500" />,
  },
  active: {
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    panel: "border-emerald-200 bg-emerald-50/80",
    icon: <FaCheckCircle className="text-emerald-500" />,
  },
};

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const isCashbookAccount = (account = {}) => {
  const code = String(account?.code || "").trim();
  const name = String(account?.name || "").trim();
  const type = String(account?.type || "").trim().toLowerCase();
  return type === "asset" && (/^11/.test(code) || /(cash|bank|mpesa|m-pesa|mobile money|wallet|collection)/i.test(name));
};

const buildPaymentStatus = (config = {}) => {
  const shortCode = String(config.shortCode || "").trim();
  const defaultCashbookAccountId = String(config.defaultCashbookAccountId || "").trim();
  const hasConsumerKey = Boolean(String(config.consumerKey || "").trim()) || Boolean(config.hasConsumerKey);
  const hasConsumerSecret = Boolean(String(config.consumerSecret || "").trim()) || Boolean(config.hasConsumerSecret);
  const hasPasskey = Boolean(String(config.passkey || "").trim()) || Boolean(config.hasPasskey);
  const hasAny = Boolean(shortCode) || Boolean(defaultCashbookAccountId) || hasConsumerKey || hasConsumerSecret || hasPasskey;
  const isConfigured = Boolean(shortCode) && Boolean(defaultCashbookAccountId) && hasConsumerKey && hasConsumerSecret && hasPasskey;

  if (!hasAny) {
    return {
      code: "not_configured",
      label: "Not configured",
      reason: "No M-Pesa Paybill setup has been saved for this configuration yet.",
    };
  }

  if (isConfigured && config.enabled && config.isActive) {
    return {
      code: "active",
      label: "Active",
      reason: "This Paybill configuration is complete and active for live use.",
    };
  }

  if (isConfigured) {
    return {
      code: "configured",
      label: "Configured",
      reason: "The Paybill configuration is complete. Activate it when you are ready for live payment processing.",
    };
  }

  return {
    code: "partial",
    label: "Partially configured",
    reason: "Some required Paybill settings are still missing.",
  };
};

const normalizeForm = (company = {}) => ({
  companyName: company.companyName || "",
  registrationNo: company.registrationNo || "",
  taxPIN: company.taxPIN || "",
  taxExemptCode: company.taxExemptCode || "",
  postalAddress: company.postalAddress || company.POBOX || "",
  country: company.country || "Kenya",
  town: company.town || company.City || "",
  roadStreet: company.roadStreet || company.Street || "",
  email: company.email || "",
  phoneNo: company.phoneNo || "",
  slogan: company.slogan || "",
  logo: company.logo || "",
  baseCurrency: company.baseCurrency || "KES",
  taxRegime: company.taxRegime || "VAT",
  fiscalStartMonth: company.fiscalStartMonth || "January",
  fiscalStartYear: company.fiscalStartYear || new Date().getFullYear(),
  operationPeriodType: company.operationPeriodType || "Monthly",
});


const normalizeTaxConfiguration = (settings = {}) => ({
  taxSettings: {
    enabled: Boolean(settings?.taxSettings?.enabled),
    defaultTaxMode: settings?.taxSettings?.defaultTaxMode || "exclusive",
    defaultTaxCodeKey: settings?.taxSettings?.defaultTaxCodeKey || "vat_standard",
    defaultVatRate: Number(settings?.taxSettings?.defaultVatRate || 16),
    roundingPrecision: Number(settings?.taxSettings?.roundingPrecision ?? 2),
    outputVatAccountCode: settings?.taxSettings?.outputVatAccountCode || "2140",
    invoiceTaxableByDefault: Boolean(settings?.taxSettings?.invoiceTaxableByDefault),
    invoiceTaxabilityByCategory: {
      rent: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.rent),
      utility: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.utility),
      penalty: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.penalty),
      deposit: Boolean(settings?.taxSettings?.invoiceTaxabilityByCategory?.deposit),
    },
  },
  taxCodes: Array.isArray(settings?.taxCodes) && settings.taxCodes.length > 0
    ? settings.taxCodes.map((code, index) => ({
        _id: code?._id || `tax-code-${index + 1}`,
        key: code?.key || `tax_code_${index + 1}`,
        name: code?.name || `Tax Code ${index + 1}`,
        type: code?.type || "vat",
        rate: Number(code?.rate || 0),
        isDefault: Boolean(code?.isDefault),
        isActive: code?.isActive !== false,
        description: code?.description || "",
      }))
    : [
        { _id: "tax-no-tax", key: "no_tax", name: "No Tax", type: "none", rate: 0, isDefault: false, isActive: true, description: "Non-taxable item" },
        { _id: "tax-vat-standard", key: "vat_standard", name: "VAT Standard", type: "vat", rate: 16, isDefault: true, isActive: true, description: "Standard output VAT" },
      ],
});

const normalizePaymentConfigs = (company = {}) => {
  const configs = company?.paymentIntegration?.mpesaPaybills;
  return Array.isArray(configs) ? configs : [];
};

const createBlankPaymentForm = (sequence = 1) => ({
  _id: PAYMENT_DRAFT_ID,
  name: `Paybill Configuration ${sequence}`,
  enabled: false,
  isActive: false,
  shortCode: "",
  consumerKey: "",
  consumerSecret: "",
  passkey: "",
  defaultCashbookAccountId: "",
  defaultCashbookAccountName: "",
  unmatchedPaymentMode: "manual_review",
  postingMode: "manual_review",
  responseType: "Completed",
  hasConsumerKey: false,
  hasConsumerSecret: false,
  hasPasskey: false,
  consumerKeyMasked: "",
  consumerSecretMasked: "",
  passkeyMasked: "",
  lastConfiguredAt: null,
  status: "not_configured",
  statusLabel: "Not configured",
  statusReason: "No M-Pesa Paybill setup has been saved for this configuration yet.",
});

const normalizePaymentEditor = (config = {}) => {
  const status = buildPaymentStatus(config);
  return {
    _id: config._id || "",
    name: config.name || "",
    enabled: Boolean(config.enabled),
    isActive: Boolean(config.isActive),
    shortCode: config.shortCode || "",
    consumerKey: "",
    consumerSecret: "",
    passkey: "",
    defaultCashbookAccountId: config.defaultCashbookAccountId || "",
    defaultCashbookAccountName: config.defaultCashbookAccountName || "",
    unmatchedPaymentMode: config.unmatchedPaymentMode || "manual_review",
    postingMode: config.postingMode || "manual_review",
    responseType: config.responseType || "Completed",
    hasConsumerKey: Boolean(config.hasConsumerKey),
    hasConsumerSecret: Boolean(config.hasConsumerSecret),
    hasPasskey: Boolean(config.hasPasskey),
    consumerKeyMasked: config.consumerKeyMasked || "",
    consumerSecretMasked: config.consumerSecretMasked || "",
    passkeyMasked: config.passkeyMasked || "",
    lastConfiguredAt: config.lastConfiguredAt || null,
    status: status.code,
    statusLabel: status.label,
    statusReason: status.reason,
  };
};


const formatDateTime = (value) => {
  if (!value) return "Not yet saved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet saved";
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const emailUsageOptions = [
  { value: "receipts", label: "Receipts" },
  { value: "invoices", label: "Invoices" },
  { value: "landlord_statements", label: "Landlord Statements" },
  { value: "system_alerts", label: "System Alerts" },
  { value: "demo_requests", label: "Demo Requests" },
  { value: "onboarding", label: "Onboarding" },
];

const buildEmailStatus = (config = {}) => {
  const senderName = String(config.senderName || "").trim();
  const senderEmail = String(config.senderEmail || "").trim();
  const smtpHost = String(config.smtpHost || "").trim();
  const smtpPort = Number(config.smtpPort || 0);
  const username = String(config.username || "").trim();
  const hasPassword = Boolean(String(config.password || "").trim()) || Boolean(config.hasPassword);
  const hasAny = Boolean(senderName || senderEmail || smtpHost || smtpPort || username || hasPassword);
  const isConfigured = Boolean(senderName && senderEmail && smtpHost && smtpPort > 0 && username && hasPassword);

  if (!hasAny) {
    return {
      code: "not_configured",
      label: "Not configured",
      reason: "No SMTP settings have been saved for this email profile yet.",
    };
  }

  if (isConfigured && config.enabled) {
    return {
      code: "active",
      label: "Active",
      reason: "This email profile is complete and enabled for sending.",
    };
  }

  if (isConfigured) {
    return {
      code: "configured",
      label: "Configured",
      reason: "This email profile is complete. Enable it when you are ready to use it for sending.",
    };
  }

  return {
    code: "partial",
    label: "Partially configured",
    reason: "Some SMTP details are still missing from this email profile.",
  };
};

const normalizeEmailConfigs = (company = {}) => {
  const configs = company?.communication?.emailProfiles;
  return Array.isArray(configs) ? configs : [];
};

const createBlankEmailForm = (sequence = 1, companyName = "") => ({
  _id: EMAIL_DRAFT_ID,
  name: `Email Profile ${sequence}`,
  senderName: companyName || "",
  senderEmail: "",
  replyTo: "",
  smtpHost: "",
  smtpPort: 465,
  encryption: "ssl",
  username: "",
  password: "",
  hasPassword: false,
  passwordMasked: "",
  internalCopyEmail: "",
  internalCopyMode: "bcc",
  usageTags: ["receipts", "invoices"],
  enabled: false,
  isDefault: false,
  lastTestStatus: "never",
  lastTestedAt: null,
  lastTestMessage: "",
  lastSuccessfulSendAt: null,
  lastUpdatedAt: null,
  testRecipient: "",
  status: "not_configured",
  statusLabel: "Not configured",
  statusReason: "No SMTP settings have been saved for this email profile yet.",
});

const normalizeEmailEditor = (config = {}) => {
  const status = buildEmailStatus(config);
  return {
    _id: config._id || "",
    name: config.name || "",
    senderName: config.senderName || "",
    senderEmail: config.senderEmail || "",
    replyTo: config.replyTo || "",
    smtpHost: config.smtpHost || "",
    smtpPort: config.smtpPort || 465,
    encryption: config.encryption || "ssl",
    username: config.username || "",
    password: "",
    hasPassword: Boolean(config.hasPassword),
    passwordMasked: config.passwordMasked || "",
    internalCopyEmail: config.internalCopyEmail || "",
    internalCopyMode: config.internalCopyMode || "bcc",
    usageTags: Array.isArray(config.usageTags) ? config.usageTags : [],
    enabled: Boolean(config.enabled),
    isDefault: Boolean(config.isDefault),
    lastTestStatus: config.lastTestStatus || "never",
    lastTestedAt: config.lastTestedAt || null,
    lastTestMessage: config.lastTestMessage || "",
    lastSuccessfulSendAt: config.lastSuccessfulSendAt || null,
    lastUpdatedAt: config.lastUpdatedAt || null,
    testRecipient: "",
    status: status.code,
    statusLabel: status.label,
    statusReason: status.reason,
  };
};

const resolveEmailTestBadge = (status = "never") => {
  if (status === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const smsProviderOptions = [
  { value: "generic", label: "Generic SMS API" },
  { value: "africas_talking", label: "Africa's Talking" },
  { value: "twilio", label: "Twilio" },
  { value: "custom_http", label: "Custom HTTP Provider" },
];

const smsRecipientLabels = {
  tenant: "Tenant",
  landlord: "Landlord",
  internal: "Internal",
};

const defaultSmsTemplates = [
  {
    _id: "sms-template-receipt_sms_tenant",
    key: "receipt_sms_tenant",
    name: "Receipt SMS",
    description: "Sent to tenants after a receipt is posted successfully.",
    recipientType: "tenant",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Dear {tenantName}, we have received KES {amount} for {propertyName} Unit {unitNumber}. Receipt No: {receiptNumber}. Thank you.",
    placeholders: ["tenantName", "amount", "propertyName", "unitNumber", "receiptNumber"],
  },
  {
    _id: "sms-template-invoice_sms_tenant",
    key: "invoice_sms_tenant",
    name: "Invoice SMS",
    description: "Sent to tenants when a rental invoice is prepared.",
    recipientType: "tenant",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Dear {tenantName}, your invoice {invoiceNumber} for {propertyName} Unit {unitNumber} is KES {amountDue}, due on {dueDate}.",
    placeholders: ["tenantName", "invoiceNumber", "propertyName", "unitNumber", "amountDue", "dueDate"],
  },
  {
    _id: "sms-template-overdue_reminder_tenant",
    key: "overdue_reminder_tenant",
    name: "Overdue Reminder",
    description: "Sent to tenants once a balance has genuinely moved into overdue state.",
    recipientType: "tenant",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Reminder: your overdue balance for {propertyName} Unit {unitNumber} is KES {overdueAmount}. Please clear it as soon as possible.",
    placeholders: ["tenantName", "propertyName", "unitNumber", "overdueAmount", "dueDate"],
  },
  {
    _id: "sms-template-landlord_statement_ready",
    key: "landlord_statement_ready",
    name: "Landlord Statement Ready",
    description: "Sent when a landlord statement has been processed and is ready for review.",
    recipientType: "landlord",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hello {landlordName}, your statement for {propertyName} covering {statementPeriod} is ready for review.",
    placeholders: ["landlordName", "propertyName", "statementPeriod", "statementDate"],
  },
  {
    _id: "sms-template-landlord_payment_sms",
    key: "landlord_payment_sms",
    name: "Landlord Payment SMS",
    description: "Sent after a landlord payment posts successfully.",
    recipientType: "landlord",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hello {landlordName}, KES {amount} has been paid to you for {propertyName} on {paymentDate}. Ref: {referenceNumber}.",
    placeholders: ["landlordName", "amount", "propertyName", "paymentDate", "referenceNumber"],
  },
  {
    _id: "sms-template-maintenance_update_tenant",
    key: "maintenance_update_tenant",
    name: "Maintenance Update - Tenant",
    description: "Used when a maintenance update should be shared with the affected tenant.",
    recipientType: "tenant",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hello {recipientName}, maintenance update for {propertyName} Unit {unitNumber}: {issueTitle} is now {status}.",
    placeholders: ["recipientName", "propertyName", "unitNumber", "issueTitle", "status", "scheduledDate", "completionDate"],
  },
  {
    _id: "sms-template-maintenance_update_landlord",
    key: "maintenance_update_landlord",
    name: "Maintenance Update - Landlord",
    description: "Used when a maintenance update should be shared with the landlord.",
    recipientType: "landlord",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hello {recipientName}, maintenance update for {propertyName} Unit {unitNumber}: {issueTitle} is now {status}.",
    placeholders: ["recipientName", "propertyName", "unitNumber", "issueTitle", "status", "scheduledDate", "completionDate"],
  },
];

const buildSmsStatus = (config = {}) => {
  const provider = String(config.provider || "").trim();
  const senderId = String(config.senderId || "").trim();
  const accountUsername = String(config.accountUsername || "").trim();
  const hasApiKey = Boolean(String(config.apiKey || "").trim()) || Boolean(config.hasApiKey);
  const hasAny = Boolean(provider || senderId || accountUsername || hasApiKey || String(config.name || "").trim());
  const isConfigured = Boolean(provider && senderId && accountUsername && hasApiKey);

  if (!hasAny) {
    return {
      code: "not_configured",
      label: "Not configured",
      reason: "No SMS provider details have been saved for this profile yet.",
    };
  }

  if (isConfigured && config.enabled) {
    return {
      code: "active",
      label: "Active",
      reason: "This SMS configuration is complete and enabled for the active company.",
    };
  }

  if (isConfigured) {
    return {
      code: "configured",
      label: "Configured",
      reason: "This SMS configuration is complete. Enable it when you are ready to use it.",
    };
  }

  return {
    code: "partial",
    label: "Partially configured",
    reason: "Some SMS provider details are still missing from this profile.",
  };
};

const normalizeSmsConfigs = (company = {}) => {
  const configs = company?.communication?.smsProfiles;
  return Array.isArray(configs) ? configs : [];
};

const normalizeSmsTemplates = (company = {}) => {
  const templates = company?.communication?.smsTemplates;
  if (Array.isArray(templates) && templates.length > 0) {
    return templates;
  }
  return defaultSmsTemplates;
};

const createBlankSmsForm = (sequence = 1) => ({
  _id: SMS_DRAFT_ID,
  name: `SMS Profile ${sequence}`,
  provider: "generic",
  senderId: "",
  accountUsername: "",
  apiKey: "",
  apiSecret: "",
  hasApiKey: false,
  apiKeyMasked: "",
  hasApiSecret: false,
  apiSecretMasked: "",
  defaultCountryCode: "+254",
  callbackUrl: "",
  enabled: false,
  isDefault: false,
  lastUpdatedAt: null,
  status: "not_configured",
  statusLabel: "Not configured",
  statusReason: "No SMS provider details have been saved for this profile yet.",
});

const normalizeSmsEditor = (config = {}) => {
  const status = buildSmsStatus(config);
  return {
    _id: config._id || "",
    name: config.name || "",
    provider: config.provider || "generic",
    senderId: config.senderId || "",
    accountUsername: config.accountUsername || "",
    apiKey: "",
    apiSecret: "",
    hasApiKey: Boolean(config.hasApiKey),
    apiKeyMasked: config.apiKeyMasked || "",
    hasApiSecret: Boolean(config.hasApiSecret),
    apiSecretMasked: config.apiSecretMasked || "",
    defaultCountryCode: config.defaultCountryCode || "+254",
    callbackUrl: config.callbackUrl || "",
    enabled: Boolean(config.enabled),
    isDefault: Boolean(config.isDefault),
    lastUpdatedAt: config.lastUpdatedAt || null,
    status: status.code,
    statusLabel: status.label,
    statusReason: status.reason,
  };
};

export default function CompanySetupPage() {

  const dispatch = useDispatch();
  const { currentCompany } = useSelector((state) => state.company || {});
  const [searchParams, setSearchParams] = useSearchParams();
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingPayments, setSavingPayments] = useState(false);
  const [savingEmails, setSavingEmails] = useState(false);
  const [savingSmsProfiles, setSavingSmsProfiles] = useState(false);
  const [savingSmsTemplates, setSavingSmsTemplates] = useState(false);
  const [savingTaxConfig, setSavingTaxConfig] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [loadingCashbooks, setLoadingCashbooks] = useState(false);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const [company, setCompany] = useState(normalizeForm(currentCompany));
  const [selectedPaymentConfigId, setSelectedPaymentConfigId] = useState(PAYMENT_DRAFT_ID);
  const [paymentForm, setPaymentForm] = useState(createBlankPaymentForm(1));
  const [selectedEmailProfileId, setSelectedEmailProfileId] = useState(EMAIL_DRAFT_ID);
  const [emailForm, setEmailForm] = useState(createBlankEmailForm(1, currentCompany?.companyName || ""));
  const [selectedSmsProfileId, setSelectedSmsProfileId] = useState(SMS_DRAFT_ID);
  const [smsForm, setSmsForm] = useState(createBlankSmsForm(1));
  const [smsConfigModalOpen, setSmsConfigModalOpen] = useState(false);
  const [smsTemplateModalOpen, setSmsTemplateModalOpen] = useState(false);
  const [smsTemplateForm, setSmsTemplateForm] = useState(null);
  const [taxConfig, setTaxConfig] = useState(normalizeTaxConfiguration());

  const activeTab = validTabKeys.has(searchParams.get("tab")) ? searchParams.get("tab") : "details";
  const activeSmsSection = validSmsSections.has(searchParams.get("smsTab")) ? searchParams.get("smsTab") : "configuration";
  const paymentConfigs = useMemo(() => normalizePaymentConfigs(currentCompany), [currentCompany]);
  const emailProfiles = useMemo(() => normalizeEmailConfigs(currentCompany), [currentCompany]);
  const smsProfiles = useMemo(() => normalizeSmsConfigs(currentCompany), [currentCompany]);
  const smsTemplates = useMemo(() => normalizeSmsTemplates(currentCompany), [currentCompany]);

  useEffect(() => {
    if (!validTabKeys.has(searchParams.get("tab"))) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", "details");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (activeTab !== "sms") return;
    if (!validSmsSections.has(searchParams.get("smsTab"))) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("smsTab", "configuration");
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  useEffect(() => {
    setCompany(normalizeForm(currentCompany));
  }, [currentCompany]);

  useEffect(() => {
    if (currentCompany?._id) {
      dispatch(getCompany(currentCompany._id));
    }
  }, [dispatch, currentCompany?._id]);


  useEffect(() => {
    let cancelled = false;

    const loadTaxConfiguration = async () => {
      if (!currentCompany?._id) {
        if (!cancelled) setTaxConfig(normalizeTaxConfiguration());
        return;
      }

      try {
        const response = await adminRequests.get(`/company-settings/${currentCompany._id}`);
        if (!cancelled) {
          setTaxConfig(normalizeTaxConfiguration(response?.data || {}));
        }
      } catch (error) {
        if (!cancelled) {
          setTaxConfig(normalizeTaxConfiguration());
        }
      }
    };

    loadTaxConfiguration();

    return () => {
      cancelled = true;
    };
  }, [currentCompany?._id]);

  useEffect(() => {
    if (paymentConfigs.length === 0) {
      setSelectedPaymentConfigId(PAYMENT_DRAFT_ID);
      setPaymentForm(createBlankPaymentForm(1));
      return;
    }

    setSelectedPaymentConfigId((prev) => {
      if (prev === PAYMENT_DRAFT_ID) {
        return prev;
      }
      const exists = paymentConfigs.some((config) => String(config._id) === String(prev));
      return exists ? prev : String(paymentConfigs[0]._id);
    });
  }, [paymentConfigs]);

  useEffect(() => {
    if (selectedPaymentConfigId === PAYMENT_DRAFT_ID) {
      return;
    }

    const selected = paymentConfigs.find((config) => String(config._id) === String(selectedPaymentConfigId));
    if (selected) {
      setPaymentForm(normalizePaymentEditor(selected));
    }
  }, [paymentConfigs, selectedPaymentConfigId]);

  useEffect(() => {
    if (emailProfiles.length === 0) {
      setSelectedEmailProfileId(EMAIL_DRAFT_ID);
      setEmailForm(createBlankEmailForm(1, currentCompany?.companyName || ""));
      return;
    }

    setSelectedEmailProfileId((prev) => {
      if (prev === EMAIL_DRAFT_ID) {
        return prev;
      }
      const exists = emailProfiles.some((profile) => String(profile._id) === String(prev));
      return exists ? prev : String(emailProfiles[0]._id);
    });
  }, [emailProfiles, currentCompany?.companyName]);

  useEffect(() => {
    if (selectedEmailProfileId === EMAIL_DRAFT_ID) {
      return;
    }

    const selected = emailProfiles.find((profile) => String(profile._id) === String(selectedEmailProfileId));
    if (selected) {
      setEmailForm(normalizeEmailEditor(selected));
    }
  }, [emailProfiles, selectedEmailProfileId]);

  useEffect(() => {
    if (smsProfiles.length === 0) {
      setSelectedSmsProfileId(SMS_DRAFT_ID);
      setSmsForm(createBlankSmsForm(1));
      return;
    }

    setSelectedSmsProfileId((prev) => {
      if (prev === SMS_DRAFT_ID) {
        return prev;
      }
      const exists = smsProfiles.some((profile) => String(profile._id) === String(prev));
      return exists ? prev : String(smsProfiles[0]._id);
    });
  }, [smsProfiles]);

  useEffect(() => {
    if (selectedSmsProfileId === SMS_DRAFT_ID) {
      return;
    }

    const selected = smsProfiles.find((profile) => String(profile._id) === String(selectedSmsProfileId));
    if (selected) {
      setSmsForm(normalizeSmsEditor(selected));
    }
  }, [smsProfiles, selectedSmsProfileId]);

  useEffect(() => {
    if (activeTab !== "payments" || !currentCompany?._id) return undefined;

    let cancelled = false;

    const loadCashbooks = async () => {
      setLoadingCashbooks(true);
      try {
        const accounts = await getChartOfAccounts({ business: currentCompany._id, type: "asset" });
        if (cancelled) return;
        const liveCashbooks = (Array.isArray(accounts) ? accounts : []).filter(isCashbookAccount);
        setCashbookOptions(liveCashbooks);
      } catch {
        if (!cancelled) {
          setCashbookOptions([]);
          toast.error("Failed to load company cashbooks");
        }
      } finally {
        if (!cancelled) {
          setLoadingCashbooks(false);
        }
      }
    };

    loadCashbooks();

    return () => {
      cancelled = true;
    };
  }, [activeTab, currentCompany?._id]);

  const selectedExistingConfig = useMemo(
    () => paymentConfigs.find((config) => String(config._id) === String(selectedPaymentConfigId)) || null,
    [paymentConfigs, selectedPaymentConfigId]
  );

  const paymentStatus = useMemo(() => buildPaymentStatus(paymentForm), [paymentForm]);
  const paymentTheme = statusTheme[paymentStatus.code] || statusTheme.not_configured;

  const paymentSummary = useMemo(() => {
    const total = paymentConfigs.length;
    const active = paymentConfigs.filter((config) => config.isActive).length;
    const enabled = paymentConfigs.filter((config) => config.enabled).length;
    const configured = paymentConfigs.filter((config) => ["configured", "active"].includes(buildPaymentStatus(config).code)).length;
    return { total, active, enabled, configured };
  }, [paymentConfigs]);

  const cashbookLabel = useMemo(() => {
    if (!paymentForm.defaultCashbookAccountId) {
      return paymentForm.defaultCashbookAccountName || "Not selected";
    }

    const selected = cashbookOptions.find(
      (account) => String(account._id) === String(paymentForm.defaultCashbookAccountId)
    );

    return selected?.name || paymentForm.defaultCashbookAccountName || "Not selected";
  }, [cashbookOptions, paymentForm.defaultCashbookAccountId, paymentForm.defaultCashbookAccountName]);

  const switchTab = (tabKey) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tabKey);
    setSearchParams(nextParams);
  };

  const beginCreatePaymentConfig = () => {
    setSelectedPaymentConfigId(PAYMENT_DRAFT_ID);
    setPaymentForm(createBlankPaymentForm(paymentConfigs.length + 1));
  };

  const beginEditPaymentConfig = (config) => {
    setSelectedPaymentConfigId(String(config._id));
    setPaymentForm(normalizePaymentEditor(config));
  };

  const resetPaymentEditor = () => {
    if (selectedPaymentConfigId === PAYMENT_DRAFT_ID) {
      setPaymentForm(createBlankPaymentForm(paymentConfigs.length + 1));
      return;
    }

    if (selectedExistingConfig) {
      setPaymentForm(normalizePaymentEditor(selectedExistingConfig));
    }
  };


  const handleTaxSettingChange = (key, value) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxSettings: {
        ...prev.taxSettings,
        [key]: value,
      },
    }));
  };

  const handleTaxCategoryToggle = (key, checked) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxSettings: {
        ...prev.taxSettings,
        invoiceTaxabilityByCategory: {
          ...prev.taxSettings.invoiceTaxabilityByCategory,
          [key]: checked,
        },
      },
    }));
  };

  const handleTaxCodeChange = (index, key, value) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxCodes: prev.taxCodes.map((code, codeIndex) =>
        codeIndex === index
          ? {
              ...code,
              [key]: key === "rate" ? Number(value || 0) : key === "isDefault" || key === "isActive" ? value : value,
            }
          : key === "isDefault" && value === true
          ? { ...code, isDefault: false }
          : code
      ),
    }));
  };

  const handleAddTaxCode = () => {
    setTaxConfig((prev) => ({
      ...prev,
      taxCodes: [
        ...prev.taxCodes,
        {
          _id: `tax-code-${Date.now()}`,
          key: `tax_code_${prev.taxCodes.length + 1}`,
          name: `Tax Code ${prev.taxCodes.length + 1}`,
          type: "vat",
          rate: Number(prev.taxSettings.defaultVatRate || 16),
          isDefault: false,
          isActive: true,
          description: "",
        },
      ],
    }));
  };

  const handleRemoveTaxCode = (index) => {
    setTaxConfig((prev) => ({
      ...prev,
      taxCodes: prev.taxCodes.filter((_, codeIndex) => codeIndex !== index),
    }));
  };

  const handleSaveTaxConfiguration = async () => {
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return;
    }

    setSavingTaxConfig(true);
    try {
      await adminRequests.put(`/company-settings/${currentCompany._id}/tax-configuration`, taxConfig);
      toast.success("Tax configuration saved successfully");
      const refreshed = await adminRequests.get(`/company-settings/${currentCompany._id}`);
      setTaxConfig(normalizeTaxConfiguration(refreshed?.data || {}));
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to save tax configuration");
    } finally {
      setSavingTaxConfig(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return;
    }

    setSavingDetails(true);
    try {
      await dispatch(updateCompany(currentCompany._id, company));
      toast.success("Company details saved successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to save company details");
    } finally {
      setSavingDetails(false);
    }
  };

  const mutatePaymentConfig = async ({ action, configId = "", config = null, successMessage, onSuccess = null }) => {
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return null;
    }

    setSavingPayments(true);
    try {
      const response = await dispatch(
        updateCompany(currentCompany._id, {
          paymentIntegration: {
            mpesaPaybills: {
              action,
              configId,
              config,
            },
          },
        })
      );

      const updatedCompany = response?.company || null;
      if (onSuccess) {
        onSuccess(updatedCompany);
      }
      toast.success(successMessage);
      return updatedCompany;
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to update Paybill configuration");
      return null;
    } finally {
      setSavingPayments(false);
    }
  };

  const handleSavePaymentConfig = async () => {
    const trimmedName = paymentForm.name.trim();
    if (!trimmedName) {
      toast.error("Enter a configuration name before saving");
      return;
    }

    if (paymentForm.enabled && !paymentForm.shortCode.trim()) {
      toast.error("Enter the Paybill number before saving an enabled configuration");
      return;
    }

    if (paymentForm.isActive) {
      const missing = [];
      if (!paymentForm.shortCode.trim()) missing.push("Paybill number");
      if (!(paymentForm.hasConsumerKey || paymentForm.consumerKey.trim())) missing.push("Consumer key");
      if (!(paymentForm.hasConsumerSecret || paymentForm.consumerSecret.trim())) missing.push("Consumer secret");
      if (!(paymentForm.hasPasskey || paymentForm.passkey.trim())) missing.push("Passkey");
      if (!String(paymentForm.defaultCashbookAccountId || "").trim()) missing.push("Default receiving cashbook");

      if (missing.length > 0) {
        toast.error(`Complete these fields before activation: ${missing.join(", ")}`);
        return;
      }
    }

    const payload = {
      name: trimmedName,
      enabled: Boolean(paymentForm.enabled),
      isActive: Boolean(paymentForm.enabled && paymentForm.isActive),
      shortCode: paymentForm.shortCode.trim(),
      defaultCashbookAccountId: paymentForm.defaultCashbookAccountId || "",
      unmatchedPaymentMode: paymentForm.unmatchedPaymentMode,
      postingMode: paymentForm.postingMode,
      responseType: paymentForm.responseType,
    };

    if (paymentForm.consumerKey.trim()) payload.consumerKey = paymentForm.consumerKey.trim();
    if (paymentForm.consumerSecret.trim()) payload.consumerSecret = paymentForm.consumerSecret.trim();
    if (paymentForm.passkey.trim()) payload.passkey = paymentForm.passkey.trim();

    const isCreate = selectedPaymentConfigId === PAYMENT_DRAFT_ID;
    await mutatePaymentConfig({
      action: isCreate ? "create" : "update",
      configId: isCreate ? "" : selectedPaymentConfigId,
      config: payload,
      successMessage: isCreate ? "Paybill configuration added successfully" : "Paybill configuration updated successfully",
      onSuccess: (updatedCompany) => {
        const nextConfigs = normalizePaymentConfigs(updatedCompany || {});
        const matchedConfig = isCreate
          ? nextConfigs.find(
              (config) =>
                String(config.name || "").trim() === trimmedName &&
                String(config.shortCode || "").trim() === payload.shortCode
            ) || nextConfigs[nextConfigs.length - 1]
          : nextConfigs.find((config) => String(config._id) === String(selectedPaymentConfigId));

        if (matchedConfig?._id) {
          setSelectedPaymentConfigId(String(matchedConfig._id));
          setPaymentForm(normalizePaymentEditor(matchedConfig));
        }
      },
    });
  };

  const handleDeletePaymentConfig = async (config) => {
    if (!window.confirm(`Delete ${config.name}? This only removes the saved Paybill configuration.`)) {
      return;
    }

    await mutatePaymentConfig({
      action: "delete",
      configId: String(config._id),
      successMessage: "Paybill configuration deleted successfully",
      onSuccess: (updatedCompany) => {
        const nextConfigs = normalizePaymentConfigs(updatedCompany || {});
        if (nextConfigs.length > 0) {
          setSelectedPaymentConfigId(String(nextConfigs[0]._id));
          setPaymentForm(normalizePaymentEditor(nextConfigs[0]));
        } else {
          setSelectedPaymentConfigId(PAYMENT_DRAFT_ID);
          setPaymentForm(createBlankPaymentForm(1));
        }
      },
    });
  };

  const handleQuickUpdate = async (config, patch, successMessage) => {
    await mutatePaymentConfig({
      action: "update",
      configId: String(config._id),
      config: patch,
      successMessage,
      onSuccess: (updatedCompany) => {
        const nextConfig = normalizePaymentConfigs(updatedCompany || {}).find(
          (item) => String(item._id) === String(config._id)
        );
        if (nextConfig && String(selectedPaymentConfigId) === String(config._id)) {
          setPaymentForm(normalizePaymentEditor(nextConfig));
        }
      },
    });
  };

  const selectedExistingEmailProfile = useMemo(
    () => emailProfiles.find((profile) => String(profile._id) === String(selectedEmailProfileId)) || null,
    [emailProfiles, selectedEmailProfileId]
  );

  const emailStatus = useMemo(() => buildEmailStatus(emailForm), [emailForm]);
  const emailTheme = statusTheme[emailStatus.code] || statusTheme.not_configured;

  const emailSummary = useMemo(() => {
    const total = emailProfiles.length;
    const active = emailProfiles.filter((profile) => profile.enabled).length;
    const configured = emailProfiles.filter((profile) => ["configured", "active"].includes(buildEmailStatus(profile).code)).length;
    const defaults = emailProfiles.filter((profile) => profile.isDefault).length;
    return { total, active, configured, defaults };
  }, [emailProfiles]);

  const selectedExistingSmsProfile = useMemo(
    () => smsProfiles.find((profile) => String(profile._id) === String(selectedSmsProfileId)) || null,
    [smsProfiles, selectedSmsProfileId]
  );

  const smsStatus = useMemo(() => buildSmsStatus(smsForm), [smsForm]);
  const smsTheme = statusTheme[smsStatus.code] || statusTheme.not_configured;

  const smsSummary = useMemo(() => {
    const total = smsProfiles.length;
    const active = smsProfiles.filter((profile) => profile.enabled).length;
    const configured = smsProfiles.filter((profile) => ["configured", "active"].includes(buildSmsStatus(profile).code)).length;
    const defaults = smsProfiles.filter((profile) => profile.isDefault).length;
    const automatedTemplates = smsTemplates.filter((template) => template.enabled && template.sendMode === "automatic").length;
    return { total, active, configured, defaults, automatedTemplates };
  }, [smsProfiles, smsTemplates]);

  const beginCreateEmailProfile = () => {
    setSelectedEmailProfileId(EMAIL_DRAFT_ID);
    setEmailForm(createBlankEmailForm(emailProfiles.length + 1, currentCompany?.companyName || ""));
  };

  const beginEditEmailProfile = (profile) => {
    setSelectedEmailProfileId(String(profile._id));
    setEmailForm(normalizeEmailEditor(profile));
  };

  const resetEmailEditor = () => {
    if (selectedEmailProfileId === EMAIL_DRAFT_ID) {
      setEmailForm(createBlankEmailForm(emailProfiles.length + 1, currentCompany?.companyName || ""));
      return;
    }

    if (selectedExistingEmailProfile) {
      setEmailForm(normalizeEmailEditor(selectedExistingEmailProfile));
    }
  };

  const mutateEmailProfile = async ({ action, profileId = "", profile = null, successMessage, onSuccess = null }) => {
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return null;
    }

    setSavingEmails(true);
    try {
      const response = await dispatch(
        updateCompany(currentCompany._id, {
          communication: {
            emailProfiles: {
              action,
              profileId,
              profile,
            },
          },
        })
      );

      const updatedCompany = response?.company || null;
      if (onSuccess) {
        onSuccess(updatedCompany);
      }
      toast.success(successMessage);
      return updatedCompany;
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to update email profile");
      return null;
    } finally {
      setSavingEmails(false);
    }
  };

  const handleSaveEmailProfile = async () => {
    const trimmedName = emailForm.name.trim();
    if (!trimmedName) {
      toast.error("Enter a profile name before saving");
      return;
    }

    const enabling = Boolean(emailForm.enabled || emailForm.isDefault);
    if (enabling) {
      const missing = [];
      if (!emailForm.senderName.trim()) missing.push("Sender name");
      if (!emailForm.senderEmail.trim()) missing.push("Sender email");
      if (!emailForm.smtpHost.trim()) missing.push("SMTP host");
      if (!String(emailForm.smtpPort || "").trim()) missing.push("SMTP port");
      if (!emailForm.username.trim()) missing.push("SMTP username");
      if (!(emailForm.hasPassword || emailForm.password.trim())) missing.push("SMTP password");
      if (missing.length > 0) {
        toast.error(`Complete these fields before enabling this profile: ${missing.join(", ")}`);
        return;
      }
    }

    const payload = {
      name: trimmedName,
      senderName: emailForm.senderName.trim(),
      senderEmail: emailForm.senderEmail.trim().toLowerCase(),
      replyTo: emailForm.replyTo.trim().toLowerCase(),
      smtpHost: emailForm.smtpHost.trim().toLowerCase(),
      smtpPort: emailForm.smtpPort,
      encryption: emailForm.encryption,
      username: emailForm.username.trim(),
      internalCopyEmail: emailForm.internalCopyEmail.trim().toLowerCase(),
      internalCopyMode: emailForm.internalCopyMode,
      usageTags: emailForm.usageTags,
      enabled: Boolean(emailForm.enabled || emailForm.isDefault),
      isDefault: Boolean(emailForm.isDefault),
    };

    if (emailForm.password.trim()) {
      payload.password = emailForm.password.trim();
    }

    const isCreate = selectedEmailProfileId === EMAIL_DRAFT_ID;
    await mutateEmailProfile({
      action: isCreate ? "create" : "update",
      profileId: isCreate ? "" : selectedEmailProfileId,
      profile: payload,
      successMessage: isCreate ? "Email profile added successfully" : "Email profile updated successfully",
      onSuccess: (updatedCompany) => {
        const nextProfiles = normalizeEmailConfigs(updatedCompany || {});
        const matchedProfile = isCreate
          ? nextProfiles.find(
              (profile) =>
                String(profile.name || "").trim() === trimmedName &&
                String(profile.senderEmail || "").trim() === payload.senderEmail
            ) || nextProfiles[nextProfiles.length - 1]
          : nextProfiles.find((profile) => String(profile._id) === String(selectedEmailProfileId));

        if (matchedProfile?._id) {
          setSelectedEmailProfileId(String(matchedProfile._id));
          setEmailForm(normalizeEmailEditor(matchedProfile));
        }
      },
    });
  };

  const handleDeleteEmailProfile = async (profile) => {
    if (!window.confirm(`Delete ${profile.name}? This only removes the saved email profile.`)) {
      return;
    }

    await mutateEmailProfile({
      action: "delete",
      profileId: String(profile._id),
      successMessage: "Email profile deleted successfully",
      onSuccess: (updatedCompany) => {
        const nextProfiles = normalizeEmailConfigs(updatedCompany || {});
        if (nextProfiles.length > 0) {
          setSelectedEmailProfileId(String(nextProfiles[0]._id));
          setEmailForm(normalizeEmailEditor(nextProfiles[0]));
        } else {
          setSelectedEmailProfileId(EMAIL_DRAFT_ID);
          setEmailForm(createBlankEmailForm(1, currentCompany?.companyName || ""));
        }
      },
    });
  };

  const handleQuickEmailUpdate = async (profile, patch, successMessage) => {
    await mutateEmailProfile({
      action: "update",
      profileId: String(profile._id),
      profile: patch,
      successMessage,
      onSuccess: (updatedCompany) => {
        const nextProfile = normalizeEmailConfigs(updatedCompany || {}).find(
          (item) => String(item._id) === String(profile._id)
        );
        if (nextProfile && String(selectedEmailProfileId) === String(profile._id)) {
          setEmailForm(normalizeEmailEditor(nextProfile));
        }
      },
    });
  };

  const toggleUsageTag = (tag) => {
    setEmailForm((prev) => ({
      ...prev,
      usageTags: prev.usageTags.includes(tag)
        ? prev.usageTags.filter((item) => item !== tag)
        : [...prev.usageTags, tag],
    }));
  };

  const handleSendTestEmail = async (profile = null) => {
    const targetProfileId = profile?._id || (selectedEmailProfileId !== EMAIL_DRAFT_ID ? selectedEmailProfileId : "");
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return;
    }
    if (!targetProfileId) {
      toast.error("Save the email profile first before sending a test email");
      return;
    }

    const testRecipient = (emailForm.testRecipient || currentCompany?.email || "").trim().toLowerCase();
    if (!testRecipient) {
      toast.error("Enter a test recipient email or set a company email first");
      return;
    }

    setTestingEmail(true);
    try {
      const response = await adminRequests.post(`/companies/${currentCompany._id}/email-profiles/test`, {
        profileId: targetProfileId,
        toEmail: testRecipient,
      });
      await dispatch(getCompany(currentCompany._id));
      toast.success(response?.data?.message || "Test email sent successfully");
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to send test email");
    } finally {
      setTestingEmail(false);
    }
  };

  const switchSmsSection = (sectionKey) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", "sms");
    nextParams.set("smsTab", sectionKey);
    setSearchParams(nextParams);
  };

  const beginCreateSmsProfile = () => {
    setSelectedSmsProfileId(SMS_DRAFT_ID);
    setSmsForm(createBlankSmsForm(smsProfiles.length + 1));
    setSmsConfigModalOpen(true);
  };

  const beginEditSmsProfile = (profile) => {
    setSelectedSmsProfileId(String(profile._id));
    setSmsForm(normalizeSmsEditor(profile));
    setSmsConfigModalOpen(true);
  };

  const resetSmsEditor = () => {
    if (selectedSmsProfileId === SMS_DRAFT_ID) {
      setSmsForm(createBlankSmsForm(smsProfiles.length + 1));
      return;
    }

    if (selectedExistingSmsProfile) {
      setSmsForm(normalizeSmsEditor(selectedExistingSmsProfile));
    }
  };

  const closeSmsConfigModal = () => {
    setSmsConfigModalOpen(false);
    resetSmsEditor();
  };

  const mutateSmsProfile = async ({ action, profileId = "", profile = null, successMessage, onSuccess = null }) => {
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return null;
    }

    setSavingSmsProfiles(true);
    try {
      const response = await dispatch(
        updateCompany(currentCompany._id, {
          communication: {
            smsProfiles: {
              action,
              profileId,
              profile,
            },
          },
        })
      );

      const updatedCompany = response?.company || null;
      if (onSuccess) {
        onSuccess(updatedCompany);
      }
      toast.success(successMessage);
      return updatedCompany;
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to update SMS configuration");
      return null;
    } finally {
      setSavingSmsProfiles(false);
    }
  };

  const handleSaveSmsProfile = async () => {
    const trimmedName = smsForm.name.trim();
    if (!trimmedName) {
      toast.error("Enter an SMS configuration name before saving");
      return;
    }

    const enabling = Boolean(smsForm.enabled || smsForm.isDefault);
    if (enabling) {
      const missing = [];
      if (!smsForm.provider.trim()) missing.push("Provider");
      if (!smsForm.senderId.trim()) missing.push("Sender ID");
      if (!smsForm.accountUsername.trim()) missing.push("Account username");
      if (!(smsForm.hasApiKey || smsForm.apiKey.trim())) missing.push("API key");
      if (missing.length > 0) {
        toast.error(`Complete these fields before enabling this SMS configuration: ${missing.join(", ")}`);
        return;
      }
    }

    const payload = {
      name: trimmedName,
      provider: smsForm.provider,
      senderId: smsForm.senderId.trim(),
      accountUsername: smsForm.accountUsername.trim(),
      defaultCountryCode: smsForm.defaultCountryCode.trim() || "+254",
      callbackUrl: smsForm.callbackUrl.trim(),
      enabled: Boolean(smsForm.enabled || smsForm.isDefault),
      isDefault: Boolean(smsForm.isDefault),
    };

    if (smsForm.apiKey.trim()) payload.apiKey = smsForm.apiKey.trim();
    if (smsForm.apiSecret.trim()) payload.apiSecret = smsForm.apiSecret.trim();

    const isCreate = selectedSmsProfileId === SMS_DRAFT_ID;
    await mutateSmsProfile({
      action: isCreate ? "create" : "update",
      profileId: isCreate ? "" : selectedSmsProfileId,
      profile: payload,
      successMessage: isCreate ? "SMS configuration added successfully" : "SMS configuration updated successfully",
      onSuccess: (updatedCompany) => {
        const nextProfiles = normalizeSmsConfigs(updatedCompany || {});
        const matchedProfile = isCreate
          ? nextProfiles.find(
              (profile) =>
                String(profile.name || "").trim() === trimmedName &&
                String(profile.senderId || "").trim() === payload.senderId
            ) || nextProfiles[nextProfiles.length - 1]
          : nextProfiles.find((profile) => String(profile._id) === String(selectedSmsProfileId));

        if (matchedProfile?._id) {
          setSelectedSmsProfileId(String(matchedProfile._id));
          setSmsForm(normalizeSmsEditor(matchedProfile));
        }
        setSmsConfigModalOpen(false);
      },
    });
  };

  const handleDeleteSmsProfile = async (profile) => {
    if (!window.confirm(`Delete ${profile.name}? This only removes the saved SMS configuration.`)) {
      return;
    }

    await mutateSmsProfile({
      action: "delete",
      profileId: String(profile._id),
      successMessage: "SMS configuration deleted successfully",
      onSuccess: (updatedCompany) => {
        const nextProfiles = normalizeSmsConfigs(updatedCompany || {});
        if (nextProfiles.length > 0) {
          setSelectedSmsProfileId(String(nextProfiles[0]._id));
          setSmsForm(normalizeSmsEditor(nextProfiles[0]));
        } else {
          setSelectedSmsProfileId(SMS_DRAFT_ID);
          setSmsForm(createBlankSmsForm(1));
        }
      },
    });
  };

  const handleQuickSmsProfileUpdate = async (profile, patch, successMessage) => {
    await mutateSmsProfile({
      action: "update",
      profileId: String(profile._id),
      profile: patch,
      successMessage,
      onSuccess: (updatedCompany) => {
        const nextProfile = normalizeSmsConfigs(updatedCompany || {}).find(
          (item) => String(item._id) === String(profile._id)
        );
        if (nextProfile && String(selectedSmsProfileId) === String(profile._id)) {
          setSmsForm(normalizeSmsEditor(nextProfile));
        }
      },
    });
  };

  const openSmsTemplateEditor = (template) => {
    setSmsTemplateForm({
      _id: template._id,
      key: template.key,
      name: template.name,
      description: template.description,
      recipientType: template.recipientType,
      enabled: Boolean(template.enabled),
      sendMode: template.sendMode || "manual",
      profileId: template.profileId || "",
      messageBody: template.messageBody || "",
      placeholders: Array.isArray(template.placeholders) ? template.placeholders : [],
    });
    setSmsTemplateModalOpen(true);
  };

  const closeSmsTemplateModal = () => {
    setSmsTemplateModalOpen(false);
    setSmsTemplateForm(null);
  };

  const mutateSmsTemplate = async ({ templateId = "", templateKey = "", template = {}, action = "update", successMessage }) => {
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return null;
    }

    setSavingSmsTemplates(true);
    try {
      const response = await dispatch(
        updateCompany(currentCompany._id, {
          communication: {
            smsTemplates: {
              action,
              templateId,
              templateKey,
              template,
            },
          },
        })
      );
      toast.success(successMessage);
      return response?.company || null;
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.message || "Failed to update SMS template");
      return null;
    } finally {
      setSavingSmsTemplates(false);
    }
  };

  const handleSaveSmsTemplate = async () => {
    if (!smsTemplateForm) return;
    if (!smsTemplateForm.messageBody.trim()) {
      toast.error("Enter the SMS body before saving this template");
      return;
    }

    const updatedCompany = await mutateSmsTemplate({
      templateId: smsTemplateForm._id,
      templateKey: smsTemplateForm.key,
      template: {
        enabled: Boolean(smsTemplateForm.enabled),
        sendMode: smsTemplateForm.sendMode,
        profileId: smsTemplateForm.profileId || null,
        messageBody: smsTemplateForm.messageBody.trim(),
      },
      successMessage: "SMS template updated successfully",
    });

    if (updatedCompany) {
      const nextTemplate = normalizeSmsTemplates(updatedCompany || {}).find(
        (item) => String(item._id) === String(smsTemplateForm._id) || String(item.key) === String(smsTemplateForm.key)
      );
      if (nextTemplate) {
        setSmsTemplateForm({
          _id: nextTemplate._id,
          key: nextTemplate.key,
          name: nextTemplate.name,
          description: nextTemplate.description,
          recipientType: nextTemplate.recipientType,
          enabled: Boolean(nextTemplate.enabled),
          sendMode: nextTemplate.sendMode || "manual",
          profileId: nextTemplate.profileId || "",
          messageBody: nextTemplate.messageBody || "",
          placeholders: Array.isArray(nextTemplate.placeholders) ? nextTemplate.placeholders : [],
        });
      }
      setSmsTemplateModalOpen(false);
    }
  };

  const handleQuickSmsTemplateUpdate = async (template, patch, successMessage) => {
    await mutateSmsTemplate({
      templateId: String(template._id),
      templateKey: template.key,
      template: patch,
      successMessage,
    });
  };

  const handleResetSmsTemplates = async () => {
    if (!window.confirm("Reset SMS templates back to the MILIK defaults for this company?")) {
      return;
    }

    await mutateSmsTemplate({
      action: "reset_defaults",
      successMessage: "SMS templates reset to defaults",
    });
  };

  const renderDetailsTab = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title="Company Identity" subtitle="These details are reused in reports, statements and printed documents">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-emerald-100 bg-slate-50">
              {company.logo ? (
                <img src={company.logo} alt={company.companyName || "Company"} className="h-full w-full object-cover" />
              ) : (
                <FaImage className="text-2xl text-slate-300" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-lg font-extrabold text-slate-900">{company.companyName || "Company Name"}</div>
              <div className="truncate text-sm text-slate-500">{company.slogan || "Company slogan will appear here"}</div>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Logo URL</label>
            <Input value={company.logo} onChange={(e) => setCompany({ ...company, logo: e.target.value })} placeholder="https://.../logo.png" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Slogan</label>
            <Input value={company.slogan} onChange={(e) => setCompany({ ...company, slogan: e.target.value })} placeholder="Reliable property management" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Contact Email</label>
            <Input type="email" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} placeholder="info@company.com" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Phone Number</label>
            <Input value={company.phoneNo} onChange={(e) => setCompany({ ...company, phoneNo: e.target.value })} placeholder="0700 000 000" />
          </div>
        </div>
      </Card>

      <div className="space-y-4 xl:col-span-2">
        <Card title="Company Profile" subtitle="Maintain the operational and statutory details for the active company">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Company Name</label>
              <Input value={company.companyName} onChange={(e) => setCompany({ ...company, companyName: e.target.value })} placeholder="Milik Property Management" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Registration No</label>
              <Input value={company.registrationNo} onChange={(e) => setCompany({ ...company, registrationNo: e.target.value })} placeholder="PVT-001" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Tax PIN</label>
              <Input value={company.taxPIN} onChange={(e) => setCompany({ ...company, taxPIN: e.target.value })} placeholder="A123456789X" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Tax Exempt Code</label>
              <Input value={company.taxExemptCode} onChange={(e) => setCompany({ ...company, taxExemptCode: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Country</label>
              <Input value={company.country} onChange={(e) => setCompany({ ...company, country: e.target.value })} placeholder="Kenya" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Town / City</label>
              <Input value={company.town} onChange={(e) => setCompany({ ...company, town: e.target.value })} placeholder="Nairobi" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Postal Address</label>
              <Input value={company.postalAddress} onChange={(e) => setCompany({ ...company, postalAddress: e.target.value })} placeholder="P.O. Box 12345 - 00100" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Road / Street</label>
              <Input value={company.roadStreet} onChange={(e) => setCompany({ ...company, roadStreet: e.target.value })} placeholder="Westlands Road" />
            </div>
          </div>
        </Card>

        <Card title="Defaults & Fiscal Period" subtitle="These defaults influence financial and property reports across the system">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-bold text-slate-700">Currency</label>
              <Select value={company.baseCurrency} onChange={(e) => setCompany({ ...company, baseCurrency: e.target.value })}>
                <option value="KES">KES</option>
                <option value="USD">USD</option>
                <option value="UGX">UGX</option>
                <option value="TZS">TZS</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Tax Regime</label>
              <Select value={company.taxRegime} onChange={(e) => setCompany({ ...company, taxRegime: e.target.value })}>
                <option value="VAT">VAT</option>
                <option value="No Tax">No Tax</option>
                <option value="GST">GST</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Fiscal Start Month</label>
              <Select value={company.fiscalStartMonth} onChange={(e) => setCompany({ ...company, fiscalStartMonth: e.target.value })}>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Fiscal Start Year</label>
              <Input
                type="number"
                value={company.fiscalStartYear}
                onChange={(e) =>
                  setCompany({
                    ...company,
                    fiscalStartYear: Number(e.target.value) || new Date().getFullYear(),
                  })
                }
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Operation Period Type</label>
              <Select value={company.operationPeriodType} onChange={(e) => setCompany({ ...company, operationPeriodType: e.target.value })}>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Semi Annual">Semi Annual</option>
                <option value="Annual">Annual</option>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={() => setCompany(normalizeForm(currentCompany))}>
              Reset
            </button>
            <button disabled={savingDetails} onClick={handleSaveDetails} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingDetails ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </Card>

        <Card title="Tax Configuration" subtitle="Company-wide VAT / tax foundation for invoices, penalties and commission logic. Management commission VAT is further refined inside Property Commission Settings.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ToggleRow
              checked={taxConfig.taxSettings.enabled}
              onChange={(e) => handleTaxSettingChange("enabled", e.target.checked)}
              title="Enable tax engine"
              description="Turn on structured VAT / tax handling for this company. Core accounting remains isolated from communication and non-financial modules."
            />
            <ToggleRow
              checked={taxConfig.taxSettings.invoiceTaxableByDefault}
              onChange={(e) => handleTaxSettingChange("invoiceTaxableByDefault", e.target.checked)}
              title="Invoices taxable by default"
              description="Used as the fallback taxability rule when no stricter category toggle is set."
            />
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Mode</label>
              <Select value={taxConfig.taxSettings.defaultTaxMode} onChange={(e) => handleTaxSettingChange("defaultTaxMode", e.target.value)}>
                <option value="exclusive">Exclusive</option>
                <option value="inclusive">Inclusive</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default VAT Rate (%)</label>
              <Input type="number" min="0" step="0.01" value={taxConfig.taxSettings.defaultVatRate} onChange={(e) => handleTaxSettingChange("defaultVatRate", Number(e.target.value || 0))} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Code</label>
              <Select value={taxConfig.taxSettings.defaultTaxCodeKey} onChange={(e) => handleTaxSettingChange("defaultTaxCodeKey", e.target.value)}>
                {taxConfig.taxCodes.map((code) => (
                  <option key={code._id || code.key} value={code.key}>{code.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Output VAT / Tax Payable Account Code</label>
              <Input value={taxConfig.taxSettings.outputVatAccountCode} onChange={(e) => handleTaxSettingChange("outputVatAccountCode", e.target.value)} placeholder="2140" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.rent} onChange={(e) => handleTaxCategoryToggle("rent", e.target.checked)} title="Rent charge taxable" description="Default rent-charge taxability rule for tenant invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.utility} onChange={(e) => handleTaxCategoryToggle("utility", e.target.checked)} title="Utility recharge taxable" description="Keeps utility treatment configurable instead of assumed." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.penalty} onChange={(e) => handleTaxCategoryToggle("penalty", e.target.checked)} title="Penalty invoice taxable" description="Phase 1 supports penalty tax treatment separately from normal invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.deposit} onChange={(e) => handleTaxCategoryToggle("deposit", e.target.checked)} title="Deposit charge taxable" description="Recommended off for standard deposit liabilities unless your policy explicitly requires otherwise." />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-slate-900">Tax Codes</div>
              <div className="mt-1 text-xs text-slate-500">Maintain reusable tax codes for invoices and commission settings. Keep one default code active.</div>
            </div>
            <button onClick={handleAddTaxCode} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
              <FaPlus /> Add Tax Code
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {taxConfig.taxCodes.map((code, index) => (
              <div key={code._id || `${code.key}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div>
                    <label className="text-xs font-bold text-slate-700">Key</label>
                    <Input value={code.key} onChange={(e) => handleTaxCodeChange(index, "key", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Name</label>
                    <Input value={code.name} onChange={(e) => handleTaxCodeChange(index, "name", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Type</label>
                    <Select value={code.type} onChange={(e) => handleTaxCodeChange(index, "type", e.target.value)}>
                      <option value="vat">VAT</option>
                      <option value="zero_rated">Zero Rated</option>
                      <option value="exempt">Exempt</option>
                      <option value="none">No Tax</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Rate (%)</label>
                    <Input type="number" min="0" step="0.01" value={code.rate} onChange={(e) => handleTaxCodeChange(index, "rate", e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isDefault)} onChange={(e) => handleTaxCodeChange(index, "isDefault", e.target.checked)} /> Default
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isActive)} onChange={(e) => handleTaxCodeChange(index, "isActive", e.target.checked)} /> Active
                  </label>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-slate-700">Description</label>
                    <Input value={code.description || ""} onChange={(e) => handleTaxCodeChange(index, "description", e.target.value)} />
                  </div>
                  <button onClick={() => handleRemoveTaxCode(index)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                    <FaTrashAlt /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <button disabled={savingTaxConfig} onClick={handleSaveTaxConfiguration} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0B3B2E] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingTaxConfig ? "Saving..." : "Save Tax Configuration"}
            </button>
          </div>
        </Card>

      </div>
    </div>
  );

  const renderPaymentsTab = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.6fr]">
      <div className="space-y-4">
        <Card
          title="Payment Config Overview"
          subtitle="Manage one or many company Paybill setups from this page. Matching remains scoped by Paybill plus tenant code."
          action={
            <button onClick={beginCreatePaymentConfig} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:opacity-95">
              <FaPlus /> Add Paybill Config
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Total configs</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{paymentSummary.total}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Active now</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{paymentSummary.active}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Enabled</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{paymentSummary.enabled}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{paymentSummary.configured}</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FaPhoneAlt className="text-[#F97316]" /> Payment identity rule
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              Incoming payments are identified by the company Paybill together with the tenant code entered as the account number. This keeps matching safely company-bound.
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
              Account number used by tenant: <span className="text-slate-900">Tenant Code (example: TT0001)</span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FaLock className="text-emerald-600" /> Callback handling strategy
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              MILIK manages confirmation and validation endpoints from the backend. Company admins only configure the commercial and processing details here.
            </div>
          </div>
        </Card>

        <Card title="Configured Paybills" subtitle="Open any saved configuration to edit it, or create a new one for the active company.">
          <div className="space-y-3">
            {paymentConfigs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                No Paybill configuration has been added for this company yet.
              </div>
            ) : (
              paymentConfigs.map((config) => {
                const status = buildPaymentStatus(config);
                const theme = statusTheme[status.code] || statusTheme.not_configured;
                const isSelected = String(selectedPaymentConfigId) === String(config._id);
                return (
                  <div key={config._id} className={[
                    "rounded-2xl border p-4 transition",
                    isSelected ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-slate-300",
                  ].join(" ")}>
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 flex-1 text-left" onClick={() => beginEditPaymentConfig(config)}>
                        <div className="flex items-center gap-2">
                          <FaListAlt className="text-slate-400" />
                          <div className="truncate text-sm font-extrabold text-slate-900">{config.name}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Paybill: {config.shortCode || "Not set"}</div>
                        <div className="mt-1 text-xs text-slate-500">Cashbook: {config.defaultCashbookAccountName || "Not selected"}</div>
                      </button>
                      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold ${theme.badge}`}>
                        {theme.icon}
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => beginEditPaymentConfig(config)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                        <span className="inline-flex items-center gap-2"><FaPen /> Edit</span>
                      </button>
                      <button
                        onClick={() => handleQuickUpdate(config, { enabled: !config.enabled, isActive: config.enabled ? false : config.isActive }, config.enabled ? "Paybill configuration disabled" : "Paybill configuration enabled")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <span className="inline-flex items-center gap-2"><FaPowerOff /> {config.enabled ? "Disable" : "Enable"}</span>
                      </button>
                      <button
                        onClick={() => handleQuickUpdate(config, { enabled: true, isActive: !config.isActive }, config.isActive ? "Paybill configuration set to inactive" : "Paybill configuration activated")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <span className="inline-flex items-center gap-2"><FaCheckCircle /> {config.isActive ? "Set inactive" : "Activate"}</span>
                      </button>
                      <button onClick={() => handleDeletePaymentConfig(config)} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                        <span className="inline-flex items-center gap-2"><FaTrashAlt /> Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card
          title={selectedPaymentConfigId === PAYMENT_DRAFT_ID ? "New Paybill Configuration" : "Payment Configuration Details"}
          subtitle="Give each Paybill a clear internal name, then save its credentials, cashbook mapping and processing rules safely."
          action={
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${paymentTheme.badge}`}>
              {paymentTheme.icon}
              {paymentStatus.label}
            </span>
          }
        >
          <div className={`rounded-2xl border p-4 ${paymentTheme.panel}`}>
            <div className="flex items-start gap-3">
              <div className="mt-1 text-lg">{paymentTheme.icon}</div>
              <div>
                <div className="text-sm font-extrabold text-slate-900">{paymentStatus.label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-700">{paymentStatus.reason}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Configuration Name</label>
              <Input
                value={paymentForm.name}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Example: Main Residential Paybill"
              />
              <div className="mt-1 text-xs text-slate-500">Use a clear internal name so company admins can easily identify the right Paybill setup.</div>
            </div>

            <div className="md:col-span-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ToggleRow
                checked={paymentForm.enabled}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    enabled: e.target.checked,
                    isActive: e.target.checked ? prev.isActive : false,
                  }))
                }
                title="Enable this Paybill configuration"
                description="Turn this on when this configuration should remain available for the active company."
              />
              <ToggleRow
                checked={paymentForm.enabled && paymentForm.isActive}
                disabled={!paymentForm.enabled}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                title="Mark this configuration active"
                description="Only activate after the Paybill number, credentials and receiving cashbook are complete."
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Paybill Number</label>
              <Input
                value={paymentForm.shortCode}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, shortCode: e.target.value.replace(/[^\d]/g, "") }))}
                placeholder="Example: 522522"
                maxLength={7}
              />
              <div className="mt-1 text-xs text-slate-500">Each saved Paybill number must remain unique across all registered companies.</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Default Receiving Cashbook</label>
              <Select
                value={paymentForm.defaultCashbookAccountId}
                onChange={(e) => {
                  const selected = cashbookOptions.find((item) => String(item._id) === String(e.target.value));
                  setPaymentForm((prev) => ({
                    ...prev,
                    defaultCashbookAccountId: e.target.value,
                    defaultCashbookAccountName: selected?.name || prev.defaultCashbookAccountName || "",
                  }));
                }}
                disabled={loadingCashbooks}
              >
                <option value="">{loadingCashbooks ? "Loading cashbooks..." : "Select receiving cashbook"}</option>
                {cashbookOptions.map((account) => (
                  <option key={account._id} value={account._id}>
                    {account.name} {account.code ? `(${account.code})` : ""}
                  </option>
                ))}
              </Select>
              <div className="mt-1 text-xs text-slate-500">Matched M-Pesa collections will map to this receiving cashbook during future posting flows.</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Consumer Key</label>
              <Input
                type="password"
                value={paymentForm.consumerKey}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, consumerKey: e.target.value }))}
                placeholder={paymentForm.hasConsumerKey ? "Leave blank to keep saved key" : "Enter consumer key"}
              />
              <div className="mt-1 text-xs text-slate-500">{paymentForm.hasConsumerKey ? `Saved: ${paymentForm.consumerKeyMasked || "Yes"}` : "No saved consumer key yet."}</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Consumer Secret</label>
              <Input
                type="password"
                value={paymentForm.consumerSecret}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, consumerSecret: e.target.value }))}
                placeholder={paymentForm.hasConsumerSecret ? "Leave blank to keep saved secret" : "Enter consumer secret"}
              />
              <div className="mt-1 text-xs text-slate-500">{paymentForm.hasConsumerSecret ? `Saved: ${paymentForm.consumerSecretMasked || "Yes"}` : "No saved consumer secret yet."}</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Passkey</label>
              <Input
                type="password"
                value={paymentForm.passkey}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, passkey: e.target.value }))}
                placeholder={paymentForm.hasPasskey ? "Leave blank to keep saved passkey" : "Enter passkey"}
              />
              <div className="mt-1 text-xs text-slate-500">{paymentForm.hasPasskey ? `Saved: ${paymentForm.passkeyMasked || "Yes"}` : "No saved passkey yet."}</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">M-Pesa Response Mode</label>
              <Select value={paymentForm.responseType} onChange={(e) => setPaymentForm((prev) => ({ ...prev, responseType: e.target.value }))}>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </Select>
              <div className="mt-1 text-xs text-slate-500">Recommended: Completed, so valid customer-to-business transactions are finalized by M-Pesa.</div>
            </div>
          </div>
        </Card>

        <Card title="Safeguards & Processing Rules" subtitle="Choose safe defaults so unmatched or invalid payments never corrupt accounting.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-bold text-slate-700">Unmatched Payment Handling</label>
              <Select value={paymentForm.unmatchedPaymentMode} onChange={(e) => setPaymentForm((prev) => ({ ...prev, unmatchedPaymentMode: e.target.value }))}>
                <option value="manual_review">Send to manual review</option>
                <option value="hold_unallocated">Hold as unallocated payment</option>
              </Select>
              <div className="mt-1 text-xs text-slate-500">Recommended for now: manual review, until callback posting is fully wired end to end.</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Matched Payment Processing</label>
              <Select value={paymentForm.postingMode} onChange={(e) => setPaymentForm((prev) => ({ ...prev, postingMode: e.target.value }))}>
                <option value="manual_review">Manual review before posting</option>
                <option value="auto_post_matched">Auto-post matched payments</option>
              </Select>
              <div className="mt-1 text-xs text-slate-500">Manual review remains the safer default for a production-safe first phase.</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <FaShieldAlt className="text-emerald-600" /> Company isolation
              </div>
              <div className="mt-2 text-xs leading-5 text-slate-600">Each saved Paybill configuration remains company-bound. Matching is still designed around Paybill number plus tenant code.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <FaUniversity className="text-[#F97316]" /> Accounting safety
              </div>
              <div className="mt-2 text-xs leading-5 text-slate-600">This page stores configuration only. It does not silently create receipts, ledger entries or callback postings outside the existing accounting flow.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <FaLock className="text-slate-700" /> Saved credentials
              </div>
              <div className="mt-2 text-xs leading-5 text-slate-600">Saved credentials stay masked on screen. Enter a new value only when you want to replace the current secret.</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Selected config</div>
              <div className="mt-2 text-sm font-extrabold text-slate-900">{paymentForm.name || "New Paybill Configuration"}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Paybill number</div>
              <div className="mt-2 text-sm font-extrabold text-slate-900">{paymentForm.shortCode || "Not set"}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Receiving cashbook</div>
              <div className="mt-2 text-sm font-extrabold text-slate-900">{cashbookLabel}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Last updated</div>
              <div className="mt-2 text-sm font-extrabold text-slate-900">{formatDateTime(paymentForm.lastConfiguredAt)}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={resetPaymentEditor}>
              Reset
            </button>
            {selectedPaymentConfigId !== PAYMENT_DRAFT_ID ? (
              <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={beginCreatePaymentConfig}>
                New Config
              </button>
            ) : null}
            <button disabled={savingPayments} onClick={handleSavePaymentConfig} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingPayments ? "Saving..." : selectedPaymentConfigId === PAYMENT_DRAFT_ID ? "Save New Config" : "Update Config"}
            </button>
          </div>
        </Card>

        <Card title="Tax Configuration" subtitle="Company-wide VAT / tax foundation for invoices, penalties and commission logic. Management commission VAT is further refined inside Property Commission Settings.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ToggleRow
              checked={taxConfig.taxSettings.enabled}
              onChange={(e) => handleTaxSettingChange("enabled", e.target.checked)}
              title="Enable tax engine"
              description="Turn on structured VAT / tax handling for this company. Core accounting remains isolated from communication and non-financial modules."
            />
            <ToggleRow
              checked={taxConfig.taxSettings.invoiceTaxableByDefault}
              onChange={(e) => handleTaxSettingChange("invoiceTaxableByDefault", e.target.checked)}
              title="Invoices taxable by default"
              description="Used as the fallback taxability rule when no stricter category toggle is set."
            />
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Mode</label>
              <Select value={taxConfig.taxSettings.defaultTaxMode} onChange={(e) => handleTaxSettingChange("defaultTaxMode", e.target.value)}>
                <option value="exclusive">Exclusive</option>
                <option value="inclusive">Inclusive</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default VAT Rate (%)</label>
              <Input type="number" min="0" step="0.01" value={taxConfig.taxSettings.defaultVatRate} onChange={(e) => handleTaxSettingChange("defaultVatRate", Number(e.target.value || 0))} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Code</label>
              <Select value={taxConfig.taxSettings.defaultTaxCodeKey} onChange={(e) => handleTaxSettingChange("defaultTaxCodeKey", e.target.value)}>
                {taxConfig.taxCodes.map((code) => (
                  <option key={code._id || code.key} value={code.key}>{code.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Output VAT / Tax Payable Account Code</label>
              <Input value={taxConfig.taxSettings.outputVatAccountCode} onChange={(e) => handleTaxSettingChange("outputVatAccountCode", e.target.value)} placeholder="2140" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.rent} onChange={(e) => handleTaxCategoryToggle("rent", e.target.checked)} title="Rent charge taxable" description="Default rent-charge taxability rule for tenant invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.utility} onChange={(e) => handleTaxCategoryToggle("utility", e.target.checked)} title="Utility recharge taxable" description="Keeps utility treatment configurable instead of assumed." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.penalty} onChange={(e) => handleTaxCategoryToggle("penalty", e.target.checked)} title="Penalty invoice taxable" description="Phase 1 supports penalty tax treatment separately from normal invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.deposit} onChange={(e) => handleTaxCategoryToggle("deposit", e.target.checked)} title="Deposit charge taxable" description="Recommended off for standard deposit liabilities unless your policy explicitly requires otherwise." />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-slate-900">Tax Codes</div>
              <div className="mt-1 text-xs text-slate-500">Maintain reusable tax codes for invoices and commission settings. Keep one default code active.</div>
            </div>
            <button onClick={handleAddTaxCode} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
              <FaPlus /> Add Tax Code
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {taxConfig.taxCodes.map((code, index) => (
              <div key={code._id || `${code.key}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div>
                    <label className="text-xs font-bold text-slate-700">Key</label>
                    <Input value={code.key} onChange={(e) => handleTaxCodeChange(index, "key", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Name</label>
                    <Input value={code.name} onChange={(e) => handleTaxCodeChange(index, "name", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Type</label>
                    <Select value={code.type} onChange={(e) => handleTaxCodeChange(index, "type", e.target.value)}>
                      <option value="vat">VAT</option>
                      <option value="zero_rated">Zero Rated</option>
                      <option value="exempt">Exempt</option>
                      <option value="none">No Tax</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Rate (%)</label>
                    <Input type="number" min="0" step="0.01" value={code.rate} onChange={(e) => handleTaxCodeChange(index, "rate", e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isDefault)} onChange={(e) => handleTaxCodeChange(index, "isDefault", e.target.checked)} /> Default
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isActive)} onChange={(e) => handleTaxCodeChange(index, "isActive", e.target.checked)} /> Active
                  </label>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-slate-700">Description</label>
                    <Input value={code.description || ""} onChange={(e) => handleTaxCodeChange(index, "description", e.target.value)} />
                  </div>
                  <button onClick={() => handleRemoveTaxCode(index)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                    <FaTrashAlt /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <button disabled={savingTaxConfig} onClick={handleSaveTaxConfiguration} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0B3B2E] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingTaxConfig ? "Saving..." : "Save Tax Configuration"}
            </button>
          </div>
        </Card>

      </div>
    </div>
  );


  const renderEmailTab = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1.6fr]">
      <div className="space-y-4">
        <Card
          title="Email Config Overview"
          subtitle="Manage one or many SMTP profiles for the active company. One enabled default profile can power receipts, invoices, statements and notices safely."
          action={
            <button onClick={beginCreateEmailProfile} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:opacity-95">
              <FaPlus /> Add Email Profile
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Total profiles</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{emailSummary.total}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Enabled</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{emailSummary.active}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{emailSummary.configured}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Default profiles</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{emailSummary.defaults}</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FaPlug className="text-[#F97316]" /> Delivery safety rule
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              Each SMTP profile remains company-bound. The backend stays the source of truth, saved passwords remain masked, and one default enabled profile can be used across operational mail flows.
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FaEnvelope className="text-emerald-600" /> Internal copy handling
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              Use an internal copy email when the company wants a business mailbox to receive copies of outgoing emails. BCC remains the safer default for tenant-facing communication.
            </div>
          </div>
        </Card>

        <Card title="Configured Email Profiles" subtitle="Open any saved SMTP profile to edit it, or create a new one for the active company.">
          <div className="space-y-3">
            {emailProfiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                No email profile has been added for this company yet.
              </div>
            ) : (
              emailProfiles.map((profile) => {
                const status = buildEmailStatus(profile);
                const theme = statusTheme[status.code] || statusTheme.not_configured;
                const isSelected = String(selectedEmailProfileId) === String(profile._id);
                return (
                  <div
                    key={profile._id}
                    className={[
                      "rounded-2xl border p-4 transition",
                      isSelected ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-slate-300",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 flex-1 text-left" onClick={() => beginEditEmailProfile(profile)}>
                        <div className="flex items-center gap-2">
                          <FaServer className="text-slate-400" />
                          <div className="truncate text-sm font-extrabold text-slate-900">{profile.name}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Sender: {profile.senderEmail || "Not set"}</div>
                        <div className="mt-1 text-xs text-slate-500">SMTP: {profile.smtpHost || "Not set"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                          {profile.isDefault ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-700">Default</span> : null}
                          <span className={`rounded-full border px-2 py-1 font-bold ${resolveEmailTestBadge(profile.lastTestStatus)}`}>
                            Test: {profile.lastTestStatus || "never"}
                          </span>
                        </div>
                      </button>
                      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold ${theme.badge}`}>
                        {theme.icon}
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => beginEditEmailProfile(profile)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                        <span className="inline-flex items-center gap-2"><FaPen /> Edit</span>
                      </button>
                      <button
                        onClick={() => handleQuickEmailUpdate(profile, { enabled: !profile.enabled, isDefault: profile.enabled ? false : profile.isDefault }, profile.enabled ? "Email profile disabled" : "Email profile enabled")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <span className="inline-flex items-center gap-2"><FaPowerOff /> {profile.enabled ? "Disable" : "Enable"}</span>
                      </button>
                      <button
                        onClick={() => handleQuickEmailUpdate(profile, { isDefault: true, enabled: true }, "Email profile set as default")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <span className="inline-flex items-center gap-2"><FaCheckCircle /> Set Default</span>
                      </button>
                      <button onClick={() => handleSendTestEmail(profile)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100">
                        <span className="inline-flex items-center gap-2"><FaPaperPlane /> Send Test</span>
                      </button>
                      <button onClick={() => handleDeleteEmailProfile(profile)} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                        <span className="inline-flex items-center gap-2"><FaTrashAlt /> Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card
          title={selectedEmailProfileId === EMAIL_DRAFT_ID ? "New Email Profile" : "Email Config Details"}
          subtitle="Save the sender details, SMTP server settings, internal copy preferences and purpose tags for this company profile."
          action={
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${emailTheme.badge}`}>
              {emailTheme.icon}
              {emailStatus.label}
            </span>
          }
        >
          <div className={`rounded-2xl border p-4 ${emailTheme.panel}`}>
            <div className="flex items-start gap-3">
              <div className="mt-1 text-lg">{emailTheme.icon}</div>
              <div>
                <div className="text-sm font-extrabold text-slate-900">{emailStatus.label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-700">{emailStatus.reason}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Profile Name</label>
              <Input value={emailForm.name} onChange={(e) => setEmailForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Example: Main Business Email" />
              <div className="mt-1 text-xs text-slate-500">Use a clear internal name so company admins can easily identify the right SMTP profile.</div>
            </div>

            <div className="md:col-span-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ToggleRow
                checked={emailForm.enabled}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, enabled: e.target.checked, isDefault: e.target.checked ? prev.isDefault : false }))}
                title="Enable this email profile"
                description="Turn this on when this profile is ready to send operational emails for the active company."
              />
              <ToggleRow
                checked={emailForm.isDefault}
                onChange={(e) => setEmailForm((prev) => ({ ...prev, isDefault: e.target.checked, enabled: e.target.checked ? true : prev.enabled }))}
                title="Set as default sender"
                description="The default enabled profile can be used by receipts, invoices, landlord statements and future system notices."
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Sender Name</label>
              <Input value={emailForm.senderName} onChange={(e) => setEmailForm((prev) => ({ ...prev, senderName: e.target.value }))} placeholder="ABRI REALTORS" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Sender Email</label>
              <Input type="email" value={emailForm.senderEmail} onChange={(e) => setEmailForm((prev) => ({ ...prev, senderEmail: e.target.value }))} placeholder="info@company.com" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Reply-To Email</label>
              <Input type="email" value={emailForm.replyTo} onChange={(e) => setEmailForm((prev) => ({ ...prev, replyTo: e.target.value }))} placeholder="support@company.com" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">SMTP Host</label>
              <Input value={emailForm.smtpHost} onChange={(e) => setEmailForm((prev) => ({ ...prev, smtpHost: e.target.value }))} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">SMTP Port</label>
              <Input type="number" value={emailForm.smtpPort} onChange={(e) => setEmailForm((prev) => ({ ...prev, smtpPort: e.target.value }))} placeholder="465" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Encryption</label>
              <Select value={emailForm.encryption} onChange={(e) => setEmailForm((prev) => ({ ...prev, encryption: e.target.value }))}>
                <option value="ssl">SSL</option>
                <option value="tls">TLS</option>
                <option value="none">None</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">SMTP Username</label>
              <Input value={emailForm.username} onChange={(e) => setEmailForm((prev) => ({ ...prev, username: e.target.value }))} placeholder="your-smtp-username" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">SMTP Password / App Password</label>
              <Input type="password" value={emailForm.password} onChange={(e) => setEmailForm((prev) => ({ ...prev, password: e.target.value }))} placeholder={emailForm.hasPassword ? "Leave blank to keep saved password" : "Enter SMTP password"} />
              <div className="mt-1 text-xs text-slate-500">{emailForm.hasPassword ? emailForm.passwordMasked || "Saved and masked" : "No saved password yet."}</div>
            </div>
          </div>
        </Card>

        <Card title="Internal Copy & Usage Rules" subtitle="Choose how the company should receive copies of sent emails and where this SMTP profile will be used.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-bold text-slate-700">Internal Copy Email</label>
              <Input type="email" value={emailForm.internalCopyEmail} onChange={(e) => setEmailForm((prev) => ({ ...prev, internalCopyEmail: e.target.value }))} placeholder="backoffice@company.com" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Internal Copy Mode</label>
              <Select value={emailForm.internalCopyMode} onChange={(e) => setEmailForm((prev) => ({ ...prev, internalCopyMode: e.target.value }))}>
                <option value="none">No internal copy</option>
                <option value="bcc">BCC internal copy</option>
                <option value="cc">CC internal copy</option>
              </Select>
              <div className="mt-1 text-xs text-slate-500">BCC is the safer default for tenant-facing emails.</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-bold text-slate-700">Usage Tags</div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {emailUsageOptions.map((option) => {
                const checked = emailForm.usageTags.includes(option.value);
                return (
                  <label key={option.value} className={[
                    "flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition",
                    checked ? "border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-white hover:border-slate-300",
                  ].join(" ")}>
                    <input type="checkbox" checked={checked} onChange={() => toggleUsageTag(option.value)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    <span className="font-semibold text-slate-800">{option.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Selected profile</div>
                <div className="mt-2 text-sm font-extrabold text-slate-900">{emailForm.name || "New Email Profile"}</div>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Sender</div>
                <div className="mt-2 text-sm font-extrabold text-slate-900">{emailForm.senderEmail || "Not set"}</div>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Last test</div>
                <div className="mt-2 text-sm font-extrabold text-slate-900">{formatDateTime(emailForm.lastTestedAt)}</div>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Test status</div>
                <div className="mt-2">
                  <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${resolveEmailTestBadge(emailForm.lastTestStatus)}`}>
                    {emailForm.lastTestStatus || "never"}
                  </span>
                </div>
              </div>
            </div>
            {emailForm.lastTestMessage ? (
              <div className="mt-3 text-xs text-slate-600">{emailForm.lastTestMessage}</div>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_auto] md:items-end">
            <div>
              <label className="text-xs font-bold text-slate-700">Test Recipient Email</label>
              <Input type="email" value={emailForm.testRecipient} onChange={(e) => setEmailForm((prev) => ({ ...prev, testRecipient: e.target.value }))} placeholder={currentCompany?.email || "company@example.com"} />
              <div className="mt-1 text-xs text-slate-500">Use this to verify the saved SMTP profile before relying on it for live communication.</div>
            </div>
            <button disabled={testingEmail || selectedEmailProfileId === EMAIL_DRAFT_ID} onClick={() => handleSendTestEmail()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60">
              <FaPaperPlane /> {testingEmail ? "Sending..." : "Send Test Email"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={resetEmailEditor}>
              Reset
            </button>
            {selectedEmailProfileId !== EMAIL_DRAFT_ID ? (
              <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={beginCreateEmailProfile}>
                New Profile
              </button>
            ) : null}
            <button disabled={savingEmails} onClick={handleSaveEmailProfile} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingEmails ? "Saving..." : selectedEmailProfileId === EMAIL_DRAFT_ID ? "Save New Profile" : "Update Profile"}
            </button>
          </div>
        </Card>

        <Card title="Tax Configuration" subtitle="Company-wide VAT / tax foundation for invoices, penalties and commission logic. Management commission VAT is further refined inside Property Commission Settings.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ToggleRow
              checked={taxConfig.taxSettings.enabled}
              onChange={(e) => handleTaxSettingChange("enabled", e.target.checked)}
              title="Enable tax engine"
              description="Turn on structured VAT / tax handling for this company. Core accounting remains isolated from communication and non-financial modules."
            />
            <ToggleRow
              checked={taxConfig.taxSettings.invoiceTaxableByDefault}
              onChange={(e) => handleTaxSettingChange("invoiceTaxableByDefault", e.target.checked)}
              title="Invoices taxable by default"
              description="Used as the fallback taxability rule when no stricter category toggle is set."
            />
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Mode</label>
              <Select value={taxConfig.taxSettings.defaultTaxMode} onChange={(e) => handleTaxSettingChange("defaultTaxMode", e.target.value)}>
                <option value="exclusive">Exclusive</option>
                <option value="inclusive">Inclusive</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default VAT Rate (%)</label>
              <Input type="number" min="0" step="0.01" value={taxConfig.taxSettings.defaultVatRate} onChange={(e) => handleTaxSettingChange("defaultVatRate", Number(e.target.value || 0))} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Code</label>
              <Select value={taxConfig.taxSettings.defaultTaxCodeKey} onChange={(e) => handleTaxSettingChange("defaultTaxCodeKey", e.target.value)}>
                {taxConfig.taxCodes.map((code) => (
                  <option key={code._id || code.key} value={code.key}>{code.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Output VAT / Tax Payable Account Code</label>
              <Input value={taxConfig.taxSettings.outputVatAccountCode} onChange={(e) => handleTaxSettingChange("outputVatAccountCode", e.target.value)} placeholder="2140" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.rent} onChange={(e) => handleTaxCategoryToggle("rent", e.target.checked)} title="Rent charge taxable" description="Default rent-charge taxability rule for tenant invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.utility} onChange={(e) => handleTaxCategoryToggle("utility", e.target.checked)} title="Utility recharge taxable" description="Keeps utility treatment configurable instead of assumed." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.penalty} onChange={(e) => handleTaxCategoryToggle("penalty", e.target.checked)} title="Penalty invoice taxable" description="Phase 1 supports penalty tax treatment separately from normal invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.deposit} onChange={(e) => handleTaxCategoryToggle("deposit", e.target.checked)} title="Deposit charge taxable" description="Recommended off for standard deposit liabilities unless your policy explicitly requires otherwise." />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-slate-900">Tax Codes</div>
              <div className="mt-1 text-xs text-slate-500">Maintain reusable tax codes for invoices and commission settings. Keep one default code active.</div>
            </div>
            <button onClick={handleAddTaxCode} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
              <FaPlus /> Add Tax Code
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {taxConfig.taxCodes.map((code, index) => (
              <div key={code._id || `${code.key}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div>
                    <label className="text-xs font-bold text-slate-700">Key</label>
                    <Input value={code.key} onChange={(e) => handleTaxCodeChange(index, "key", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Name</label>
                    <Input value={code.name} onChange={(e) => handleTaxCodeChange(index, "name", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Type</label>
                    <Select value={code.type} onChange={(e) => handleTaxCodeChange(index, "type", e.target.value)}>
                      <option value="vat">VAT</option>
                      <option value="zero_rated">Zero Rated</option>
                      <option value="exempt">Exempt</option>
                      <option value="none">No Tax</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Rate (%)</label>
                    <Input type="number" min="0" step="0.01" value={code.rate} onChange={(e) => handleTaxCodeChange(index, "rate", e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isDefault)} onChange={(e) => handleTaxCodeChange(index, "isDefault", e.target.checked)} /> Default
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isActive)} onChange={(e) => handleTaxCodeChange(index, "isActive", e.target.checked)} /> Active
                  </label>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-slate-700">Description</label>
                    <Input value={code.description || ""} onChange={(e) => handleTaxCodeChange(index, "description", e.target.value)} />
                  </div>
                  <button onClick={() => handleRemoveTaxCode(index)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                    <FaTrashAlt /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <button disabled={savingTaxConfig} onClick={handleSaveTaxConfiguration} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0B3B2E] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingTaxConfig ? "Saving..." : "Save Tax Configuration"}
            </button>
          </div>
        </Card>

      </div>
    </div>
  );

  const renderSmsConfiguration = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1.65fr]">
      <div className="space-y-4">
        <Card
          title="SMS Configuration Overview"
          subtitle="Manage one or many SMS provider profiles for the active company. Keep them company-bound and activate only the profiles you trust for live delivery."
          action={
            <button onClick={beginCreateSmsProfile} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:opacity-95">
              <FaPlus /> Add Configuration
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Total profiles</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{smsSummary.total}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Enabled</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{smsSummary.active}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{smsSummary.configured}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Default profiles</div>
              <div className="mt-2 text-2xl font-extrabold text-slate-900">{smsSummary.defaults}</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FaPlug className="text-[#F97316]" /> Delivery safety rule
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              SMS provider credentials stay saved per company. Templates can use the company default profile or a specific profile, and automation remains separate from configuration so users do not send messages by mistake.
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FaSms className="text-emerald-600" /> Current product scope
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              This pass sets up SMS configurations and SMS templates safely. Live provider testing and fully wired business-event sending should follow in the next delivery pass.
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Configured SMS Profiles" subtitle="Open any saved SMS configuration to edit it, or create a new one for the active company.">
          <div className="space-y-3">
            {smsProfiles.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                No SMS configuration has been added for this company yet.
              </div>
            ) : (
              smsProfiles.map((profile) => {
                const status = buildSmsStatus(profile);
                const theme = statusTheme[status.code] || statusTheme.not_configured;
                const providerLabel = smsProviderOptions.find((option) => option.value === profile.provider)?.label || profile.provider;
                return (
                  <div key={profile._id} className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300">
                    <div className="flex items-start justify-between gap-3">
                      <button className="min-w-0 flex-1 text-left" onClick={() => beginEditSmsProfile(profile)}>
                        <div className="flex items-center gap-2">
                          <FaSms className="text-slate-400" />
                          <div className="truncate text-sm font-extrabold text-slate-900">{profile.name}</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">Provider: {providerLabel}</div>
                        <div className="mt-1 text-xs text-slate-500">Sender ID: {profile.senderId || "Not set"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                          {profile.isDefault ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-700">Default</span> : null}
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-bold text-slate-600">Country: {profile.defaultCountryCode || "+254"}</span>
                        </div>
                      </button>
                      <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold ${theme.badge}`}>
                        {theme.icon}
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => beginEditSmsProfile(profile)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                        <span className="inline-flex items-center gap-2"><FaPen /> Edit</span>
                      </button>
                      <button
                        onClick={() => handleQuickSmsProfileUpdate(profile, { enabled: !profile.enabled, isDefault: profile.enabled ? false : profile.isDefault }, profile.enabled ? "SMS configuration disabled" : "SMS configuration enabled")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <span className="inline-flex items-center gap-2"><FaPowerOff /> {profile.enabled ? "Disable" : "Enable"}</span>
                      </button>
                      <button
                        onClick={() => handleQuickSmsProfileUpdate(profile, { isDefault: true, enabled: true }, "SMS configuration set as default")}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <span className="inline-flex items-center gap-2"><FaCheckCircle /> Set Default</span>
                      </button>
                      <button onClick={() => handleDeleteSmsProfile(profile)} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                        <span className="inline-flex items-center gap-2"><FaTrashAlt /> Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card title="Tax Configuration" subtitle="Company-wide VAT / tax foundation for invoices, penalties and commission logic. Management commission VAT is further refined inside Property Commission Settings.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ToggleRow
              checked={taxConfig.taxSettings.enabled}
              onChange={(e) => handleTaxSettingChange("enabled", e.target.checked)}
              title="Enable tax engine"
              description="Turn on structured VAT / tax handling for this company. Core accounting remains isolated from communication and non-financial modules."
            />
            <ToggleRow
              checked={taxConfig.taxSettings.invoiceTaxableByDefault}
              onChange={(e) => handleTaxSettingChange("invoiceTaxableByDefault", e.target.checked)}
              title="Invoices taxable by default"
              description="Used as the fallback taxability rule when no stricter category toggle is set."
            />
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Mode</label>
              <Select value={taxConfig.taxSettings.defaultTaxMode} onChange={(e) => handleTaxSettingChange("defaultTaxMode", e.target.value)}>
                <option value="exclusive">Exclusive</option>
                <option value="inclusive">Inclusive</option>
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default VAT Rate (%)</label>
              <Input type="number" min="0" step="0.01" value={taxConfig.taxSettings.defaultVatRate} onChange={(e) => handleTaxSettingChange("defaultVatRate", Number(e.target.value || 0))} />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Default Tax Code</label>
              <Select value={taxConfig.taxSettings.defaultTaxCodeKey} onChange={(e) => handleTaxSettingChange("defaultTaxCodeKey", e.target.value)}>
                {taxConfig.taxCodes.map((code) => (
                  <option key={code._id || code.key} value={code.key}>{code.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Output VAT / Tax Payable Account Code</label>
              <Input value={taxConfig.taxSettings.outputVatAccountCode} onChange={(e) => handleTaxSettingChange("outputVatAccountCode", e.target.value)} placeholder="2140" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.rent} onChange={(e) => handleTaxCategoryToggle("rent", e.target.checked)} title="Rent charge taxable" description="Default rent-charge taxability rule for tenant invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.utility} onChange={(e) => handleTaxCategoryToggle("utility", e.target.checked)} title="Utility recharge taxable" description="Keeps utility treatment configurable instead of assumed." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.penalty} onChange={(e) => handleTaxCategoryToggle("penalty", e.target.checked)} title="Penalty invoice taxable" description="Phase 1 supports penalty tax treatment separately from normal invoices." />
            <ToggleRow checked={taxConfig.taxSettings.invoiceTaxabilityByCategory.deposit} onChange={(e) => handleTaxCategoryToggle("deposit", e.target.checked)} title="Deposit charge taxable" description="Recommended off for standard deposit liabilities unless your policy explicitly requires otherwise." />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <div>
              <div className="text-sm font-extrabold text-slate-900">Tax Codes</div>
              <div className="mt-1 text-xs text-slate-500">Maintain reusable tax codes for invoices and commission settings. Keep one default code active.</div>
            </div>
            <button onClick={handleAddTaxCode} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
              <FaPlus /> Add Tax Code
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {taxConfig.taxCodes.map((code, index) => (
              <div key={code._id || `${code.key}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <div>
                    <label className="text-xs font-bold text-slate-700">Key</label>
                    <Input value={code.key} onChange={(e) => handleTaxCodeChange(index, "key", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Name</label>
                    <Input value={code.name} onChange={(e) => handleTaxCodeChange(index, "name", e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Type</label>
                    <Select value={code.type} onChange={(e) => handleTaxCodeChange(index, "type", e.target.value)}>
                      <option value="vat">VAT</option>
                      <option value="zero_rated">Zero Rated</option>
                      <option value="exempt">Exempt</option>
                      <option value="none">No Tax</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700">Rate (%)</label>
                    <Input type="number" min="0" step="0.01" value={code.rate} onChange={(e) => handleTaxCodeChange(index, "rate", e.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isDefault)} onChange={(e) => handleTaxCodeChange(index, "isDefault", e.target.checked)} /> Default
                  </label>
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={Boolean(code.isActive)} onChange={(e) => handleTaxCodeChange(index, "isActive", e.target.checked)} /> Active
                  </label>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-bold text-slate-700">Description</label>
                    <Input value={code.description || ""} onChange={(e) => handleTaxCodeChange(index, "description", e.target.value)} />
                  </div>
                  <button onClick={() => handleRemoveTaxCode(index)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100">
                    <FaTrashAlt /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <button disabled={savingTaxConfig} onClick={handleSaveTaxConfiguration} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0B3B2E] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingTaxConfig ? "Saving..." : "Save Tax Configuration"}
            </button>
          </div>
        </Card>

      </div>
    </div>
  );

  const renderSmsTemplatesTab = () => (
    <div className="space-y-4">
      <Card
        title="SMS Template Operations"
        subtitle="Control what MILIK says and when it sends it. Keep transactional messages separated from provider configuration."
        action={
          <button onClick={handleResetSmsTemplates} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
            <FaSyncAlt /> Reset Defaults
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Templates</div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">{smsTemplates.length}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Enabled</div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">{smsTemplates.filter((template) => template.enabled).length}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Automatic</div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">{smsSummary.automatedTemplates}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Default SMS profile</div>
            <div className="mt-2 text-sm font-extrabold text-slate-900">{currentCompany?.communication?.defaultSmsProfile?.name || "Not selected"}</div>
          </div>
        </div>
      </Card>

      <Card title="Configured SMS Templates" subtitle="These templates cover the core tenant and landlord SMS operations you selected for MILIK.">
        <div className="space-y-3">
          {smsTemplates.map((template) => (
            <div key={template._id || template.key} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-extrabold text-slate-900">{template.name}</div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">{smsRecipientLabels[template.recipientType] || template.recipientType}</span>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${template.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {template.enabled ? "Enabled" : "Disabled"}
                    </span>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-bold ${template.sendMode === "automatic" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                      {template.sendMode === "automatic" ? "Automatic" : "Manual"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{template.description}</div>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    {template.messageBody}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>Profile: {template.usesDefaultProfile ? "Use company default" : template.profileName || "Specific profile"}</span>
                    <span>•</span>
                    <span>Updated: {formatDateTime(template.lastUpdatedAt)}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openSmsTemplateEditor(template)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">
                    <span className="inline-flex items-center gap-2"><FaPen /> Edit</span>
                  </button>
                  <button
                    onClick={() => handleQuickSmsTemplateUpdate(template, { enabled: !template.enabled }, template.enabled ? "SMS template disabled" : "SMS template enabled")}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    <span className="inline-flex items-center gap-2"><FaPowerOff /> {template.enabled ? "Disable" : "Enable"}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  const renderSmsTab = () => (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-extrabold text-slate-900">SMS</div>
          <div className="mt-1 text-xs text-slate-600">Keep configuration separate from message operations so company admins can set providers safely and manage message wording independently.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: "configuration", label: "Configuration", icon: <FaServer /> },
            { key: "templates", label: "SMS Templates", icon: <FaListAlt /> },
          ].map((item) => {
            const isActive = activeSmsSection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => switchSmsSection(item.key)}
                className={[
                  "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition",
                  isActive
                    ? "border-transparent bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeSmsSection === "templates" ? renderSmsTemplatesTab() : renderSmsConfiguration()}
    </div>
  );

  const renderTab = () => {
    switch (activeTab) {
      case "details":
        return renderDetailsTab();
      case "payments":
        return renderPaymentsTab();
      case "email":
        return renderEmailTab();
      case "sms":
        return renderSmsTab();
      default:
        return (
          <Card title="Coming Soon" subtitle="This tab is preserved and ready for the next implementation pass.">
            <div className="text-sm text-slate-700">This section is ready for wiring. The current pass focused on the live company details flow and the multi-Paybill payment configuration foundation.</div>
          </Card>
        );
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1200px] px-4 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xl font-extrabold text-slate-900">Company Setup</div>
            <div className="text-sm text-slate-600">Configure the active company and navigate setup sections using the tabs above. The selected tab now stays reflected in the page URL.</div>
          </div>

          <div className="flex items-center gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50">Export Settings</button>
            <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95">View Audit Log</button>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/40 bg-white/50 p-2 backdrop-blur-xl">
          <div className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  className={[
                    "flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-extrabold transition",
                    isActive
                      ? "border-transparent bg-gradient-to-r from-[#F97316] to-[#16A34A] text-white"
                      : "border-slate-200 bg-white/70 text-slate-800 hover:bg-white",
                  ].join(" ")}
                >
                  <span className="text-sm">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">{renderTab()}</div>
      </div>

      <Modal
        open={smsConfigModalOpen}
        onClose={closeSmsConfigModal}
        title={selectedSmsProfileId === SMS_DRAFT_ID ? "New SMS Configuration" : "SMS Configuration Details"}
        subtitle="Add provider credentials, sender identity and company delivery defaults for this SMS profile."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={resetSmsEditor}>
              Reset
            </button>
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={closeSmsConfigModal}>
              Cancel
            </button>
            <button disabled={savingSmsProfiles} onClick={handleSaveSmsProfile} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingSmsProfiles ? "Saving..." : selectedSmsProfileId === SMS_DRAFT_ID ? "Save Configuration" : "Update Configuration"}
            </button>
          </div>
        }
      >
        <div className={`rounded-2xl border p-4 ${smsTheme.panel}`}>
          <div className="flex items-start gap-3">
            <div className="mt-1 text-lg">{smsTheme.icon}</div>
            <div>
              <div className="text-sm font-extrabold text-slate-900">{smsStatus.label}</div>
              <div className="mt-1 text-xs leading-5 text-slate-700">{smsStatus.reason}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-xs font-bold text-slate-700">Configuration Name</label>
            <Input value={smsForm.name} onChange={(e) => setSmsForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Example: Main Tenant SMS" />
          </div>

          <div className="md:col-span-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ToggleRow
              checked={smsForm.enabled}
              onChange={(e) => setSmsForm((prev) => ({ ...prev, enabled: e.target.checked, isDefault: e.target.checked ? prev.isDefault : false }))}
              title="Enable this SMS configuration"
              description="Turn this on when this provider profile should remain available for the active company."
            />
            <ToggleRow
              checked={smsForm.isDefault}
              onChange={(e) => setSmsForm((prev) => ({ ...prev, isDefault: e.target.checked, enabled: e.target.checked ? true : prev.enabled }))}
              title="Set as default SMS profile"
              description="The default enabled SMS profile can be used by templates that do not choose a specific provider profile."
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Provider</label>
            <Select value={smsForm.provider} onChange={(e) => setSmsForm((prev) => ({ ...prev, provider: e.target.value }))}>
              {smsProviderOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">Sender ID / Shortcode</label>
            <Input value={smsForm.senderId} onChange={(e) => setSmsForm((prev) => ({ ...prev, senderId: e.target.value }))} placeholder="MILIK" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">Provider Account Username</label>
            <Input value={smsForm.accountUsername} onChange={(e) => setSmsForm((prev) => ({ ...prev, accountUsername: e.target.value }))} placeholder="Provider account username" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">Default Country Code</label>
            <Input value={smsForm.defaultCountryCode} onChange={(e) => setSmsForm((prev) => ({ ...prev, defaultCountryCode: e.target.value }))} placeholder="+254" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">API Key</label>
            <Input type="password" value={smsForm.apiKey} onChange={(e) => setSmsForm((prev) => ({ ...prev, apiKey: e.target.value }))} placeholder={smsForm.hasApiKey ? "Leave blank to keep saved API key" : "Enter API key"} />
            <div className="mt-1 text-xs text-slate-500">{smsForm.hasApiKey ? smsForm.apiKeyMasked || "Saved and masked" : "No saved API key yet."}</div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">API Secret / Token</label>
            <Input type="password" value={smsForm.apiSecret} onChange={(e) => setSmsForm((prev) => ({ ...prev, apiSecret: e.target.value }))} placeholder={smsForm.hasApiSecret ? "Leave blank to keep saved secret" : "Optional secret or token"} />
            <div className="mt-1 text-xs text-slate-500">{smsForm.hasApiSecret ? smsForm.apiSecretMasked || "Saved and masked" : "Optional if your provider only needs an API key."}</div>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-bold text-slate-700">Callback / Webhook URL</label>
            <Input value={smsForm.callbackUrl} onChange={(e) => setSmsForm((prev) => ({ ...prev, callbackUrl: e.target.value }))} placeholder="Optional provider callback URL" />
            <div className="mt-1 text-xs text-slate-500">Store it now if your provider requires delivery callbacks later.</div>
          </div>
        </div>
      </Modal>

      <Modal
        open={smsTemplateModalOpen}
        onClose={closeSmsTemplateModal}
        title={smsTemplateForm?.name || "SMS Template"}
        subtitle={smsTemplateForm?.description || "Adjust the message text, send mode and SMS profile for this operation."}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={closeSmsTemplateModal}>
              Cancel
            </button>
            <button disabled={savingSmsTemplates} onClick={handleSaveSmsTemplate} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingSmsTemplates ? "Saving..." : "Save Template"}
            </button>
          </div>
        }
      >
        {smsTemplateForm ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-slate-700">Recipient</label>
                <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
                  {smsRecipientLabels[smsTemplateForm.recipientType] || smsTemplateForm.recipientType}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Sending Mode</label>
                <Select value={smsTemplateForm.sendMode} onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, sendMode: e.target.value }))}>
                  <option value="manual">Manual</option>
                  <option value="automatic">Automatic</option>
                </Select>
              </div>
            </div>

            <ToggleRow
              checked={smsTemplateForm.enabled}
              onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, enabled: e.target.checked }))}
              title="Enable this SMS template"
              description="Keep the template available for this company. Disable it when that operation should never trigger SMS."
            />

            <div>
              <label className="text-xs font-bold text-slate-700">SMS Profile</label>
              <Select value={smsTemplateForm.profileId} onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, profileId: e.target.value }))}>
                <option value="">Use company default profile</option>
                {smsProfiles.map((profile) => (
                  <option key={profile._id} value={profile._id}>
                    {profile.name} {profile.enabled ? "" : "(disabled)"}
                  </option>
                ))}
              </Select>
              <div className="mt-1 text-xs text-slate-500">Choose a specific SMS profile only when this operation should use a dedicated provider account.</div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Message Body</label>
              <textarea
                value={smsTemplateForm.messageBody}
                onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, messageBody: e.target.value }))}
                rows={5}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
                placeholder="Write the SMS template here"
              />
              <div className="mt-1 text-xs text-slate-500">Characters: {smsTemplateForm.messageBody.length}</div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Available placeholders</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {smsTemplateForm.placeholders.map((placeholder) => (
                  <span key={placeholder} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700">
                    {`{${placeholder}}`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </DashboardLayout>
  );
}
