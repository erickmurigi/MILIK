import { LISTING_UI, normalizeUppercaseInput } from "../../utils/listingPageUtils";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { useEntityCache } from "../../hooks/useEntityCache";
import {
  selectCurrentUser,
  selectCurrentCompany,
  selectAllTenants,
  selectAllProperties,
  selectAllUnits,
} from "../../redux/selectors";
import {
  FaArrowLeft,
  FaFileInvoice,
  FaDownload,
  FaPrint,
  FaEye,
  FaArrowRight,
  FaSearch,
  FaRedoAlt,
  FaEdit,
  FaTrash,
  FaPlus,
  FaTimes,
  FaReceipt,
  FaMoneyBillWave,
  FaSms,
  FaEnvelope,
} from "react-icons/fa";
import CommunicationComposerModal from "../../components/Communications/CommunicationComposerModal";
import { toast } from "react-toastify";
import DashboardLayout from "../../components/Layout/DashboardLayout";
import { getTenants } from "../../redux/tenantsRedux";
import { getProperties } from "../../redux/propertyRedux";
import { getUnits } from "../../redux/unitRedux";
import { getChartOfAccounts, downloadInvoicePdf } from "../../redux/apiCalls";
import { fetchCompanySettings, selectCompanySettings } from "../../redux/companySettingsRedux";
import {
  createTenantInvoice,
  createTenantInvoicesBatch,
  getTenantInvoices,
  deleteTenantInvoice,
} from "../../redux/invoiceApi";
import { adminRequests } from "../../utils/requestMethods";
import {
  buildTaxPreviewForComponents,
  getActiveTaxCodes,
  getTaxCodeLabel,
  normalizeCompanyTaxConfig,
  resolveTaxSelectionPayload,
} from "./invoiceTaxUtils";
import { hasCompanyPermission } from "../../utils/permissions";
import { useTabState } from "../../hooks/useTabState";
import AppSelect from "../../components/common/AppSelect";

const MILIK_GREEN = "bg-[#0B3B2E]";
const MILIK_GREEN_HOVER = "hover:bg-[#0A3127]";
const MILIK_ORANGE = "bg-[#FF8C00]";
const MILIK_ORANGE_HOVER = "hover:bg-[#e67e00]";
const ITEMS_PER_PAGE = 50;

const INVOICE_REVENUE_ACCOUNT_MAP = {
  utility: { code: "4102", name: "Utility Recharge Income", category: "UTILITY_CHARGE" },
  rent: { code: "4100", name: "Rent Income", category: "RENT_CHARGE" },
  combined: { code: "4100", name: "Rent Income", category: "RENT_CHARGE" },
};

const MONTH_OPTIONS = [
  { value: 0, label: "January" },
  { value: 1, label: "February" },
  { value: 2, label: "March" },
  { value: 3, label: "April" },
  { value: 4, label: "May" },
  { value: 5, label: "June" },
  { value: 6, label: "July" },
  { value: 7, label: "August" },
  { value: 8, label: "September" },
  { value: 9, label: "October" },
  { value: 10, label: "November" },
  { value: 11, label: "December" },
];


const FALLBACK_BILLING_PERIOD_MONTHS = {
  monthly: 1,
  bi_monthly: 2,
  quarterly: 3,
  semi_annual: 6,
  annual: 12,
};

const normalizeBillingPeriodKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const canonicalBillingPeriodKey = (value = "") => {
  const normalized = normalizeBillingPeriodKey(value);
  const aliases = {
    month: "monthly",
    monthly: "monthly",
    quarter: "quarterly",
    quarterly: "quarterly",
    semiannual: "semi_annual",
    semi_annually: "semi_annual",
    biannual: "semi_annual",
    annually: "annual",
    yearly: "annual",
    annual: "annual",
  };
  return aliases[normalized] || normalized || "monthly";
};

const addMonthsPreservingDay = (dateValue, months = 1) => {
  const source = new Date(dateValue);
  if (Number.isNaN(source.getTime())) return null;
  const day = source.getDate();
  const next = new Date(source);
  next.setMonth(next.getMonth() + Number(months || 0), 1);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
};

const formatScheduleLabel = ({ startDate, endDate, billingPeriod }) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
  if (Number(billingPeriod?.durationInMonths || 1) <= 1) {
    return `${start.toLocaleString("en-US", { month: "short" })} ${String(start.getFullYear()).slice(-2)}`;
  }
  return `${start.toLocaleDateString("en-GB")} - ${end.toLocaleDateString("en-GB")}`;
};

const buildSchedulePeriodKey = ({ startDate, billingPeriodKey = "monthly" }) => {
  const dt = new Date(startDate);
  if (Number.isNaN(dt.getTime())) return "";
  return `${canonicalBillingPeriodKey(billingPeriodKey)}:${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const emptyFilters = {
  status: "ACTIVE",
  fromDate: "",
  toDate: "",
  property: "any",
  tenantName: "",
  unit: "any",
  invoiceNo: "",
};

const getTenantDisplayName = (tenant) => {
  const fullName = `${tenant?.firstName || ""} ${tenant?.lastName || ""}`.trim();
  return fullName || tenant?.tenantName || tenant?.name || "N/A";
};

const getUnitDisplayName = (tenant) => {
  const primary = tenant?.unit?.unitName || tenant?.unit?.name || tenant?.unit?.unitNumber || tenant?.unitName || "";
  const additional = getAdditionalUnitDisplayNames(tenant);
  const names = [primary, ...additional].filter(Boolean);
  return names.length ? names.join(", ") : "N/A";
};



const getAdditionalUnitDisplayNames = (tenant) => {
  const units = Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : [];
  return units
    .map((unit) => unit?.unitName || unit?.name || unit?.unitNumber || "")
    .filter(Boolean);
};

const formatDateDisplay = (dateValue, options = {}) => {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", options);
};

const formatDateTimeDisplay = (dateValue, options = {}) => {
  if (!dateValue) return "-";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", options);
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatCurrency = (value = 0) => `KES ${Number(value || 0).toLocaleString()}`;

const getInvoiceStatusBadgeClasses = (status = "") => {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "paid") return "bg-green-100 text-green-700";
  if (normalized === "partially paid" || normalized === "partially_paid") return "bg-amber-100 text-amber-700";
  if (normalized === "cancelled" || normalized === "reversed") return "bg-slate-100 text-slate-700";
  return "bg-orange-100 text-orange-700";
};


const getInvoiceDaysOverdue = ({ dueDate, outstandingAmount = 0, status = "" } = {}) => {
  if (!dueDate) return 0;
  if (Number(outstandingAmount || 0) <= 0) return 0;

  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (["paid", "cancelled", "reversed"].includes(normalizedStatus)) return 0;

  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);

  const diff = today.getTime() - due.getTime();
  if (diff <= 0) return 0;

  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.tenants)) return value.tenants;
  return [];
};

const formatPeriodLabel = (month, year) => {
  const date = new Date(year, month, 1);
  return `${date.toLocaleString("en-US", { month: "short" })} ${String(year).slice(-2)}`;
};

const formatInvoiceDescriptionPeriod = (month, year) => {
  const date = new Date(year, month, 1);
  return `${date.toLocaleString("en-US", { month: "short" })}/${String(year).slice(-2)}`;
};

const buildRecurringInvoiceDescription = ({ month, year, label }) => {
  const normalizedLabel = String(label || "Charge").trim();
  return `${formatInvoiceDescriptionPeriod(month, year)} ${normalizedLabel}`;
};

const toPeriodDateString = (year, month, day) => {
  const safeYear = Number(year);
  const safeMonth = Number(month);
  const safeDay = Number(day);
  return `${String(safeYear).padStart(4, "0")}-${String(safeMonth + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
};

const getDaysInMonth = (month, year) => new Date(Number(year), Number(month) + 1, 0).getDate();
const normalizeDueDay = (value, month, year) => {
  const parsed = Number(value);
  const safeDay = Number.isFinite(parsed) ? Math.trunc(parsed) : 5;
  const maxDay = getDaysInMonth(month, year);
  return Math.min(Math.max(safeDay, 1), maxDay);
};
const getStartOfPeriod = (month, year) => toPeriodDateString(year, month, 1);
const getDueDateForPeriod = (month, year, dueDay = 5) =>
  toPeriodDateString(year, month, normalizeDueDay(dueDay, month, year));
const isFutureBillingPeriod = (month, year) => {
  const parsedMonth = Number(month);
  const parsedYear = Number(year);
  if (!Number.isFinite(parsedMonth) || !Number.isFinite(parsedYear)) return false;

  const selectedPeriodStart = new Date(parsedYear, parsedMonth, 1, 0, 0, 0, 0);
  if (Number.isNaN(selectedPeriodStart.getTime())) return false;

  const now = new Date();
  const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  return selectedPeriodStart.getTime() > currentPeriodStart.getTime();
};

const clampBillingPeriod = (month, year) => {
  const now = new Date();
  const fallback = { month: now.getMonth(), year: now.getFullYear() };
  const parsedMonth = Number(month);
  const parsedYear = Number(year);

  if (!Number.isFinite(parsedMonth) || !Number.isFinite(parsedYear)) {
    return fallback;
  }

  if (isFutureBillingPeriod(parsedMonth, parsedYear)) {
    return fallback;
  }

  return {
    month: parsedMonth,
    year: parsedYear,
  };
};

const normalizeBillingMode = (value = "separate") => {
  const normalized = String(value || "separate").trim().toLowerCase();
  if (["rent", "utility", "combined"].includes(normalized)) return normalized;
  return "separate";
};

const getBillingModeLabel = (value = "separate") => {
  const normalized = normalizeBillingMode(value);
  if (normalized === "rent") return "Rent only";
  if (normalized === "utility") return "Utility only";
  if (normalized === "combined") return "Rent + Utility (combined invoice)";
  return "Rent + Utility (separate invoices)";
};

const resolveBookingAmountsForMode = ({ rentAmount = 0, utilityAmount = 0, billingMode = "separate" } = {}) => {
  const normalizedMode = normalizeBillingMode(billingMode);
  const safeRentAmount = Number(rentAmount || 0);
  const safeUtilityAmount = Number(utilityAmount || 0);

  return {
    billingMode: normalizedMode,
    rentAmount: normalizedMode === "utility" ? 0 : safeRentAmount,
    utilityAmount: normalizedMode === "rent" ? 0 : safeUtilityAmount,
    totalAmount:
      (normalizedMode === "utility" ? 0 : safeRentAmount) +
      (normalizedMode === "rent" ? 0 : safeUtilityAmount),
  };
};

const createBookingGroupId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return `booking_${globalThis.crypto.randomUUID()}`;
  }

  return `booking_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

// Scale each utility row proportionally to the resolved booking amount and round to 2dp.
const buildScaledBreakdown = (rows = [], utilityAmount = 0) => {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const scale = total > 0 ? utilityAmount / total : 1;
  return rows
    .map((r) => ({ label: r.label, amount: Math.round(r.amount * scale * 100) / 100 }))
    .filter((r) => r.amount > 0);
};

const buildCombinedInvoiceMetadata = (rows = [], utilityAmount = 0, utilityLabel = "") => {
  const breakdown = buildScaledBreakdown(rows, utilityAmount);
  return {
    billItemKey: "rent_utility:combined",
    utilityBreakdown: breakdown.length > 0 ? breakdown : [{ label: utilityLabel || "Utility", amount: utilityAmount }],
    utilityAmount,
    utilityLabel,
  };
};

const buildBookingMetadata = ({ metadata = undefined, bookingGroupId = "", billingMode = "separate" } = {}) => {
  const baseMetadata = metadata && typeof metadata === "object" ? metadata : {};
  const normalizedMode = normalizeBillingMode(billingMode);

  return {
    ...baseMetadata,
    bookingGroupId: bookingGroupId || baseMetadata?.bookingGroupId || "",
    bookingMode: normalizedMode,
    bookingSource: "rental_invoice_booking",
  };
};

const buildUtilityInvoiceMetadata = (utilityLabel = "") => {
  const normalizedUtilityLabel = String(utilityLabel || "").trim();
  // Always return metadata even when label is empty — use "Utility" as the
  // canonical fallback so deriveInvoiceDescription can always find a type.
  const resolvedLabel = normalizedUtilityLabel || "Utility";
  return {
    utilityType: resolvedLabel,
    meterUtilityType: resolvedLabel,
    statementUtilityType: resolvedLabel,
  };
};

const extractUtilityLabel = (utility = {}) => {
  if (!utility) return "";
  if (typeof utility === "string") return utility.trim();

  const nestedUtility = utility?.utility;
  if (typeof nestedUtility === "string" && nestedUtility.trim()) return nestedUtility.trim();
  if (nestedUtility && typeof nestedUtility === "object") {
    const nestedLabel =
      nestedUtility?.name || nestedUtility?.utilityName || nestedUtility?.label || nestedUtility?._id || "";
    if (String(nestedLabel || "").trim()) return String(nestedLabel).trim();
  }

  return String(
    utility?.utilityLabel || utility?.utilityName || utility?.name || utility?.label || ""
  ).trim();
};

const buildUtilityChargeDescription = ({ utilityLabel = "", month, year } = {}) => {
  const normalizedLabel = String(utilityLabel || "").trim() || "Utility";
  return buildRecurringInvoiceDescription({ month, year, label: normalizedLabel });
};

const deriveInvoiceDescription = (invoice = {}) => {
  const description = String(invoice?.description || "").trim();
  const category = String(invoice?.category || "").toUpperCase();
  const metadata = invoice?.metadata && typeof invoice.metadata === "object" ? invoice.metadata : {};

  // For non-utility invoices, return the stored description if it looks meaningful
  // (i.e. is not a bare period label like "May 26" or just "Utility Charge")
  if (category !== "UTILITY_CHARGE") {
    if (description && !/^utility\s+charge\b/i.test(description)) return description;
    return description;
  }

  // For UTILITY_CHARGE: always try to build a descriptive label that includes
  // the utility type name so the user knows *which* utility was invoiced.
  const utilityLabel = String(
    metadata?.utilityType ||
      metadata?.meterUtilityType ||
      metadata?.statementUtilityType ||
      metadata?.utilityName ||
      metadata?.utility ||
      metadata?.billItemLabel ||
      (Array.isArray(metadata?.utilityBreakdown) && metadata.utilityBreakdown.length === 1
        ? metadata.utilityBreakdown[0]?.label
        : "") ||
      ""
  ).trim();

  const invoiceDate = invoice?.invoiceDate || invoice?.createdAt || null;
  const parsedDate = invoiceDate ? new Date(invoiceDate) : null;

  if (utilityLabel && parsedDate && !Number.isNaN(parsedDate.getTime())) {
    return buildUtilityChargeDescription({
      utilityLabel,
      month: parsedDate.getMonth(),
      year: parsedDate.getFullYear(),
    });
  }

  // No utility type in metadata — check if the stored description is just a bare
  // period label (e.g. "May 26") and enrich it with a "Utility" prefix
  if (
    description &&
    !/^utility\s+charge\b/i.test(description) &&
    !/^utility\b/i.test(description)
  ) {
    // If description looks like a bare period label (e.g. "May/26", "May 26"),
    // prepend "Utility -" so it reads "Utility - May/26"
    if (/^[A-Z][a-z]{2}[\s/]\d{2}$/.test(description)) {
      return `Utility - ${description}`;
    }
    return description;
  }

  // Final fallback: if we have a date, use a generic "Utility Charge" with period
  if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
    return buildRecurringInvoiceDescription({
      month: parsedDate.getMonth(),
      year: parsedDate.getFullYear(),
      label: "Utility",
    });
  }

  return description || "Utility Charge";
};

const isLeaseAgreementFeeInvoice = ({ category, metadata = {} } = {}) => {
  const normalizedCategory = String(category || "").toUpperCase();
  if (normalizedCategory !== "OTHER_CHARGE") return false;

  const sourceType = String(metadata?.sourceTransactionType || metadata?.source || "").trim().toLowerCase();
  const billItemKey = String(metadata?.billItemKey || "").trim().toLowerCase();
  const billItemLabel = String(metadata?.billItemLabel || "").trim().toLowerCase();

  return (
    sourceType === "lease_agreement_fee" ||
    billItemKey === "lease_agreement_fee" ||
    billItemLabel === "lease / agreement fee"
  );
};

const getInvoiceChargeTypeKey = ({ category, metadata = {}, invoiceNumber = "", description = "" } = {}) => {
  const normalizedCategory = String(category || "").toUpperCase();

  if (isLeaseAgreementFeeInvoice({ category, metadata })) return "lease_agreement_fee";

  // Debit note TenantInvoice records (DN-prefix or "Debit Note" in description) may have
  // been stored with RENT_CHARGE category even when the actual charge was utility/penalty.
  // Derive the real type from the category first, then metadata signals.
  const isDebitNoteRecord =
    /^DN\d/i.test(String(invoiceNumber || "")) ||
    /debit\s*note/i.test(String(description || ""));

  if (isDebitNoteRecord) {
    if (normalizedCategory === "UTILITY_CHARGE") return "utility";
    if (normalizedCategory === "DEPOSIT_CHARGE") return "deposit";
    if (normalizedCategory === "LATE_PENALTY_CHARGE") return "late_penalty";
    const billItemKey = String(metadata?.billItemKey || "").toLowerCase();
    const utilityType = String(
      metadata?.utilityType || metadata?.meterUtilityType || metadata?.statementUtilityType || ""
    ).toLowerCase();
    if (utilityType || billItemKey.startsWith("utility:") || billItemKey === "utility") return "utility";
    if (billItemKey === "deposit") return "deposit";
    if (billItemKey === "late_payment" || billItemKey === "late_penalty") return "late_penalty";
    return "debit_note";
  }

  if (normalizedCategory === "RENT_CHARGE" && String(metadata?.billItemKey || "").toLowerCase() === "rent_utility:combined") return "combined";
  if (normalizedCategory === "DEPOSIT_CHARGE") return "deposit";
  if (normalizedCategory === "UTILITY_CHARGE") return "utility";
  if (normalizedCategory === "LATE_PENALTY_CHARGE") return "late_penalty";
  return "rent";
};

const getInvoiceChargeTypeLabel = (chargeType = "rent") => {
  const normalized = String(chargeType || "rent").toLowerCase();
  if (normalized === "combined") return "Combined Rent + Utility";
  if (normalized === "deposit") return "Deposit";
  if (normalized === "utility") return "Utility";
  if (normalized === "late_penalty") return "Late Penalty";
  if (normalized === "lease_agreement_fee") return "Lease / Agreement Fee";
  if (normalized === "debit_note") return "Debit Note";
  return "Rent";
};

const normalizeInvoiceStatus = (status = "") => String(status || "").trim().toLowerCase();
const isActiveInvoiceStatus = (status = "") => !["cancelled", "reversed"].includes(normalizeInvoiceStatus(status));

const normalizeUtilityConflictKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getInvoiceConflictBucket = ({ category, metadata = {} } = {}) => {
  const normalizedCategory = String(category || "").trim().toUpperCase();

  if (normalizedCategory === "RENT_CHARGE") {
    return String(metadata?.billItemKey || "").trim().toLowerCase() === "rent_utility:combined"
      ? "combined"
      : "rent";
  }

  if (normalizedCategory === "UTILITY_CHARGE") {
    const utilityKey = normalizeUtilityConflictKey(
      metadata?.utilityType ||
        metadata?.meterUtilityType ||
        metadata?.statementUtilityType ||
        metadata?.utilityName ||
        metadata?.utility ||
        ""
    );

    return utilityKey ? `utility:${utilityKey}` : "utility";
  }

  return "";
};

const isUtilityConflictBucket = (bucket = "") =>
  bucket === "utility" || String(bucket || "").startsWith("utility:");

const doInvoiceConflictBucketsOverlap = (requestedBucket = "", existingBucket = "") => {
  if (!requestedBucket || !existingBucket) return false;

  if (requestedBucket === "combined") {
    return existingBucket === "combined" || existingBucket === "rent" || isUtilityConflictBucket(existingBucket);
  }

  if (requestedBucket === "rent") {
    return existingBucket === "combined" || existingBucket === "rent";
  }

  if (isUtilityConflictBucket(requestedBucket)) {
    if (existingBucket === "combined") return true;
    if (!isUtilityConflictBucket(existingBucket)) return false;
    if (requestedBucket === "utility" || existingBucket === "utility") return true;
    return requestedBucket === existingBucket;
  }

  return false;
};

const isInvoiceInBillingPeriod = (dateRef, month, year) => {
  if (!dateRef) return false;
  const dt = new Date(dateRef);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getMonth() === Number(month) && dt.getFullYear() === Number(year);
};

const isInvoiceTakeOnBalance = (invoice = {}) => {
  const metadata = invoice?.metadata || {};
  return (
    metadata?.isTakeOnBalance === true ||
    metadata?.takeOnBalance === true ||
    metadata?.openingBalance === true ||
    ["tenant_take_on_balance", "tenant_opening_balance", "opening_balance"].includes(
      String(metadata?.sourceTransactionType || "").toLowerCase()
    )
  );
};

const getActiveInvoicesForTenantPeriod = ({ invoices = [], tenantId, unitId = null, month, year, periodKey = "" }) =>
  invoices.filter((invoice) => {
    const invoiceTenantId = String(invoice?.tenant?._id || invoice?.tenant || "");
    if (invoiceTenantId !== String(tenantId || "")) return false;
    if (unitId) {
      const invoiceUnitId = String(invoice?.unit?._id || invoice?.unit || "");
      if (invoiceUnitId !== String(unitId)) return false;
    }
    if (!isActiveInvoiceStatus(invoice?.status)) return false;
    if (isInvoiceTakeOnBalance(invoice)) return false;

    const invoicePeriodKey = String(invoice?.metadata?.periodKey || "").trim();
    if (periodKey && invoicePeriodKey) {
      return invoicePeriodKey === String(periodKey);
    }

    return isInvoiceInBillingPeriod(invoice?.invoiceDate || invoice?.createdAt, month, year);
  });

const hasBlockingInvoiceForRequest = ({
  invoices = [],
  tenantId,
  unitId = null,
  month,
  year,
  category,
  metadata,
  periodKey = "",
}) => {
  const requestedBucket = getInvoiceConflictBucket({ category, metadata });
  if (!requestedBucket) return false;

  return getActiveInvoicesForTenantPeriod({ invoices, tenantId, unitId, month, year, periodKey }).some((invoice) => {
    const existingBucket = getInvoiceConflictBucket({
      category: invoice?.category,
      metadata: invoice?.metadata || {},
    });

    return doInvoiceConflictBucketsOverlap(requestedBucket, existingBucket);
  });
};

const getBookingTaxSelection = (form = {}) => ({
  handling: form?.taxHandling || "company_default",
  taxCodeKey: form?.taxCodeKey || "vat_standard",
  taxMode: form?.taxMode || "company_default",
});

const mapInvoiceStatusLabel = ({ rawStatus = "", outstanding = 0, appliedAmount = 0 }) => {
  const normalizedStatus = String(rawStatus || "").toLowerCase();

  if (normalizedStatus === "paid") return "Paid";
  if (normalizedStatus === "partially_paid") return "Partially Paid";
  if (normalizedStatus === "cancelled") return "Cancelled";
  if (normalizedStatus === "reversed") return "Reversed";
  if (normalizedStatus === "pending") {
    if (outstanding <= 0) return "Paid";
    return appliedAmount > 0 ? "Partially Paid" : "Issued";
  }

  if (outstanding <= 0) return "Paid";
  return appliedAmount > 0 ? "Partially Paid" : "Issued";
};

const resolveBookingDateOverride = (form = {}) =>
  form?.bookWithInvoiceDate ? form?.invoiceDate || null : null;

const resolveTenantPropertyName = (tenant, unitsFromStore = [], propertiesFromStore = []) => {
  const directPropertyName =
    tenant?.unit?.property?.propertyName ||
    tenant?.property?.propertyName ||
    tenant?.propertyName;
  if (directPropertyName) return directPropertyName;

  const tenantUnitId = tenant?.unit?._id || tenant?.unit;
  const tenantUnitIdStr = tenantUnitId ? String(tenantUnitId) : "";
  const matchedUnit = unitsFromStore.find((unit) => String(unit?._id || "") === tenantUnitIdStr);

  const propertyIdFromUnit = matchedUnit?.property?._id || matchedUnit?.property;
  const propertyIdFromTenant = tenant?.property?._id || tenant?.property;
  const resolvedPropertyId = propertyIdFromUnit || propertyIdFromTenant;
  const resolvedPropertyIdStr = resolvedPropertyId ? String(resolvedPropertyId) : "";

  const matchedProperty = propertiesFromStore.find(
    (property) => String(property?._id || "") === resolvedPropertyIdStr
  );

  return (
    matchedUnit?.property?.propertyName ||
    matchedProperty?.propertyName ||
    matchedProperty?.name ||
    "N/A"
  );
};

const buildJournalEntriesForInvoice = (invoice) => {
  const amount = Number(invoice?.amount || 0);
  const chargeType = String(invoice?.chargeType || "rent").toLowerCase();
  const sourceInvoice = invoice?.originalInvoice || {};
  const fallbackAccount =
    chargeType === "deposit"
      ? { code: "2100", name: "Tenant Deposit Payable" }
      : chargeType === "late_penalty"
      ? { code: sourceInvoice?.chartAccount?.code || "", name: sourceInvoice?.chartAccount?.name || "Late Penalty Income" }
      : INVOICE_REVENUE_ACCOUNT_MAP[chargeType] || INVOICE_REVENUE_ACCOUNT_MAP.combined;
  const revenueAccount = {
    code: sourceInvoice?.chartAccount?.code || fallbackAccount.code,
    name: sourceInvoice?.chartAccount?.name || fallbackAccount.name,
  };
  const narration = `Invoice ${invoice?.id || ""} ${getInvoiceChargeTypeLabel(chargeType)} charge for ${invoice?.period || "period"}`;

  return [
    {
      accountCode: "1200",
      accountName: "Tenant Receivables",
      debit: amount,
      credit: 0,
      narration,
    },
    {
      accountCode: revenueAccount.code,
      accountName: revenueAccount.name,
      debit: 0,
      credit: amount,
      narration,
    },
  ];
};

const buildInvoiceRows = ({ invoices = [], tenantLookup = {}, unitsFromStore = [], propertiesFromStore = [] }) => {
  return (Array.isArray(invoices) ? invoices : [])
    .map((invoice, idx) => {
      const invoiceTenantId = String(invoice?.tenant?._id || invoice?.tenant || "");
      const tenant = tenantLookup[invoiceTenantId] || invoice?.tenant || {};
      const invoiceAmount = Number((invoice?.adjustedAmount ?? invoice?.amount) || 0);
      const resolvedAppliedAmount = Math.max(0, Number(invoice?.appliedAmount ?? 0));
      const resolvedOutstanding = Math.max(
        0,
        Number(invoice?.outstanding ?? Math.max(0, invoiceAmount - resolvedAppliedAmount))
      );
      const rawStatus = String(invoice?.computedStatus || invoice?.status || "").toLowerCase();
      const derivedStatus = mapInvoiceStatusLabel({
        rawStatus,
        outstanding: resolvedOutstanding,
        appliedAmount: resolvedAppliedAmount,
      });

      const invoiceDate = invoice?.invoiceDate || invoice?.createdAt;
      const parsedDate = invoiceDate ? new Date(invoiceDate) : new Date();
      const month = parsedDate.getMonth();
      const year = parsedDate.getFullYear();

      const propertyName =
        invoice?.property?.propertyName ||
        invoice?.propertyName ||
        resolveTenantPropertyName(tenant, unitsFromStore, propertiesFromStore);

      const unitName =
        invoice?.unit?.unitNumber ||
        invoice?.unit?.unitName ||
        invoice?.unitName ||
        getUnitDisplayName(tenant);

      const chargeType = getInvoiceChargeTypeKey({
        category: invoice?.category,
        metadata: invoice?.metadata || {},
        invoiceNumber: invoice?.invoiceNumber,
        description: invoice?.description,
      });
      const invoiceDocumentDateValue = invoice?.invoiceDate || invoice?.createdAt || null;
      const invoiceDateValue = invoice?.bookingDate || invoiceDocumentDateValue || null;
      const dueDateValue = invoice?.dueDate || null;

      return {
        key: `${invoice?._id || idx}`,
        _id: invoice?._id,
        id: invoice?.invoiceNumber || invoice?._id,
        period: formatPeriodLabel(month, year),
        invoiceDescription: deriveInvoiceDescription(invoice) || formatPeriodLabel(month, year),
        storagePeriodKey: formatPeriodLabel(month, year),
        chargeType,
        chargeTypeLabel: getInvoiceChargeTypeLabel(chargeType),
        tenantId: invoiceTenantId,
        tenantName: invoice?.tenant?.name || getTenantDisplayName(tenant),
        propertyName,
        unitName,
        amount: invoiceAmount,
        appliedAmount: resolvedAppliedAmount,
        outstandingAmount: resolvedOutstanding,
        status: derivedStatus,
        createdAt: invoice?.createdAt || invoice?.invoiceDate,
        createdDate: formatDateDisplay(invoice?.createdAt || invoice?.invoiceDate),
        invoiceDocumentDateValue,
        invoiceDateValue,
        invoiceDateLabel: formatDateDisplay(invoiceDateValue),
        dueDateValue,
        dueDateLabel: formatDateDisplay(dueDateValue),
        receiptApplications: Array.isArray(invoice?.receiptApplications) ? invoice.receiptApplications : [],
        originalInvoice: invoice,
      };
    })
    .sort((a, b) => {
      const aDate = a.invoiceDateValue ? new Date(a.invoiceDateValue).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bDate = b.invoiceDateValue ? new Date(b.invoiceDateValue).getTime() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bDate - aDate;
    });
};

const buildInvoiceServerFilters = ({ filters = emptyFilters, propertiesFromStore = [], unitsFromStore = [], tenantId = "" }) => {
  const selectedProperty =
    filters?.property && filters.property !== "any"
      ? propertiesFromStore.find((property) => property?.propertyName === filters.property)
      : null;
  const selectedPropertyId = selectedProperty?._id || "";

  let scopedUnits = Array.isArray(unitsFromStore) ? unitsFromStore : [];
  if (selectedPropertyId) {
    scopedUnits = scopedUnits.filter((unit) => {
      const unitPropertyId = unit?.property?._id || unit?.property || null;
      return String(unitPropertyId || "") === String(selectedPropertyId);
    });
  }

  const selectedUnit =
    filters?.unit && filters.unit !== "any"
      ? scopedUnits.find(
          (unit) =>
            (unit?.unitNumber || unit?.unitName || unit?.name || "") === filters.unit
        ) ||
        (Array.isArray(unitsFromStore) ? unitsFromStore : []).find(
          (unit) => (unit?.unitNumber || unit?.unitName || unit?.name || "") === filters.unit
        )
      : null;

  return {
    status: filters?.status || "ACTIVE",
    invoiceNumber: filters?.invoiceNo?.trim() || undefined,
    tenantName: tenantId ? undefined : filters?.tenantName?.trim() || undefined,
    propertyId: selectedPropertyId || undefined,
    unitId: selectedUnit?._id || undefined,
    fromDate: filters?.fromDate || undefined,
    toDate: filters?.toDate || undefined,
  };
};

function InvoiceTableRowBase({
  invoice,
  isSelected,
  idx,
  showTenantColumns,
  canExportInvoice,
  canDeleteInvoice,
  onView,
  onPrint,
  onDownload,
  onDelete,
  onSelect,
  onViewStatement,
}) {
  return (
    <tr
      className={`cursor-pointer border-b border-gray-100 transition-colors ${
        isSelected
          ? "bg-emerald-50/85 shadow-[inset_4px_0_0_0_#0B3B2E] hover:bg-emerald-50"
          : idx % 2 === 0
          ? "bg-white hover:bg-blue-50/40"
          : "bg-slate-50/60 hover:bg-blue-50/40"
      }`}
      onClick={() => onSelect(invoice.key)}
    >
      <td className="px-3 py-1 border-r border-gray-100">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelect(invoice.key)}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td className="px-3 py-1 border-r border-gray-100">
        <button
          type="button"
          className="font-bold text-blue-700 hover:text-blue-900 hover:underline focus:outline-none"
          onClick={(e) => { e.stopPropagation(); onView(invoice); }}
        >
          {invoice.id}
        </button>
      </td>
      {showTenantColumns && (
        <td className="px-3 py-1 border-r border-gray-100 font-bold text-slate-900">{invoice.tenantName}</td>
      )}
      {showTenantColumns && (
        <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{invoice.propertyName}</td>
      )}
      <td className="px-3 py-1 border-r border-gray-100 font-semibold text-slate-900">{invoice.unitName}</td>
      <td className="px-3 py-1 border-r border-gray-100 font-semibold text-orange-700">{invoice.invoiceDescription || invoice.period}</td>
      <td className="px-3 py-1 border-r border-gray-100">
        <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
          {invoice.chargeTypeLabel || getInvoiceChargeTypeLabel(invoice.chargeType)}
        </span>
      </td>
      <td className="px-3 py-1 border-r border-gray-100 text-center text-gray-700">{invoice.invoiceDateLabel}</td>
      <td className="px-3 py-1 border-r border-gray-100 text-center text-gray-700">{invoice.dueDateLabel}</td>
      <td className="px-3 py-1 border-r border-gray-100 text-right font-bold text-slate-900">
        KES {Number(invoice.amount || 0).toLocaleString()}
      </td>
      <td className="px-3 py-1 border-r border-gray-100 text-right font-semibold text-emerald-700">
        {Number(invoice.appliedAmount || 0) > 0 ? `KES ${Number(invoice.appliedAmount).toLocaleString()}` : <span className="text-slate-400">—</span>}
      </td>
      <td className="px-3 py-1 border-r border-gray-100 text-center">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${
            invoice.status === "Paid"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : invoice.status === "Cancelled" || invoice.status === "Reversed"
              ? "bg-slate-100 text-slate-600 border-slate-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          }`}>
          {invoice.status}
        </span>
      </td>
      <td className="px-3 py-1 text-right">
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onView(invoice)}
            className="rounded p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-800"
            title="View Invoice"
          >
            <FaEye size={12} />
          </button>
          {canExportInvoice && (
            <button
              onClick={() => onPrint(invoice)}
              className="rounded p-1 text-purple-600 hover:bg-purple-50 hover:text-purple-800"
              title="Print Invoice"
            >
              <FaPrint size={12} />
            </button>
          )}
          {canExportInvoice && (
            <button
              onClick={() => onDownload(invoice)}
              className="rounded p-1 text-green-600 hover:bg-green-50 hover:text-green-800"
              title="Download Invoice"
            >
              <FaDownload size={12} />
            </button>
          )}
          {canDeleteInvoice && (
            <button
              onClick={() => onDelete(invoice)}
              className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800"
              title="Delete Invoice"
            >
              <FaTrash size={12} />
            </button>
          )}
          {showTenantColumns && (
            <button
              onClick={() => onViewStatement(invoice.tenantId)}
              className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
              title="View Tenant Statement"
            >
              <FaArrowRight size={12} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function areEqual(prev, next) {
  return (
    prev.invoice._id === next.invoice._id &&
    prev.invoice.status === next.invoice.status &&
    prev.invoice.amount === next.invoice.amount &&
    prev.invoice.appliedAmount === next.invoice.appliedAmount &&
    prev.invoice.updatedAt === next.invoice.updatedAt &&
    prev.invoice.receiptApplications?.length === next.invoice.receiptApplications?.length &&
    prev.isSelected === next.isSelected &&
    prev.idx === next.idx &&
    prev.showTenantColumns === next.showTenantColumns &&
    prev.canExportInvoice === next.canExportInvoice &&
    prev.canDeleteInvoice === next.canDeleteInvoice
  );
}

const InvoiceTableRow = React.memo(InvoiceTableRowBase, areEqual);

const EMPTY_ARRAY = [];

const RentalInvoices = ({ initialOpenSingleBooking = false }) => {
  const { id: tenantId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const fromLedger     = location.state?.fromPropertyLedger;
  const ledgerProperty = location.state?.propertyName || "any";
  const initialFilters = fromLedger ? { ...emptyFilters, property: ledgerProperty } : emptyFilters;

  const [refreshTick, setRefreshTick] = useState(0);
  const [appliedFilters, setAppliedFilters] = useTabState("/invoices/rental:appliedFilters", initialFilters);
  const [draftFilters, setDraftFilters] = useState(appliedFilters);
  const setFilter = (key) => (e) => setDraftFilters((prev) => ({ ...prev, [key]: e.target.value }));
  const actionBtnCls = (enabled, activeCls) =>
    `h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white ${enabled ? activeCls : "bg-gray-400 cursor-not-allowed"}`;
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showSmsModal, setShowSmsModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [currentPage, setCurrentPage] = useTabState("/invoices/rental:currentPage", 1);
  const [bookingAction, setBookingAction] = useState("");
  const [showSingleBooking, setShowSingleBooking] = useState(false);
  const [showBatchBooking, setShowBatchBooking] = useState(false);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [tenantInvoicesFromApi, setTenantInvoicesFromApi] = useState([]);
  const [invoiceListPagination, setInvoiceListPagination] = useState({
    page: 1,
    limit: ITEMS_PER_PAGE,
    totalItems: 0,
    totalPages: 1,
  });
  const [invoicePageSummary, setInvoicePageSummary] = useState({
    pageItemCount: 0,
    pageTotalAmount: 0,
    pagePendingAmount: 0,
  });
  const [invoiceRevenueAccounts, setInvoiceRevenueAccounts] = useState([]);
  const [deletingInvoiceIds, setDeletingInvoiceIds] = useState([]);
  const [submittingSingleBooking, setSubmittingSingleBooking] = useState(false);
  const [submittingBatchBooking, setSubmittingBatchBooking] = useState(false);
  const [singleBookingPropertyFilter, setSingleBookingPropertyFilter] = useState("all");
  const [singleBookingTenantSearch, setSingleBookingTenantSearch] = useState("");
  const [singleBookingTenantDropdownOpen, setSingleBookingTenantDropdownOpen] = useState(false);
  const { currentBookingMonth, currentBookingYear } = useMemo(() => {
    const d = new Date();
    return { currentBookingMonth: d.getMonth(), currentBookingYear: d.getFullYear() };
  }, []);

  const [singleBookingForm, setSingleBookingForm] = useState({
    tenantId: tenantId || "",
    month: currentBookingMonth,
    year: currentBookingYear,
    dueDay: 5,
    billingMode: "separate",
    invoiceDate: getStartOfPeriod(currentBookingMonth, currentBookingYear),
    bookWithInvoiceDate: false,
    taxHandling: "company_default",
    taxCodeKey: "vat_standard",
    taxMode: "company_default",
  });

  const [batchBookingForm, setBatchBookingForm] = useState({
    propertyId: "all",
    month: currentBookingMonth,
    year: currentBookingYear,
    dueDay: 5,
    billingMode: "separate",
    invoiceDate: getStartOfPeriod(currentBookingMonth, currentBookingYear),
    bookWithInvoiceDate: false,
    taxHandling: "company_default",
    taxCodeKey: "vat_standard",
    taxMode: "company_default",
  });

  const currentCompany = useSelector(selectCurrentCompany);
  const currentUser = useSelector(selectCurrentUser);
  const { canCreateInvoice, canUpdateInvoice, canDeleteInvoice, canExportInvoice } = useMemo(() => ({
    canCreateInvoice: hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "create", "propertyManagement"),
    canUpdateInvoice: hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "update", "propertyManagement"),
    canDeleteInvoice: hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "delete", "propertyManagement"),
    canExportInvoice: hasCompanyPermission(currentUser || {}, currentCompany, "tenantInvoices", "export", "propertyManagement"),
  }), [currentUser, currentCompany]);
  const rawTenantsFromStore = useSelector(selectAllTenants);
  const propertiesFromStore = useSelector(selectAllProperties);
  const unitsFromStore = useSelector(selectAllUnits);
  const tenantsFromStore = useMemo(() => ensureArray(rawTenantsFromStore), [rawTenantsFromStore]);
  const { propertiesLoaded, unitsLoaded, tenantsLoaded } = useEntityCache(currentCompany?._id);
  const storedSettings = useSelector(selectCompanySettings);
  const companyTaxConfig = storedSettings || null;
  const companyBillingPeriods = Array.isArray(storedSettings?.billingPeriods) ? storedSettings.billingPeriods : EMPTY_ARRAY;
  const [leases, setLeases] = useState([]);

  const normalizedTaxConfig = useMemo(
    () => normalizeCompanyTaxConfig(companyTaxConfig),
    [companyTaxConfig]
  );
  const activeTaxCodes = useMemo(
    () => getActiveTaxCodes(normalizedTaxConfig),
    [normalizedTaxConfig]
  );
  const taxCodeOptions = useMemo(
    () => activeTaxCodes.map((code) => ({ value: code.key, label: `${code.name} (${Number(code.rate || 0)}%)` })),
    [activeTaxCodes]
  );
  const companyTaxEnabled = Boolean(normalizedTaxConfig?.taxSettings?.enabled);
  const normalizedBillingPeriods = useMemo(() => {
    const source = Array.isArray(companyBillingPeriods) && companyBillingPeriods.length > 0
      ? companyBillingPeriods
      : [{ key: "monthly", name: "Monthly", durationInMonths: 1, isActive: true }];
    const seen = new Set();
    return source
      .map((item) => ({
        key: canonicalBillingPeriodKey(item?.key || item?.name || "monthly"),
        name: String(item?.name || item?.label || item?.key || "Monthly").trim() || "Monthly",
        durationInMonths: Math.max(1, Number(item?.durationInMonths || FALLBACK_BILLING_PERIOD_MONTHS[canonicalBillingPeriodKey(item?.key || item?.name)] || 1)),
        isActive: item?.isActive !== false,
      }))
      .filter((item) => {
        if (!item.key || seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });
  }, [companyBillingPeriods]);

  const resolveBillingPeriodDefinition = useCallback((billingPeriodKey = "monthly") => {
    const normalizedKey = canonicalBillingPeriodKey(billingPeriodKey);
    return (
      normalizedBillingPeriods.find((item) => item.key === normalizedKey) ||
      normalizedBillingPeriods.find((item) => item.key === "monthly") ||
      { key: "monthly", name: "Monthly", durationInMonths: 1, isActive: true }
    );
  }, [normalizedBillingPeriods]);

  const leaseLookup = useMemo(() => {
    const byTenant = new Map();
    const byTenantUnit = new Map();

    const activeLeases = (Array.isArray(leases) ? leases : [])
      .filter((lease) => ["active", "draft", "pending_signature"].includes(String(lease?.status || "").toLowerCase()))
      .sort((a, b) => new Date(b?.startDate || b?.createdAt || 0) - new Date(a?.startDate || a?.createdAt || 0));

    activeLeases.forEach((lease) => {
      const tenantKey = String(lease?.tenant?._id || lease?.tenant || "");
      const unitKey = String(lease?.unit?._id || lease?.unit || "");
      if (tenantKey && !byTenant.has(tenantKey)) {
        byTenant.set(tenantKey, lease);
      }
      if (tenantKey && unitKey) {
        const compositeKey = `${tenantKey}:${unitKey}`;
        if (!byTenantUnit.has(compositeKey)) {
          byTenantUnit.set(compositeKey, lease);
        }
      }
    });

    return { byTenant, byTenantUnit };
  }, [leases]);

  const resolveLeaseForTenantUnit = (tenant, unitId = null) => {
    const tenantKey = String(tenant?._id || "");
    const unitKey = String(unitId || tenant?.invoiceUnit?._id || tenant?.invoiceUnit || tenant?.unit?._id || tenant?.unit || "");
    if (tenantKey && unitKey) {
      const exact = leaseLookup.byTenantUnit.get(`${tenantKey}:${unitKey}`);
      if (exact) return exact;
    }
    return tenantKey ? leaseLookup.byTenant.get(tenantKey) || null : null;
  };

  const resolveTenantBookingPeriod = ({ tenant, unitContext, month, year }) => {
    const lease = resolveLeaseForTenantUnit(tenant, unitContext?.unitId);
    const invoiceMonthStart = new Date(Number(year), Number(month), 1, 0, 0, 0, 0);
    if (Number.isNaN(invoiceMonthStart.getTime())) {
      return { allowed: false, reason: "Invalid billing period selected." };
    }

    const billingPeriod = resolveBillingPeriodDefinition(
      lease?.billingPeriodKey ||
      tenant?.billingPeriodKey ||
      tenant?.billingFrequency ||
      unitContext?.unit?.billingPeriodKey ||
      unitContext?.unit?.billingFrequency ||
      "monthly"
    );
    const leaseStartDate = new Date(lease?.startDate || tenant?.moveInDate || invoiceMonthStart);
    leaseStartDate.setHours(0, 0, 0, 0);
    const scheduleAnchor = new Date(leaseStartDate);
    const leaseEndDate = lease?.endDate ? new Date(lease.endDate) : null;
    if (leaseEndDate && !Number.isNaN(leaseEndDate.getTime())) {
      leaseEndDate.setHours(23, 59, 59, 999);
    }

    let currentDate = new Date(scheduleAnchor);
    while (currentDate <= invoiceMonthStart) {
      const nextDate = addMonthsPreservingDay(currentDate, billingPeriod.durationInMonths) || new Date(invoiceMonthStart);
      const periodEnd = new Date(nextDate.getTime() - 1);
      if (
        invoiceMonthStart.getFullYear() === currentDate.getFullYear() &&
        invoiceMonthStart.getMonth() === currentDate.getMonth()
      ) {
        const periodKey = buildSchedulePeriodKey({ startDate: currentDate, billingPeriodKey: billingPeriod.key });
        const rawAdjustments = Array.isArray(lease?.billingScheduleAdjustments) ? lease.billingScheduleAdjustments : [];
        const adjustment =
          rawAdjustments.find((item) => String(item?.periodKey || "") === String(periodKey)) ||
          rawAdjustments.find((item) => {
            const itemFrom = item?.fromDate ? new Date(item.fromDate) : null;
            return itemFrom && itemFrom.getFullYear() === currentDate.getFullYear() && itemFrom.getMonth() === currentDate.getMonth();
          }) ||
          null;

        if (adjustment?.status === "deleted") {
          return { allowed: false, reason: "Selected billing period has been deleted from the lease schedule." };
        }
        if (adjustment?.status === "frozen") {
          return { allowed: false, reason: "Selected billing period is frozen in the lease schedule." };
        }
        if (leaseEndDate && currentDate > leaseEndDate) {
          return { allowed: false, reason: "Selected billing period falls outside the lease term." };
        }

        const fromDate = adjustment?.fromDate ? new Date(adjustment.fromDate) : currentDate;
        const toDate = adjustment?.toDate ? new Date(adjustment.toDate) : periodEnd;
        const paymentDueDay = Math.max(1, Math.min(28, Number(lease?.paymentDueDay || 5)));
        const dueDate = new Date(fromDate);
        dueDate.setDate(Math.min(paymentDueDay, new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0).getDate()));
        dueDate.setHours(23, 59, 59, 999);

        return {
          allowed: true,
          lease,
          billingPeriod,
          periodKey,
          fromDate,
          toDate,
          dueDate,
          description: formatScheduleLabel({ startDate: fromDate, endDate: toDate, billingPeriod }),
          rentAmount: Number(adjustment?.rentAmount ?? Number(unitContext?.rentAmount || 0) * billingPeriod.durationInMonths),
          utilityAmount: Number(adjustment?.utilityAmount ?? Number(unitContext?.utilityAmount || 0) * billingPeriod.durationInMonths),
          utilityNames: Array.isArray(adjustment?.utilityNames) ? adjustment.utilityNames : [],
        };
      }
      currentDate = nextDate;
    }

    return { allowed: false, reason: "Selected month is not a scheduled billing start for this tenant's billing frequency." };
  };

  useEffect(() => {
    if (!currentCompany?._id) return;
    if (!tenantsLoaded) dispatch(getTenants({ business: currentCompany._id }));
    if (!propertiesLoaded) dispatch(getProperties({ business: currentCompany._id }));
    if (!unitsLoaded) dispatch(getUnits({ business: currentCompany._id }));
  }, [currentCompany?._id]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!tenantId) return;
    setSingleBookingForm((prev) => ({ ...prev, tenantId }));
  }, [tenantId]);

  useEffect(() => {
    if (!(initialOpenSingleBooking || location?.state?.openSingleBooking)) return;
    setShowSingleBooking(true);
    setBookingAction("single");
    if (tenantId) {
      setSingleBookingForm((prev) => ({ ...prev, tenantId }));
    }
  }, [initialOpenSingleBooking, location?.state?.openSingleBooking, tenantId]);

  useEffect(() => {
    if (!isFutureBillingPeriod(singleBookingForm.month, singleBookingForm.year)) return;

    setSingleBookingForm((prev) => ({
      ...prev,
      month: currentBookingMonth,
      year: currentBookingYear,
    }));
  }, [singleBookingForm.month, singleBookingForm.year, currentBookingMonth, currentBookingYear]);

  useEffect(() => {
    if (!isFutureBillingPeriod(batchBookingForm.month, batchBookingForm.year)) return;

    setBatchBookingForm((prev) => ({
      ...prev,
      month: currentBookingMonth,
      year: currentBookingYear,
    }));
  }, [batchBookingForm.month, batchBookingForm.year, currentBookingMonth, currentBookingYear]);

  useEffect(() => {
    setSingleBookingForm((prev) => {
      const normalizedDueDay = normalizeDueDay(prev.dueDay, prev.month, prev.year);
      const nextInvoiceDate = prev.bookWithInvoiceDate ? prev.invoiceDate : getStartOfPeriod(prev.month, prev.year);
      if (normalizedDueDay === prev.dueDay && String(nextInvoiceDate) === String(prev.invoiceDate)) return prev;
      return { ...prev, dueDay: normalizedDueDay, invoiceDate: nextInvoiceDate };
    });
  }, [singleBookingForm.month, singleBookingForm.year]);

  useEffect(() => {
    setBatchBookingForm((prev) => {
      const normalizedDueDay = normalizeDueDay(prev.dueDay, prev.month, prev.year);
      const nextInvoiceDate = prev.bookWithInvoiceDate ? prev.invoiceDate : getStartOfPeriod(prev.month, prev.year);
      if (normalizedDueDay === prev.dueDay && String(nextInvoiceDate) === String(prev.invoiceDate)) return prev;
      return { ...prev, dueDay: normalizedDueDay, invoiceDate: nextInvoiceDate };
    });
  }, [batchBookingForm.month, batchBookingForm.year]);


  useEffect(() => {
    if (currentCompany?._id) dispatch(fetchCompanySettings(currentCompany._id));
  }, [currentCompany?._id, dispatch]);

  useEffect(() => {
    const defaultTaxCodeKey = storedSettings?.taxSettings?.defaultTaxCodeKey || "vat_standard";
    setSingleBookingForm((prev) => ({ ...prev, taxCodeKey: prev.taxCodeKey || defaultTaxCodeKey }));
    setBatchBookingForm((prev) => ({ ...prev, taxCodeKey: prev.taxCodeKey || defaultTaxCodeKey }));
  }, [storedSettings]);

  useEffect(() => {
    if (!currentCompany?._id) {
      setLeases([]);
      return;
    }

    let isMounted = true;
    const loadLeases = async () => {
      try {
        const res = await adminRequests.get(`/leases?business=${currentCompany._id}`);
        if (!isMounted) return;
        const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res?.data?.data) ? res.data.data : [];
        setLeases(rows);
      } catch {
        if (isMounted) setLeases([]);
      }
    };

    loadLeases();
    return () => {
      isMounted = false;
    };
  }, [currentCompany?._id]);

  useEffect(() => {
    if (!currentCompany?._id) return;

    const loadInvoiceSupportData = async () => {
      try {
        // Your backend chart-of-accounts endpoint appears to require a code.
        // So fetch the known revenue accounts one by one instead of trying to load all income accounts.
        const [account4100, account4102] = await Promise.all([
          getChartOfAccounts({ business: currentCompany._id, code: "4100" }),
          getChartOfAccounts({ business: currentCompany._id, code: "4102" }),
        ]);

        const normalized = [
          ...(Array.isArray(account4100) ? account4100 : []),
          ...(Array.isArray(account4102) ? account4102 : []),
        ];

        const deduped = normalized.filter(
          (acc, index, arr) =>
            acc?._id && arr.findIndex((x) => String(x?._id) === String(acc?._id)) === index
        );

        setInvoiceRevenueAccounts(deduped);
      } catch (error) {
        console.error("Failed to load chart of accounts:", error);
        setInvoiceRevenueAccounts([]);
      }
    };

    loadInvoiceSupportData();
  }, [currentCompany?._id]);

  const appliedServerFilters = useMemo(
    () =>
      buildInvoiceServerFilters({
        filters: appliedFilters,
        propertiesFromStore,
        unitsFromStore,
        tenantId,
      }),
    [appliedFilters, propertiesFromStore, unitsFromStore, tenantId]
  );

  useEffect(() => {
    if (!currentCompany?._id) return;

    const loadInvoices = async () => {
      try {
        const payload = await getTenantInvoices({
          tenantId,
          business: currentCompany._id,
          includeSnapshots: true,
          paginate: true,
          page: currentPage,
          limit: ITEMS_PER_PAGE,
          ...appliedServerFilters,
        });

        setTenantInvoicesFromApi(Array.isArray(payload?.data) ? payload.data : []);
        setInvoiceListPagination({
          page: Number(payload?.pagination?.page || currentPage || 1),
          limit: Number(payload?.pagination?.limit || ITEMS_PER_PAGE),
          totalItems: Number(payload?.pagination?.totalItems || 0),
          totalPages: Number(payload?.pagination?.totalPages || 1),
        });
        setInvoicePageSummary({
          pageItemCount: Number(payload?.summary?.pageItemCount || 0),
          pageTotalAmount: Number(payload?.summary?.pageTotalAmount || 0),
          pagePendingAmount: Number(payload?.summary?.pagePendingAmount || 0),
        });
      } catch (error) {
        console.error("Failed to load tenant invoices:", error);
        setTenantInvoicesFromApi([]);
        setInvoiceListPagination({
          page: 1,
          limit: ITEMS_PER_PAGE,
          totalItems: 0,
          totalPages: 1,
        });
        setInvoicePageSummary({
          pageItemCount: 0,
          pageTotalAmount: 0,
          pagePendingAmount: 0,
        });
      }
    };

    loadInvoices();
  }, [currentCompany?._id, tenantId, refreshTick, currentPage, appliedServerFilters]);

  const uniqueProperties = useMemo(() => {
    return [
      "any",
      ...Array.from(
        new Set(propertiesFromStore.map((property) => property?.propertyName).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    ];
  }, [propertiesFromStore]);

  const unitsForSelectedProperty = useMemo(() => {
    let scopedUnits = unitsFromStore;

    if (draftFilters.property !== "any") {
      const selectedProperty = propertiesFromStore.find(
        (property) => property?.propertyName === draftFilters.property
      );
      const selectedPropertyId = selectedProperty?._id;

      scopedUnits = unitsFromStore.filter((unit) => {
        const unitPropertyId = unit?.property?._id || unit?.property;
        const unitPropertyName = unit?.property?.propertyName || unit?.propertyName;

        if (selectedPropertyId) {
          return String(unitPropertyId) === String(selectedPropertyId);
        }
        return unitPropertyName === draftFilters.property;
      });
    }

    return [
      "any",
      ...Array.from(
        new Set(
          scopedUnits
            .map((unit) => unit?.unitNumber || unit?.unitName || unit?.name)
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    ];
  }, [unitsFromStore, propertiesFromStore, draftFilters.property]);

  const tenantLookup = useMemo(() => {
    const lookup = {};
    tenantsFromStore.forEach((tenant) => {
      lookup[tenant._id] = tenant;
    });
    return lookup;
  }, [tenantsFromStore]);

  const unitLookupById = useMemo(() => {
    const m = new Map();
    unitsFromStore.forEach(u => { if (u?._id) m.set(String(u._id), u); });
    return m;
  }, [unitsFromStore]);


const getAssignedUnitContexts = useCallback((tenant) => {
  const rawUnits = [tenant?.unit, ...(Array.isArray(tenant?.additionalUnits) ? tenant.additionalUnits : [])]
    .filter(Boolean)
    .map((unitRef) => {
      const unitId = unitRef?._id || unitRef;
      const matchedUnit = unitLookupById.get(String(unitId));
      return matchedUnit || unitRef || null;
    })
    .filter(Boolean);

  const seen = new Set();
  return rawUnits.filter((unit) => {
    const key = String(unit?._id || unit || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((unit) => ({
    unit,
    unitId: unit?._id || unit,
    unitName: unit?.unitName || unit?.name || unit?.unitNumber || "N/A",
    propertyId: unit?.property?._id || unit?.property || null,
    rentAmount: Number(unit?.rent || unit?.monthlyRent || 0) || 0,
    utilityRows: Array.isArray(unit?.utilities) ? unit.utilities : [],
  }));
}, [unitLookupById]);


const getTenantPricing = useCallback((tenant) => {
  const assignedUnitContexts = getAssignedUnitContexts(tenant);
  if (!assignedUnitContexts.length) {
    return {
      rentAmount: 0,
      utilityAmount: 0,
      utilityLabel: "",
      total: 0,
      unitContexts: [],
    };
  }

  const unitContexts = assignedUnitContexts.map((context) => {
    const tenantUtilities = Array.isArray(tenant?.utilities) ? tenant.utilities : [];
    const utilitiesFromTenant = tenantUtilities.reduce((sum, utility) => {
      if (utility?.isIncluded === true) return sum;
      return sum + (Number(utility?.unitCharge || utility?.amount || 0) || 0);
    }, 0);

    const useTenantUtilities = utilitiesFromTenant > 0 && assignedUnitContexts.length === 1;
    const sourceRows = useTenantUtilities ? tenantUtilities : context.utilityRows;
    let utilitiesFromUnit = 0;
    const billableUtilityRows = sourceRows.reduce((acc, item) => {
      if (item?.isIncluded === true) return acc;
      const amount = Number(item?.unitCharge || item?.amount || 0);
      utilitiesFromUnit += amount;
      const label = extractUtilityLabel(item);
      if (label && amount > 0) acc.push({ label, amount });
      return acc;
    }, []);
    const billableUtilityLabels = billableUtilityRows.map((r) => r.label);

    return {
      ...context,
      utilityAmount: useTenantUtilities ? utilitiesFromTenant : utilitiesFromUnit,
      utilityLabel:
        billableUtilityLabels.length > 0 ? billableUtilityLabels.join(", ") : "",
      billableUtilityRows,
    };
  });

  const rentAmount = unitContexts.reduce((sum, item) => sum + Number(item.rentAmount || 0), 0);
  const utilityAmount = unitContexts.reduce((sum, item) => sum + Number(item.utilityAmount || 0), 0);
  const utilityLabels = Array.from(new Set(unitContexts.map((item) => item.utilityLabel).filter(Boolean)));

  return {
    rentAmount,
    utilityAmount,
    utilityLabel: utilityLabels.length > 0 ? utilityLabels.join(", ") : "",
    total: rentAmount + utilityAmount,
    unitContexts,
  };
}, [getAssignedUnitContexts]);

const getTenantPricingForBookingPeriod = useCallback((tenant, month, year) => {
  const pricing = getTenantPricing(tenant);
  const scheduleAwareUnitContexts = pricing.unitContexts
    .map((context) => {
      const bookingPeriod = resolveTenantBookingPeriod({ tenant, unitContext: context, month, year });
      if (!bookingPeriod?.allowed) return null;
      return {
        ...context,
        rentAmount: bookingPeriod.rentAmount,
        utilityAmount: bookingPeriod.utilityAmount,
        utilityLabel:
          Array.isArray(bookingPeriod.utilityNames) && bookingPeriod.utilityNames.length === 1
            ? bookingPeriod.utilityNames[0]
            : context.utilityLabel,
      };
    })
    .filter(Boolean);

  if (!scheduleAwareUnitContexts.length) {
    return {
      rentAmount: 0,
      utilityAmount: 0,
      utilityLabel: "",
      total: 0,
      unitContexts: [],
    };
  }

  const rentAmount = scheduleAwareUnitContexts.reduce((sum, item) => sum + Number(item.rentAmount || 0), 0);
  const utilityAmount = scheduleAwareUnitContexts.reduce((sum, item) => sum + Number(item.utilityAmount || 0), 0);
  const utilityLabels = Array.from(new Set(scheduleAwareUnitContexts.map((item) => item.utilityLabel).filter(Boolean)));

  return {
    rentAmount,
    utilityAmount,
    utilityLabel: utilityLabels.length > 0 ? utilityLabels.join(", ") : "",
    total: rentAmount + utilityAmount,
    unitContexts: scheduleAwareUnitContexts,
  };
}, [getTenantPricing]);

const getTenantPropertyId = useCallback((tenant) => {
    const directPropertyId = tenant?.property?._id || tenant?.property;
    if (directPropertyId) return directPropertyId;

    const tenantUnitId = String(tenant?.unit?._id || tenant?.unit || "");
    const matchedUnit = unitLookupById.get(tenantUnitId);
    return matchedUnit?.property?._id || matchedUnit?.property || null;
  }, [unitLookupById]);

  const activeProperties = useMemo(() => {
    return propertiesFromStore.filter((property) => {
      const propertyStatus = String(property?.status || "active").toLowerCase();
      return propertyStatus === "active";
    });
  }, [propertiesFromStore]);
  const activePropertyOptions = useMemo(
    () => [{ value: "all", label: "All active properties" }, ...activeProperties.map((property) => ({ value: property._id, label: property.propertyName || property.name }))],
    [activeProperties]
  );

  const singleBookingTenantOptions = useMemo(() => {
    const normalizedSearch = String(singleBookingTenantSearch || "").trim().toLowerCase();
    const BOOKABLE_STATUSES = new Set(["active", "overdue"]);

    const mapped = tenantsFromStore
      .filter(tenant => {
        if (!BOOKABLE_STATUSES.has(String(tenant?.status || "active").toLowerCase())) return false;
        if (singleBookingPropertyFilter !== "all" && String(getTenantPropertyId(tenant) || "") !== String(singleBookingPropertyFilter)) return false;
        return true;
      })
      .map(tenant => ({
        id: tenant._id,
        name: getTenantDisplayName(tenant),
        tenantCode: tenant?.tenantCode || tenant?.code || tenant?.tenantNo || "",
        propertyName: resolveTenantPropertyName(tenant, unitsFromStore, propertiesFromStore),
        unitName: getUnitDisplayName(tenant),
      }));

    const filtered = normalizedSearch
      ? mapped.filter(o => `${o.name} ${o.tenantCode} ${o.propertyName} ${o.unitName}`.toLowerCase().includes(normalizedSearch))
      : mapped;

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [tenantsFromStore, unitsFromStore, propertiesFromStore, singleBookingPropertyFilter, singleBookingTenantSearch]);

  const selectedSingleBookingTenant = useMemo(() => {
    return tenantLookup[singleBookingForm.tenantId] || null;
  }, [tenantLookup, singleBookingForm.tenantId]);

  const selectedSingleBookingPreview = useMemo(() => {
    if (!selectedSingleBookingTenant) return null;
    const pricing = getTenantPricingForBookingPeriod(selectedSingleBookingTenant, Number(singleBookingForm.month), Number(singleBookingForm.year));
    const bookingAmounts = resolveBookingAmountsForMode({
      rentAmount: pricing.rentAmount,
      utilityAmount: pricing.utilityAmount,
      billingMode: singleBookingForm.billingMode,
    });

    return {
      periodLabel: formatPeriodLabel(Number(singleBookingForm.month), Number(singleBookingForm.year)),
      rentAmount: pricing.rentAmount,
      utilityAmount: pricing.utilityAmount,
      totalAmount: pricing.total,
      selectedRentAmount: bookingAmounts.rentAmount,
      selectedUtilityAmount: bookingAmounts.utilityAmount,
      selectedTotalAmount: bookingAmounts.totalAmount,
      normalizedBillingMode: bookingAmounts.billingMode,
      propertyName: resolveTenantPropertyName(
        selectedSingleBookingTenant,
        unitsFromStore,
        propertiesFromStore
      ),
      unitName: getUnitDisplayName(selectedSingleBookingTenant),
    };
  }, [
    singleBookingForm.billingMode,
    singleBookingForm.month,
    singleBookingForm.year,
    selectedSingleBookingTenant,
    unitsFromStore,
    propertiesFromStore,
  ]);

  const selectedSingleBookingTaxPreview = useMemo(() => {
    if (!selectedSingleBookingPreview) return null;

    const components = [
      selectedSingleBookingPreview.selectedRentAmount > 0
        ? { category: "RENT_CHARGE", amount: selectedSingleBookingPreview.selectedRentAmount }
        : null,
      selectedSingleBookingPreview.selectedUtilityAmount > 0
        ? { category: "UTILITY_CHARGE", amount: selectedSingleBookingPreview.selectedUtilityAmount }
        : null,
    ].filter(Boolean);

    return buildTaxPreviewForComponents({
      components,
      companyTaxConfig: normalizedTaxConfig,
      selection: getBookingTaxSelection(singleBookingForm),
    });
  }, [selectedSingleBookingPreview, singleBookingForm, normalizedTaxConfig]);

  const batchBookingScopeTenants = useMemo(() => {
    return tenantsFromStore.filter((tenant) => {
      const tenantStatus = String(tenant?.status || "active").toLowerCase();
      if (tenantStatus !== "active") return false;

      const tenantPropertyId = getTenantPropertyId(tenant);
      if (!tenantPropertyId) return false;

      if (batchBookingForm.propertyId === "all") {
        return activeProperties.some((property) => String(property?._id) === String(tenantPropertyId));
      }

      return String(tenantPropertyId) === String(batchBookingForm.propertyId);
    });
  }, [tenantsFromStore, batchBookingForm.propertyId, activeProperties]);

  const batchBookingScopeCount = batchBookingScopeTenants.length;

  const selectedSingleBookingTenantOption = useMemo(() => {
    if (!singleBookingForm.tenantId) return null;
    const tenant = tenantLookup[singleBookingForm.tenantId];
    if (!tenant) return null;
    return {
      id: tenant._id,
      name: getTenantDisplayName(tenant),
      tenantCode: tenant?.tenantCode || tenant?.code || tenant?.tenantNo || "",
      propertyName: resolveTenantPropertyName(tenant, unitsFromStore, propertiesFromStore),
      unitName: getUnitDisplayName(tenant),
    };
  }, [singleBookingForm.tenantId, tenantLookup, unitsFromStore, propertiesFromStore]);

  const formatTenantOptionLabel = (tenantOption) => {
    if (!tenantOption) return "";
    const code = tenantOption.tenantCode ? ` · ${tenantOption.tenantCode}` : "";
    return `${tenantOption.name}${code} - ${tenantOption.propertyName} (${tenantOption.unitName})`;
  };

  const batchBookingTaxPreview = useMemo(() => {
    const components = batchBookingScopeTenants.flatMap((tenant) => {
      const pricing = getTenantPricing(tenant);
      const bookingAmounts = resolveBookingAmountsForMode({
        rentAmount: pricing.rentAmount,
        utilityAmount: pricing.utilityAmount,
        billingMode: batchBookingForm.billingMode,
      });

      return [
        bookingAmounts.rentAmount > 0 ? { category: "RENT_CHARGE", amount: bookingAmounts.rentAmount } : null,
        bookingAmounts.utilityAmount > 0 ? { category: "UTILITY_CHARGE", amount: bookingAmounts.utilityAmount } : null,
      ].filter(Boolean);
    });

    return buildTaxPreviewForComponents({
      components,
      companyTaxConfig: normalizedTaxConfig,
      selection: getBookingTaxSelection(batchBookingForm),
    });
  }, [batchBookingForm, batchBookingScopeTenants, normalizedTaxConfig]);

  const invoiceRows = useMemo(
    () =>
      buildInvoiceRows({
        invoices: tenantInvoicesFromApi,
        tenantLookup,
        unitsFromStore,
        propertiesFromStore,
      }),
    [tenantInvoicesFromApi, tenantLookup, unitsFromStore, propertiesFromStore]
  );

  const filteredInvoices = useMemo(
    () => invoiceRows.filter((invoice) => !deletingInvoiceIds.includes(invoice._id)),
    [invoiceRows, deletingInvoiceIds]
  );

  const totalFilteredCount = Number(invoiceListPagination?.totalItems || 0);
  const totalPages = Math.max(1, Number(invoiceListPagination?.totalPages || 1));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = totalFilteredCount === 0 ? 0 : (safeCurrentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = totalFilteredCount === 0 ? 0 : Math.min(startIndex + filteredInvoices.length, totalFilteredCount);
  const currentPageInvoices = filteredInvoices;

useEffect(() => {
  if (currentPage !== safeCurrentPage) setCurrentPage(safeCurrentPage);
}, [currentPage, safeCurrentPage]);

const visibleInvoiceKeys = useMemo(
  () => currentPageInvoices.map((invoice) => invoice.key),
  [currentPageInvoices]
);

  useEffect(() => {
    if (!invoiceDetailOpen || !activeInvoice?._id) return;

    const refreshedInvoice = invoiceRows.find(
      (invoice) => String(invoice?._id || "") === String(activeInvoice?._id || "")
    );

    if (!refreshedInvoice) {
      setInvoiceDetailOpen(false);
      setActiveInvoice(null);
      return;
    }

    if (refreshedInvoice !== activeInvoice) {
      setActiveInvoice(refreshedInvoice);
    }
  }, [invoiceDetailOpen, activeInvoice, invoiceRows]);

  useEffect(() => {
    if (filteredInvoices.length === 0) {
      setSelectAll(false);
      setSelectedInvoices([]);
      return;
    }

    const visibleKeys = new Set(filteredInvoices.map((inv) => inv.key));
    setSelectedInvoices((prev) => prev.filter((key) => visibleKeys.has(key)));
  }, [filteredInvoices]);

  const totalAmount = Number(invoicePageSummary?.pageTotalAmount || 0);
  const pendingAmount = Number(invoicePageSummary?.pagePendingAmount || 0);

  const selectedCount = selectedInvoices.length;
  const canEdit = selectedCount === 1;

  const { companyDisplayName, companyPhone, companyEmail, companyTown, companyAddress, companyLogo } = useMemo(() => {
    const town = currentCompany?.town || currentCompany?.city || "";
    return {
      companyDisplayName: currentCompany?.companyName || currentCompany?.name || currentCompany?.company || "MILIK Property Management",
      companyPhone: currentCompany?.phone || currentCompany?.phoneNo || currentCompany?.phoneNumber || currentCompany?.contactPhone || "",
      companyEmail: currentCompany?.email || currentCompany?.companyEmail || currentCompany?.contactEmail || "",
      companyTown: town,
      companyAddress: [currentCompany?.address || currentCompany?.postalAddress || currentCompany?.location || "", town].filter(Boolean).join(", "),
      companyLogo: currentCompany?.logo || "",
    };
  }, [currentCompany]);

  const {
    activeInvoiceSource,
    activeInvoiceMetadata,
    activeInvoiceTaxSnapshot,
    activeInvoiceUtilityBreakdown,
    activeInvoiceNetAmount,
    activeInvoiceTaxAmount,
    activeInvoiceGrossAmount,
    activeInvoiceDaysOverdue,
    activeInvoiceSettlementPercentage,
  } = useMemo(() => {
    const source = activeInvoice?.originalInvoice || {};
    const metadata = source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
    const taxSnapshot = source?.taxSnapshot && typeof source.taxSnapshot === "object" ? source.taxSnapshot : {};
    const utilityBreakdown = Array.isArray(metadata?.utilityBreakdown) ? metadata.utilityBreakdown : [];
    const netAmount = Number(taxSnapshot?.netAmount ?? taxSnapshot?.enteredAmount ?? source?.amount ?? activeInvoice?.amount ?? 0);
    const taxAmount = Number(taxSnapshot?.taxAmount || 0);
    const grossAmount = Number(taxSnapshot?.grossAmount ?? source?.amount ?? activeInvoice?.amount ?? 0);
    const daysOverdue = getInvoiceDaysOverdue({
      dueDate: activeInvoice?.dueDateValue || source?.dueDate || null,
      outstandingAmount: activeInvoice?.outstandingAmount,
      status: activeInvoice?.status,
    });
    const settlementPercentage = grossAmount > 0
      ? Math.min(100, Math.max(0, (Number(activeInvoice?.appliedAmount || 0) / grossAmount) * 100))
      : 0;
    return {
      activeInvoiceSource: source,
      activeInvoiceMetadata: metadata,
      activeInvoiceTaxSnapshot: taxSnapshot,
      activeInvoiceUtilityBreakdown: utilityBreakdown,
      activeInvoiceNetAmount: netAmount,
      activeInvoiceTaxAmount: taxAmount,
      activeInvoiceGrossAmount: grossAmount,
      activeInvoiceDaysOverdue: daysOverdue,
      activeInvoiceSettlementPercentage: settlementPercentage,
    };
  }, [activeInvoice]);
  const activeInvoiceJournalLines = useMemo(
    () => (activeInvoice ? buildJournalEntriesForInvoice(activeInvoice) : []),
    [activeInvoice]
  );
  const activeInvoiceBreakdown = useMemo(() => {
    if (!activeInvoice) return [];

    const baseDescription =
      activeInvoice?.invoiceDescription ||
      deriveInvoiceDescription(activeInvoiceSource) ||
      `${activeInvoice?.chargeTypeLabel || getInvoiceChargeTypeLabel(activeInvoice?.chargeType)} charge`;

    if (activeInvoice?.chargeType === "combined" && activeInvoiceUtilityBreakdown.length > 0) {
      const utilityTotal = activeInvoiceUtilityBreakdown.reduce(
        (sum, item) => sum + Number(item?.amount || 0),
        0
      );
      const rentAmount = Math.max(0, activeInvoiceNetAmount - utilityTotal);

      return [
        ...(rentAmount > 0
          ? [
              {
                label: baseDescription,
                amount: rentAmount,
              },
            ]
          : []),
        ...activeInvoiceUtilityBreakdown.map((item) => ({
          label: `${item?.label || "Utility"}${item?.periodLabel ? ` (${item.periodLabel})` : ""}`,
          amount: Number(item?.amount || 0),
        })),
      ].filter((item) => Number(item?.amount || 0) > 0);
    }

    return [
      {
        label: baseDescription,
        amount: activeInvoiceNetAmount,
      },
    ];
  }, [activeInvoice, activeInvoiceSource, activeInvoiceUtilityBreakdown, activeInvoiceNetAmount]);

  const activeInvoiceReceiptApplications = useMemo(() => {
    const rows = Array.isArray(activeInvoice?.receiptApplications)
      ? activeInvoice.receiptApplications
      : Array.isArray(activeInvoiceSource?.receiptApplications)
      ? activeInvoiceSource.receiptApplications
      : [];

    return rows
      .filter((row) => Number(row?.appliedAmount || 0) > 0)
      .map((row, index) => ({
        key: `${row?.receiptId || row?.receiptNumber || "receipt"}-${index}`,
        receiptId: row?.receiptId || "",
        receiptNumber: row?.receiptNumber || row?.referenceNumber || "Receipt",
        receiptDate: row?.receiptDate || null,
        paymentType: row?.paymentType || "rent",
        chargeLabel: row?.chargeLabel || activeInvoice?.invoiceDescription || activeInvoice?.period || "Invoice application",
        appliedAmount: Number(row?.appliedAmount || 0),
        afterOutstanding: Number(row?.afterOutstanding || 0),
      }))
      .sort((a, b) => {
        const aTime = a?.receiptDate ? new Date(a.receiptDate).getTime() : 0;
        const bTime = b?.receiptDate ? new Date(b.receiptDate).getTime() : 0;
        return aTime - bTime;
      });
  }, [activeInvoice, activeInvoiceSource]);


  const canDeleteActiveInvoice =
    Boolean(activeInvoice?._id) &&
    canDeleteInvoice &&
    !["paid", "partially_paid"].includes(String(activeInvoice?.status || "").toLowerCase());

  const closeInvoiceDetail = () => {
    setInvoiceDetailOpen(false);
    setActiveInvoice(null);
  };

  useEffect(() => {
    if (!invoiceDetailOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeInvoiceDetail();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [invoiceDetailOpen]);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyHeight = document.body.style.height;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.height = previousBodyHeight;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, []);

  const applySearch = () => {
    setAppliedFilters({ ...draftFilters });
    setSelectedInvoices([]);
    setSelectAll(false);
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setSelectedInvoices([]);
    setSelectAll(false);
    setCurrentPage(1);
  };

  const fetchAllFilteredInvoiceRows = async (filters = appliedFilters) => {
    if (!currentCompany?._id) return [];

    const invoices = await getTenantInvoices({
      tenantId,
      business: currentCompany._id,
      includeSnapshots: true,
      ...buildInvoiceServerFilters({
        filters,
        propertiesFromStore,
        unitsFromStore,
        tenantId,
      }),
    });

    return buildInvoiceRows({
      invoices,
      tenantLookup,
      unitsFromStore,
      propertiesFromStore,
    }).filter((invoice) => !deletingInvoiceIds.includes(invoice._id));
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedInvoices((prev) => prev.filter((id) => !visibleInvoiceKeys.includes(id)));
      setSelectAll(false);
      return;
    }

    setSelectedInvoices((prev) => Array.from(new Set([...prev, ...visibleInvoiceKeys])));
    setSelectAll(true);
  };

  const toggleRowSelection = useCallback((rowKey) => {
    setSelectedInvoices((prev) => {
      const hasRow = prev.includes(rowKey);
      if (hasRow) return prev.filter((id) => id !== rowKey);
      return [...prev, rowKey];
    });
  }, []);

  useEffect(() => {
    if (currentPageInvoices.length === 0) {
      setSelectAll(false);
      return;
    }
    setSelectAll(visibleInvoiceKeys.every((key) => selectedInvoices.includes(key)));
  }, [selectedInvoices, currentPageInvoices, visibleInvoiceKeys]);

  const openHtmlDocument = (title, html) => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const printWindow = window.open(url, "_blank", "width=1100,height=850");
    if (!printWindow) {
      toast.error("Please allow popups to view or print invoices");
      window.URL.revokeObjectURL(url);
      return null;
    }

    setTimeout(() => window.URL.revokeObjectURL(url), 15000);

    try {
      printWindow.document.title = title;
    } catch {
      // ignore
    }

    return printWindow;
  };

  const buildInvoiceHtml = (invoice) => {
    const sourceInvoice = invoice?.originalInvoice || {};
    const taxSnapshot = sourceInvoice?.taxSnapshot || {};
    const chargeTypeLabel = invoice?.chargeTypeLabel || getInvoiceChargeTypeLabel(invoice?.chargeType);
    const utilityBreakdown = Array.isArray(sourceInvoice?.metadata?.utilityBreakdown)
      ? sourceInvoice.metadata.utilityBreakdown
      : [];
    const invoiceDateLabel = invoice?.invoiceDateLabel || formatDateDisplay(sourceInvoice?.invoiceDate);
    const dueDateLabel = invoice?.dueDateLabel || formatDateDisplay(sourceInvoice?.dueDate);
    const preparedLabel = formatDateTimeDisplay(new Date());
    const subtotal = Number(
      taxSnapshot?.netAmount ?? taxSnapshot?.enteredAmount ?? sourceInvoice?.amount ?? invoice?.amount ?? 0
    );
    const taxAmount = Number(taxSnapshot?.taxAmount || 0);
    const hasTaxClassification = Boolean(taxSnapshot?.isTaxable || (taxSnapshot?.taxCodeKey && taxSnapshot.taxCodeKey !== "no_tax"));
    const totalAmount = Number(
      taxSnapshot?.grossAmount ?? sourceInvoice?.amount ?? invoice?.amount ?? 0
    );

    const baseLineItems =
      invoice?.chargeType === "combined"
        ? [
            {
              description: sourceInvoice?.description || buildRecurringInvoiceDescription({ month: new Date(sourceInvoice?.invoiceDate || sourceInvoice?.createdAt || Date.now()).getMonth(), year: new Date(sourceInvoice?.invoiceDate || sourceInvoice?.createdAt || Date.now()).getFullYear(), label: "Rent" }),
              amount: Math.max(0, subtotal - utilityBreakdown.reduce((sum, item) => sum + Number(item?.amount || 0), 0)),
            },
            ...utilityBreakdown.map((item) => ({
              description: `${item?.label || "Utility"}${item?.periodLabel ? ` (${item.periodLabel})` : ""}`,
              amount: Number(item?.amount || 0),
            })),
          ].filter((item) => Number(item.amount || 0) > 0)
        : [
            {
              description: invoice?.invoiceDescription || deriveInvoiceDescription(sourceInvoice) || `${chargeTypeLabel} charge`,
              amount: subtotal,
            },
          ];

    const lineItems = baseLineItems.length > 0 ? baseLineItems : [{ description: invoice?.invoiceDescription || deriveInvoiceDescription(sourceInvoice) || `${chargeTypeLabel} charge`, amount: subtotal }];

    const lineRows = lineItems
      .map(
        (item, index) => `<tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.description)}</td>
          <td class="num">KES ${Number(item.amount || 0).toLocaleString()}</td>
        </tr>`
      )
      .join("\n");

    const preparedByName = [currentUser?.otherNames, currentUser?.surname].filter(Boolean).join(' ') || currentUser?.email || 'Milik Admin';

    const tenantCode = escapeHtml(sourceInvoice?.tenant?.tenantCode || '');
    const tenantEmail = escapeHtml(sourceInvoice?.tenant?.email || invoice?.tenantEmail || '');
    const statusRaw = String(invoice?.status || 'Issued').toLowerCase().replace(/\s+/g, '_');
    const statusColors = { paid:'#16a34a', partially_paid:'#d97706', issued:'#2563eb', cancelled:'#6b7280', reversed:'#dc2626' };
    const statusBg = { paid:'#dcfce7', partially_paid:'#fef3c7', issued:'#dbeafe', cancelled:'#f1f5f9', reversed:'#fee2e2' };
    const statusColor = statusColors[statusRaw] || '#475569';
    const statusBgColor = statusBg[statusRaw] || '#f1f5f9';
    const formatAmt = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice ${escapeHtml(invoice?.id || '')}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #0f172a; background: #fff; }
    .header { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; padding-bottom:16px; gap:16px; }
    .co-center { text-align:center; display:flex; flex-direction:column; align-items:center; gap:6px; }
    .logo-img { max-height:60px; max-width:150px; object-fit:contain; border-radius:6px; }
    .logo-fb { width:56px; height:56px; border-radius:10px; background:#0B3B2E; color:#fff; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:900; }
    .co-center-name { font-size:18px; font-weight:900; color:#0f172a; letter-spacing:-0.01em; margin-top:6px; }
    .co-center-sub { font-size:10px; color:#64748b; line-height:1.6; }
    .inv-title { text-align:right; align-self:center; }
    .inv-label { font-size:38px; font-weight:900; color:#0f172a; letter-spacing:-0.03em; line-height:1; }
    .inv-number { font-size:14px; color:#64748b; margin-top:6px; }
    .divider { height:2px; background:linear-gradient(90deg,#3b82f6,#93c5fd); border-radius:2px; margin:16px 0 20px; }
    .body-grid { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-bottom:20px; }
    .sec-label { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.18em; color:#94a3b8; margin-bottom:12px; }
    .fk { font-size:10px; color:#94a3b8; font-weight:600; text-transform:uppercase; letter-spacing:0.1em; margin-top:8px; }
    .fv { font-size:13px; font-weight:700; color:#0f172a; }
    .fv.lg { font-size:16px; font-weight:800; }
    .status-badge { display:inline-block; padding:4px 14px; border-radius:6px; font-size:11px; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:18px; }
    table { width:100%; border-collapse:collapse; margin-bottom:16px; }
    thead tr { background:#1e293b; }
    th { padding:10px 14px; text-align:left; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:#fff; }
    th.r { text-align:right; }
    tbody tr { border-bottom:1px solid #f1f5f9; }
    td { padding:11px 14px; font-size:13px; color:#0f172a; }
    td.r { text-align:right; font-weight:600; }
    .totals { width:280px; margin-left:auto; border-top:1px solid #e2e8f0; padding-top:10px; }
    .t-row { display:flex; justify-content:space-between; padding:7px 0; font-size:13px; border-bottom:1px solid #f8fafc; }
    .t-row .tl { color:#64748b; }
    .t-row .tv { font-weight:700; }
    .t-row.grand { border-top:2px solid #0f172a; border-bottom:none; padding-top:12px; margin-top:4px; }
    .t-row.grand .tl, .t-row.grand .tv { font-size:15px; font-weight:800; color:#0f172a; }
    .footer-note { margin-top:28px; padding-top:12px; border-top:1px solid #f1f5f9; font-size:11px; color:#94a3b8; }
    @media print {
      thead tr { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div></div>
    <div class="co-center">
      ${companyLogo ? `<img class="logo-img" src="${escapeHtml(companyLogo)}" alt="logo" />` : `<div class="logo-fb">${escapeHtml(companyDisplayName.slice(0,1).toUpperCase())}</div>`}
      <div class="co-center-name">${escapeHtml(companyDisplayName)}</div>
      ${[companyAddress, companyPhone, companyEmail].filter(Boolean).length ? `<div class="co-center-sub">${[companyAddress, companyPhone, companyEmail].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
    </div>
    <div class="inv-title">
      <div class="inv-label">INVOICE</div>
      <div class="inv-number"># ${escapeHtml(invoice?.id || '')}</div>
    </div>
  </div>

  <div class="divider"></div>

  <div class="body-grid">
    <div>
      <div class="sec-label">Billed To</div>
      <div class="fk">Tenant</div>
      <div class="fv lg">${escapeHtml(invoice?.tenantName || 'Tenant')}</div>
      ${tenantCode ? `<div class="fk">Tenant Code</div><div class="fv">${tenantCode}</div>` : ''}
      ${tenantEmail ? `<div class="fk">Email</div><div class="fv">${tenantEmail}</div>` : ''}
      <div class="fk">Property</div>
      <div class="fv">${escapeHtml(invoice?.propertyName || '-')}</div>
      <div class="fk">Unit</div>
      <div class="fv">${escapeHtml(invoice?.unitName || '-')}</div>
    </div>
    <div>
      <div class="sec-label">Invoice Details</div>
      <div class="fk">Invoice Date</div>
      <div class="fv">${escapeHtml(invoiceDateLabel)}</div>
      <div class="fk">Due Date</div>
      <div class="fv">${escapeHtml(dueDateLabel)}</div>
      <div class="fk">Category</div>
      <div class="fv">${escapeHtml(chargeTypeLabel)}</div>
      ${hasTaxClassification ? `<div class="fk">Tax Code</div><div class="fv">${escapeHtml(taxSnapshot?.taxCodeName || 'Tax')} (${Number(taxSnapshot?.taxRate || 0)}%)</div>` : ''}
    </div>
  </div>

  <span class="status-badge" style="background:${statusBgColor};color:${statusColor};">${escapeHtml(invoice?.status || 'Issued')}</span>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="r">Amount (KES)</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td class="r">${formatAmt(item.amount)}</td></tr>`).join('')}
      ${hasTaxClassification && taxAmount > 0 ? `<tr><td style="color:#64748b">Tax (${Number(taxSnapshot?.taxRate||0)}%)</td><td class="r" style="color:#64748b">${formatAmt(taxAmount)}</td></tr>` : ''}
    </tbody>
  </table>

  <div class="totals">
    ${hasTaxClassification ? `<div class="t-row"><span class="tl">Subtotal</span><span class="tv">KES ${formatAmt(subtotal)}</span></div>
    <div class="t-row"><span class="tl">Tax (${Number(taxSnapshot?.taxRate||0)}%)</span><span class="tv">KES ${formatAmt(taxAmount)}</span></div>` : ''}
    <div class="t-row grand"><span class="tl">Total Due</span><span class="tv">KES ${formatAmt(totalAmount)}</span></div>
  </div>

  <div class="footer-note">
    Please settle the amount due by ${escapeHtml(dueDateLabel)}. Late payments may attract a penalty charge.<br/>
    Generated by ${escapeHtml(companyDisplayName)} · Milik Property Management System · ${escapeHtml(preparedLabel)}
  </div>
</body>
</html>`;
  };

  const buildInvoiceListHtml = (rows) => {
    const total = rows.reduce((sum, inv) => sum + (Number(inv?.amount) || 0), 0);
    const tableRows = rows
      .map(
        (inv) => `<tr>
  <td>${escapeHtml(inv.id)}</td>
  <td>${escapeHtml(inv.tenantName)}</td>
  <td>${escapeHtml(inv.propertyName)}</td>
  <td>${escapeHtml(inv.unitName)}</td>
  <td>${escapeHtml(inv.invoiceDescription || inv.period)}</td>
  <td>${escapeHtml(inv.chargeTypeLabel || getInvoiceChargeTypeLabel(inv.chargeType))}</td>
  <td>${escapeHtml(inv.invoiceDateLabel || "-")}</td>
  <td>${escapeHtml(inv.dueDateLabel || "-")}</td>
  <td style="text-align:right;">KES ${Number(inv.amount || 0).toLocaleString()}</td>
  <td>${escapeHtml(inv.status)}</td>
</tr>`
      )
      .join("\n");

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>MILIK Rental Invoices List</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Inter, Arial, sans-serif; margin: 20px; color: #111827; }
    .header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; border-bottom:3px solid #0B3B2E; padding-bottom:14px; margin-bottom:14px; }
    .brand-wrap { display:flex; align-items:center; gap:14px; }
    .logo { width:74px; height:74px; border-radius:16px; background:#0B3B2E; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:30px; border:1px solid #cbd5e1; overflow:hidden; }
    .logo img { width:74px; height:74px; object-fit:cover; }
    h1 { margin: 0; color: #0B3B2E; font-size: 22px; }
    .company { margin-top:4px; color:#111827; font-size:13px; font-weight:700; }
    .meta { margin: 0; color: #4b5563; font-size: 12px; text-align:right; line-height:1.6; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #d1d5db; padding: 7px 9px; }
    th { background: #0B3B2E; color: white; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    tfoot td { font-weight: 700; background: #f0faf5; color: #0B3B2E; border-top: 2px solid #0B3B2E; }
    @media print {
      body { margin: 0; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tbody tr:nth-child(even) td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      tfoot td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand-wrap">
      <div class="logo">${companyLogo ? `<img src="${escapeHtml(companyLogo)}" alt="logo" />` : escapeHtml(companyDisplayName.slice(0, 1).toUpperCase())}</div>
      <div>
        <h1>Tenant Invoices Register</h1>
        <div class="company">${escapeHtml(companyDisplayName)}</div>
        ${companyPhone || companyEmail ? `<div style="font-size:11px; color:#64748b; margin-top:3px;">${[companyPhone, companyEmail].filter(Boolean).map(escapeHtml).join(" · ")}</div>` : ""}
      </div>
    </div>
    <div class="meta">Generated: ${escapeHtml(formatDateTimeDisplay(new Date()))}<br/>${rows.length} record${rows.length !== 1 ? "s" : ""} · Total: KES ${total.toLocaleString()}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Invoice #</th>
        <th>Tenant</th>
        <th>Property</th>
        <th>Unit</th>
        <th>Inv Desc</th>
        <th>Type</th>
        <th>Booking / Invoice Date</th>
        <th>Due Date</th>
        <th style="text-align:right;">Amount</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="8" style="font-weight:800;">Total</td>
        <td style="text-align:right; font-weight:800;">KES ${total.toLocaleString()}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;
  };

  const handleViewInvoice = useCallback((invoice) => {
    if (!invoice) return;
    setActiveInvoice(invoice);
    setInvoiceDetailOpen(true);
  }, []);

  const handlePrintInvoice = async (invoice) => {
    if (!canExportInvoice) { toast.warning("You do not have permission to print invoices"); return; }
    if (!invoice?._id) return;
    try {
      await downloadInvoicePdf(invoice._id, { preview: true, filename: `Invoice-${invoice.id || invoice._id}.pdf` });
    } catch {
      toast.error("Failed to open invoice PDF. Try downloading instead.");
    }
  };

  const handleDownloadInvoice = async (invoice) => {
    if (!canExportInvoice) { toast.warning("You do not have permission to download invoices"); return; }
    if (!invoice?._id) return;
    try {
      await downloadInvoicePdf(invoice._id, { preview: false, filename: `Invoice-${invoice.id || invoice._id}.pdf` });
      toast.success(`Downloaded Invoice ${invoice.id || invoice._id}`);
    } catch {
      toast.error("Failed to download invoice PDF.");
    }
  };

  const handlePrintList = async () => {
    if (!canExportInvoice) {
      toast.warning("You do not have permission to print invoice lists");
      return;
    }
    if (totalFilteredCount === 0) {
      toast.warn("No invoices to print");
      return;
    }

    try {
      const printableRows = await fetchAllFilteredInvoiceRows();
      if (printableRows.length === 0) {
        toast.warn("No invoices to print");
        return;
      }

      const printWindow = openHtmlDocument(
        "MILIK Rental Invoices List",
        buildInvoiceListHtml(printableRows)
      );
      if (!printWindow) return;

      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);
    } catch (error) {
      console.error("Failed to prepare invoice list for printing:", error);
      toast.error("Failed to prepare invoice list");
    }
  };

  const findRevenueAccountId = (type) => {
    const typeLower = String(type || "rent").toLowerCase();

    const exactCode =
      typeLower === "utility"
        ? invoiceRevenueAccounts.find((acc) => String(acc?.code || "") === "4102")
        : invoiceRevenueAccounts.find((acc) => String(acc?.code || "") === "4100");

    if (exactCode?._id) return exactCode._id;

    const byName =
      typeLower === "utility"
        ? invoiceRevenueAccounts.find((acc) =>
            String(acc?.name || "").toLowerCase().includes("utility")
          )
        : invoiceRevenueAccounts.find((acc) =>
            String(acc?.name || "").toLowerCase().includes("rent")
          );

    return byName?._id || null;
  };
  const buildInvoicePayloadForTenant = ({
    targetTenant,
    amount,
    paymentType,
    categoryOverride = null,
    month,
    year,
    dueDay = 5,
    description,
    metadata,
    taxSelection = null,
    bookingDateOverride = null,
    bookingGroupId = "",
    billingMode = "combined",
  }) => {
  const numericAmount = Number(amount || 0);

  if (!targetTenant?._id || !targetTenant?.unit || numericAmount <= 0) {
    throw new Error("Invalid invoice payload");
  }

  const revenueAccountId = findRevenueAccountId(paymentType);
  if (!revenueAccountId) {
    throw new Error(
      `No income Chart of Account found for ${paymentType}. Ensure account 4100 / 4102 exists.`
    );
  }

  const businessId =
    targetTenant?.business?._id ||
    targetTenant?.business ||
    currentCompany?._id ||
    currentUser?.company?._id ||
    currentUser?.company ||
    null;

  const unitId = targetTenant?.invoiceUnit?._id || targetTenant?.invoiceUnit || targetTenant?.unit?._id || targetTenant?.unit || null;

  const matchedUnit = unitsFromStore.find(
    (unit) => String(unit?._id || "") === String(unitId || "")
  );

  const propertyId =
    targetTenant?.property?._id ||
    targetTenant?.property ||
    matchedUnit?.property?._id ||
    matchedUnit?.property ||
    targetTenant?.unit?.property?._id ||
    targetTenant?.unit?.property ||
    null;

  const matchedProperty = propertiesFromStore.find(
    (property) => String(property?._id || "") === String(propertyId || "")
  );

  const landlordId =
    matchedProperty?.landlords?.[0]?.landlordId?._id ||
    matchedProperty?.landlords?.[0]?.landlordId ||
    matchedProperty?.landlords?.[0]?._id ||
    matchedProperty?.landlords?.[0] ||
    targetTenant?.landlord?._id ||
    targetTenant?.landlord ||
    null;

  const createdBy =
    currentUser?._id ||
    targetTenant?.createdBy?._id ||
    targetTenant?.createdBy ||
    null;

  if (!businessId) {
    throw new Error("Missing business context for invoice creation.");
  }

  if (!propertyId) {
    throw new Error("Missing property on selected tenant/unit.");
  }

  if (!landlordId) {
    throw new Error("Missing landlord on selected property's record.");
  }

  if (!unitId) {
    throw new Error("Missing unit on selected tenant.");
  }

  if (!createdBy) {
    throw new Error("Missing createdBy user context.");
  }

  const bookingPeriodContext =
    targetTenant?.bookingPeriodContext && typeof targetTenant.bookingPeriodContext === "object"
      ? targetTenant.bookingPeriodContext
      : null;

  const resolvedBillingPeriodDate =
    bookingPeriodContext?.fromDate ||
    targetTenant?.invoiceDateOverride ||
    getStartOfPeriod(month, year);
  const resolvedBookingDate =
    bookingDateOverride ||
    targetTenant?.bookingDateOverride ||
    bookingPeriodContext?.fromDate ||
    resolvedBillingPeriodDate;
  const resolvedDueDate =
    bookingPeriodContext?.dueDate ||
    getDueDateForPeriod(month, year, dueDay);

  const invoicePayload = {
    business: businessId,
    property: propertyId,
    landlord: landlordId,
    tenant: targetTenant._id,
    unit: unitId,
    category: categoryOverride || (paymentType === "utility" ? "UTILITY_CHARGE" : "RENT_CHARGE"),
    amount: numericAmount,
    description,
    invoiceDate: resolvedBillingPeriodDate,
    bookingDate: resolvedBookingDate,
    dueDate: resolvedDueDate,
    createdBy,
    chartAccountId: revenueAccountId,
    metadata: buildBookingMetadata({
      metadata:
        metadata && typeof metadata === "object"
          ? {
              ...metadata,
              ...(bookingPeriodContext?.periodKey
                ? {
                    periodKey: bookingPeriodContext.periodKey,
                    billingPeriodKey: bookingPeriodContext.billingPeriodKey,
                    billingPeriodLabel: bookingPeriodContext.billingPeriodLabel,
                    periodStartDate: bookingPeriodContext.fromDate,
                    periodEndDate: bookingPeriodContext.toDate,
                  }
                : {}),
              ...(bookingDateOverride ? { bookWithBookingDate: true } : {}),
            }
          : bookingDateOverride || bookingPeriodContext?.periodKey
          ? {
              ...(bookingDateOverride ? { bookWithBookingDate: true } : {}),
              ...(bookingPeriodContext?.periodKey
                ? {
                    periodKey: bookingPeriodContext.periodKey,
                    billingPeriodKey: bookingPeriodContext.billingPeriodKey,
                    billingPeriodLabel: bookingPeriodContext.billingPeriodLabel,
                    periodStartDate: bookingPeriodContext.fromDate,
                    periodEndDate: bookingPeriodContext.toDate,
                  }
                : {}),
            }
          : undefined,
      bookingGroupId,
      billingMode,
    }),
    ...resolveTaxSelectionPayload(taxSelection, normalizedTaxConfig),
  };

  return invoicePayload;
};

  const createBackendInvoiceEntry = async ({
    targetTenant,
    amount,
    paymentType,
    categoryOverride,
    month,
    year,
    dueDay,
    description,
    metadata,
    taxSelection,
    bookingDateOverride = null,
    bookingGroupId = "",
    billingMode = "combined",
  }) => {
  const invoicePayload = buildInvoicePayloadForTenant({
    targetTenant,
    amount,
    paymentType,
    categoryOverride,
    month,
    year,
    dueDay,
    description,
    metadata,
    taxSelection,
    bookingDateOverride,
    bookingGroupId,
    billingMode,
  });


  return await createTenantInvoice(invoicePayload);
};

  

const createInvoiceForTenant = async (
  targetTenant,
  month,
  year,
  dueDay = 5,
  billingMode = "combined",
  taxSelection = null,
  bookingDateOverride = null,
  bookingGroupId = ""
) => {
  if (!targetTenant?._id) {
    return { created: false, reason: "Invalid tenant" };
  }

  const normalizedBillingMode = normalizeBillingMode(billingMode);
  const effectiveBookingGroupId = bookingGroupId || createBookingGroupId();
  const periodLabel = formatPeriodLabel(month, year);
  const pricing = getTenantPricing(targetTenant);
  const unitContexts = pricing.unitContexts || [];
  const createdInvoiceIds = [];
  let encounteredBlockingInvoice = false;
  let encounteredOutOfCyclePeriod = false;

  if (!unitContexts.length) {
    return { created: false, reason: "No assigned unit was found for this tenant" };
  }

  for (const unitContext of unitContexts) {
    const bookingPeriodContext = resolveTenantBookingPeriod({
      tenant: targetTenant,
      unitContext,
      month,
      year,
    });

    if (!bookingPeriodContext?.allowed) {
      encounteredOutOfCyclePeriod = true;
      continue;
    }

    const bookingAmounts = resolveBookingAmountsForMode({
      rentAmount: bookingPeriodContext.rentAmount,
      utilityAmount: bookingPeriodContext.utilityAmount,
      billingMode: normalizedBillingMode,
    });
    const rentAmount = Number(bookingAmounts.rentAmount || 0);
    const utilityAmount = Number(bookingAmounts.utilityAmount || 0);
    const utilityLabel = Array.isArray(bookingPeriodContext?.utilityNames) && bookingPeriodContext.utilityNames.length === 1
      ? bookingPeriodContext.utilityNames[0]
      : unitContext.utilityLabel;
    const utilityMetadata = buildUtilityInvoiceMetadata(utilityLabel);
    const targetTenantForUnit = {
      ...targetTenant,
      invoiceUnit: unitContext.unit,
      bookingDateOverride: bookingDateOverride || bookingPeriodContext.fromDate || getStartOfPeriod(month, year),
      invoiceDateOverride: bookingPeriodContext.fromDate || getStartOfPeriod(month, year),
      bookingPeriodContext: {
        periodKey: bookingPeriodContext.periodKey,
        billingPeriodKey: bookingPeriodContext.billingPeriod.key,
        billingPeriodLabel: bookingPeriodContext.billingPeriod.name,
        fromDate: bookingPeriodContext.fromDate,
        toDate: bookingPeriodContext.toDate,
        dueDate: bookingPeriodContext.dueDate,
      },
    };

    if (rentAmount <= 0 && utilityAmount <= 0) {
      continue;
    }

    const billableRows = unitContext.billableUtilityRows || [];
    const rentDesc = buildRecurringInvoiceDescription({ month, year, label: `Rent - ${unitContext.unitName}` });
    const sharedArgs = { targetTenant: targetTenantForUnit, month, year, dueDay, taxSelection, bookingDateOverride, bookingGroupId: effectiveBookingGroupId, billingMode: normalizedBillingMode };

    if (normalizedBillingMode === "combined" && rentAmount > 0 && utilityAmount > 0) {
      const combinedBlocked = hasBlockingInvoiceForRequest({
        invoices: tenantInvoicesFromApi, tenantId: targetTenant._id, unitId: unitContext.unitId,
        month, year, category: "RENT_CHARGE", periodKey: bookingPeriodContext.periodKey,
      });
      if (combinedBlocked) { encounteredBlockingInvoice = true; continue; }
      const created = await createBackendInvoiceEntry({
        ...sharedArgs, amount: rentAmount + utilityAmount, paymentType: "rent",
        description: rentDesc, metadata: buildCombinedInvoiceMetadata(billableRows, utilityAmount, utilityLabel),
      });
      createdInvoiceIds.push(created?.invoiceNumber || "AUTO");
      continue;
    }

    const rentBlocked = rentAmount > 0 && hasBlockingInvoiceForRequest({
      invoices: tenantInvoicesFromApi, tenantId: targetTenant._id, unitId: unitContext.unitId,
      month, year, category: "RENT_CHARGE", periodKey: bookingPeriodContext.periodKey,
    });

    if (billableRows.length > 1) {
      if (rentBlocked) encounteredBlockingInvoice = true;
      for (const row of buildScaledBreakdown(billableRows, utilityAmount)) {
        const rowMeta = buildUtilityInvoiceMetadata(row.label);
        const rowBlocked = hasBlockingInvoiceForRequest({
          invoices: tenantInvoicesFromApi, tenantId: targetTenant._id, unitId: unitContext.unitId,
          month, year, category: "UTILITY_CHARGE", metadata: rowMeta, periodKey: bookingPeriodContext.periodKey,
        });
        if (rowBlocked) { encounteredBlockingInvoice = true; continue; }
        const inv = await createBackendInvoiceEntry({
          ...sharedArgs, amount: row.amount, paymentType: "utility",
          description: buildUtilityChargeDescription({ utilityLabel: row.label, month, year }),
          metadata: rowMeta,
        });
        createdInvoiceIds.push(inv?.invoiceNumber || "AUTO");
      }
    } else {
      const utilityBlocked = utilityAmount > 0 && hasBlockingInvoiceForRequest({
        invoices: tenantInvoicesFromApi, tenantId: targetTenant._id, unitId: unitContext.unitId,
        month, year, category: "UTILITY_CHARGE", metadata: utilityMetadata, periodKey: bookingPeriodContext.periodKey,
      });
      if (rentBlocked || utilityBlocked) encounteredBlockingInvoice = true;
      if (utilityAmount > 0 && !utilityBlocked) {
        const inv = await createBackendInvoiceEntry({
          ...sharedArgs, amount: utilityAmount, paymentType: "utility",
          description: buildUtilityChargeDescription({ utilityLabel: utilityLabel || "Utility", month, year }),
          metadata: utilityMetadata,
        });
        createdInvoiceIds.push(inv?.invoiceNumber || "AUTO");
      }
    }

    if (rentAmount > 0 && !rentBlocked) {
      const inv = await createBackendInvoiceEntry({
        ...sharedArgs, amount: rentAmount, paymentType: "rent", description: rentDesc,
      });
      createdInvoiceIds.push(inv?.invoiceNumber || "AUTO");
    }
  }

  if (createdInvoiceIds.length === 0 && encounteredBlockingInvoice) {
    return { created: false, reason: "already_exists", periodLabel };
  }

  if (createdInvoiceIds.length === 0 && encounteredOutOfCyclePeriod) {
    return { created: false, reason: "Selected period is not a scheduled billing start for this tenant." };
  }

  return { created: createdInvoiceIds.length > 0, invoiceIds: createdInvoiceIds, periodLabel, ledgerSynced: true };
};

  const handleBookingActionChange = (value) => {
    if (!canCreateInvoice) {
      toast.warning("You do not have permission to create invoices");
      return;
    }
    setBookingAction(value);

    if (value === "single") {
      setShowSingleBooking(true);
      if (tenantId) {
        setSingleBookingForm((prev) => ({ ...prev, tenantId }));
      }
    }

    if (value === "batch") {
      setShowBatchBooking(true);
    }
  };
  const handleSingleBooking = async () => {
    if (submittingSingleBooking) return;

    const selectedTenant = tenantLookup[singleBookingForm.tenantId];

    if (!selectedTenant) {
      toast.error("Please select a tenant");
      return;
    }

    if (isFutureBillingPeriod(singleBookingForm.month, singleBookingForm.year)) {
      toast.error("Future invoicing is disabled. Select the current month or an earlier clean period.");
      return;
    }

    const pricing = getTenantPricingForBookingPeriod(selectedTenant, Number(singleBookingForm.month), Number(singleBookingForm.year));
    const selectedAmounts = resolveBookingAmountsForMode({
      rentAmount: pricing.rentAmount,
      utilityAmount: pricing.utilityAmount,
      billingMode: singleBookingForm.billingMode,
    });
    if (selectedAmounts.totalAmount <= 0) {
      toast.error(`Selected tenant has no billable ${getBillingModeLabel(singleBookingForm.billingMode).toLowerCase()} amount`);
      return;
    }

    const bookingGroupId = createBookingGroupId();
    setSubmittingSingleBooking(true);
    try {
      const result = await createInvoiceForTenant(
        selectedTenant,
        Number(singleBookingForm.month),
        Number(singleBookingForm.year),
        Number(singleBookingForm.dueDay || 5),
        singleBookingForm.billingMode,
        getBookingTaxSelection(singleBookingForm),
        resolveBookingDateOverride(singleBookingForm),
        bookingGroupId
      );

      if (!result.created && result.reason === "already_exists") {
        toast.info(`Invoice for ${result.periodLabel} already exists for this tenant`);
        return;
      }

      if (!result.created) {
        toast.error(result.reason || "Failed to create booking");
        return;
      }

      toast.success(
        `Booked ${result.invoiceIds.join(", ")} for ${getTenantDisplayName(selectedTenant)}`
      );

      setShowSingleBooking(false);
      setBookingAction("");
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
    } catch (error) {
      console.error("Single booking failed:", error);
      toast.error(
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to create invoice"
      );
    } finally {
      setSubmittingSingleBooking(false);
    }
  };

  const handleBatchBooking = async () => {
    if (submittingBatchBooking) return;

    const selectedPropertyId = batchBookingForm.propertyId;
    const month = Number(batchBookingForm.month);
    const year = Number(batchBookingForm.year);
    const dueDay = Number(batchBookingForm.dueDay || 5);
    const selectedTaxSelection = getBookingTaxSelection(batchBookingForm);
    const batchBookingDateOverride = resolveBookingDateOverride(batchBookingForm);
    const normalizedBatchBillingMode = normalizeBillingMode(batchBookingForm.billingMode);
    const batchBookingGroupId = createBookingGroupId();

    if (isFutureBillingPeriod(month, year)) {
      toast.error("Future invoicing is disabled. Select the current month or an earlier clean period.");
      return;
    }

    const eligibleTenants = tenantsFromStore.filter((tenant) => {
      const tenantStatus = String(tenant?.status || "active").toLowerCase();
      if (tenantStatus !== "active") return false;

      const tenantPropertyId = getTenantPropertyId(tenant);
      if (!tenantPropertyId) return false;

      if (selectedPropertyId === "all") {
        return activeProperties.some(
          (property) => String(property?._id) === String(tenantPropertyId)
        );
      }

      return String(tenantPropertyId) === String(selectedPropertyId);
    });

    if (eligibleTenants.length === 0) {
      toast.warn("No active tenants found for the selected scope");
      return;
    }

    let createdCount = 0;
    let skippedCount = 0;
    const batchItems = [];
    const tenantsToProcess = [];

    const finalizeBatchRefresh = () => {
      setShowBatchBooking(false);
      setBookingAction("");
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
    };

    const runLegacySequentialBatch = async (initialErrorMessage = "") => {
      let fallbackCreatedCount = 0;
      let fallbackSkippedCount = skippedCount;
      let fallbackErrorMessage = initialErrorMessage;

      for (const tenant of tenantsToProcess) {
        try {
          const result = await createInvoiceForTenant(
            tenant,
            month,
            year,
            dueDay,
            normalizedBatchBillingMode,
            selectedTaxSelection,
            batchBookingDateOverride,
            batchBookingGroupId
          );

          if (result?.created) {
            fallbackCreatedCount += 1;
          } else if (result?.reason === "already_exists") {
            fallbackSkippedCount += 1;
          } else if (!fallbackErrorMessage && result?.reason) {
            fallbackErrorMessage = result.reason;
          }
        } catch (fallbackError) {
          if (!fallbackErrorMessage) {
            fallbackErrorMessage =
              fallbackError?.response?.data?.error ||
              fallbackError?.response?.data?.message ||
              fallbackError?.message ||
              "Batch booking failed";
          }
        }
      }

      if (fallbackCreatedCount > 0) {
        toast.success(
          `Batch booking complete: ${fallbackCreatedCount} created${
            fallbackSkippedCount > 0 ? `, ${fallbackSkippedCount} skipped` : ""
          }`
        );
        finalizeBatchRefresh();
        return true;
      }

      if (fallbackSkippedCount > 0 && !fallbackErrorMessage) {
        toast.info(`No new invoices created. ${fallbackSkippedCount} already existed.`);
        return true;
      }

      return fallbackErrorMessage || "Batch booking failed";
    };

    setSubmittingBatchBooking(true);

    try {
      for (const tenant of eligibleTenants) {
        const pricing = getTenantPricing(tenant);
        const unitContexts = pricing.unitContexts || [];

        if (!unitContexts.length) {
          continue;
        }

        let tenantHasBatchItems = false;

        for (const unitContext of unitContexts) {
          const bookingPeriodContext = resolveTenantBookingPeriod({
            tenant,
            unitContext,
            month,
            year,
          });

          if (!bookingPeriodContext?.allowed) {
            continue;
          }

          const bookingAmounts = resolveBookingAmountsForMode({
            rentAmount: bookingPeriodContext.rentAmount,
            utilityAmount: bookingPeriodContext.utilityAmount,
            billingMode: normalizedBatchBillingMode,
          });
          const rentAmount = Number(bookingAmounts.rentAmount || 0);
          const utilityAmount = Number(bookingAmounts.utilityAmount || 0);
          const utilityLabel = Array.isArray(bookingPeriodContext?.utilityNames) && bookingPeriodContext.utilityNames.length === 1
            ? bookingPeriodContext.utilityNames[0]
            : unitContext.utilityLabel;
          const utilityMetadata = buildUtilityInvoiceMetadata(utilityLabel);
          const targetTenantForUnit = {
            ...tenant,
            invoiceUnit: unitContext.unit,
            bookingDateOverride: batchBookingDateOverride || bookingPeriodContext.fromDate || getStartOfPeriod(month, year),
            invoiceDateOverride: bookingPeriodContext.fromDate || getStartOfPeriod(month, year),
            bookingPeriodContext: {
              periodKey: bookingPeriodContext.periodKey,
              billingPeriodKey: bookingPeriodContext.billingPeriod.key,
              billingPeriodLabel: bookingPeriodContext.billingPeriod.name,
              fromDate: bookingPeriodContext.fromDate,
              toDate: bookingPeriodContext.toDate,
              dueDate: bookingPeriodContext.dueDate,
            },
          };

          if (rentAmount <= 0 && utilityAmount <= 0) {
            continue;
          }

          const billableRows = unitContext.billableUtilityRows || [];
          const rentDesc = buildRecurringInvoiceDescription({ month, year, label: `Rent - ${unitContext.unitName}` });
          const batchArgs = { targetTenant: targetTenantForUnit, month, year, dueDay, taxSelection: selectedTaxSelection, bookingDateOverride: batchBookingDateOverride, bookingGroupId: batchBookingGroupId, billingMode: normalizedBatchBillingMode };

          if (normalizedBatchBillingMode === "combined" && rentAmount > 0 && utilityAmount > 0) {
            const combinedBlocked = hasBlockingInvoiceForRequest({
              invoices: tenantInvoicesFromApi, tenantId: tenant._id, unitId: unitContext.unitId,
              month, year, category: "RENT_CHARGE", periodKey: bookingPeriodContext.periodKey,
            });
            if (!combinedBlocked) {
              batchItems.push(buildInvoicePayloadForTenant({
                ...batchArgs, amount: rentAmount + utilityAmount, paymentType: "rent",
                description: rentDesc, metadata: buildCombinedInvoiceMetadata(billableRows, utilityAmount, utilityLabel),
              }));
              tenantHasBatchItems = true;
            }
            continue;
          }

          const shouldCreateRent = rentAmount > 0 && !hasBlockingInvoiceForRequest({
            invoices: tenantInvoicesFromApi, tenantId: tenant._id, unitId: unitContext.unitId,
            month, year, category: "RENT_CHARGE", periodKey: bookingPeriodContext.periodKey,
          });

          if (shouldCreateRent) {
            batchItems.push(buildInvoicePayloadForTenant({ ...batchArgs, amount: rentAmount, paymentType: "rent", description: rentDesc }));
            tenantHasBatchItems = true;
          }

          if (utilityAmount > 0 && billableRows.length > 1) {
            for (const row of buildScaledBreakdown(billableRows, utilityAmount)) {
              const rowMeta = buildUtilityInvoiceMetadata(row.label);
              const rowBlocked = hasBlockingInvoiceForRequest({
                invoices: tenantInvoicesFromApi, tenantId: tenant._id, unitId: unitContext.unitId,
                month, year, category: "UTILITY_CHARGE", metadata: rowMeta, periodKey: bookingPeriodContext.periodKey,
              });
              if (rowBlocked) continue;
              batchItems.push(buildInvoicePayloadForTenant({
                ...batchArgs, amount: row.amount, paymentType: "utility",
                description: buildUtilityChargeDescription({ utilityLabel: row.label, month, year }),
                metadata: rowMeta,
              }));
              tenantHasBatchItems = true;
            }
          } else if (utilityAmount > 0) {
            const shouldCreateUtility = !hasBlockingInvoiceForRequest({
              invoices: tenantInvoicesFromApi, tenantId: tenant._id, unitId: unitContext.unitId,
              month, year, category: "UTILITY_CHARGE", metadata: utilityMetadata, periodKey: bookingPeriodContext.periodKey,
            });
            if (shouldCreateUtility) {
              batchItems.push(buildInvoicePayloadForTenant({
                ...batchArgs, amount: utilityAmount, paymentType: "utility",
                description: buildUtilityChargeDescription({ utilityLabel: utilityLabel || "Utility", month, year }),
                metadata: utilityMetadata,
              }));
              tenantHasBatchItems = true;
            }
          }
        }

        if (!tenantHasBatchItems) {
          skippedCount += 1;
          continue;
        }

        tenantsToProcess.push(tenant);
      }

      if (batchItems.length === 0 && skippedCount > 0) {
        toast.info(`No new invoices created. ${skippedCount} already existed.`);
        return;
      }

      if (batchItems.length === 0) {
        toast.warn("No billable rent or utility entries found for the selected tenants.");
        return;
      }

      const BATCH_CHUNK_SIZE = 500;
      const batchBusinessId =
        batchItems[0]?.business ||
        currentCompany?._id ||
        currentUser?.company?._id ||
        currentUser?.company;

      const chunks = [];
      for (let start = 0; start < batchItems.length; start += BATCH_CHUNK_SIZE) {
        chunks.push(batchItems.slice(start, start + BATCH_CHUNK_SIZE));
      }

      const chunkResponses = await Promise.all(
        chunks.map((chunk) => createTenantInvoicesBatch({ business: batchBusinessId, items: chunk }))
      );
      const allBatchResults = chunkResponses.flatMap((r) => (Array.isArray(r?.results) ? r.results : []));

      const successfulRows = allBatchResults.filter((row) => row?.success);
      const failedRows = allBatchResults.filter((row) => !row?.success);

      createdCount = new Set(successfulRows.map((row) => String(row?.tenant || "")).filter(Boolean)).size;
      const failedCount = new Set(failedRows.map((row) => String(row?.tenant || "")).filter(Boolean)).size;

      if (createdCount === 0 && failedRows.length > 0) {
        const primaryError =
          failedRows.find((row) => String(row?.error || "").trim())?.error ||
          "Batch booking failed";

        const fallbackOutcome = await runLegacySequentialBatch(primaryError);
        if (fallbackOutcome === true) {
          return;
        }

        const previewErrors = failedRows
          .slice(0, 3)
          .map((row) => row?.error)
          .filter(Boolean)
          .join(" | ");

        toast.error(previewErrors || fallbackOutcome || primaryError);
        return;
      }

      if (createdCount === 0 && skippedCount > 0) {
        toast.info(`No new invoices created. ${skippedCount} already existed.`);
        return;
      }

      toast.success(
        `Batch booking complete: ${createdCount} created${
          skippedCount > 0 ? `, ${skippedCount} skipped` : ""
        }${failedCount > 0 ? `, ${failedCount} with errors` : ""}`
      );

      if (failedRows.length > 0) {
        const previewErrors = failedRows
          .slice(0, 2)
          .map((row) => row?.error)
          .filter(Boolean)
          .join(" | ");

        if (previewErrors) {
          toast.warn(previewErrors);
        }
      }

      finalizeBatchRefresh();
    } catch (error) {
      const batchData = error?.response?.data;

      if (Array.isArray(batchData?.results) && batchData.results.length > 0) {
        const failedRows = batchData.results.filter((row) => !row?.success);
        const primaryError =
          failedRows.find((row) => String(row?.error || "").trim())?.error ||
          batchData?.message ||
          batchData?.error ||
          "Batch booking failed";

        const fallbackOutcome = await runLegacySequentialBatch(primaryError);
        if (fallbackOutcome === true) {
          return;
        }

        const previewErrors = failedRows
          .slice(0, 3)
          .map((row) => row?.error)
          .filter(Boolean)
          .join(" | ");

        toast.error(previewErrors || fallbackOutcome || primaryError);
        return;
      }

      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error?.message ||
          "Batch booking failed"
      );
    } finally {
      setSubmittingBatchBooking(false);
    }
  };

  const handleEditSelected = () => {
    if (!canUpdateInvoice) {
      toast.warning("You do not have permission to edit invoices");
      return;
    }
    if (!canEdit) {
      toast.warn("Select exactly one invoice to edit");
      return;
    }

    const selectedInvoice = filteredInvoices.find((inv) => inv.key === selectedInvoices[0]);
    if (!selectedInvoice) return;

    navigate(`/tenant/${selectedInvoice.tenantId}/statement`);
    toast.info(`Open tenant statement to review ${selectedInvoice.id}`);
  };

  const handleDeleteSelected = async () => {
    if (!canDeleteInvoice) {
      toast.warning("You do not have permission to delete invoices");
      return;
    }
    if (selectedInvoices.length === 0) {
      toast.warn("Select at least one invoice to delete");
      return;
    }

    const selectedRows = filteredInvoices.filter((inv) => selectedInvoices.includes(inv.key));
    const undeletable = selectedRows.filter((invoice) =>
      ["paid", "partially_paid"].includes(String(invoice.status || "").toLowerCase())
    );

    if (undeletable.length > 0) {
      toast.warn("Paid invoices cannot be deleted from this screen.");
      return;
    }

    const idsToDelete = selectedRows.filter((inv) => inv?._id).map((inv) => inv._id);
    setDeletingInvoiceIds(idsToDelete);

    try {
      await Promise.all(idsToDelete.map((id) => deleteTenantInvoice(id)));
      toast.success(`${idsToDelete.length} invoice(s) deleted successfully`);
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
      setSelectedInvoices([]);
      setSelectAll(false);
      setDeletingInvoiceIds([]);
    } catch (error) {
      setDeletingInvoiceIds([]);
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error.message ||
          "Failed to delete selected invoices"
      );
    }
  };

  const handleDeleteSingle = async (invoice) => {
    if (!canDeleteInvoice) {
      toast.warning("You do not have permission to delete invoices");
      return;
    }
    if (["paid", "partially_paid"].includes(String(invoice?.status || "").toLowerCase())) {
      toast.warn("Paid invoices cannot be deleted from this screen.");
      return;
    }

    if (!invoice?._id) {
      toast.error("Invoice id is missing.");
      return;
    }

    setDeletingInvoiceIds((prev) => [...prev, invoice._id]);

    try {
      await deleteTenantInvoice(invoice._id);
      window.dispatchEvent(new Event("invoicesUpdated"));
      setRefreshTick((prev) => prev + 1);
      if (String(activeInvoice?._id || "") === String(invoice?._id || "")) {
        closeInvoiceDetail();
      }
      toast.success(`Invoice ${invoice.id} deleted successfully`);
    } catch (error) {
      toast.error(
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          error.message ||
          `Failed to delete invoice ${invoice.id}`
      );
    } finally {
      setDeletingInvoiceIds((prev) => prev.filter((id) => String(id) !== String(invoice._id)));
    }
  };

  const handleViewTenantStatement = useCallback((targetTenantId) => {
    navigate(`/tenant/${targetTenantId}/statement`);
  }, [navigate]);

  return (
    <DashboardLayout lockContentScroll>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 p-1 sm:p-2">
        <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex-none sticky top-0 z-30 border-b border-gray-200 bg-white shadow-sm">
              <div className="filter-bar flex items-center gap-0.5 overflow-x-auto px-2 py-1">
                {fromLedger && (
                  <button onClick={() => navigate(`/properties/${location.state.propertyId}/ledger`)} className="h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-[#0B3B2E] hover:bg-[#EDF5F1]">
                    <FaArrowLeft size={7} /> {location.state.propertyName} Ledger
                  </button>
                )}
                {!fromLedger && tenantId && (
                  <button onClick={() => navigate("/tenants")} className="h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] font-semibold text-gray-600 hover:text-gray-900">
                    <FaArrowLeft size={7} /> Back
                  </button>
                )}
                <span className="shrink-0 border border-blue-200 bg-blue-50 px-1 py-0.5 text-[8px] font-bold text-blue-700">Invoices: {invoiceListPagination.totalItems || 0}</span>
                <span className="shrink-0 border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[8px] font-bold text-emerald-700">Total: {formatCurrency(invoicePageSummary.pageTotalAmount || 0)}</span>
                <span className="shrink-0 border border-amber-200 bg-amber-50 px-1 py-0.5 text-[8px] font-bold text-amber-700">Pend: {formatCurrency(invoicePageSummary.pagePendingAmount || 0)}</span>
                <div className="mx-0.5 h-3 w-px shrink-0 bg-slate-200" />
                <AppSelect
                  value={draftFilters.status}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, status: v ?? "ACTIVE" }))}
                  options={[{ value: "ACTIVE", label: "All" }, { value: "Issued", label: "Issued" }, { value: "Paid", label: "Paid" }]}
                  compact
                />
                <div className="mx-0.5 h-3 w-px shrink-0 bg-slate-200" />
                <input type="text" value={draftFilters.invoiceNo} onChange={(e) => setDraftFilters((prev) => ({ ...prev, invoiceNo: normalizeUppercaseInput(e.target.value) }))} placeholder="Invoice #" className="h-[20px] w-20 shrink-0 border border-gray-300 px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                {!tenantId && <input type="text" value={draftFilters.tenantName} onChange={setFilter("tenantName")} placeholder="Tenant" className="h-[20px] w-20 shrink-0 border border-gray-300 px-1.5 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />}
                <AppSelect
                  value={draftFilters.property === "any" ? "" : draftFilters.property}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, property: v ?? "any", unit: "any" }))}
                  options={uniqueProperties.filter((p) => p !== "any").map((p) => ({ value: p, label: p }))}
                  placeholder="Property"
                  searchable
                  clearable
                  compact
                />
                <AppSelect
                  value={draftFilters.unit === "any" ? "" : draftFilters.unit}
                  onChange={(v) => setDraftFilters((prev) => ({ ...prev, unit: v ?? "any" }))}
                  options={unitsForSelectedProperty.filter((u) => u !== "any").map((u) => ({ value: u, label: u }))}
                  placeholder="Unit"
                  searchable
                  clearable
                  compact
                />
                <input type="date" value={draftFilters.fromDate} onChange={setFilter("fromDate")} className="h-[20px] w-[5.5rem] shrink-0 border border-slate-200 bg-white px-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <input type="date" value={draftFilters.toDate} onChange={setFilter("toDate")} className="h-[20px] w-[5.5rem] shrink-0 border border-slate-200 bg-white px-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]" />
                <div className="mx-0.5 h-3 w-px shrink-0 bg-slate-200" />
                <button onClick={applySearch} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white ${MILIK_ORANGE} ${MILIK_ORANGE_HOVER}`}><FaSearch size={7} /> Search</button>
                <button onClick={resetFilters} className={`h-[20px] shrink-0 flex items-center gap-0.5 px-1.5 text-[9px] text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}><FaRedoAlt size={7} /> Reset</button>
                <div className="mx-0.5 h-3 w-px shrink-0 bg-slate-200" />
                {canUpdateInvoice && (
                  <button onClick={handleEditSelected} disabled={!canEdit} className={actionBtnCls(canEdit, `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`)}><FaEdit size={7} /> Edit</button>
                )}
                {canDeleteInvoice && (
                  <button onClick={handleDeleteSelected} disabled={selectedCount === 0} className={actionBtnCls(selectedCount > 0, "bg-red-600 hover:bg-red-700")}><FaTrash size={7} /> Delete</button>
                )}
                {canExportInvoice && (
                  <button onClick={handlePrintList} disabled={totalFilteredCount === 0} className={actionBtnCls(totalFilteredCount > 0, `${MILIK_GREEN} ${MILIK_GREEN_HOVER}`)}><FaPrint size={7} /> Print</button>
                )}
                <button onClick={() => setShowSmsModal(true)} disabled={selectedCount === 0} title={selectedCount === 0 ? "Select invoices to SMS" : `SMS ${selectedCount} invoice${selectedCount !== 1 ? "s" : ""}`} className={actionBtnCls(selectedCount > 0, "bg-emerald-600 hover:bg-emerald-700")}><FaSms size={7} /> SMS</button>
                <button onClick={() => setShowEmailModal(true)} disabled={selectedCount === 0} title={selectedCount === 0 ? "Select invoices to email" : `Email ${selectedCount} invoice${selectedCount !== 1 ? "s" : ""}`} className={actionBtnCls(selectedCount > 0, "bg-blue-600 hover:bg-blue-700")}><FaEnvelope size={7} /> Email</button>
                <div className="mx-0.5 h-3 w-px shrink-0 bg-slate-200" />
                {canCreateInvoice && (
                  <button type="button" onClick={() => navigate("/tenants/deposits")} className={`h-[20px] shrink-0 px-1.5 text-[9px] font-semibold text-white ${MILIK_GREEN} ${MILIK_GREEN_HOVER}`}>Deposit</button>
                )}
                {canCreateInvoice && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <FaPlus className="text-[10px] text-[#0B3B2E]" />
                    <AppSelect
                      value={bookingAction}
                      onChange={(v) => handleBookingActionChange(v ?? "")}
                      options={[{ value: "single", label: "Single Booking" }, { value: "batch", label: "Batch Booking" }]}
                      placeholder="Booking"
                      compact
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
              <table className="w-full min-w-[1200px] text-[11px] border-collapse">
                <thead className="sticky top-0 z-10 shadow-sm">
                  <tr className={`${MILIK_GREEN} text-white`}>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">
                      <input type="checkbox" checked={currentPageInvoices.length > 0 && selectAll} onChange={toggleSelectAll} />
                    </th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Invoice #</th>
                    {!tenantId && <th className="px-3 py-1 text-left font-bold border-r border-white/10">Tenant</th>}
                    {!tenantId && <th className="px-3 py-1 text-left font-bold border-r border-white/10">Property</th>}
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Unit</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Description</th>
                    <th className="px-3 py-1 text-left font-bold border-r border-white/10">Type</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Booking / Invoice Date</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Due Date</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Amount</th>
                    <th className="px-3 py-1 text-right font-bold border-r border-white/10">Paid</th>
                    <th className="px-3 py-1 text-center font-bold border-r border-white/10">Status</th>
                    <th className="px-3 py-1 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {totalFilteredCount === 0 ? (
                    <tr>
                      <td colSpan={tenantId ? "11" : "13"} className="px-4 py-8 text-center text-gray-500">
                        <FaFileInvoice className="mb-2 inline-block text-4xl text-gray-300" />
                        <p className="mt-1 text-sm font-semibold">No invoices found</p>
                        <p className="mt-1 text-xs text-gray-400">
                          {tenantId
                            ? "Create invoices from billing schedule"
                            : "Create invoices and apply filters to see results"}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    currentPageInvoices.map((invoice, idx) => (
                      <InvoiceTableRow
                        key={invoice.key}
                        invoice={invoice}
                        isSelected={selectedInvoices.includes(invoice.key)}
                        idx={idx}
                        showTenantColumns={!tenantId}
                        canExportInvoice={canExportInvoice}
                        canDeleteInvoice={canDeleteInvoice}
                        onView={handleViewInvoice}
                        onPrint={handlePrintInvoice}
                        onDownload={handleDownloadInvoice}
                        onDelete={handleDeleteSingle}
                        onSelect={toggleRowSelection}
                        onViewStatement={handleViewTenantStatement}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-1 text-xs text-slate-700">
              <p>
                <span className="font-semibold">Showing:</span> {totalFilteredCount === 0 ? 0 : startIndex + 1}
                {" - "}
                {endIndex} of {totalFilteredCount} invoice(s)
                {appliedFilters.status !== "ACTIVE" && ` · Status: ${appliedFilters.status}`}
              </p>
              <div className="flex items-center gap-3">
                <p>
                  <span className="font-semibold">Selected:</span> {selectedCount}
                  {totalFilteredCount > 0 && (
                    <>
                      {" · "}
                      <span className="font-semibold">Total:</span> KES {totalAmount.toLocaleString()}
                    </>
                  )}
                </p>
                <div className="h-4 w-px bg-slate-300" />
                <span className="text-slate-500">Per page: {ITEMS_PER_PAGE}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={safeCurrentPage === 1}
                    className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="rounded border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-700">
                    Page {safeCurrentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="rounded border border-slate-300 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showSingleBooking && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">Single Tenant Booking</h3>
              <button
                onClick={() => {
                  setShowSingleBooking(false);
                  setBookingAction("");
                }}
                className="text-white/70 transition-colors hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Property Filter</label>
                  <AppSelect
                    value={singleBookingPropertyFilter}
                    onChange={(v) => {
                      setSingleBookingPropertyFilter(v ?? "all");
                      setSingleBookingTenantSearch("");
                      setSingleBookingTenantDropdownOpen(false);
                      setSingleBookingForm((prev) => ({ ...prev, tenantId: "" }));
                    }}
                    options={activePropertyOptions}
                    searchable
                    size="md"
                  />
                </div>

                <div className="relative md:col-span-2">
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tenant</label>
                  <input
                    type="text"
                    value={singleBookingTenantSearch || formatTenantOptionLabel(selectedSingleBookingTenantOption)}
                    onFocus={() => setSingleBookingTenantDropdownOpen(true)}
                    onChange={(e) => {
                      setSingleBookingTenantSearch(e.target.value);
                      setSingleBookingTenantDropdownOpen(true);
                      setSingleBookingForm((prev) => ({ ...prev, tenantId: "" }));
                    }}
                    placeholder="Type tenant name, code, unit, or property..."
                    className="w-full px-3 py-2 pr-9 text-sm border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0B3B2E]"
                  />
                  <button
                    type="button"
                    onClick={() => setSingleBookingTenantDropdownOpen((open) => !open)}
                    className="absolute right-2 top-[29px] rounded px-2 py-1 text-xs font-black text-slate-500 hover:bg-slate-100"
                    aria-label="Toggle tenant search results"
                  >
                    ▾
                  </button>
                  {singleBookingTenantDropdownOpen && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-xl">
                      {singleBookingTenantOptions.length > 0 ? (
                        singleBookingTenantOptions.map((tenantOption) => (
                          <button
                            key={tenantOption.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setSingleBookingForm((prev) => ({ ...prev, tenantId: tenantOption.id }));
                              setSingleBookingTenantSearch(formatTenantOptionLabel(tenantOption));
                              setSingleBookingTenantDropdownOpen(false);
                            }}
                            className={`block w-full border-b border-slate-100 px-3 py-2 text-left text-xs transition last:border-b-0 hover:bg-[#0B3B2E]/5 ${
                              String(singleBookingForm.tenantId || "") === String(tenantOption.id) ? "bg-[#0B3B2E]/10" : "bg-white"
                            }`}
                          >
                            <span className="block font-black text-slate-900">
                              {tenantOption.name}{tenantOption.tenantCode ? ` · ${tenantOption.tenantCode}` : ""}
                            </span>
                            <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">
                              {tenantOption.propertyName} · {tenantOption.unitName}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-xs font-semibold text-slate-500">No matching tenants found.</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="md:col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                  Showing {singleBookingTenantOptions.length.toLocaleString()} active tenant{singleBookingTenantOptions.length === 1 ? "" : "s"} for this single booking filter.
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Period</label>
                  <AppSelect
                    value={singleBookingForm.month}
                    onChange={(v) =>
                      setSingleBookingForm((prev) => {
                        const nextPeriod = clampBillingPeriod(Number(v), prev.year);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    options={MONTH_OPTIONS.filter((o) => !isFutureBillingPeriod(o.value, Number(singleBookingForm.year))).map((o) => ({ value: o.value, label: o.label }))}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Year</label>
                  <input
                    type="number"
                    min="2000"
                    max={currentBookingYear}
                    value={singleBookingForm.year}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => {
                        const nextYear = Math.min(Number(e.target.value) || currentBookingYear, currentBookingYear);
                        const nextPeriod = clampBillingPeriod(prev.month, nextYear);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>


                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Booking Date</label>
                  <input
                    type="date"
                    value={singleBookingForm.invoiceDate ? new Date(singleBookingForm.invoiceDate).toISOString().slice(0, 10) : ""}
                    onChange={(e) =>
                      setSingleBookingForm((prev) => ({ ...prev, invoiceDate: e.target.value ? new Date(e.target.value) : prev.invoiceDate, bookWithInvoiceDate: true }))
                    }
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                  <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(singleBookingForm.bookWithInvoiceDate)}
                      onChange={(e) =>
                        setSingleBookingForm((prev) => ({
                          ...prev,
                          bookWithInvoiceDate: e.target.checked,
                          invoiceDate: e.target.checked ? prev.invoiceDate : getStartOfPeriod(prev.month, prev.year),
                        }))
                      }
                    />
                    Book with booking date
                  </label>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Due Day</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max={getDaysInMonth(Number(singleBookingForm.month), Number(singleBookingForm.year))}
                      value={singleBookingForm.dueDay}
                      onChange={(e) =>
                        setSingleBookingForm((prev) => ({
                          ...prev,
                          dueDay: normalizeDueDay(e.target.value, prev.month, prev.year),
                        }))
                      }
                      className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setSingleBookingForm((prev) => ({ ...prev, dueDay: 5 }))}
                      className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Default 5th
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Booking Option</label>
                  <AppSelect
                    value={singleBookingForm.billingMode}
                    onChange={(v) => setSingleBookingForm((prev) => ({ ...prev, billingMode: v ?? "separate" }))}
                    options={[
                      { value: "separate", label: "Rent + Utility (separate)" },
                      { value: "combined", label: "Rent + Utility (combined)" },
                      { value: "rent", label: "Rent only" },
                      { value: "utility", label: "Utility only" },
                    ]}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Handling</label>
                  <AppSelect
                    value={singleBookingForm.taxHandling}
                    onChange={(v) => setSingleBookingForm((prev) => ({ ...prev, taxHandling: v ?? "company_default" }))}
                    options={[
                      { value: "company_default", label: "Use company default" },
                      ...(companyTaxEnabled ? [{ value: "taxable", label: "Force taxable" }] : []),
                      { value: "non_taxable", label: "Force non-taxable" },
                    ]}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Code</label>
                  <AppSelect
                    value={singleBookingForm.taxCodeKey}
                    onChange={(v) => setSingleBookingForm((prev) => ({ ...prev, taxCodeKey: v ?? "vat_standard" }))}
                    options={taxCodeOptions}
                    disabled={singleBookingForm.taxHandling === "non_taxable"}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Mode</label>
                  <AppSelect
                    value={singleBookingForm.taxMode}
                    onChange={(v) => setSingleBookingForm((prev) => ({ ...prev, taxMode: v ?? "company_default" }))}
                    options={[
                      { value: "company_default", label: "Use company default" },
                      { value: "exclusive", label: "Exclusive" },
                      { value: "inclusive", label: "Inclusive" },
                    ]}
                    disabled={singleBookingForm.taxHandling === "non_taxable"}
                    size="md"
                  />
                </div>
              </div>

              {selectedSingleBookingPreview && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs font-semibold text-emerald-800 mb-2">
                    Booking Preview - {selectedSingleBookingPreview.periodLabel}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">Property</p>
                      <p className="font-semibold text-slate-900">{selectedSingleBookingPreview.propertyName}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Unit</p>
                      <p className="font-semibold text-slate-900">{selectedSingleBookingPreview.unitName}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Rent</p>
                      <p className="font-semibold text-slate-900">
                        KES {selectedSingleBookingPreview.rentAmount.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Utility</p>
                      <p className="font-semibold text-slate-900">
                        KES {selectedSingleBookingPreview.utilityAmount.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Booking Date</p>
                      <p className="font-semibold text-slate-900">
                        {formatDateDisplay(singleBookingForm.bookWithInvoiceDate ? singleBookingForm.invoiceDate : getStartOfPeriod(Number(singleBookingForm.month), Number(singleBookingForm.year)))}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">Due Date</p>
                      <p className="font-semibold text-slate-900">
                        {formatDateDisplay(getDueDateForPeriod(Number(singleBookingForm.month), Number(singleBookingForm.year), Number(singleBookingForm.dueDay || 5)))}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-bold text-[#0B3B2E]">
                    Subtotal: KES {Number(selectedSingleBookingPreview.selectedTotalAmount || 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-emerald-900">
                    Estimated tax: KES {Number(selectedSingleBookingTaxPreview?.taxAmount || 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-sm font-bold text-[#0B3B2E]">
                    Gross total: KES {Number(selectedSingleBookingTaxPreview?.grossAmount || selectedSingleBookingPreview.selectedTotalAmount || 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-800 font-semibold">
                    Mode: {getBillingModeLabel(singleBookingForm.billingMode)}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-800 font-semibold">
                    Tax: {singleBookingForm.taxHandling === "company_default" ? "Company default" : singleBookingForm.taxHandling === "non_taxable" ? "Forced non-taxable" : `${getTaxCodeLabel(singleBookingForm.taxCodeKey, normalizedTaxConfig)} (${singleBookingForm.taxMode === "company_default" ? "Company mode" : singleBookingForm.taxMode})`}
                  </p>
                  {!companyTaxEnabled && (
                    <p className="mt-1 text-[11px] text-amber-700 font-semibold">
                      Company tax is currently disabled. Backend tax posting will remain non-taxable until tax is enabled in Company Setup.
                    </p>
                  )}
                </div>
              )}

            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={() => {
                  setShowSingleBooking(false);
                  setBookingAction("");
                }}
                className="px-4 py-2 text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSingleBooking}
                disabled={submittingSingleBooking}
                className="bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingSingleBooking ? "Creating..." : "Create Booking"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchBooking && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[2px] sm:items-center">
          <div className="flex w-full max-w-3xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-[#0B3B2E] px-4 py-3 text-white">
              <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wide">Batch Booking</h3>
              <button
                onClick={() => {
                  setShowBatchBooking(false);
                  setBookingAction("");
                }}
                className="text-white/70 transition-colors hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-white px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">
                    Property Scope
                  </label>
                  <AppSelect
                    value={batchBookingForm.propertyId}
                    onChange={(v) => {
                      setBatchBookingForm((prev) => ({ ...prev, propertyId: v ?? "all" }));
                    }}
                    options={activePropertyOptions}
                    searchable
                    size="md"
                  />
                </div>


                <div className="md:col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                  Batch scope: {batchBookingScopeCount.toLocaleString()} active tenant{batchBookingScopeCount === 1 ? "" : "s"} match the current property filter.
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Period</label>
                  <AppSelect
                    value={batchBookingForm.month}
                    onChange={(v) =>
                      setBatchBookingForm((prev) => {
                        const nextPeriod = clampBillingPeriod(Number(v), prev.year);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    options={MONTH_OPTIONS.filter((o) => !isFutureBillingPeriod(o.value, Number(batchBookingForm.year))).map((o) => ({ value: o.value, label: o.label }))}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Year</label>
                  <input
                    type="number"
                    min="2000"
                    max={currentBookingYear}
                    value={batchBookingForm.year}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => {
                        const nextYear = Math.min(Number(e.target.value) || currentBookingYear, currentBookingYear);
                        const nextPeriod = clampBillingPeriod(prev.month, nextYear);
                        return { ...prev, month: nextPeriod.month, year: nextPeriod.year };
                      })
                    }
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Booking Date</label>
                  <input
                    type="date"
                    value={batchBookingForm.invoiceDate ? new Date(batchBookingForm.invoiceDate).toISOString().slice(0, 10) : ""}
                    onChange={(e) =>
                      setBatchBookingForm((prev) => ({ ...prev, invoiceDate: e.target.value ? new Date(e.target.value) : prev.invoiceDate, bookWithInvoiceDate: true }))
                    }
                    className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                  />
                  <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(batchBookingForm.bookWithInvoiceDate)}
                      onChange={(e) =>
                        setBatchBookingForm((prev) => ({
                          ...prev,
                          bookWithInvoiceDate: e.target.checked,
                          invoiceDate: e.target.checked ? prev.invoiceDate : getStartOfPeriod(prev.month, prev.year),
                        }))
                      }
                    />
                    Book with booking date
                  </label>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Due Day</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max={getDaysInMonth(Number(batchBookingForm.month), Number(batchBookingForm.year))}
                      value={batchBookingForm.dueDay}
                      onChange={(e) =>
                        setBatchBookingForm((prev) => ({
                          ...prev,
                          dueDay: normalizeDueDay(e.target.value, prev.month, prev.year),
                        }))
                      }
                      className="w-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none transition focus:border-[#0B3B2E] focus:ring-1 focus:ring-[#0B3B2E]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setBatchBookingForm((prev) => ({ ...prev, dueDay: 5 }))}
                      className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Default 5th
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Booking Option</label>
                  <AppSelect
                    value={batchBookingForm.billingMode}
                    onChange={(v) => setBatchBookingForm((prev) => ({ ...prev, billingMode: v ?? "separate" }))}
                    options={[
                      { value: "separate", label: "Rent + Utility (separate)" },
                      { value: "combined", label: "Rent + Utility (combined)" },
                      { value: "rent", label: "Rent only" },
                      { value: "utility", label: "Utility only" },
                    ]}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Handling</label>
                  <AppSelect
                    value={batchBookingForm.taxHandling}
                    onChange={(v) => setBatchBookingForm((prev) => ({ ...prev, taxHandling: v ?? "company_default" }))}
                    options={[
                      { value: "company_default", label: "Use company default" },
                      ...(companyTaxEnabled ? [{ value: "taxable", label: "Force taxable" }] : []),
                      { value: "non_taxable", label: "Force non-taxable" },
                    ]}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Code</label>
                  <AppSelect
                    value={batchBookingForm.taxCodeKey}
                    onChange={(v) => setBatchBookingForm((prev) => ({ ...prev, taxCodeKey: v ?? "vat_standard" }))}
                    options={taxCodeOptions}
                    disabled={batchBookingForm.taxHandling === "non_taxable"}
                    size="md"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-slate-500">Tax Mode</label>
                  <AppSelect
                    value={batchBookingForm.taxMode}
                    onChange={(v) => setBatchBookingForm((prev) => ({ ...prev, taxMode: v ?? "company_default" }))}
                    options={[
                      { value: "company_default", label: "Use company default" },
                      { value: "exclusive", label: "Exclusive" },
                      { value: "inclusive", label: "Inclusive" },
                    ]}
                    disabled={batchBookingForm.taxHandling === "non_taxable"}
                    size="md"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs text-orange-800 font-semibold">
                  Scope preview: {batchBookingScopeCount} active tenant(s) will be booked for{" "}
                  {formatPeriodLabel(Number(batchBookingForm.month), Number(batchBookingForm.year))}.
                </p>
                <p className="text-xs text-orange-800 font-semibold mt-1">
                  Mode: {getBillingModeLabel(batchBookingForm.billingMode)}
                </p>
                <p className="text-xs text-orange-800 font-semibold mt-1">
                  Booking date: {formatDateDisplay(batchBookingForm.bookWithInvoiceDate ? batchBookingForm.invoiceDate : getStartOfPeriod(Number(batchBookingForm.month), Number(batchBookingForm.year)))} · Due date: {formatDateDisplay(getDueDateForPeriod(Number(batchBookingForm.month), Number(batchBookingForm.year), Number(batchBookingForm.dueDay || 5)))}
                </p>
                <p className="text-xs text-orange-800 font-semibold mt-1">
                  Estimated gross booking: KES {Number(batchBookingTaxPreview?.grossAmount || 0).toLocaleString()} (tax: KES {Number(batchBookingTaxPreview?.taxAmount || 0).toLocaleString()})
                </p>
                <p className="text-xs text-orange-800 font-semibold mt-1">
                  Tax: {batchBookingForm.taxHandling === "company_default" ? "Company default" : batchBookingForm.taxHandling === "non_taxable" ? "Forced non-taxable" : `${getTaxCodeLabel(batchBookingForm.taxCodeKey, normalizedTaxConfig)} (${batchBookingForm.taxMode === "company_default" ? "Company mode" : batchBookingForm.taxMode})`}
                </p>
                {!companyTaxEnabled && (
                  <p className="text-xs text-amber-700 font-semibold mt-1">
                    Company tax is disabled, so backend tax posting will remain non-taxable until enabled in Company Setup.
                  </p>
                )}
              </div>

            </div>
            <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={() => {
                  setShowBatchBooking(false);
                  setBookingAction("");
                }}
                className="px-4 py-2 text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchBooking}
                disabled={submittingBatchBooking}
                className="bg-[#0B3B2E] px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-[#0d5442] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submittingBatchBooking ? "Running..." : "Run Batch Booking"}
              </button>
            </div>
          </div>
        </div>
      )}

      {invoiceDetailOpen && activeInvoice && (
        <div className="fixed inset-0 z-[80]" onClick={closeInvoiceDetail}>
          <button
            type="button"
            aria-label="Close invoice details"
            onClick={closeInvoiceDetail}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
          />
          <div className="absolute inset-y-0 right-0 flex w-full justify-end">
            <div
              className="relative flex h-full w-full max-w-[700px] flex-col bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── HEADER ── */}
              <div className="shrink-0 bg-[#0B3B2E] px-6 py-5 text-white">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.35em] text-emerald-300/80">Rental Invoice</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                      <h2 className="font-mono text-[22px] font-black leading-none tracking-tight">{activeInvoice.id}</h2>
                      <span className={`inline-flex shrink-0 rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${getInvoiceStatusBadgeClasses(activeInvoice.status)} bg-white/90`}>
                        {activeInvoice.status}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] font-semibold text-emerald-100/90">
                      {activeInvoice.invoiceDescription || activeInvoice.period}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeInvoiceDetail}
                    className="shrink-0 rounded border border-white/20 bg-white/10 p-1.5 text-white hover:bg-white/20"
                    title="Close"
                  >
                    <FaTimes size={13} />
                  </button>
                </div>

                {/* Meta strip */}
                <div className="mt-4 grid grid-cols-3 divide-x divide-white/10 rounded border border-white/10 bg-white/5 text-[11px]">
                  <div className="px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300/60">Tenant</p>
                    <p className="mt-0.5 truncate font-semibold text-white">{activeInvoice.tenantName}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300/60">Unit</p>
                    <p className="mt-0.5 truncate font-semibold text-white">{activeInvoice.propertyName} · {activeInvoice.unitName}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-300/60">Period</p>
                    <p className="mt-0.5 font-semibold text-white">{activeInvoice.period || "—"}</p>
                  </div>
                </div>
              </div>

              {/* ── FINANCIAL SUMMARY ── */}
              <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Invoice Total</p>
                    <p className="mt-1 font-mono text-[28px] font-black leading-none tracking-tight text-slate-900">
                      {formatCurrency(activeInvoiceGrossAmount)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-stretch divide-x divide-slate-200 rounded border border-slate-200 text-center text-[11px]">
                    <div className="px-4 py-2">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Paid</p>
                      <p className="mt-1 font-mono font-black text-slate-900">{formatCurrency(activeInvoice?.appliedAmount || 0)}</p>
                    </div>
                    <div className="px-4 py-2">
                      <p className={`text-[9px] font-black uppercase tracking-widest ${activeInvoice?.outstandingAmount > 0 ? "text-rose-600" : "text-slate-400"}`}>
                        Outstanding
                      </p>
                      <p className={`mt-1 font-mono font-black ${activeInvoice?.outstandingAmount > 0 ? "text-rose-700" : "text-slate-400"}`}>
                        {formatCurrency(activeInvoice?.outstandingAmount || 0)}
                      </p>
                    </div>
                    <div className="px-4 py-2">
                      <p className={`text-[9px] font-black uppercase tracking-widest ${activeInvoiceDaysOverdue > 0 ? "text-rose-600" : "text-slate-400"}`}>
                        {activeInvoiceDaysOverdue > 0 ? "Overdue" : "Status"}
                      </p>
                      <p className={`mt-1 font-mono font-black ${activeInvoiceDaysOverdue > 0 ? "text-rose-700" : "text-emerald-600"}`}>
                        {activeInvoiceDaysOverdue > 0 ? `${activeInvoiceDaysOverdue}d` : "Current"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Settlement bar */}
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Payment Progress</p>
                    <p className="text-[9px] font-black text-slate-600">{activeInvoiceSettlementPercentage.toFixed(0)}% settled</p>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        activeInvoiceSettlementPercentage >= 100 ? "bg-emerald-500" :
                        activeInvoiceSettlementPercentage > 0 ? "bg-amber-400" : "bg-slate-200"
                      }`}
                      style={{ width: `${activeInvoiceSettlementPercentage}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* ── ACTION BAR ── */}
              <div className="shrink-0 flex flex-wrap items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-6 py-2.5">
                {canExportInvoice && (
                  <button type="button" onClick={() => handlePrintInvoice(activeInvoice)}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">
                    <FaPrint size={10} /> Print
                  </button>
                )}
                {canExportInvoice && (
                  <button type="button" onClick={() => handleDownloadInvoice(activeInvoice)}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">
                    <FaDownload size={10} /> Download
                  </button>
                )}
                <button type="button" onClick={() => handleViewTenantStatement(activeInvoice.tenantId)}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">
                  <FaArrowRight size={10} /> Tenant Statement
                </button>
                {canDeleteInvoice && (
                  <button type="button" onClick={() => handleDeleteSingle(activeInvoice)} disabled={!canDeleteActiveInvoice}
                    className="ml-auto inline-flex items-center gap-1.5 rounded border border-rose-200 bg-white px-3 py-1.5 text-[11px] font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-40"
                    title={canDeleteActiveInvoice ? "Delete invoice" : "Paid invoices cannot be deleted"}>
                    <FaTrash size={10} /> Delete
                  </button>
                )}
              </div>

              {/* ── BODY ── */}
              <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">

                {/* Charge Breakdown */}
                <div className="bg-white">
                  <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2">
                    <FaMoneyBillWave size={10} className="text-slate-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Charge Breakdown</span>
                  </div>
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="bg-[#0B3B2E] text-white">
                      <tr>
                        <th className="px-4 py-1 text-left font-bold border-r border-white/10">Description</th>
                        <th className="px-4 py-1 text-right font-bold">Amount (KES)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeInvoiceBreakdown.map((item, i) => (
                        <tr key={`${item.label}-${i}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                          <td className="px-4 py-1.5 border-r border-gray-100 text-slate-700">{item.label}</td>
                          <td className="px-4 py-1.5 text-right font-mono font-semibold text-slate-900">{formatCurrency(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50/80">
                        <td className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Net Amount</td>
                        <td className="px-4 py-1.5 text-right font-mono font-bold text-slate-700">{formatCurrency(activeInvoiceNetAmount)}</td>
                      </tr>
                      {activeInvoiceTaxAmount > 0 && (
                        <tr className="bg-slate-50/80">
                          <td className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">VAT / Tax</td>
                          <td className="px-4 py-1.5 text-right font-mono font-bold text-slate-700">{formatCurrency(activeInvoiceTaxAmount)}</td>
                        </tr>
                      )}
                      <tr className="border-t-2 border-[#0B3B2E]/20 bg-[#0B3B2E]/5">
                        <td className="px-4 py-2 text-[11px] font-black uppercase tracking-wider text-[#0B3B2E]">Total Payable</td>
                        <td className="px-4 py-2 text-right font-mono font-black text-[#0B3B2E]">{formatCurrency(activeInvoiceGrossAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Journal Entries */}
                <div className="bg-white">
                  <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-6 py-2">
                    <FaFileInvoice size={10} className="text-slate-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Journal Entries</span>
                  </div>
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        <th className="px-4 py-1 text-left font-bold border-r border-white/10">Account</th>
                        <th className="px-4 py-1 text-right font-bold border-r border-white/10">Debit</th>
                        <th className="px-4 py-1 text-right font-bold">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeInvoiceJournalLines.map((line, i) => (
                        <tr key={`${line.accountCode}-${i}`} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                          <td className="px-4 py-1.5 border-r border-gray-100">
                            <p className="font-mono font-bold text-slate-800">{line.accountCode} · {line.accountName}</p>
                            <p className="mt-0.5 text-[10px] text-slate-400">{line.narration}</p>
                          </td>
                          <td className="px-4 py-1.5 border-r border-gray-100 text-right font-mono font-semibold text-slate-700">
                            {line.debit ? formatCurrency(line.debit) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-1.5 text-right font-mono font-semibold text-slate-700">
                            {line.credit ? formatCurrency(line.credit) : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Payment Applications */}
                <div className="bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-2">
                    <div className="flex items-center gap-2">
                      <FaReceipt size={10} className="text-slate-400" />
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Payment Applications</span>
                    </div>
                    <span className="text-[9px] font-bold text-slate-400">{activeInvoiceReceiptApplications.length} receipt(s)</span>
                  </div>
                  {activeInvoiceReceiptApplications.length === 0 ? (
                    <div className="px-6 py-8 text-center text-[11px] text-slate-400">
                      No payments have been applied to this invoice yet.
                    </div>
                  ) : (
                    <table className="w-full text-[11px] border-collapse">
                      <thead className="bg-[#0B3B2E] text-white">
                        <tr>
                          <th className="px-4 py-1 text-left font-bold border-r border-white/10">Receipt</th>
                          <th className="px-4 py-1 text-left font-bold border-r border-white/10">Date</th>
                          <th className="px-4 py-1 text-right font-bold border-r border-white/10">Applied</th>
                          <th className="px-4 py-1 text-right font-bold">Bal. After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeInvoiceReceiptApplications.map((row, i) => (
                          <tr key={row.key} className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white hover:bg-blue-50/40' : 'bg-slate-50/60 hover:bg-blue-50/40'}`}>
                            <td className="px-4 py-1.5 border-r border-gray-100">
                              <p className="font-mono font-bold text-slate-900">{row.receiptNumber}</p>
                              <p className="text-[10px] capitalize text-slate-400">{String(row.paymentType || "receipt").replace(/_/g, " ")}</p>
                            </td>
                            <td className="px-4 py-1.5 border-r border-gray-100 text-slate-500">{row.receiptDate ? formatDateDisplay(row.receiptDate) : "—"}</td>
                            <td className="px-4 py-1.5 border-r border-gray-100 text-right font-mono font-bold text-emerald-700">{formatCurrency(row.appliedAmount)}</td>
                            <td className="px-4 py-1.5 text-right font-mono font-semibold text-slate-500">{formatCurrency(row.afterOutstanding)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
      <CommunicationComposerModal
        open={showSmsModal}
        onClose={() => setShowSmsModal(false)}
        businessId={currentCompany?._id || ""}
        contextType="invoice"
        recordIds={selectedInvoices}
        title={`SMS Invoice${selectedInvoices.length !== 1 ? "s" : ""} (${selectedInvoices.length})`}
        subtitle="Send an SMS notification to the tenants for the selected invoices."
        allowedChannels={["sms"]}
        defaultChannel="sms"
        onSent={() => setShowSmsModal(false)}
      />
      <CommunicationComposerModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        businessId={currentCompany?._id || ""}
        contextType="invoice"
        recordIds={selectedInvoices}
        title={`Email Invoice${selectedInvoices.length !== 1 ? "s" : ""} (${selectedInvoices.length})`}
        subtitle="Send an email notification to the tenants for the selected invoices."
        allowedChannels={["email"]}
        defaultChannel="email"
        onSent={() => setShowEmailModal(false)}
      />
    </DashboardLayout>
  );
};

export default RentalInvoices;