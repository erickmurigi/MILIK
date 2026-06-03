import React, { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { selectCurrentCompany } from "../../redux/selectors";
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
  FaArrowRight,
  FaSearch,
} from "react-icons/fa";
import { getChartOfAccounts, getCompany, getSmsLogs, updateCompany } from "../../redux/apiCalls";
import { adminRequests } from "../../utils/requestMethods";
import { COMPANY_OPERATING_MODES, MODULE_LABELS, hasCompanyModule, normalizeCompanyModules, normalizeCompanyOperatingMode } from "../../utils/companyModules";
import { useConfirm } from "../../context/ConfirmContext";

const PAYMENT_DRAFT_ID = "__new_mpesa_paybill__";
const EMAIL_DRAFT_ID = "__new_email_profile__";
const SMS_DRAFT_ID = "__new_sms_profile__";
const validSmsSections = new Set(["configuration", "templates", "sent", "failed", "pending"]);

const ALL_VALID_TAB_KEYS = new Set(["details", "structure", "modules", "payments", "email", "sms", "activities"]);

const TEMPLATE_MODULE_MAP = {
  receipt_sms_tenant: "propertyManagement",
  invoice_sms_tenant: "propertyManagement",
  overdue_reminder_tenant: "propertyManagement",
  landlord_statement_ready: "propertyManagement",
  landlord_payment_sms: "propertyManagement",
  maintenance_update_tenant: "propertyManagement",
  maintenance_update_landlord: "propertyManagement",
  tenant_notice_sms: "propertyManagement",
  landlord_notice_sms: "propertyManagement",
  penalty_notice_sms: "propertyManagement",
  meter_usage_notification_sms: "propertyManagement",
  carwash_stamp_earned: "carwash",
  carwash_reward_ready: "carwash",
  carwash_reward_redeemed: "carwash",
  carwash_payment_confirmed: "carwash",
  carwash_loyalty_manual: "carwash",
  carwash_job_manual: "carwash",
  carwash_payment_manual: "carwash",
};

const primaryModuleKeys = ["propertyManagement", "accounts"];
const companyOperatingModeOptions = [
  { value: COMPANY_OPERATING_MODES.PROPERTY_MANAGER, label: "Property Manager", description: "Use property-manager wording, landlord workflows, and multi-landlord operations across the workspace." },
  { value: COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD, label: "Self-Managing Landlord", description: "Use owner-managed wording and defaults while preserving the same accounting-safe transaction engine." },
  { value: COMPANY_OPERATING_MODES.OTHER, label: "Other", description: "Use neutral company wording for businesses that do not run property-management or landlord workflows." },
];
const moduleCategories = [
  { key: "primary", title: "Primary Modules", description: "Choose the main operational modules this company will use." },
  { key: "expansion", title: "Expansion Modules", description: "Enable only the additional modules this company truly uses. Disabled modules remain out of the workspace without deleting data." },
];

const Card = ({ title, subtitle, children, action = null }) => (
  <div className="rounded-xl border border-slate-200 bg-white/70 backdrop-blur-xl shadow-sm">
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-3 py-2">
      <div>
        <div className="text-xs font-extrabold text-slate-900">{title}</div>
        {subtitle ? <div className="mt-0.5 text-[11px] text-slate-600">{subtitle}</div> : null}
      </div>
      {action}
    </div>
    <div className="px-3 py-3">{children}</div>
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

const normalizeForm = (company = {}) => {
  const companyMode = normalizeCompanyOperatingMode(company.companyMode || company.operatingMode || company.mode);
  return {
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
    companyMode,
    modules: normalizeCompanyModules(company),
  };
};


const toClientTaxCodeId = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value?.toString) return value.toString();
  return fallback;
};

const sanitizeTaxKey = (value, fallback = "") =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");

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
        _id: toClientTaxCodeId(code?._id, `tax-code-${index + 1}`),
        key: sanitizeTaxKey(code?.key || code?.name, `tax_code_${index + 1}`),
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

const buildTaxSavePayload = (taxConfig = {}) => ({
  taxSettings: {
    enabled: Boolean(taxConfig?.taxSettings?.enabled),
    defaultTaxMode: String(taxConfig?.taxSettings?.defaultTaxMode || "exclusive").toLowerCase() === "inclusive" ? "inclusive" : "exclusive",
    defaultTaxCodeKey: sanitizeTaxKey(taxConfig?.taxSettings?.defaultTaxCodeKey, "vat_standard"),
    defaultVatRate: Number(taxConfig?.taxSettings?.defaultVatRate || 0),
    roundingPrecision: Number(taxConfig?.taxSettings?.roundingPrecision ?? 2),
    outputVatAccountCode: String(taxConfig?.taxSettings?.outputVatAccountCode || "").trim(),
    invoiceTaxableByDefault: Boolean(taxConfig?.taxSettings?.invoiceTaxableByDefault),
    invoiceTaxabilityByCategory: {
      rent: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.rent),
      utility: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.utility),
      penalty: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.penalty),
      deposit: Boolean(taxConfig?.taxSettings?.invoiceTaxabilityByCategory?.deposit),
    },
  },
  taxCodes: (Array.isArray(taxConfig?.taxCodes) ? taxConfig.taxCodes : []).map((code, index) => {
    const rawId = toClientTaxCodeId(code?._id, "");
    const payload = {
      key: sanitizeTaxKey(code?.key || code?.name, `tax_code_${index + 1}`),
      name: String(code?.name || `Tax Code ${index + 1}`).trim(),
      type: String(code?.type || "vat").trim().toLowerCase(),
      rate: Number(code?.rate || 0),
      isDefault: Boolean(code?.isDefault),
      isActive: code?.isActive !== false,
      description: String(code?.description || "").trim(),
    };

    if (/^[a-f\d]{24}$/i.test(rawId)) {
      payload._id = rawId;
    }

    return payload;
  }),
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
  { value: "africas_talking", label: "Africa's Talking", tagline: "Kenya & Africa — recommended", color: "border-emerald-400 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  { value: "twilio",          label: "Twilio",           tagline: "Global leader, any country",  color: "border-red-300 bg-red-50 text-red-800",         dot: "bg-red-500" },
  { value: "mtech",           label: "MTech Africa",     tagline: "Local African provider",      color: "border-blue-300 bg-blue-50 text-blue-800",      dot: "bg-blue-500" },
  { value: "custom_http",     label: "Custom HTTP",      tagline: "Any REST SMS API",            color: "border-violet-300 bg-violet-50 text-violet-800",dot: "bg-violet-500" },
  { value: "generic",         label: "Generic API",      tagline: "Fallback / unknown provider", color: "border-slate-300 bg-slate-50 text-slate-700",   dot: "bg-slate-400" },
];

const smsProviderHints = {
  africas_talking: { username: "Africa's Talking username (e.g. sandbox)", apiKey: "Africa's Talking API key (required)", apiSecret: null, callback: null },
  twilio:          { username: "Twilio Account SID (required)",             apiKey: "Twilio Auth Token (required)",        apiSecret: null, callback: null },
  mtech:           { username: "MTech username (optional)",                 apiKey: "MTech API key (required)",            apiSecret: null, callback: "MTech endpoint URL — required" },
  custom_http:     { username: "Provider account username",                 apiKey: "API key / Bearer token",              apiSecret: "API secret (if required by provider)", callback: "Full provider endpoint URL (required)" },
  generic:         { username: "Account username",                          apiKey: "API key",                             apiSecret: "API secret or token", callback: "Provider endpoint URL (required)" },
};

// Which fields are visible per provider
const smsProviderFields = {
  africas_talking: { username: true, apiSecret: false, callback: false, sandbox: true },
  twilio:          { username: true, apiSecret: false, callback: false, sandbox: false },
  mtech:           { username: true, apiSecret: false, callback: true,  sandbox: false },
  custom_http:     { username: true, apiSecret: true,  callback: true,  sandbox: false },
  generic:         { username: true, apiSecret: true,  callback: true,  sandbox: false },
};

const smsRecipientLabels = {
  tenant: "Tenant",
  landlord: "Landlord",
  customer: "Customer",
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
    messageBody: "Dear {tenantName}, we have received {amount} for {propertyName} Unit {unitNumber} via {paymentMethod}. Receipt: {receiptNumber} ({paymentDate}). Ref: {referenceNumber}. - {companyName}",
    placeholders: ["tenantName", "tenantCode", "amount", "propertyName", "unitNumber", "receiptNumber", "paymentDate", "paymentMethod", "paymentType", "referenceNumber", "dueDate", "bankingDate", "description", "companyName", "companyPhone"],
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
    messageBody: "Dear {tenantName} ({tenantCode}), invoice {invoiceNumber} ({category}) for {propertyName} Unit {unitNumber}: {amountDue} due {dueDate}. - {companyName}",
    placeholders: ["tenantName", "tenantCode", "invoiceNumber", "category", "propertyName", "unitNumber", "amountDue", "dueDate", "invoiceDate", "invoiceStatus", "rentAmount", "description", "companyName", "companyPhone"],
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
    messageBody: "Dear {tenantName}, your overdue balance for {propertyName} Unit {unitNumber} is {overdueAmount}. Monthly rent: {rent}. Please clear this immediately to avoid penalties. - {companyName}",
    placeholders: ["tenantName", "tenantCode", "propertyName", "unitNumber", "overdueAmount", "balance", "rent", "moveInDate", "companyName", "companyPhone"],
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
    messageBody: "Hello {landlordName}, your {statementType} statement for {propertyName} ({statementPeriod}) is ready. Net Due: {netAmountDue}. Commission: {commissionAmount}. - {companyName}",
    placeholders: ["landlordName", "landlordCode", "propertyName", "statementPeriod", "statementDate", "statementNumber", "statementType", "netAmountDue", "totalRentInvoiced", "totalRentReceived", "commissionAmount", "commissionPercentage", "totalExpenses", "companyName", "companyPhone"],
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
    messageBody: "Hello {landlordName} ({landlordCode}), {amount} paid for {propertyName} on {paymentDate}. Ref: {referenceNumber}. Stmt: {statementNumber}. - {companyName}",
    placeholders: ["landlordName", "landlordCode", "amount", "propertyName", "paymentDate", "referenceNumber", "statementNumber", "statementPeriod", "companyName", "companyPhone"],
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
    messageBody: "Hello {recipientName}, maintenance update for {propertyName} Unit {unitNumber}: {issueTitle} is now {status}. - {companyName}",
    placeholders: ["recipientName", "propertyName", "unitNumber", "issueTitle", "status", "scheduledDate", "completionDate", "companyName", "companyPhone"],
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
    messageBody: "Hello {recipientName}, maintenance update for {propertyName} Unit {unitNumber}: {issueTitle} is now {status}. - {companyName}",
    placeholders: ["recipientName", "propertyName", "unitNumber", "issueTitle", "status", "scheduledDate", "completionDate", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-tenant_notice_sms",
    key: "tenant_notice_sms",
    name: "Tenant Notice SMS",
    description: "Manual tenant communication from tenant and meter-related pages.",
    recipientType: "tenant",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hello {tenantName}, this is a notice from {companyName} regarding {propertyName} Unit {unitNumber}. Your current balance is {balance}. Monthly rent: {rent}. Kindly contact us for any queries.",
    placeholders: ["tenantName", "tenantCode", "companyName", "companyPhone", "propertyName", "unitNumber", "rent", "balance", "overdueAmount", "moveInDate", "leaseType", "depositAmount", "tenantStatus", "idNumber"],
  },
  {
    _id: "sms-template-landlord_notice_sms",
    key: "landlord_notice_sms",
    name: "Landlord Notice SMS",
    description: "Manual landlord communication from the landlords page.",
    recipientType: "landlord",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hello {landlordName} ({landlordCode}), this is a notice from {companyName}. Kindly contact us for any clarification regarding your account.",
    placeholders: ["landlordName", "landlordCode", "landlordType", "taxPin", "companyName", "companyPhone", "companyEmail"],
  },
  {
    _id: "sms-template-penalty_notice_sms",
    key: "penalty_notice_sms",
    name: "Penalty Notice SMS",
    description: "Sent to tenants after a late penalty invoice has been created.",
    recipientType: "tenant",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Dear {tenantName} ({tenantCode}), penalty invoice {invoiceNumber} of {amountDue} raised for {propertyName} Unit {unitNumber}. Due: {dueDate}. Orig. Invoice: {sourceInvoiceNumber}. - {companyName}",
    placeholders: ["tenantName", "tenantCode", "invoiceNumber", "amountDue", "propertyName", "unitNumber", "dueDate", "invoiceDate", "sourceInvoiceNumber", "description", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-meter_usage_notification_sms",
    key: "meter_usage_notification_sms",
    name: "Meter / Usage Notification SMS",
    description: "Notify an affected tenant after a meter reading or utility usage update.",
    recipientType: "tenant",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hello {tenantName}, your {utilityType} reading for {propertyName} Unit {unitNumber} ({billingPeriod}): {previousReading}→{currentReading} ({unitsConsumed} units). Charge: {amount}. - {companyName}",
    placeholders: ["tenantName", "tenantCode", "utilityType", "meterNumber", "propertyName", "unitNumber", "billingPeriod", "readingDate", "previousReading", "currentReading", "unitsConsumed", "rate", "amount", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-carwash_stamp_earned",
    key: "carwash_stamp_earned",
    name: "Loyalty Stamp Earned",
    description: "Sent automatically after a paid job when a loyalty stamp is awarded to the customer.",
    recipientType: "customer",
    enabled: false,
    sendMode: "automatic",
    profileId: "",
    messageBody: "Hi {customerName}! You've earned stamp {currentStamps}/{stampsRequired} for {plate}. {remaining} more wash(es) to go for your reward! - {companyName}",
    placeholders: ["customerName", "plate", "currentStamps", "stampsRequired", "remaining", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-carwash_reward_ready",
    key: "carwash_reward_ready",
    name: "Loyalty Reward Unlocked",
    description: "Sent when a customer completes a full loyalty card and earns a reward on their next visit.",
    recipientType: "customer",
    enabled: false,
    sendMode: "automatic",
    profileId: "",
    messageBody: "Hi {customerName}! Congratulations! You've earned {rewardDescription} for vehicle {plate}. Redeem it on your next visit. Thank you for your loyalty! - {companyName}",
    placeholders: ["customerName", "plate", "rewardDescription", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-carwash_reward_redeemed",
    key: "carwash_reward_redeemed",
    name: "Loyalty Reward Redeemed",
    description: "Sent when a loyalty reward is applied and redeemed on a job.",
    recipientType: "customer",
    enabled: false,
    sendMode: "automatic",
    profileId: "",
    messageBody: "Hi {customerName}! Your loyalty reward has been redeemed for {plate}. Thank you for your continued support! - {companyName}",
    placeholders: ["customerName", "plate", "jobNumber", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-carwash_payment_confirmed",
    key: "carwash_payment_confirmed",
    name: "Payment Confirmed",
    description: "Sent to the customer when a full job payment is received and recorded.",
    recipientType: "customer",
    enabled: false,
    sendMode: "automatic",
    profileId: "",
    messageBody: "Hi {customerName}! Payment of KES {amount} received for {plate} wash. Thank you! - {companyName}",
    placeholders: ["customerName", "plate", "amount", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-carwash_loyalty_manual",
    key: "carwash_loyalty_manual",
    name: "Loyalty Customer Notice",
    description: "Manual SMS sent directly to a loyalty customer from the customer management panel.",
    recipientType: "customer",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hi {customerName}, this is a message from {companyName}. {message}",
    placeholders: ["customerName", "plate", "message", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-carwash_job_manual",
    key: "carwash_job_manual",
    name: "Job Notice SMS",
    description: "Manual SMS sent about a specific car wash job from the jobs panel.",
    recipientType: "customer",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hi {customerName}, your vehicle {plate} (Job #{jobNumber}): {message} - {companyName}",
    placeholders: ["customerName", "plate", "jobNumber", "serviceName", "price", "status", "message", "companyName", "companyPhone"],
  },
  {
    _id: "sms-template-carwash_payment_manual",
    key: "carwash_payment_manual",
    name: "Payment Notice SMS",
    description: "Manual SMS sent about a specific car wash payment from the payments panel.",
    recipientType: "customer",
    enabled: false,
    sendMode: "manual",
    profileId: "",
    messageBody: "Hi {customerName}, your payment of KES {amount} ({method}) for {plate} has been recorded. Ref: {reference}. Job #{jobNumber}. - {companyName}",
    placeholders: ["customerName", "plate", "amount", "method", "reference", "jobNumber", "companyName", "companyPhone"],
  },
];

const countSmsInfo = (text = "") => {
  if (!text) return { chars: 0, segments: 0, remaining: 160, encoding: "GSM-7" };
  const isUnicode = /[^\x00-\x7F]/.test(text);
  const maxSingle = isUnicode ? 70 : 160;
  const maxMulti = isUnicode ? 67 : 153;
  const len = text.length;
  const segments = len <= maxSingle ? 1 : Math.ceil(len / maxMulti);
  const remaining = segments === 1 ? maxSingle - len : segments * maxMulti - len;
  return { chars: len, segments, remaining, encoding: isUnicode ? "Unicode" : "GSM-7" };
};

const renderMessageWithPlaceholders = (body = "") => {
  const parts = String(body || "").split(/(\{[a-zA-Z0-9_]+\})/g);
  return parts.map((part, i) =>
    /^\{[a-zA-Z0-9_]+\}$/.test(part) ? (
      <mark key={i} className="rounded bg-emerald-100 px-0.5 font-bold text-emerald-800 not-italic">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
};

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
  const stored = company?.communication?.smsTemplates;
  if (!Array.isArray(stored) || stored.length === 0) return defaultSmsTemplates;

  const storedKeys = new Set(stored.map((t) => t.key));
  const missing = defaultSmsTemplates.filter((t) => !storedKeys.has(t.key));
  return missing.length > 0 ? [...stored, ...missing] : stored;
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
  useSandbox: false,
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
    useSandbox: Boolean(config.useSandbox),
    lastUpdatedAt: config.lastUpdatedAt || null,
    status: status.code,
    statusLabel: status.label,
    statusReason: status.reason,
  };
};

export default function CompanySetupPage() {
  const confirm = useConfirm();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentCompany = useSelector(selectCurrentCompany);
  const [searchParams, setSearchParams] = useSearchParams();
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingPayments, setSavingPayments] = useState(false);
  const [savingEmails, setSavingEmails] = useState(false);
  const [savingSmsProfiles, setSavingSmsProfiles] = useState(false);
  const [savingSmsTemplates, setSavingSmsTemplates] = useState(false);
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
  const smsBodyRef = useRef(null);
  const [smsTemplateSearch, setSmsTemplateSearch] = useState("");
  const [smsTemplateRecipientFilter, setSmsTemplateRecipientFilter] = useState("all");
  const [smsTemplateStatusFilter, setSmsTemplateStatusFilter] = useState("all");
  const [smsTemplatesModeFilter, setSmsTemplatesModeFilter] = useState("all");
  const [emailProfileSearch, setEmailProfileSearch] = useState("");
  const [smsProfileSearch, setSmsProfileSearch] = useState("");
  const [emailSubTab, setEmailSubTab] = useState("profiles");
  const [emailLogs, setEmailLogs] = useState([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [emailLogsSearch, setEmailLogsSearch] = useState("");
  const [emailLogsPage, setEmailLogsPage] = useState(1);
  const EMAIL_LOGS_PAGE_SIZE = 30;
  const [smsLogs, setSmsLogs] = useState([]);
  const [smsLogsLoading, setSmsLogsLoading] = useState(false);
  const [smsLogsSearch, setSmsLogsSearch] = useState("");
  const [smsLogsPage, setSmsLogsPage] = useState(1);
  const SMS_LOGS_PAGE_SIZE = 30;
  const [paymentSearch, setPaymentSearch] = useState("");
  const [taxConfig, setTaxConfig] = useState(normalizeTaxConfiguration());
  const [activityView, setActivityView] = useState("activities");
  const [activityCategory, setActivityCategory] = useState("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [auditLogs, setAuditLogs] = useState([]);
  const [userSessions, setUserSessions] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [activitiesPage, setActivitiesPage] = useState(1);
  const [sessionsPage, setSessionsPage] = useState(1);
  const ACTIVITIES_PAGE_SIZE = 25;
  const SESSIONS_PAGE_SIZE = 20;

  const activeTab = ALL_VALID_TAB_KEYS.has(searchParams.get("tab")) ? searchParams.get("tab") : "details";
  const activeSmsSection = validSmsSections.has(searchParams.get("smsTab")) ? searchParams.get("smsTab") : "configuration";
  const paymentConfigs = useMemo(() => normalizePaymentConfigs(currentCompany), [currentCompany]);
  const emailProfiles = useMemo(() => normalizeEmailConfigs(currentCompany), [currentCompany]);
  const smsProfiles = useMemo(() => normalizeSmsConfigs(currentCompany), [currentCompany]);
  const smsTemplates = useMemo(() => normalizeSmsTemplates(currentCompany), [currentCompany]);

  useEffect(() => {
    if (!ALL_VALID_TAB_KEYS.has(searchParams.get("tab"))) {
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
    if (activeTab !== "activities" || !currentCompany?._id) return undefined;

    let cancelled = false;
    const loadAuditTrail = async () => {
      setLoadingAudit(true);
      try {
        const [logRes, sessionRes] = await Promise.all([
          adminRequests.get("/audit-logs", {
            params: { companyId: currentCompany._id, category: activityCategory, limit: 200 },
          }),
          adminRequests.get("/audit-logs/sessions", {
            params: { companyId: currentCompany._id },
          }),
        ]);

        if (cancelled) return;
        setAuditLogs(Array.isArray(logRes?.data?.logs) ? logRes.data.logs : []);
        setUserSessions(Array.isArray(sessionRes?.data?.sessions) ? sessionRes.data.sessions : []);
      } catch (error) {
        if (!cancelled) {
          toast.error(error?.response?.data?.message || "Failed to load company activities");
        }
      } finally {
        if (!cancelled) setLoadingAudit(false);
      }
    };

    loadAuditTrail();

    return () => {
      cancelled = true;
    };
  }, [activeTab, activityCategory, activityRefreshKey, currentCompany?._id]);

  useEffect(() => {
    if (activeTab !== "activities") return undefined;
    const intervalId = window.setInterval(() => {
      setActivityRefreshKey((key) => key + 1);
    }, 30000);
    return () => window.clearInterval(intervalId);
  }, [activeTab]);

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
    if (!["sent", "failed", "pending"].includes(emailSubTab)) return;
    if (!currentCompany?._id) return;
    setEmailLogsLoading(true);
    getSmsLogs(currentCompany._id, { channel: "email", limit: 200, status: emailSubTab === "pending" ? "pending" : emailSubTab })
      .then((data) => setEmailLogs(Array.isArray(data) ? data : []))
      .catch(() => setEmailLogs([]))
      .finally(() => setEmailLogsLoading(false));
    setEmailLogsPage(1);
    setEmailLogsSearch("");
  }, [emailSubTab, currentCompany?._id]);

  useEffect(() => {
    if (!["sent", "failed", "pending"].includes(activeSmsSection)) return;
    if (!currentCompany?._id) return;
    setSmsLogsLoading(true);
    getSmsLogs(currentCompany._id, { channel: "sms", limit: 200, status: activeSmsSection })
      .then((data) => setSmsLogs(Array.isArray(data) ? data : []))
      .catch(() => setSmsLogs([]))
      .finally(() => setSmsLogsLoading(false));
    setSmsLogsPage(1);
    setSmsLogsSearch("");
  }, [activeSmsSection, currentCompany?._id]);

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

  const handleCompanyFieldChange = (field, value) => {
    setCompany((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCompanyModeChange = (value) => {
    const normalizedMode = normalizeCompanyOperatingMode(value);
    setCompany((prev) => ({
      ...prev,
      companyMode: normalizedMode,
    }));
  };

  const handleModuleToggle = (moduleKey, checked) => {
    setCompany((prev) => {
      const nextModules = {
        ...normalizeCompanyModules(prev.modules),
        [moduleKey]: checked,
      };

      return {
        ...prev,
        modules: nextModules,
      };
    });
  };

  const buildCompanySetupPayload = () => ({
    companyName: company.companyName,
    registrationNo: company.registrationNo,
    taxPIN: company.taxPIN,
    taxExemptCode: company.taxExemptCode,
    postalAddress: company.postalAddress,
    country: company.country,
    town: company.town,
    roadStreet: company.roadStreet,
    email: company.email,
    phoneNo: company.phoneNo,
    slogan: company.slogan,
    logo: company.logo,
    baseCurrency: company.baseCurrency,
    taxRegime: company.taxRegime,
    fiscalStartMonth: company.fiscalStartMonth,
    fiscalStartYear: company.fiscalStartYear,
    operationPeriodType: company.operationPeriodType,
    companyMode: normalizeCompanyOperatingMode(company.companyMode),
    modules: normalizeCompanyModules(company.modules),
  });

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


  const handleSaveDetails = async () => {
    if (!currentCompany?._id) {
      toast.error("No active company selected");
      return;
    }

    setSavingDetails(true);
    try {
      await dispatch(updateCompany(currentCompany._id, buildCompanySetupPayload()));
      toast.success("Company profile saved");
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
    if (!await confirm({ title: "Delete Paybill Config", message: `Delete ${config.name}? This only removes the saved Paybill configuration.`, confirmText: "Delete", isDangerous: true })) {
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

  const hasPM   = hasCompanyModule(currentCompany, "propertyManagement");
  const hasHR   = hasCompanyModule(currentCompany, "hr");
  const hasCW   = hasCompanyModule(currentCompany, "carwash");
  const hasSale = hasCompanyModule(currentCompany, "propertySale");

  const smsSummary = useMemo(() => {
    const total = smsProfiles.length;
    const active = smsProfiles.filter((profile) => profile.enabled).length;
    const configured = smsProfiles.filter((profile) => ["configured", "active"].includes(buildSmsStatus(profile).code)).length;
    const defaults = smsProfiles.filter((profile) => profile.isDefault).length;
    const automatedTemplates = smsTemplates.filter((template) => {
      const moduleKey = TEMPLATE_MODULE_MAP[template.key];
      if (moduleKey === "propertyManagement" && !hasPM) return false;
      if (moduleKey === "carwash" && !hasCW) return false;
      return template.enabled && template.sendMode === "automatic";
    }).length;
    return { total, active, configured, defaults, automatedTemplates };
  }, [smsProfiles, smsTemplates, hasPM, hasCW]);

  const taxSetupSummary = useMemo(() => {
    const taxableCategoryCount = Object.values(taxConfig?.taxSettings?.invoiceTaxabilityByCategory || {}).filter(Boolean).length;
    const defaultCode = (taxConfig?.taxCodes || []).find((code) => code.key === taxConfig?.taxSettings?.defaultTaxCodeKey) ||
      (taxConfig?.taxCodes || []).find((code) => code.isDefault) ||
      null;

    return {
      enabled: Boolean(taxConfig?.taxSettings?.enabled),
      defaultMode: taxConfig?.taxSettings?.defaultTaxMode === "inclusive" ? "Inclusive" : "Exclusive",
      defaultCodeLabel: defaultCode?.name || "Not set",
      taxableCategoryCount,
    };
  }, [taxConfig]);

  const tabs = useMemo(() => [
    { key: "details",    label: "PROFILE",    icon: <FaBuilding /> },
    ...(hasPM ? [{ key: "structure", label: "STRUCTURE", icon: <FaSitemap /> }] : []),
    { key: "modules",   label: "MODULES",    icon: <FaThLarge /> },
    { key: "payments",  label: "PAYMENTS",   icon: <FaMoneyCheckAlt /> },
    { key: "email",     label: "EMAIL",      icon: <FaEnvelope /> },
    { key: "sms",       label: "SMS",        icon: <FaSms /> },
    { key: "activities",label: "ACTIVITIES", icon: <FaHistory /> },
  ], [hasPM]);

  const emailUsageOptions = useMemo(() => [
    { value: "receipts",           label: "Receipts" },
    { value: "invoices",           label: "Invoices" },
    ...(hasPM ? [{ value: "landlord_statements", label: "Landlord Statements" }] : []),
    { value: "system_alerts",      label: "System Alerts" },
    { value: "demo_requests",      label: "Demo Requests" },
    { value: "onboarding",         label: "Onboarding" },
  ], [hasPM]);

  const handleRefreshSetup = async () => {
    if (!currentCompany?._id) return;

    try {
      await dispatch(getCompany(currentCompany._id));
      const response = await adminRequests.get(`/company-settings/${currentCompany._id}`);
      setTaxConfig(normalizeTaxConfiguration(response?.data || {}));
      toast.success("Company setup refreshed");
    } catch (error) {
      toast.error("Failed to refresh company setup");
    }
  };

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
    if (!await confirm({ title: "Delete Email Profile", message: `Delete ${profile.name}? This only removes the saved email profile.`, confirmText: "Delete", isDangerous: true })) {
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
    if (!await confirm({ title: "Delete SMS Config", message: `Delete ${profile.name}? This only removes the saved SMS configuration.`, confirmText: "Delete", isDangerous: true })) {
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

  const insertPlaceholderAtCursor = (placeholder) => {
    const tag = `{${placeholder}}`;
    const textarea = smsBodyRef.current;
    const current = smsTemplateForm?.messageBody || "";
    if (!textarea) {
      setSmsTemplateForm((prev) => ({ ...prev, messageBody: current + tag }));
      return;
    }
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const newBody = current.slice(0, start) + tag + current.slice(end);
    setSmsTemplateForm((prev) => ({ ...prev, messageBody: newBody }));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
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
        profileId: smsTemplateForm.profileId || "",
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
    if (!await confirm({ title: "Reset SMS Templates", message: "Reset SMS templates back to the MILIK defaults for this company? Your custom templates will be replaced.", confirmText: "Reset" })) {
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
        <div className="space-y-3">
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

      <div className="space-y-3 xl:col-span-2">
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

      </div>
    </div>
  );


  const renderStructureTab = () => {
    const selectedMode = normalizeCompanyOperatingMode(company.companyMode);
    const enabledModuleCount = Object.values(company.modules || {}).filter(Boolean).length;

    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          title="Operating Mode"
          subtitle="Choose how the active company should be treated across MILIK. This changes workspace wording and defaults, but it must not rewrite posted history."
        >
          <div className="space-y-3">
            {companyOperatingModeOptions.map((option) => {
              const isActive = selectedMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleCompanyModeChange(option.value)}
                  className={[
                    "w-full rounded-2xl border px-4 py-4 text-left transition",
                    isActive
                      ? "border-emerald-300 bg-emerald-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-extrabold text-slate-900">{option.label}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-600">{option.description}</div>
                    </div>
                    <span
                      className={[
                        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold",
                        isActive
                          ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-600",
                      ].join(" ")}
                    >
                      {isActive ? "Active" : "Available"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs font-extrabold uppercase tracking-wide text-slate-700">Current Structure Snapshot</div>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <span>Operating mode</span>
                <span className="font-bold text-slate-900">
                  {companyOperatingModeOptions.find((option) => option.value === selectedMode)?.label || "Other"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Enabled modules</span>
                <span className="font-bold text-slate-900">{enabledModuleCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Fiscal start</span>
                <span className="font-bold text-slate-900">{company.fiscalStartMonth} {company.fiscalStartYear}</span>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-3 xl:col-span-2">
          <Card
            title="Company Structure Defaults"
            subtitle="These defaults define the active company’s working posture. They are future-facing operational defaults and must not restate historical transactions."
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-slate-700">Operating Mode</label>
                <Select value={selectedMode} onChange={(e) => handleCompanyModeChange(e.target.value)}>
                  <option value={COMPANY_OPERATING_MODES.PROPERTY_MANAGER}>Property Manager</option>
                  <option value={COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD}>Self-Managing Landlord</option>
                  <option value={COMPANY_OPERATING_MODES.OTHER}>Other</option>
                </Select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Operation Period Type</label>
                <Select value={company.operationPeriodType} onChange={(e) => handleCompanyFieldChange("operationPeriodType", e.target.value)}>
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Semi Annual">Semi Annual</option>
                  <option value="Annual">Annual</option>
                </Select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Fiscal Start Month</label>
                <Select value={company.fiscalStartMonth} onChange={(e) => handleCompanyFieldChange("fiscalStartMonth", e.target.value)}>
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
                  min="2000"
                  value={company.fiscalStartYear}
                  onChange={(e) => handleCompanyFieldChange("fiscalStartYear", Number(e.target.value) || new Date().getFullYear())}
                />
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Changes here should control future company behavior and workspace wording. They should not mutate posted invoices, receipts, statements, or ledger history.
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={() => setCompany(normalizeForm(currentCompany))}>
                Reset
              </button>
              <button disabled={savingDetails} onClick={handleSaveDetails} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
                <FaSave /> {savingDetails ? "Saving..." : "Save Structure"}
              </button>
            </div>
          </Card>
        </div>
      </div>
    );
  };

  const renderModulesTab = () => {
    const normalizedModules = normalizeCompanyModules(company.modules);
    const enabledKeys = Object.entries(normalizedModules)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);

    return (
      <div className="space-y-3">
        <Card
          title="Modules Configuration"
          subtitle="Enable only the modules this company has subscribed to or will actively use."
          action={
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
              {enabledKeys.length} enabled
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {moduleCategories.map((category) => {
              const categoryKeys = Object.keys(MODULE_LABELS).filter((moduleKey) =>
                category.key === "primary" ? primaryModuleKeys.includes(moduleKey) : !primaryModuleKeys.includes(moduleKey)
              );

              return (
                <div key={category.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3">
                    <div className="text-sm font-extrabold text-slate-900">{category.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-600">{category.description}</div>
                  </div>

                  <div className="space-y-3">
                    {categoryKeys.map((moduleKey) => {
                      const checked = Boolean(normalizedModules[moduleKey]);

                      return (
                        <ToggleRow
                          key={moduleKey}
                          checked={checked}
                          onChange={(e) => handleModuleToggle(moduleKey, e.target.checked)}
                          title={MODULE_LABELS[moduleKey]}
                          description="Enable this only when the company is ready to use the module in the live workspace."
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Disabling an expansion module should only remove it from navigation and access control. It should not delete historical records that already exist.
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50" onClick={() => setCompany(normalizeForm(currentCompany))}>
              Reset
            </button>
            <button disabled={savingDetails} onClick={handleSaveDetails} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F97316] to-[#16A34A] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-60">
              <FaSave /> {savingDetails ? "Saving..." : "Save Modules"}
            </button>
          </div>
        </Card>
      </div>
    );
  };

  const renderPaymentsTab = () => (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1.6fr]">
      <div className="space-y-3">
        <Card
          title="Payment Config Overview"
          subtitle="Manage one or many company Paybill setups from this page. Matching remains scoped by Paybill plus tenant code."
          action={
            <button onClick={beginCreatePaymentConfig} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:opacity-95">
              <FaPlus /> Add Paybill Config
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total configs</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{paymentSummary.total}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Active now</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{paymentSummary.active}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Enabled</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{paymentSummary.enabled}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{paymentSummary.configured}</div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <FaPhoneAlt className="text-[#F97316]" /> Payment identity rule
            </div>
            {currentCompany?.modules?.propertyManagement && (
              <>
                <div className="mt-1 text-xs leading-4 text-slate-600">
                  Property Management: incoming payments are matched by Paybill + the tenant code entered as the account number, keeping matching safely company-bound.
                </div>
                <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                  Account number used by tenant: <span className="text-slate-900">Tenant Code (example: TT0001)</span>
                </div>
              </>
            )}
            {currentCompany?.modules?.carwash && (
              <>
                <div className={`${currentCompany?.modules?.propertyManagement ? "mt-3 border-t border-slate-200 pt-3" : "mt-1"} text-xs leading-4 text-slate-600`}>
                  Car Wash: incoming payments are matched by Paybill + the vehicle plate number entered as the account number. This ties each payment to an open job and awards loyalty stamps automatically.
                </div>
                <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-slate-700">
                  Account number used by customer: <span className="font-extrabold text-[#0B3B2E]">Vehicle Plate Number (example: KCA 123A)</span>
                </div>
              </>
            )}
            {!currentCompany?.modules?.propertyManagement && !currentCompany?.modules?.carwash && (
              <div className="mt-1 text-xs leading-4 text-slate-600">
                Incoming payments are identified by the company Paybill together with the account number entered by the payer. Enable a module to see its specific identity rule.
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <FaLock className="text-emerald-600" /> Callback handling strategy
            </div>
            <div className="mt-1 text-xs leading-4 text-slate-600">
              MILIK manages confirmation and validation endpoints from the backend. Company admins only configure the commercial and processing details here.
            </div>
          </div>
        </Card>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* toolbar */}
          <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                <input
                  value={paymentSearch}
                  onChange={(e) => setPaymentSearch(e.target.value)}
                  placeholder="Search paybills…"
                  className="h-7 w-44 rounded border border-slate-300 bg-[#DDEFE1] pl-7 pr-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {paymentConfigs.length} profile{paymentConfigs.length !== 1 ? "s" : ""}
              </span>
            </div>
            <button
              onClick={beginCreatePaymentConfig}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-orange-600"
            >
              <FaPlus /> Add Paybill
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">#</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Name</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Paybill</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Cashbook</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Active</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paymentConfigs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No paybill configuration added yet.
                    </td>
                  </tr>
                ) : (
                  paymentConfigs
                    .filter((c) => !paymentSearch.trim() || `${c.name} ${c.shortCode}`.toLowerCase().includes(paymentSearch.trim().toLowerCase()))
                    .map((config, idx) => {
                      const status = buildPaymentStatus(config);
                      const theme = statusTheme[status.code] || statusTheme.not_configured;
                      const isSelected = String(selectedPaymentConfigId) === String(config._id);
                      return (
                        <tr
                          key={config._id}
                          onDoubleClick={() => beginEditPaymentConfig(config)}
                          className={`cursor-pointer transition ${isSelected ? "bg-emerald-50/60" : "hover:bg-slate-50"}`}
                        >
                          <td className="px-3 py-2 font-semibold text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2 font-bold text-slate-900">{config.name}</td>
                          <td className="px-3 py-2 text-slate-700">{config.shortCode || <span className="text-slate-400">—</span>}</td>
                          <td className="max-w-[140px] truncate px-3 py-2 text-slate-600">{config.defaultCashbookAccountName || <span className="text-slate-400">—</span>}</td>
                          <td className="px-3 py-2 text-center">
                            {config.isActive ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">Active</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-bold text-slate-500">Inactive</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${theme.badge}`}>
                              {theme.icon} {status.label}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                title="Edit"
                                onClick={() => beginEditPaymentConfig(config)}
                                className="h-7 rounded border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"
                              >
                                <FaPen />
                              </button>
                              <button
                                title={config.enabled ? "Disable" : "Enable"}
                                onClick={() => handleQuickUpdate(config, { enabled: !config.enabled, isActive: config.enabled ? false : config.isActive }, config.enabled ? "Paybill disabled" : "Paybill enabled")}
                                className="h-7 rounded border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"
                              >
                                <FaPowerOff className={config.enabled ? "text-emerald-600" : "text-slate-400"} />
                              </button>
                              <button
                                title={config.isActive ? "Set inactive" : "Activate"}
                                onClick={() => handleQuickUpdate(config, { enabled: true, isActive: !config.isActive }, config.isActive ? "Paybill set inactive" : "Paybill activated")}
                                className="h-7 rounded border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"
                              >
                                <FaCheckCircle className={config.isActive ? "text-blue-500" : "text-slate-400"} />
                              </button>
                              <button
                                title="Delete"
                                onClick={() => handleDeletePaymentConfig(config)}
                                className="h-7 rounded border border-rose-200 bg-rose-50 px-2 font-bold text-rose-600 transition hover:bg-rose-100"
                              >
                                <FaTrashAlt />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="space-y-3">
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
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <FaShieldAlt className="text-emerald-600" /> Company isolation
              </div>
              <div className="mt-1 text-xs leading-4 text-slate-600">Each saved Paybill configuration remains company-bound. Matching is still designed around Paybill number plus tenant code.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <FaUniversity className="text-[#F97316]" /> Accounting safety
              </div>
              <div className="mt-1 text-xs leading-4 text-slate-600">This page stores configuration only. It does not silently create receipts, ledger entries or callback postings outside the existing accounting flow.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <FaLock className="text-slate-700" /> Saved credentials
              </div>
              <div className="mt-1 text-xs leading-4 text-slate-600">Saved credentials stay masked on screen. Enter a new value only when you want to replace the current secret.</div>
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

      </div>
    </div>
  );


  const renderEmailTab = () => {
    const emailLogSubTabs = [
      { key: "profiles", label: "Profiles", count: emailSummary.total },
      { key: "sent", label: "Sent", count: null },
      { key: "failed", label: "Failed", count: null },
      { key: "pending", label: "Inbox / Pending", count: null },
    ];

    const filteredEmailLogs = emailLogs.filter((log) => {
      if (!emailLogsSearch) return true;
      const q = emailLogsSearch.toLowerCase();
      return (
        String(log.to || "").toLowerCase().includes(q) ||
        String(log.recipientName || "").toLowerCase().includes(q) ||
        String(log.subject || "").toLowerCase().includes(q) ||
        String(log.templateKey || "").toLowerCase().includes(q) ||
        String(log.profileName || "").toLowerCase().includes(q) ||
        String(log.contextType || "").toLowerCase().includes(q)
      );
    });

    const emailLogsTotalPages = Math.max(1, Math.ceil(filteredEmailLogs.length / EMAIL_LOGS_PAGE_SIZE));
    const emailLogsSafePage = Math.min(emailLogsPage, emailLogsTotalPages);
    const emailLogsStart = filteredEmailLogs.length === 0 ? 0 : (emailLogsSafePage - 1) * EMAIL_LOGS_PAGE_SIZE;
    const emailLogsEnd = emailLogsStart + EMAIL_LOGS_PAGE_SIZE;
    const emailLogsPaged = filteredEmailLogs.slice(emailLogsStart, emailLogsEnd);

    const logStatusBadge = (status) => {
      if (status === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
      if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
      return "border-slate-200 bg-slate-50 text-slate-600";
    };

    return (
      <div className="space-y-3">
        {/* Sub-tab bar */}
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
          {emailLogSubTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setEmailSubTab(t.key)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition ${emailSubTab === t.key ? "bg-[#0B3B2E] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {t.key === "profiles" && <FaPlug className="text-[9px]" />}
              {t.key === "sent" && <FaPaperPlane className="text-[9px]" />}
              {t.key === "failed" && <FaExclamationTriangle className="text-[9px]" />}
              {t.key === "pending" && <FaHistory className="text-[9px]" />}
              {t.label}
              {t.count !== null && <span className="ml-0.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold leading-none">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* ── Profiles sub-tab ── */}
        {emailSubTab === "profiles" && (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1.6fr]">
            <div className="space-y-3">
              <Card
                title="Email Config Overview"
                subtitle="Manage one or many SMTP profiles for the active company. One enabled default profile can power receipts, invoices, statements and notices safely."
                action={
                  <button onClick={beginCreateEmailProfile} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:opacity-95">
                    <FaPlus /> Add Email Profile
                  </button>
                }
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total profiles</div>
                    <div className="mt-0.5 text-base font-extrabold text-slate-900">{emailSummary.total}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Enabled</div>
                    <div className="mt-0.5 text-base font-extrabold text-slate-900">{emailSummary.active}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
                    <div className="mt-0.5 text-base font-extrabold text-slate-900">{emailSummary.configured}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Default profiles</div>
                    <div className="mt-0.5 text-base font-extrabold text-slate-900">{emailSummary.defaults}</div>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <FaPlug className="text-[#F97316]" /> Delivery safety rule
                  </div>
                  <div className="mt-1 text-xs leading-4 text-slate-600">
                    Each SMTP profile remains company-bound. The backend stays the source of truth, saved passwords remain masked, and one default enabled profile can be used across operational mail flows.
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <FaEnvelope className="text-emerald-600" /> Internal copy handling
                  </div>
                  <div className="mt-1 text-xs leading-4 text-slate-600">
                    Use an internal copy email when the company wants a business mailbox to receive copies of outgoing emails. BCC remains the safer default for tenant-facing communication.
                  </div>
                </div>
              </Card>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-2.5">
                  <div className="relative">
                    <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                    <input
                      value={emailProfileSearch}
                      onChange={(e) => setEmailProfileSearch(e.target.value)}
                      placeholder="Search email profiles…"
                      className="h-8 w-52 rounded border border-slate-300 bg-[#DDEFE1] pl-8 pr-3 text-xs text-slate-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <span className="text-xs text-slate-500">{emailProfiles.length} profile{emailProfiles.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-xs">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-bold">#</th>
                        <th className="px-3 py-2.5 text-left font-bold">Name</th>
                        <th className="px-3 py-2.5 text-left font-bold">Sender Email</th>
                        <th className="px-3 py-2.5 text-left font-bold">SMTP Host</th>
                        <th className="px-3 py-2.5 text-left font-bold">Test</th>
                        <th className="px-3 py-2.5 text-left font-bold">Status</th>
                        <th className="px-3 py-2.5 text-right font-bold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emailProfiles.length === 0 ? (
                        <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">No email profiles configured yet. Click "Add Email Profile" to get started.</td></tr>
                      ) : (
                        emailProfiles
                          .filter((p) => !emailProfileSearch || `${p.name} ${p.senderEmail} ${p.smtpHost}`.toLowerCase().includes(emailProfileSearch.toLowerCase()))
                          .map((profile, idx) => {
                            const status = buildEmailStatus(profile);
                            const theme = statusTheme[status.code] || statusTheme.not_configured;
                            const isSelected = String(selectedEmailProfileId) === String(profile._id);
                            return (
                              <tr
                                key={profile._id}
                                className={`border-b border-slate-100 cursor-pointer transition ${isSelected ? "bg-emerald-50/60" : "hover:bg-slate-50"}`}
                                onDoubleClick={() => beginEditEmailProfile(profile)}
                                title="Double-click to edit"
                              >
                                <td className="px-3 py-2.5 font-mono text-slate-400">{idx + 1}</td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-extrabold text-slate-900">{profile.name}</span>
                                    {profile.isDefault && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">Default</span>}
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 text-slate-700">{profile.senderEmail || <span className="text-slate-400">Not set</span>}</td>
                                <td className="px-3 py-2.5 font-mono text-slate-600">{profile.smtpHost || <span className="text-slate-400">Not set</span>}</td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex rounded-full border px-2 py-0.5 font-bold ${resolveEmailTestBadge(profile.lastTestStatus)}`}>
                                    {profile.lastTestStatus || "never"}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${theme.badge}`}>
                                    {theme.icon}{status.label}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex justify-end gap-1.5">
                                    <button onClick={(e) => { e.stopPropagation(); beginEditEmailProfile(profile); }} className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-700 hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white transition"><FaPen className="text-[9px]" /> Edit</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleQuickEmailUpdate(profile, { enabled: !profile.enabled, isDefault: profile.enabled ? false : profile.isDefault }, profile.enabled ? "Profile disabled" : "Profile enabled"); }} className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-bold transition ${profile.enabled ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}><FaPowerOff className="text-[9px]" /> {profile.enabled ? "Off" : "On"}</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleQuickEmailUpdate(profile, { isDefault: true, enabled: true }, "Set as default"); }} className="inline-flex h-7 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 text-[11px] font-bold text-blue-700 hover:bg-blue-100 transition"><FaCheckCircle className="text-[9px]" /> Default</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleSendTestEmail(profile); }} className="inline-flex h-7 items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition"><FaPaperPlane className="text-[9px]" /> Test</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteEmailProfile(profile); }} className="inline-flex h-7 items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 text-[11px] font-bold text-rose-700 hover:bg-rose-100 transition"><FaTrashAlt className="text-[9px]" /></button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-3">
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
                <div className={`rounded-lg border px-3 py-2 ${emailTheme.panel}`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-base">{emailTheme.icon}</div>
                    <div>
                      <div className="text-xs font-extrabold text-slate-900">{emailStatus.label}</div>
                      <div className="mt-0.5 text-xs leading-4 text-slate-700">{emailStatus.reason}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold text-slate-700">Profile Name</label>
                    <Input value={emailForm.name} onChange={(e) => setEmailForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Example: Main Business Email" />
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

                <div className="mt-3">
                  <div className="text-xs font-bold text-slate-700">Usage Tags</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {emailUsageOptions.map((option) => {
                      const checked = emailForm.usageTags.includes(option.value);
                      return (
                        <label key={option.value} className={[
                          "flex items-center gap-3 rounded-lg border px-3 py-2 text-xs transition",
                          checked ? "border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-white hover:border-slate-300",
                        ].join(" ")}>
                          <input type="checkbox" checked={checked} onChange={() => toggleUsageTag(option.value)} className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                          <span className="font-semibold text-slate-800">{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Selected profile</div>
                      <div className="mt-1 text-xs font-extrabold text-slate-900">{emailForm.name || "New Email Profile"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Sender</div>
                      <div className="mt-1 text-xs font-extrabold text-slate-900">{emailForm.senderEmail || "Not set"}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Last test</div>
                      <div className="mt-1 text-xs font-extrabold text-slate-900">{formatDateTime(emailForm.lastTestedAt)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Test status</div>
                      <div className="mt-1">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${resolveEmailTestBadge(emailForm.lastTestStatus)}`}>
                          {emailForm.lastTestStatus || "never"}
                        </span>
                      </div>
                    </div>
                  </div>
                  {emailForm.lastTestMessage ? (
                    <div className="mt-2 text-xs text-slate-600">{emailForm.lastTestMessage}</div>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1.2fr_auto] md:items-end">
                  <div>
                    <label className="text-xs font-bold text-slate-700">Test Recipient Email</label>
                    <Input type="email" value={emailForm.testRecipient} onChange={(e) => setEmailForm((prev) => ({ ...prev, testRecipient: e.target.value }))} placeholder={currentCompany?.email || "company@example.com"} />
                    <div className="mt-1 text-xs text-slate-500">Use this to verify the saved SMTP profile before relying on it for live communication.</div>
                  </div>
                  <button disabled={testingEmail || selectedEmailProfileId === EMAIL_DRAFT_ID} onClick={() => handleSendTestEmail()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60">
                    <FaPaperPlane /> {testingEmail ? "Sending..." : "Send Test Email"}
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-2">
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
            </div>
          </div>
        )}

        {/* ── Logs sub-tabs (sent / failed / pending) ── */}
        {["sent", "failed", "pending"].includes(emailSubTab) && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* sticky compact header */}
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-[#0B3B2E] px-3 py-2">
              <div className="flex items-center gap-2">
                {emailSubTab === "sent" && <FaPaperPlane className="text-emerald-400 text-xs" />}
                {emailSubTab === "failed" && <FaExclamationTriangle className="text-red-400 text-xs" />}
                {emailSubTab === "pending" && <FaHistory className="text-slate-300 text-xs" />}
                <span className="text-xs font-bold text-white capitalize">{emailSubTab === "pending" ? "Inbox / Pending" : emailSubTab} Emails</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white">{filteredEmailLogs.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                  <input
                    value={emailLogsSearch}
                    onChange={(e) => { setEmailLogsSearch(e.target.value); setEmailLogsPage(1); }}
                    placeholder="Search logs…"
                    className="h-7 w-44 rounded border border-slate-600 bg-[#0d4535] pl-7 pr-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  />
                </div>
                <button
                  onClick={() => {
                    setEmailLogsLoading(true);
                    getSmsLogs(currentCompany._id, { channel: "email", limit: 200, status: emailSubTab === "pending" ? "pending" : emailSubTab })
                      .then((data) => setEmailLogs(Array.isArray(data) ? data : []))
                      .catch(() => setEmailLogs([]))
                      .finally(() => setEmailLogsLoading(false));
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-600 bg-[#0d4535] px-2 text-xs font-bold text-white transition hover:bg-[#0a3427]"
                >
                  <FaSyncAlt className="text-[9px]" /> Refresh
                </button>
              </div>
            </div>

            {/* table body */}
            {emailLogsLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-slate-500">Loading email logs…</div>
            ) : filteredEmailLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
                <FaEnvelope className="text-3xl opacity-30" />
                <p className="text-sm font-semibold">No {emailSubTab} emails found</p>
                <p className="text-xs">Emails sent through the system will appear here once they are logged.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold">#</th>
                        <th className="px-3 py-2 text-left font-bold">To</th>
                        <th className="px-3 py-2 text-left font-bold">Subject</th>
                        <th className="px-3 py-2 text-left font-bold">Template</th>
                        <th className="px-3 py-2 text-left font-bold">Profile</th>
                        <th className="px-3 py-2 text-left font-bold">Context</th>
                        <th className="px-3 py-2 text-center font-bold">Status</th>
                        <th className="px-3 py-2 text-right font-bold">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emailLogsPaged.map((log, idx) => (
                        <tr key={log._id || idx} className="border-b border-slate-100 transition hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-400">{emailLogsStart + idx + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{log.to || "—"}</div>
                            {log.recipientName ? <div className="text-[10px] text-slate-500">{log.recipientName}</div> : null}
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-2 text-slate-700" title={log.subject}>{log.subject || "—"}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{log.templateKey || "—"}</td>
                          <td className="px-3 py-2 text-slate-700">{log.profileName || "—"}</td>
                          <td className="px-3 py-2 text-slate-600 capitalize">{log.contextType ? String(log.contextType).replace(/_/g, " ") : "—"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${logStatusBadge(log.status)}`}>
                              {log.status || "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500 whitespace-nowrap">
                            {log.sentAt ? new Date(log.sentAt).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* pagination footer */}
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold">
                    Showing <span className="font-bold text-slate-900">{filteredEmailLogs.length === 0 ? 0 : emailLogsStart + 1}</span>–<span className="font-bold text-slate-900">{Math.min(emailLogsEnd, filteredEmailLogs.length)}</span> of <span className="font-bold text-slate-900">{filteredEmailLogs.length}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setEmailLogsPage(1)} disabled={emailLogsSafePage === 1} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">«</button>
                    <button onClick={() => setEmailLogsPage((p) => Math.max(1, p - 1))} disabled={emailLogsSafePage === 1} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">‹</button>
                    <span className="font-semibold text-slate-700">Page {emailLogsSafePage} of {emailLogsTotalPages}</span>
                    <button onClick={() => setEmailLogsPage((p) => Math.min(emailLogsTotalPages, p + 1))} disabled={emailLogsSafePage === emailLogsTotalPages} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">›</button>
                    <button onClick={() => setEmailLogsPage(emailLogsTotalPages)} disabled={emailLogsSafePage === emailLogsTotalPages} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">»</button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSmsConfiguration = () => (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_1.65fr]">
      <div className="space-y-3">
        <Card
          title="SMS Configuration Overview"
          subtitle="Manage one or many SMS provider profiles for the active company. Keep them company-bound and activate only the profiles you trust for live delivery."
          action={
            <button onClick={beginCreateSmsProfile} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:opacity-95">
              <FaPlus /> Add Configuration
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total profiles</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{smsSummary.total}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Enabled</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{smsSummary.active}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{smsSummary.configured}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Default profiles</div>
              <div className="mt-0.5 text-base font-extrabold text-slate-900">{smsSummary.defaults}</div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <FaPlug className="text-[#F97316]" /> Delivery safety rule
            </div>
            <div className="mt-1 text-xs leading-4 text-slate-600">
              SMS provider credentials stay saved per company. Templates can use the company default profile or a specific profile, and automation remains separate from configuration so users do not send messages by mistake.
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <FaSms className="text-emerald-600" /> Current product scope
            </div>
            <div className="mt-1 text-xs leading-4 text-slate-600">
              This pass sets up SMS configurations and SMS templates safely. Live provider testing and fully wired business-event sending should follow in the next delivery pass.
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* toolbar */}
          <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                <input
                  value={smsProfileSearch}
                  onChange={(e) => setSmsProfileSearch(e.target.value)}
                  placeholder="Search SMS profiles…"
                  className="h-7 w-44 rounded border border-slate-300 bg-[#DDEFE1] pl-7 pr-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                />
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                {smsProfiles.length} profile{smsProfiles.length !== 1 ? "s" : ""}
              </span>
            </div>
            <button
              onClick={beginCreateSmsProfile}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF8C00] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-orange-600"
            >
              <FaPlus /> Add Profile
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">#</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Name</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Provider</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Sender ID</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Country</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {smsProfiles.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      No SMS profile added yet.
                    </td>
                  </tr>
                ) : (
                  smsProfiles
                    .filter((p) => !smsProfileSearch.trim() || `${p.name} ${p.provider} ${p.senderId}`.toLowerCase().includes(smsProfileSearch.trim().toLowerCase()))
                    .map((profile, idx) => {
                      const status = buildSmsStatus(profile);
                      const theme = statusTheme[status.code] || statusTheme.not_configured;
                      const providerLabel = smsProviderOptions.find((o) => o.value === profile.provider)?.label || profile.provider;
                      const isSelected = String(selectedSmsProfileId) === String(profile._id);
                      return (
                        <tr
                          key={profile._id}
                          onDoubleClick={() => beginEditSmsProfile(profile)}
                          className={`cursor-pointer transition ${isSelected ? "bg-emerald-50/60" : "hover:bg-slate-50"}`}
                        >
                          <td className="px-3 py-2 font-semibold text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-900">{profile.name}</div>
                            {profile.isDefault ? (
                              <span className="mt-0.5 inline-block rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">Default</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-slate-700">{providerLabel}</td>
                          <td className="px-3 py-2 text-slate-700">{profile.senderId || <span className="text-slate-400">—</span>}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{profile.defaultCountryCode || "+254"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${theme.badge}`}>
                              {theme.icon} {status.label}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                title="Edit"
                                onClick={() => beginEditSmsProfile(profile)}
                                className="h-7 rounded border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"
                              >
                                <FaPen />
                              </button>
                              <button
                                title={profile.enabled ? "Disable" : "Enable"}
                                onClick={() => handleQuickSmsProfileUpdate(profile, { enabled: !profile.enabled, isDefault: profile.enabled ? false : profile.isDefault }, profile.enabled ? "SMS profile disabled" : "SMS profile enabled")}
                                className="h-7 rounded border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"
                              >
                                <FaPowerOff className={profile.enabled ? "text-emerald-600" : "text-slate-400"} />
                              </button>
                              <button
                                title="Set as Default"
                                onClick={() => handleQuickSmsProfileUpdate(profile, { isDefault: true, enabled: true }, "SMS profile set as default")}
                                className="h-7 rounded border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"
                              >
                                <FaCheckCircle className={profile.isDefault ? "text-blue-500" : "text-slate-400"} />
                              </button>
                              <button
                                title="Delete"
                                onClick={() => handleDeleteSmsProfile(profile)}
                                className="h-7 rounded border border-rose-200 bg-rose-50 px-2 font-bold text-rose-600 transition hover:bg-rose-100"
                              >
                                <FaTrashAlt />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );

  const renderSmsTemplatesTab = () => {
    const tplSearch = smsTemplateSearch.trim().toLowerCase();

    const moduleVisibleTemplates = smsTemplates.filter((t) => {
      const moduleKey = TEMPLATE_MODULE_MAP[t.key];
      if (!moduleKey) return true;
      if (moduleKey === "propertyManagement") return hasPM;
      if (moduleKey === "carwash") return hasCW;
      return true;
    });

    const filteredTemplates = moduleVisibleTemplates.filter((t) => {
      if (smsTemplateRecipientFilter !== "all" && t.recipientType !== smsTemplateRecipientFilter) return false;
      if (smsTemplateStatusFilter === "enabled" && !t.enabled) return false;
      if (smsTemplateStatusFilter === "disabled" && t.enabled) return false;
      if (smsTemplatesModeFilter !== "all" && t.sendMode !== smsTemplatesModeFilter) return false;
      if (tplSearch && !`${t.name} ${t.description} ${t.key}`.toLowerCase().includes(tplSearch)) return false;
      return true;
    });
    const enabledCount = moduleVisibleTemplates.filter((t) => t.enabled).length;
    const autoCount = moduleVisibleTemplates.filter((t) => t.sendMode === "automatic").length;

    return (
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* ── Toolbar ── */}
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
              <input
                value={smsTemplateSearch}
                onChange={(e) => setSmsTemplateSearch(e.target.value)}
                placeholder="Search templates…"
                className="h-8 w-52 rounded border border-slate-300 bg-[#DDEFE1] pl-8 pr-3 text-xs text-slate-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />
            </div>
            <select
              value={smsTemplateRecipientFilter}
              onChange={(e) => setSmsTemplateRecipientFilter(e.target.value)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            >
              <option value="all">All Recipients</option>
              {hasPM && <option value="tenant">Tenant</option>}
              {hasPM && <option value="landlord">Landlord</option>}
              {hasCW && <option value="customer">Customer</option>}
              {!hasPM && !hasCW && <option value="internal">Internal</option>}
            </select>
            <select
              value={smsTemplateStatusFilter}
              onChange={(e) => setSmsTemplateStatusFilter(e.target.value)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            >
              <option value="all">All Status</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <select
              value={smsTemplatesModeFilter}
              onChange={(e) => setSmsTemplatesModeFilter(e.target.value)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
            >
              <option value="all">All Modes</option>
              <option value="manual">Manual</option>
              <option value="automatic">Automatic</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold">{filteredTemplates.length} / {moduleVisibleTemplates.length} templates</span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">{enabledCount} enabled</span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-700">{autoCount} automatic</span>
            <button
              onClick={handleResetSmsTemplates}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 transition hover:bg-slate-100"
            >
              <FaSyncAlt className="text-[10px]" /> Reset Defaults
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[960px] text-xs">
            <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
              <tr>
                <th className="px-3 py-2.5 text-left font-bold">#</th>
                <th className="px-3 py-2.5 text-left font-bold">Template</th>
                <th className="px-3 py-2.5 text-left font-bold">Recipient</th>
                <th className="px-3 py-2.5 text-left font-bold">Status</th>
                <th className="px-3 py-2.5 text-left font-bold">Mode</th>
                <th className="px-3 py-2.5 text-left font-bold">Chars / SMS</th>
                <th className="px-3 py-2.5 text-left font-bold">Message Preview &amp; Placeholders</th>
                <th className="px-3 py-2.5 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-10 text-center text-slate-500">No templates match the current filters.</td>
                </tr>
              ) : (
                filteredTemplates.map((template, idx) => {
                  const smsInfo = countSmsInfo(template.messageBody || "");
                  return (
                    <tr
                      key={template._id || template.key}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onDoubleClick={() => openSmsTemplateEditor(template)}
                      title="Double-click to edit"
                    >
                      <td className="px-3 py-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="px-3 py-3 min-w-[180px]">
                        <div className="font-extrabold text-slate-900">{template.name}</div>
                        <div className="mt-0.5 text-[10px] text-slate-500 leading-relaxed max-w-[200px]">{template.description}</div>
                        <div className="mt-1 text-[10px] text-slate-400">Profile: {template.usesDefaultProfile ? "Company default" : (template.profileName || "Specific profile")}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 font-bold ${template.recipientType === "tenant" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-violet-200 bg-violet-50 text-violet-700"}`}>
                          {smsRecipientLabels[template.recipientType] || template.recipientType}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 font-bold ${template.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                          {template.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 font-bold ${template.sendMode === "automatic" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                          {template.sendMode === "automatic" ? "Auto" : "Manual"}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className={`font-semibold ${smsInfo.segments > 1 ? "text-amber-700" : "text-slate-800"}`}>{smsInfo.chars} ch</div>
                        <div className="text-[10px] text-slate-400">{smsInfo.segments} SMS · {smsInfo.encoding}</div>
                      </td>
                      <td className="px-3 py-3 max-w-[320px]">
                        <div className="font-mono text-[11px] leading-relaxed text-slate-700 line-clamp-2">
                          {renderMessageWithPlaceholders(template.messageBody)}
                        </div>
                        {Array.isArray(template.placeholders) && template.placeholders.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {template.placeholders.slice(0, 7).map((p) => (
                              <span key={p} className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{`{${p}}`}</span>
                            ))}
                            {template.placeholders.length > 7 && (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">+{template.placeholders.length - 7} more</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); openSmsTemplateEditor(template); }}
                            className="inline-flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"
                          >
                            <FaPen className="text-[9px]" /> Edit
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleQuickSmsTemplateUpdate(template, { enabled: !template.enabled }, template.enabled ? "Template disabled" : "Template enabled"); }}
                            className={`inline-flex h-7 items-center gap-1 rounded border px-2.5 text-[11px] font-bold transition ${template.enabled ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
                          >
                            <FaPowerOff className="text-[9px]" /> {template.enabled ? "Off" : "On"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderSmsTab = () => {
    const smsNavItems = [
      { key: "configuration", label: "Configuration", icon: <FaServer className="text-[9px]" /> },
      ...(hasPM || hasCW ? [{ key: "templates", label: "SMS Templates", icon: <FaListAlt className="text-[9px]" /> }] : []),
      { key: "sent", label: "Sent", icon: <FaPaperPlane className="text-[9px]" /> },
      { key: "failed", label: "Failed", icon: <FaExclamationTriangle className="text-[9px]" /> },
      { key: "pending", label: "Inbox / Pending", icon: <FaHistory className="text-[9px]" /> },
    ];

    const filteredSmsLogs = smsLogs.filter((log) => {
      if (!smsLogsSearch) return true;
      const q = smsLogsSearch.toLowerCase();
      return (
        String(log.to || "").toLowerCase().includes(q) ||
        String(log.recipientName || "").toLowerCase().includes(q) ||
        String(log.body || "").toLowerCase().includes(q) ||
        String(log.templateKey || "").toLowerCase().includes(q) ||
        String(log.profileName || "").toLowerCase().includes(q) ||
        String(log.provider || "").toLowerCase().includes(q) ||
        String(log.contextType || "").toLowerCase().includes(q)
      );
    });

    const smsLogsTotalPages = Math.max(1, Math.ceil(filteredSmsLogs.length / SMS_LOGS_PAGE_SIZE));
    const smsLogsSafePage = Math.min(smsLogsPage, smsLogsTotalPages);
    const smsLogsStart = filteredSmsLogs.length === 0 ? 0 : (smsLogsSafePage - 1) * SMS_LOGS_PAGE_SIZE;
    const smsLogsEnd = smsLogsStart + SMS_LOGS_PAGE_SIZE;
    const smsLogsPaged = filteredSmsLogs.slice(smsLogsStart, smsLogsEnd);

    const logStatusBadge = (status) => {
      if (status === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
      if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
      return "border-slate-200 bg-slate-50 text-slate-600";
    };

    return (
      <div className="space-y-3">
        {/* Sub-tab bar */}
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
          {smsNavItems.map((item) => {
            const isActive = activeSmsSection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => switchSmsSection(item.key)}
                className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition ${isActive ? "bg-[#0B3B2E] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Configuration / Templates sub-views */}
        {activeSmsSection === "templates" && renderSmsTemplatesTab()}
        {activeSmsSection === "configuration" && renderSmsConfiguration()}

        {/* ── Logs sub-tabs (sent / failed / pending) ── */}
        {["sent", "failed", "pending"].includes(activeSmsSection) && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* sticky compact header */}
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-[#0B3B2E] px-3 py-2">
              <div className="flex items-center gap-2">
                {activeSmsSection === "sent" && <FaPaperPlane className="text-emerald-400 text-xs" />}
                {activeSmsSection === "failed" && <FaExclamationTriangle className="text-red-400 text-xs" />}
                {activeSmsSection === "pending" && <FaHistory className="text-slate-300 text-xs" />}
                <span className="text-xs font-bold text-white capitalize">{activeSmsSection === "pending" ? "Inbox / Pending" : activeSmsSection} SMS</span>
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white">{filteredSmsLogs.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400" />
                  <input
                    value={smsLogsSearch}
                    onChange={(e) => { setSmsLogsSearch(e.target.value); setSmsLogsPage(1); }}
                    placeholder="Search logs…"
                    className="h-7 w-44 rounded border border-slate-600 bg-[#0d4535] pl-7 pr-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  />
                </div>
                <button
                  onClick={() => {
                    setSmsLogsLoading(true);
                    getSmsLogs(currentCompany._id, { channel: "sms", limit: 200, status: activeSmsSection })
                      .then((data) => setSmsLogs(Array.isArray(data) ? data : []))
                      .catch(() => setSmsLogs([]))
                      .finally(() => setSmsLogsLoading(false));
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded border border-slate-600 bg-[#0d4535] px-2 text-xs font-bold text-white transition hover:bg-[#0a3427]"
                >
                  <FaSyncAlt className="text-[9px]" /> Refresh
                </button>
              </div>
            </div>

            {/* table body */}
            {smsLogsLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-slate-500">Loading SMS logs…</div>
            ) : filteredSmsLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
                <FaSms className="text-3xl opacity-30" />
                <p className="text-sm font-semibold">No {activeSmsSection} SMS found</p>
                <p className="text-xs">SMS messages sent through the system will appear here once they are logged.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold">#</th>
                        <th className="px-3 py-2 text-left font-bold">To</th>
                        <th className="px-3 py-2 text-left font-bold">Message</th>
                        <th className="px-3 py-2 text-left font-bold">Template</th>
                        <th className="px-3 py-2 text-left font-bold">Provider</th>
                        <th className="px-3 py-2 text-left font-bold">Context</th>
                        <th className="px-3 py-2 text-center font-bold">Status</th>
                        <th className="px-3 py-2 text-right font-bold">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {smsLogsPaged.map((log, idx) => (
                        <tr key={log._id || idx} className="border-b border-slate-100 transition hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-400">{smsLogsStart + idx + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{log.to || "—"}</div>
                            {log.recipientName ? <div className="text-[10px] text-slate-500">{log.recipientName}</div> : null}
                          </td>
                          <td className="max-w-[220px] truncate px-3 py-2 text-slate-700" title={log.body}>{log.body || "—"}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{log.templateKey || "—"}</td>
                          <td className="px-3 py-2 text-slate-700 capitalize">{log.provider || log.profileName || "—"}</td>
                          <td className="px-3 py-2 text-slate-600 capitalize">{log.contextType ? String(log.contextType).replace(/_/g, " ") : "—"}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${logStatusBadge(log.status)}`}>
                              {log.status || "—"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-slate-500">
                            {log.sentAt ? new Date(log.sentAt).toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* pagination footer */}
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold">
                    Showing <span className="font-bold text-slate-900">{filteredSmsLogs.length === 0 ? 0 : smsLogsStart + 1}</span>–<span className="font-bold text-slate-900">{Math.min(smsLogsEnd, filteredSmsLogs.length)}</span> of <span className="font-bold text-slate-900">{filteredSmsLogs.length}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setSmsLogsPage(1)} disabled={smsLogsSafePage === 1} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">«</button>
                    <button onClick={() => setSmsLogsPage((p) => Math.max(1, p - 1))} disabled={smsLogsSafePage === 1} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">‹</button>
                    <span className="font-semibold text-slate-700">Page {smsLogsSafePage} of {smsLogsTotalPages}</span>
                    <button onClick={() => setSmsLogsPage((p) => Math.min(smsLogsTotalPages, p + 1))} disabled={smsLogsSafePage === smsLogsTotalPages} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">›</button>
                    <button onClick={() => setSmsLogsPage(smsLogsTotalPages)} disabled={smsLogsSafePage === smsLogsTotalPages} className="rounded border border-slate-300 px-2 py-1 font-semibold transition hover:bg-slate-50 disabled:opacity-40">»</button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const getSessionStatus = (user = {}) => {
    if (user.locked) return { label: "Locked", className: "border-amber-200 bg-amber-50 text-amber-700" };
    if (user.isActive === false) return { label: "Inactive", className: "border-slate-200 bg-slate-50 text-slate-600" };
    if (!user.lastLogin) return { label: "Never signed in", className: "border-rose-200 bg-rose-50 text-rose-700" };
    const ageDays = Math.floor((Date.now() - new Date(user.lastLogin).getTime()) / (1000 * 60 * 60 * 24));
    if (ageDays <= 1) return { label: "Recently active", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
    if (ageDays <= 30) return { label: "Active", className: "border-blue-200 bg-blue-50 text-blue-700" };
    return { label: "Dormant", className: "border-orange-200 bg-orange-50 text-orange-700" };
  };

  const renderActivitiesTab = () => {
    const criticalCount = auditLogs.filter((log) => log.severity === "critical").length;
    const signedInCount = userSessions.filter((user) => Boolean(user.lastLogin)).length;
    const lockedCount = userSessions.filter((user) => user.locked || user.isActive === false).length;

    const searchLower = activitySearch.trim().toLowerCase();
    const filteredLogs = auditLogs.filter((log) => {
      if (!searchLower) return true;
      return (
        (log.message || "").toLowerCase().includes(searchLower) ||
        (log.actorName || "").toLowerCase().includes(searchLower) ||
        (log.actorEmail || "").toLowerCase().includes(searchLower) ||
        (log.category || "").toLowerCase().includes(searchLower) ||
        (log.targetName || "").toLowerCase().includes(searchLower) ||
        (log.action || "").toLowerCase().includes(searchLower)
      );
    });

    const actTotalPages = Math.max(1, Math.ceil(filteredLogs.length / ACTIVITIES_PAGE_SIZE));
    const actPage = Math.min(activitiesPage, actTotalPages);
    const actSlice = filteredLogs.slice((actPage - 1) * ACTIVITIES_PAGE_SIZE, actPage * ACTIVITIES_PAGE_SIZE);

    const sesTotalPages = Math.max(1, Math.ceil(userSessions.length / SESSIONS_PAGE_SIZE));
    const sesPage = Math.min(sessionsPage, sesTotalPages);
    const sesSlice = userSessions.slice((sesPage - 1) * SESSIONS_PAGE_SIZE, sesPage * SESSIONS_PAGE_SIZE);

    const PaginationBar = ({ page, totalPages, total, pageSize, onPage, label }) => {
      const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
      const to = Math.min(page * pageSize, total);
      const pages = [];
      if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
      } else if (page <= 4) {
        pages.push(1, 2, 3, 4, 5, "…", totalPages);
      } else if (page >= totalPages - 3) {
        pages.push(1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, "…", page - 1, page, page + 1, "…", totalPages);
      }
      return (
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/80 px-3 py-2">
          <span className="text-[11px] text-slate-500">{total === 0 ? `No ${label}` : `${from}–${to} of ${total} ${label}`}</span>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => onPage(1)} className="h-6 w-6 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30">«</button>
            <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-6 w-6 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30">‹</button>
            {pages.map((p, i) =>
              p === "…" ? (
                <span key={`e${i}`} className="px-1 text-[11px] text-slate-400">…</span>
              ) : (
                <button key={p} onClick={() => onPage(p)} className={`h-6 min-w-[24px] rounded border px-1 text-[11px] font-bold transition ${p === page ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{p}</button>
              )
            )}
            <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="h-6 w-6 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30">›</button>
            <button disabled={page >= totalPages} onClick={() => onPage(totalPages)} className="h-6 w-6 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30">»</button>
          </div>
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-2">
        {/* ── Compact stat strip ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Events</span>
            <span className="text-sm font-extrabold text-slate-900">{auditLogs.length}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wide text-rose-600">Critical</span>
            <span className="text-sm font-extrabold text-slate-900">{criticalCount}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wide text-emerald-700">Users</span>
            <span className="text-sm font-extrabold text-slate-900">{signedInCount}/{userSessions.length}</span>
          </div>
          {lockedCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wide text-amber-700">Locked</span>
              <span className="text-sm font-extrabold text-slate-900">{lockedCount}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setActivityView("activities")} className={`rounded border px-3 py-1.5 text-xs font-bold transition ${activityView === "activities" ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>Activities</button>
            <button onClick={() => { setActivityView("sessions"); setSessionsPage(1); }} className={`rounded border px-3 py-1.5 text-xs font-bold transition ${activityView === "sessions" ? "border-[#0B3B2E] bg-[#0B3B2E] text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>Sessions</button>
            <button onClick={() => setActivityRefreshKey((k) => k + 1)} title="Refresh" className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50">↺</button>
          </div>
        </div>

        {/* ── Main table panel — fills 95% of viewport height ── */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" style={{ minHeight: "calc(95vh - 220px)" }}>
          {activityView === "activities" ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-3 py-2">
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                  <input value={activitySearch} onChange={(e) => { setActivitySearch(e.target.value); setActivitiesPage(1); }} placeholder="Search events…" className="h-7 w-48 rounded border border-slate-300 bg-[#DDEFE1] pl-7 pr-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
                <select value={activityCategory} onChange={(e) => { setActivityCategory(e.target.value); setActivitiesPage(1); }} className="h-7 rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]">
                  <option value="all">All categories</option>
                  <option value="auth">Sign-ins</option>
                  <option value="users">User access</option>
                  <option value="company">Company setup</option>
                  <option value="settings">Operational settings</option>
                  <option value="finance">Receipts & finance</option>
                  <option value="property">Tenants & property</option>
                </select>
                <span className="text-[11px] font-semibold text-slate-500">{loadingAudit ? "Loading…" : `${filteredLogs.length} event${filteredLogs.length !== 1 ? "s" : ""}`}</span>
              </div>
              <div className="flex-1 overflow-x-auto overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">#</th>
                      <th className="px-3 py-2 text-left font-semibold">When</th>
                      <th className="px-3 py-2 text-left font-semibold">Who</th>
                      <th className="px-3 py-2 text-left font-semibold">Activity</th>
                      <th className="px-3 py-2 text-left font-semibold">Area</th>
                      <th className="px-3 py-2 text-left font-semibold">Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingAudit ? (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Loading activities…</td></tr>
                    ) : actSlice.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">{searchLower ? "No events match your search." : "No activity has been logged yet."}</td></tr>
                    ) : actSlice.map((log, idx) => (
                      <tr key={log._id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-1.5 font-semibold text-slate-400">{(actPage - 1) * ACTIVITIES_PAGE_SIZE + idx + 1}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{formatDateTime(log.createdAt)}</td>
                        <td className="px-3 py-1.5">
                          <div className="font-bold text-slate-900">{log.actorName || log.actorEmail || "System"}</div>
                          {log.actorEmail && log.actorName ? <div className="text-[10px] text-slate-400">{log.actorEmail}</div> : null}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="font-semibold text-slate-800">{log.message}</div>
                          {log.action ? <div className="text-[10px] text-slate-400">{log.action}</div> : null}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${log.severity === "critical" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{log.category}</span>
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">{log.targetName || log.targetType || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar page={actPage} totalPages={actTotalPages} total={filteredLogs.length} pageSize={ACTIVITIES_PAGE_SIZE} onPage={setActivitiesPage} label="events" />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-3 py-2">
                <span className="text-[11px] font-semibold text-slate-500">{userSessions.length} user{userSessions.length !== 1 ? "s" : ""} in company{lockedCount > 0 ? ` · ${lockedCount} locked` : ""}</span>
              </div>
              <div className="flex-1 overflow-x-auto overflow-y-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-[#0B3B2E] text-white">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">#</th>
                      <th className="px-3 py-2 text-left font-semibold">User</th>
                      <th className="px-3 py-2 text-left font-semibold">Role</th>
                      <th className="px-3 py-2 text-left font-semibold">Last Sign-In</th>
                      <th className="px-3 py-2 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loadingAudit ? (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading sessions…</td></tr>
                    ) : sesSlice.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No users found for this company.</td></tr>
                    ) : sesSlice.map((user, idx) => {
                      const status = getSessionStatus(user);
                      const name = `${user.surname || ""} ${user.otherNames || ""}`.trim() || user.email || "User";
                      return (
                        <tr key={user._id} className="hover:bg-slate-50/70">
                          <td className="px-3 py-1.5 font-semibold text-slate-400">{(sesPage - 1) * SESSIONS_PAGE_SIZE + idx + 1}</td>
                          <td className="px-3 py-1.5">
                            <div className="font-bold text-slate-900">{name}</div>
                            <div className="text-[10px] text-slate-400">{user.email}</div>
                          </td>
                          <td className="px-3 py-1.5 text-slate-600">{user.adminAccess ? "Company Admin" : (user.setupAccess || user.companySetupAccess) ? "Setup Admin" : user.profile || "User"}</td>
                          <td className="px-3 py-1.5 text-slate-500">{user.lastLogin ? formatDateTime(user.lastLogin) : "Never"}</td>
                          <td className="px-3 py-1.5"><span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationBar page={sesPage} totalPages={sesTotalPages} total={userSessions.length} pageSize={SESSIONS_PAGE_SIZE} onPage={setSessionsPage} label="users" />
            </>
          )}
        </div>
      </div>
    );
  };

  const renderTab = () => {
    switch (activeTab) {
      case "details":
        return renderDetailsTab();
      case "structure":
        return renderStructureTab();
      case "modules":
        return renderModulesTab();
      case "payments":
        return renderPaymentsTab();
      case "email":
        return renderEmailTab();
      case "sms":
        return renderSmsTab();
      case "activities":
        return renderActivitiesTab();
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
      <div className="w-full px-4 py-3 2xl:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xl font-extrabold text-slate-900">Company Setup</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-600">
              {hasPM && (
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{companyOperatingModeOptions.find((option) => option.value === normalizeCompanyOperatingMode(company.companyMode))?.label || "Other"}</span>
              )}
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1">{Object.values(normalizeCompanyModules(company.modules || {})).filter(Boolean).length} modules assigned</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshSetup}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold transition hover:bg-slate-50"
            >
              <FaSyncAlt /> Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
            >
              Operational Settings <FaArrowRight />
            </button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-4">
          <button onClick={() => switchTab('details')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Profile</div>
            <div className="mt-0.5 text-xs font-extrabold text-slate-900">Company details</div>
          </button>
          <button onClick={() => switchTab('payments')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Payments</div>
            <div className="mt-0.5 text-xs font-extrabold text-slate-900">{paymentSummary.active} active / {paymentSummary.total}</div>
          </button>
          <button onClick={() => switchTab('email')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Email</div>
            <div className="mt-0.5 text-xs font-extrabold text-slate-900">{emailSummary.active} active / {emailSummary.total}</div>
          </button>
          <button onClick={() => navigate('/settings')} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left shadow-sm transition hover:border-amber-300 hover:bg-amber-100/70">
            <div className="text-[10px] font-black uppercase tracking-wide text-amber-700">Operational</div>
            <div className="mt-0.5 text-xs font-extrabold text-slate-900">
              {hasPM ? `Tax ${taxSetupSummary.enabled ? 'enabled' : 'disabled'}` : hasHR ? 'HR & Payroll' : hasCW ? 'Car Wash' : hasSale ? 'Property Sales' : 'Settings'}
            </div>
          </button>
        </div>

        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
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

        <div className="mt-2">{renderTab()}</div>
      </div>

      <Modal
        open={smsConfigModalOpen}
        onClose={closeSmsConfigModal}
        title={selectedSmsProfileId === SMS_DRAFT_ID ? "New SMS Configuration" : "SMS Configuration Details"}
        subtitle=""
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
        {/* ── Status banner ── */}
        <div className={`rounded-xl border p-3 ${smsTheme.panel}`}>
          <div className="flex items-center gap-2.5">
            <span className="text-base">{smsTheme.icon}</span>
            <div>
              <div className="text-xs font-bold text-slate-900">{smsStatus.label}</div>
              <div className="text-xs leading-5 text-slate-600">{smsStatus.reason}</div>
            </div>
          </div>
        </div>

        {/* ── Profile name + activation ── */}
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="lg:col-span-2">
            <label className="text-xs font-bold text-slate-700">Configuration Name</label>
            <Input value={smsForm.name} onChange={(e) => setSmsForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Main Tenant SMS" />
          </div>
          <ToggleRow
            checked={smsForm.enabled}
            onChange={(e) => setSmsForm((prev) => ({ ...prev, enabled: e.target.checked, isDefault: e.target.checked ? prev.isDefault : false }))}
            title="Enable this profile"
            description="Make this profile available for SMS sending."
          />
          <ToggleRow
            checked={smsForm.isDefault}
            onChange={(e) => setSmsForm((prev) => ({ ...prev, isDefault: e.target.checked, enabled: e.target.checked ? true : prev.enabled }))}
            title="Set as default"
            description="Templates with no specific profile assigned will use this one."
          />
        </div>

        {/* ── Provider selection cards ── */}
        <div className="mt-5">
          <label className="text-xs font-bold text-slate-700">SMS Provider</label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {smsProviderOptions.map((opt) => {
              const active = smsForm.provider === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSmsForm((prev) => ({ ...prev, provider: opt.value }))}
                  className={`flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all ${
                    active
                      ? `${opt.color} shadow-sm ring-2 ring-offset-1 ring-current`
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className={`h-2 w-2 rounded-full ${active ? opt.dot : "bg-slate-300"}`} />
                    {active && <span className="text-[8px] font-bold uppercase tracking-widest opacity-70">Selected</span>}
                  </div>
                  <div className="text-[11px] font-bold leading-tight">{opt.label}</div>
                  <div className="text-[9px] leading-tight opacity-70">{opt.tagline}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Credentials ── */}
        {(() => {
          const fields = smsProviderFields[smsForm.provider] || smsProviderFields.generic;
          const hints   = smsProviderHints[smsForm.provider]  || smsProviderHints.generic;
          return (
            <div className="mt-5 space-y-4">
              <div className="border-t border-slate-100 pt-4">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">Credentials</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Sender ID — always shown */}
                  <div>
                    <label className="text-xs font-bold text-slate-700">Sender ID / Shortcode</label>
                    <Input value={smsForm.senderId} onChange={(e) => setSmsForm((prev) => ({ ...prev, senderId: e.target.value }))} placeholder="e.g. MILIK" />
                    <p className="mt-1 text-[10px] text-slate-400">Alphanumeric sender name or shortcode registered with your provider.</p>
                  </div>

                  {/* Country code — always shown */}
                  <div>
                    <label className="text-xs font-bold text-slate-700">Default Country Code</label>
                    <Input value={smsForm.defaultCountryCode} onChange={(e) => setSmsForm((prev) => ({ ...prev, defaultCountryCode: e.target.value }))} placeholder="+254" />
                    <p className="mt-1 text-[10px] text-slate-400">Normalises local numbers — 0712345678 → +254712345678.</p>
                  </div>

                  {/* Username — conditional */}
                  {fields.username && (
                    <div>
                      <label className="text-xs font-bold text-slate-700">
                        {smsForm.provider === "twilio" ? "Account SID" : "Account Username"}
                      </label>
                      <Input
                        value={smsForm.accountUsername}
                        onChange={(e) => setSmsForm((prev) => ({ ...prev, accountUsername: e.target.value }))}
                        placeholder={hints.username}
                      />
                      <p className="mt-1 text-[10px] text-slate-400">{hints.username}</p>
                    </div>
                  )}

                  {/* API Key — always shown */}
                  <div>
                    <label className="text-xs font-bold text-slate-700">
                      {smsForm.provider === "twilio" ? "Auth Token" : "API Key"}
                    </label>
                    <Input
                      type="password"
                      value={smsForm.apiKey}
                      onChange={(e) => setSmsForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                      placeholder={smsForm.hasApiKey ? "Leave blank to keep existing key" : hints.apiKey}
                    />
                    <p className="mt-1 text-[10px] text-slate-400">
                      {smsForm.hasApiKey ? (smsForm.apiKeyMasked || "Saved — masked for security") : hints.apiKey}
                    </p>
                  </div>

                  {/* API Secret — conditional */}
                  {fields.apiSecret && (
                    <div>
                      <label className="text-xs font-bold text-slate-700">API Secret / Token</label>
                      <Input
                        type="password"
                        value={smsForm.apiSecret}
                        onChange={(e) => setSmsForm((prev) => ({ ...prev, apiSecret: e.target.value }))}
                        placeholder={smsForm.hasApiSecret ? "Leave blank to keep existing secret" : "Optional"}
                      />
                      <p className="mt-1 text-[10px] text-slate-400">
                        {smsForm.hasApiSecret ? (smsForm.apiSecretMasked || "Saved — masked for security") : (hints.apiSecret || "Leave blank if not required.")}
                      </p>
                    </div>
                  )}

                  {/* Callback URL — conditional */}
                  {fields.callback && (
                    <div className="sm:col-span-2">
                      <label className="text-xs font-bold text-slate-700">Endpoint / Callback URL</label>
                      <Input
                        value={smsForm.callbackUrl}
                        onChange={(e) => setSmsForm((prev) => ({ ...prev, callbackUrl: e.target.value }))}
                        placeholder={hints.callback || "https://provider.example.com/api/sms/send"}
                      />
                      <p className="mt-1 text-[10px] text-slate-400">{hints.callback}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Sandbox toggle — AT only */}
              {fields.sandbox && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold text-amber-800">Sandbox / Test Mode</p>
                      <p className="mt-0.5 text-[10px] text-amber-700">
                        Routes messages to the Africa&apos;s Talking sandbox endpoint. Use username <strong>sandbox</strong> and your sandbox API key. Turn off before going live.
                      </p>
                    </div>
                    <label className="relative mt-0.5 flex-shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={smsForm.useSandbox}
                        onChange={(e) => setSmsForm((prev) => ({ ...prev, useSandbox: e.target.checked }))}
                      />
                      <div className="h-5 w-9 rounded-full bg-slate-200 transition-colors peer-checked:bg-amber-500" />
                      <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                    </label>
                  </div>
                  {smsForm.useSandbox && (
                    <p className="mt-2 text-[10px] font-semibold text-amber-700">
                      ⚠️ Sandbox active — messages will NOT be delivered to real phones.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={smsTemplateModalOpen}
        onClose={closeSmsTemplateModal}
        title={smsTemplateForm?.name || "SMS Template"}
        subtitle={smsTemplateForm?.description || "Adjust the message text, send mode and SMS profile for this operation."}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={closeSmsTemplateModal}>
              Cancel
            </button>
            <button
              disabled={savingSmsTemplates}
              onClick={handleSaveSmsTemplate}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0B3B2E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0A3127] disabled:opacity-60"
            >
              <FaSave /> {savingSmsTemplates ? "Saving…" : "Save Template"}
            </button>
          </div>
        }
      >
        {smsTemplateForm ? (() => {
          const smsInfo = countSmsInfo(smsTemplateForm.messageBody || "");
          return (
            <div className="space-y-5">
              {/* meta row */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Recipient</label>
                  <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800">
                    {smsRecipientLabels[smsTemplateForm.recipientType] || smsTemplateForm.recipientType}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Send Mode</label>
                  <Select value={smsTemplateForm.sendMode} onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, sendMode: e.target.value }))}>
                    <option value="manual">Manual</option>
                    <option value="automatic">Automatic</option>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">SMS Profile</label>
                  <Select value={smsTemplateForm.profileId} onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, profileId: e.target.value }))}>
                    <option value="">Company default</option>
                    {smsProfiles.map((profile) => (
                      <option key={profile._id} value={profile._id}>
                        {profile.name}{profile.enabled ? "" : " (disabled)"}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <ToggleRow
                checked={smsTemplateForm.enabled}
                onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                title="Enable this SMS template"
                description="Keep the template available for this company. Disable it when that operation should never trigger SMS."
              />

              {/* message body */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Message Body</label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`font-semibold ${smsInfo.segments > 1 ? "text-amber-600" : "text-slate-400"}`}>
                      {smsInfo.chars} ch · {smsInfo.segments} SMS · {smsInfo.encoding}
                    </span>
                    <span className="text-slate-400">{smsInfo.remaining} remaining</span>
                  </div>
                </div>
                <textarea
                  ref={smsBodyRef}
                  value={smsTemplateForm.messageBody}
                  onChange={(e) => setSmsTemplateForm((prev) => ({ ...prev, messageBody: e.target.value }))}
                  rows={5}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-2 focus:ring-emerald-100"
                  placeholder="Write the SMS message here. Click any placeholder below to insert it at the cursor."
                />
              </div>

              {/* clickable placeholders */}
              {smsTemplateForm.placeholders.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Available Placeholders</span>
                    <span className="text-[10px] text-slate-400">Click to insert at cursor</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {smsTemplateForm.placeholders.map((placeholder) => (
                      <button
                        key={placeholder}
                        type="button"
                        onClick={() => insertPlaceholderAtCursor(placeholder)}
                        title={`Insert {${placeholder}}`}
                        className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-[11px] font-bold text-emerald-700 transition hover:border-[#0B3B2E] hover:bg-[#0B3B2E] hover:text-white"
                      >
                        {`{${placeholder}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })() : null}
      </Modal>
    </DashboardLayout>
  );
}
