import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "../../hooks/useTabState";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useSearchParams } from "react-router-dom";
import { selectCurrentCompany } from "../../redux/selectors";
import toast from "react-hot-toast";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import AppSelect from "../../components/common/AppSelect";
import {
  FaBuilding,
  FaSitemap,
  FaMoneyCheckAlt,
  FaEnvelope,
  FaSms,
  FaUsers,
  FaUserClock,
  FaHistory,
  FaImage,
  FaSave,
  FaCheckCircle,
  FaExclamationTriangle,
  FaShieldAlt,
  FaSyncAlt,
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
import { carWashApi } from "../../services/carWashApi";
import { COMPANY_OPERATING_MODES, MODULE_LABELS, hasCompanyModule, normalizeCompanyModules, normalizeCompanyOperatingMode } from "../../utils/companyModules";
import { isCashbookAccount } from "../../utils/cashbookUtils";
import { useConfirm } from "../../context/ConfirmContext";

const PAYMENT_DRAFT_ID = "__new_mpesa_paybill__";
const EMAIL_DRAFT_ID = "__new_email_profile__";
const SMS_DRAFT_ID = "__new_sms_profile__";
const validSmsSections = new Set(["configuration", "templates", "sent", "failed", "pending"]);

const ALL_VALID_TAB_KEYS = new Set(["details", "structure", "payments", "email", "sms", "activities"]);

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

const companyOperatingModeOptions = [
  { value: COMPANY_OPERATING_MODES.PROPERTY_MANAGER,      label: "Property Manager",       description: "Manages properties on behalf of landlords. Full landlord statement and commission flows enabled." },
  { value: COMPANY_OPERATING_MODES.SELF_MANAGING_LANDLORD,label: "Self-Managing Landlord", description: "Landlord manages their own properties directly. Simplified workflow without commission structures." },
  { value: COMPANY_OPERATING_MODES.REAL_ESTATE_AGENCY,    label: "Real Estate Agency",     description: "Property sales focus — listings, buyers, offers, deals and commissions." },
  { value: COMPANY_OPERATING_MODES.HOSPITALITY,           label: "Hospitality / Hotel",    description: "Short-stay lodging, hotel rooms, front-office check-in/out and occupancy management." },
  { value: COMPANY_OPERATING_MODES.CARWASH,               label: "Car Wash Business",      description: "Service bays, wash packages, branch management and M-Pesa C2B payments." },
  { value: COMPANY_OPERATING_MODES.SACCO,                 label: "SACCO / Cooperative",   description: "Member shares, savings, loans and cooperative governance workflows." },
  { value: COMPANY_OPERATING_MODES.RETAIL,                label: "Retail / POS",           description: "Point-of-sale, stock management, inventory tracking and sales reporting." },
  { value: COMPANY_OPERATING_MODES.SECURITY_SERVICES,     label: "Security Services",      description: "Guard deployment, client contracts, incident reporting and patrol management." },
  { value: COMPANY_OPERATING_MODES.ACADEMIC,              label: "Academic Institution",   description: "Schools, colleges and universities — student records, fees and academic workflows." },
  { value: COMPANY_OPERATING_MODES.FACILITY_MANAGEMENT,   label: "Facility Management",    description: "Maintenance scheduling, asset tracking and facility service-level management." },
  { value: COMPANY_OPERATING_MODES.TELCO_DEALERSHIP,      label: "Telco Dealership",       description: "Telecom product sales, airtime, SIM activations and dealer commission tracking." },
  { value: COMPANY_OPERATING_MODES.HR_SERVICES,           label: "HR / Payroll Services",  description: "Employee records, leave management, payroll processing and HR reporting." },
  { value: COMPANY_OPERATING_MODES.PROJECT_MANAGEMENT,    label: "Project Management",     description: "Project planning, task tracking, milestones and resource allocation." },
  { value: COMPANY_OPERATING_MODES.ASSET_VALUATION,       label: "Asset Valuation",        description: "Property and asset valuations, valuation reports and client management." },
  { value: COMPANY_OPERATING_MODES.OTHER,                 label: "Other",                  description: "General business workspace for companies that do not fit a specific category above." },
];

const Card = ({ title, subtitle, children, action = null }) => (
  <div className="border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 bg-[#0B3B2E] px-3 py-2">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-white">{title}</div>
        {subtitle ? <div className="mt-0.5 text-[10px] text-[#B7C9C0]">{subtitle}</div> : null}
      </div>
      {action}
    </div>
    <div className="px-3 py-3">{children}</div>
  </div>
);

const Modal = ({ open, title, subtitle, onClose, children, footer = null }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 px-4 py-6">
      <div className="w-full max-w-3xl overflow-hidden border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 bg-[#0B3B2E] px-4 py-3">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wide text-white">{title}</div>
            {subtitle ? <div className="mt-0.5 text-[10px] text-[#B7C9C0]">{subtitle}</div> : null}
          </div>
          <button onClick={onClose} className="border border-[#2A5C4A] px-3 py-1 text-[11px] font-bold text-white hover:bg-[#0A3127]">Close</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <div className="border-t border-slate-200 bg-[#F6FAF8] px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
};

const Input = ({ className = "", ...props }) => (
  <input
    {...props}
    className={`w-full border border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20 ${className}`}
  />
);


const ToggleRow = ({ checked, onChange, title, description, disabled = false }) => (
  <label
    className={[
      "flex items-start gap-3 border px-3 py-2.5 transition",
      checked ? "border-[#0B3B2E]/30 bg-[#EDF5F1]" : "border-slate-200 bg-white",
      disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-slate-300",
    ].join(" ")}
  >
    <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 h-3.5 w-3.5 border-slate-300 text-[#0B3B2E] focus:ring-[#0B3B2E]" />
    <div>
      <div className="text-[12px] font-bold text-slate-900">{title}</div>
      <div className="mt-0.5 text-[11px] leading-4 text-slate-600">{description}</div>
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
  initiatorName: "",
  initiatorPassword: "",
  hasInitiatorPassword: false,
  initiatorPasswordMasked: "",
  securityCredential: "",
  hasSecurityCredential: false,
  securityCredentialMasked: "",
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
    initiatorName: config.initiatorName || "",
    initiatorPassword: "",
    hasInitiatorPassword: Boolean(config.hasInitiatorPassword),
    initiatorPasswordMasked: config.initiatorPasswordMasked || "",
    securityCredential: "",
    hasSecurityCredential: Boolean(config.hasSecurityCredential),
    securityCredentialMasked: config.securityCredentialMasked || "",
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

const logStatusBadge = (status) => {
  if (status === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
};

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
  const [registeringUrls, setRegisteringUrls] = useState(false);
  const [savingEmails, setSavingEmails] = useState(false);
  const [savingSmsProfiles, setSavingSmsProfiles] = useState(false);
  const [savingSmsTemplates, setSavingSmsTemplates] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [loadingCashbooks, setLoadingCashbooks] = useState(false);
  const [cashbookOptions, setCashbookOptions] = useState([]);
  const [company, setCompany] = useState(normalizeForm(currentCompany));
  const [selectedPaymentConfigId, setSelectedPaymentConfigId] = useTabState("/company-setup:selectedPaymentConfigId", PAYMENT_DRAFT_ID);
  const [paymentForm, setPaymentForm] = useState(createBlankPaymentForm(1));
  const [selectedEmailProfileId, setSelectedEmailProfileId] = useTabState("/company-setup:selectedEmailProfileId", EMAIL_DRAFT_ID);
  const [emailForm, setEmailForm] = useState(createBlankEmailForm(1, currentCompany?.companyName || ""));
  const [selectedSmsProfileId, setSelectedSmsProfileId] = useTabState("/company-setup:selectedSmsProfileId", SMS_DRAFT_ID);
  const [smsForm, setSmsForm] = useState(createBlankSmsForm(1));
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [smsConfigModalOpen, setSmsConfigModalOpen] = useState(false);
  const [smsTemplateModalOpen, setSmsTemplateModalOpen] = useState(false);
  const [smsTemplateForm, setSmsTemplateForm] = useState(null);
  const smsBodyRef = useRef(null);
  const [smsTemplateSearch, setSmsTemplateSearch] = useState("");
  const [smsTemplateRecipientFilter, setSmsTemplateRecipientFilter] = useState("all");
  const [smsTemplateStatusFilter, setSmsTemplateStatusFilter] = useState("all");
  const [smsTemplatesModeFilter, setSmsTemplatesModeFilter] = useState("all");
  const [emailProfileSearch, setEmailProfileSearch] = useState("");
  const [smsProfileSearch, setSmsProfileSearch] = useTabState("/company-setup:smsProfileSearch", "");
  const [emailSubTab, setEmailSubTab] = useTabState("/company-setup:emailSubTab", "profiles");
  const [emailLogs, setEmailLogs] = useState([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [emailLogsSearch, setEmailLogsSearch] = useTabState("/company-setup:emailLogsSearch", "");
  const [emailLogsPage, setEmailLogsPage] = useTabState("/company-setup:emailLogsPage", 1);
  const EMAIL_LOGS_PAGE_SIZE = 30;
  const [smsLogs, setSmsLogs] = useState([]);
  const [smsLogsLoading, setSmsLogsLoading] = useState(false);
  const [smsLogsSearch, setSmsLogsSearch] = useTabState("/company-setup:smsLogsSearch", "");
  const [smsLogsPage, setSmsLogsPage] = useTabState("/company-setup:smsLogsPage", 1);
  const SMS_LOGS_PAGE_SIZE = 30;
  const [paymentSearch, setPaymentSearch] = useTabState("/company-setup:paymentSearch", "");
  const [coopModalOpen, setCoopModalOpen] = useState(false);
  const [selectedCoopConfigId, setSelectedCoopConfigId] = useTabState("/company-setup:selectedCoopConfigId", "__new_coop__");
  const [savingCoop, setSavingCoop] = useState(false);
  const COOP_DRAFT_ID = "__new_coop__";
  const [coopForm, setCoopForm] = useState({
    _id: COOP_DRAFT_ID, name: "", enabled: false, institutionCode: "", institutionName: "",
    connectionID: "", connectionPassword: "", coopBankAccountNumber: "", paybillNumber: "400222",
    defaultCashbookAccountId: "", defaultCashbookAccountName: "", postingMode: "manual_review",
    hasConnectionPassword: false, connectionPasswordMasked: "",
  });
  const [taxConfig, setTaxConfig] = useState(normalizeTaxConfiguration());
  const [activityView, setActivityView] = useTabState("/company-setup:activityView", "activities");
  const [activityCategory, setActivityCategory] = useTabState("/company-setup:activityCategory", "all");
  const [activitySearch, setActivitySearch] = useTabState("/company-setup:activitySearch", "");
  const [auditLogs, setAuditLogs] = useState([]);
  const [userSessions, setUserSessions] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [activitiesPage, setActivitiesPage] = useTabState("/company-setup:activitiesPage", 1);
  const [sessionsPage, setSessionsPage] = useTabState("/company-setup:sessionsPage", 1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const ACTIVITIES_PAGE_SIZE = 25;
  const SESSIONS_PAGE_SIZE = 20;

  const activeTab = ALL_VALID_TAB_KEYS.has(searchParams.get("tab")) ? searchParams.get("tab") : "details";
  const activeSmsSection = validSmsSections.has(searchParams.get("smsTab")) ? searchParams.get("smsTab") : "configuration";
  const paymentConfigs = useMemo(() => normalizePaymentConfigs(currentCompany), [currentCompany]);
  const coopConfigs    = useMemo(() => Array.isArray(currentCompany?.paymentIntegration?.coopB2BConfigs) ? currentCompany.paymentIntegration.coopB2BConfigs : [], [currentCompany]);
  const emailProfiles = useMemo(() => normalizeEmailConfigs(currentCompany), [currentCompany]);
  const smsProfiles = useMemo(() => normalizeSmsConfigs(currentCompany), [currentCompany]);
  const smsTemplates = useMemo(() => normalizeSmsTemplates(currentCompany), [currentCompany]);
  const emailEnabled = currentCompany?.communication?.emailEnabled !== false;
  const [togglingEmail, setTogglingEmail] = useState(false);

  const handleToggleEmailEnabled = async () => {
    if (!currentCompany?._id) return;
    setTogglingEmail(true);
    try {
      await dispatch(updateCompany(currentCompany._id, { communication: { emailEnabled: !emailEnabled } }));
      toast.success(emailEnabled ? "Email sending disabled" : "Email sending enabled");
    } catch {
      toast.error("Failed to update email setting");
    } finally {
      setTogglingEmail(false);
    }
  };

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

  // Audit logs — re-run on category filter change and explicit refresh
  useEffect(() => {
    if (activeTab !== "activities" || !currentCompany?._id) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoadingAudit(true);
      try {
        const logRes = await adminRequests.get("/audit-logs", {
          params: { companyId: currentCompany._id, category: activityCategory, limit: 200 },
        });
        if (!cancelled) setAuditLogs(Array.isArray(logRes?.data?.logs) ? logRes.data.logs : []);
      } catch (error) {
        if (!cancelled) toast.error(error?.response?.data?.message || "Failed to load company activities");
      } finally {
        if (!cancelled) setLoadingAudit(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, activityCategory, activityRefreshKey, currentCompany?._id]);

  // User sessions — independent of category filter; only re-run on refresh or company change
  useEffect(() => {
    if (activeTab !== "activities" || !currentCompany?._id) return undefined;
    let cancelled = false;
    adminRequests.get("/audit-logs/sessions", { params: { companyId: currentCompany._id } })
      .then((res) => { if (!cancelled) setUserSessions(Array.isArray(res?.data?.sessions) ? res.data.sessions : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab, activityRefreshKey, currentCompany?._id]);

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
      .then((data) => setEmailLogs(data?.logs || []))
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
    setPaymentModalOpen(true);
  };

  const beginEditPaymentConfig = (config) => {
    setSelectedPaymentConfigId(String(config._id));
    setPaymentForm(normalizePaymentEditor(config));
    setPaymentModalOpen(true);
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
    payload.initiatorName = paymentForm.initiatorName.trim();
    if (paymentForm.initiatorPassword.trim()) payload.initiatorPassword = paymentForm.initiatorPassword.trim();
    if (paymentForm.securityCredential.trim()) payload.securityCredential = paymentForm.securityCredential.trim();

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
        setPaymentModalOpen(false);
      },
    });
  };

  const handleRegisterUrls = async () => {
    const shortCode = paymentForm.shortCode.trim();
    if (!shortCode) { toast.error("Save the Paybill configuration first, then register the URLs."); return; }
    setRegisteringUrls(true);
    try {
      const result = await adminRequests.post("/mpesa-collections/register-urls", { shortCode }).then((r) => r.data);
      if (result?.alreadyRegistered) {
        toast(result.message, { icon: "⚠️", duration: 12000 });
      } else {
        toast.success(result?.message || "URLs registered with Safaricom. Payments will now flow through.");
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "URL registration failed. Check your Consumer Key and Secret.");
    } finally {
      setRegisteringUrls(false);
    }
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

  const mutateCoopConfig = async ({ action, configId = "", config = null, successMessage }) => {
    if (!currentCompany?._id) { toast.error("No active company selected"); return null; }
    setSavingCoop(true);
    try {
      const response = await dispatch(updateCompany(currentCompany._id, {
        paymentIntegration: { coopB2BConfigs: { action, configId, config } },
      }));
      toast.success(successMessage);
      return response?.company || null;
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to update Co-op B2B configuration");
      return null;
    } finally {
      setSavingCoop(false);
    }
  };

  const handleSaveCoopConfig = async () => {
    if (!coopForm.name.trim()) { toast.error("Enter a configuration name"); return; }
    if (!coopForm.institutionCode.trim()) { toast.error("Enter the Institution Code"); return; }
    if (!coopForm.connectionID.trim()) { toast.error("Enter the Connection ID"); return; }
    const isNew = selectedCoopConfigId === COOP_DRAFT_ID;
    await mutateCoopConfig({
      action: isNew ? "create" : "update",
      configId: isNew ? "" : selectedCoopConfigId,
      config: {
        name:                     coopForm.name.trim(),
        enabled:                  coopForm.enabled,
        institutionCode:          coopForm.institutionCode.trim(),
        institutionName:          coopForm.institutionName.trim(),
        connectionID:             coopForm.connectionID.trim(),
        connectionPassword:       coopForm.connectionPassword?.trim() || "",
        coopBankAccountNumber:    coopForm.coopBankAccountNumber.trim(),
        paybillNumber:            coopForm.paybillNumber.trim(),
        defaultCashbookAccountId: coopForm.defaultCashbookAccountId || null,
        defaultCashbookAccountName: coopForm.defaultCashbookAccountName,
        postingMode:              coopForm.postingMode,
      },
      successMessage: isNew ? "Co-op B2B configuration saved" : "Co-op B2B configuration updated",
    });
    setCoopModalOpen(false);
  };

  const handleDeleteCoopConfig = async (cfg) => {
    if (!await confirm({ title: "Delete Co-op B2B Config", message: `Delete "${cfg.name}"?`, confirmText: "Delete", isDangerous: true })) return;
    await mutateCoopConfig({ action: "delete", configId: String(cfg._id), successMessage: "Co-op B2B configuration deleted" });
  };

  const beginCreateCoopConfig = () => {
    setSelectedCoopConfigId(COOP_DRAFT_ID);
    setCoopForm({
      _id: COOP_DRAFT_ID, name: `Co-op B2B ${coopConfigs.length + 1}`, enabled: false,
      institutionCode: "", institutionName: "", connectionID: "", connectionPassword: "",
      coopBankAccountNumber: "", paybillNumber: "400222", defaultCashbookAccountId: "",
      defaultCashbookAccountName: "", postingMode: "manual_review", hasConnectionPassword: false, connectionPasswordMasked: "",
    });
    setCoopModalOpen(true);
  };

  const beginEditCoopConfig = (cfg) => {
    setSelectedCoopConfigId(String(cfg._id));
    setCoopForm({
      ...cfg, connectionPassword: "", _id: String(cfg._id),
    });
    setCoopModalOpen(true);
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
    if (!currentCompany?._id || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await dispatch(getCompany(currentCompany._id));
      const response = await adminRequests.get(`/company-settings/${currentCompany._id}`);
      setTaxConfig(normalizeTaxConfiguration(response?.data || {}));
      toast.success("Company setup refreshed");
    } catch {
      toast.error("Failed to refresh company setup");
    } finally {
      setIsRefreshing(false);
    }
  };

  const beginCreateEmailProfile = () => {
    setSelectedEmailProfileId(EMAIL_DRAFT_ID);
    setEmailForm(createBlankEmailForm(emailProfiles.length + 1, currentCompany?.companyName || ""));
    setEmailModalOpen(true);
  };

  const beginEditEmailProfile = (profile) => {
    setSelectedEmailProfileId(String(profile._id));
    setEmailForm(normalizeEmailEditor(profile));
    setEmailModalOpen(true);
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
        setEmailModalOpen(false);
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
      <Card title="Company Identity" subtitle="Used in reports, statements, receipts and printed documents">
        <div className="space-y-4">
          {/* Logo preview card */}
          <div className="border border-slate-200 bg-[#EDF5F1] p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden border-2 border-[#0B3B2E] bg-white">
                {company.logo ? (
                  <img src={company.logo} alt={company.companyName || "Company"} className="h-full w-full object-contain p-1" />
                ) : (
                  <FaImage className="text-2xl text-slate-300" />
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-extrabold text-[#0B3B2E]">{company.companyName || "Company Name"}</div>
                {company.slogan ? <div className="mt-0.5 truncate text-xs italic text-slate-500">{company.slogan}</div> : null}
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {company.town ? <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{company.town}</span> : null}
                  {company.country ? <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{company.country}</span> : null}
                  {company.taxRegime ? <span className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{company.taxRegime}</span> : null}
                </div>
              </div>
            </div>
            {(company.registrationNo || company.taxPIN) && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
                {company.registrationNo && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Reg No</div>
                    <div className="mt-0.5 text-[11px] font-bold text-slate-800">{company.registrationNo}</div>
                  </div>
                )}
                {company.taxPIN && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Tax PIN</div>
                    <div className="mt-0.5 text-[11px] font-bold text-slate-800">{company.taxPIN}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Logo URL</label>
            <Input value={company.logo} onChange={(e) => handleCompanyFieldChange("logo", e.target.value)} placeholder="https://.../logo.png" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Slogan</label>
            <Input value={company.slogan} onChange={(e) => handleCompanyFieldChange("slogan", e.target.value)} placeholder="Reliable property management" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Contact Email</label>
            <Input type="email" value={company.email} onChange={(e) => handleCompanyFieldChange("email", e.target.value)} placeholder="info@company.com" />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Phone Number</label>
            <Input value={company.phoneNo} onChange={(e) => handleCompanyFieldChange("phoneNo", e.target.value)} placeholder="0700 000 000" />
          </div>
        </div>
      </Card>

      <div className="space-y-3 xl:col-span-2">
        <Card title="Company Profile" subtitle="Maintain the operational and statutory details for the active company">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Company Name</label>
              <Input value={company.companyName} onChange={(e) => handleCompanyFieldChange("companyName", e.target.value)} placeholder="Milik Property Management" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Registration No</label>
              <Input value={company.registrationNo} onChange={(e) => handleCompanyFieldChange("registrationNo", e.target.value)} placeholder="PVT-001" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Tax PIN</label>
              <Input value={company.taxPIN} onChange={(e) => handleCompanyFieldChange("taxPIN", e.target.value)} placeholder="A123456789X" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Tax Exempt Code</label>
              <Input value={company.taxExemptCode} onChange={(e) => handleCompanyFieldChange("taxExemptCode", e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Country</label>
              <Input value={company.country} onChange={(e) => handleCompanyFieldChange("country", e.target.value)} placeholder="Kenya" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Town / City</label>
              <Input value={company.town} onChange={(e) => handleCompanyFieldChange("town", e.target.value)} placeholder="Nairobi" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Postal Address</label>
              <Input value={company.postalAddress} onChange={(e) => handleCompanyFieldChange("postalAddress", e.target.value)} placeholder="P.O. Box 12345 - 00100" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Road / Street</label>
              <Input value={company.roadStreet} onChange={(e) => handleCompanyFieldChange("roadStreet", e.target.value)} placeholder="Westlands Road" />
            </div>
          </div>
        </Card>

        <Card title="Defaults & Fiscal Period" subtitle="These defaults influence financial and property reports across the system">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-bold text-slate-700">Currency</label>
              <AppSelect
                value={company.baseCurrency}
                onChange={(v) => handleCompanyFieldChange("baseCurrency", v ?? "")}
                options={[{ value:"KES", label:"KES" }, { value:"USD", label:"USD" }, { value:"UGX", label:"UGX" }, { value:"TZS", label:"TZS" }]}
                size="md"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Tax Regime</label>
              <AppSelect
                value={company.taxRegime}
                onChange={(v) => handleCompanyFieldChange("taxRegime", v ?? "")}
                options={[{ value:"VAT", label:"VAT" }, { value:"No Tax", label:"No Tax" }, { value:"GST", label:"GST" }]}
                size="md"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Fiscal Start Month</label>
              <AppSelect
                value={company.fiscalStartMonth}
                onChange={(v) => handleCompanyFieldChange("fiscalStartMonth", v ?? "")}
                options={months.map((month) => ({ value: month, label: month }))}
                size="md"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Fiscal Start Year</label>
              <Input
                type="number"
                value={company.fiscalStartYear}
                onChange={(e) => handleCompanyFieldChange("fiscalStartYear", Number(e.target.value) || new Date().getFullYear())}
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700">Operation Period Type</label>
              <AppSelect
                value={company.operationPeriodType}
                onChange={(v) => handleCompanyFieldChange("operationPeriodType", v ?? "")}
                options={[{ value:"Monthly", label:"Monthly" }, { value:"Quarterly", label:"Quarterly" }, { value:"Semi Annual", label:"Semi Annual" }, { value:"Annual", label:"Annual" }]}
                size="md"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => setCompany(normalizeForm(currentCompany))}>
              Reset
            </button>
            <button disabled={savingDetails} onClick={handleSaveDetails} className="inline-flex items-center gap-2 bg-[#FF8C00] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
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
          <div>
            <AppSelect
              value={selectedMode}
              onChange={(v) => v && handleCompanyModeChange(v)}
              options={companyOperatingModeOptions.map(({ value, label }) => ({ value, label }))}
              searchable
              size="md"
            />
            {selectedMode && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                {companyOperatingModeOptions.find((o) => o.value === selectedMode)?.description}
              </p>
            )}
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
            title="Enabled Modules"
            subtitle="Turn modules on or off for this company. Disabled modules hide their navigation and features workspace-wide."
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Object.entries(MODULE_LABELS).map(([key, label]) => {
                const enabled = Boolean(company.modules?.[key]);
                return (
                  <label
                    key={key}
                    className={[
                      "flex cursor-pointer items-center justify-between gap-3 border px-3 py-2.5 transition select-none",
                      enabled ? "border-[#0B3B2E]/25 bg-[#EDF5F1]" : "border-slate-200 bg-white hover:border-slate-300",
                    ].join(" ")}
                  >
                    <div>
                      <div className="text-[12px] font-bold text-slate-900">{label}</div>
                      <div className="text-[10px] text-slate-500">{key}</div>
                    </div>
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={enabled}
                        onChange={() =>
                          handleCompanyFieldChange("modules", { ...company.modules, [key]: !enabled })
                        }
                      />
                      <div className={`h-5 w-9 rounded-full transition-colors ${enabled ? "bg-[#0B3B2E]" : "bg-slate-200"}`} />
                      <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4 left-0.5" : "left-0.5"}`} />
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
              Module changes are future-facing. They do not alter any posted history, transactions, or ledger entries.
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => setCompany(normalizeForm(currentCompany))}>
                Reset
              </button>
              <button disabled={savingDetails} onClick={handleSaveDetails} className="inline-flex items-center gap-2 bg-[#FF8C00] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
                <FaSave /> {savingDetails ? "Saving..." : "Save Structure"}
              </button>
            </div>
          </Card>
        </div>
      </div>
    );
  };


  const renderPaymentsTab = () => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total configs</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{paymentSummary.total}</div>
        </div>
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Active now</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{paymentSummary.active}</div>
        </div>
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Enabled</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{paymentSummary.enabled}</div>
        </div>
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{paymentSummary.configured}</div>
        </div>
      </div>

      <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
              <input
                value={paymentSearch}
                onChange={(e) => setPaymentSearch(e.target.value)}
                placeholder="Search paybills…"
                className="h-7 w-44 border border-slate-200 bg-white pl-7 pr-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />
            </div>
            <span className="border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              {paymentConfigs.length} config{paymentConfigs.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button onClick={beginCreatePaymentConfig} className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#E67E00]">
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
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No paybill configuration added yet. Click "Add Paybill" to get started.
                  </td>
                </tr>
              ) : (
                paymentConfigs
                  .filter((c) => !paymentSearch.trim() || `${c.name} ${c.shortCode}`.toLowerCase().includes(paymentSearch.trim().toLowerCase()))
                  .map((config, idx) => {
                    const status = buildPaymentStatus(config);
                    const theme = statusTheme[status.code] || statusTheme.not_configured;
                    return (
                      <tr key={config._id} onDoubleClick={() => beginEditPaymentConfig(config)} className="cursor-pointer transition hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-semibold text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-900">{config.name}</td>
                        <td className="px-3 py-2.5 text-slate-700">{config.shortCode || <span className="text-slate-400">—</span>}</td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 text-slate-600">{config.defaultCashbookAccountName || <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2.5 text-center">
                          {config.isActive ? (
                            <span className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700">Active</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-0.5 font-bold text-slate-500">Inactive</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-bold ${theme.badge}`}>
                            {theme.icon} {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button title="Edit" onClick={() => beginEditPaymentConfig(config)} className="h-7 border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"><FaPen /></button>
                            <button title={config.enabled ? "Disable" : "Enable"} onClick={() => handleQuickUpdate(config, { enabled: !config.enabled, isActive: config.enabled ? false : config.isActive }, config.enabled ? "Paybill disabled" : "Paybill enabled")} className="h-7 border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"><FaPowerOff className={config.enabled ? "text-emerald-600" : "text-slate-400"} /></button>
                            <button title={config.isActive ? "Set inactive" : "Activate"} onClick={() => handleQuickUpdate(config, { enabled: true, isActive: !config.isActive }, config.isActive ? "Paybill set inactive" : "Paybill activated")} className="h-7 border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"><FaCheckCircle className={config.isActive ? "text-blue-500" : "text-slate-400"} /></button>
                            <button title="Delete" onClick={() => handleDeletePaymentConfig(config)} className="h-7 border border-rose-200 bg-rose-50 px-2 font-bold text-rose-600 transition hover:bg-rose-100"><FaTrashAlt /></button>
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

      {/* ── Co-op Bank B2B ── */}
      <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-wider text-slate-700">Co-operative Bank B2B</div>
            <div className="text-[10px] text-slate-400 mt-0.5">Tenants pay via M-Pesa to Co-op Paybill using format: <span className="font-mono font-bold text-slate-600">[AccountNo]#[TenantCode]</span></div>
          </div>
          <button onClick={beginCreateCoopConfig} className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#E67E00]">
            <FaPlus /> Add Co-op Config
          </button>
        </div>
        {coopConfigs.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            No Co-op Bank B2B configuration yet. Click "Add Co-op Config" to set up.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-[#0B3B2E] text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-black text-[10px] uppercase tracking-wider">#</th>
                  <th className="px-3 py-2 text-left font-black text-[10px] uppercase tracking-wider">Name</th>
                  <th className="px-3 py-2 text-left font-black text-[10px] uppercase tracking-wider">Institution Code</th>
                  <th className="px-3 py-2 text-left font-black text-[10px] uppercase tracking-wider">Paybill</th>
                  <th className="px-3 py-2 text-left font-black text-[10px] uppercase tracking-wider">Coop A/C</th>
                  <th className="px-3 py-2 text-center font-black text-[10px] uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-center font-black text-[10px] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coopConfigs.map((cfg, idx) => (
                  <tr key={cfg._id} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/50 hover:bg-[#EDF5F1]/70 cursor-pointer" onDoubleClick={() => beginEditCoopConfig(cfg)}>
                    <td className="px-3 py-2.5 font-semibold text-slate-500">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-bold text-slate-900">{cfg.name}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-700">{cfg.institutionCode || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-700">{cfg.paybillNumber || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-slate-700">{cfg.coopBankAccountNumber || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5 text-center">
                      {cfg.enabled
                        ? <span className="inline-flex items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700 text-[10px]">Enabled</span>
                        : <span className="inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-0.5 font-bold text-slate-500 text-[10px]">Disabled</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => beginEditCoopConfig(cfg)} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50"><FaPen /></button>
                        <button onClick={() => handleDeleteCoopConfig(cfg)} className="inline-flex items-center gap-1 border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-100"><FaTrashAlt /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

    return (
      <div className="space-y-3">
        {/* Sub-tab bar */}
        <div className="flex flex-wrap gap-1 border border-slate-200 bg-[#EDF5F1] p-1">
          {emailLogSubTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setEmailSubTab(t.key)}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-bold transition ${emailSubTab === t.key ? "bg-[#0B3B2E] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
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
          <div className="space-y-3">
            {/* Master email on/off switch */}
            <div className={`flex items-center justify-between border px-4 py-3 ${emailEnabled ? "border-[#0B3B2E]/25 bg-[#EDF5F1]" : "border-red-200 bg-red-50"}`}>
              <div>
                <div className="text-[12px] font-bold text-slate-900">Email Sending</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {emailEnabled ? "All outgoing emails are active." : "All outgoing emails are paused — no emails will be sent until re-enabled."}
                </div>
              </div>
              <button
                onClick={handleToggleEmailEnabled}
                disabled={togglingEmail}
                className={`ml-4 flex h-7 flex-shrink-0 items-center gap-1.5 rounded px-3 text-xs font-bold transition disabled:opacity-60 ${emailEnabled ? "bg-red-600 text-white hover:bg-red-700" : "bg-[#0B3B2E] text-white hover:bg-[#0a3026]"}`}
              >
                {emailEnabled ? "Disable Email" : "Enable Email"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="border border-slate-200 bg-white px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total profiles</div>
                <div className="mt-0.5 text-lg font-extrabold text-slate-900">{emailSummary.total}</div>
              </div>
              <div className="border border-slate-200 bg-white px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Enabled</div>
                <div className="mt-0.5 text-lg font-extrabold text-slate-900">{emailSummary.active}</div>
              </div>
              <div className="border border-slate-200 bg-white px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
                <div className="mt-0.5 text-lg font-extrabold text-slate-900">{emailSummary.configured}</div>
              </div>
              <div className="border border-slate-200 bg-white px-3 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Default profiles</div>
                <div className="mt-0.5 text-lg font-extrabold text-slate-900">{emailSummary.defaults}</div>
              </div>
            </div>

            <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                    <input
                      value={emailProfileSearch}
                      onChange={(e) => setEmailProfileSearch(e.target.value)}
                      placeholder="Search email profiles…"
                      className="h-7 w-48 border border-slate-200 bg-white pl-7 pr-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                    />
                  </div>
                  <span className="border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                    {emailProfiles.length} profile{emailProfiles.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <button onClick={beginCreateEmailProfile} className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#E67E00]">
                  <FaPlus /> Add Email Profile
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="bg-[#0B3B2E] text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Name</th>
                      <th className="px-3 py-2.5 text-left font-semibold">Sender Email</th>
                      <th className="px-3 py-2.5 text-left font-semibold">SMTP Host</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Test</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Status</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {emailProfiles.length === 0 ? (
                      <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-500">No email profiles configured yet. Click "Add Email Profile" to get started.</td></tr>
                    ) : (
                      emailProfiles
                        .filter((p) => !emailProfileSearch || `${p.name} ${p.senderEmail} ${p.smtpHost}`.toLowerCase().includes(emailProfileSearch.toLowerCase()))
                        .map((profile, idx) => {
                          const status = buildEmailStatus(profile);
                          const theme = statusTheme[status.code] || statusTheme.not_configured;
                          return (
                            <tr key={profile._id} className="cursor-pointer transition hover:bg-slate-50" onDoubleClick={() => beginEditEmailProfile(profile)}>
                              <td className="px-3 py-2.5 text-slate-400">{idx + 1}</td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-extrabold text-slate-900">{profile.name}</span>
                                  {profile.isDefault && <span className="border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">Default</span>}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-slate-700">{profile.senderEmail || <span className="text-slate-400">Not set</span>}</td>
                              <td className="px-3 py-2.5 font-mono text-slate-600">{profile.smtpHost || <span className="text-slate-400">Not set</span>}</td>
                              <td className="px-3 py-2.5 text-center">
                                <span className={`inline-flex border px-2 py-0.5 font-bold ${resolveEmailTestBadge(profile.lastTestStatus)}`}>
                                  {profile.lastTestStatus || "never"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-bold ${theme.badge}`}>
                                  {theme.icon} {status.label}
                                </span>
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex justify-end gap-1.5">
                                  <button onClick={(e) => { e.stopPropagation(); beginEditEmailProfile(profile); }} className="inline-flex h-7 items-center gap-1 border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50"><FaPen className="text-[9px]" /> Edit</button>
                                  <button onClick={(e) => { e.stopPropagation(); handleQuickEmailUpdate(profile, { enabled: !profile.enabled, isDefault: profile.enabled ? false : profile.isDefault }, profile.enabled ? "Profile disabled" : "Profile enabled"); }} className={`inline-flex h-7 items-center gap-1 border px-2 text-[11px] font-bold transition ${profile.enabled ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}><FaPowerOff className="text-[9px]" /> {profile.enabled ? "Off" : "On"}</button>
                                  <button onClick={(e) => { e.stopPropagation(); handleQuickEmailUpdate(profile, { isDefault: true, enabled: true }, "Set as default"); }} className="inline-flex h-7 items-center gap-1 border border-blue-200 bg-blue-50 px-2 text-[11px] font-bold text-blue-700 transition hover:bg-blue-100"><FaCheckCircle className="text-[9px]" /> Default</button>
                                  <button onClick={(e) => { e.stopPropagation(); handleSendTestEmail(profile); }} className="inline-flex h-7 items-center gap-1 border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"><FaPaperPlane className="text-[9px]" /> Test</button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteEmailProfile(profile); }} className="inline-flex h-7 items-center gap-1 border border-rose-200 bg-rose-50 px-2 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100"><FaTrashAlt className="text-[9px]" /></button>
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
        )}

        {/* ── Logs sub-tabs (sent / failed / pending) ── */}
        {["sent", "failed", "pending"].includes(emailSubTab) && (
          <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
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
                    className="h-7 w-44 rounded border border-slate-600 bg-[#0d4535] pl-7 pr-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>
                <button
                  onClick={() => {
                    setEmailLogsLoading(true);
                    getSmsLogs(currentCompany._id, { channel: "email", limit: 200, status: emailSubTab === "pending" ? "pending" : emailSubTab })
                      .then((data) => setEmailLogs(data?.logs || []))
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
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Total profiles</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{smsSummary.total}</div>
        </div>
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Enabled</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{smsSummary.active}</div>
        </div>
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Fully configured</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{smsSummary.configured}</div>
        </div>
        <div className="border border-slate-200 bg-white px-3 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Default profiles</div>
          <div className="mt-0.5 text-lg font-extrabold text-slate-900">{smsSummary.defaults}</div>
        </div>
      </div>

      <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
              <input
                value={smsProfileSearch}
                onChange={(e) => setSmsProfileSearch(e.target.value)}
                placeholder="Search SMS profiles…"
                className="h-7 w-44 border border-slate-200 bg-white pl-7 pr-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />
            </div>
            <span className="border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              {smsProfiles.length} profile{smsProfiles.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button onClick={beginCreateSmsProfile} className="inline-flex items-center gap-1.5 bg-[#FF8C00] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#E67E00]">
            <FaPlus /> Add Configuration
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
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No SMS configuration added yet. Click "Add Configuration" to get started.
                  </td>
                </tr>
              ) : (
                smsProfiles
                  .filter((p) => !smsProfileSearch.trim() || `${p.name} ${p.provider} ${p.senderId}`.toLowerCase().includes(smsProfileSearch.trim().toLowerCase()))
                  .map((profile, idx) => {
                    const status = buildSmsStatus(profile);
                    const theme = statusTheme[status.code] || statusTheme.not_configured;
                    const providerLabel = smsProviderOptions.find((o) => o.value === profile.provider)?.label || profile.provider;
                    return (
                      <tr key={profile._id} onDoubleClick={() => beginEditSmsProfile(profile)} className="cursor-pointer transition hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-semibold text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-slate-900">{profile.name}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {profile.isDefault && (
                              <span className="inline-block border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">Default</span>
                            )}
                            {profile.useSandbox && (
                              <span className="inline-block border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">Sandbox</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{providerLabel}</td>
                        <td className="px-3 py-2.5 text-slate-700">{profile.senderId || <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2.5 text-center text-slate-600">{profile.defaultCountryCode || "+254"}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-flex items-center gap-1 border px-2 py-0.5 font-bold ${theme.badge}`}>
                            {theme.icon} {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button title="Edit" onClick={() => beginEditSmsProfile(profile)} className="h-7 border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"><FaPen /></button>
                            <button title={profile.enabled ? "Disable" : "Enable"} onClick={() => handleQuickSmsProfileUpdate(profile, { enabled: !profile.enabled, isDefault: profile.enabled ? false : profile.isDefault }, profile.enabled ? "SMS profile disabled" : "SMS profile enabled")} className="h-7 border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"><FaPowerOff className={profile.enabled ? "text-emerald-600" : "text-slate-400"} /></button>
                            <button title="Set as Default" onClick={() => handleQuickSmsProfileUpdate(profile, { isDefault: true, enabled: true }, "SMS profile set as default")} className="h-7 border border-slate-200 bg-white px-2 font-bold text-slate-600 transition hover:bg-slate-50"><FaCheckCircle className={profile.isDefault ? "text-blue-500" : "text-slate-400"} /></button>
                            <button title="Delete" onClick={() => handleDeleteSmsProfile(profile)} className="h-7 border border-rose-200 bg-rose-50 px-2 font-bold text-rose-600 transition hover:bg-rose-100"><FaTrashAlt /></button>
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
      <div className="flex min-h-0 flex-col overflow-hidden border border-slate-200 bg-white shadow-sm">
        {/* ── Toolbar ── */}
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <FaSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
              <input
                value={smsTemplateSearch}
                onChange={(e) => setSmsTemplateSearch(e.target.value)}
                placeholder="Search templates…"
                className="h-8 w-52 rounded border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 shadow-sm transition hover:bg-white focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
              />
            </div>
            <AppSelect
              value={smsTemplateRecipientFilter}
              onChange={(v) => setSmsTemplateRecipientFilter(v ?? "all")}
              options={[
                ...(hasPM ? [{ value: "tenant", label: "Tenant" }, { value: "landlord", label: "Landlord" }] : []),
                ...(hasCW ? [{ value: "customer", label: "Customer" }] : []),
                ...(!hasPM && !hasCW ? [{ value: "internal", label: "Internal" }] : []),
              ]}
              placeholder="All Recipients"
              clearable
              size="sm"
            />
            <AppSelect
              value={smsTemplateStatusFilter}
              onChange={(v) => setSmsTemplateStatusFilter(v ?? "all")}
              options={[
                { value: "enabled", label: "Enabled" },
                { value: "disabled", label: "Disabled" },
              ]}
              placeholder="All Status"
              clearable
              size="sm"
            />
            <AppSelect
              value={smsTemplatesModeFilter}
              onChange={(v) => setSmsTemplatesModeFilter(v ?? "all")}
              options={[
                { value: "manual", label: "Manual" },
                { value: "automatic", label: "Automatic" },
              ]}
              placeholder="All Modes"
              clearable
              size="sm"
            />
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

    return (
      <div className="space-y-3">
        {/* Sub-tab bar */}
        <div className="flex flex-wrap gap-1 border border-slate-200 bg-[#EDF5F1] p-1">
          {smsNavItems.map((item) => {
            const isActive = activeSmsSection === item.key;
            return (
              <button
                key={item.key}
                onClick={() => switchSmsSection(item.key)}
                className={`inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-bold transition ${isActive ? "bg-[#0B3B2E] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}
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
          <div className="overflow-hidden border border-slate-200 bg-white shadow-sm">
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
                    className="h-7 w-44 rounded border border-slate-600 bg-[#0d4535] pl-7 pr-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]/20"
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
        <div className="flex flex-col overflow-hidden border border-slate-200 bg-white shadow-sm" style={{ minHeight: "calc(95vh - 220px)" }}>
          {activityView === "activities" ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-3 py-2">
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400" />
                  <input value={activitySearch} onChange={(e) => { setActivitySearch(e.target.value); setActivitiesPage(1); }} placeholder="Search events…" className="h-7 w-48 rounded border border-slate-200 bg-white pl-7 pr-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                </div>
                <AppSelect
                  value={activityCategory}
                  onChange={(v) => { setActivityCategory(v ?? "all"); setActivitiesPage(1); }}
                  options={[
                    { value: "auth", label: "Sign-ins" },
                    { value: "users", label: "User access" },
                    { value: "company", label: "Company setup" },
                    { value: "settings", label: "Operational settings" },
                    { value: "finance", label: "Receipts & finance" },
                    { value: "property", label: "Tenants & property" },
                  ]}
                  placeholder="All categories"
                  clearable
                  size="sm"
                />
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
      <div className="flex h-full flex-col bg-slate-50 px-4 py-3 2xl:px-6 gap-3">

        {/* ── Main card ── */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">

          {/* ── Header ── */}
          <div className="bg-[#0B3B2E] px-4 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7DADA0]">Company Setup</p>
              <h1 className="mt-0.5 text-[15px] font-black text-white leading-tight truncate">{company?.companyName || "—"}</h1>
              {/* ── Stat strip ── */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {hasPM && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#2A5C4A] bg-[#0D4434] px-2 py-0.5 text-[10px] font-semibold text-[#9DCFC5]">
                    <FaBuilding size={8} />
                    {companyOperatingModeOptions.find((o) => o.value === normalizeCompanyOperatingMode(company.companyMode))?.label || "Property Manager"}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full border border-[#2A5C4A] bg-[#0D4434] px-2 py-0.5 text-[10px] font-semibold text-[#9DCFC5]">
                  <FaServer size={8} />
                  {Object.values(normalizeCompanyModules(company.modules || {})).filter(Boolean).length} modules
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${paymentSummary.active > 0 ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300" : "border-[#2A5C4A] bg-[#0D4434] text-[#9DCFC5]"}`}>
                  <FaMoneyCheckAlt size={8} />
                  {paymentSummary.active} / {paymentSummary.total} payments
                </span>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${emailSummary.active > 0 ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300" : "border-[#2A5C4A] bg-[#0D4434] text-[#9DCFC5]"}`}>
                  <FaEnvelope size={8} />
                  {emailSummary.active} / {emailSummary.total} email
                </span>
                {hasPM && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${taxSetupSummary.enabled ? "border-emerald-700/60 bg-emerald-900/30 text-emerald-300" : "border-amber-700/60 bg-amber-900/30 text-amber-300"}`}>
                    <FaShieldAlt size={8} />
                    Tax {taxSetupSummary.enabled ? "enabled" : "disabled"}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={handleRefreshSetup} disabled={isRefreshing}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-[#2A5C4A] px-2.5 text-[10px] font-bold text-white hover:bg-[#0A3127] transition disabled:opacity-60">
                <FaSyncAlt size={9} className={isRefreshing ? "animate-spin" : ""} />
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </button>
              <button type="button" onClick={() => navigate('/settings')}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-[#0B3B2E] bg-white px-2.5 text-[10px] font-bold text-[#0B3B2E] hover:bg-slate-50 transition">
                Operational Settings <FaArrowRight size={9} />
              </button>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex overflow-x-auto border-b border-slate-200 bg-white shrink-0">
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <button
                  key={tab.key}
                  onClick={() => switchTab(tab.key)}
                  className={[
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide transition whitespace-nowrap",
                    isActive
                      ? "border-[#0B3B2E] bg-[#0B3B2E]/5 text-[#0B3B2E]"
                      : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700",
                  ].join(" ")}
                >
                  <span className="opacity-70">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* ── Tab content ── */}
          <div className="flex-1 overflow-auto p-4">
            {renderTab()}
          </div>

        </div>
      </div>

      <Modal
        open={smsConfigModalOpen}
        onClose={closeSmsConfigModal}
        title={selectedSmsProfileId === SMS_DRAFT_ID ? "New SMS Configuration" : "SMS Configuration Details"}
        subtitle=""
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={resetSmsEditor}>
              Reset
            </button>
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={closeSmsConfigModal}>
              Cancel
            </button>
            <button disabled={savingSmsProfiles} onClick={handleSaveSmsProfile} className="inline-flex items-center gap-2 bg-[#FF8C00] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
              <FaSave /> {savingSmsProfiles ? "Saving..." : selectedSmsProfileId === SMS_DRAFT_ID ? "Save Configuration" : "Update Configuration"}
            </button>
          </div>
        }
      >
        {/* ── Status banner ── */}
        <div className={`border p-3 ${smsTheme.panel}`}>
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
                  className={`flex flex-col items-start gap-1 border-2 p-3 text-left transition-all ${
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
                <div className="border border-amber-200 bg-amber-50 p-3">
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
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={closeSmsTemplateModal}>
              Cancel
            </button>
            <button
              disabled={savingSmsTemplates}
              onClick={handleSaveSmsTemplate}
              className="inline-flex items-center gap-2 bg-[#0B3B2E] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#0A3127] disabled:opacity-50"
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
                  <div className="mt-1.5 border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold text-slate-800">
                    {smsRecipientLabels[smsTemplateForm.recipientType] || smsTemplateForm.recipientType}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Send Mode</label>
                  <AppSelect
                    value={smsTemplateForm.sendMode}
                    onChange={(v) => setSmsTemplateForm((prev) => ({ ...prev, sendMode: v ?? "" }))}
                    options={[{ value:"manual", label:"Manual" }, { value:"automatic", label:"Automatic" }]}
                    size="md"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">SMS Profile</label>
                  <AppSelect
                    value={smsTemplateForm.profileId}
                    onChange={(v) => setSmsTemplateForm((prev) => ({ ...prev, profileId: v ?? "" }))}
                    options={smsProfiles.map((profile) => ({ value: profile._id, label: profile.name + (profile.enabled ? "" : " (disabled)") }))}
                    placeholder="Company default"
                    clearable
                    searchable
                    size="md"
                  />
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
                  className="w-full resize-none border border-slate-300 bg-white px-3 py-2.5 font-mono text-[12px] text-slate-800 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  placeholder="Write the SMS message here. Click any placeholder below to insert it at the cursor."
                />
              </div>

              {/* clickable placeholders */}
              {smsTemplateForm.placeholders.length > 0 && (
                <div className="border border-slate-200 bg-slate-50 p-4">
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

      {/* ── Payment Config Modal ── */}
      <Modal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title={selectedPaymentConfigId === PAYMENT_DRAFT_ID ? "New Paybill Configuration" : "Edit Paybill Configuration"}
        subtitle="Enter the Paybill credentials, cashbook mapping and processing rules."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={resetPaymentEditor}>
              Reset
            </button>
            {selectedPaymentConfigId !== PAYMENT_DRAFT_ID && paymentForm.shortCode && (
              <button
                disabled={registeringUrls || savingPayments}
                onClick={handleRegisterUrls}
                className="inline-flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-4 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                <FaSyncAlt className={registeringUrls ? "animate-spin" : ""} />
                {registeringUrls ? "Registering..." : "Register with Safaricom"}
              </button>
            )}
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => setPaymentModalOpen(false)}>
              Cancel
            </button>
            <button disabled={savingPayments} onClick={handleSavePaymentConfig} className="inline-flex items-center gap-2 bg-[#FF8C00] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
              <FaSave /> {savingPayments ? "Saving..." : selectedPaymentConfigId === PAYMENT_DRAFT_ID ? "Save Config" : "Update Config"}
            </button>
          </div>
        }
      >
        <div className={`border p-3 ${paymentTheme.panel}`}>
          <div className="flex items-center gap-2.5">
            <span className="text-base">{paymentTheme.icon}</span>
            <div>
              <div className="text-xs font-bold text-slate-900">{paymentStatus.label}</div>
              <div className="text-xs leading-5 text-slate-600">{paymentStatus.reason}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-xs font-bold text-slate-700">Configuration Name</label>
            <Input value={paymentForm.name} onChange={(e) => setPaymentForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Example: Main Residential Paybill" />
          </div>

          <ToggleRow
            checked={paymentForm.enabled}
            onChange={(e) => setPaymentForm((prev) => ({ ...prev, enabled: e.target.checked, isActive: e.target.checked ? prev.isActive : false }))}
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

          <div>
            <label className="text-xs font-bold text-slate-700">Paybill Number</label>
            <Input value={paymentForm.shortCode} onChange={(e) => setPaymentForm((prev) => ({ ...prev, shortCode: e.target.value.replace(/[^\d]/g, "") }))} placeholder="Example: 522522" maxLength={7} />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Default Receiving Cashbook</label>
            <AppSelect
              value={paymentForm.defaultCashbookAccountId}
              onChange={(v) => {
                const selected = cashbookOptions.find((item) => String(item._id) === String(v));
                setPaymentForm((prev) => ({ ...prev, defaultCashbookAccountId: v ?? "", defaultCashbookAccountName: selected?.name || prev.defaultCashbookAccountName || "" }));
              }}
              options={cashbookOptions.map((account) => ({ value: account._id, label: account.name + (account.code ? ` (${account.code})` : "") }))}
              placeholder={loadingCashbooks ? "Loading cashbooks..." : "Select receiving cashbook"}
              searchable
              size="md"
              disabled={loadingCashbooks}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Consumer Key</label>
            <Input type="password" value={paymentForm.consumerKey} onChange={(e) => setPaymentForm((prev) => ({ ...prev, consumerKey: e.target.value }))} placeholder={paymentForm.hasConsumerKey ? "Leave blank to keep saved key" : "Enter consumer key"} />
            <div className="mt-1 text-[10px] text-slate-400">{paymentForm.hasConsumerKey ? `Saved: ${paymentForm.consumerKeyMasked || "Yes"}` : "No saved consumer key yet."}</div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Consumer Secret</label>
            <Input type="password" value={paymentForm.consumerSecret} onChange={(e) => setPaymentForm((prev) => ({ ...prev, consumerSecret: e.target.value }))} placeholder={paymentForm.hasConsumerSecret ? "Leave blank to keep saved secret" : "Enter consumer secret"} />
            <div className="mt-1 text-[10px] text-slate-400">{paymentForm.hasConsumerSecret ? `Saved: ${paymentForm.consumerSecretMasked || "Yes"}` : "No saved consumer secret yet."}</div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">Passkey</label>
            <Input type="password" value={paymentForm.passkey} onChange={(e) => setPaymentForm((prev) => ({ ...prev, passkey: e.target.value }))} placeholder={paymentForm.hasPasskey ? "Leave blank to keep saved passkey" : "Enter passkey"} />
            <div className="mt-1 text-[10px] text-slate-400">{paymentForm.hasPasskey ? `Saved: ${paymentForm.passkeyMasked || "Yes"}` : "No saved passkey yet."}</div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700">M-Pesa Response Mode</label>
            <AppSelect
              value={paymentForm.responseType}
              onChange={(v) => setPaymentForm((prev) => ({ ...prev, responseType: v ?? "" }))}
              options={[{ value:"Completed", label:"Completed" }, { value:"Cancelled", label:"Cancelled" }]}
              size="md"
            />
          </div>

          <div className="md:col-span-2 border-t border-slate-200 pt-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Transaction Status Query — for payer phone retrieval</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-slate-700">Initiator Name</label>
                <Input type="text" value={paymentForm.initiatorName} onChange={(e) => setPaymentForm((prev) => ({ ...prev, initiatorName: e.target.value }))} placeholder="API operator username from Daraja portal" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Initiator Password</label>
                <Input type="password" value={paymentForm.initiatorPassword} onChange={(e) => setPaymentForm((prev) => ({ ...prev, initiatorPassword: e.target.value }))} placeholder={paymentForm.hasInitiatorPassword ? "Leave blank to keep saved password" : "Operator password"} />
                <div className="mt-1 text-[10px] text-slate-400">{paymentForm.hasInitiatorPassword ? `Saved: ${paymentForm.initiatorPasswordMasked || "Yes"}` : ""}</div>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-700">Security Credential <span className="font-normal text-slate-400">(alternative — paste pre-generated value)</span></label>
                <Input type="password" value={paymentForm.securityCredential} onChange={(e) => setPaymentForm((prev) => ({ ...prev, securityCredential: e.target.value }))} placeholder={paymentForm.hasSecurityCredential ? "Leave blank to keep saved credential" : "Base64 RSA-encrypted initiator password"} />
                <div className="mt-1 text-[10px] text-slate-400">{paymentForm.hasSecurityCredential ? `Saved: ${paymentForm.securityCredentialMasked || "Yes"}` : ""}</div>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 border-t border-slate-200 pt-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Safeguards & Processing Rules</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-slate-700">Unmatched Payment Handling</label>
                <AppSelect
                  value={paymentForm.unmatchedPaymentMode}
                  onChange={(v) => setPaymentForm((prev) => ({ ...prev, unmatchedPaymentMode: v ?? "" }))}
                  options={[{ value:"manual_review", label:"Send to manual review" }, { value:"hold_unallocated", label:"Hold as unallocated payment" }]}
                  size="md"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Matched Payment Processing</label>
                <AppSelect
                  value={paymentForm.postingMode}
                  onChange={(v) => setPaymentForm((prev) => ({ ...prev, postingMode: v ?? "" }))}
                  options={[{ value:"manual_review", label:"Manual review before posting" }, { value:"auto_post_matched", label:"Auto-post matched payments" }]}
                  size="md"
                />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Co-op B2B Config Modal ── */}
      <Modal
        open={coopModalOpen}
        onClose={() => setCoopModalOpen(false)}
        title={selectedCoopConfigId === COOP_DRAFT_ID ? "New Co-op Bank B2B Configuration" : "Edit Co-op Bank B2B Configuration"}
        subtitle="Configure the Co-operative Bank B2B integration so tenants can pay via M-Pesa using your Co-op account number."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => setCoopModalOpen(false)}>
              Cancel
            </button>
            <button disabled={savingCoop} onClick={handleSaveCoopConfig} className="inline-flex items-center gap-2 bg-[#FF8C00] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
              <FaSave /> {savingCoop ? "Saving..." : selectedCoopConfigId === COOP_DRAFT_ID ? "Save Config" : "Update Config"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* How-it-works banner */}
          <div className="border-l-4 border-[#0B3B2E] bg-[#EDF5F1] px-3 py-2.5 text-[11px] leading-5 text-slate-700">
            <span className="font-bold">How it works:</span> Co-op Bank calls your system when a tenant makes a payment.
            Tenants pay to Paybill <span className="font-mono font-bold">{coopForm.paybillNumber || "400222"}</span> with account format{" "}
            <span className="font-mono font-bold">{coopForm.coopBankAccountNumber || "[CoopAccountNo]"}#[TenantCode]</span>.
            Co-op Bank will validate the account with your endpoint before accepting payment.
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-700">Configuration Name</label>
              <Input value={coopForm.name} onChange={(e) => setCoopForm((p) => ({ ...p, name: e.target.value }))} placeholder="Co-op B2B Main" />
            </div>

            <div className="flex items-center justify-between gap-3 border border-slate-200 bg-slate-50/80 px-3 py-2.5 md:col-span-2">
              <div>
                <div className="text-xs font-bold text-slate-700">Enable this configuration</div>
                <div className="text-[10px] text-slate-500">Only enable after the Institution Code and credentials are confirmed with Co-op Bank.</div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" className="peer sr-only" checked={Boolean(coopForm.enabled)} onChange={(e) => setCoopForm((p) => ({ ...p, enabled: e.target.checked }))} />
                <div className="peer h-5 w-9 rounded-full bg-slate-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-[#0B3B2E] peer-checked:after:translate-x-4" />
              </label>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Institution Code <span className="text-rose-500">*</span></label>
              <Input value={coopForm.institutionCode} onChange={(e) => setCoopForm((p) => ({ ...p, institutionCode: e.target.value.replace(/\s/g,"") }))} placeholder="e.g. MILIK001" />
              <p className="mt-1 text-[10px] text-slate-400">Unique code Co-op Bank uses to route callbacks to your endpoint.</p>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Institution Name</label>
              <Input value={coopForm.institutionName} onChange={(e) => setCoopForm((p) => ({ ...p, institutionName: e.target.value }))} placeholder="e.g. Milik Property Systems" />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Connection ID <span className="text-rose-500">*</span></label>
              <Input value={coopForm.connectionID} onChange={(e) => setCoopForm((p) => ({ ...p, connectionID: e.target.value }))} placeholder="Given to Co-op Bank for authentication" />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Connection Password</label>
              <Input type="password" value={coopForm.connectionPassword} onChange={(e) => setCoopForm((p) => ({ ...p, connectionPassword: e.target.value }))} placeholder={coopForm.hasConnectionPassword ? "Leave blank to keep saved password" : "Set a shared secret with Co-op Bank"} />
              {coopForm.hasConnectionPassword && <p className="mt-1 text-[10px] text-slate-400">Saved: {coopForm.connectionPasswordMasked || "Yes"}</p>}
            </div>

            <div className="border-t border-slate-200 pt-3 md:col-span-2">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">M-Pesa Payment Details</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-bold text-slate-700">Co-op Bank Account Number</label>
                  <Input value={coopForm.coopBankAccountNumber} onChange={(e) => setCoopForm((p) => ({ ...p, coopBankAccountNumber: e.target.value.replace(/\D/g,"") }))} placeholder="e.g. 1234567" maxLength={20} />
                  <p className="mt-1 text-[10px] text-slate-400">Client's Co-op Bank account. Tenant pays as: <span className="font-mono">{coopForm.coopBankAccountNumber || "[AccountNo]"}#[TenantCode]</span></p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">M-Pesa Paybill Number</label>
                  <Input value={coopForm.paybillNumber} onChange={(e) => setCoopForm((p) => ({ ...p, paybillNumber: e.target.value.replace(/\D/g,"") }))} placeholder="400222" maxLength={10} />
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Default Receiving Cashbook</label>
              <AppSelect
                value={coopForm.defaultCashbookAccountId}
                onChange={(v) => {
                  const sel = cashbookOptions.find((a) => String(a._id) === String(v));
                  setCoopForm((p) => ({ ...p, defaultCashbookAccountId: v ?? "", defaultCashbookAccountName: sel?.name || p.defaultCashbookAccountName || "" }));
                }}
                options={cashbookOptions.map((a) => ({ value: a._id, label: a.name + (a.code ? ` (${a.code})` : "") }))}
                placeholder={loadingCashbooks ? "Loading..." : "Select receiving cashbook"}
                searchable
                size="md"
                disabled={loadingCashbooks}
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Matched Payment Processing</label>
              <AppSelect
                value={coopForm.postingMode}
                onChange={(v) => setCoopForm((p) => ({ ...p, postingMode: v ?? "" }))}
                options={[{ value:"manual_review", label:"Manual review before posting" }, { value:"auto_post_matched", label:"Auto-post matched payments" }]}
                size="md"
              />
            </div>

            {selectedCoopConfigId !== COOP_DRAFT_ID && coopForm.institutionCode && (
              <div className="border border-slate-200 bg-slate-50 p-3 md:col-span-2">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Co-op Bank Callback URLs (provide to Co-op Bank)</div>
                <div className="space-y-2 text-[11px]">
                  <div>
                    <span className="font-bold text-slate-600">Validation URL:</span>{" "}
                    <span className="break-all font-mono text-slate-700">{`${window.location.protocol}//${window.location.host.replace("3000","5000")}/api/coop-b2b/${coopForm.institutionCode}/account`}</span>
                  </div>
                  <div>
                    <span className="font-bold text-slate-600">Payment Advice URL:</span>{" "}
                    <span className="break-all font-mono text-slate-700">{`${window.location.protocol}//${window.location.host.replace("3000","5000")}/api/coop-b2b/${coopForm.institutionCode}/advise`}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* ── Email Profile Modal ── */}
      <Modal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        title={selectedEmailProfileId === EMAIL_DRAFT_ID ? "New Email Profile" : "Edit Email Profile"}
        subtitle="Save the sender details, SMTP server settings, internal copy preferences and purpose tags."
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={resetEmailEditor}>
              Reset
            </button>
            <button className="border border-slate-300 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50" onClick={() => setEmailModalOpen(false)}>
              Cancel
            </button>
            <button disabled={savingEmails} onClick={handleSaveEmailProfile} className="inline-flex items-center gap-2 bg-[#FF8C00] px-4 py-2 text-[11px] font-bold text-white hover:bg-[#E67E00] disabled:opacity-50">
              <FaSave /> {savingEmails ? "Saving..." : selectedEmailProfileId === EMAIL_DRAFT_ID ? "Save Profile" : "Update Profile"}
            </button>
          </div>
        }
      >
        <div className={`border p-3 ${emailTheme.panel}`}>
          <div className="flex items-center gap-2.5">
            <span className="text-base">{emailTheme.icon}</span>
            <div>
              <div className="text-xs font-bold text-slate-900">{emailStatus.label}</div>
              <div className="text-xs leading-5 text-slate-600">{emailStatus.reason}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-xs font-bold text-slate-700">Profile Name</label>
            <Input value={emailForm.name} onChange={(e) => setEmailForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Example: Main Business Email" />
          </div>

          <ToggleRow
            checked={emailForm.enabled}
            onChange={(e) => setEmailForm((prev) => ({ ...prev, enabled: e.target.checked, isDefault: e.target.checked ? prev.isDefault : false }))}
            title="Enable this email profile"
            description="Turn this on when this profile is ready to send operational emails."
          />
          <ToggleRow
            checked={emailForm.isDefault}
            onChange={(e) => setEmailForm((prev) => ({ ...prev, isDefault: e.target.checked, enabled: e.target.checked ? true : prev.enabled }))}
            title="Set as default sender"
            description="The default profile is used by receipts, invoices, statements and system notices."
          />

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
            <AppSelect
              value={emailForm.encryption}
              onChange={(v) => setEmailForm((prev) => ({ ...prev, encryption: v ?? "" }))}
              options={[{ value:"ssl", label:"SSL" }, { value:"tls", label:"TLS" }, { value:"none", label:"None" }]}
              size="md"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">SMTP Username</label>
            <Input value={emailForm.username} onChange={(e) => setEmailForm((prev) => ({ ...prev, username: e.target.value }))} placeholder="your-smtp-username" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700">SMTP Password / App Password</label>
            <Input type="password" value={emailForm.password} onChange={(e) => setEmailForm((prev) => ({ ...prev, password: e.target.value }))} placeholder={emailForm.hasPassword ? "Leave blank to keep saved password" : "Enter SMTP password"} />
            <div className="mt-1 text-[10px] text-slate-400">{emailForm.hasPassword ? emailForm.passwordMasked || "Saved and masked" : "No saved password yet."}</div>
          </div>

          <div className="md:col-span-2 border-t border-slate-200 pt-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Internal Copy & Usage</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-slate-700">Internal Copy Email</label>
                <Input type="email" value={emailForm.internalCopyEmail} onChange={(e) => setEmailForm((prev) => ({ ...prev, internalCopyEmail: e.target.value }))} placeholder="backoffice@company.com" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Internal Copy Mode</label>
                <AppSelect
                  value={emailForm.internalCopyMode}
                  onChange={(v) => setEmailForm((prev) => ({ ...prev, internalCopyMode: v ?? "" }))}
                  options={[{ value:"none", label:"No internal copy" }, { value:"bcc", label:"BCC internal copy" }, { value:"cc", label:"CC internal copy" }]}
                  size="md"
                />
              </div>
            </div>

            <div className="mt-3">
              <div className="text-xs font-bold text-slate-700">Usage Tags</div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
                {emailUsageOptions.map((option) => {
                  const checked = emailForm.usageTags.includes(option.value);
                  return (
                    <label key={option.value} className={["flex items-center gap-2 border px-3 py-2 text-xs transition cursor-pointer", checked ? "border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-white hover:border-slate-300"].join(" ")}>
                      <input type="checkbox" checked={checked} onChange={() => toggleUsageTag(option.value)} className="h-3.5 w-3.5 border-slate-300 text-emerald-600 focus:ring-[#0B3B2E]/20" />
                      <span className="font-semibold text-slate-800">{option.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="md:col-span-2 border-t border-slate-200 pt-3">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">Test This Profile</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <label className="text-xs font-bold text-slate-700">Test Recipient Email</label>
                <Input type="email" value={emailForm.testRecipient} onChange={(e) => setEmailForm((prev) => ({ ...prev, testRecipient: e.target.value }))} placeholder={currentCompany?.email || "company@example.com"} />
              </div>
              <button disabled={testingEmail || selectedEmailProfileId === EMAIL_DRAFT_ID} onClick={() => handleSendTestEmail()} className="inline-flex items-center justify-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                <FaPaperPlane /> {testingEmail ? "Sending..." : "Send Test"}
              </button>
            </div>
            {emailForm.lastTestStatus && (
              <div className="mt-2 flex items-center gap-2">
                <span className={`inline-flex border px-2 py-0.5 text-[10px] font-bold ${resolveEmailTestBadge(emailForm.lastTestStatus)}`}>{emailForm.lastTestStatus}</span>
                {emailForm.lastTestMessage ? <span className="text-xs text-slate-500">{emailForm.lastTestMessage}</span> : null}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
